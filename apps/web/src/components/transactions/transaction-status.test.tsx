import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionState, TransactionStatus } from '@thematic/types';
import { TransactionStatusPanel } from './transaction-status.tsx';

/**
 * The transaction lifecycle (§20, §21, §29).
 *
 * What is asserted here is mostly not visual. §29 asks for transaction states a
 * screen reader can follow, so the load-bearing claims are `role` and
 * `aria-live` — a deposit that confirms silently is a deposit the user has to
 * go hunting for. The rest is the wording split that matters: a wallet
 * rejection is a decision and is not painted as a failure.
 */

const { useChainIdMock } = vi.hoisted(() => ({ useChainIdMock: vi.fn() }));

/**
 * A whole-module factory rather than `importOriginal`.
 *
 * The panel takes exactly one thing from wagmi, so loading wagmi's real module
 * graph — core, connectors and the rest — into jsdom buys nothing and adds a
 * module that can fail to evaluate before the first assertion runs. If a future
 * edit adds a second wagmi import, this fails loudly with `undefined is not a
 * function`, which is the right signal.
 */
vi.mock('wagmi', () => ({ useChainId: useChainIdMock }));

const BSC_TESTNET = 97;
const HARDHAT = 31_337;

const HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

function state(
  overrides: Partial<TransactionState> & { status: TransactionStatus },
): TransactionState {
  return { retryable: false, ...overrides };
}

/** Renders the panel on BscScan testnet, where a hash has somewhere to link to. */
function show(
  value: TransactionState,
  props: { onRetry?: () => void; onDismiss?: () => void; retryLabel?: string } = {},
) {
  useChainIdMock.mockReturnValue(BSC_TESTNET);
  return render(<TransactionStatusPanel state={value} {...props} />);
}

/**
 * The class list of the mark beside the headline — the only non-textual signal
 * carrying the state's meaning.
 *
 * Returns a string rather than `null`, so a missing mark fails the assertion
 * with the tone it wanted rather than with a `toContain` on undefined.
 */
function mark(container: HTMLElement): string {
  return container.querySelector('svg')?.getAttribute('class') ?? '';
}

/**
 * The spinner's class list.
 *
 * Separate from `mark` because the in-flight states do not draw a `RiskMark` at
 * all: `Spinner` is a `<span>` with a CSS border, so a `querySelector('svg')`
 * finds nothing and would report the absence as a colour mismatch.
 */
function spinner(container: HTMLElement): string {
  return container.querySelector('.animate-spin')?.getAttribute('class') ?? '';
}

beforeEach(() => {
  useChainIdMock.mockReturnValue(BSC_TESTNET);
});

describe('TransactionStatusPanel — idle', () => {
  it('renders nothing at all, because there is no transaction to talk about', () => {
    const { container } = render(<TransactionStatusPanel state={state({ status: 'idle' })} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('TransactionStatusPanel — the states in flight', () => {
  const CASES: Array<{ status: TransactionStatus; label: string }> = [
    { status: 'preparing', label: 'Preparing transaction' },
    { status: 'awaiting-wallet', label: 'Waiting for your wallet' },
    { status: 'confirming', label: 'Confirming on the network' },
    { status: 'pending', label: 'Updating your position' },
  ];

  for (const { status, label } of CASES) {
    it(`announces "${label}" politely, without interrupting`, () => {
      // `polite` and not `assertive`: nothing has gone wrong, and cutting across
      // whatever the user is reading to say "still working" is noise.
      const { container } = show(state({ status }));

      const panel = screen.getByRole('status');
      expect(panel).toHaveAttribute('aria-live', 'polite');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(spinner(container)).toContain('text-accent');
    });

    it(`explains "${label}" in words rather than leaving a bare status`, () => {
      // Two paragraphs: the headline, and a sentence saying what is happening
      // and whether the user needs to do anything. A bare status label leaves a
      // first-time user unsure whether they are supposed to act.
      const { container } = show(state({ status }));

      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs.length).toBeGreaterThan(1);
      expect(paragraphs[1]!.textContent!.length).toBeGreaterThan(20);
    });
  }

  it('tells the user nothing has been sent while their wallet is open', () => {
    // The single most useful sentence in the flow: a wallet prompt looks like a
    // transaction, and this is the moment to say it is not one yet.
    show(state({ status: 'awaiting-wallet' }));

    expect(screen.getByText(/Nothing is sent until you approve/i)).toBeInTheDocument();
  });

  it('says why the figures on screen are about to change once it is mined', () => {
    show(state({ status: 'pending' }));

    expect(screen.getByText(/re-reading your balances/i)).toBeInTheDocument();
  });
});

describe('TransactionStatusPanel — the progress indicator', () => {
  it('draws a stepper once the transaction has left the wallet', () => {
    const { container } = show(state({ status: 'awaiting-wallet' }));

    expect(container.querySelector('ol')).not.toBeNull();
  });

  it('draws no stepper while the transaction is still being built', () => {
    // `preparing` is not a step: the stepper tracks the wait for the network,
    // and showing it before the wallet has even been asked would be a progress
    // bar for something that has not started.
    const { container } = show(state({ status: 'preparing' }));

    expect(container.querySelector('ol')).toBeNull();
  });

  it('draws no stepper on a finished transaction, rather than parking it at the end', () => {
    // A full bar sitting under "Done" is a progress indicator that never
    // finishes. Confirmation is stated in words instead.
    for (const status of ['confirmed', 'failed', 'rejected'] as const) {
      const { container } = show(state({ status }));
      expect(container.querySelector('ol'), status).toBeNull();
    }
  });

  it('hides the stepper from assistive technology, since the words already say it', () => {
    const { container } = show(state({ status: 'confirming' }));

    expect(container.querySelector('ol')).toHaveAttribute('aria-hidden', 'true');
  });

  it('never shows a percentage, which would be invented', () => {
    // A confirmation has no percentage, and a fabricated one is the most common
    // lie in a transaction UI.
    for (const status of ['awaiting-wallet', 'confirming', 'pending'] as const) {
      const { container } = show(state({ status }));
      expect(container.textContent, status).not.toMatch(/\d+\s*%/);
    }
  });
});

describe('TransactionStatusPanel — confirmed', () => {
  it('states the outcome rather than describing the process', () => {
    show(state({ status: 'confirmed' }));

    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('marks it positively, and not as a failure', () => {
    const { container } = show(state({ status: 'confirmed' }));

    expect(mark(container)).toContain('text-positive');
  });

  it('says the position was updated, so the user knows the numbers moved', () => {
    show(state({ status: 'confirmed' }));

    expect(screen.getByText(/your position has been updated/i)).toBeInTheDocument();
  });
});

describe('TransactionStatusPanel — failed', () => {
  it('interrupts, because this one the user has to act on', () => {
    // The only state that uses `assertive`. A failure that waits for a pause in
    // the reader is a failure they find out about late.
    show(state({ status: 'failed', error: 'Price moved — nothing was spent.' }));

    const panel = screen.getByRole('alert');
    expect(panel).toHaveAttribute('aria-live', 'assertive');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the sentence the error mapper produced, not a code', () => {
    show(state({ status: 'failed', error: 'Price moved — nothing was spent.' }));

    expect(screen.getByText('Price moved — nothing was spent.')).toBeInTheDocument();
  });

  it('marks it negatively', () => {
    const { container } = show(state({ status: 'failed', error: 'no' }));

    expect(mark(container)).toContain('text-negative');
  });

  it('offers a retry only when the failure is one a retry can fix', () => {
    const onRetry = vi.fn();
    show(state({ status: 'failed', error: 'Price moved.', retryable: true }), { onRetry });

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('suppresses the retry when the error is not retryable', () => {
    // An "Approval needed" failure retried without approving fails identically.
    // Offering the button teaches the user that the button does not work.
    const onRetry = vi.fn();
    show(state({ status: 'failed', error: 'Approval needed.', retryable: false }), { onRetry });

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('suppresses the retry when the caller supplied no handler', () => {
    show(state({ status: 'failed', error: 'Price moved.', retryable: true }));

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('passes the click through to the caller', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    show(state({ status: 'failed', error: 'Price moved.', retryable: true }), { onRetry });

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('takes a caller-supplied retry label, for the places where "try again" is wrong', () => {
    show(state({ status: 'failed', error: 'Approval needed.', retryable: true }), {
      onRetry: vi.fn(),
      retryLabel: 'Approve and retry',
    });

    expect(screen.getByRole('button', { name: 'Approve and retry' })).toBeInTheDocument();
  });
});

describe('TransactionStatusPanel — rejected', () => {
  it('is a status, not an alert: the user made a decision', () => {
    show(state({ status: 'rejected' }));

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not paint a cancelled transaction red', () => {
    // Colour is the app teaching cause and effect. Red here would train people
    // to distrust a wallet prompt that is working exactly as designed.
    const { container } = show(state({ status: 'rejected' }));

    expect(mark(container)).toContain('text-warning');
    expect(screen.getByRole('status').className).toContain('bg-warning-soft');
    expect(screen.getByRole('status').className).not.toContain('bg-negative-soft');
  });

  it('says where the cancellation happened, so it does not read as a failure', () => {
    show(state({ status: 'rejected' }));

    expect(screen.getByText('Cancelled in your wallet')).toBeInTheDocument();
  });

  it('offers a dismiss rather than a retry, because there is nothing to retry', () => {
    const onDismiss = vi.fn();
    show(state({ status: 'rejected' }), { onDismiss });

    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('passes the dismissal through to the caller', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    show(state({ status: 'rejected' }), { onDismiss });

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders without a dismiss button when the caller has nowhere to dismiss to', () => {
    show(state({ status: 'rejected' }));

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('TransactionStatusPanel — the explorer link', () => {
  it('links the hash to the block explorer where there is one', () => {
    show(state({ status: 'confirming', hash: HASH }));

    const link = screen.getByRole('link', { name: /View transaction/ });
    expect(link).toHaveAttribute('href', `https://testnet.bscscan.com/tx/${HASH}`);
  });

  it('opens the explorer in a new tab without handing over the opener', () => {
    show(state({ status: 'confirming', hash: HASH }));

    const link = screen.getByRole('link', { name: /View transaction/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('includes the hash in the link’s accessible name, so it is not just "View transaction"', () => {
    show(state({ status: 'confirming', hash: HASH }));

    expect(screen.getByRole('link', { name: new RegExp(HASH) })).toBeInTheDocument();
  });

  it('shows the hash as plain text on a chain with no explorer', () => {
    // §21 asks for an explorer link; it does not ask for a broken one. Hardhat
    // has no block explorer, so there is genuinely nowhere to send the user.
    useChainIdMock.mockReturnValue(HARDHAT);
    render(<TransactionStatusPanel state={state({ status: 'confirming', hash: HASH })} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(HASH)).toBeInTheDocument();
    expect(screen.getByText('(no explorer on this network)')).toBeInTheDocument();
  });

  it('shows no link at all before there is a hash', () => {
    show(state({ status: 'awaiting-wallet' }));

    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps the link available on a confirmed transaction, which is when it is wanted', () => {
    show(state({ status: 'confirmed', hash: HASH }));

    expect(screen.getByRole('link', { name: /View transaction/ })).toBeInTheDocument();
  });

  it('keeps the link available on a failed transaction, so the revert can be inspected', () => {
    show(state({ status: 'failed', hash: HASH, error: 'Reverted.' }));

    expect(screen.getByRole('link', { name: /View transaction/ })).toBeInTheDocument();
  });

  it('tolerates a chain the app does not support, which a wallet can land on', () => {
    useChainIdMock.mockReturnValue(1);
    render(<TransactionStatusPanel state={state({ status: 'confirming', hash: HASH })} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('(no explorer on this network)')).toBeInTheDocument();
  });
});
