// SPDX-License-Identifier: Apache-2.0
fn main() {
    // Opt the executor tool commands into the ACL: each needs an explicit
    // `allow-<command>` in `capabilities/default.json` or the call is refused.
    // (App commands are otherwise allowed everywhere by default.)
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "shell_run",
            "fs_read",
            "fs_write",
            "fs_list",
            "fs_roots",
            "browser_launch",
            "browser_detect",
            "browser_eval",
            "browser_navigate",
            "browser_snapshot",
            "browser_click",
            "browser_type",
        ])),
    )
    .expect("tauri-build failed");
}
