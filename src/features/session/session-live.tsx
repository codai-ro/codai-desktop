// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Monitor, Radio, Send, Smartphone, Square, WifiOff } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Gated,
  Textarea,
  cn,
} from '@/components/ui';
import { errorMessage, sendControl, type GatewayAuth } from '@/lib/gateway';
import {
  payloadStr,
  roleAtLeast,
  type ControlKind,
  type PresenceEntry,
  type SessionDetail,
  type WireEvent,
} from '@/lib/types';
import { useApp } from '@/store';
import { executors } from '@/executor/executor';
import { RoleBadge } from '../sessions/role-badge';
import { EventRow } from './event-row';
import { ExecutorPanel, useExecutor } from './executor-panel';
import { useSessionStream } from './use-session-stream';

/** Adapted from the console's `session-live.tsx`; same layout and reducers. */
export function SessionLive({
  auth,
  session,
  initialEvents,
  initialLastSeq,
  eventsError,
}: {
  auth: GatewayAuth;
  session: SessionDetail;
  initialEvents: WireEvent[];
  initialLastSeq: number;
  eventsError: string | null;
}) {
  const deviceId = auth.deviceId;
  const stream = useSessionStream(auth, session.id, initialEvents, initialLastSeq);
  const canEdit = roleAtLeast(session.role, 'editor');
  const executor = useExecutor(session.id);
  const local = executor?.lease.held ?? false;

  // Executor = current lease holder (live frame wins over the initial snapshot).
  const executorDeviceId =
    stream.lease !== null ? stream.lease.holder_device_id : (session.lease?.device_id ?? null);

  // Feed live frames to the local executor: controls to run, lease changes to detect takeover.
  const seenSeq = useRef(0);
  useEffect(() => {
    const ex = executors.get(session.id);
    if (!ex) return;
    for (const ev of stream.events) {
      if (ev.seq <= seenSeq.current) continue;
      seenSeq.current = ev.seq;
      if (ev.kind === 'control') ex.onControlEvent(ev);
    }
  }, [stream.events, session.id]);
  useEffect(() => {
    executors.get(session.id)?.onLeaseFrame(stream.lease?.holder_device_id ?? null);
  }, [stream.lease, session.id]);

  const deviceName = (id: string): string => {
    for (const m of session.members) {
      const d = m.devices.find((x) => x.device_id === id);
      if (d) return d.name;
    }
    return id.slice(0, 8);
  };

  // Pending ask: last `ask` with no later `ask_resolved` for the same id.
  const pendingAsk = useMemo(() => {
    const resolved = new Set<string>();
    for (let i = stream.events.length - 1; i >= 0; i -= 1) {
      const ev = stream.events[i]!;
      if (ev.kind === 'ask_resolved') resolved.add(payloadStr(ev.payload, 'id') ?? '');
      if (ev.kind === 'ask') {
        const id = payloadStr(ev.payload, 'id') ?? '';
        return resolved.has(id)
          ? null
          : { id, turnId: ev.turn_id, text: payloadStr(ev.payload, 'text') };
      }
      if (ev.kind === 'turn_end') return null;
    }
    return null;
  }, [stream.events]);

  const turnRunning = useMemo(() => {
    for (let i = stream.events.length - 1; i >= 0; i -= 1) {
      const k = stream.events[i]!.kind;
      if (k === 'turn_start') return true;
      if (k === 'turn_end') return false;
    }
    return false;
  }, [stream.events]);

  return (
    <div className="space-y-4">
      <PresenceStrip
        session={session}
        presence={[...stream.presence.values()]}
        executorDeviceId={executorDeviceId}
        myDeviceId={deviceId}
        status={stream.status}
      />

      <ExecutorPanel
        auth={auth}
        session={session}
        holderDeviceId={executorDeviceId}
        holderName={deviceName}
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between py-3">
          <CardTitle>Transcript</CardTitle>
          <span className="font-mono text-[11px] text-[color:var(--color-muted)]">
            seq {stream.lastSeq}
          </span>
        </CardHeader>
        <CardContent>
          {eventsError ? (
            <p className="mb-3 text-xs text-[color:var(--color-danger)]">
              Could not load history: {eventsError}
            </p>
          ) : null}
          {stream.error ? <p className="mb-3 text-xs text-amber-400">{stream.error}</p> : null}
          <Transcript events={stream.events} />
        </CardContent>
      </Card>

      <ControlBar
        auth={auth}
        sessionId={session.id}
        canEdit={canEdit}
        pendingAsk={pendingAsk}
        turnRunning={turnRunning}
        local={local}
      />
    </div>
  );
}

// ── Presence ───────────────────────────────────────────────────────────────

function PresenceStrip({
  session,
  presence,
  executorDeviceId,
  myDeviceId,
  status,
}: {
  session: SessionDetail;
  presence: PresenceEntry[];
  executorDeviceId: string | null;
  myDeviceId: string;
  status: string;
}) {
  const deviceName = (id: string): string => {
    for (const m of session.members) {
      const d = m.devices.find((x) => x.device_id === id);
      if (d) return d.name;
    }
    return id.slice(0, 8);
  };
  const devicePlatform = (id: string): string | null => {
    for (const m of session.members) {
      const d = m.devices.find((x) => x.device_id === id);
      if (d) return d.platform;
    }
    return null;
  };
  const ExecIcon = devicePlatform(executorDeviceId ?? '') === 'desktop' ? Monitor : Smartphone;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-panel)] px-3 py-2 text-xs"
      aria-label="Session members and presence"
    >
      <span
        className={cn(
          'inline-flex items-center gap-1',
          status === 'live' ? 'text-emerald-400' : 'text-amber-400',
        )}
      >
        {status === 'live' ? <Radio className="size-3.5" /> : <WifiOff className="size-3.5" />}
        {status}
      </span>
      <span className="h-4 w-px bg-[color:var(--color-border)]" aria-hidden="true" />
      {session.members.map((m) => (
        <span key={m.user_id} className="inline-flex items-center gap-1.5">
          <span className="font-mono" title={m.user_id}>
            {m.user_id === session.owner_user_id && session.role === 'owner'
              ? 'you'
              : m.user_id.slice(0, 8)}
          </span>
          <RoleBadge role={m.role} />
          {m.remote ? (
            <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
              remote
            </Badge>
          ) : null}
        </span>
      ))}
      <span className="h-4 w-px bg-[color:var(--color-border)]" aria-hidden="true" />
      <span className="inline-flex items-center gap-1 text-[color:var(--color-muted)]">
        <ExecIcon className="size-3.5" />
        {executorDeviceId ? (
          <>
            driving: <span className="font-mono">{deviceName(executorDeviceId)}</span>
            {executorDeviceId !== myDeviceId ? (
              <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                remote
              </Badge>
            ) : null}
          </>
        ) : (
          'no executor'
        )}
      </span>
      {presence.length > 0 ? (
        <>
          <span className="h-4 w-px bg-[color:var(--color-border)]" aria-hidden="true" />
          <span className="text-[color:var(--color-muted)]">online:</span>
          {presence.map((p) => (
            <span
              key={p.device_id}
              className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)] px-2 py-0.5"
              title={`${p.device_id} · ${p.role}`}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  p.driving || p.executor ? 'bg-emerald-400' : 'bg-[color:var(--color-muted)]',
                )}
                aria-hidden="true"
              />
              <span className="font-mono">
                {p.device_id === myDeviceId ? 'this device' : deviceName(p.device_id)}
              </span>
              {p.executor ? <span className="text-[10px] uppercase">driving</span> : null}
            </span>
          ))}
        </>
      ) : null}
    </div>
  );
}

// ── Transcript ─────────────────────────────────────────────────────────────

function Transcript({ events }: { events: WireEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  useEffect(() => {
    if (stickToBottom) endRef.current?.scrollIntoView({ block: 'end' });
  }, [events.length, stickToBottom]);

  return (
    <div
      onScroll={(e) => {
        const el = e.currentTarget;
        setStickToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
      }}
      className="max-h-[55vh] space-y-2 overflow-y-auto pr-1"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Session transcript"
      tabIndex={0}
    >
      {events.length === 0 ? (
        <p className="py-8 text-center text-xs text-[color:var(--color-muted)]">
          No events yet. They will appear here as the executor works.
        </p>
      ) : (
        events.map((ev) => <EventRow key={ev.seq} ev={ev} />)
      )}
      <div ref={endRef} />
    </div>
  );
}

// ── Control bar ────────────────────────────────────────────────────────────

function ControlBar({
  auth,
  sessionId,
  canEdit,
  pendingAsk,
  turnRunning,
  local,
}: {
  auth: GatewayAuth;
  sessionId: string;
  canEdit: boolean;
  pendingAsk: { id: string; turnId: string | null; text: string | null } | null;
  turnRunning: boolean;
  /** This device holds the lease: drive the local run directly instead of queueing controls. */
  local: boolean;
}) {
  const notify = useApp((s) => s.notify);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const submit = async (kind: ControlKind) => {
    const body = text.trim();
    if ((kind === 'send' || kind === 'answer') && !body) {
      notify('err', 'Type something first');
      return;
    }
    // Local executor: no round trip through the control queue.
    const ex = local ? executors.get(sessionId) : undefined;
    if (ex?.lease.held) {
      if (kind === 'cancel') ex.run.cancel();
      else if (kind === 'answer') {
        if (!ex.run.answer(body, pendingAsk?.id ?? null))
          notify('err', 'Nothing is waiting for an answer');
      } else if (ex.run.busy) ex.run.interject(body, kind === 'steer');
      else ex.run.send(body, null);
      if (kind !== 'cancel') setText('');
      areaRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      const res = await sendControl(auth, sessionId, {
        id: crypto.randomUUID(),
        kind,
        ...(kind === 'cancel' ? {} : { text: body }),
        ...(kind === 'answer' && pendingAsk ? { ask_id: pendingAsk.id } : {}),
        ...(pendingAsk?.turnId ? { turn_id: pendingAsk.turnId } : {}),
      });
      notify(
        'ok',
        kind === 'cancel'
          ? 'Cancel requested'
          : res.duplicate
            ? 'Already sent'
            : `${kind === 'answer' ? 'Answer' : 'Message'} queued (seq ${res.seq ?? '?'})`,
      );
      if (kind !== 'cancel') setText('');
      areaRef.current?.focus();
    } catch (e) {
      notify('err', errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  // Esc anywhere in the window cancels the running turn (editor+).
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && turnRunning && !pending) {
        e.preventDefault();
        void submit('cancel');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // submit is recreated each render; the deps that matter are below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, turnRunning, pending, sessionId, text]);

  const disabledReason = !canEdit
    ? 'Viewers cannot steer this session. Ask the owner for the editor role.'
    : null;
  const primaryKind: ControlKind = pendingAsk ? 'answer' : 'send';
  const hint = local
    ? turnRunning
      ? 'Running on this device. Ctrl/⌘+Enter adds a note to the running turn · Esc stops.'
      : 'Running on this device. Ctrl/⌘+Enter starts a turn here.'
    : 'Ctrl/⌘+Enter to ' +
      primaryKind +
      ' · Esc to cancel. Controls are queued for the executor device.';

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        pendingAsk
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-[color:var(--color-border)] bg-[color:var(--color-bg-panel)]',
      )}
      aria-label="Session controls"
    >
      {pendingAsk ? (
        <p className="mb-2 text-xs text-amber-300">
          The agent is waiting for an answer{pendingAsk.text ? `: ${pendingAsk.text}` : '.'}
        </p>
      ) : null}
      <label htmlFor="session-control-text" className="sr-only">
        {primaryKind === 'answer' ? 'Answer' : 'Message to the agent'}
      </label>
      <Textarea
        id="session-control-text"
        ref={areaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !disabledReason) {
            e.preventDefault();
            void submit(primaryKind);
          }
        }}
        placeholder={
          disabledReason ??
          (primaryKind === 'answer' ? 'Type your answer…' : 'Send a message or steer the agent…')
        }
        disabled={!!disabledReason || pending}
        rows={2}
        aria-describedby="session-control-hint"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span id="session-control-hint" className="text-[11px] text-[color:var(--color-muted)]">
          {hint}
        </span>
        <div className="ml-auto flex gap-2">
          {local && turnRunning && !pendingAsk ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !text.trim()}
              onClick={() => void submit('steer')}
              title="Redirect the running turn"
            >
              Steer
            </Button>
          ) : null}
          <Gated reason={disabledReason}>
            <Button
              variant="outline"
              size="sm"
              disabled={!!disabledReason || pending || !turnRunning}
              onClick={() => void submit('cancel')}
              title={turnRunning ? 'Cancel the running turn (Esc)' : 'No turn is running'}
            >
              <Square className="size-3.5" /> Cancel
            </Button>
          </Gated>
          <Gated reason={disabledReason}>
            <Button
              size="sm"
              disabled={!!disabledReason || pending}
              onClick={() => void submit(primaryKind)}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              {primaryKind === 'answer' ? 'Answer' : 'Send'}
            </Button>
          </Gated>
        </div>
      </div>
    </div>
  );
}
