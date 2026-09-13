// SPDX-License-Identifier: Apache-2.0
//! Device identity for the shared-sessions protocol.
//!
//! The protocol requires `x-codai-device` to be a UUID that is stable for the
//! lifetime of the install (the server's `devices.id` *is* this value). It is
//! generated once and persisted in `device.json` inside the app data dir.

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "device.json";
const KEY_ID: &str = "device_id";

#[derive(Serialize)]
pub struct DeviceInfo {
    /// Stable per-install UUID (v4), generated on first call.
    pub id: String,
    /// Machine hostname, used as the default device name.
    pub hostname: String,
    /// `windows` | `macos` | `linux` | … (std `OS` constant).
    pub os: String,
    pub arch: String,
    pub app_version: String,
}

fn is_uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}

fn load_or_create_id<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    if let Some(v) = store.get(KEY_ID) {
        if let Some(s) = v.as_str() {
            if is_uuid(s) {
                return Ok(s.to_owned());
            }
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    store.set(KEY_ID, serde_json::Value::String(id.clone()));
    store.save().map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn device_info<R: Runtime>(app: AppHandle<R>) -> Result<DeviceInfo, String> {
    let id = load_or_create_id(&app)?;
    let hostname = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "desktop".to_owned());
    Ok(DeviceInfo {
        id,
        hostname,
        os: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        app_version: app.package_info().version.to_string(),
    })
}
