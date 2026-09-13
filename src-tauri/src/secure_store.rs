// SPDX-License-Identifier: Apache-2.0
//! Secret storage for the codai API key.
//!
//! Backed by `tauri-plugin-store` in a dedicated `secrets.json` under the app
//! data dir, accessed only through these three commands (the frontend never
//! touches the file by name; the `fs` capability has no app-data read scope).
//! Swapping the backend for the OS keychain (`keyring` crate) is a one-file
//! change with the same command surface — the extension point for the
//! executor slice, which will hold more than one secret.

use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "secrets.json";

fn validate_key(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.') {
        return Err("invalid secret name".to_owned());
    }
    Ok(())
}

#[tauri::command]
pub fn secret_get<R: Runtime>(app: AppHandle<R>, name: String) -> Result<Option<String>, String> {
    validate_key(&name)?;
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(store.get(&name).and_then(|v| v.as_str().map(str::to_owned)))
}

#[tauri::command]
pub fn secret_set<R: Runtime>(app: AppHandle<R>, name: String, value: String) -> Result<(), String> {
    validate_key(&name)?;
    if value.len() > 4096 {
        return Err("secret too long".to_owned());
    }
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(&name, serde_json::Value::String(value));
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete<R: Runtime>(app: AppHandle<R>, name: String) -> Result<(), String> {
    validate_key(&name)?;
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(&name);
    store.save().map_err(|e| e.to_string())
}
