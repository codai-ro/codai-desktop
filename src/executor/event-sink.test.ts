// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutgoingEvent } from '@/lib/types';
import { EventSink } from './event-sink';

describe('EventSink', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (post: (e: OutgoingEvent[]) => Promise<unknown>, opts = {}) => {
    let n = 0;
    return new EventSink(post, { idGen: () => `id-${++n}`, now: () => 1000, ...opts });
  };

  it('flushes after 200 ms when fewer than 20 events are queued', async () => {
    const batches: OutgoingEvent[][] = [];
    const s = make(async (e) => void batches.push(e));
    s.emit('turn_start', { prompt: 'x' }, 't1');
    s.emit('step_start', { step: 0 }, 't1');
    expect(batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(199);
    expect(batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0]![0]).toMatchObject({
      kind: 'turn_start',
      turn_id: 't1',
      client_event_id: 'id-1',
      ts: 1000,
    });
    expect(s.stats.sent).toBe(2);
    expect(s.pending).toBe(0);
  });

  it('flushes immediately at 20 events and keeps order', async () => {
    const batches: OutgoingEvent[][] = [];
    const s = make(async (e) => void batches.push(e));
    for (let i = 0; i < 25; i += 1) s.emit('assistant', { i });
    await vi.advanceTimersByTimeAsync(0);
    expect(batches[0]).toHaveLength(20);
    expect(batches[0]!.map((e) => e.payload['i'])).toEqual([...Array(20).keys()]);
    await vi.advanceTimersByTimeAsync(200);
    expect(batches).toHaveLength(2);
    expect(batches[1]).toHaveLength(5);
  });

  it('caps the queue at 2000 by dropping the oldest', async () => {
    const s = make(() => new Promise(() => {}), { maxQueue: 50, maxBatch: 1000 });
    for (let i = 0; i < 60; i += 1) s.emit('e', { i });
    expect(s.pending).toBe(50);
    expect(s.stats.dropped).toBe(10);
  });

  it('is fail-open: retries the same batch with backoff, then drops it', async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const s = make(
      async () => {
        calls += 1;
        throw new Error('boom');
      },
      { maxRetries: 2, onError: (e: unknown) => void errors.push(e) },
    );
    s.emit('e', {});
    await vi.advanceTimersByTimeAsync(200); // first attempt
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(250); // retry 1 after 250 ms
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(500); // retry 2 after 500 ms
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(3); // gave up
    expect(s.stats.dropped).toBe(1);
    expect(s.stats.failed).toBe(3);
    expect(errors).toHaveLength(3);
    expect(s.pending).toBe(0);
  });

  it('emit never throws even when post rejects synchronously', () => {
    const s = make(() => Promise.reject(new Error('x')));
    expect(() => s.emit('e', {})).not.toThrow();
  });

  it('close() flushes the remainder and refuses new events', async () => {
    const batches: OutgoingEvent[][] = [];
    const s = make(async (e) => void batches.push(e));
    s.emit('a', {});
    const closing = s.close();
    await vi.advanceTimersByTimeAsync(0);
    await closing;
    expect(batches).toHaveLength(1);
    s.emit('b', {});
    expect(s.pending).toBe(0);
  });
});
