'use client';

import { useChainId } from 'wagmi';
import { explorerTxUrl } from '@thematic/config';
import type { TransactionState, TransactionStatus } from '@thematic/types';
import { Button, Spinner } from '@/components/ui/button.tsx';
import { RiskMark } from '@/components/ui/states.tsx';

/**
 * The transaction lifecycle (§20, §21).
 *
 * Every state below is announced via `aria-live`, so a screen reader user learns
 * that a deposit is confirming without having to go looking for it. That is §29's
 * "screen-reader-friendly transaction states", and it is the requirement most
 * often dropped because the visual version looks finished without it.
 *
 * The two failures are worded differently and coloured differently on purpose.
 * `rejected` is not an error — the user closed their wallet, which is a decision
 * — and painting it red teaches people to distrust a thing that is working.
 */

/** What each state is called, in the user's terms rather than the machine's. */
const LABELS: Record<TransactionStatus, string> = {
  idle: '',
  preparing: 'Preparing transaction',
  'awaiting-wallet': 'Waiting for your wallet',
  confirming: 'Confirming on the network',
  pending: 'Updating your position',
  confirmed: 'Done',
  failed: 'Transaction failed',
  rejected: 'Cancelled in your wallet',
};

const EXPLANATIONS: Partial<Record<TransactionStatus, string>> = {
  preparing: 'Building the transaction so your wallet can review it.',
  'awaiting-wallet': 'Approve or reject it in your wallet. Nothing is sent until you approve.',
  confirming: 'Submitted and waiting to be included in a block. This usually takes a few seconds.',
  pending:
    'The transaction is mined. Re-reading your balances so the figures on screen are current.',
  confirmed: 'The transaction is confirmed and your position has been updated.',
};

/**
 * The four states that are still moving.
 *
 * Ordered so the indicator fills in as the transaction progresses rather than
 * resetting to a spinner at each step — a progress display that restarts four
 * times reads as four separate things going wrong.
 */
const STEPS = ['awaiting-wallet', 'confirming', 'pending', 'confirmed'] as const;

export function TransactionStatusPanel({
  state,
  onRetry,
  onDismiss,
  retryLabel = 'Try again',
  className = '',
}: {
  state: TransactionState;
  onRetry?: () => void;
  onDismiss?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  const chainId = useChainId();

  if (state.status === 'idle') return null;

  const active =
    state.status === 'confirmed' || state.status === 'failed' || state.status === 'rejected'
      ? -1
      : STEPS.indexOf(state.status as (typeof STEPS)[number]);

  const isFailure = state.status === 'failed';
  const isRejection = state.status === 'rejected';

  return (
    <div
      role={isFailure ? 'alert' : 'status'}
      aria-live={isFailure ? 'assertive' : 'polite'}
      className={[
        'rounded border px-4 py-3.5',
        isFailure ? 'border-negative/30 bg-negative-soft' : '',
        isRejection ? 'border-warning/35 bg-warning-soft' : '',
        !isFailure && !isRejection ? 'border-rule bg-sunken' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start gap-3">
        {isFailure ? (
          <RiskMark tone="negative" />
        ) : isRejection ? (
          <RiskMark tone="warning" />
        ) : state.status === 'confirmed' ? (
          <RiskMark tone="positive" />
        ) : (
          <Spinner className="mt-0.5 text-accent" />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{LABELS[state.status]}</p>

          {EXPLANATIONS[state.status] ? (
            <p className="mt-0.5 text-sm text-ink-muted">{EXPLANATIONS[state.status]}</p>
          ) : null}

          {/* The failure detail is already a sentence — `describeError` produced
              it — and it says whether anything moved. */}
          {state.error ? <p className="mt-1 text-sm text-ink-muted">{state.error}</p> : null}

          {/* A stepper rather than a percentage. A confirmation has no
              percentage; inventing one is the most common lie in a transaction
              UI. */}
          {active >= 0 ? (
            <ol className="mt-2.5 flex items-center gap-1.5" aria-hidden="true">
              {STEPS.map((step, index) => (
                <li
                  key={step}
                  className={`h-0.5 flex-1 rounded-full transition-colors ${
                    index <= active ? 'bg-accent' : 'bg-rule-strong'
                  }`}
                />
              ))}
            </ol>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            {state.hash ? <HashLink hash={state.hash} chainId={chainId} /> : null}

            {isFailure && state.retryable && onRetry ? (
              <Button size="sm" variant="secondary" onClick={onRetry}>
                {retryLabel}
              </Button>
            ) : null}

            {isRejection && onDismiss ? (
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The transaction hash, as a link to the explorer.
 *
 * On a local chain there is no explorer, so the hash is shown as plain text with
 * a copy affordance rather than as a link that goes nowhere. §21 asks for the
 * explorer link; it does not ask for a broken one.
 */
function HashLink({ hash, chainId }: { hash: string; chainId: number }) {
  const url = explorerTxUrl(chainId, hash);

  if (!url) {
    return (
      <span className="figure text-xs break-all text-ink-faint">
        {hash}
        <span className="ml-1.5 font-sans">(no explorer on this network)</span>
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="text-xs text-accent underline decoration-rule-strong underline-offset-2 hover:decoration-accent"
    >
      View transaction
      <span className="sr-only"> {hash} on the block explorer</span>
    </a>
  );
}
