'use client';

import { formatAmount, formatBps } from '@thematic/blockchain';
import { BPS_DENOMINATOR, type BasketFees } from '@thematic/types';
import { Detail } from '@/components/ui/layout.tsx';

/**
 * The fee model, stated exactly (§15, §47).
 *
 * Two things this deliberately does that a fee table usually does not:
 *
 * 1. **It shows the split, not just the headline.** "0.50% deposit fee" is only
 *    half the model; the other half is that 80% of it goes to the creator and
 *    20% to the protocol (§17). A user is entitled to know where their money
 *    went, and a creator is entitled to know what they are earning.
 * 2. **It works the arithmetic on a real number.** A percentage is easy to skim
 *    and hard to feel. The worked example below turns it into an amount on a
 *    1,000-unit deposit, which is checkable against the contract's own
 *    `previewDeposit` — the same figure the deposit dialog shows.
 *
 * Every figure is derived from the basket's stored basis points rather than
 * restated, so this table cannot drift from what the contract charges.
 */
export function FeeSummary({
  fees,
  settlementDecimals,
  settlementSymbol,
  /** The amount the worked example is computed on, in settlement smallest units. */
  exampleAmount,
}: {
  fees: BasketFees;
  settlementDecimals: number;
  settlementSymbol: string;
  exampleAmount: bigint;
}) {
  const depositFee = (exampleAmount * BigInt(fees.depositFeeBps)) / BigInt(BPS_DENOMINATOR);
  const creatorCut = (depositFee * BigInt(fees.creatorShareBps)) / BigInt(BPS_DENOMINATOR);
  const protocolCut = depositFee - creatorCut;
  const netInvested = exampleAmount - depositFee;

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Detail label="Deposit fee">{formatBps(fees.depositFeeBps)}</Detail>
        <Detail label="Redemption fee">{formatBps(fees.redeemFeeBps)}</Detail>
        <Detail label="Creator share" hint="of each fee charged">
          {formatBps(fees.creatorShareBps)}
        </Detail>
        <Detail label="Protocol share" hint="of each fee charged">
          {formatBps(BPS_DENOMINATOR - fees.creatorShareBps)}
        </Detail>
      </dl>

      <div className="rounded border border-rule bg-sunken px-5 py-4">
        <p className="label">Worked example</p>
        <p className="mt-2 text-sm text-ink-muted">
          On a deposit of{' '}
          <span className="figure text-ink">
            {formatAmount(exampleAmount, settlementDecimals, {
              displayDecimals: 2,
              minDecimals: 2,
            })}{' '}
            {settlementSymbol}
          </span>
        </p>

        <table className="mt-3 w-full max-w-md text-sm">
          <tbody>
            <ExampleRow
              label="Deposit fee"
              value={`− ${formatAmount(depositFee, settlementDecimals, { displayDecimals: 4, minDecimals: 2 })} ${settlementSymbol}`}
            />
            <ExampleRow
              label="of which to the creator"
              value={`${formatAmount(creatorCut, settlementDecimals, { displayDecimals: 4, minDecimals: 2 })} ${settlementSymbol}`}
              muted
            />
            <ExampleRow
              label="of which to the protocol"
              value={`${formatAmount(protocolCut, settlementDecimals, { displayDecimals: 4, minDecimals: 2 })} ${settlementSymbol}`}
              muted
            />
            <ExampleRow
              label="Invested in the basket"
              value={`${formatAmount(netInvested, settlementDecimals, { displayDecimals: 2, minDecimals: 2 })} ${settlementSymbol}`}
              strong
            />
          </tbody>
        </table>

        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          Fees are charged on the amount you put in, not deducted from the basket. Redemption is
          charged the same way on the way out, at the redemption rate above.
        </p>
      </div>

      <p className="text-xs leading-relaxed text-ink-faint">
        These rates are fixed when the basket is created and cannot be changed afterwards — not by
        the creator and not by the protocol. The maximum slippage tolerance of{' '}
        {formatBps(fees.maxSlippageBps)} is the most a deposit or redemption will accept between the
        price you are quoted and the price you get.
      </p>
    </div>
  );
}

function ExampleRow({
  label,
  value,
  muted = false,
  strong = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? 'border-t border-rule-strong' : ''}>
      <th
        scope="row"
        className={`py-1.5 pr-4 text-left font-normal ${muted ? 'pl-4 text-ink-faint' : 'text-ink-muted'} ${strong ? 'font-medium text-ink' : ''}`}
      >
        {label}
      </th>
      <td className="py-1.5 text-right">
        <span className={`figure ${strong ? 'text-ink' : 'text-ink-muted'}`}>{value}</span>
      </td>
    </tr>
  );
}
