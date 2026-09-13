// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { errorMessage, getEvents, getReceipt, getSession, type GatewayAuth } from '@/lib/gateway';
import type { SessionDetail, WireEvent, WireReceipt } from '@/lib/types';
import { useApp } from '@/store';
import { RemoteBadge, RoleBadge } from '../sessions/role-badge';
import { CostCard } from './cost-card';
import { SessionLive } from './session-live';

interface Loaded {
  session: SessionDetail;
  events: WireEvent[];
  lastSeq: number;
  eventsError: string | null;
  receipt: WireReceipt | null;
  receiptError: string | null;
}

export function SessionPage({ auth, id }: { auth: GatewayAuth; id: string }) {
  const navigate = useApp((s) => s.navigate);
  const [state, setState] = useState<{
    loading: boolean;
    data: Loaded | null;
    error: string | null;
  }>({
    loading: true,
    data: null,
    error: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const session = await getSession(auth, id);
        const [ev, rc] = await Promise.allSettled([
          getEvents(auth, session.id, 0),
          getReceipt(auth, session.session_key),
        ]);
        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          data: {
            session,
            events: ev.status === 'fulfilled' ? ev.value.events : [],
            lastSeq: ev.status === 'fulfilled' ? ev.value.last_seq : session.last_seq,
            eventsError: ev.status === 'rejected' ? errorMessage(ev.reason) : null,
            receipt: rc.status === 'fulfilled' ? rc.value : null,
            receiptError: rc.status === 'rejected' ? errorMessage(rc.reason) : null,
          },
        });
      } catch (e) {
        if (!cancelled) setState({ loading: false, data: null, error: errorMessage(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, id, reloadKey]);

  const s = state.data?.session;
  const executorRemote = !!s?.executor_device_id && s.executor_device_id !== auth.deviceId;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'sessions' })}>
          <ArrowLeft className="size-4" /> Sessions
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">
            {s ? s.title || 'Untitled session' : 'Session'}
          </h1>
          <p className="truncate font-mono text-[11px] text-[color:var(--color-muted)]">
            {s?.session_key ?? id}
          </p>
        </div>
        {s ? <RoleBadge role={s.role} /> : null}
        {executorRemote ? <RemoteBadge /> : null}
        {s?.e2e ? <Badge variant="secondary">E2E</Badge> : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={state.loading}
          title="Reload snapshot"
        >
          <RefreshCw className={state.loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
        </Button>
      </div>

      {state.loading && !state.data ? (
        <div className="flex items-center gap-2 py-10 text-sm text-[color:var(--color-muted)]">
          <Loader2 className="size-4 animate-spin" /> Loading session…
        </div>
      ) : state.error ? (
        <p className="border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 rounded-md border p-3 text-sm text-[color:var(--color-danger)]">
          {state.error}
        </p>
      ) : state.data ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <SessionLive
            key={`${state.data.session.id}:${reloadKey}`}
            auth={auth}
            session={state.data.session}
            initialEvents={state.data.events}
            initialLastSeq={state.data.lastSeq}
            eventsError={state.data.eventsError}
          />
          <div className="space-y-4">
            <CostCard receipt={state.data.receipt} error={state.data.receiptError} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
