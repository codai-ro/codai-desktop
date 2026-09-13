// SPDX-License-Identifier: Apache-2.0
//! `shell_run`: one command in `pwsh` (Windows) or `bash` (elsewhere), output
//! capped at 64 KB per stream, hard timeout that kills the whole process tree.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use super::{cap_str, progress};

pub const OUTPUT_CAP: usize = 64 * 1024;
const MAX_TIMEOUT_MS: u64 = 10 * 60 * 1000;

#[derive(Deserialize)]
pub struct ShellRunArgs {
    pub cmd: String,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct ShellRunResult {
    /// Exit code; `-1` when the process was killed (timeout) or had no code.
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub timed_out: bool,
    pub duration_ms: u64,
}

fn shell_command(cmd: &str) -> Command {
    #[cfg(windows)]
    {
        // Prefer PowerShell 7; fall back to Windows PowerShell 5.1.
        let exe = if which("pwsh.exe") { "pwsh.exe" } else { "powershell.exe" };
        let mut c = Command::new(exe);
        c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd]);
        c
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        let mut c = Command::new("bash");
        c.args(["-lc", cmd]);
        // Own process group so the timeout can kill the whole tree.
        c.process_group(0);
        c
    }
}

#[cfg(windows)]
fn which(exe: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(exe).is_file()))
        .unwrap_or(false)
}

fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        // Negative pid = the process group created by `process_group(0)`.
        let _ = Command::new("kill")
            .args(["-9", &format!("-{}", child.id())])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

/// Read a stream to completion on its own thread, keeping at most `cap` bytes.
fn drain<Rd: Read + Send + 'static>(mut r: Rd, cap: usize) -> mpsc::Receiver<(Vec<u8>, bool)> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut kept = Vec::with_capacity(4096);
        let mut truncated = false;
        let mut buf = [0u8; 8192];
        loop {
            match r.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if kept.len() < cap {
                        let take = n.min(cap - kept.len());
                        kept.extend_from_slice(&buf[..take]);
                        if take < n {
                            truncated = true;
                        }
                    } else {
                        truncated = true;
                    }
                }
            }
        }
        let _ = tx.send((kept, truncated));
    });
    rx
}

pub fn run_blocking(args: ShellRunArgs) -> Result<ShellRunResult, String> {
    let cmd = args.cmd.trim();
    if cmd.is_empty() {
        return Err("cmd is empty".into());
    }
    if cmd.len() > 32 * 1024 {
        return Err("cmd too long".into());
    }
    let timeout = Duration::from_millis(args.timeout_ms.unwrap_or(30_000).clamp(1_000, MAX_TIMEOUT_MS));
    let mut command = shell_command(cmd);
    if let Some(cwd) = args.cwd.as_deref().filter(|s| !s.trim().is_empty()) {
        let p = std::path::Path::new(cwd);
        if !p.is_dir() {
            return Err(format!("cwd is not a directory: {cwd}"));
        }
        command.current_dir(p);
    }
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let start = Instant::now();
    let mut child = command.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let out_rx = drain(child.stdout.take().expect("piped"), OUTPUT_CAP);
    let err_rx = drain(child.stderr.take().expect("piped"), OUTPUT_CAP);

    let mut timed_out = false;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) => {
                if start.elapsed() >= timeout {
                    timed_out = true;
                    kill_tree(&mut child);
                    let _ = child.wait();
                    break -1;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(format!("wait failed: {e}")),
        }
    };
    // Drainers finish once the pipes close (kill closes them too); bound the wait.
    let grace = Duration::from_secs(2);
    let (out, out_tr) = out_rx.recv_timeout(grace).unwrap_or((Vec::new(), true));
    let (err, err_tr) = err_rx.recv_timeout(grace).unwrap_or((Vec::new(), true));
    let (stdout, t1) = cap_str(&String::from_utf8_lossy(&out), OUTPUT_CAP);
    let (stderr, t2) = cap_str(&String::from_utf8_lossy(&err), OUTPUT_CAP);
    Ok(ShellRunResult {
        code,
        stdout,
        stderr,
        truncated: out_tr || err_tr || t1 || t2,
        timed_out,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn shell_run<R: Runtime>(app: AppHandle<R>, args: ShellRunArgs) -> Result<ShellRunResult, String> {
    let preview: String = args.cmd.chars().take(120).collect();
    progress(&app, "shell", "start", preview.clone());
    let res = tauri::async_runtime::spawn_blocking(move || run_blocking(args))
        .await
        .map_err(|e| e.to_string())?;
    match &res {
        Ok(r) => progress(
            &app,
            "shell",
            "end",
            format!("exit {}{} in {} ms", r.code, if r.timed_out { " (timeout)" } else { "" }, r.duration_ms),
        ),
        Err(e) => progress(&app, "shell", "error", e.clone()),
    }
    res
}
