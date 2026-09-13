// SPDX-License-Identifier: Apache-2.0
/**
 * Wire types for the shared-sessions protocol v1
 * (docs/architecture/shared-sessions-protocol.md). Mirrors the console's
 * `lib/sessions-types.ts`; the desktop depends on the public document only.
 */

export type SessionRole = 'viewer' | 'editor' | 'owner';
export type DevicePlatform = 'android' | 'ios' | 'web' | 'desktop' | 'cli' | 'agent';
export type ControlKind = 'send' | 'answer' | 'approve' | 'deny' | 'cancel' | 'steer' | 'inject';

export interface WireSession {
  id: string;
  session_key: string;
  owner_user_id: string;
  title: string | null;
  created_at: string;
  last_event_at: string | null;
  last_seq: number;
  executor_device_id: string | null;
  lease_expires_at: string | null;
  e2e: boolean;
  archived: boolean;
}

export interface SessionListRow extends WireSession {
  role: SessionRole;
  presence_count?: number;
  share_id?: string;
}

export interface WireEvent {
  seq: number;
  kind: string;
  ts: number;
  sender_device_id: string | null;
  turn_id: string | null;
  client_event_id: string | null;
  payload: Record<string, unknown>;
}

export interface MemberDevice {
  device_id: string;
  name: string;
  platform: DevicePlatform;
  last_seen_at: string;
  remote: boolean;
}

export interface SessionMember {
  user_id: string;
  role: SessionRole;
  remote: boolean;
  devices: MemberDevice[];
}

export interface PresenceEntry {
  device_id: string;
  user_id: string;
  role: SessionRole;
  executor: boolean;
  remote: boolean;
  last_seen: number;
  driving: boolean;
  online?: boolean;
}

export interface WireLease {
  device_id: string;
  expires_at: string;
}

export interface SessionDetail extends WireSession {
  role: SessionRole;
  members: SessionMember[];
  lease: WireLease | null;
  presence: PresenceEntry[];
}

export interface WireDevice {
  id: string;
  name: string;
  platform: DevicePlatform;
  capabilities: string[];
  lastSeenAt: string;
  createdAt: string;
  has_push_token?: boolean;
}

export interface WireReceipt {
  events: number;
  tasks: number;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_read_tokens: number;
  cache_write_tokens: number;
  by_upstream: { upstream_model: string; events: number; cost_micro_usd: number }[];
}

export interface LeaseFrame {
  holder_device_id: string | null;
  expires_at: string | null;
}

export interface ControlFrame {
  id: string;
  kind: ControlKind;
  seq: number | null;
  applied: boolean;
  text?: string | null;
}

export interface ControlRequest {
  id: string;
  kind: ControlKind;
  text?: string;
  turn_id?: string;
  ask_id?: string;
}

export interface ControlResult {
  accepted: true;
  seq: number | null;
  duplicate?: boolean;
}

/** Event appended by the executor (`POST /events`); the server assigns `seq`. */
export interface OutgoingEvent {
  kind: string;
  ts: number;
  turn_id?: string;
  client_event_id: string;
  payload: Record<string, unknown>;
}

/** Row from `GET /controls?applied=false`. */
export interface PendingControl {
  id: string;
  kind: ControlKind;
  text: string | null;
  turn_id: string | null;
  ask_id: string | null;
  from_device_id: string | null;
  target_device_id: string | null;
  seq: number | null;
  applied: boolean;
  created_at: string;
}

const ROLE_RANK: Record<SessionRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function roleAtLeast(role: SessionRole | null | undefined, min: SessionRole): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Read a string field off an opaque event payload. */
export function payloadStr(p: Record<string, unknown>, key: string): string | null {
  const v = p[key];
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}
