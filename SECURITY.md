# Security Policy

## Reporting a vulnerability

Please **do not** open public issues for security vulnerabilities.

Email **security@codai.ro** with a description, affected version (shown in the
sidebar footer, or `src-tauri/tauri.conf.json`), reproduction steps and, if
you have one, a proof of concept. Encrypt with the key published at
<https://codai.ro/.well-known/security.txt> if the report is sensitive.

- Acknowledgement within **72 hours**.
- Triage and severity within **7 days**.
- Fix or mitigation target: 30 days (critical), 90 days (everything else).

## Coordinated disclosure

We follow a **90-day disclosure window** from the acknowledgement date. You may
publish after a fix ships or after 90 days, whichever comes first; we will
credit you in the release notes unless you prefer otherwise. Please give us the
chance to ship the fix before publishing details.

## Scope

This repository is the desktop client only. In scope:

- Storage of the `codai_` API key (`secrets.json` via tauri-plugin-store, reachable
  only through the `secret_*` commands).
- The Tauri capability set (`src-tauri/capabilities/default.json`) — any way for
  webview content to reach an origin outside the configured gateway, the file
  system, or a shell.
- The updater: signature verification, endpoint pinning.
- Shared sessions (control routing, viewer read-only enforcement, device
  identity header).

Out of scope here (report to the same address, but they live in other repos):
the codai gateway, auth server, billing, and the model catalogue. Findings in
the Tauri framework or WebView2/WebKitGTK belong upstream.

## Supported versions

Only the latest release on the `main` branch receives security fixes.

## No secrets by design

The client holds no shared secrets. The updater **public** key in
`tauri.conf.json` is meant to be public. Never commit an API key or the updater
private key.
