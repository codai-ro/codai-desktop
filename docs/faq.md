# FAQ

### Is it safe to let an AI run commands on my computer?

It never runs a command silently. The first time in a session that codai wants
to run a shell command, write a file, or do anything in the browser, an ask
card appears and nothing happens until you answer. **Deny** is the default for
anything that isn't a clear yes. Output is capped (64 KB per stream) and every
command has a timeout (30 s by default, 10 minutes at most), so a runaway
command is killed together with any processes it started.

That said, if you click **Allow**, the command really runs with your user's
permissions — read the card before approving, exactly as you would read a
script before pasting it into a terminal.

### Which folders can it touch?

Only the **approved folders** listed in _Settings → Executor_. If you have not
set any, that is your home folder. Paths are canonicalised before use, so `..`
tricks and symlinks that point outside an approved folder are rejected. Reads
are capped at 512 KB, writes at 2 MB, and listings at 500 entries.

### Does it need Chrome?

Only if you ask it to use a browser. It looks for Microsoft Edge or Google
Chrome in the usual install locations; you can set a path yourself in
Settings. It launches the browser with its **own profile folder** inside the
app's data directory, so your personal tabs, cookies and saved passwords are
never touched. If no browser is found, browser tools simply fail and codai is
told so.

### What does it cost?

The desktop app is free and open source (Apache-2.0). Running the model costs
whatever your codai account is billed — every session shows a **cost card**
with the amount so far, broken down by model. Time limits (budgets) in
Settings help keep a stuck task from spending more than you meant.

### Does it work offline?

No. The thinking happens on the codai gateway, so you need a network connection
to it. If the connection drops during a live session, the app reconnects and
resumes the transcript from where it left off.

### How do I stop it?

Press **Esc** or click **Stop** — the current turn is cancelled and, if this
computer held the lease, the lease is released. Closing the window releases the
lease too. From another device, an editor or owner can send **cancel**.

### What is a "lease"?

A session can be viewed by several devices at once, but only one should be
_doing_ the work at a time. That device holds the **lease**. Clicking **Run
here** claims it for this computer; the app renews it every 10 seconds while
running and gives it back on Stop or close. If another device already holds
it, you'll see who, and can **Take over**.

### Why does a session say REMOTE?

Because the device executing that session is not this one — the work is
happening on your phone, another computer, or the console. You are watching a
live mirror. It flips to **LOCAL** when you click Run here and claim the lease.

### What is sent to the codai gateway?

Your messages, the conversation history the model needs, tool results (for
example the output of a command or the contents of a file codai asked to
read), and a copy of every step so your other devices can show the same
transcript. Your API key goes only to the gateway URL you configured, in an
`Authorization` header. There is no analytics or telemetry SDK in the app.

### How do updates work? Are they signed?

The app periodically fetches `https://releases.codai.ro/desktop/latest.json`.
If a newer version is listed, it downloads the installer and checks its
signature against a public key compiled into the app. An update that doesn't
verify is refused. You can check a downloaded file yourself — see
[release.md](release.md).

### Can I use my own (self-hosted) gateway?

Yes. On first run, or later in _Settings_, set the gateway base URL. The app is
built to allow `https://*.codai.ro` plus `http://localhost` and
`http://127.0.0.1` for local development; for another domain you need to widen
the `http:default` scope in `src-tauri/capabilities/default.json` and build
the app yourself.

### Where is my key stored?

In `secrets.json` inside the app's data directory, written and read only by
the app's `secret_*` commands. It is never written to logs. Use **Settings →
Sign out** to remove it, or **Replace key** to swap it.

### Which roles exist, and who can do what?

- **Owner** — everything: watch, send, answer, cancel, and **Run here**.
- **Editor** — watch, send, answer, cancel.
- **Viewer** — watch only; controls are shown disabled with the reason.

Roles are assigned when a session is shared from the web console.

### Something ran on my computer that I didn't start. Why?

Most likely a task was **dispatched** to this desktop from your phone or the
console — the app checks for those every 30 seconds and runs them. Every step
is in the session transcript. If you don't want that, turn off _Settings →
Executor → "Run tasks dispatched to this device"_. If you don't recognise the
session at all, revoke unknown devices in **Devices** and rotate your key in
the console.

### Which platforms are supported?

Windows today (x64 installer). macOS and Linux builds are configured but not
yet produced or tested — see the README roadmap.
