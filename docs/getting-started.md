# Getting started with codai desktop

This guide is for anyone — no programming knowledge needed. It takes about five
minutes.

## 1. Get an API key

codai desktop talks to the codai service using a personal key that looks like
`codai_…`. Sign in at [codai.ro](https://codai.ro) and create a key in the
console. Treat it like a password: don't share it or paste it anywhere public.

## 2. Install the app

**Windows**

1. Open the [Releases](https://github.com/codai-ro/codai-desktop/releases)
   page and download `codai_<version>_x64-setup.exe`.
2. Double-click it. It installs only for your user account, so Windows should
   not ask for an administrator password.
3. Start **codai** from the Start menu.

**macOS / Linux**

Not available yet — only the Windows build has been produced and tested so far.
Watch the Releases page; the app is set up to ship `.dmg`, `.AppImage` and
`.deb` packages once they are built.

## 3. First launch

You will see a single screen asking for your key.

1. Paste your `codai_…` key and press **Continue**. The app checks it against
   the service and stores it locally, in a file only the app can read.
2. Leave the gateway URL alone unless someone running a private codai server
   told you to change it.
3. Optionally give this computer a name (e.g. "Work laptop"). It is what your
   other devices will see.

## 4. Your first task

1. Go to **Sessions** and create a new session (or open one you already have
   from the phone or console).
2. On a session you own, click **Run here**. The badge changes to **LOCAL** —
   this computer is now the one doing the work.
3. Type something in the box at the bottom, for example:

   > Find the biggest files in my Downloads folder and list them.

   and press **Ctrl+Enter** (**⌘+Enter** on a Mac).

4. codai will plan, then probably ask for permission to run a command. A card
   appears with three choices:
   - **Allow once** — run just this command.
   - **Always allow (this session)** — don't ask again for this kind of action
     until the session ends.
   - **Deny** — refuse; codai is told not to try again.
5. Watch the steps appear live. When it is done, the answer shows at the
   bottom and the cost card updates.

To stop at any time, press **Esc** or click **Stop**.

## 5. What it is allowed to touch

Open **Settings → Executor**:

- **Approved folders** — the only places codai can read or write files. By
  default this is your home folder. Add or remove folders to widen or narrow
  it.
- **Browser** — the app finds Edge or Chrome on its own. If it can't, point it
  to the browser's `.exe`. The browser always opens with a separate profile, so
  your own tabs and logins are never involved.
- **Budgets** — time limits for one request, one tool call and a whole turn.
  Leave them empty for no limit; the defaults are sensible.
- **Run tasks dispatched to this device** — when on, tasks you send from your
  phone or the console to this computer are picked up automatically (checked
  every 30 seconds). Turn it off if you'd rather start everything by hand.

## 6. Watching from (or on) another device

Sessions are shared. If codai is running something on your phone, open the same
session on the desktop: you'll see the transcript live with a **REMOTE** badge.
If you are an _editor_ or the _owner_, you can also send a message, answer a
question or cancel from here.

The reverse works too: from the phone or console, **dispatch** a task to this
desktop and it will run here.

## Next

- Stuck? See the [FAQ](faq.md).
- Curious how it works inside? See [architecture.md](architecture.md).
- Something looks wrong? [Open an issue](https://github.com/codai-ro/codai-desktop/issues/new/choose) —
  please redact anything private from screenshots.
