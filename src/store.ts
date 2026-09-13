// SPDX-License-Identifier: Apache-2.0
import { create } from 'zustand';
import { executors } from './executor/executor';
import { errorMessage, listDevices, normalizeBaseUrl, type GatewayAuth } from './lib/gateway';
import {
  clearApiKey,
  deviceInfo,
  DEFAULT_BUDGETS,
  getApiKey,
  loadSettings,
  saveSettings,
  setApiKey,
  type DeviceInfo,
  type Settings,
} from './lib/native';

export type Route =
  | { name: 'onboarding' }
  | { name: 'sessions' }
  | { name: 'session'; id: string }
  | { name: 'devices' }
  | { name: 'settings' };

interface AppState {
  booted: boolean;
  device: DeviceInfo | null;
  settings: Settings;
  apiKey: string | null;
  route: Route;
  toast: { kind: 'ok' | 'err'; text: string; at: number } | null;

  boot: () => Promise<void>;
  navigate: (r: Route) => void;
  auth: () => GatewayAuth | null;
  /** Validate a pasted key with GET /v1/devices, persist it on success. */
  signIn: (key: string, gatewayUrl?: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  notify: (kind: 'ok' | 'err', text: string) => void;
  /** (Re)configure the executor registry + dispatch poller from current auth/settings. */
  syncExecutor: () => void;
}

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  device: null,
  settings: {
    gatewayUrl: 'https://ai.codai.ro',
    deviceName: '',
    fsRoots: [],
    browserPath: '',
    budgets: { ...DEFAULT_BUDGETS },
    model: 'codai',
    autoDispatch: true,
  },
  apiKey: null,
  route: { name: 'onboarding' },
  toast: null,

  async boot() {
    const device = await deviceInfo();
    const settings = await loadSettings(device.hostname);
    const apiKey = await getApiKey();
    set({
      booted: true,
      device,
      settings,
      apiKey,
      route: apiKey ? { name: 'sessions' } : { name: 'onboarding' },
    });
    get().syncExecutor();
  },

  navigate(route) {
    set({ route });
  },

  auth() {
    const { apiKey, device, settings } = get();
    if (!apiKey || !device) return null;
    return {
      baseUrl: settings.gatewayUrl,
      apiKey,
      deviceId: device.id,
      deviceName: settings.deviceName || device.hostname,
    };
  },

  async signIn(key, gatewayUrl) {
    const { device, settings } = get();
    if (!device) return 'Device not initialised';
    const trimmed = key.trim();
    if (!/^codai_[A-Za-z0-9]{16,}$/.test(trimmed)) return 'That does not look like a codai key.';
    const baseUrl = normalizeBaseUrl(gatewayUrl ?? settings.gatewayUrl);
    try {
      await listDevices({
        baseUrl,
        apiKey: trimmed,
        deviceId: device.id,
        deviceName: settings.deviceName || device.hostname,
      });
    } catch (e) {
      return errorMessage(e);
    }
    await setApiKey(trimmed);
    const nextSettings = { ...settings, gatewayUrl: baseUrl };
    await saveSettings(nextSettings);
    set({ apiKey: trimmed, settings: nextSettings, route: { name: 'sessions' } });
    get().syncExecutor();
    return null;
  },

  async signOut() {
    await executors.stopAll();
    await clearApiKey();
    set({ apiKey: null, route: { name: 'onboarding' } });
  },

  async updateSettings(patch) {
    const next = { ...get().settings, ...patch };
    if (patch.gatewayUrl !== undefined) next.gatewayUrl = normalizeBaseUrl(patch.gatewayUrl);
    await saveSettings(next);
    set({ settings: next });
    get().syncExecutor();
  },

  notify(kind, text) {
    set({ toast: { kind, text, at: Date.now() } });
  },

  syncExecutor() {
    const auth = get().auth();
    const { device, settings } = get();
    if (!auth || !device) {
      executors.stopPolling();
      return;
    }
    executors.configure({
      auth,
      settings,
      device: { os: device.os, hostname: device.hostname },
      notify: (k, t) => get().notify(k, t),
    });
    if (settings.autoDispatch) executors.startPolling(30_000);
    else executors.stopPolling();
  },
}));
