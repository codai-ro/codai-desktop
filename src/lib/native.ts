// SPDX-License-Identifier: Apache-2.0
/**
 * Thin wrappers over the Rust commands and the settings store. Everything
 * that touches Tauri IPC lives here so the rest of the UI stays plain React
 * (and can run under `vite dev` in a browser with a stub, see `isTauri`).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { load, type Store } from '@tauri-apps/plugin-store';

export interface DeviceInfo {
  id: string;
  hostname: string;
  os: string;
  arch: string;
  app_version: string;
}

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const API_KEY_SECRET = 'gateway_api_key';

export async function deviceInfo(): Promise<DeviceInfo> {
  if (!isTauri()) {
    // Browser dev fallback: stable per-profile UUID in localStorage.
    const k = 'codai.desktop.dev.deviceId';
    let id = localStorage.getItem(k);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(k, id);
    }
    return { id, hostname: 'browser-dev', os: 'web', arch: 'unknown', app_version: 'dev' };
  }
  return invoke<DeviceInfo>('device_info');
}

export async function getApiKey(): Promise<string | null> {
  if (!isTauri()) return sessionStorage.getItem(API_KEY_SECRET);
  return invoke<string | null>('secret_get', { name: API_KEY_SECRET });
}

export async function setApiKey(value: string): Promise<void> {
  if (!isTauri()) {
    sessionStorage.setItem(API_KEY_SECRET, value);
    return;
  }
  await invoke('secret_set', { name: API_KEY_SECRET, value });
}

export async function clearApiKey(): Promise<void> {
  if (!isTauri()) {
    sessionStorage.removeItem(API_KEY_SECRET);
    return;
  }
  await invoke('secret_delete', { name: API_KEY_SECRET });
}

// ── Settings (non-secret) ─────────────────────────────────────────────────

export interface Settings {
  gatewayUrl: string;
  deviceName: string;
  /** Executor: directories `fs_*` may touch (canonicalised by Rust). Empty = home dir. */
  fsRoots: string[];
  /** Executor: override for the Edge/Chrome executable (empty = autodetect). */
  browserPath: string;
  /** Executor wall-clock budgets in ms (0 disables), same semantics as the phone. */
  budgets: Budgets;
  /** Model alias for local turns; `codai` is the only public one. */
  model: string;
  /** Auto-claim dispatch targeted at this device (`GET /controls?target=me`). */
  autoDispatch: boolean;
}

export interface Budgets {
  requestMs: number;
  toolMs: number;
  turnMs: number;
}

export const DEFAULT_BUDGETS: Budgets = { requestMs: 60_000, toolMs: 30_000, turnMs: 600_000 };
export const DEFAULT_GATEWAY_URL = 'https://ai.codai.ro';

let storePromise: Promise<Store> | null = null;
const settingsStore = (): Promise<Store> => {
  storePromise ??= load('settings.json', { autoSave: true, defaults: {} });
  return storePromise;
};

const LS_SETTINGS = 'codai.desktop.dev.settings';

export async function loadSettings(defaultDeviceName: string): Promise<Settings> {
  const fallback: Settings = {
    gatewayUrl: DEFAULT_GATEWAY_URL,
    deviceName: defaultDeviceName,
    fsRoots: [],
    browserPath: '',
    budgets: { ...DEFAULT_BUDGETS },
    model: 'codai',
    autoDispatch: true,
  };
  if (!isTauri()) {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Settings>;
    return { ...fallback, ...p, budgets: { ...fallback.budgets, ...(p.budgets ?? {}) } };
  }
  const s = await settingsStore();
  const gatewayUrl = (await s.get<string>('gatewayUrl')) ?? fallback.gatewayUrl;
  const deviceName = (await s.get<string>('deviceName')) ?? fallback.deviceName;
  const fsRoots = (await s.get<string[]>('fsRoots')) ?? fallback.fsRoots;
  const browserPath = (await s.get<string>('browserPath')) ?? fallback.browserPath;
  const budgets = { ...fallback.budgets, ...((await s.get<Partial<Budgets>>('budgets')) ?? {}) };
  const model = (await s.get<string>('model')) ?? fallback.model;
  const autoDispatch = (await s.get<boolean>('autoDispatch')) ?? fallback.autoDispatch;
  return { gatewayUrl, deviceName, fsRoots, browserPath, budgets, model, autoDispatch };
}

export async function saveSettings(next: Settings): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(next));
    return;
  }
  const s = await settingsStore();
  await s.set('gatewayUrl', next.gatewayUrl);
  await s.set('deviceName', next.deviceName);
  // `fsRoots` / `browserPath` are also read by the Rust side (executor/fs.rs, browser.rs).
  await s.set('fsRoots', next.fsRoots);
  await s.set('browserPath', next.browserPath);
  await s.set('budgets', next.budgets);
  await s.set('model', next.model);
  await s.set('autoDispatch', next.autoDispatch);
  await s.save();
}

// ── Executor tool commands (Rust, ACL allow-listed in capabilities/default.json) ──

export interface ShellRunResult {
  code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timed_out: boolean;
  duration_ms: number;
}
export interface FsReadResult {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}
export interface FsWriteResult {
  path: string;
  bytes: number;
  created: boolean;
}
export interface FsListResult {
  path: string;
  entries: { name: string; kind: string; size: number }[];
  truncated: boolean;
}
export interface BrowserSnapshot {
  url: string;
  title: string;
  text: string;
  text_truncated: boolean;
  elements: { tag: string; text: string; selector: string }[];
  elements_truncated: boolean;
}
export interface BrowserLaunchResult {
  executable: string;
  port: number;
  already_running: boolean;
  version: string;
}
export interface BrowserDetectResult {
  executable: string | null;
  running: boolean;
}

function requireTauri(): void {
  if (!isTauri()) throw new Error('executor tools need the Tauri runtime');
}

export const tools = {
  shellRun(args: { cmd: string; cwd?: string; timeout_ms?: number }): Promise<ShellRunResult> {
    requireTauri();
    return invoke<ShellRunResult>('shell_run', { args });
  },
  fsRead(args: { path: string; max_bytes?: number }): Promise<FsReadResult> {
    requireTauri();
    return invoke<FsReadResult>('fs_read', { args });
  },
  fsWrite(args: { path: string; content: string }): Promise<FsWriteResult> {
    requireTauri();
    return invoke<FsWriteResult>('fs_write', { args });
  },
  fsList(args: { path: string }): Promise<FsListResult> {
    requireTauri();
    return invoke<FsListResult>('fs_list', { args });
  },
  fsRoots(): Promise<{ roots: string[] }> {
    if (!isTauri()) return Promise.resolve({ roots: [] });
    return invoke<{ roots: string[] }>('fs_roots');
  },
  browserLaunch(): Promise<BrowserLaunchResult> {
    requireTauri();
    return invoke<BrowserLaunchResult>('browser_launch');
  },
  browserDetect(): Promise<BrowserDetectResult> {
    if (!isTauri()) return Promise.resolve({ executable: null, running: false });
    return invoke<BrowserDetectResult>('browser_detect');
  },
  browserEval(args: { expression: string }): Promise<unknown> {
    requireTauri();
    return invoke<unknown>('browser_eval', { args });
  },
  browserNavigate(args: { url: string }): Promise<{ url: string; title: string }> {
    requireTauri();
    return invoke<{ url: string; title: string }>('browser_navigate', { args });
  },
  browserSnapshot(): Promise<BrowserSnapshot> {
    requireTauri();
    return invoke<BrowserSnapshot>('browser_snapshot');
  },
  browserClick(args: { selector: string }): Promise<unknown> {
    requireTauri();
    return invoke<unknown>('browser_click', { args });
  },
  browserType(args: { selector: string; text: string }): Promise<unknown> {
    requireTauri();
    return invoke<unknown>('browser_type', { args });
  },
};

export type ToolProgress = { tool: string; phase: 'start' | 'end' | 'error'; detail: string };

/** Subscribe to Rust `tool_progress` events; no-op outside Tauri. */
export async function onToolProgress(cb: (p: ToolProgress) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listen<ToolProgress>('tool_progress', (e) => cb(e.payload));
}
