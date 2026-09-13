// SPDX-License-Identifier: Apache-2.0
//! codai desktop — Tauri shell.
//!
//! Slice 1 (viewer/collab): plugins, single-instance, window-state, a small
//! secure store for the API key, and `device_info()` for device registration.
//! Slice 2 (executor): `executor::{shell,fs,browser}` commands — the local
//! tools the TypeScript agent loop (`src/executor/`) dispatches to.

mod device;
mod executor;
mod secure_store;

use tauri::Manager;

pub fn run() {
    let mut builder = tauri::Builder::default();

    // Desktop-only plugins. single-instance MUST be the first plugin registered
    // (per its docs) so a second launch focuses the running window instead of
    // spawning a duplicate.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }))
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(executor::browser::BrowserState::default())
        .invoke_handler(tauri::generate_handler![
            device::device_info,
            secure_store::secret_get,
            secure_store::secret_set,
            secure_store::secret_delete,
            executor::shell::shell_run,
            executor::fs::fs_read,
            executor::fs::fs_write,
            executor::fs::fs_list,
            executor::fs::fs_roots,
            executor::browser::browser_launch,
            executor::browser::browser_detect,
            executor::browser::browser_eval,
            executor::browser::browser_navigate,
            executor::browser::browser_snapshot,
            executor::browser::browser_click,
            executor::browser::browser_type,
        ])
        .run(tauri::generate_context!())
        .expect("error while running codai desktop");
}
