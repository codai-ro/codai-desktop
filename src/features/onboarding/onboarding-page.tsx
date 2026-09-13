// SPDX-License-Identifier: Apache-2.0
import { useState, type FormEvent } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@/components/ui';
import { DEFAULT_GATEWAY_URL } from '@/lib/native';
import { useApp } from '@/store';

export function OnboardingPage() {
  const { signIn, settings, device } = useApp();
  const [key, setKey] = useState('');
  const [gatewayUrl, setGatewayUrl] = useState(settings.gatewayUrl);
  const [advanced, setAdvanced] = useState(settings.gatewayUrl !== DEFAULT_GATEWAY_URL);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(key, gatewayUrl);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <form onSubmit={submit}>
          <CardHeader>
            <div className="text-brand-300 mb-1 flex items-center gap-2">
              <KeyRound className="size-5" />
              <span className="text-xs font-medium uppercase tracking-wide">codai desktop</span>
            </div>
            <CardTitle className="text-lg">Connect this computer</CardTitle>
            <CardDescription>
              Paste a codai API key. It is checked against the gateway, then kept in the app's
              secret store on this machine only. This device registers as{' '}
              <span className="font-mono">{settings.deviceName || device?.hostname}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="codai_…"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-label="codai API key"
              aria-invalid={!!error}
            />
            {advanced ? (
              <label className="block space-y-1 text-xs">
                <span className="text-[color:var(--color-muted)]">Gateway URL</span>
                <Input
                  value={gatewayUrl}
                  onChange={(e) => setGatewayUrl(e.target.value)}
                  inputMode="url"
                  spellCheck={false}
                />
              </label>
            ) : (
              <button
                type="button"
                className="text-xs text-[color:var(--color-muted)] underline-offset-2 hover:underline"
                onClick={() => setAdvanced(true)}
              >
                Use a different gateway…
              </button>
            )}
            {error ? (
              <p role="alert" className="text-xs text-[color:var(--color-danger)]">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy || !key.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Continue
            </Button>
            <p className="text-[11px] text-[color:var(--color-muted)]">
              Nothing leaves this computer except requests to the gateway you configure. No
              analytics.
            </p>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
