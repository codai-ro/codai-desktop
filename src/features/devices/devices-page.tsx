// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
  Terminal,
  Trash2,
  Globe,
  Bot,
} from 'lucide-react';
import { Badge, Button, EmptyState } from '@/components/ui';
import { errorMessage, listDevices, revokeDevice, type GatewayAuth } from '@/lib/gateway';
import type { DevicePlatform, WireDevice } from '@/lib/types';
import { useApp } from '@/store';

const ICON: Record<DevicePlatform, typeof Monitor> = {
  desktop: Monitor,
  android: Smartphone,
  ios: Smartphone,
  web: Globe,
  cli: Terminal,
  agent: Bot,
};

export function DevicesPage({ auth }: { auth: GatewayAuth }) {
  const notify = useApp((s) => s.notify);
  const [devices, setDevices] = useState<WireDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listDevices(auth)
      .then((d) => {
        if (cancelled) return;
        setDevices(d);
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

  const revoke = async (d: WireDevice) => {
    const isMe = d.id === auth.deviceId;
    const ok = window.confirm(
      isMe
        ? `Revoke THIS device (${d.name})? You will be signed out of shared sessions on this computer.`
        : `Revoke ${d.name}? It will lose access to shared sessions until it registers again.`,
    );
    if (!ok) return;
    setBusy(d.id);
    try {
      await revokeDevice(auth, d.id);
      notify('ok', `Revoked ${d.name}`);
      setTick((k) => k + 1);
    } catch (e) {
      notify('err', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold">Devices</h1>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => setTick((k) => k + 1)}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} />
        </Button>
      </div>
      <p className="text-xs text-[color:var(--color-muted)]">
        Every device registered under your account. Revoking a device removes it from presence and
        stops dispatches to it; the API key it uses is not revoked here.
      </p>

      {error ? (
        <p className="border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 rounded-md border p-3 text-sm text-[color:var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {loading && !devices ? (
        <div className="flex items-center gap-2 py-10 text-sm text-[color:var(--color-muted)]">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : !devices || devices.length === 0 ? (
        <EmptyState
          icon={<Monitor className="size-6" />}
          title="No devices"
          description="Devices register on their first request to the gateway."
        />
      ) : (
        <ul className="divide-y divide-[color:var(--color-border)] overflow-hidden rounded-lg border border-[color:var(--color-border)]">
          {devices.map((d) => {
            const Icon = ICON[d.platform] ?? Monitor;
            const isMe = d.id === auth.deviceId;
            return (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <Icon className="size-4 shrink-0 text-[color:var(--color-muted)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{d.name}</span>
                    {isMe ? <Badge variant="success">this device</Badge> : null}
                    <Badge variant="outline" className="capitalize">
                      {d.platform}
                    </Badge>
                    {d.has_push_token ? <Badge variant="secondary">push</Badge> : null}
                  </div>
                  <div className="truncate font-mono text-[11px] text-[color:var(--color-muted)]">
                    {d.id}
                    {d.capabilities.length ? ` · ${d.capabilities.join(', ')}` : ''}
                  </div>
                </div>
                <span
                  className="hidden text-xs text-[color:var(--color-muted)] sm:inline"
                  title={d.lastSeenAt}
                >
                  seen {formatDistanceToNow(new Date(d.lastSeenAt), { addSuffix: true })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void revoke(d)}
                  disabled={busy === d.id}
                  aria-label={`Revoke ${d.name}`}
                >
                  {busy === d.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  Revoke
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
