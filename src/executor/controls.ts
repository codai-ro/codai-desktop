// SPDX-License-Identifier: Apache-2.0
/**
 * Control intake for the executor: drains `GET /controls?applied=false`, merges
 * live SSE `control` frames / `control` events, de-duplicates, skips controls
 * targeted at another device, and maps each kind onto executor verbs.
 *
 *   send            → start a turn
 *   answer          → resolve the pending ask
 *   approve / deny  → resolve the pending permission
 *   cancel          → abort the running turn
 *   steer / inject  → queue for the next step of the running turn
 *
 * Pure and synchronous apart from the `Verbs` callbacks, so it is unit-tested.
 */
import type { ControlKind, PendingControl, WireEvent } from '@/lib/types';

export interface ControlLike {
  id: string;
  kind: ControlKind;
  text?: string | null;
  turn_id?: string | null;
  ask_id?: string | null;
  from_device_id?: string | null;
  target_device_id?: string | null;
  applied?: boolean;
}

export interface Verbs {
  send(text: string, turnId: string | null): void;
  answer(text: string, askId: string | null): boolean;
  permission(ok: boolean, askId: string | null): boolean;
  cancel(): void;
  interject(text: string, steer: boolean): void;
}

export type Outcome =
  | 'applied'
  | 'skipped_target'
  | 'skipped_duplicate'
  | 'skipped_own'
  | 'ignored'
  | 'deferred';

export interface ControlRouterOptions {
  myDeviceId: string;
  /** Called after a control was applied so the caller can `POST …/applied`. */
  onApplied?: (id: string) => void;
  /** Ignore controls this device itself submitted (echo of the local composer). */
  skipOwn?: boolean;
}

export class ControlRouter {
  private readonly seen = new Set<string>();

  constructor(
    private readonly verbs: Verbs,
    private readonly opts: ControlRouterOptions,
  ) {}

  /** Mark ids seen without applying (e.g. history replay on connect). */
  remember(ids: Iterable<string>): void {
    for (const id of ids) this.seen.add(id);
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  /** Extract the control from a `control` event (`payload.control`, `payload.applied`). */
  static fromEvent(ev: WireEvent): ControlLike | null {
    if (ev.kind !== 'control') return null;
    const c = ev.payload['control'] as Partial<ControlLike> | undefined;
    if (!c || typeof c.id !== 'string' || typeof c.kind !== 'string') return null;
    return {
      id: c.id,
      kind: c.kind as ControlKind,
      text: c.text ?? null,
      turn_id: c.turn_id ?? null,
      ask_id: c.ask_id ?? null,
      from_device_id: c.from_device_id ?? ev.sender_device_id ?? null,
      target_device_id: c.target_device_id ?? null,
      applied: ev.payload['applied'] === true,
    };
  }

  static fromPending(p: PendingControl): ControlLike {
    return p;
  }

  /** Apply a batch in order; returns per-control outcomes. */
  applyAll(controls: ControlLike[]): Outcome[] {
    return controls.map((c) => this.apply(c));
  }

  apply(c: ControlLike): Outcome {
    if (c.applied) {
      this.seen.add(c.id);
      return 'skipped_duplicate';
    }
    if (this.seen.has(c.id)) return 'skipped_duplicate';
    if (c.target_device_id && c.target_device_id !== this.opts.myDeviceId) return 'skipped_target';
    if (this.opts.skipOwn && c.from_device_id === this.opts.myDeviceId && c.kind !== 'send') {
      this.seen.add(c.id);
      return 'skipped_own';
    }
    const text = (c.text ?? '').trim();
    let outcome: Outcome = 'applied';
    switch (c.kind) {
      case 'send':
        if (!text) outcome = 'ignored';
        else this.verbs.send(text, c.turn_id ?? null);
        break;
      case 'answer':
        if (!this.verbs.answer(text, c.ask_id ?? null)) outcome = 'deferred';
        break;
      case 'approve':
        if (!this.verbs.permission(true, c.ask_id ?? null)) outcome = 'deferred';
        break;
      case 'deny':
        if (!this.verbs.permission(false, c.ask_id ?? null)) outcome = 'deferred';
        break;
      case 'cancel':
        this.verbs.cancel();
        break;
      case 'steer':
        if (!text) outcome = 'ignored';
        else this.verbs.interject(text, true);
        break;
      case 'inject':
        if (!text) outcome = 'ignored';
        else this.verbs.interject(text, false);
        break;
      default:
        outcome = 'ignored';
    }
    // `deferred` = nothing was waiting for it; leave it unmarked so a later drain can retry.
    if (outcome !== 'deferred') {
      this.seen.add(c.id);
      if (outcome === 'applied' || outcome === 'ignored') this.opts.onApplied?.(c.id);
    }
    return outcome;
  }
}
