'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { BPS_DENOMINATOR, type Address, type Bps, type TransactionState } from '@thematic/types';
import { basketFactoryAbi, erc20Abi, thematicBasketAbi } from './abis.ts';
import { describeError, isUserRejection } from './errors.ts';
import { queryKeys } from './hooks.ts';
import type { DepositQuote, RedeemQuote } from './reads.ts';

/**
 * Writes: the transaction lifecycle from §20, and the five actions the app has.
 *
 * Two rules run through this file.
 *
 * **A submitted transaction is not a transaction that has happened.** §20 lists
 * `confirmed` and `failed` as the only terminal states, and no success state is
 * reached before a receipt exists. Nothing here optimistically reports success
 * from a hash.
 *
 * **No unbounded slippage.** §11 forbids `amountOutMin = 0` on a production
 * withdrawal, and the same reasoning covers `minSharesOut` and
 * `minSettlementOut`. Both are derived from a fresh quote and the basket's own
 * `maxSlippageBps`, so a transaction either fills near the number the user was
 * shown or reverts and costs gas. The user is never asked to accept "whatever
 * happens".
 */

/**
 * How long a signed transaction stays valid.
 *
 * Long enough to survive a wallet that takes its time over a slow block, short
 * enough that a quote abandoned in a background tab cannot be mined an hour
 * later against a price the user never saw. The contract enforces this; here it
 * is only the value passed in.
 */
const DEADLINE_SECONDS = 20 * 60;

function deadlineFromNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
}

/**
 * Reduces an amount by a slippage tolerance, flooring.
 *
 * Flooring is the safe direction for a minimum: it loosens the bound by at most
 * one smallest unit, where rounding up would tighten it and could revert a fill
 * that landed exactly on the tolerance.
 */
export function applySlippage(amount: bigint, slippageBps: Bps): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > BPS_DENOMINATOR) {
    throw new Error(`Slippage must be 0–${BPS_DENOMINATOR} basis points; received ${slippageBps}.`);
  }
  return (amount * BigInt(BPS_DENOMINATOR - slippageBps)) / BigInt(BPS_DENOMINATOR);
}

/** The state machine and the controls for one in-flight transaction. */
export interface TransactionController {
  state: TransactionState;
  /** Clears back to `idle`, for a form that has been dismissed. */
  reset: () => void;
  /** True while a transaction is in flight; the form should disable its controls. */
  busy: boolean;
  /** True once the transaction is confirmed and the app's data has caught up. */
  succeeded: boolean;
  /** Runs `send` through the lifecycle. Resolves with the hash, or `null` on any failure. */
  run: (send: () => Promise<Address>) => Promise<Address | null>;
}

/**
 * The §20 lifecycle, driven by one hook.
 *
 * The eight names map onto things that are genuinely distinguishable, rather
 * than onto eight shades of "waiting":
 *
 * | state             | what is true                                                     |
 * |-------------------|------------------------------------------------------------------|
 * | `idle`            | nothing in flight                                                 |
 * | `preparing`       | building the call, before the wallet has been asked               |
 * | `awaiting-wallet` | the wallet has been asked and has not answered                    |
 * | `confirming`      | a hash exists and the transaction is not yet in a block           |
 * | `pending`         | mined, and the app is re-reading the state it changed             |
 * | `confirmed`       | terminal: mined, succeeded, and the figures on screen are current |
 * | `failed`          | terminal: the chain rejected it                                   |
 * | `rejected`        | terminal: the user or the wallet declined                         |
 *
 * `pending` is a real step and not a decoration. A receipt arrives before the
 * app's cached reads have refetched, so declaring success at the receipt shows
 * the user their old balance next to a success message. Holding `pending` until
 * the invalidation settles removes that flash. It also costs nothing on a
 * Hardhat node with automine, where waiting for a second block for extra
 * confirmations would hang forever — which is why the terminal condition is the
 * refetch and not a confirmation depth.
 *
 * `rejected` is kept separate from `failed` on purpose. A user who closes a
 * wallet popup has not experienced a failure, and painting that red is one of
 * the most common ways a dApp feels broken when nothing is wrong.
 */
export function useTransactionController(): TransactionController {
  const [state, setState] = useState<TransactionState>({ status: 'idle', retryable: false });
  const [hash, setHash] = useState<Address | undefined>(undefined);
  const queryClient = useQueryClient();

  /** The receipt is handled once. Without this the effect re-runs on every render. */
  const settled = useRef(false);

  const receipt = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  useEffect(() => {
    if (!hash || settled.current) return;

    if (receipt.isError) {
      settled.current = true;
      const friendly = describeError(receipt.error);
      setState({ status: 'failed', hash, error: friendly.detail, retryable: friendly.retryable });
      return;
    }

    if (!receipt.isSuccess) return;

    settled.current = true;

    if (receipt.data.status !== 'success') {
      setState({
        status: 'failed',
        hash,
        error: 'The transaction was mined but reverted, so nothing changed.',
        retryable: true,
      });
      return;
    }

    // Mined, but the read cache still holds pre-transaction figures.
    setState({ status: 'pending', hash, retryable: false });

    let cancelled = false;
    void queryClient
      .invalidateQueries({ queryKey: queryKeys.all })
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        setState({ status: 'confirmed', hash, retryable: false });
      });

    return () => {
      cancelled = true;
    };
  }, [hash, receipt.isError, receipt.isSuccess, receipt.data, receipt.error, queryClient]);

  const run = useCallback(async (send: () => Promise<Address>): Promise<Address | null> => {
    settled.current = false;
    setHash(undefined);
    setState({ status: 'preparing', retryable: false });

    let sent: Address;
    try {
      setState({ status: 'awaiting-wallet', retryable: false });
      sent = await send();
    } catch (error) {
      if (isUserRejection(error)) {
        setState({ status: 'rejected', retryable: true });
        return null;
      }
      const friendly = describeError(error);
      setState({
        status: 'failed',
        error: friendly.detail,
        retryable: friendly.retryable,
      });
      return null;
    }

    setHash(sent);
    setState({ status: 'confirming', hash: sent, retryable: false });
    return sent;
  }, []);

  const reset = useCallback(() => {
    settled.current = false;
    setHash(undefined);
    setState({ status: 'idle', retryable: false });
  }, []);

  const { status } = state;
  const busy =
    status === 'preparing' ||
    status === 'awaiting-wallet' ||
    status === 'confirming' ||
    status === 'pending';

  return { state, reset, busy, succeeded: status === 'confirmed', run };
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

/**
 * Sets an ERC-20 allowance.
 *
 * Approves the exact amount rather than an unlimited allowance. An unlimited
 * approval to a basket contract is a standing permission that outlives the
 * deposit it was granted for, and there is no reason to ask for one when the
 * amount is known.
 */
export function useApproveToken() {
  const { writeContractAsync } = useWriteContract();
  const controller = useTransactionController();

  const approve = useCallback(
    async (token: Address, spender: Address, amount: bigint) =>
      controller.run(() =>
        writeContractAsync({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [spender, amount],
        }),
      ),
    [controller, writeContractAsync],
  );

  return { ...controller, approve };
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

/**
 * Deposits the settlement asset and mints basket tokens.
 *
 * `minSharesOut` comes from the quote the user was shown, reduced by the
 * basket's own `maxSlippageBps`. If the quote has gone stale the transaction
 * reverts with `DepositSlippageExceeded` rather than filling at a worse price,
 * and the user loses gas and nothing else.
 */
export function useDeposit(basket: Address | undefined, maxSlippageBps: Bps | undefined) {
  const { writeContractAsync } = useWriteContract();
  const controller = useTransactionController();

  const deposit = useCallback(
    async (amountIn: bigint, quote: DepositQuote) => {
      if (!basket) throw new Error('No basket address.');
      if (maxSlippageBps === undefined) {
        throw new Error('The basket’s slippage tolerance has not loaded yet.');
      }
      if (quote.sharesOut <= 0n) {
        throw new Error('This deposit would mint nothing, so it was not sent.');
      }

      const minSharesOut = applySlippage(quote.sharesOut, maxSlippageBps);

      return controller.run(() =>
        writeContractAsync({
          address: basket,
          abi: thematicBasketAbi,
          functionName: 'deposit',
          args: [amountIn, minSharesOut, deadlineFromNow()],
        }),
      );
    },
    [basket, controller, maxSlippageBps, writeContractAsync],
  );

  return { ...controller, deposit };
}

// ---------------------------------------------------------------------------
// Redeem
// ---------------------------------------------------------------------------

/**
 * Burns basket tokens and pays out the settlement asset.
 *
 * `minSettlementOut` is the quote reduced by the basket's tolerance and never
 * zero. A redemption with no floor lets a sandwich turn a position into dust,
 * which is what §11 rules out.
 */
export function useRedeem(basket: Address | undefined, maxSlippageBps: Bps | undefined) {
  const { writeContractAsync } = useWriteContract();
  const controller = useTransactionController();

  const redeem = useCallback(
    async (shares: bigint, quote: RedeemQuote) => {
      if (!basket) throw new Error('No basket address.');
      if (maxSlippageBps === undefined) {
        throw new Error('The basket’s slippage tolerance has not loaded yet.');
      }
      if (quote.settlementOut <= 0n) {
        throw new Error(
          'At current prices this redemption would pay out nothing. It was not sent, and your tokens are untouched.',
        );
      }

      const minSettlementOut = applySlippage(quote.settlementOut, maxSlippageBps);

      return controller.run(() =>
        writeContractAsync({
          address: basket,
          abi: thematicBasketAbi,
          functionName: 'redeem',
          args: [shares, minSettlementOut, deadlineFromNow()],
        }),
      );
    },
    [basket, controller, maxSlippageBps, writeContractAsync],
  );

  return { ...controller, redeem };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** The parameters a creator supplies. Everything else is read from the chain. */
export interface CreateBasketInput {
  name: string;
  symbol: string;
  description: string;
  theme: string;
  components: Address[];
  /** Basis points. Must total exactly `BPS_DENOMINATOR`. */
  weightsBps: number[];
  depositFeeBps: number;
  redeemFeeBps: number;
  creatorShareBps: number;
  maxSlippageBps: number;
}

/**
 * Creates a basket.
 *
 * `creator` comes from the connected account rather than from the form. The
 * contract would reject any other value, so passing the connected address
 * removes a parameter that could only ever be wrong.
 *
 * Weights are validated here as well as on-chain. The contract's
 * `InvalidWeightTotal` is the authority; checking first means the user sees the
 * problem in the form rather than paying gas to be told.
 */
export function useCreateBasket(factory: Address | undefined) {
  const { writeContractAsync } = useWriteContract();
  const { address: account } = useAccount();
  const controller = useTransactionController();

  const createBasket = useCallback(
    async (input: CreateBasketInput) => {
      if (!factory) throw new Error('No factory configured for this chain.');
      if (!account) throw new Error('Connect a wallet to create a basket.');
      if (input.components.length === 0) throw new Error('Add at least one component.');
      if (input.components.length !== input.weightsBps.length) {
        throw new Error('Every component needs a weight.');
      }

      const total = input.weightsBps.reduce((running, weight) => running + weight, 0);
      if (total !== BPS_DENOMINATOR) {
        throw new Error(
          `Weights must total exactly ${BPS_DENOMINATOR} basis points (100%); they total ${total}.`,
        );
      }

      return controller.run(() =>
        writeContractAsync({
          address: factory,
          abi: basketFactoryAbi,
          functionName: 'createBasket',
          args: [
            {
              name: input.name,
              symbol: input.symbol,
              description: input.description,
              theme: input.theme,
              components: input.components,
              weightsBps: input.weightsBps.map(BigInt),
              creator: account,
              depositFeeBps: input.depositFeeBps,
              redeemFeeBps: input.redeemFeeBps,
              creatorShareBps: input.creatorShareBps,
              maxSlippageBps: input.maxSlippageBps,
            },
          ],
        }),
      );
    },
    [account, controller, factory, writeContractAsync],
  );

  return { ...controller, createBasket };
}

// ---------------------------------------------------------------------------
// Creator fees
// ---------------------------------------------------------------------------

/** Claims a basket's accrued creator fees to the connected wallet. */
export function useClaimCreatorFees(basket: Address | undefined) {
  const { writeContractAsync } = useWriteContract();
  const controller = useTransactionController();

  const claim = useCallback(async () => {
    if (!basket) throw new Error('No basket address.');
    return controller.run(() =>
      writeContractAsync({
        address: basket,
        abi: thematicBasketAbi,
        functionName: 'claimCreatorFees',
      }),
    );
  }, [basket, controller, writeContractAsync]);

  return { ...controller, claim };
}
