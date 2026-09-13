// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, MessagesSquare, RefreshCw, Search } from 'lucide-react';
import { Button, EmptyState, Input } from '@/components/ui';
import { errorMessage, listSessions, type GatewayAuth } from '@/lib/gateway';
import type { SessionListRow } from '@/lib/types';
import { useApp } from '@/store';
import { RemoteBadge, RoleBadge } from './role-badge';

export function SessionsPage({ auth }: { auth: GatewayAuth }) {
  const navigate = useApp((s) => s.navigate);
  const [rows, setRows] = useState<{ mine: SessionListRow[]; shared: SessionListRow[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listSessions(auth)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth, tick]);

  // Light polling keeps "last event" and executor fresh without a stream per row.
  useEffect(() => {
    const t = setInterval(() => setTick((k) => k + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  const q = filter.trim().toLowerCase();
  const match = (r: SessionListRow) =>
    !q || (r.title ?? '').toLowerCase().includes(q) || r.session_key.toLowerCase().includes(q);
  const mine = useMemo(() => (rows?.mine ?? []).filter(match), [rows, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const shared = useMemo(() => (rows?.shared ?? []).filter(match), [rows, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-base font-semibold">Sessions</h1>
        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[color:var(--color-muted)]" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by title or key…"
            className="pl-8"
            aria-label="Filter sessions"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTick((k) => k + 1)}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
        </Button>
      </div>

      {error ? (
        <p className="border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 rounded-md border p-3 text-sm text-[color:var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {loading && !rows ? (
        <div className="flex items-center gap-2 py-10 text-sm text-[color:var(--color-muted)]">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <Section
            title="Mine"
            rows={mine}
            myDevice={auth.deviceId}
            emptyMessage="Sessions you start on any of your devices appear here."
            onOpen={(id) => navigate({ name: 'session', id })}
          />
          <Section
            title="Shared with me"
            rows={shared}
            myDevice={auth.deviceId}
            emptyMessage="Nobody has shared a session with you yet."
            onOpen={(id) => navigate({ name: 'session', id })}
          />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  myDevice,
  emptyMessage,
  onOpen,
}: {
  title: string;
  rows: SessionListRow[];
  myDevice: string;
  emptyMessage: string;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-[color:var(--color-muted)]">
        {title} <span className="tabular-nums">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare className="size-6" />}
          title="No sessions"
          description={emptyMessage}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[color:var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--color-bg-panel)] text-left text-[11px] uppercase tracking-wide text-[color:var(--color-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Executor</th>
                <th className="px-3 py-2 font-medium">Last event</th>
                <th className="px-3 py-2 text-right font-medium">Seq</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <SessionRowView key={r.id} r={r} myDevice={myDevice} onOpen={onOpen} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SessionRowView({
  r,
  myDevice,
  onOpen,
}: {
  r: SessionListRow;
  myDevice: string;
  onOpen: (id: string) => void;
}) {
  const id = r.executor_device_id;
  const live = !!r.lease_expires_at && new Date(r.lease_expires_at).getTime() > Date.now();
  return (
    <tr
      tabIndex={0}
      role="link"
      onClick={() => onOpen(r.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(r.id);
        }
      }}
      className="cursor-pointer border-t border-[color:var(--color-border)] hover:bg-[color:var(--color-bg-elevated)] focus-visible:bg-[color:var(--color-bg-elevated)] focus-visible:outline-none"
    >
      <td className="max-w-[28rem] px-3 py-2">
        <div className="truncate font-medium">{r.title || 'Untitled session'}</div>
        <div className="truncate font-mono text-[11px] text-[color:var(--color-muted)]">
          {r.session_key}
        </div>
      </td>
      <td className="px-3 py-2">
        <RoleBadge role={r.role} />
      </td>
      <td className="px-3 py-2">
        {!id ? (
          <span className="text-xs text-[color:var(--color-muted)]">idle</span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px]" title={id}>
              {id.slice(0, 8)}
            </span>
            {id !== myDevice ? <RemoteBadge /> : null}
            {!live ? (
              <span className="text-[11px] text-[color:var(--color-muted)]">(lease expired)</span>
            ) : null}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className="text-xs text-[color:var(--color-muted)]"
          title={r.last_event_at ?? undefined}
        >
          {r.last_event_at
            ? formatDistanceToNow(new Date(r.last_event_at), { addSuffix: true })
            : '—'}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">{r.last_seq}</td>
    </tr>
  );
}
