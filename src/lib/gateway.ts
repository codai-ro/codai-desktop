// SPDX-License-Identifier: Apache-2.0
/**
 * Gateway client for the shared-sessions protocol.
 *
 * Transport: `@tauri-apps/plugin-http` `fetch`. The request runs in the Rust
 * process (reqwest), so (1) the WebView's CORS/CSP do not apply — the gateway
 * does not need to allow the `http://tauri.localhost` origin, and (2) the
 * `Authorization` header can be set on a streaming GET, which `EventSource`
 * cannot do. The plugin's `Response.body` is a real `ReadableStream` pulled
 * chunk-by-chunk over IPC (`plugin:http|fetch_read_body`), so SSE works on
 * WebView2 without buffering the whole body. Allowed origins are enforced by
 * the `http:default` scope in `src-tauri/capabilities/default.json`.
 *
 * Under `vite dev` in a plain browser (no Tauri) we fall back to
 * `window.fetch` so the UI can be developed against a local gateway.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from './native';
import type {
  ControlFrame,
  ControlRequest,
  ControlResult,
  LeaseFrame,
  OutgoingEvent,
  PendingControl,
  PresenceEntry,
  SessionDetail,
  SessionListRow,
  WireDevice,
  WireEvent,
  WireReceipt,
} from './types';

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface GatewayAuth {
  baseUrl: string;
  apiKey: string;
  deviceId: string;
  deviceName: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function headers(auth: GatewayAuth, extra?: Record<string, string>): Record<string, string> {
  if (!UUID_RE.test(auth.deviceId)) throw new Error('device id must be a UUID');
  return {
    authorization: `Bearer ${auth.apiKey}`,
    'x-codai-device': auth.deviceId,
    'x-codai-device-platform': 'desktop',
    'x-codai-device-name': auth.deviceName.slice(0, 120) || 'codai desktop',
    ...extra,
  };
}

const doFetch: typeof globalThis.fetch = (input, init) =>
  isTauri() ? tauriFetch(input as string | URL | Request, init) : globalThis.fetch(input, init);

async function request<T>(
  auth: GatewayAuth,
  path: string,
  opts: { method?: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT'; body?: unknown } = {},
): Promise<T> {
  const resp = await doFetch(`${normalizeBaseUrl(auth.baseUrl)}${path}`, {
    method: opts.method ?? 'GET',
    headers: headers(auth, opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!resp.ok) throw await toError(resp);
  const text = await resp.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function toError(resp: Response): Promise<GatewayError> {
  const text = await resp.text().catch(() => '');
  let code = 'gateway_error';
  let message = text.slice(0, 300) || `gateway responded ${resp.status}`;
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (parsed.error?.code) code = parsed.error.code;
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    /* not JSON */
  }
  return new GatewayError(resp.status, code, message);
}

export function errorMessage(err: unknown): string {
  if (err instanceof GatewayError) return `${err.message} (${err.code})`;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ── Devices ────────────────────────────────────────────────────────────────

export async function listDevices(auth: GatewayAuth): Promise<WireDevice[]> {
  const r = await request<{ devices: WireDevice[] }>(auth, '/v1/devices');
  return r.devices;
}

export function revokeDevice(auth: GatewayAuth, id: string): Promise<void> {
  return request(auth, `/v1/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function listSessions(
  auth: GatewayAuth,
): Promise<{ mine: SessionListRow[]; shared: SessionListRow[] }> {
  const [own, shared] = await Promise.all([
    request<{ sessions: SessionListRow[] }>(auth, '/v1/sessions?v=2&limit=200'),
    request<{ sessions: SessionListRow[] }>(auth, '/v1/sessions/shared-with-me'),
  ]);
  return { mine: own.sessions.filter((s) => s.role === 'owner'), shared: shared.sessions };
}

export function getSession(auth: GatewayAuth, id: string): Promise<SessionDetail> {
  return request(auth, `/v1/sessions/${encodeURIComponent(id)}?v=2`);
}

export function getEvents(
  auth: GatewayAuth,
  id: string,
  after = 0,
): Promise<{ last_seq: number; events: WireEvent[] }> {
  return request(auth, `/v1/sessions/${encodeURIComponent(id)}/events?after=${after}&limit=1000`);
}

export function sendControl(
  auth: GatewayAuth,
  id: string,
  control: ControlRequest,
): Promise<ControlResult> {
  return request(auth, `/v1/sessions/${encodeURIComponent(id)}/control`, {
    method: 'POST',
    body: control,
  });
}

export function getReceipt(auth: GatewayAuth, sessionRef: string): Promise<WireReceipt> {
  return request(auth, `/v1/receipt?session_id=${encodeURIComponent(sessionRef)}`);
}

// ── Executor: lease / events / controls ────────────────────────────────────

export interface LeaseResult {
  session_id: string;
  device_id: string;
  expires_at: string;
}

/** `POST /lease` — 409 `lease_held` when another device holds it (see `leaseHolderFromError`). */
export function claimLease(auth: GatewayAuth, id: string, force = false): Promise<LeaseResult> {
  return request(auth, `/v1/sessions/${encodeURIComponent(id)}/lease`, {
    method: 'POST',
    body: { device_id: auth.deviceId, ...(force ? { force: true } : {}) },
  });
}

export function heartbeatLease(auth: GatewayAuth, id: string): Promise<LeaseResult> {
  return request(auth, `/v1/sessions/${encodeURIComponent(id)}/lease`, { method: 'PUT' });
}

export function releaseLease(auth: GatewayAuth, id: string): Promise<{ released: boolean }> {
  return request(auth, `/v1/sessions/${encodeURIComponent(id)}/lease`, { method: 'DELETE' });
}

/** The gateway puts `holder_device_id=<uuid>` in the 409 message (details are not forwarded). */
export function leaseHolderFromError(err: unknown): string | null {
  if (!(err instanceof GatewayError)) return null;
  const m = /holder_device_id=([0-9a-f-]{36})/i.exec(err.message);
  return m?.[1] ?? null;
}

export function appendEvents(
  auth: GatewayAuth,
  id: string,
  events: OutgoingEvent[],
): Promise<{ last_seq: number; accepted: number }> {
  return request(auth, `/v1/sessions/${encodeURIComponent(id)}/events`, {
    method: 'POST',
    body: { events },
  });
}

export function listControls(
  auth: GatewayAuth,
  id: string,
  opts: { applied?: boolean; target?: 'me' | string } = {},
): Promise<{ controls: PendingControl[] }> {
  const q = new URLSearchParams();
  q.set('applied', opts.applied ? '1' : '0');
  if (opts.target) q.set('target', opts.target);
  return request(auth, `/v1/sessions/${encodeURIComponent(id)}/controls?${q.toString()}`);
}

export function markControlApplied(
  auth: GatewayAuth,
  id: string,
  controlId: string,
): Promise<{ id: string; applied: boolean }> {
  return request(
    auth,
    `/v1/sessions/${encodeURIComponent(id)}/control/${encodeURIComponent(controlId)}/applied`,
    { method: 'POST' },
  );
}

// ── Inference (same gateway, same key) ─────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
}

export interface ChatResult {
  message: ChatMessage;
  usage: ChatUsage | null;
  costMicroUsd: number | null;
  routedTo: string | null;
}

export interface ChatStreamHandlers {
  onDelta?: (text: string) => void;
  onToolStart?: (id: string, name: string) => void;
}

/**
 * `POST /v1/chat/completions` (OpenAI wire, streaming, tools) — same request
 * shape as the phone's `OpenAiWire` (provider/Wire.kt): `x-codai-client`,
 * `x-codai-cache: 1`, `x-codai-session-id`, `stream_options.include_usage`.
 */
export async function chatCompletion(
  auth: GatewayAuth,
  req: {
    model: string;
    messages: ChatMessage[];
    tools: ChatToolDef[];
    sessionKey: string;
    effort?: string;
  },
  handlers: ChatStreamHandlers,
  signal: AbortSignal,
): Promise<ChatResult> {
  const resp = await doFetch(`${normalizeBaseUrl(auth.baseUrl)}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: headers(auth, {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-codai-client': 'desktop/0.1.0',
      'x-codai-cache': '1',
      'x-codai-session-id': req.sessionKey,
      ...(req.effort ? { 'x-codai-effort': req.effort } : {}),
    }),
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      ...(req.tools.length ? { tools: req.tools } : {}),
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!resp.ok) throw await toError(resp);
  const costRaw = resp.headers.get('x-codai-cost-micro-usd');
  const routedTo =
    resp.headers.get('x-codai-routed-to') ?? resp.headers.get('x-codai-upstream-model');
  const ct = resp.headers.get('content-type') ?? '';
  let message: ChatMessage;
  let usage: ChatUsage | null = null;
  if (ct.includes('text/event-stream') && resp.body) {
    const r = await readChatSse(resp.body, handlers);
    message = r.message;
    usage = r.usage;
  } else {
    const json = (await resp.json()) as {
      choices?: { message?: ChatMessage }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const m = json.choices?.[0]?.message;
    message = {
      role: 'assistant',
      content: m?.content ?? '',
      ...(m?.tool_calls ? { tool_calls: m.tool_calls } : {}),
    };
    if (m?.content) handlers.onDelta?.(m.content);
    usage = usageFrom(json.usage);
  }
  return {
    message,
    usage,
    costMicroUsd: costRaw ? Number(costRaw) : null,
    routedTo,
  };
}

function usageFrom(
  u:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      }
    | undefined,
): ChatUsage | null {
  if (!u) return null;
  return {
    prompt_tokens: u.prompt_tokens ?? 0,
    completion_tokens: u.completion_tokens ?? 0,
    cached_tokens: u.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

/** Parse OpenAI chat SSE (`data: {choices:[{delta:{content?, tool_calls?}}]}`) into one assistant message. */
export async function readChatSse(
  body: ReadableStream<Uint8Array>,
  handlers: ChatStreamHandlers,
): Promise<{ message: ChatMessage; usage: ChatUsage | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let usage: ChatUsage | null = null;
  const calls = new Map<number, ChatToolCall>();
  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk: {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
      choices?: {
        delta?: {
          content?: string | null;
          tool_calls?: {
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
      }[];
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.usage) usage = usageFrom(chunk.usage);
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      content += delta.content;
      handlers.onDelta?.(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      let cur = calls.get(idx);
      if (!cur) {
        cur = {
          id: tc.id ?? `call_${idx}`,
          type: 'function',
          function: { name: '', arguments: '' },
        };
        calls.set(idx, cur);
      }
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) {
        const first = cur.function.name === '';
        cur.function.name += tc.function.name;
        if (first) handlers.onToolStart?.(cur.id, cur.function.name);
      }
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        handleLine(buf.slice(0, nl).replace(/\r$/, ''));
        buf = buf.slice(nl + 1);
      }
    }
    if (buf) handleLine(buf);
  } finally {
    reader.releaseLock();
  }
  const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  return {
    message: {
      role: 'assistant',
      content: content || (toolCalls.length ? null : ''),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    usage,
  };
}

// ── SSE stream ─────────────────────────────────────────────────────────────

export type StreamFrame =
  | { t: 'event'; data: WireEvent }
  | { t: 'presence'; data: PresenceEntry & { online?: boolean } }
  | { t: 'lease'; data: LeaseFrame }
  | { t: 'control'; data: ControlFrame };

export interface StreamHandlers {
  onOpen: () => void;
  onFrame: (frame: StreamFrame) => void;
  /** Called once per disconnect; the caller decides whether to reconnect. */
  onClose: (err: Error | null) => void;
}

/**
 * Open `GET /v1/sessions/:id/stream?after=` and parse SSE frames until the
 * body ends or `signal` aborts. Resolves when the connection closes.
 */
export async function openStream(
  auth: GatewayAuth,
  id: string,
  after: number,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let resp: Response;
  try {
    resp = await doFetch(
      `${normalizeBaseUrl(auth.baseUrl)}/v1/sessions/${encodeURIComponent(id)}/stream?after=${after}`,
      { method: 'GET', headers: headers(auth, { accept: 'text/event-stream' }), signal },
    );
  } catch (e) {
    handlers.onClose(signal.aborted ? null : (e as Error));
    return;
  }
  if (!resp.ok) {
    handlers.onClose(await toError(resp));
    return;
  }
  if (!resp.body) {
    handlers.onClose(new Error('stream has no body'));
    return;
  }
  handlers.onOpen();

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let err: Error | null = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line; tolerate \r\n.
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const frame = parseSse(raw);
        if (frame) handlers.onFrame(frame);
      }
    }
  } catch (e) {
    if (!signal.aborted) err = e as Error;
  } finally {
    reader.releaseLock();
  }
  handlers.onClose(err);
}

function parseSse(raw: string): StreamFrame | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join('\n'));
  } catch {
    return null;
  }
  switch (event) {
    case 'event':
      return { t: 'event', data: parsed as WireEvent };
    case 'presence':
      return { t: 'presence', data: parsed as PresenceEntry };
    case 'lease':
      return { t: 'lease', data: parsed as LeaseFrame };
    case 'control':
      return { t: 'control', data: parsed as ControlFrame };
    default:
      return null;
  }
}
