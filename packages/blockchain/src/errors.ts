import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem';

/**
 * Turning revert data into something a person can act on.
 *
 * §21 requires that raw RPC errors never be the primary UX and that common
 * failures map to understandable messages. §34 requires the same. Doing it here,
 * once, rather than at each call site, is what makes that true everywhere
 * instead of in the three places someone remembered.
 *
 * Every message below says two things: what happened, and whether anything
 * moved. That second half is the one users actually need — "Price moved" is
 * alarming until you know the transaction reverted and nothing was spent.
 *
 * The names come from the compiled ABIs. A custom error declared only in a
 * library does not appear in a consuming contract's ABI, which is why several
 * names below are restated in both `ThematicBasket` and `BasketFactory`; if a
 * name here ever goes unmatched, the fallback still produces a usable message
 * rather than a selector.
 */

export interface FriendlyError {
  /** Headline, a few words. */
  title: string;
  /** What happened and what to do about it. */
  detail: string;
  /** Whether retrying the same intent could plausibly succeed. */
  retryable: boolean;
}

const MESSAGES: Record<string, FriendlyError> = {
  // -- Slippage and the user's own bounds ---------------------------------
  DepositSlippageExceeded: {
    title: 'Price moved',
    detail:
      'The swaps filled below the minimum you set, so the deposit was cancelled. Nothing was spent — request a fresh quote and try again.',
    retryable: true,
  },
  RedemptionSlippageExceeded: {
    title: 'Price moved',
    detail:
      'Selling the basket’s assets returned less than the minimum you set, so the redemption was cancelled. Your basket tokens were not burned.',
    retryable: true,
  },
  InsufficientSharesOut: {
    title: 'Fewer tokens than your minimum',
    detail:
      'The deposit would have minted less than the minimum you accepted. It was cancelled and nothing was spent.',
    retryable: true,
  },
  DeadlineExpired: {
    title: 'Quote expired',
    detail:
      'This transaction carried a deadline that has passed. Nothing was spent — start again to get a current quote.',
    retryable: true,
  },

  // -- Amounts the basket cannot act on -----------------------------------
  DepositTooSmall: {
    title: 'Deposit is too small',
    detail:
      'After the fee there is not enough left to buy every component, so nothing was deposited. Try a larger amount.',
    retryable: false,
  },
  RedemptionTooSmall: {
    title: 'Redemption is too small',
    detail:
      'The basket cannot sell a slice this small across every component. Redeem a larger number of basket tokens.',
    retryable: false,
  },
  RedemptionYieldsNothing: {
    title: 'This redemption pays out nothing',
    detail:
      'At current prices the sale would return zero, so it was cancelled rather than burning your tokens for nothing. Your position is unchanged.',
    retryable: false,
  },
  ZeroAmount: {
    title: 'Enter an amount',
    detail: 'The amount must be greater than zero.',
    retryable: false,
  },

  // -- Valuation ----------------------------------------------------------
  ComponentNotPriceable: {
    title: 'No price available',
    detail:
      'The price feed has no usable price for at least one of the basket’s components, so the basket cannot be valued right now. Nothing moved. This is a problem with the feed, not with your wallet.',
    retryable: false,
  },
  UnsupportedSettlementToken: {
    title: 'Unsupported settlement asset',
    detail: 'This basket does not settle in the token you are trying to use.',
    retryable: false,
  },

  // -- Basket state -------------------------------------------------------
  EnforcedPause: {
    title: 'This basket is paused',
    detail:
      'Deposits and redemptions are halted while the protocol looks into something. Your tokens are unaffected and still transferable.',
    retryable: false,
  },
  ExpectedPause: {
    title: 'Already running',
    detail: 'This basket is not paused, so there is nothing to resume.',
    retryable: false,
  },
  ReentrancyGuardReentrantCall: {
    title: 'Transaction blocked',
    detail:
      'The call re-entered the basket, which the contract refuses. Nothing moved. If you are using a contract wallet, try a plain transfer instead.',
    retryable: false,
  },

  // -- Authority ----------------------------------------------------------
  NotCreator: {
    title: 'Not the creator',
    detail: 'Only the address that created this basket can claim its creator fees.',
    retryable: false,
  },
  NotProtocolAdmin: {
    title: 'Not the protocol admin',
    detail: 'This action is restricted to the protocol administrator.',
    retryable: false,
  },
  NothingToClaim: {
    title: 'Nothing to claim',
    detail: 'This basket has no fees accrued to you yet. Fees accrue as people deposit and redeem.',
    retryable: false,
  },

  // -- Token mechanics ----------------------------------------------------
  ERC20InsufficientAllowance: {
    title: 'Approval needed',
    detail:
      'The basket needs an allowance before it can move your tokens. Approve the amount and the deposit will go through.',
    retryable: false,
  },
  ERC20InsufficientBalance: {
    title: 'Not enough balance',
    detail: 'Your wallet does not hold this much of that token.',
    retryable: false,
  },
  SafeERC20FailedOperation: {
    title: 'The token refused the transfer',
    detail:
      'One of the tokens involved rejected the transfer. Nothing moved. Some tokens apply transfer restrictions this protocol does not support.',
    retryable: false,
  },

  // -- Basket creation ----------------------------------------------------
  ComponentNotAllowed: {
    title: 'Component not permitted',
    detail:
      'The protocol is currently restricting which assets may be used. This one is not on the list, so the basket was not created.',
    retryable: false,
  },
  FeeTooHigh: {
    title: 'Fee above the ceiling',
    detail:
      'One of the fee parameters is above the maximum the protocol currently permits. Lower it and try again.',
    retryable: false,
  },
  InvalidWeightTotal: {
    title: 'Weights must total 100%',
    detail:
      'Component weights are basis points and must sum to exactly 10,000. Adjust the allocation and try again.',
    retryable: false,
  },
  WeightLengthMismatch: {
    title: 'Every component needs a weight',
    detail: 'The number of weights does not match the number of components.',
    retryable: false,
  },
  TooManyComponents: {
    title: 'Too many components',
    detail:
      'A basket is capped at ten components. Every deposit and redemption loops over them, and the cap is what keeps those actions affordable.',
    retryable: false,
  },
  NoComponents: {
    title: 'Add at least one component',
    detail: 'A basket needs at least one asset.',
    retryable: false,
  },
  DuplicateComponent: {
    title: 'Asset listed twice',
    detail: 'Combine the two entries into one weight instead — the same asset cannot appear twice.',
    retryable: false,
  },
  ZeroWeight: {
    title: 'An asset has no weight',
    detail: 'Remove the asset or give it a weight above zero.',
    retryable: false,
  },
  InvalidName: {
    title: 'Name required',
    detail: 'Give the basket a name before creating it.',
    retryable: false,
  },
  SettlementTokenIsComponent: {
    title: 'Cannot include the settlement asset',
    detail:
      'The asset people pay with cannot also be a component of the basket. Remove it and try again.',
    retryable: false,
  },
  ComponentNotERC20Metadata: {
    title: 'Not a supported token',
    detail:
      'One of the addresses is not an ERC-20 that reports its name, symbol and decimals. Check the addresses and try again.',
    retryable: false,
  },
  ComponentDecimalsTooHigh: {
    title: 'Unsupported token decimals',
    detail: 'One of the components reports more decimals than the protocol will value.',
    retryable: false,
  },
  AddressHasNoCode: {
    title: 'Address holds no contract',
    detail: 'One of the addresses is an account, not a token contract.',
    retryable: false,
  },
  ZeroAddress: {
    title: 'Missing address',
    detail: 'One of the required addresses was left empty.',
    retryable: false,
  },
};

/** The wallet refused, or the user did. Not a failure worth alarming anyone about. */
const REJECTED: FriendlyError = {
  title: 'Request cancelled',
  detail: 'You declined the request in your wallet, so nothing was sent.',
  retryable: true,
};

const FALLBACK: FriendlyError = {
  title: 'Transaction failed',
  detail:
    'The transaction did not go through and nothing was spent. If it keeps failing, check that you are on the right network and have enough for gas.',
  retryable: true,
};

/**
 * Translates anything thrown by a contract call into a message for a person.
 *
 * Walks viem's error chain rather than pattern-matching on the string: the
 * error name is in the revert data, and the outer message is a human-readable
 * summary that differs between providers.
 */
export function describeError(error: unknown): FriendlyError {
  if (!(error instanceof BaseError)) {
    return {
      ...FALLBACK,
      detail: error instanceof Error ? error.message : FALLBACK.detail,
    };
  }

  if (error.walk((candidate) => candidate instanceof UserRejectedRequestError)) {
    return REJECTED;
  }

  const reverted = error.walk(
    (candidate) => candidate instanceof ContractFunctionRevertedError,
  ) as ContractFunctionRevertedError | null;

  if (reverted) {
    const name = reverted.data?.errorName;
    if (name && name in MESSAGES) return MESSAGES[name] as FriendlyError;

    // A revert with a reason string rather than a custom error. Ours use custom
    // errors throughout, so this is a token or a precompile talking.
    if (reverted.reason) return { ...FALLBACK, detail: reverted.reason };
  }

  // Out of gas, nonce problems, an RPC that is simply down. The short message is
  // viem's own summary and is already free of the raw JSON-RPC envelope.
  return { ...FALLBACK, detail: error.shortMessage || FALLBACK.detail };
}

/** True when the error is the user declining in their wallet. */
export function isUserRejection(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return error.walk((candidate) => candidate instanceof UserRejectedRequestError) !== null;
}
