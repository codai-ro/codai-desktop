// SPDX-License-Identifier: Apache-2.0
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import { fmtInt, fmtUsd } from '@/lib/format';
import type { WireReceipt } from '@/lib/types';

export function CostCard({
  receipt,
  error,
}: {
  receipt: WireReceipt | null;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost</CardTitle>
        <CardDescription>From the honest receipt (`/v1/receipt`)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error ? (
          <p className="text-xs text-[color:var(--color-muted)]">Receipt unavailable: {error}</p>
        ) : !receipt ? (
          <p className="text-xs text-[color:var(--color-muted)]">No usage recorded.</p>
        ) : (
          <>
            <div className="text-2xl font-semibold tabular-nums">{fmtUsd(receipt.cost_usd)}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-[color:var(--color-muted)]">Requests</dt>
              <dd className="text-right tabular-nums">{fmtInt(receipt.events)}</dd>
              <dt className="text-[color:var(--color-muted)]">Tasks</dt>
              <dd className="text-right tabular-nums">{fmtInt(receipt.tasks)}</dd>
              <dt className="text-[color:var(--color-muted)]">Prompt tokens</dt>
              <dd className="text-right tabular-nums">{fmtInt(receipt.prompt_tokens)}</dd>
              <dt className="text-[color:var(--color-muted)]">Completion tokens</dt>
              <dd className="text-right tabular-nums">{fmtInt(receipt.completion_tokens)}</dd>
              <dt className="text-[color:var(--color-muted)]">Cached reads</dt>
              <dd className="text-right tabular-nums">{fmtInt(receipt.cached_read_tokens)}</dd>
            </dl>
            {receipt.by_upstream.length > 0 ? (
              <ul className="space-y-1 border-t border-[color:var(--color-border)] pt-2 text-xs">
                {receipt.by_upstream.map((u) => (
                  <li key={u.upstream_model} className="flex justify-between gap-2">
                    <span className="truncate font-mono">{u.upstream_model}</span>
                    <span className="tabular-nums">{fmtUsd(u.cost_micro_usd / 1_000_000)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
