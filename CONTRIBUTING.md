# Contributing to codai desktop

Thanks for helping — bug reports, ideas, docs fixes and code are all welcome.
This page covers the mechanics. For how the app is put together, read
[`docs/architecture.md`](docs/architecture.md); for the wire protocol, see
[codai-ro/codai-protocol](https://github.com/codai-ro/codai-protocol).

Not a developer? You can still help a lot: file a friendly
[bug report or idea](https://github.com/codai-ro/codai-desktop/issues/new/choose),
improve the wording in `docs/`, or contribute a real screenshot (see
[`docs/img/README.md`](docs/img/README.md)).

## Developer Certificate of Origin (no CLA)

We use the [DCO](https://developercertificate.org/) instead of a CLA. Every
commit must be signed off, certifying you have the right to submit it under
the Apache-2.0 licence of this project:

```
git commit -s -m "feat(session): resume SSE from last seq after sleep"
```

which appends `Signed-off-by: Your Name <you@example.com>`. Use your real name
and a reachable e-mail. Unsigned commits fail CI.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), imperative,
lowercase: `type(scope): description`. Types: `feat`, `fix`, `refactor`,
`perf`, `test`, `docs`, `build`, `chore`. Scopes: `session`, `sessions`,
`devices`, `settings`, `onboarding`, `gateway`, `tauri`, `updater`.

## Building

See [`README.md` → For developers](README.md#for-developers). Requirements:
Node 22+, pnpm, Rust stable (1.77.2+), and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS
(WebView2 on Windows, Xcode CLT on macOS, `libwebkit2gtk-4.1-dev` on Linux).

```
pnpm install
pnpm tauri dev
```

Only the Windows build has been produced and tested so far. PRs that get the
macOS or Linux bundles building are very welcome.

## Checks before a PR

```
pnpm typecheck
pnpm lint
pnpm test
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Pull requests

- One logical change per PR; keep it small.
- The client depends **only** on the public shared-sessions protocol
  ([codai-ro/codai-protocol](https://github.com/codai-ro/codai-protocol)).
  ESLint blocks imports of private workspace packages; do not work around it.
- Do not widen the `http` capability scope beyond the gateway origin.
- New Rust commands must be added to `build.rs` (`AppManifest::commands`) and
  allow-listed one by one in `src-tauri/capabilities/default.json`; say why
  in the PR.
- Anything that runs a command, writes a file or touches the browser must go
  through the permission ask (`src/executor/permissions.ts`). Never add a
  tool that acts silently.
- Never commit an API key, the updater private key, or a `secrets.json`.
  CI runs `gitleaks` on every push.
- Keep `pnpm build` and `cargo check` green on all three desktop OSes; do not
  add platform-specific crates without a `cfg(target_os)` guard.
- If behaviour or a setting changes, update the README / `docs/` in the same
  PR.

## Reporting bugs

Use the [bug template](https://github.com/codai-ro/codai-desktop/issues/new/choose).
Include: OS + version, app version (sidebar footer), the steps, and the gateway
response if one is shown. Redact any session content or keys before attaching
screenshots.

Security issues: **do not** open an issue — see [`SECURITY.md`](SECURITY.md).
