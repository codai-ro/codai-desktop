// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatResult, ChatToolCall } from '@/lib/gateway';
import { readChatSse } from '@/lib/gateway';
import type { OutgoingEvent } from '@/lib/types';
import { AgentRun, trimHistory, type AgentRunDeps } from './agent-run';
import { EventSink } from './event-sink';
import type { ToolName } from './permissions';

const auth = {
  baseUrl: 'http://x',
  apiKey: 'k',
  deviceId: '11111111-1111-4111-8111-111111111111',
  deviceName: 'd',
};

function tc(id: string, name: string, args: Record<string, unknown>): ChatToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

/** Scripted model: each call returns the next message. */
function scripted(replies: ChatMessage[], seen: ChatMessage[][] = []): AgentRunDeps['chat'] {
  let i = 0;
  return async (_auth, req) => {
    seen.push(req.messages);
    const m = replies[i++] ?? { role: 'assistant', content: '(no more replies)' };
    const r: ChatResult = {
      message: m,
      usage: { prompt_tokens: 10, completion_tokens: 5, cached_tokens: 0 },
      costMicroUsd: 7,
      routedTo: 'test',
    };
    return r;
  };
}

function harness(replies: ChatMessage[], runTool?: AgentRunDeps['runTool']) {
  const events: OutgoingEvent[] = [];
  const sink = new EventSink(async (e) => void events.push(...e), { flushDelayMs: 0 });
  const seen: ChatMessage[][] = [];
  const toolCalls: { name: ToolName; args: Record<string, unknown> }[] = [];
  const run = new AgentRun({
    auth,
    sessionKey: 'sess-1',
    sink,
    budgets: { requestMs: 5000, toolMs: 5000, turnMs: 20000 },
    model: 'codai',
    system: 'sys',
    chat: scripted(replies, seen),
    runTool:
      runTool ??
      (async (name, args) => {
        toolCalls.push({ name, args });
        return `ok ${name}`;
      }),
  });
  let turns = 0;
  const done = async () => {
    turns += 1;
    const want = turns;
    await waitFor(() => run.snapshot.status === 'idle' && run.snapshot.turnId === null);
    await sink.flush();
    await waitFor(() => events.filter((e) => e.kind === 'turn_end').length >= want);
  };
  return { run, sink, events, seen, toolCalls, done, kinds: () => events.map((e) => e.kind) };
}

describe('AgentRun turn loop', () => {
  it('emits the phone trace vocabulary for a plain answer', async () => {
    const h = harness([{ role: 'assistant', content: 'Hello!' }]);
    h.run.send('hi');
    await h.done();
    await h.sink.flush();
    expect(h.kinds()).toEqual([
      'turn_start',
      'step_start',
      'req_start',
      'usage',
      'assistant',
      'turn_end',
    ]);
    expect(h.events[0]!.payload).toMatchObject({ prompt: 'hi' });
    expect(h.events.every((e) => e.turn_id)).toBe(true);
    expect(h.run.snapshot.usage).toMatchObject({ requests: 1, promptTokens: 10, costMicroUsd: 7 });
    expect(h.seen[0]![0]).toMatchObject({ role: 'system', content: 'sys' });
  });

  it('runs read tools without asking, feeds results back, then answers', async () => {
    const h = harness([
      { role: 'assistant', content: null, tool_calls: [tc('c1', 'fs_list', { path: 'E:\\x' })] },
      { role: 'assistant', content: 'done' },
    ]);
    h.run.send('list');
    await h.done();
    await h.sink.flush();
    expect(h.toolCalls).toEqual([{ name: 'fs_list', args: { path: 'E:\\x' } }]);
    expect(h.kinds()).toEqual([
      'turn_start',
      'step_start',
      'req_start',
      'usage',
      'assistant',
      'tool_call',
      'tool_result',
      'step_start',
      'req_start',
      'usage',
      'assistant',
      'turn_end',
    ]);
    const second = h.seen[1]!;
    expect(second.at(-1)).toMatchObject({
      role: 'tool',
      tool_call_id: 'c1',
      content: 'ok fs_list',
    });
    expect(second.at(-2)).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'c1' }] });
  });

  it('asks before an act tool; deny returns DENIED without running it; always-allow skips the next ask', async () => {
    const h = harness([
      { role: 'assistant', content: null, tool_calls: [tc('c1', 'shell', { cmd: 'rm -rf x' })] },
      { role: 'assistant', content: null, tool_calls: [tc('c2', 'shell', { cmd: 'ls' })] },
      { role: 'assistant', content: null, tool_calls: [tc('c3', 'shell', { cmd: 'pwd' })] },
      { role: 'assistant', content: 'end' },
    ]);
    h.run.send('go');
    // First ask → deny
    await waitFor(() => h.run.asks.size === 1);
    const a1 = h.run.asks.list()[0]!;
    expect(a1).toMatchObject({ kind: 'permission', tool: 'shell' });
    expect(a1.text).toContain('rm -rf x');
    expect(h.run.snapshot.status).toBe('waiting');
    expect(h.run.permission(false, a1.id)).toBe(true);
    // Second ask → always allow
    await waitFor(() => h.run.asks.size === 1 && h.run.asks.list()[0]!.id !== a1.id);
    expect(h.run.answer('Always allow (this session)', null)).toBe(true);
    await h.done();
    await h.sink.flush();
    expect(h.toolCalls.map((t) => t.args['cmd'])).toEqual(['ls', 'pwd']); // rm never ran, pwd needed no ask
    const asks = h.events.filter((e) => e.kind === 'ask');
    expect(asks).toHaveLength(2);
    expect(asks[0]!.payload).toMatchObject({
      ask_kind: 'permission',
      tool: 'shell',
      options: 'Allow once|Always allow (this session)|Deny',
    });
    const resolved = h.events.filter((e) => e.kind === 'ask_resolved');
    expect(resolved[0]!.payload).toMatchObject({ summary: 'deny' });
    const denied = h.events.find((e) => e.kind === 'tool_result' && e.payload['ok'] === false);
    expect(String(denied!.payload['preview'])).toMatch(/^DENIED/);
  });

  it('ask_user waits for an answer and returns it to the model', async () => {
    const h = harness([
      {
        role: 'assistant',
        content: null,
        tool_calls: [tc('q', 'ask_user', { question: 'Which?', options: ['a', 'b'] })],
      },
      { role: 'assistant', content: 'picked' },
    ]);
    h.run.send('choose');
    await waitFor(() => h.run.asks.size === 1);
    expect(h.run.asks.list()[0]).toMatchObject({
      kind: 'question',
      text: 'Which?',
      options: ['a', 'b'],
    });
    h.run.answer('b', null);
    await h.done();
    expect(h.seen[1]!.at(-1)).toMatchObject({ role: 'tool', content: 'User answered: b' });
  });

  it('cancel aborts a waiting ask and rolls the turn back', async () => {
    const h = harness([
      {
        role: 'assistant',
        content: null,
        tool_calls: [tc('c1', 'fs_write', { path: 'a', content: 'b' })],
      },
      { role: 'assistant', content: 'never' },
    ]);
    h.run.send('write');
    await waitFor(() => h.run.asks.size === 1);
    h.run.cancel();
    await h.done();
    await h.sink.flush();
    expect(h.toolCalls).toEqual([]);
    expect(h.events.find((e) => e.kind === 'error')?.payload).toMatchObject({ cancelled: true });
    expect(h.kinds().at(-1)).toBe('turn_end');
    // Next turn starts from a clean history (no dangling tool_calls).
    h.run.send('again');
    await waitFor(() => h.seen.length === 2);
    expect(h.seen[1]!.filter((m) => m.role !== 'system')).toEqual([
      { role: 'user', content: 'again' },
    ]);
  });

  it('tool deadline surfaces as an ERROR result, not a hang', async () => {
    const h = harness(
      [
        { role: 'assistant', content: null, tool_calls: [tc('c1', 'fs_read', { path: 'slow' })] },
        { role: 'assistant', content: 'end' },
      ],
      () => new Promise(() => {}),
    );
    // Short tool budget for the test.
    (h.run as unknown as { deps: AgentRunDeps }).deps.budgets.toolMs = 50;
    h.run.send('x');
    await h.done();
    await h.sink.flush();
    expect(h.kinds()).toContain('deadline');
    const res = h.events.find((e) => e.kind === 'tool_result')!;
    expect(String(res.payload['preview'])).toMatch(/did not finish within/);
  });

  it('inject/steer are folded into the next step', async () => {
    const h = harness([
      { role: 'assistant', content: null, tool_calls: [tc('c1', 'fs_list', { path: 'x' })] },
      { role: 'assistant', content: 'end' },
    ]);
    let released!: () => void;
    const gate = new Promise<void>((r) => (released = r));
    (h.run as unknown as { runToolImpl: AgentRunDeps['runTool'] }).runToolImpl = async () => {
      await gate;
      return 'ok';
    };
    h.run.send('start');
    await waitFor(() => h.seen.length === 1);
    h.run.interject('turn left', true);
    released();
    await h.done();
    const steer = h.seen[1]!.find((m) => m.role === 'user' && m.content?.startsWith('[STEER'));
    expect(steer?.content).toContain('turn left');
    expect(h.kinds()).toContain('steer');
  });

  it('queues a send while busy and runs it after', async () => {
    const h = harness([
      { role: 'assistant', content: 'one' },
      { role: 'assistant', content: 'two' },
    ]);
    h.run.send('a');
    h.run.send('b');
    await waitFor(() => h.seen.length === 2);
    await h.done();
    await h.done();
    expect(h.events.filter((e) => e.kind === 'turn_start').map((e) => e.payload['prompt'])).toEqual(
      ['a', 'b'],
    );
  });
});

describe('trimHistory', () => {
  it('keeps first user message and the tail, dropping orphan tool results', () => {
    const big = 'x'.repeat(1000);
    const h: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: null, tool_calls: [tc('a', 't', {})] },
      { role: 'tool', tool_call_id: 'a', content: big },
      { role: 'assistant', content: null, tool_calls: [tc('b', 't', {})] },
      { role: 'tool', tool_call_id: 'b', content: big },
      { role: 'assistant', content: 'last' },
    ];
    const out = trimHistory(h, 1500);
    expect(out[0]).toEqual({ role: 'user', content: 'first' });
    expect(
      out.some(
        (m) =>
          m.role === 'tool' && !out.some((a) => a.tool_calls?.some((c) => c.id === m.tool_call_id)),
      ),
    ).toBe(false);
    expect(out.at(-1)).toEqual({ role: 'assistant', content: 'last' });
  });
});

describe('readChatSse', () => {
  it('assembles content deltas, tool_calls by index, and usage', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"fs_","arguments":"{\\"pa"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read","arguments":"th\\":1}"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"shell","arguments":"{}"}}]}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":1}}}',
      'data: [DONE]',
      '',
    ].join('\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        // Split at an awkward byte boundary to exercise buffering.
        c.enqueue(enc.encode(lines.slice(0, 40)));
        c.enqueue(enc.encode(lines.slice(40)));
        c.close();
      },
    });
    const deltas: string[] = [];
    const starts: string[] = [];
    const r = await readChatSse(body, {
      onDelta: (d) => deltas.push(d),
      onToolStart: (_id, n) => starts.push(n),
    });
    expect(deltas.join('')).toBe('Hello');
    expect(r.message.content).toBe('Hello');
    expect(r.message.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'fs_read', arguments: '{"path":1}' } },
      { id: 'c2', type: 'function', function: { name: 'shell', arguments: '{}' } },
    ]);
    expect(starts).toEqual(['fs_', 'shell']);
    expect(r.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, cached_tokens: 1 });
  });
});

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
