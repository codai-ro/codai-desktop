// SPDX-License-Identifier: Apache-2.0
/**
 * Mirrors executor trace events to `POST /v1/sessions/:id/events`.
 *
 * Batching: flush when 20 events are queued or 200 ms after the first one
 * (whichever first). Queue cap 2000 — beyond that the OLDEST events are
 * dropped (the transcript stays live; history is on disk in the trace anyway).
 * Fail-open: a failed POST re-queues the batch (front) up to `maxRetries`
 * times with backoff, then drops it; errors never propagate into the agent
 * loop. `client_event_id` makes retries idempotent server-side.
 */
import type { OutgoingEvent } from '@/lib/types';

export interface EventSinkOptions {
  maxBatch?: number;
  flushDelayMs?: number;
  maxQueue?: number;
  maxRetries?: number;
  /** Injected for tests. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  onError?: (err: unknown) => void;
  idGen?: () => string;
}

export type Poster = (events: OutgoingEvent[]) => Promise<unknown>;

export class EventSink {
  private queue: OutgoingEvent[] = [];
  private timer: unknown = null;
  private inflight: Promise<void> | null = null;
  private retries = 0;
  private closed = false;
  private readonly maxBatch: number;
  private readonly flushDelayMs: number;
  private readonly maxQueue: number;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly onError: (err: unknown) => void;
  private readonly idGen: () => string;
  /** Counters for the UI / tests. */
  readonly stats = { sent: 0, dropped: 0, failed: 0 };

  constructor(
    private readonly post: Poster,
    opts: EventSinkOptions = {},
  ) {
    this.maxBatch = opts.maxBatch ?? 20;
    this.flushDelayMs = opts.flushDelayMs ?? 200;
    this.maxQueue = opts.maxQueue ?? 2000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.now = opts.now ?? (() => Date.now());
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onError = opts.onError ?? (() => {});
    this.idGen = opts.idGen ?? (() => crypto.randomUUID());
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Enqueue one event. Never throws. */
  emit(kind: string, payload: Record<string, unknown>, turnId?: string | null): void {
    if (this.closed) return;
    const ev: OutgoingEvent = {
      kind,
      ts: this.now(),
      client_event_id: this.idGen(),
      payload,
      ...(turnId ? { turn_id: turnId } : {}),
    };
    this.queue.push(ev);
    if (this.queue.length > this.maxQueue) {
      const over = this.queue.length - this.maxQueue;
      this.queue.splice(0, over);
      this.stats.dropped += over;
    }
    if (this.queue.length >= this.maxBatch) {
      void this.flush();
    } else if (this.timer === null) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        void this.flush();
      }, this.flushDelayMs);
    }
  }

  /** Send everything queued (one batch at a time, in order). Resolves when the queue is empty or a batch was dropped. */
  flush(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return Promise.resolve();
    this.inflight = this.drain().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, this.maxBatch);
      try {
        await this.post(batch);
        this.queue.splice(0, batch.length);
        this.stats.sent += batch.length;
        this.retries = 0;
      } catch (e) {
        this.retries += 1;
        this.stats.failed += 1;
        this.onError(e);
        if (this.retries > this.maxRetries) {
          // Give up on this batch; keep the rest for the next attempt.
          this.queue.splice(0, batch.length);
          this.stats.dropped += batch.length;
          this.retries = 0;
          return;
        }
        // Back off, then let the next emit/flush retry the same (idempotent) batch.
        await new Promise<void>((r) => this.setTimer(() => r(), 250 * 2 ** (this.retries - 1)));
        if (this.closed) return;
      }
    }
  }

  /** Flush what is left and refuse further events. */
  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
