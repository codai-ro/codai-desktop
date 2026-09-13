// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import { openStream, type GatewayAuth } from '@/lib/gateway';
import type { LeaseFrame, PresenceEntry, WireEvent } from '@/lib/types';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface StreamState {
  events: WireEvent[];
  lastSeq: number;
  presence: Map<string, PresenceEntry>;
  lease: LeaseFrame | null;
  status: StreamStatus;
  error: string | null;
}

/**
 * Subscribe to `GET /v1/sessions/:id/stream?after=<seq>` with the bearer key
 * (plugin-http streams the body; see lib/gateway.ts). Reconnects with
 * exponential backoff and resumes from the last seq seen. Presence frames are
 * kept per device; `online:false` removes the entry.
 *
 * Same reducer as the console's `use-session-stream.ts`; only the transport
 * differs.
 */
export function useSessionStream(
  auth: GatewayAuth | null,
  sessionId: string,
  initialEvents: WireEvent[],
  initialLastSeq: number,
): StreamState {
  const [events, setEvents] = useState<WireEvent[]>(initialEvents);
  const [presence, setPresence] = useState<Map<string, PresenceEntry>>(new Map());
  const [lease, setLease] = useState<LeaseFrame | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const startSeq = Math.max(initialLastSeq, initialEvents.at(-1)?.seq ?? 0);
  const lastSeqRef = useRef(startSeq);
  const [lastSeq, setLastSeq] = useState(startSeq);

  // Re-sync when the caller hands us a fresh snapshot (e.g. after a reload).
  useEffect(() => {
    setEvents(initialEvents);
    lastSeqRef.current = startSeq;
    setLastSeq(startSeq);
  }, [initialEvents, startSeq]);

  useEffect(() => {
    if (!auth) return;
    const deviceId = auth.deviceId;
    const ctrl = new AbortController();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (ctrl.signal.aborted) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      void openStream(
        auth,
        sessionId,
        lastSeqRef.current,
        {
          onOpen: () => {
            attempt = 0;
            setStatus('live');
            setError(null);
          },
          onFrame: (f) => {
            switch (f.t) {
              case 'event': {
                const ev = f.data;
                if (typeof ev.seq !== 'number' || ev.seq <= lastSeqRef.current) return;
                lastSeqRef.current = ev.seq;
                setLastSeq(ev.seq);
                setEvents((prev) => [...prev, ev]);
                return;
              }
              case 'presence': {
                const p = f.data;
                if (!p.device_id) return;
                setPresence((prev) => {
                  const next = new Map(prev);
                  if (p.online === false) next.delete(p.device_id);
                  else next.set(p.device_id, { ...p, remote: p.device_id !== deviceId });
                  return next;
                });
                return;
              }
              case 'lease':
                setLease(f.data);
                return;
              case 'control': {
                // Control echoes also arrive as `event` frames (kind: control);
                // the bare frame only tells us `applied` flips.
                const c = f.data;
                if (!c.applied) return;
                setEvents((prev) =>
                  prev.map((ev) => {
                    if (ev.kind !== 'control') return ev;
                    const ctl = ev.payload['control'] as { id?: string } | undefined;
                    return ctl?.id === c.id
                      ? { ...ev, payload: { ...ev.payload, applied: true } }
                      : ev;
                  }),
                );
                return;
              }
            }
          },
          onClose: (err) => {
            if (ctrl.signal.aborted) return;
            // 403/404 will not heal by retrying — surface and stop.
            if (err && 'status' in err && [401, 403, 404].includes(Number(err.status))) {
              setStatus('closed');
              setError(err.message);
              return;
            }
            attempt += 1;
            setStatus('reconnecting');
            if (attempt > 3) setError('Connection lost — retrying…');
            const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
            timer = setTimeout(connect, delay);
          },
        },
        ctrl.signal,
      );
    };

    connect();
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
      setStatus('closed');
    };
  }, [auth, sessionId]);

  return { events, lastSeq, presence, lease, status, error };
}
