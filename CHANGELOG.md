# Changelog

All notable changes to codai desktop are documented here.
Format: [Keep a Changelog](https://keepachangelog.com), [Conventional Commits](https://www.conventionalcommits.org).

## [0.1.0] - 2026-09-13

First local build (Windows NSIS, signed updater artifact); not yet published as a GitHub release.

### Features

- **desktop**: local executor - lease/heartbeat, shell/fs/CDP browser tools with ask-card permissions, codai turn loop, event mirror, control router, dispatch poller (3d330110)
- **desktop**: Tauri 2 scaffold - sessions viewer/collab over the shared-sessions protocol (SSE via plugin-http, roles, presence, receipt, devices) (cef5bf0f)

### Build

- **desktop**: updater signing key generated (`~/.codai/desktop-updater.key`), public key embedded in `tauri.conf.json`; local release pipeline `scripts/ops/release-desktop-local.ps1`; updater proxy `infra/cloudflare/desktop-updater`; live gateway probe `scripts/probe-gateway.mjs`
