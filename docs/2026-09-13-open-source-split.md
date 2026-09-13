# ADR 2026-09-13 — Open-source split: clients + protocol + SDKs public, core private

Status: accepted. Tracker row O1 in `plan/feature-shared-sessions-v4-2026-09.md`. Refines the "Open source"
consequence of `2026-09-13-shared-sessions-multi-device.md`.

## Context

The shared-sessions protocol only pays off if third parties can build executors and viewers against it. The
phone app is the reference client; a desktop client and the TS/Python SDKs follow. The monorepo is `private`
and holds the gateway (routing, pricing, spend caps, provider keys), training pipelines and forensics scripts
next to the clients. A precedent exists: `packages/sdk` and `packages/sdk-python` are mirrored to public repos
by `.github/workflows/sync-sdk-{ts,py}.yml` (history-free snapshot, force-pushed, tagged). No secret scanner
was configured anywhere.

## Decision

1. **Licence.** Apache-2.0 (patent grant, NOTICE mechanism) for `apps/phone-android`, `apps/desktop` (future),
   `packages/sdk`, `packages/sdk-python` and `docs/architecture/shared-sessions-protocol.md`. The two SDKs are
   MIT today; they move to Apache-2.0 at their next major (MIT→Apache is additive for users, no relicensing
   consent needed since one copyright holder). Copyright holder: Dragos Catalin Vladulescu.
2. **Mechanism: subtree sync, not a monorepo split.** One workflow per public repo, modelled on
   `sync-sdk-ts.yml`: `sync-phone.yml` → `dragoscv/codai-phone`, later `sync-desktop.yml` →
   `dragoscv/codai-desktop`, `sync-protocol.yml` → `dragoscv/codai-protocol`. Snapshot = rsync of the subtree +
   the public protocol doc + the relevant ADRs, no history, tagged with the app `versionName`. Development stays
   in the monorepo; the public repos accept issues and PRs, which are applied back by hand (DCO sign-off).
   All sync workflows are `workflow_dispatch` only with `dry_run` defaulting to true.
3. **What stays private and why.** `apps/gateway` (routing tables, tier clamps, spend caps, provider adapters —
   the commercial core and the abuse surface), `apps/auth`/`apps/mgmt` (OIDC + billing), `packages/providers`
   (upstream translation, model capability tables), `packages/db` (schema of `usage_events`, pricing, keys),
   `scripts/training`, `deploy/`, `terraform/`, `plan/`, `bench/`, `packages/db/src/scripts` (forensics).
   Public repos must not reference GCP project ids, bucket names, Cloud SQL IPs or secret names.
4. **Secret scanning becomes mandatory.** `.gitleaks.toml` (default rules + allowlist for lockfiles, fixtures,
   public OAuth ids) and `.github/workflows/secret-scan.yml` (range scan on push/PR, full history weekly).
   Every sync workflow runs gitleaks over the subtree's full history **and** over the staged snapshot before
   pushing, plus the internal-reference grep inherited from `sync-sdk-ts.yml`.
5. **Configuration over constants.** Anything a self-hoster must change is a Gradle property / settings entry,
   never a Kotlin literal: OAuth client ids via `local.defaults.properties` → `BuildConfig`, gateway URL via
   Settings → Advanced, Firebase via an optional `google-services.json`.

## Prerequisites checklist (per public repo, before the first non-dry-run sync)

- [ ] `gitleaks git --log-opts="-- <subtree>"` over the full monorepo history: 0 findings (or each finding
      rotated and documented). Note: the mirror is history-free, but a leaked value in history proves the
      subtree once contained it — rotate anyway.
- [ ] `LICENSE` (Apache-2.0 full text), `NOTICE` (third-party attributions + trademark line), `README.md`,
      `CONTRIBUTING.md` (DCO, conventional commits, how to run tests), `SECURITY.md` (security@codai.ro,
      90-day coordinated disclosure) present in the subtree.
- [ ] SPDX header `// SPDX-License-Identifier: Apache-2.0` on new source files; a one-time sweep of existing
      files is done in the same commit that flips `dry_run` off (no functional diff, easy to review).
- [ ] CLA-free: DCO sign-off enforced by a DCO GitHub App on the public repo; no CLA bot.
- [ ] Telemetry statement in the README: what leaves the device, under which setting, opt-in for anything
      not required to serve the request (session sync is a user toggle; there is no analytics SDK).
- [ ] Trademark note in `NOTICE`/README: "codai" is a trademark; forks rename + change `applicationId`.
- [x] The mirror guard (`scripts/ops/mirror-public.ps1`, `.github/workflows/sync-*.yml`) greps the staged
      snapshot for internal GCP project ids, bucket URIs, database hosts/secrets and cloud-SQL socket paths →
      must be zero hits. Internal comments naming ops scripts are rewritten to describe behaviour.
- [ ] Public repo created (empty, default branch `main`, issues on, wiki off, branch protection on `main`,
      secret scanning + push protection enabled on the GitHub side), fine-grained PAT stored as
      `PHONE_MIRROR_TOKEN` (contents:write on that single repo).
- [ ] A dry-run of the sync workflow is green; the staged tree builds with `gradlew :app:assembleRelease`
      on a clean runner (no `local.properties`, no keystore, no `google-services.json`).

## Risks and mitigations

- **Leaking gateway internals through shared types.** The phone must depend only on the public protocol doc.
  It must never import `packages/db` schema types, `packages/providers` capability tables or gateway route
  code — today it does not (OkHttp + kotlinx.serialization against JSON shapes). Guard: the sync stage contains
  only the subtree; any build that needs a monorepo path fails on the clean runner (checklist last item). For
  the desktop client (TS), enforce with an ESLint `no-restricted-imports` rule on `@codai/db`, `@codai/providers`.
- **Public protocol doc drifting from the gateway.** The doc is the contract; gateway route tests assert the
  documented shapes (`parseSessionInfo`, `parseControl` fixtures shared by phone unit tests). A change to the
  protocol lands in the doc in the same commit.
- **Undocumented Copilot token exchange (`copilot_internal/v2/token`).** Already flagged in code and UI as a
  ToS risk; publishing it makes it more visible. Keep the warning, keep it opt-in, do not ship a default-on
  Copilot provider.
- **Force-push mirror erases public contributor history.** Same trade-off already accepted for the SDKs;
  contributors are credited in the monorepo commit (`Co-authored-by`) and in the public release notes.
- **Bundled `codai-terminal.apk` in assets.** Build output, gitignored, explicitly excluded from the stage;
  the `:terminal` module source is Apache-2.0 (Termux terminal-emulator/-view are Apache-2.0; the GPL-3.0
  Termux app itself is not redistributed — only its bootstrap is downloaded at runtime).
- **On-device model licences.** `codai-nano` derives from Gemma 4 — distributed from GCS under the Gemma
  Terms, never committed; README says so.

## Alternatives rejected

- **Split the monorepo into public/private repos.** Breaks the pnpm/Turborepo graph, doubles CI, and the daily
  workflow is many agents in one clone; a subtree mirror costs one YAML per surface.
- **`git subtree split` with history.** Would publish the full commit history of the subtree, including every
  leaked path in commit messages and every internal reference later scrubbed; the history-free snapshot is
  safer and matches the SDK precedent.
- **MIT for the clients.** No explicit patent grant and no NOTICE mechanism; Apache-2.0 also matches HIDE
  (the E2E protocol the clients will embed).
- **CLA.** Friction for drive-by fixes; the DCO plus Apache-2.0 §5 gives the same inbound=outbound assurance.
