// SPDX-License-Identifier: Apache-2.0
//! Desktop executor tools (v1): `shell_run`, `fs_*`, `browser_*`.
//!
//! Every command is invoked only from the TypeScript executor
//! (`src/executor/agent-run.ts`) after the permission gate there decided the
//! call is allowed. The Rust side enforces the *mechanical* limits that must
//! hold regardless of what the model asked for: output caps, hard timeouts
//! with process-tree kill, fs roots, CDP restricted to loopback.
//!
//! Each command emits a `tool_progress` event `{ tool, phase, detail }` so the
//! UI can show an activity line without polling.

pub mod browser;
pub mod fs;
pub mod shell;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Serialize, Clone)]
pub struct ToolProgress<'a> {
    pub tool: &'a str,
    pub phase: &'a str,
    pub detail: String,
}

pub fn progress<R: Runtime>(app: &AppHandle<R>, tool: &str, phase: &str, detail: impl Into<String>) {
    let _ = app.emit(
        "tool_progress",
        ToolProgress {
            tool,
            phase,
            detail: detail.into(),
        },
    );
}

/// Truncate a UTF-8 string to at most `max` bytes on a char boundary.
pub fn cap_str(s: &str, max: usize) -> (String, bool) {
    if s.len() <= max {
        return (s.to_owned(), false);
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    (s[..end].to_owned(), true)
}
