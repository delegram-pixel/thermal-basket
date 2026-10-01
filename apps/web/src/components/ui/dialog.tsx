'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A modal dialog.
 *
 * Written out rather than pulled from a library because the four things that
 * make a modal usable are all behaviour, not styling, and they are the four
 * things a hand-rolled one usually gets wrong:
 *
 * 1. Focus moves into the dialog when it opens and returns to the control that
 *    opened it when it closes. Without the second half, a keyboard user is
 *    dropped back at the top of the document.
 * 2. Tab cycles inside the dialog. A modal you can tab out of is a modal that
 *    let someone interact with the page behind it.
 * 3. Escape closes it.
 * 4. The page behind it does not scroll, and the dialog is announced as a
 *    dialog with a name.
 *
 * The backdrop is flat, not blurred. §24 rules out decorative glass, and a
 * blurred backdrop on a page of financial figures makes the figures harder to
 * compare, which is the opposite of what a confirmation step is for.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const close = useCallback(() => onClose(), [onClose]);

  // Move focus in on open, and back to the opener on close.
  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    // The first control, or the panel itself when there is none — a dialog
    // holding only a paragraph still needs to take focus, or Escape reaches
    // the document instead.
    const focusable = panel?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open]);

  // Escape to close, and Tab kept inside.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* The backdrop is a button so a click anywhere on it closes the dialog
          and so it is not a mouse-only affordance. */}
      <button
        type="button"
        aria-label="Close dialog"
        onClick={close}
        className="absolute inset-0 cursor-default bg-ink/35"
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={[
          'relative flex max-h-[92dvh] w-full flex-col border border-rule-strong bg-surface shadow-xl',
          // A sheet rising from the bottom on a phone, a centred panel above it.
          // §28 asks for mobile to be a different layout, not a smaller one.
          'rounded-t-lg sm:rounded-lg',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
          'animate-rise',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-6 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-xl text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-sm text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-mr-1.5 -mt-1 rounded p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-rule px-5 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
