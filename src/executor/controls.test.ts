// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import type { WireEvent } from '@/lib/types';
import { ControlRouter, type Verbs } from './controls';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function verbs(over: Partial<Verbs> = {}): Verbs & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    send: (t, turn) => void calls.push(`send:${t}:${turn ?? ''}`),
    answer: (t, ask) => {
      calls.push(`answer:${t}:${ask ?? ''}`);
      return true;
    },
    permission: (ok, ask) => {
      calls.push(`perm:${ok}:${ask ?? ''}`);
      return true;
    },
    cancel: () => void calls.push('cancel'),
    interject: (t, steer) => void calls.push(`${steer ? 'steer' : 'inject'}:${t}`),
    ...over,
  };
}

describe('ControlRouter', () => {
  it('maps every kind to the right verb and marks applied', () => {
    const v = verbs();
    const applied: string[] = [];
    const r = new ControlRouter(v, { myDeviceId: ME, onApplied: (id) => applied.push(id) });
    const out = r.applyAll([
      { id: 'c1', kind: 'send', text: 'do it', turn_id: 'turn-1' },
      { id: 'c2', kind: 'answer', text: 'yes', ask_id: 'q1' },
      { id: 'c3', kind: 'approve', ask_id: 'p1' },
      { id: 'c4', kind: 'deny' },
      { id: 'c5', kind: 'cancel' },
      { id: 'c6', kind: 'steer', text: 'go left' },
      { id: 'c7', kind: 'inject', text: 'fyi' },
    ]);
    expect(out).toEqual(Array(7).fill('applied'));
    expect(v.calls).toEqual([
      'send:do it:turn-1',
      'answer:yes:q1',
      'perm:true:p1',
      'perm:false:',
      'cancel',
      'steer:go left',
      'inject:fyi',
    ]);
    expect(applied).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  });

  it('skips controls targeted at another device, applies ones targeted at me', () => {
    const v = verbs();
    const r = new ControlRouter(v, { myDeviceId: ME });
    expect(r.apply({ id: 'a', kind: 'send', text: 'x', target_device_id: OTHER })).toBe(
      'skipped_target',
    );
    expect(r.apply({ id: 'b', kind: 'send', text: 'y', target_device_id: ME })).toBe('applied');
    expect(v.calls).toEqual(['send:y:']);
    // A skipped-target control is NOT remembered: if retargeted it may apply later.
    expect(r.has('a')).toBe(false);
  });

  it('de-duplicates by id and honours applied=true / remember()', () => {
    const v = verbs();
    const r = new ControlRouter(v, { myDeviceId: ME });
    expect(r.apply({ id: 'a', kind: 'send', text: 'x' })).toBe('applied');
    expect(r.apply({ id: 'a', kind: 'send', text: 'x' })).toBe('skipped_duplicate');
    expect(r.apply({ id: 'b', kind: 'send', text: 'x', applied: true })).toBe('skipped_duplicate');
    r.remember(['c']);
    expect(r.apply({ id: 'c', kind: 'cancel' })).toBe('skipped_duplicate');
    expect(v.calls).toEqual(['send:x:']);
  });

  it('defers answer/approve when nothing is waiting so a later drain can retry', () => {
    const v = verbs({ answer: () => false, permission: () => false });
    const applied: string[] = [];
    const r = new ControlRouter(v, { myDeviceId: ME, onApplied: (id) => applied.push(id) });
    expect(r.apply({ id: 'a', kind: 'answer', text: 'x' })).toBe('deferred');
    expect(r.apply({ id: 'b', kind: 'approve' })).toBe('deferred');
    expect(r.has('a')).toBe(false);
    expect(applied).toEqual([]);
  });

  it('ignores empty send/steer/inject but still marks them applied', () => {
    const v = verbs();
    const applied: string[] = [];
    const r = new ControlRouter(v, { myDeviceId: ME, onApplied: (id) => applied.push(id) });
    expect(r.apply({ id: 'a', kind: 'send', text: '   ' })).toBe('ignored');
    expect(r.apply({ id: 'b', kind: 'steer', text: null })).toBe('ignored');
    expect(v.calls).toEqual([]);
    expect(applied).toEqual(['a', 'b']);
  });

  it('skipOwn drops echoes of my own non-send controls', () => {
    const v = verbs();
    const r = new ControlRouter(v, { myDeviceId: ME, skipOwn: true });
    expect(r.apply({ id: 'a', kind: 'cancel', from_device_id: ME })).toBe('skipped_own');
    expect(r.apply({ id: 'b', kind: 'send', text: 'hi', from_device_id: ME })).toBe('applied');
  });

  it('fromEvent parses the echoed control event payload', () => {
    const ev: WireEvent = {
      seq: 7,
      kind: 'control',
      ts: 1,
      sender_device_id: OTHER,
      turn_id: null,
      client_event_id: null,
      payload: {
        control: { id: 'x', kind: 'send', text: 'hello', target_device_id: ME },
        applied: false,
      },
    };
    const c = ControlRouter.fromEvent(ev);
    expect(c).toMatchObject({
      id: 'x',
      kind: 'send',
      text: 'hello',
      from_device_id: OTHER,
      target_device_id: ME,
      applied: false,
    });
    expect(ControlRouter.fromEvent({ ...ev, kind: 'assistant' })).toBeNull();
    expect(ControlRouter.fromEvent({ ...ev, payload: {} })).toBeNull();
  });

  it('onApplied is only called once per control', () => {
    const onApplied = vi.fn();
    const r = new ControlRouter(verbs(), { myDeviceId: ME, onApplied });
    r.apply({ id: 'a', kind: 'cancel' });
    r.apply({ id: 'a', kind: 'cancel' });
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
});
