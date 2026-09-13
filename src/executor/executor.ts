// SPDX-License-Identifier: Apache-2.0
/**
 * `LocalExecutor` — one per session this device is running: owns the lease,
 * the event sink, the control router and the agent run. `ExecutorRegistry`
 * is the process-wide map (survives route changes) plus the dispatch poller:
 * on start and every 30 s it lists my sessions and, for any with controls
 * targeted at this device (`GET /controls?applied=false&target=me`), claims
 * the lease and runs them — the desktop equivalent of the phone's FCM wake.
 */
import {
  appendEvents,
  errorMessage,
  listControls,
  listSessions,
  markControlApplied,
  type GatewayAuth,
} from '@/lib/gateway';
import { tools as native, type Settings } from '@/lib/native';
import type { ControlFrame, WireEvent } from '@/lib/types';
import { AgentRun, systemPrompt } from './agent-run';
import { ControlRouter } from './controls';
import { EventSink } from './event-sink';
import { Lease, type LeaseState } from './lease';

export type { LeaseState };

export class LocalExecutor {
  readonly lease: Lease;
  readonly sink: EventSink;
  readonly run: AgentRun;
  readonly router: ControlRouter;
  private listeners = new Set<() => void>();
  private unsubs: (() => void)[] = [];
  private draining = false;

  constructor(
    readonly auth: GatewayAuth,
    readonly sessionId: string,
    readonly sessionKey: string,
    settings: Settings,
    device: { os: string; hostname: string },
    roots: string[],
  ) {
    this.sink = new EventSink((events) => appendEvents(auth, sessionId, events), {
      onError: (e) => console.warn('[executor] events post failed', errorMessage(e)),
    });
    this.lease = new Lease(auth, sessionId, { onChange: () => this.changed() });
    this.run = new AgentRun({
      auth,
      sessionKey,
      sink: this.sink,
      budgets: settings.budgets,
      model: settings.model || 'codai',
      system: systemPrompt({ os: device.os, hostname: device.hostname, roots }),
    });
    this.router = new ControlRouter(
      {
        send: (text, turnId) => this.run.send(text, turnId),
        answer: (text, askId) => this.run.answer(text, askId),
        permission: (ok, askId) => this.run.permission(ok, askId),
        cancel: () => this.run.cancel(),
        interject: (text, steer) => this.run.interject(text, steer),
      },
      {
        myDeviceId: auth.deviceId,
        onApplied: (id) => void markControlApplied(auth, sessionId, id).catch(() => {}),
      },
    );
    this.unsubs.push(this.run.subscribe(() => this.changed()));
    this.unsubs.push(this.run.asks.subscribe(() => this.changed()));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Claim the lease, then drain queued controls. Returns whether we are now the executor. */
  async start(force = false, priorControlIds: Iterable<string> = []): Promise<boolean> {
    this.router.remember(priorControlIds);
    const ok = await this.lease.claim(force);
    if (!ok) return false;
    await this.drain();
    return true;
  }

  /** `GET /controls?applied=false` → apply everything not aimed at another device. */
  async drain(): Promise<void> {
    if (this.draining || !this.lease.held) return;
    this.draining = true;
    try {
      const { controls } = await listControls(this.auth, this.sessionId, { applied: false });
      this.router.applyAll(controls.map(ControlRouter.fromPending));
    } catch (e) {
      console.warn('[executor] drain failed', errorMessage(e));
    } finally {
      this.draining = false;
    }
  }

  /** Live `control` event from the SSE stream. */
  onControlEvent(ev: WireEvent): void {
    if (!this.lease.held) return;
    const c = ControlRouter.fromEvent(ev);
    if (c) this.router.apply(c);
  }

  /** Bare `control` frame (`applied` flips) — nothing to run, but remember applied ids. */
  onControlFrame(f: ControlFrame): void {
    if (f.applied) this.router.remember([f.id]);
  }

  onLeaseFrame(holderDeviceId: string | null): void {
    this.lease.observeHolder(holderDeviceId);
    if (!this.lease.held && this.run.busy) this.run.cancel();
  }

  /** Stop the turn, release the lease, flush the sink. */
  async stop(): Promise<void> {
    this.run.cancel();
    await this.lease.release();
    await this.sink.close();
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}

// ── Registry + dispatch poller ─────────────────────────────────────────────

export interface RegistryDeps {
  auth: GatewayAuth;
  settings: Settings;
  device: { os: string; hostname: string };
  notify?: (kind: 'ok' | 'err', text: string) => void;
}

export class ExecutorRegistry {
  private readonly byId = new Map<string, LocalExecutor>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private deps: RegistryDeps | null = null;
  private polling = false;

  configure(deps: RegistryDeps): void {
    this.deps = deps;
  }

  get(sessionId: string): LocalExecutor | undefined {
    return this.byId.get(sessionId);
  }

  list(): LocalExecutor[] {
    return [...this.byId.values()];
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Create (or reuse) the executor for a session and claim the lease. */
  async runHere(sessionId: string, sessionKey: string, force = false): Promise<LocalExecutor> {
    if (!this.deps) throw new Error('executor not configured');
    let ex = this.byId.get(sessionId);
    if (!ex) {
      const roots = (await native.fsRoots().catch(() => ({ roots: [] as string[] }))).roots;
      ex = new LocalExecutor(
        this.deps.auth,
        sessionId,
        sessionKey,
        this.deps.settings,
        this.deps.device,
        roots,
      );
      this.byId.set(sessionId, ex);
      ex.subscribe(() => this.changed());
      this.changed();
    }
    await ex.start(force);
    this.changed();
    return ex;
  }

  async stop(sessionId: string): Promise<void> {
    const ex = this.byId.get(sessionId);
    if (!ex) return;
    await ex.stop();
    this.byId.delete(sessionId);
    this.changed();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.byId.keys()].map((id) => this.stop(id)));
    this.stopPolling();
  }

  /** Start the dispatch poller (app start + every `everyMs`). */
  startPolling(everyMs = 30_000): void {
    this.stopPolling();
    void this.pollDispatch();
    this.timer = setInterval(() => void this.pollDispatch(), everyMs);
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * For each of my sessions not already running here: if there are controls
   * aimed at this device, claim (force, since dispatch is explicit) and run.
   */
  async pollDispatch(): Promise<{ checked: number; started: string[] }> {
    const started: string[] = [];
    if (!this.deps || this.polling || !this.deps.settings.autoDispatch)
      return { checked: 0, started };
    this.polling = true;
    try {
      const { mine } = await listSessions(this.deps.auth);
      const candidates = mine.filter((s) => !s.archived && !this.byId.has(s.id));
      await Promise.all(
        candidates.map(async (s) => {
          try {
            const { controls } = await listControls(this.deps!.auth, s.id, {
              applied: false,
              target: 'me',
            });
            if (controls.length === 0) return;
            const ex = await this.runHere(s.id, s.session_key, true);
            if (ex.lease.held) {
              started.push(s.id);
              this.deps?.notify?.('ok', `Dispatched task started: ${s.title ?? s.session_key}`);
            }
          } catch (e) {
            console.warn('[executor] dispatch check failed', s.id, errorMessage(e));
          }
        }),
      );
      return { checked: candidates.length, started };
    } catch (e) {
      console.warn('[executor] dispatch poll failed', errorMessage(e));
      return { checked: 0, started };
    } finally {
      this.polling = false;
    }
  }
}

export const executors = new ExecutorRegistry();
