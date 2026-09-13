// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'react';
import { Loader2, MessagesSquare, Monitor, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '@/components/ui';
import { executors } from '@/executor/executor';
import { DevicesPage } from '@/features/devices/devices-page';
import { OnboardingPage } from '@/features/onboarding/onboarding-page';
import { SessionPage } from '@/features/session/session-page';
import { SessionsPage } from '@/features/sessions/sessions-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { useApp, type Route } from '@/store';

declare const __APP_VERSION__: string;

const NAV: { route: Route; label: string; icon: typeof Monitor }[] = [
  { route: { name: 'sessions' }, label: 'Sessions', icon: MessagesSquare },
  { route: { name: 'devices' }, label: 'Devices', icon: Monitor },
  { route: { name: 'settings' }, label: 'Settings', icon: SettingsIcon },
];

export function App() {
  const { booted, boot, route, navigate, toast, apiKey } = useApp();
  const auth = useApp((s) => s.auth());

  useEffect(() => {
    void boot();
  }, [boot]);

  // Release any executor lease when the window closes (the TTL would expire
  // it anyway after 30 s, but a clean release lets another device claim now).
  useEffect(() => {
    const onUnload = () => {
      void executors.stopAll();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  if (!booted) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--color-muted)]">
        <Loader2 className="mr-2 size-4 animate-spin" /> Starting…
      </div>
    );
  }

  if (!apiKey || !auth || route.name === 'onboarding') return <OnboardingPage />;

  return (
    <div className="flex h-full">
      <nav
        className="flex w-44 shrink-0 flex-col gap-1 border-r border-[color:var(--color-border)] bg-[color:var(--color-bg-panel)] p-2"
        aria-label="Primary"
      >
        <div className="px-2 py-2 text-sm font-semibold tracking-tight">codai</div>
        {NAV.map((n) => {
          const active =
            route.name === n.route.name ||
            (n.route.name === 'sessions' && route.name === 'session');
          return (
            <button
              key={n.label}
              type="button"
              onClick={() => navigate(n.route)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[color:var(--color-bg-elevated)]',
                active && 'bg-[color:var(--color-bg-elevated)] font-medium',
              )}
            >
              <n.icon className="size-4" /> {n.label}
            </button>
          );
        })}
        <div className="mt-auto px-2 py-1 font-mono text-[10px] text-[color:var(--color-muted)]">
          v{__APP_VERSION__}
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto p-5">
        {route.name === 'sessions' ? <SessionsPage auth={auth} /> : null}
        {route.name === 'session' ? <SessionPage auth={auth} id={route.id} /> : null}
        {route.name === 'devices' ? <DevicesPage auth={auth} /> : null}
        {route.name === 'settings' ? <SettingsPage /> : null}
      </main>
      {toast ? <Toast key={toast.at} kind={toast.kind} text={toast.text} /> : null}
    </div>
  );
}

function Toast({ kind, text }: { kind: 'ok' | 'err'; text: string }) {
  const clear = useApp((s) => s.notify);
  useEffect(() => {
    const t = setTimeout(() => useApp.setState({ toast: null }), 3500);
    return () => clearTimeout(t);
  }, [clear]);
  return (
    <div
      role="status"
      className={cn(
        'fixed bottom-4 right-4 max-w-sm rounded-md border px-3 py-2 text-sm shadow-lg',
        kind === 'ok'
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          : 'border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)]',
      )}
    >
      {text}
    </div>
  );
}
