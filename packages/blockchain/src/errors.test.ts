import { describe, expect, it } from 'vitest';
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  encodeErrorResult,
  type Abi,
  type AbiParameter,
} from 'viem';
import { describeError, isUserRejection } from './errors.ts';

/**
 * Revert data into something a person can act on (§21, §34).
 *
 * The instances below are built the way viem builds them — a real encoded
 * selector decoded against a real ABI fragment — rather than by stubbing
 * `describeError`'s input. The function's whole job is to walk viem's error
 * chain and read `data.errorName` out of it, so a hand-rolled fake error would
 * test the lookup table while skipping the part that breaks.
 */

/** An ABI fragment declaring one custom error with no parameters. */
function errorAbi(name: string, inputs: readonly AbiParameter[] = []): Abi {
  return [{ type: 'error', name, inputs }] as unknown as Abi;
}

/** A `ContractFunctionRevertedError` carrying `name`, as viem would produce it. */
function revertedWith(name: string): ContractFunctionRevertedError {
  const abi = errorAbi(name);
  const data = encodeErrorResult({ abi, errorName: name, args: [] });
  return new ContractFunctionRevertedError({ abi, data, functionName: 'deposit' });
}

/** The `Error(string)` revert a token or a precompile produces, not ours. */
function revertedWithReason(reason: string): ContractFunctionRevertedError {
  const abi = errorAbi('Error', [{ type: 'string', name: 'message' }]);
  const data = encodeErrorResult({ abi, errorName: 'Error', args: [reason] });
  return new ContractFunctionRevertedError({ abi, data, functionName: 'transfer' });
}

/**
 * Every custom error the contracts declare, as restated in the message table.
 *
 * This list is duplicated from `errors.ts` on purpose: it is the assertion, and
 * a test that read the table it was checking would pass no matter what the
 * table contained. If a name here stops mapping, `describeError` has silently
 * started showing a user a fallback for a failure the protocol understands.
 */
const MAPPED_ERRORS = [
  // Slippage and the user's own bounds
  'DepositSlippageExceeded',
  'RedemptionSlippageExceeded',
  'InsufficientSharesOut',
  'DeadlineExpired',
  // Amounts the basket cannot act on
  'DepositTooSmall',
  'RedemptionTooSmall',
  'RedemptionYieldsNothing',
  'ZeroAmount',
  // Valuation
  'ComponentNotPriceable',
  'UnsupportedSettlementToken',
  // Basket state
  'EnforcedPause',
  'ExpectedPause',
  'ReentrancyGuardReentrantCall',
  // Authority
  'NotCreator',
  'NotProtocolAdmin',
  'NothingToClaim',
  // Token mechanics
  'ERC20InsufficientAllowance',
  'ERC20InsufficientBalance',
  'SafeERC20FailedOperation',
  // Basket creation
  'ComponentNotAllowed',
  'FeeTooHigh',
  'InvalidWeightTotal',
  'WeightLengthMismatch',
  'TooManyComponents',
  'NoComponents',
  'DuplicateComponent',
  'ZeroWeight',
  'InvalidName',
  'SettlementTokenIsComponent',
  'ComponentNotERC20Metadata',
  'ComponentDecimalsTooHigh',
  'AddressHasNoCode',
  'ZeroAddress',
] as const;

const FALLBACK_TITLE = 'Transaction failed';

describe('describeError — mapped contract errors', () => {
  it('maps every declared custom error to a message of its own', () => {
    for (const name of MAPPED_ERRORS) {
      const friendly = describeError(revertedWith(name));

      // The failure mode this catches: an error name that drifted out of the
      // table and now silently renders the generic fallback, so the protocol
      // knows exactly what went wrong and the user is told nothing.
      expect(friendly.title, `${name} fell through to the fallback`).not.toBe(FALLBACK_TITLE);
      expect(friendly.title.length, `${name} has an empty title`).toBeGreaterThan(0);
      expect(friendly.detail.length, `${name} has an empty detail`).toBeGreaterThan(0);
      expect(typeof friendly.retryable, `${name} has no retryable flag`).toBe('boolean');
    }
  });

  it('never puts a selector or a Solidity signature in the headline', () => {
    // §21: raw RPC errors are never the primary UX.
    for (const name of MAPPED_ERRORS) {
      const { title } = describeError(revertedWith(name));
      expect(title, `${name} leaked a selector`).not.toMatch(/0x[0-9a-fA-F]{8}/);
      expect(title, `${name} leaked a signature`).not.toMatch(/\(|Error/);
    }
  });

  it('describes the two slippage failures as nothing having moved', () => {
    const deposit = describeError(revertedWith('DepositSlippageExceeded'));
    expect(deposit.title).toBe('Price moved');
    expect(deposit.detail).toMatch(/nothing was spent/i);
    expect(deposit.retryable).toBe(true);

    const redemption = describeError(revertedWith('RedemptionSlippageExceeded'));
    expect(redemption.title).toBe('Price moved');
    // The distinction that matters: a cancelled redemption must say the
    // tokens were not burned, because that is the user's actual worry.
    expect(redemption.detail).toMatch(/were not burned/i);
    expect(redemption.retryable).toBe(true);
  });

  it('turns a missing allowance into an instruction rather than an error', () => {
    const friendly = describeError(revertedWith('ERC20InsufficientAllowance'));
    expect(friendly.title).toBe('Approval needed');
    expect(friendly.detail).toMatch(/approve/i);
    // Retrying the same call without approving fails identically, so this must
    // not offer a retry that cannot work.
    expect(friendly.retryable).toBe(false);
  });

  it('marks the failures that retrying cannot fix as non-retryable', () => {
    for (const name of [
      'DepositTooSmall',
      'RedemptionTooSmall',
      'RedemptionYieldsNothing',
      'EnforcedPause',
      'NotCreator',
      'NothingToClaim',
      'TooManyComponents',
    ]) {
      expect(describeError(revertedWith(name)).retryable, name).toBe(false);
    }
  });

  it('marks the failures a fresh quote would fix as retryable', () => {
    for (const name of [
      'DepositSlippageExceeded',
      'RedemptionSlippageExceeded',
      'DeadlineExpired',
    ]) {
      expect(describeError(revertedWith(name)).retryable, name).toBe(true);
    }
  });
});

describe('describeError — reverts and errors the protocol did not declare', () => {
  it('passes a plain reason string through, since it is already a sentence', () => {
    const friendly = describeError(revertedWithReason('insufficient balance for transfer'));
    expect(friendly.detail).toBe('insufficient balance for transfer');
    expect(friendly.title).toBe(FALLBACK_TITLE);
  });

  it('falls back rather than showing an error name it does not know', () => {
    const friendly = describeError(revertedWith('SomethingWeHaveNotSeenBefore'));
    expect(friendly.title).toBe(FALLBACK_TITLE);
    // Still usable: viem's summary, not the raw JSON-RPC envelope.
    expect(friendly.detail).not.toMatch(/"jsonrpc"/);
    expect(friendly.detail).toContain('deposit');
  });
});

describe('describeError — wallet and transport failures', () => {
  it('treats a wallet rejection as a decision, not a failure', () => {
    const friendly = describeError(
      new UserRejectedRequestError(new Error('User denied transaction signature.')),
    );
    expect(friendly.title).toBe('Request cancelled');
    expect(friendly.detail).toMatch(/declined/i);
    // Retryable because the user can simply approve the next prompt.
    expect(friendly.retryable).toBe(true);
  });

  it('finds a rejection nested inside the error a connector actually throws', () => {
    // wagmi wraps the provider error, so the rejection is a cause rather than
    // the error itself. Reading only the outer one was the bug this catches.
    const wrapped = new BaseError('User rejected the request.', {
      cause: new UserRejectedRequestError(new Error('denied')),
    });
    expect(describeError(wrapped).title).toBe('Request cancelled');
  });

  it('does not claim a rejection for an unrelated failure', () => {
    expect(describeError(revertedWith('DepositTooSmall')).title).not.toBe('Request cancelled');
  });

  it('prefers a mapped contract error over the rejection path when both could match', () => {
    // A rejection wrapped around a revert is a rejection; a revert wrapping a
    // rejection is a revert. Neither should be reported as the other.
    const revert = new BaseError('reverted', { cause: revertedWith('EnforcedPause') });
    expect(describeError(revert).title).toBe('This basket is paused');
  });

  it('handles a bare transport failure with viem’s own summary', () => {
    const friendly = describeError(new BaseError('RPC endpoint is unavailable.'));
    expect(friendly.title).toBe(FALLBACK_TITLE);
    expect(friendly.detail).toBe('RPC endpoint is unavailable.');
  });

  it('returns a usable message for a plain Error', () => {
    const friendly = describeError(new Error('something went wrong in a callback'));
    expect(friendly.detail).toBe('something went wrong in a callback');
    expect(friendly.retryable).toBe(true);
  });

  it('returns a usable message for a value that is not an error at all', () => {
    // `catch` blocks receive anything. `undefined` and a bare string both
    // happen, and neither may produce "undefined" on screen.
    for (const thrown of [undefined, null, 'nope', 42, {}]) {
      const friendly = describeError(thrown);
      expect(friendly.title).toBe(FALLBACK_TITLE);
      expect(friendly.detail).not.toBe('undefined');
      expect(friendly.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('isUserRejection', () => {
  it('is true for a rejection, direct or nested', () => {
    expect(isUserRejection(new UserRejectedRequestError(new Error('denied')))).toBe(true);
    expect(
      isUserRejection(
        new BaseError('denied', { cause: new UserRejectedRequestError(new Error('denied')) }),
      ),
    ).toBe(true);
  });

  it('is false for everything else', () => {
    expect(isUserRejection(revertedWith('DepositTooSmall'))).toBe(false);
    expect(isUserRejection(new Error('denied'))).toBe(false);
    expect(isUserRejection(undefined)).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });
});
