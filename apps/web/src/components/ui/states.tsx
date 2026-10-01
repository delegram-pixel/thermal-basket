import type { ReactNode } from 'react';
import { Button } from './button.tsx';

/**
 * The three states every data surface has, in one place.
 *
 * Loading, empty and error are not edge cases to be handled with a fallback
 * string; they are what a user sees on a thin testnet most of the time. Each one
 * says what is true and what to do about it, and none of them shows a figure it
 * does not have.
 */

/** A block of the page that has not arrived yet. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-sm bg-rule/70 ${className}`} />;
}

/**
 * A placeholder shaped like the thing it replaces.
 *
 * A generic spinner tells the user nothing about what is coming. Rows of
 * correctly-proportioned bars keep the page from jumping when the data lands,
 * which on a chain read is the difference between a page that settles and a page
 * that lurches.
 */
export function LoadingRows({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/** A centred status line, for a small region rather than a whole page. */
export function LoadingState({ message = 'Reading from the chain…' }: { message?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2.5 py-10 text-sm text-ink-muted"
    >
      <span
        aria-hidden="true"
        className="inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
      />
      {message}
    </div>
  );
}

/**
 * Nothing here — and, importantly, *why* nothing is here.
 *
 * "No baskets yet" and "this wallet has not created a basket" are different
 * statements, and the second one needs a button under it.
 */
export function EmptyState({
  title,
  description,
  action,
  className = '',
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border border-dashed border-rule-strong rounded px-6 py-12 text-center ${className}`}
    >
      <p className="font-display text-lg text-ink">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * Something went wrong, said in a sentence.
 *
 * The raw RPC string is present but demoted to a disclosure. §21 forbids it as
 * the primary message, and the reason is practical: "execution reverted:
 * 0x1a2b3c" tells a user nothing they can act on, while it is exactly the thing
 * they need to paste into an issue.
 */
export function ErrorState({
  title = 'That did not load',
  detail,
  raw,
  onRetry,
  retryLabel = 'Try again',
  className = '',
}: {
  title?: string;
  detail: string;
  raw?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`rounded border border-negative/30 bg-negative-soft px-5 py-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        <RiskMark tone="negative" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-1 text-sm text-ink-muted">{detail}</p>

          {raw ? (
            <details className="mt-2.5 group">
              <summary className="cursor-pointer text-xs text-ink-muted underline decoration-rule-strong underline-offset-2 hover:text-ink">
                Technical detail
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-sm bg-surface/70 p-2.5 text-[0.6875rem] leading-relaxed break-all whitespace-pre-wrap text-ink-muted">
                {raw}
              </pre>
            </details>
          ) : null}

          {onRetry ? (
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={onRetry}>
                {retryLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * A state mark that is not carried by colour alone (§29).
 *
 * Each of these is a distinct silhouette — a filled triangle for a warning, a
 * ring for information, a slash for an error — so a reader who cannot tell red
 * from amber can still tell risk from notice. Drawn as inline paths rather than
 * an icon font or an emoji, both of which are ruled out.
 */
export function RiskMark({
  tone,
  className = 'size-4',
}: {
  tone: 'positive' | 'negative' | 'warning' | 'info';
  className?: string;
}) {
  const colour = {
    positive: 'text-positive',
    negative: 'text-negative',
    warning: 'text-warning',
    info: 'text-info',
  }[tone];

  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`${className} mt-0.5 shrink-0 ${colour}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {tone === 'positive' ? (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M5.25 8.25 7 10l3.75-4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      {tone === 'warning' ? (
        <>
          <path d="M8 2.5 14.5 13.5h-13z" strokeLinejoin="round" />
          <path d="M8 6.5v3.25" strokeLinecap="round" />
          <circle cx="8" cy="11.6" r="0.75" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {tone === 'negative' ? (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" strokeLinecap="round" />
        </>
      ) : null}
      {tone === 'info' ? (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v4" strokeLinecap="round" />
          <circle cx="8" cy="5" r="0.75" fill="currentColor" stroke="none" />
        </>
      ) : null}
    </svg>
  );
}
