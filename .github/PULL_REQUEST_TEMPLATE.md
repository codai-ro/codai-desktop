<!-- Thanks for contributing! Keep it small and focused; one logical change per PR. -->

## What does this change?

<!-- One or two sentences. Link the issue if there is one: "Closes #123". -->

## Why?

<!-- The problem it solves or the behaviour it improves. -->

## How did you test it?

<!-- Commands you ran, what you clicked, on which OS. Screenshots or a short GIF for UI changes (redact session content). -->

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] Tried it in `pnpm tauri dev`

## Checklist

- [ ] Commits are signed off (`git commit -s`) — DCO, see CONTRIBUTING.md
- [ ] Commit messages follow Conventional Commits (`type(scope): description`)
- [ ] No API key, `secrets.json`, or updater private key in the diff
- [ ] I did not widen the `http` capability scope or add commands to `capabilities/default.json` without explaining why below
- [ ] Docs (README / `docs/`) updated if behaviour or settings changed
- [ ] Platform-specific code is behind a `cfg(target_os)` guard

## Notes for reviewers

<!-- Anything unusual: new permissions, trade-offs, follow-ups you deliberately left out. -->
