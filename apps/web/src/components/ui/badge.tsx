import type { ReactNode } from 'react';

/**
 * Badges: short status labels.
 *
 * A badge is used for a state, never for decoration. If removing it would lose
 * no information, it should not be there — a row of coloured pills that all say
 * "Active" is noise that makes the one badge which matters invisible.
 */

type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'negative';

const TONES: Record<Tone, string> = {
  neutral: 'border-rule-strong text-ink-muted',
  accent: 'border-accent/30 bg-accent-soft text-accent',
  positive: 'border-positive/30 bg-positive-soft text-positive',
  warning: 'border-warning/35 bg-warning-soft text-warning',
  negative: 'border-negative/30 bg-negative-soft text-negative',
};

export function Badge({
  tone = 'neutral',
  children,
  className = '',
  icon,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={`inline-box gap-1 rounded-sm border px-1.5 py-0.5 text-[0.6875rem] font-semibold tracking-[0.04em] uppercase ${TONES[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * The basket's paused state.
 *
 * Renders nothing when the basket is running. A "not paused" badge is a badge
 * that trains people to ignore the space where the paused badge appears.
 */
export function PausedBadge({ paused }: { paused: boolean }) {
  if (!paused) return null;
  return (
    <Badge tone="warning" icon={<AlertGlyph />}>
      Paused
    </Badge>
  );
}

function AlertGlyph() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="size-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M6 1.5 11 10.5H1z" strokeLinejoin="round" />
      <path d="M6 4.75v2" strokeLinecap="round" />
      <circle cx="6" cy="8.6" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Marks the wallet that created a basket.
 *
 * §22 lists "creator" as a field on three of the four pages, so it is worth
 * being one component rather than three spellings of the same idea.
 */
export function CreatorBadge({
  address,
  display,
  isSelf = false,
}: {
  address: string;
  /** Pre-shortened address. Passed in so the formatting stays in one module. */
  display: string;
  isSelf?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-muted">
      <CreatorGlyph />
      <span className="figure">{display}</span>
      {isSelf ? <span className="text-[0.6875rem] tracking-wide uppercase">you</span> : null}
      <span className="sr-only">{`creator ${address}`}</span>
    </span>
  );
}

function CreatorGlyph() {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <circle cx="7" cy="4.75" r="2.5" />
      <path d="M2.25 12.25a4.75 4.75 0 0 1 9.5 0" strokeLinecap="round" />
    </svg>
  );
}
