import type { ReactNode } from 'react';

/**
 * Layout primitives.
 *
 * A `Panel` here is a bordered region with a title — not a floating card. The
 * difference matters: a card is an object that happens to contain information,
 * a panel is a division of a page. §24 asks for editorial section layouts rather
 * than a grid of cards, and the way to get there is to stop reaching for a card
 * whenever two things need separating.
 */

/** The page's horizontal measure. One place, so every page lines up. */
export function Container({
  children,
  className = '',
  width = 'default',
}: {
  children: ReactNode;
  className?: string;
  width?: 'default' | 'wide' | 'prose';
}) {
  const widths = {
    prose: 'max-w-3xl',
    default: 'max-w-6xl',
    wide: 'max-w-[90rem]',
  } as const;

  return (
    <div className={`mx-auto w-full ${widths[width]} px-5 sm:px-8 ${className}`}>{children}</div>
  );
}

/** A vertical section with the page's standard rhythm. */
export function Section({
  children,
  className = '',
  divided = false,
  id,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  /** Draw a hairline above, for sections that stack without headings. */
  divided?: boolean;
  /** Anchor target. The disclosures page is linked into by fragment. */
  id?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <Tag id={id} className={`${divided ? 'border-t border-rule' : ''} section ${className}`}>
      {children}
    </Tag>
  );
}

/**
 * A section heading with an optional action on the right.
 *
 * The heading is set in the display serif and the rule underneath runs the full
 * width. This is the repeating editorial unit of the whole app: a rule, a serif
 * line, and content. It replaces what would otherwise be a card header.
 */
export function SectionHeading({
  title,
  description,
  action,
  id,
  level = 2,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
  level?: 2 | 3;
}) {
  const Tag = (level === 2 ? 'h2' : 'h3') as 'h2';

  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-rule pb-3">
      <div className="min-w-0">
        <Tag id={id} className={level === 2 ? 'text-2xl sm:text-3xl' : 'text-lg'}>
          {title}
        </Tag>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * A bordered region.
 *
 * `tone="sunken"` drops it to the page's recessed ground, for a region that
 * supports rather than leads — the allocation preview in the creation flow, or
 * a fee table on a detail page.
 */
export function Panel({
  children,
  className = '',
  tone = 'surface',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'surface' | 'sunken' | 'bare';
  as?: 'div' | 'section' | 'aside';
}) {
  const tones = {
    surface: 'bg-surface border-rule',
    sunken: 'bg-sunken border-rule',
    bare: 'bg-transparent border-transparent',
  } as const;

  return <Tag className={`rounded border ${tones[tone]} ${className}`}>{children}</Tag>;
}

/**
 * A labelled region inside a panel.
 *
 * The label is small caps and the content sits under it, separated by a rule
 * only when the panel holds more than one such group. No shadow, no icon.
 */
export function PanelHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-rule px-5 py-3.5">
      <h3 className="text-sm font-semibold tracking-[-0.01em] text-ink">{title}</h3>
      <div className="flex items-center gap-3">
        {meta ? <span className="text-xs text-ink-muted">{meta}</span> : null}
        {action}
      </div>
    </div>
  );
}

/** A definition-list pair: label above, figure below. */
export function Detail({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}
