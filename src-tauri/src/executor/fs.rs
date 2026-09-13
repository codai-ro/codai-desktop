// SPDX-License-Identifier: Apache-2.0
//! `fs_read` / `fs_write` / `fs_list`, confined to user-approved roots.
//!
//! Roots live in `settings.json` under `fsRoots` (written by the Settings
//! page). When the list is empty the home directory is the single root. Every
//! path is canonicalised (symlinks resolved) and must start with a canonical
//! root, so `..` traversal and symlink escapes are rejected. For `fs_write` the
//! parent directory is canonicalised instead (the file may not exist yet).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

use super::{cap_str, progress};

const SETTINGS_FILE: &str = "settings.json";
const ROOTS_KEY: &str = "fsRoots";
const MAX_READ: usize = 512 * 1024;
const MAX_WRITE: usize = 2 * 1024 * 1024;
const MAX_LIST: usize = 500;

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Canonical roots from settings (falling back to the home dir). Roots that
/// do not exist are skipped rather than failing every call.
pub fn roots<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<PathBuf>, String> {
    let store = app.store(SETTINGS_FILE).map_err(|e| e.to_string())?;
    let mut list: Vec<PathBuf> = store
        .get(ROOTS_KEY)
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(PathBuf::from))
        .filter_map(|p| dunce::canonicalize(&p).ok())
        .collect();
    if list.is_empty() {
        if let Some(h) = home_dir().and_then(|h| dunce::canonicalize(h).ok()) {
            list.push(h);
        }
    }
    if list.is_empty() {
        return Err("no allowed roots configured".into());
    }
    Ok(list)
}

fn within(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|r| path == r || path.starts_with(r))
}

/// Resolve an existing path and verify it is under an allowed root.
fn resolve_existing<R: Runtime>(app: &AppHandle<R>, raw: &str) -> Result<PathBuf, String> {
    let p = Path::new(raw.trim());
    if p.as_os_str().is_empty() {
        return Err("path is empty".into());
    }
    let canon = dunce::canonicalize(p).map_err(|e| format!("{}: {e}", p.display()))?;
    if !within(&canon, &roots(app)?) {
        return Err(format!("path is outside the allowed roots: {}", canon.display()));
    }
    Ok(canon)
}

/// Resolve a path that may not exist yet (write target): canonicalise the
/// nearest existing ancestor and re-append the remainder.
fn resolve_for_write<R: Runtime>(app: &AppHandle<R>, raw: &str) -> Result<PathBuf, String> {
    let p = Path::new(raw.trim());
    if p.as_os_str().is_empty() {
        return Err("path is empty".into());
    }
    let file_name = p
        .file_name()
        .ok_or_else(|| "path has no file name".to_owned())?
        .to_owned();
    if file_name == ".." || file_name == "." {
        return Err("invalid file name".into());
    }
    let parent = p.parent().filter(|x| !x.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let parent = dunce::canonicalize(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    if !within(&parent, &roots(app)?) {
        return Err(format!("path is outside the allowed roots: {}", parent.display()));
    }
    Ok(parent.join(file_name))
}

#[derive(Deserialize)]
pub struct FsReadArgs {
    pub path: String,
    pub max_bytes: Option<usize>,
}

#[derive(Serialize)]
pub struct FsReadResult {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub truncated: bool,
}

#[tauri::command]
pub fn fs_read<R: Runtime>(app: AppHandle<R>, args: FsReadArgs) -> Result<FsReadResult, String> {
    let path = resolve_existing(&app, &args.path)?;
    progress(&app, "fs_read", "start", path.display().to_string());
    if !path.is_file() {
        return Err(format!("not a file: {}", path.display()));
    }
    let max = args.max_bytes.unwrap_or(64 * 1024).clamp(1, MAX_READ);
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let (content, truncated) = cap_str(&String::from_utf8_lossy(&bytes), max);
    progress(&app, "fs_read", "end", format!("{} bytes", bytes.len()));
    Ok(FsReadResult {
        path: path.display().to_string(),
        content,
        size: meta.len(),
        truncated,
    })
}

#[derive(Deserialize)]
pub struct FsWriteArgs {
    pub path: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct FsWriteResult {
    pub path: String,
    pub bytes: usize,
    pub created: bool,
}

#[tauri::command]
pub fn fs_write<R: Runtime>(app: AppHandle<R>, args: FsWriteArgs) -> Result<FsWriteResult, String> {
    if args.content.len() > MAX_WRITE {
        return Err(format!("content exceeds {MAX_WRITE} bytes"));
    }
    let path = resolve_for_write(&app, &args.path)?;
    progress(&app, "fs_write", "start", path.display().to_string());
    if path.is_dir() {
        return Err(format!("is a directory: {}", path.display()));
    }
    let created = !path.exists();
    std::fs::write(&path, args.content.as_bytes()).map_err(|e| e.to_string())?;
    progress(&app, "fs_write", "end", format!("{} bytes", args.content.len()));
    Ok(FsWriteResult {
        path: path.display().to_string(),
        bytes: args.content.len(),
        created,
    })
}

#[derive(Deserialize)]
pub struct FsListArgs {
    pub path: String,
}

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    pub kind: &'static str,
    pub size: u64,
}

#[derive(Serialize)]
pub struct FsListResult {
    pub path: String,
    pub entries: Vec<FsEntry>,
    pub truncated: bool,
}

#[tauri::command]
pub fn fs_list<R: Runtime>(app: AppHandle<R>, args: FsListArgs) -> Result<FsListResult, String> {
    let path = resolve_existing(&app, &args.path)?;
    progress(&app, "fs_list", "start", path.display().to_string());
    if !path.is_dir() {
        return Err(format!("not a directory: {}", path.display()));
    }
    let mut entries = Vec::new();
    let mut truncated = false;
    for e in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let Ok(e) = e else { continue };
        if entries.len() >= MAX_LIST {
            truncated = true;
            break;
        }
        let meta = e.metadata().ok();
        let kind = match meta.as_ref() {
            Some(m) if m.is_dir() => "dir",
            Some(m) if m.is_symlink() => "symlink",
            Some(_) => "file",
            None => "unknown",
        };
        entries.push(FsEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            kind,
            size: meta.map(|m| m.len()).unwrap_or(0),
        });
    }
    entries.sort_by(|a, b| (a.kind != "dir").cmp(&(b.kind != "dir")).then(a.name.cmp(&b.name)));
    progress(&app, "fs_list", "end", format!("{} entries", entries.len()));
    Ok(FsListResult {
        path: path.display().to_string(),
        entries,
        truncated,
    })
}

#[derive(Serialize)]
pub struct FsRootsResult {
    pub roots: Vec<String>,
}

/// Effective roots (canonical), for the Settings page.
#[tauri::command]
pub fn fs_roots<R: Runtime>(app: AppHandle<R>) -> Result<FsRootsResult, String> {
    Ok(FsRootsResult {
        roots: roots(&app)?.into_iter().map(|p| p.display().to_string()).collect(),
    })
}
