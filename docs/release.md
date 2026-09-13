# Releases and updates

How codai desktop is released, how the auto-updater decides what to install,
and how you can check a download yourself.

## Where releases come from

- Installers are published as GitHub releases tagged `desktop-v<version>`,
  with three assets: the installer, its `.sig`, and `latest.json`.
- The updater endpoint `https://releases.codai.ro/desktop/latest.json` is a
  small proxy that serves the newest non-pre-release. Pre-releases are
  skipped, which is also how a bad release is rolled back (it is marked
  pre-release or deleted, and the previous one becomes "latest" again).
- Builds are made locally by a maintainer, not in CI. Currently only the
  Windows x64 NSIS installer is produced; macOS (`.dmg`) and Linux
  (`.AppImage`, `.deb`) are configured but unbuilt.

## How the updater decides

1. The app fetches `latest.json`:

   ```json
   {
     "version": "0.1.1",
     "notes": "…",
     "pub_date": "2026-09-13T12:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<contents of the .sig file>",
         "url": "https://releases.codai.ro/desktop/download/codai_0.1.1_x64-setup.exe"
       }
     }
   }
   ```

2. If `version` is newer than the running app, it downloads `url`.
3. It verifies `signature` against the **public key compiled into the app**
   (`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`). A file whose
   signature does not match is refused.
4. With a valid signature it runs the installer. The updater only moves
   forward — it never downgrades.

The private half of that key never leaves the maintainer's machine. Losing it
would orphan every installed client, so it is backed up offline.

## Verify a download yourself

The `.sig` files are [minisign](https://jedisct1.github.io/minisign/)
signatures (that is what `tauri signer` produces; the Tauri CLI itself can
only _sign_, not verify, so you use the `minisign` tool).

1. Download the installer and its `.sig` from the same release.
2. Copy the public key from `src-tauri/tauri.conf.json` →
   `plugins.updater.pubkey`. It is base64-encoded; decode it to get the
   two-line minisign public key:

   ```sh

   ```

# Linux/macOS

echo "<pubkey>" | base64 -d > codai-desktop.pub

````

```powershell
# Windows
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("<pubkey>")) | Set-Content codai-desktop.pub
````

The `.sig` is base64 too; decode it the same way to
`codai_<ver>_x64-setup.exe.minisig`. 3. Install minisign (`winget install minisign`, `brew install minisign`, or
your distro's package) and run:

```sh
minisign -Vm codai_<ver>_x64-setup.exe -p codai-desktop.pub -x codai_<ver>_x64-setup.exe.minisig
```

`Signature and comment signature verified` means the file is the one we
signed. Anything else means it is not — don't run it, and please tell us
at security@codai.ro.

## For maintainers

The maintainer runbook (version bump in lockstep across `package.json`,
`tauri.conf.json` and `Cargo.toml`; `pnpm tauri build --bundles nsis` with
`TAURI_SIGNING_PRIVATE_KEY`; changelog; `latest.json`; `gh release create`)
lives in the main codai repository and is not duplicated here. The key
invariants are:

- A build with `createUpdaterArtifacts: true` and no
  `TAURI_SIGNING_PRIVATE_KEY` fails with _"A public key has been found, but no
  private key"_. That is the guard working, not a bug.
- The three version files must agree, and must match what is actually
  published.
- After publishing, `curl https://releases.codai.ro/desktop/latest.json` must
  return the new version (edge cache is up to 5 minutes).
