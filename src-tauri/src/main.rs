// SPDX-License-Identifier: Apache-2.0
// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    codai_desktop_lib::run()
}
