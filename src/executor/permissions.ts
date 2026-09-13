// SPDX-License-Identifier: Apache-2.0
/**
 * Per-tool permission policy for the desktop executor.
 *
 * Read-only tools (`fs_read`, `fs_list`, `browser_snapshot`) run without
 * asking. Everything that changes state (`shell`, `fs_write`, `browser_*`)
 * needs an approval the FIRST time per session, unless the user picked
 * "always allow for this session" for that tool. The decision arrives either
 * from the local ask card (`ask_resolved` in the UI) or from a remote
 * `approve` / `deny` / `answer` control. Pure logic here; the waiting is done
 * by `AskBroker`.
 */

export type ToolName =
  | 'shell'
  | 'fs_read'
  | 'fs_write'
  | 'fs_list'
  | 'browser_launch'
  | 'browser_navigate'
  | 'browser_snapshot'
  | 'browser_click'
  | 'browser_type'
  | 'browser_eval';

export type Risk = 'read' | 'act';

export const TOOL_RISK: Record<ToolName, Risk> = {
  shell: 'act',
  fs_read: 'read',
  fs_write: 'act',
  fs_list: 'read',
  browser_launch: 'act',
  browser_navigate: 'act',
  browser_snapshot: 'read',
  browser_click: 'act',
  browser_type: 'act',
  browser_eval: 'act',
};

/** Options the ask card offers for a permission request. */
export const PERMISSION_OPTIONS = ['Allow once', 'Always allow (this session)', 'Deny'] as const;
export type PermissionOption = (typeof PERMISSION_OPTIONS)[number];

export type Decision = 'allow_once' | 'allow_always' | 'deny';

export function isKnownTool(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_RISK, name);
}

/** Map a free-text answer (card option, remote `answer` text, approve/deny) to a decision. */
export function decisionFromAnswer(text: string | null | undefined): Decision {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return 'deny';
  if (
    t === 'approve' ||
    t === 'allow' ||
    t === 'yes' ||
    t === 'y' ||
    t === 'ok' ||
    t.startsWith('allow once')
  )
    return 'allow_once';
  if (t.startsWith('always') || t.includes('always allow') || t === 'allow_always')
    return 'allow_always';
  if (t === 'deny' || t === 'no' || t === 'n' || t === 'reject' || t.startsWith('deny'))
    return 'deny';
  // Anything else is treated as a denial with an explanation — never default-allow.
  return 'deny';
}

export class PermissionPolicy {
  private readonly always = new Set<ToolName>();

  /** True when the tool may run without asking right now. */
  allowedWithoutAsk(tool: ToolName): boolean {
    return TOOL_RISK[tool] === 'read' || this.always.has(tool);
  }

  /** Record a decision; `allow_always` persists for the session. Returns whether the call may proceed. */
  apply(tool: ToolName, d: Decision): boolean {
    if (d === 'allow_always') this.always.add(tool);
    return d !== 'deny';
  }

  /** Human summary for the ask card. */
  summary(tool: ToolName, args: Record<string, unknown>): string {
    const s = (k: string, n = 160): string => {
      const v = args[k];
      const str = typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v);
      return str.length > n ? `${str.slice(0, n)}…` : str;
    };
    switch (tool) {
      case 'shell':
        return `Run in ${s('cwd') || 'the default directory'}:\n${s('cmd', 400)}`;
      case 'fs_write':
        return `Write ${s('path')} (${String(args['content'] ?? '').length} chars)`;
      case 'browser_launch':
        return 'Launch the automation browser (dedicated profile, port 9333)';
      case 'browser_navigate':
        return `Open ${s('url')} in the automation browser`;
      case 'browser_click':
        return `Click ${s('selector')} in the automation browser`;
      case 'browser_type':
        return `Type "${s('text', 80)}" into ${s('selector')}`;
      case 'browser_eval':
        return `Evaluate JavaScript in the page:\n${s('expression', 300)}`;
      case 'fs_read':
      case 'fs_list':
      case 'browser_snapshot':
        return `${tool} ${s('path')}`.trim();
    }
  }

  reset(): void {
    this.always.clear();
  }
}

/**
 * One pending ask (question or permission). Resolved exactly once, by the
 * local UI or a remote control; `cancel()` resolves everything with a denial.
 */
export interface PendingAsk {
  id: string;
  kind: 'permission' | 'question';
  text: string;
  options: string[];
  tool?: ToolName;
  resolve: (answer: string) => void;
}

export class AskBroker {
  private readonly pending = new Map<string, PendingAsk>();
  private listeners = new Set<(asks: PendingAsk[]) => void>();

  list(): PendingAsk[] {
    return [...this.pending.values()];
  }

  subscribe(fn: (asks: PendingAsk[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    const l = this.list();
    for (const fn of this.listeners) fn(l);
  }

  /** Register an ask and wait for its answer (or `signal` abort → "(cancelled)"). */
  wait(ask: Omit<PendingAsk, 'resolve'>, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve) => {
      const done = (answer: string) => {
        if (!this.pending.has(ask.id)) return;
        this.pending.delete(ask.id);
        signal?.removeEventListener('abort', onAbort);
        this.emit();
        resolve(answer);
      };
      const onAbort = () => done('(cancelled)');
      if (signal?.aborted) {
        resolve('(cancelled)');
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(ask.id, { ...ask, resolve: done });
      this.emit();
    });
  }

  /** Resolve by id; when `id` is null, the most recent pending ask (remote controls often omit `ask_id`). */
  answer(id: string | null | undefined, text: string): boolean {
    const target = id ? this.pending.get(id) : this.list().at(-1);
    if (!target) return false;
    target.resolve(text);
    return true;
  }

  /** Resolve the latest pending PERMISSION ask (remote approve/deny). */
  decide(ok: boolean, id?: string | null): boolean {
    const target = id
      ? this.pending.get(id)
      : this.list()
          .filter((a) => a.kind === 'permission')
          .at(-1);
    if (!target) return false;
    target.resolve(ok ? 'approve' : 'deny');
    return true;
  }

  cancelAll(): void {
    for (const a of this.list()) a.resolve('(cancelled)');
  }

  get size(): number {
    return this.pending.size;
  }
}
