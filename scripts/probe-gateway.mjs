#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Live probe of the desktop's HTTP layer against the real gateway.
 *
 * Mirrors the request shapes in `src/lib/gateway.ts` (headers, paths, bodies)
 * using plain Node `fetch` — the app itself goes through
 * `@tauri-apps/plugin-http`, but the wire is identical, so a 2xx here proves
 * the gateway contract the desktop depends on.
 *
 *   node apps/desktop/scripts/probe-gateway.mjs
 *   env: CODAI_GATEWAY (default https://ai.codai.ro)
 *        CODAI_KEY or CODAI_KEY_FILE (default ~/.codai/phone-key.txt)
 *
 * Flow: list sessions (v2) → create → claim lease → append 2 events → read
 * back → release → delete session → delete device. Exit 1 on any non-2xx.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const baseUrl = (process.env.CODAI_GATEWAY ?? 'https://ai.codai.ro').replace(/\/+$/, '');
const apiKey = (
  process.env.CODAI_KEY ??
  readFileSync(process.env.CODAI_KEY_FILE ?? join(homedir(), '.codai', 'phone-key.txt'), 'utf8')
).trim();
if (!apiKey.startsWith('codai_')) {
  console.error('key does not look like a codai_ key');
  process.exit(2);
}

const deviceId = randomUUID();
const sessionKey = `probe-desktop-${Date.now()}`;
const headers = (extra = {}) => ({
  authorization: `Bearer ${apiKey}`,
  'x-codai-device': deviceId,
  'x-codai-device-platform': 'desktop',
  'x-codai-device-name': 'probe-desktop',
  ...extra,
});

let failed = false;
async function step(label, path, init = {}) {
  const url = `${baseUrl}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: headers(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
  });
  const text = await resp.text();
  const ok = resp.status >= 200 && resp.status < 300;
  if (!ok) failed = true;
  console.log(`${ok ? 'OK ' : 'ERR'} ${String(resp.status).padEnd(3)} ${(init.method ?? 'GET').padEnd(6)} ${path}  ${label}`);
  if (!ok) console.log(`      ${text.slice(0, 300)}`);
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return text;
  }
}
const json = (method, body) => ({ method, body: JSON.stringify(body) });

console.log(`gateway=${baseUrl} device=${deviceId} session_key=${sessionKey}`);

const list = await step('list sessions v2', '/v1/sessions?v=2&limit=5');
console.log(`      sessions returned: ${list?.sessions?.length ?? '?'}`);

const created = await step('create session', '/v1/sessions', json('POST', { session_key: sessionKey, title: 'probe-desktop' }));
const sid = created?.session?.id ?? created?.id ?? sessionKey;
console.log(`      session id: ${sid}`);

await step('claim lease', `/v1/sessions/${sid}/lease`, json('POST', { device_id: deviceId }));

const turnId = randomUUID();
const now = Date.now();
await step(
  'append 2 events',
  `/v1/sessions/${sid}/events`,
  json('POST', {
    events: [
      { kind: 'turn_start', ts: now, turn_id: turnId, client_event_id: randomUUID(), payload: { text: 'probe' } },
      { kind: 'turn_end', ts: now + 1, turn_id: turnId, client_event_id: randomUUID(), payload: { ok: true } },
    ],
  }),
);

const events = await step('read events', `/v1/sessions/${sid}/events?after=0&limit=1000`);
const kinds = (events?.events ?? []).map((e) => e.kind);
console.log(`      events read back: ${kinds.join(',')} (last_seq=${events?.last_seq})`);
if (!kinds.includes('turn_start') || !kinds.includes('turn_end')) {
  failed = true;
  console.log('ERR events did not round-trip');
}

await step('release lease', `/v1/sessions/${sid}/lease`, { method: 'DELETE' });
await step('delete session', `/v1/sessions/${sid}`, { method: 'DELETE' });
await step('delete device', `/v1/devices/${deviceId}`, { method: 'DELETE' });

console.log(failed ? 'PROBE FAILED' : 'PROBE OK — all 2xx');
process.exit(failed ? 1 : 0);
