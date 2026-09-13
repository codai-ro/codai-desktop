// SPDX-License-Identifier: Apache-2.0
/**
 * Executor lease for one session: claim on "Run here", heartbeat every 10 s
 * (TTL is 30 s server-side), release on stop/close. On a 409 (`lease_held`)
 * or 403 the holder drops to viewer and reports who has it.
 */
import {
  claimLease,
  GatewayError,
  heartbeatLease,
  leaseHolderFromError,
  releaseLease,
  type GatewayAuth,
} from '@/lib/gateway';

export type LeaseState =
  | { status: 'idle' }
  | { status: 'claiming' }
  | { status: 'held'; expiresAt: string }
  | { status: 'lost'; holderDeviceId: string | null; reason: string };

export interface LeaseOptions {
  heartbeatMs?: number;
  onChange?: (s: LeaseState) => void;
  /** Injected for tests. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

export class Lease {
  private state: LeaseState = { status: 'idle' };
  private timer: unknown = null;
  private readonly heartbeatMs: number;
  private readonly onChange: (s: LeaseState) => void;
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (h: unknown) => void;

  constructor(
    private readonly auth: GatewayAuth,
    private readonly sessionId: string,
    opts: LeaseOptions = {},
  ) {
    this.heartbeatMs = opts.heartbeatMs ?? 10_000;
    this.onChange = opts.onChange ?? (() => {});
    this.setIntervalFn = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalFn =
      opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  }

  get current(): LeaseState {
    return this.state;
  }

  get held(): boolean {
    return this.state.status === 'held';
  }

  private set(s: LeaseState): void {
    this.state = s;
    this.onChange(s);
  }

  /** Claim (optionally forcing). Returns true when this device now holds the lease. */
  async claim(force = false): Promise<boolean> {
    this.set({ status: 'claiming' });
    try {
      const r = await claimLease(this.auth, this.sessionId, force);
      this.set({ status: 'held', expiresAt: r.expires_at });
      this.startHeartbeat();
      return true;
    } catch (e) {
      this.stopHeartbeat();
      this.set(this.lostFrom(e));
      return false;
    }
  }

  private lostFrom(e: unknown): LeaseState {
    const holder = leaseHolderFromError(e);
    const reason =
      e instanceof GatewayError
        ? e.status === 409
          ? holder
            ? 'Another device is running this session.'
            : 'Lease expired.'
          : e.status === 403
            ? 'Only the session owner can run it.'
            : e.message
        : e instanceof Error
          ? e.message
          : String(e);
    return { status: 'lost', holderDeviceId: holder, reason };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.timer = this.setIntervalFn(() => void this.beat(), this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  /** One heartbeat; on 409/403 the lease is lost (no retry loop — a new claim is explicit). */
  async beat(): Promise<void> {
    if (this.state.status !== 'held') return;
    try {
      const r = await heartbeatLease(this.auth, this.sessionId);
      this.set({ status: 'held', expiresAt: r.expires_at });
    } catch (e) {
      if (e instanceof GatewayError && (e.status === 409 || e.status === 403 || e.status === 404)) {
        this.stopHeartbeat();
        this.set(this.lostFrom(e));
      }
      // Network blips: keep the timer; the server TTL (30 s) tolerates two misses.
    }
  }

  /** Release if held. Never throws. */
  async release(): Promise<void> {
    const wasHeld = this.state.status === 'held' || this.state.status === 'claiming';
    this.stopHeartbeat();
    this.set({ status: 'idle' });
    if (!wasHeld) return;
    try {
      await releaseLease(this.auth, this.sessionId);
    } catch {
      /* fail-open: the TTL expires it */
    }
  }

  /** Called when an SSE `lease` frame names another holder while we think we hold it. */
  observeHolder(holderDeviceId: string | null): void {
    if (this.state.status !== 'held') return;
    if (holderDeviceId && holderDeviceId !== this.auth.deviceId) {
      this.stopHeartbeat();
      this.set({
        status: 'lost',
        holderDeviceId,
        reason: 'Another device took over this session.',
      });
    }
  }
}
