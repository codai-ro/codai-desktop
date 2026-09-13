// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal primitives mirroring the `@codai/ui` shapes used by the console
 * session screens (Badge, Button, Card). The desktop cannot depend on
 * apps/web, so these are local; class names match the console's tokens
 * (see styles.css `@theme`).
 */
import { clsx, type ClassValue } from 'clsx';
import type {
  ButtonHTMLAttributes,
  ComponentPropsWithRef,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';

export const cn = (...args: ClassValue[]) => clsx(args);

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'warning' | 'success' | 'danger';

const BADGE: Record<BadgeVariant, string> = {
  default: 'bg-brand-500/20 text-brand-200 border-brand-500/40',
  secondary:
    'bg-[color:var(--color-bg-elevated)] text-[color:var(--color-foreground)] border-[color:var(--color-border)]',
  outline: 'text-[color:var(--color-muted)] border-[color:var(--color-border)]',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  danger:
    'bg-[color:var(--color-danger)]/15 text-[color:var(--color-danger)] border-[color:var(--color-danger)]/40',
};

export function Badge({
  variant = 'default',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4',
        BADGE[variant],
        className,
      )}
      {...rest}
    />
  );
}

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON: Record<ButtonVariant, string> = {
  default: 'bg-brand-500 text-white hover:bg-brand-400 disabled:hover:bg-brand-500',
  outline:
    'border border-[color:var(--color-border)] bg-transparent hover:bg-[color:var(--color-bg-elevated)]',
  ghost: 'bg-transparent hover:bg-[color:var(--color-bg-elevated)]',
  danger: 'bg-[color:var(--color-danger)]/90 text-white hover:bg-[color:var(--color-danger)]',
};
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export function Button({
  variant = 'default',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={type}
      className={cn(
        'focus-visible:outline-brand-400 inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  );
}

export function Textarea({ className, ...rest }: ComponentPropsWithRef<'textarea'>) {
  return (
    <textarea
      className={cn(
        'focus-visible:outline-brand-400 w-full resize-y rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-sm placeholder:text-[color:var(--color-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...rest}
    />
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'focus-visible:outline-brand-400 h-9 w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 text-sm placeholder:text-[color:var(--color-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60',
        className,
      )}
      {...rest}
    />
  );
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg-panel)]',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 px-4 pb-2 pt-4', className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold', className)} {...rest} />;
}

export function CardDescription({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-[color:var(--color-muted)]', className)} {...rest} />;
}

export function CardContent({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 pb-4', className)} {...rest} />;
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[color:var(--color-border)] px-6 py-10 text-center">
      <span className="text-[color:var(--color-muted)]">{icon}</span>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-[color:var(--color-muted)]">{description}</p>
      ) : null}
    </div>
  );
}

/** Wrap a disabled control so the reason is reachable by hover/focus. */
export function Gated({ reason, children }: { reason: string | null; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <span tabIndex={0} className="inline-flex" title={reason} aria-label={reason}>
      {children}
    </span>
  );
}
