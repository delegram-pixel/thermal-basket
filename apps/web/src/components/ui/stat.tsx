import type { ReactNode } from 'react';

/**
 * Stat: one figure with its label.
 *
 * The value is set in the mono face at tabular figures, because these are read
 * down a column and against each other. `hint` carries the qualifier that keeps
 * a figure honest — the unit, the block it was read at, or the fact that the
 * feed could not price it.
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  size = 'md',
  unavailable = false,
}: {
  label: string;
  value: ReactNode;
  /** Rendered small and muted after the value, outside the tabular figure. */
  unit?: string;
  hint?: ReactNode;
  size?: 'md' | 'lg';
  /** Renders the em-dash treatment for a figure that genuinely does not exist. */
  unavailable?: boolean;
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        {unavailable ? (
          <span
            className={`text-ink-faint ${size === 'lg' ? 'text-2xl' : 'text-lg'}`}
            title="The price feed cannot value every holding, so no total exists"
          >
            —<span className="sr-only">not available</span>
          </span>
        ) : (
          <span
            className={`figure text-ink ${size === 'lg' ? 'text-2xl sm:text-[1.75rem]' : 'text-lg'}`}
          >
            {value}
          </span>
        )}
        {unit ? <span className="text-xs text-ink-muted">{unit}</span> : null}
      </div>
      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

/**
 * A row of figures separated by hairlines rather than boxed into cards.
 *
 * §24 rules out the card grid and §47 asks for financial information hierarchy.
 * A ruled row of figures is what a research note does, and it keeps four numbers
 * legible at 390px because they simply wrap and the rules move with them.
 */
export function StatRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <dl className={`grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 sm:gap-x-0 ${className}`}>
      {children}
    </dl>
  );
}

/** One cell of a `StatRow`, with the hairline that separates it from its neighbour. */
export function StatCell({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`sm:border-l sm:border-rule sm:pl-6 sm:first:border-l-0 sm:first:pl-0 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A change figure with a direction that is not carried by colour (§29).
 *
 * The arrow is the indicator; the colour reinforces it. A reader who cannot
 * distinguish the green from the red still sees which way the number went, and
 * the sign is in the text as well.
 */
export function Delta({
  value,
  direction,
  label,
}: {
  /** Pre-formatted, e.g. `+2.41%`. */
  value: string;
  direction: 'up' | 'down' | 'flat';
  label?: string;
}) {
  const tone =
    direction === 'up'
      ? 'text-positive'
      : direction === 'down'
        ? 'text-negative'
        : 'text-ink-muted';

  return (
    <span className={`inline-flex items-center gap-1 text-sm ${tone}`}>
      <svg
        viewBox="0 0 10 10"
        aria-hidden="true"
        className="size-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        {direction === 'up' ? (
          <path d="M5 8.5v-7M5 1.5 2 4.5M5 1.5l3 3" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
        {direction === 'down' ? (
          <path d="M5 1.5v7M5 8.5 2 5.5M5 8.5l3-3" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
        {direction === 'flat' ? <path d="M1.5 5h7" strokeLinecap="round" /> : null}
      </svg>
      <span className="figure">{value}</span>
      <span className="sr-only">
        {direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'unchanged'}
      </span>
      {label ? <span className="text-xs text-ink-faint">{label}</span> : null}
    </span>
  );
}
