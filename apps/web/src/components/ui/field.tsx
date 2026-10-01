'use client';

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * Form controls.
 *
 * Every control here wires its own label, hint and error together with
 * generated ids, so a caller cannot ship an input whose error message is visible
 * but not announced. That is the failure §29 is about: the message is on screen,
 * so it looks handled, and a screen reader user is told nothing.
 *
 * The error is set in the same colour as the label's required marker *and*
 * prefixed with the word "Error", because colour alone is not an indicator.
 */

interface ShellProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Marks the field as required for assistive technology, without an asterisk. */
  required?: boolean;
  /** Rendered at the right of the label row — a balance, a "max" control. */
  trailing?: ReactNode;
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
    'aria-required': boolean | undefined;
  }) => ReactNode;
}

function FieldShell({ label, hint, error, required, trailing, children }: ShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
          {required ? <span className="sr-only"> (required)</span> : null}
        </label>
        {trailing}
      </div>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
      })}

      {hint && !error ? (
        <p id={hintId} className="mt-1.5 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-negative">
          Error: {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The one control style, shared by every input.
 *
 * A border on the field itself rather than a fill: a page of filled inputs reads
 * as a form to be got through, and this is a page where someone is deciding how
 * much money to commit.
 *
 * Exported because a handful of controls cannot use the field wrappers above —
 * a weight cell inside a table row, where a stacked label would break the
 * column. Those places need the same border, focus ring and invalid state, and
 * a second copy of this string would drift from this one the first time either
 * was touched.
 */
export const controlClass =
  'w-full rounded border border-rule-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint ' +
  'transition-colors hover:border-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ' +
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-faint ' +
  'aria-[invalid=true]:border-negative aria-[invalid=true]:focus:ring-negative';

export function TextField({
  label,
  hint,
  error,
  required,
  trailing,
  className = '',
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  trailing?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & { className?: string }) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} trailing={trailing}>
      {(aria) => <input {...aria} {...rest} className={`${controlClass} ${className}`} />}
    </FieldShell>
  );
}

/** A numeric field that opts into the mono face, so digits line up while typing. */
export function AmountField({
  label,
  hint,
  error,
  required,
  trailing,
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  trailing?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} trailing={trailing}>
      {(aria) => (
        <input
          {...aria}
          {...rest}
          // `inputMode` without `type="number"`: a number input silently discards
          // what it considers an invalid keystroke, so a paste of "1,250.00"
          // arrives empty and the user is not told why.
          inputMode="decimal"
          autoComplete="off"
          className={`${controlClass} figure text-base`}
        />
      )}
    </FieldShell>
  );
}

export function TextArea({
  label,
  hint,
  error,
  required,
  trailing,
  rows = 3,
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  trailing?: ReactNode;
  rows?: number;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} trailing={trailing}>
      {(aria) => (
        <textarea
          {...aria}
          {...rest}
          rows={rows}
          className={`${controlClass} resize-y leading-relaxed`}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  required,
  trailing,
  children,
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  trailing?: ReactNode;
  children: ReactNode;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} trailing={trailing}>
      {(aria) => (
        <select
          {...aria}
          {...rest}
          className={`${controlClass} cursor-pointer appearance-none bg-[length:0] pr-9`}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}

/**
 * A checkbox with a label that can run to a paragraph.
 *
 * The label is a `<label>` wrapping the box, so the whole sentence is the hit
 * target — which is what makes a consent checkbox usable on a phone.
 */
export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
  error,
  disabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div>
      <div className="flex items-start gap-2.5">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm border-rule-strong accent-accent"
        />
        <label htmlFor={id} className="cursor-pointer text-sm text-ink-muted">
          {label}
        </label>
      </div>
      {hint && !error ? (
        <p id={hintId} className="mt-1 ml-6.5 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 ml-6.5 text-xs font-medium text-negative">
          Error: {error}
        </p>
      ) : null}
    </div>
  );
}

/** A fieldset with a legend, for the groups inside the creation flow. */
export function FieldGroup({
  legend,
  description,
  children,
  className = '',
}: {
  legend: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={className}>
      <legend className="text-base font-semibold text-ink">{legend}</legend>
      {description ? (
        <p className="mt-1 mb-4 max-w-prose text-sm text-ink-muted">{description}</p>
      ) : null}
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}
