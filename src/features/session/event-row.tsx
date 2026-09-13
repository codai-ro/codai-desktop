// SPDX-License-Identifier: Apache-2.0
import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, HelpCircle, Wrench } from 'lucide-react';
import { cn } from '@/components/ui';
import { fmtUtcTime } from '@/lib/format';
import { payloadStr, type WireEvent } from '@/lib/types';

/**
 * Render one protocol event. Kinds come from the phone trace vocabulary
 * (AgentRun.kt): turn_start{prompt}, assistant{text,model}, tool_call{name,args},
 * tool_result{name,ok,ms,preview}, ask{id,ask_kind,text,options}, ask_resolved
 * {summary}, error{message}, deadline, screen_wait{position}, usage, control
 * {control:{kind,text},applied}, user{text}. Unknown kinds fall through to a
 * compact JSON row (the protocol says viewers ignore what they do not know).
 *
 * Copied from the console's `event-row.tsx` (apps/web) with local imports.
 */
export function EventRow({ ev }: { ev: WireEvent }) {
  const p = ev.payload ?? {};
  const time = <Time ts={ev.ts} />;

  switch (ev.kind) {
    case 'turn_start':
      return (
        <Divider label={`Turn started · ${payloadStr(p, 'prompt') ?? ''}`.trim()} time={time} />
      );
    case 'turn_end':
      return <Divider label="Turn ended" time={time} muted />;
    case 'user':
      return (
        <Bubble side="right" time={time} label="You">
          {payloadStr(p, 'text')}
        </Bubble>
      );
    case 'assistant':
      return (
        <Bubble side="left" time={time} label={payloadStr(p, 'model') ?? 'assistant'}>
          {payloadStr(p, 'text')}
        </Bubble>
      );
    case 'control': {
      const ctl = (p['control'] ?? {}) as Record<string, unknown>;
      const applied = p['applied'] === true;
      return (
        <Bubble side="right" time={time} label={`control · ${payloadStr(ctl, 'kind') ?? ''}`}>
          {payloadStr(ctl, 'text') ?? '—'}
          <span className="ml-2 text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
            {applied ? 'applied' : 'queued'}
          </span>
        </Bubble>
      );
    }
    case 'tool_call':
      return (
        <Collapsible
          icon={<Wrench className="size-3.5" />}
          time={time}
          summary={`call ${payloadStr(p, 'name') ?? 'tool'}`}
          body={payloadStr(p, 'args')}
        />
      );
    case 'tool_result': {
      const ok = p['ok'] !== false;
      return (
        <Collapsible
          icon={<Wrench className="size-3.5" />}
          time={time}
          summary={`${ok ? 'result' : 'FAILED'} ${payloadStr(p, 'name') ?? ''} ${
            p['ms'] != null ? `· ${String(p['ms'])} ms` : ''
          }`}
          body={payloadStr(p, 'preview')}
          tone={ok ? undefined : 'danger'}
        />
      );
    }
    case 'ask': {
      const options = payloadStr(p, 'options')?.split('|').filter(Boolean) ?? [];
      return (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          role="note"
        >
          <div className="flex items-center gap-2 text-amber-300">
            <HelpCircle className="size-4" />
            <span className="font-medium">
              {payloadStr(p, 'ask_kind') === 'permission' ? 'Permission requested' : 'Question'}
            </span>
            <span className="ml-auto">{time}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap">{payloadStr(p, 'text')}</p>
          {options.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {options.map((o) => (
                <li
                  key={o}
                  className="rounded-md border border-amber-500/40 px-2 py-0.5 text-xs text-amber-200"
                >
                  {o}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }
    case 'ask_resolved':
      return <Divider label={`Answered · ${payloadStr(p, 'summary') ?? ''}`} time={time} muted />;
    case 'error':
      return (
        <div
          className="border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 flex items-start gap-2 rounded-lg border p-3 text-sm text-[color:var(--color-danger)]"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="whitespace-pre-wrap">{payloadStr(p, 'message') ?? 'Error'}</span>
          <span className="ml-auto shrink-0">{time}</span>
        </div>
      );
    case 'deadline':
      return <Divider label="Deadline reached" time={time} />;
    case 'screen_wait':
      return (
        <Divider
          label={`Waiting for the screen (queue position ${payloadStr(p, 'position') ?? '?'})`}
          time={time}
          muted
        />
      );
    case 'usage':
      return null;
    case 'lease_transferred':
      return <Divider label="Executor changed" time={time} />;
    default:
      return (
        <Collapsible
          icon={<ChevronRight className="size-3.5" />}
          time={time}
          summary={ev.kind}
          body={Object.keys(p).length ? JSON.stringify(p, null, 2) : null}
        />
      );
  }
}

function Time({ ts }: { ts: number }) {
  return (
    <time
      dateTime={new Date(ts).toISOString()}
      className="font-mono text-[10px] text-[color:var(--color-muted)]"
    >
      {fmtUtcTime(new Date(ts))}
    </time>
  );
}

function Divider({ label, time, muted }: { label: string; time: ReactNode; muted?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 text-xs',
        muted ? 'text-[color:var(--color-muted)]' : 'text-[color:var(--color-foreground)]',
      )}
    >
      <span className="h-px flex-1 bg-[color:var(--color-border)]" aria-hidden="true" />
      <span className="max-w-[70%] truncate">{label}</span>
      {time}
      <span className="h-px flex-1 bg-[color:var(--color-border)]" aria-hidden="true" />
    </div>
  );
}

function Bubble({
  side,
  label,
  time,
  children,
}: {
  side: 'left' | 'right';
  label: string;
  time: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex', side === 'right' ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
          side === 'right'
            ? 'border-brand-500/30 bg-brand-500/10'
            : 'border-[color:var(--color-border)] bg-[color:var(--color-bg-elevated)]',
        )}
      >
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
          <span>{label}</span>
          {time}
        </div>
        <div className="whitespace-pre-wrap break-words">{children ?? '—'}</div>
      </div>
    </div>
  );
}

function Collapsible({
  icon,
  summary,
  body,
  time,
  tone,
}: {
  icon: ReactNode;
  summary: string;
  body: string | null;
  time: ReactNode;
  tone?: 'danger';
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        'rounded-md border text-xs',
        tone === 'danger'
          ? 'border-[color:var(--color-danger)]/40'
          : 'border-[color:var(--color-border)]',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!body}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono hover:bg-[color:var(--color-bg-elevated)] disabled:cursor-default"
      >
        <span className={cn('transition-transform', open && 'rotate-90')}>
          {body ? <ChevronRight className="size-3.5" /> : icon}
        </span>
        <span className="truncate">{summary}</span>
        <span className="ml-auto">{time}</span>
      </button>
      {open && body ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-[color:var(--color-border)] p-2 font-mono text-[11px]">
          {body}
        </pre>
      ) : null}
    </div>
  );
}
