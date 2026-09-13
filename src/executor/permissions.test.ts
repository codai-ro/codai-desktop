// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AskBroker, decisionFromAnswer, PermissionPolicy } from './permissions';

describe('PermissionPolicy', () => {
  it('lets read tools through without asking', () => {
    const p = new PermissionPolicy();
    expect(p.allowedWithoutAsk('fs_read')).toBe(true);
    expect(p.allowedWithoutAsk('fs_list')).toBe(true);
    expect(p.allowedWithoutAsk('browser_snapshot')).toBe(true);
  });

  it('asks for act tools until "always allow" for that tool only', () => {
    const p = new PermissionPolicy();
    expect(p.allowedWithoutAsk('shell')).toBe(false);
    expect(p.apply('shell', 'allow_once')).toBe(true);
    expect(p.allowedWithoutAsk('shell')).toBe(false); // once is once
    expect(p.apply('shell', 'allow_always')).toBe(true);
    expect(p.allowedWithoutAsk('shell')).toBe(true);
    expect(p.allowedWithoutAsk('fs_write')).toBe(false); // per tool
    expect(p.apply('fs_write', 'deny')).toBe(false);
    p.reset();
    expect(p.allowedWithoutAsk('shell')).toBe(false);
  });

  it('summarises the call for the card', () => {
    const p = new PermissionPolicy();
    expect(p.summary('shell', { cmd: 'git status', cwd: 'E:\\x' })).toContain('git status');
    expect(p.summary('fs_write', { path: 'a.txt', content: 'abc' })).toContain('3 chars');
    expect(p.summary('shell', { cmd: 'x'.repeat(1000) }).length).toBeLessThan(500);
  });
});

describe('decisionFromAnswer', () => {
  it('maps card options and remote texts; never default-allows', () => {
    expect(decisionFromAnswer('Allow once')).toBe('allow_once');
    expect(decisionFromAnswer('approve')).toBe('allow_once');
    expect(decisionFromAnswer('yes')).toBe('allow_once');
    expect(decisionFromAnswer('Always allow (this session)')).toBe('allow_always');
    expect(decisionFromAnswer('Deny')).toBe('deny');
    expect(decisionFromAnswer('no')).toBe('deny');
    expect(decisionFromAnswer('')).toBe('deny');
    expect(decisionFromAnswer(null)).toBe('deny');
    expect(decisionFromAnswer('please do something else')).toBe('deny');
    expect(decisionFromAnswer('(cancelled)')).toBe('deny');
  });
});

describe('AskBroker', () => {
  it('resolves by id and notifies subscribers', async () => {
    const b = new AskBroker();
    const seen: number[] = [];
    b.subscribe((l) => seen.push(l.length));
    const p = b.wait({ id: 'a1', kind: 'question', text: 'q?', options: [] });
    expect(b.size).toBe(1);
    expect(b.answer('a1', 'yes')).toBe(true);
    await expect(p).resolves.toBe('yes');
    expect(b.size).toBe(0);
    expect(seen).toEqual([0, 1, 0]);
    expect(b.answer('a1', 'again')).toBe(false);
  });

  it('answer(null) targets the most recent ask; decide() the latest permission', async () => {
    const b = new AskBroker();
    const q = b.wait({ id: 'q', kind: 'question', text: 'q', options: [] });
    const perm = b.wait({ id: 'p', kind: 'permission', text: 'p', options: [], tool: 'shell' });
    expect(b.decide(true)).toBe(true);
    await expect(perm).resolves.toBe('approve');
    expect(b.answer(null, 'the answer')).toBe(true);
    await expect(q).resolves.toBe('the answer');
    expect(b.decide(false)).toBe(false);
  });

  it('abort signal resolves with (cancelled); cancelAll drains everything', async () => {
    const b = new AskBroker();
    const ctrl = new AbortController();
    const p1 = b.wait({ id: '1', kind: 'question', text: '', options: [] }, ctrl.signal);
    ctrl.abort();
    await expect(p1).resolves.toBe('(cancelled)');
    const p2 = b.wait({ id: '2', kind: 'permission', text: '', options: [] });
    const p3 = b.wait({ id: '3', kind: 'permission', text: '', options: [] });
    b.cancelAll();
    await expect(Promise.all([p2, p3])).resolves.toEqual(['(cancelled)', '(cancelled)']);
    expect(b.size).toBe(0);
  });
});
