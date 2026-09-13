// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState, type FormEvent } from 'react';
import { FolderPlus, Loader2, LogOut, Save, X } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@/components/ui';
import { DEFAULT_BUDGETS, DEFAULT_GATEWAY_URL, isTauri, tools, type Budgets } from '@/lib/native';
import { useApp } from '@/store';

export function SettingsPage() {
  const { settings, device, apiKey, updateSettings, signIn, signOut, notify } = useApp();
  const [gatewayUrl, setGatewayUrl] = useState(settings.gatewayUrl);
  const [deviceName, setDeviceName] = useState(settings.deviceName);
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'key' | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    try {
      await updateSettings({ gatewayUrl, deviceName: deviceName.trim() || device?.hostname || '' });
      notify('ok', 'Settings saved');
    } finally {
      setBusy(null);
    }
  };

  const replaceKey = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('key');
    try {
      const err = await signIn(newKey, gatewayUrl);
      if (err) notify('err', err);
      else {
        notify('ok', 'API key updated');
        setNewKey('');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-base font-semibold">Settings</h1>

      <Card>
        <form onSubmit={save}>
          <CardHeader>
            <CardTitle>Gateway</CardTitle>
            <CardDescription>
              Self-hosters point this at their own gateway. Default {DEFAULT_GATEWAY_URL}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block space-y-1 text-xs">
              <span className="text-[color:var(--color-muted)]">Base URL</span>
              <Input
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                placeholder={DEFAULT_GATEWAY_URL}
                inputMode="url"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-[color:var(--color-muted)]">Device name</span>
              <Input
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={device?.hostname ?? 'this computer'}
                maxLength={120}
              />
            </label>
            <p className="font-mono text-[11px] text-[color:var(--color-muted)]">
              device id {device?.id ?? '—'} · {device?.os}/{device?.arch} · v{device?.app_version}
            </p>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={busy !== null}>
                {busy === 'save' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>

      <Card>
        <form onSubmit={replaceKey}>
          <CardHeader>
            <CardTitle>API key</CardTitle>
            <CardDescription>
              {apiKey
                ? `Stored: ${apiKey.slice(0, 10)}… (${apiKey.length} chars). Paste a new key to replace it; it is validated against /v1/devices first.`
                : 'No key stored.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="codai_…"
              autoComplete="off"
              spellCheck={false}
              aria-label="New API key"
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void signOut()}
                disabled={busy !== null || !apiKey}
              >
                <LogOut className="size-3.5" /> Sign out
              </Button>
              <Button type="submit" size="sm" disabled={busy !== null || !newKey.trim()}>
                {busy === 'key' ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Replace key
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>

      <ExecutorSettings />
    </div>
  );
}

function ExecutorSettings() {
  const { settings, updateSettings, notify } = useApp();
  const [roots, setRoots] = useState<string[]>(settings.fsRoots);
  const [effectiveRoots, setEffectiveRoots] = useState<string[]>([]);
  const [browserPath, setBrowserPath] = useState(settings.browserPath);
  const [detected, setDetected] = useState<{ executable: string | null; running: boolean } | null>(
    null,
  );
  const [budgets, setBudgets] = useState<Budgets>(settings.budgets);
  const [model, setModel] = useState(settings.model);
  const [autoDispatch, setAutoDispatch] = useState(settings.autoDispatch);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void tools
      .fsRoots()
      .then((r) => setEffectiveRoots(r.roots))
      .catch(() => {});
    void tools
      .browserDetect()
      .then(setDetected)
      .catch(() => {});
  }, [settings.fsRoots, settings.browserPath]);

  const addRoot = async () => {
    if (!isTauri()) {
      notify('err', 'Folder picker needs the desktop app');
      return;
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({
      directory: true,
      multiple: false,
      title: 'Allow this folder for the executor',
    });
    if (typeof picked === 'string' && picked && !roots.includes(picked))
      setRoots([...roots, picked]);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const b: Budgets = {
        requestMs: clampMs(budgets.requestMs),
        toolMs: clampMs(budgets.toolMs),
        turnMs: clampMs(budgets.turnMs),
      };
      await updateSettings({
        fsRoots: roots,
        browserPath: browserPath.trim(),
        budgets: b,
        model: model.trim() || 'codai',
        autoDispatch,
      });
      setBudgets(b);
      notify('ok', 'Executor settings saved');
    } finally {
      setBusy(false);
    }
  };

  const sec = (ms: number) => (ms <= 0 ? '' : String(Math.round(ms / 1000)));
  const fromSec = (v: string) => (v.trim() === '' ? 0 : Math.max(0, Number(v) || 0) * 1000);

  return (
    <Card>
      <form onSubmit={save}>
        <CardHeader>
          <CardTitle>Executor</CardTitle>
          <CardDescription>
            What the agent may touch when a session runs on this device. Shell, file writes and
            browser actions ask for approval the first time per session.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[color:var(--color-muted)]">
                Allowed folders (fs_read / fs_write / fs_list)
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => void addRoot()}>
                <FolderPlus className="size-3.5" /> Add folder
              </Button>
            </div>
            {roots.length === 0 ? (
              <p className="text-[color:var(--color-muted)]">
                None configured — the home directory is used
                {effectiveRoots[0] ? ` (${effectiveRoots[0]})` : ''}.
              </p>
            ) : (
              <ul className="space-y-1">
                {roots.map((r) => (
                  <li
                    key={r}
                    className="flex items-center gap-2 rounded-md border border-[color:var(--color-border)] px-2 py-1 font-mono text-[11px]"
                  >
                    <span className="min-w-0 flex-1 truncate" title={r}>
                      {r}
                    </span>
                    <button
                      type="button"
                      className="text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)]"
                      onClick={() => setRoots(roots.filter((x) => x !== r))}
                      aria-label={`Remove ${r}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="block space-y-1 text-xs">
            <span className="text-[color:var(--color-muted)]">
              Browser executable (empty = autodetect Edge/Chrome)
            </span>
            <Input
              value={browserPath}
              onChange={(e) => setBrowserPath(e.target.value)}
              placeholder={
                detected?.executable ??
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
              }
              spellCheck={false}
            />
            <span className="font-mono text-[11px] text-[color:var(--color-muted)]">
              {detected
                ? detected.executable
                  ? `detected: ${detected.executable}${detected.running ? ' · DevTools port 9333 open' : ''}`
                  : 'no browser detected'
                : ''}
            </span>
          </label>

          <div className="grid grid-cols-3 gap-2 text-xs">
            {(
              [
                ['requestMs', 'Request (s)'],
                ['toolMs', 'Tool (s)'],
                ['turnMs', 'Turn (s)'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="block space-y-1">
                <span className="text-[color:var(--color-muted)]">{label}</span>
                <Input
                  inputMode="numeric"
                  value={sec(budgets[k])}
                  onChange={(e) => setBudgets({ ...budgets, [k]: fromSec(e.target.value) })}
                  placeholder={sec(DEFAULT_BUDGETS[k])}
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-[color:var(--color-muted)]">
            Empty = no limit. Defaults {sec(DEFAULT_BUDGETS.requestMs)} /{' '}
            {sec(DEFAULT_BUDGETS.toolMs)} / {sec(DEFAULT_BUDGETS.turnMs)} s, as on the phone.
          </p>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="block space-y-1">
              <span className="text-[color:var(--color-muted)]">Model alias</span>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="codai"
                spellCheck={false}
              />
            </label>
            <label className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                checked={autoDispatch}
                onChange={(e) => setAutoDispatch(e.target.checked)}
                className="size-4"
              />
              <span>Run tasks dispatched to this device (poll every 30 s)</span>
            </label>
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save executor settings
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

function clampMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms, 6 * 60 * 60 * 1000);
}
