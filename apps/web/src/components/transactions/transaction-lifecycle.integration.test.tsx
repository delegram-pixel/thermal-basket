import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  encodeErrorResult,
  type Abi,
  type AbiParameter,
  type Address,
} from 'viem';
import {
  describeError,
  useTransactionController,
  type TransactionController,
} from '@thematic/blockchain';
import { TransactionStatusPanel } from './transaction-status.tsx';

/**
 * The lifecycle's write half, wired to the surface that reports it (§20, §21).
 *
 * This is the integration leg. `errors.test.ts` proves the mapper maps, and
 * `transaction-status.test.tsx` proves the panel renders a state it is handed —
 * but neither proves the two agree, and the value that travels between them is
 * the only thing that decides what a user sees after a failed deposit. Three
 * separate things could drift and none of the unit tests would notice: the
 * mapper's `detail` reaching `state.error` unaltered, its `retryable` flag
 * deciding whether the panel offers a button, and a wallet rejection being
 * routed to `rejected` rather than `failed`. Each is asserted below through the
 * real controller with a real viem error.
 *
 * What is mocked is only what needs a wallet: `useChainId` and
 * `useWaitForTransactionReceipt`. Real wagmi is kept in the module graph rather
 * than replaced, because `client.ts` builds the wagmi config at import time and
 * a factory that dropped `createConfig` would take this file down before the
 * first assertion.
 */

const BSC_TESTNET = 97;

const { useChainIdMock, receiptMock } = vi.hoisted(() => ({
  useChainIdMock: vi.fn(),
  receiptMock: vi.fn(),
}));

/** Real wagmi, with the two hooks that would otherwise demand a provider replaced. */
vi.mock('wagmi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('wagmi')>()),
  useChainId: useChainIdMock,
  useWaitForTransactionReceipt: receiptMock,
}));

/**
 * Real react-query, with the client faked.
 *
 * Partial for the same reason as above: `hooks.ts` is in this module graph and
 * imports `useQuery`, so a factory exporting only `useQueryClient` would leave
 * that binding undefined.
 */
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }),
}));

const HASH: Address = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

/** An ABI fragment declaring one custom error. */
function errorAbi(name: string, inputs: readonly AbiParameter[] = []): Abi {
  return [{ type: 'error', name, inputs }] as unknown as Abi;
}

/** The revert viem produces when the chain rejects a call with `name`. */
function revertedWith(name: string): ContractFunctionRevertedError {
  const abi = errorAbi(name);
  const data = encodeErrorResult({ abi, errorName: name, args: [] });
  return new ContractFunctionRevertedError({ abi, data, functionName: 'deposit' });
}

/**
 * The controller under test, captured out of the render.
 *
 * Assigned during render rather than in an effect: an effect would only have the
 * controller from the commit *before* the state it set, which is exactly the
 * value these tests are about.
 */
const captured: { controller?: TransactionController } = {};

function Probe() {
  captured.controller = useTransactionController();
  return null;
}

/** Runs the controller to a terminal state by rejecting the send. */
async function runFailing(error: unknown) {
  render(<Probe />);

  await act(async () => {
    // `run` is `useCallback(…, [])`, so its identity survives a re-render, but
    // `state` does not: the controller is rebuilt on every render around a fresh
    // snapshot. The one that exists before this call still says `idle`, so the
    // updated controller has to be read back after the act rather than before.
    await captured.controller!.run(() => Promise.reject(error));
  });

  return captured.controller!;
}

beforeEach(() => {
  captured.controller = undefined;
  useChainIdMock.mockReturnValue(BSC_TESTNET);
  // No hash yet and no receipt: the effect that watches one stays out of the way.
  receiptMock.mockReturnValue({
    isError: false,
    isSuccess: false,
    data: undefined,
    error: undefined,
  });
});

describe('a reverted write, from the chain to the screen', () => {
  it('carries the mapper’s sentence through to the panel unaltered', async () => {
    // The seam. The panel renders `state.error` and nothing else of the failure,
    // so if the controller stopped assigning `friendly.detail` the user would be
    // shown an empty panel for a revert the protocol explains precisely.
    const revert = revertedWith('DepositSlippageExceeded');
    const friendly = describeError(revert);

    const controller = await runFailing(revert);

    expect(controller.state.status).toBe('failed');
    expect(controller.state.error).toBe(friendly.detail);
    expect(controller.succeeded).toBe(false);
    expect(controller.busy).toBe(false);
  });

  it('shows that sentence, and offers a retry, for a failure a fresh quote fixes', async () => {
    const revert = revertedWith('DepositSlippageExceeded');
    const friendly = describeError(revert);
    const controller = await runFailing(revert);

    render(<TransactionStatusPanel state={controller.state} onRetry={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('Transaction failed')).toBeInTheDocument();
    expect(screen.getByText(friendly.detail)).toBeInTheDocument();
    // `retryable` is true for slippage — asserted as the concrete outcome rather
    // than by reading the flag back, which would pass even if the panel ignored it.
    expect(friendly.retryable).toBe(true);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('withholds the retry when the mapper says retrying cannot help', async () => {
    // Approving is the fix for a missing allowance, and retrying the same call
    // fails identically. The flag has to reach the panel for the button to be
    // suppressed, which is the half `errors.test.ts` cannot see.
    const revert = revertedWith('ERC20InsufficientAllowance');
    const friendly = describeError(revert);
    const controller = await runFailing(revert);

    render(<TransactionStatusPanel state={controller.state} onRetry={vi.fn()} />);

    expect(friendly.retryable).toBe(false);
    expect(screen.getByText(friendly.detail)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('a wallet rejection, from the wallet to the screen', () => {
  it('is routed to a decision rather than a failure', async () => {
    const controller = await runFailing(
      new UserRejectedRequestError(new Error('User denied transaction signature.')),
    );

    expect(controller.state.status).toBe('rejected');

    render(<TransactionStatusPanel state={controller.state} onDismiss={vi.fn()} />);

    // Not red, and not an alert: the user did what the prompt allowed.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Cancelled in your wallet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('a write that reaches the chain', () => {
  it('reports confirming rather than success, because no receipt exists yet', async () => {
    // §20: `confirmed` is terminal and means mined. Declaring it from a hash
    // alone is the bug this pins — the panel must not say the position was
    // updated before the transaction is in a block.
    render(<Probe />);

    await act(async () => {
      await captured.controller!.run(() => Promise.resolve(HASH));
    });

    // Read back after the act, for the reason given on `runFailing`.
    const controller = captured.controller!;

    expect(controller.state.status).toBe('confirming');
    expect(controller.state.hash).toBe(HASH);
    expect(controller.busy).toBe(true);
    expect(controller.succeeded).toBe(false);

    render(<TransactionStatusPanel state={controller.state} />);

    expect(screen.getByText('Confirming on the network')).toBeInTheDocument();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.getByRole('link', { name: /View transaction/ })).toHaveAttribute(
      'href',
      `https://testnet.bscscan.com/tx/${HASH}`,
    );
  });
});
