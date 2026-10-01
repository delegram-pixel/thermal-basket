'use client';

import type { ReactNode } from 'react';
import { useIsMockEnvironment } from '@thematic/blockchain';
import { RiskMark } from './states.tsx';

/**
 * Notices: short blocks of text that tell the reader something about the figures
 * around them.
 *
 * These are deliberately not dismissible. A risk disclosure a user can close is
 * a risk disclosure that is absent for everyone who closed it once, and §49 asks
 * for it to be present, not for it to have been present.
 */

type Tone = 'info' | 'warning' | 'negative' | 'neutral';

const TONES: Record<Tone, { shell: string; text: string }> = {
  info: { shell: 'border-info/25 bg-info-soft', text: 'text-info' },
  warning: { shell: 'border-warning/30 bg-warning-soft', text: 'text-warning' },
  negative: { shell: 'border-negative/30 bg-negative-soft', text: 'text-negative' },
  neutral: { shell: 'border-rule bg-sunken', text: 'text-ink-muted' },
};

export function Notice({
  tone = 'info',
  title,
  children,
  className = '',
  compact = false,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const style = TONES[tone];

  return (
    <div
      className={`rounded border ${style.shell} ${compact ? 'px-4 py-3' : 'px-5 py-4'} ${className}`}
    >
      <div className="flex items-start gap-3">
        <RiskMark tone={tone === 'neutral' ? 'info' : tone} />
        <div className="min-w-0 flex-1">
          {title ? <p className="text-sm font-semibold text-ink">{title}</p> : null}
          <div
            className={`text-sm text-ink-muted ${title ? 'mt-1' : ''} [&_a]:text-accent [&_a]:underline [&_a]:decoration-rule-strong [&_a]:underline-offset-2 [&_a:hover]:decoration-accent`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The mock-price disclosure (§10, §39, §49).
 *
 * Renders nothing on a chain where the prices are real, and states plainly that
 * they are not on one where they are fabricated. It is placed next to figures
 * rather than only in a page footer, because §39's requirement is that a mock
 * price is never shown *unqualified* — a footnote at the bottom of the page does
 * not qualify a number at the top of it.
 *
 * Renders as a client component so it can read the connected chain. A wallet on
 * BNB testnet sees it; the same build served on mainnet would not.
 */
export function MockDataNotice({
  subject = 'The prices and valuations on this page',
  compact = false,
}: {
  /** A complete clause, capitalised, naming what the mock feed produced. */
  subject?: string;
  compact?: boolean;
}) {
  const isMock = useIsMockEnvironment();
  if (!isMock) return null;

  return (
    <Notice tone="warning" compact={compact} title="Simulated market data">
      {subject} come from a mock price feed deployed by this project. They are not market data, they
      do not track any real security, and nothing here is a quotation.{' '}
      <a href="/disclosures">What is real on this deployment</a>.
    </Notice>
  );
}
