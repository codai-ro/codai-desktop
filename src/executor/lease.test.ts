// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gw = vi.hoisted(() => ({
  claim: vi.fn(),
  beat: vi.fn(),
  release: vi.fn(),
}));

vi.mock('@/lib/gateway', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/gateway')>();
  return {
    ...mod,
    claimLease: gw.claim,
    heartbeatLease: gw.beat,
    releaseLease: gw.release,
  };
});

import { GatewayError } from '@/lib/gateway';
import { Lease, type LeaseState } from './lease';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const auth = { baseUrl: 'http://x', apiKey: 'k', deviceId: ME, deviceName: 'd' };

describe('Lease', () => {
  beforeEach(() => {
    gw.claim.mockReset();
    gw.beat.mockReset();
    gw.release.mockReset();
  });

  it('claims, heartbeats every 10 s, releases', async () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const states: LeaseState[] = [];
    gw.claim.mockResolvedValue({ session_id: 's', device_id: ME, expires_at: 'e1' });
    gw.beat.mockResolvedValue({ session_id: 's', device_id: ME, expires_at: 'e2' });
    gw.release.mockResolvedValue({ released: true });
    const l = new Lease(auth, 's', {
      onChange: (s) => states.push(s),
      setInterval: (fn, ms) => (timers.push({ fn, ms }), 1),
      clearInterval: () => timers.splice(0),
    });
    expect(await l.claim()).toBe(true);
    expect(gw.claim).toHaveBeenCalledWith(auth, 's', false);
    expect(timers[0]!.ms).toBe(10_000);
    timers[0]!.fn();
    await vi.waitFor(() => expect(gw.beat).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(l.current).toEqual({ status: 'held', expiresAt: 'e2' }));
    await l.release();
    expect(gw.release).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(0);
    expect(states.map((s) => s.status)).toEqual(['claiming', 'held', 'held', 'idle']);
  });

  it('409 on claim → lost with the holder id parsed from the message', async () => {
    gw.claim.mockRejectedValue(
      new GatewayError(
        409,
        'lease_held',
        `Another device holds a live executor lease. (holder_device_id=${OTHER})`,
      ),
    );
    const l = new Lease(auth, 's', { setInterval: () => 1, clearInterval: () => {} });
    expect(await l.claim()).toBe(false);
    expect(l.current).toEqual({
      status: 'lost',
      holderDeviceId: OTHER,
      reason: 'Another device is running this session.',
    });
    expect(l.held).toBe(false);
  });

  it('403 → lost, owner-only reason', async () => {
    gw.claim.mockRejectedValue(new GatewayError(403, 'not_a_member', 'nope'));
    const l = new Lease(auth, 's', { setInterval: () => 1, clearInterval: () => {} });
    await l.claim();
    expect(l.current).toMatchObject({
      status: 'lost',
      reason: 'Only the session owner can run it.',
    });
  });

  it('heartbeat 409 drops to lost and stops the timer; network errors keep it', async () => {
    let cleared = 0;
    gw.claim.mockResolvedValue({ session_id: 's', device_id: ME, expires_at: 'e' });
    const l = new Lease(auth, 's', {
      setInterval: () => 1,
      clearInterval: () => void (cleared += 1),
    });
    await l.claim();
    gw.beat.mockRejectedValueOnce(new TypeError('network'));
    await l.beat();
    expect(l.held).toBe(true);
    gw.beat.mockRejectedValueOnce(
      new GatewayError(
        409,
        'lease_held',
        `Lease lost to another device. (holder_device_id=${OTHER})`,
      ),
    );
    await l.beat();
    expect(l.current).toMatchObject({ status: 'lost', holderDeviceId: OTHER });
    expect(cleared).toBeGreaterThan(0);
  });

  it('observeHolder drops the lease when the SSE frame names another device', async () => {
    gw.claim.mockResolvedValue({ session_id: 's', device_id: ME, expires_at: 'e' });
    const l = new Lease(auth, 's', { setInterval: () => 1, clearInterval: () => {} });
    await l.claim();
    l.observeHolder(ME);
    expect(l.held).toBe(true);
    l.observeHolder(OTHER);
    expect(l.current).toMatchObject({ status: 'lost', holderDeviceId: OTHER });
  });
});
