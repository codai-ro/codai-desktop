// SPDX-License-Identifier: Apache-2.0
/**
 * "Run here" — claims the executor lease for this device and shows the local
 * run: activity line, ask cards (Allow / Deny / options + "always allow for
 * this session"), usage, Stop. Executor state lives in the process-wide
 * registry (`executors`), so navigating away does not stop a run.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2, MonitorPlay, Square, Zap } from 'lucide-react';
import { Badge, Button, cn } from '@/components/ui';
import { executors, type LocalExecutor } from '@/executor/executor';
import type { PendingAsk } from '@/executor/permissions';
import { onToolProgress, type ToolProgress } from '@/lib/native';
import type { GatewayAuth } from '@/lib/gateway';
import type { SessionDetail } from '@/lib/types';
import { useApp } from '@/store';

/** Subscribe to the registry + the session's executor (if any). */
export function useExecutor(sessionId: string): LocalExecutor | undefined {
  return useSyncExternalStore(
    (cb) => {
      const un1 = executors.subscribe(cb);
      const ex = executors.get(sessionId);
      const un2 = ex?.subscribe(cb);
      return () => {
        un1();
        un2?.();
      };
    },
    () => executors.get(sessionId),
    () => undefined,
  );
}

/** Version counter so React re-renders when the executor's inner state changes. */
function useExecutorTick(ex: LocalExecutor | undefined): number {
  return useSyncExternalStore(
    (cb) => (ex ? ex.subscribe(cb) : () => {}),
    () => (ex ? tickOf(ex) : 0),
    () => 0,
  );
}
const ticks = new WeakMap<LocalExecutor, number>();
function tickOf(ex: LocalExecutor): number {
  // Derive a cheap version from mutable fields the UI cares about.
  const s = ex.run.snapshot;
  const v = `${ex.lease.current.status}|${s.status}|${s.step}|${s.activity}|${s.usage.requests}|${s.streaming.length}|${ex.run.asks.size}|${s.lastError ?? ''}`;
  let n = ticks.get(ex) ?? 0;
  const prev = lastKey.get(ex);
  if (prev !== v) {
    n += 1;
    ticks.set(ex, n);
    lastKey.set(ex, v);
  }
  return n;
}
const lastKey = new WeakMap<LocalExecutor, string>();

export function ExecutorPanel({
  auth,
  session,
  holderDeviceId,
  holderName,
}: {
  auth: GatewayAuth;
  session: SessionDetail;
  holderDeviceId: string | null;
  holderName: (id: string) => string;
}) {
  const notify = useApp((s) => s.notify);
  const ex = useExecutor(session.id);
  useExecutorTick(ex);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);

  useEffect(() => {
    let un: (() => void) | null = null;
    void onToolProgress((p) => setProgress(p)).then((u) => {
      un = u;
    });
    return () => {
      un?.();
    };
  }, []);

  const isOwner = session.role === 'owner';
  const held = ex?.lease.held ?? false;
  const heldByOther = !!holderDeviceId && holderDeviceId !== auth.deviceId;
  const lease = ex?.lease.current;

  const runHere = async (force: boolean) => {
    setBusy(true);
    try {
      const e = await executors.runHere(session.id, session.session_key, force);
      if (e.lease.held) notify('ok', 'This device is now the executor');
      else if (e.lease.current.status === 'lost')
        notify(
          'err',
          `${e.lease.current.reason}${e.lease.current.holderDeviceId ? ` (${holderName(e.lease.current.holderDeviceId)})` : ''}`,
        );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await executors.stop(session.id);
      notify('ok', 'Stopped; lease released');
    } finally {
      setBusy(false);
    }
  };

  if (!isOwner) return null;

  const snap = ex?.run.snapshot;
  const asks = ex?.run.asks.list() ?? [];

  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border px-3 py-2 text-xs',
        held
          ? 'border-emerald-500/40 bg-emerald-500/5'
          : 'border-[color:var(--color-border)] bg-[color:var(--color-bg-panel)]',
      )}
      aria-label="Local executor"
    >
      <div className="flex flex-wrap items-center gap-2">
        <MonitorPlay className="size-4" />
        <span className="font-medium">Run here</span>
        {held ? (
          <Badge variant="success">LOCAL</Badge>
        ) : heldByOther ? (
          <Badge variant="warning">REMOTE</Badge>
        ) : (
          <Badge variant="outline">idle</Badge>
        )}
        {lease?.status === 'lost' ? (
          <span className="text-amber-300">
            {lease.reason}
            {lease.holderDeviceId ? ` — held by ${holderName(lease.holderDeviceId)}` : ''}
          </span>
        ) : heldByOther && !held ? (
          <span className="text-[color:var(--color-muted)]">
            driven by {holderName(holderDeviceId!)}
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          {held ? (
            <Button variant="outline" size="sm" onClick={() => void stop()} disabled={busy}>
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3.5" />
              )}{' '}
              Stop
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={() => void runHere(false)}
                disabled={busy}
                title="Claim the executor lease for this device"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}{' '}
                Run here
              </Button>
              {heldByOther || lease?.status === 'lost' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runHere(true)}
                  disabled={busy}
                  title="Take the lease from the current holder"
                >
                  Take over
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {held && snap ? (
        <div className="flex flex-wrap items-center gap-3 text-[color:var(--color-muted)]">
          <span className="inline-flex items-center gap-1">
            {snap.status !== 'idle' ? <Loader2 className="size-3 animate-spin" /> : null}
            {snap.status === 'idle' ? 'ready' : `step ${snap.step} · ${snap.activity}`}
          </span>
          {progress && snap.status !== 'idle' ? (
            <span className="font-mono">
              {progress.tool} {progress.phase}
              {progress.detail ? ` · ${progress.detail.slice(0, 80)}` : ''}
            </span>
          ) : null}
          <span className="ml-auto font-mono">
            {snap.usage.requests} req · {snap.usage.promptTokens + snap.usage.completionTokens} tok
            · ${(snap.usage.costMicroUsd / 1e6).toFixed(4)}
          </span>
        </div>
      ) : null}

      {held && snap?.streaming ? (
        <p className="whitespace-pre-wrap rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 text-[color:var(--color-foreground)]">
          {snap.streaming}
        </p>
      ) : null}

      {held && snap?.lastError ? (
        <p className="text-[color:var(--color-danger)]">{snap.lastError}</p>
      ) : null}

      {asks.map((a) => (
        <AskCard key={a.id} ask={a} />
      ))}
    </div>
  );
}

function AskCard({ ask }: { ask: PendingAsk }) {
  const [text, setText] = useState('');
  const answer = (t: string) => ask.resolve(t);
  const isPerm = ask.kind === 'permission';
  return (
    <div
      className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2"
      role="group"
      aria-label={isPerm ? 'Permission request' : 'Question'}
    >
      <p className="mb-1 font-medium text-amber-300">
        {isPerm ? `Allow ${ask.tool ?? 'tool'}?` : 'The agent asks:'}
      </p>
      <p className="whitespace-pre-wrap font-mono text-[11px]">{ask.text}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {isPerm ? (
          <>
            <Button size="sm" onClick={() => answer('Allow once')}>
              Allow
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => answer('Always allow (this session)')}
              title="Do not ask again for this tool in this session"
            >
              Always allow for this session
            </Button>
            <Button size="sm" variant="danger" onClick={() => answer('Deny')}>
              Deny
            </Button>
          </>
        ) : (
          <>
            {ask.options.map((o) => (
              <Button key={o} size="sm" variant="outline" onClick={() => answer(o)}>
                {o}
              </Button>
            ))}
            <input
              className="focus-visible:outline-brand-400 h-8 min-w-40 flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim()) answer(text.trim());
              }}
              placeholder="Type an answer…"
              aria-label="Answer"
            />
            <Button
              size="sm"
              onClick={() => text.trim() && answer(text.trim())}
              disabled={!text.trim()}
            >
              Answer
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
