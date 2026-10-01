import { forwardRef, type ButtonHTMLAttributes } from 'react';

/**
 * Buttons.
 *
 * Three weights, and the hierarchy between them is the point: one primary action
 * per surface, everything else secondary or ghost. A page with two filled
 * buttons has no primary action, it has two competing ones.
 *
 * `busy` is a first-class prop rather than something a caller fakes by passing
 * `disabled`. A button that is disabled while a wallet popup is open looks
 * broken; one that says what it is doing does not. The `aria-busy` attribute is
 * what makes that state reach a screen reader.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover active:bg-accent-hover disabled:bg-accent/45 disabled:text-white/80',
  secondary:
    'bg-surface text-ink border border-rule-strong hover:border-ink-muted hover:bg-sunken disabled:text-ink-faint disabled:border-rule',
  ghost: 'bg-transparent text-ink-muted hover:bg-sunken hover:text-ink disabled:text-ink-faint',
  danger:
    'bg-transparent text-negative border border-negative/35 hover:bg-negative-soft disabled:text-negative/40',
};

const SIZES: Record<Size, string> = {
  // 44px at `lg` is the touch target §28 asks for on a phone; `sm` is only ever
  // used inside a table row, where the whole row is the target.
  sm: 'h-8 px-3 text-[0.8125rem] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-[0.9375rem] gap-2.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Renders a spinner and blocks interaction without the button looking inert. */
  busy?: boolean;
  /** Stretch to the container. The default on mobile action bars. */
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    busy = false,
    block = false,
    className = '',
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-busy={busy || undefined}
      className={[
        // `inline-box` rather than `inline-flex` so a caller passing `hidden`
        // or `block` actually gets it — see the note on `.inline-box` in
        // globals.css.
        'inline-box justify-center rounded font-medium whitespace-nowrap',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        block ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
});

/**
 * A spinner drawn in CSS.
 *
 * Not an icon font and not an emoji. It inherits `currentColor`, so it is
 * legible on the filled primary button and on the paper ground without a variant
 * for each.
 */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${className}`}
    />
  );
}
