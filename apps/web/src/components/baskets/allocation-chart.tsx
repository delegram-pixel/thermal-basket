'use client';

import { formatSettlement, formatWeight } from '@thematic/blockchain';
import type { BasketComponent, BasketFees } from '@thematic/types';
import { allocationTone } from '@/lib/allocation.ts';
import { BasketAllocation } from './basket-allocation.tsx';
import { MockDataNotice } from '@/components/ui/notice.tsx';

/**
 * The full composition view: the band, then the figures behind it.
 *
 * Two columns of weights, and the distinction between them is the most
 * important thing on this page.
 *
 * - **Target** is what the creator published and what the chain enforces.
 * - **Actual** is what the basket's holdings are worth today, as a share of the
 *   total. It drifts as prices move, because nothing in this version rebalances.
 *
 * Showing only the target would make the band look like a live valuation.
 * Showing only the actual would hide the rule. Both are shown, and the note
 * underneath says why they differ, because a reader who does not know the basket
 * is unrebalanced will read the gap as an error.
 */
export function AllocationChart({
  components,
  fees,
  settlementDecimals,
  settlementSymbol,
  className = '',
}: {
  components: BasketComponent[];
  fees: BasketFees;
  settlementDecimals: number;
  settlementSymbol: string;
  className?: string;
}) {
  const unpriceable = components.filter((component) => component.price === null);
  const published = components.map((component) => ({
    symbol: component.symbol,
    weightBps: component.weightBps,
  }));

  return (
    <div className={className}>
      <BasketAllocation segments={published} size="lg" />

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">
            Basket composition: published target weight, current actual weight, price and holding
            value for each component.
          </caption>
          <thead>
            <tr className="border-b border-rule-strong">
              <th scope="col" className="label py-2.5 text-left font-semibold">
                Component
              </th>
              <th scope="col" className="label py-2.5 text-right font-semibold">
                Target
              </th>
              <th scope="col" className="label py-2.5 text-right font-semibold">
                Actual
              </th>
              <th scope="col" className="label py-2.5 text-right font-semibold">
                Price
              </th>
              <th scope="col" className="label py-2.5 text-right font-semibold">
                Held value
              </th>
            </tr>
          </thead>
          <tbody>
            {components.map((component, index) => (
              <tr key={component.address} className="border-b border-rule last:border-0">
                <th scope="row" className="py-3 pr-3 text-left font-normal">
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="inline-block size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: allocationTone(index) }}
                    />
                    <span className="min-w-0">
                      <span className="figure block text-ink">{component.symbol}</span>
                      <span className="block truncate text-xs text-ink-faint">
                        {component.name}
                      </span>
                    </span>
                  </span>
                </th>

                <td className="py-3 text-right align-top">
                  <span className="figure text-ink">{formatWeight(component.weightBps)}</span>
                </td>

                <td className="py-3 text-right align-top">
                  {component.realisedWeightBps === null ? (
                    <Unavailable reason="The basket's holdings could not all be priced" />
                  ) : (
                    <span className="figure text-ink-muted">
                      {formatWeight(component.realisedWeightBps)}
                    </span>
                  )}
                </td>

                <td className="py-3 text-right align-top">
                  {component.price === null ? (
                    <Unavailable reason="No usable price from the feed" />
                  ) : (
                    <span className="figure text-ink-muted">
                      {formatSettlement(component.price, settlementDecimals, settlementSymbol, {
                        displayDecimals: 4,
                        minDecimals: 2,
                      })}
                    </span>
                  )}
                </td>

                <td className="py-3 text-right align-top">
                  {component.value === null ? (
                    <Unavailable reason="Value depends on a price that is missing" />
                  ) : (
                    <span className="figure text-ink">
                      {formatSettlement(component.value, settlementDecimals, settlementSymbol)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unpriceable.length > 0 ? (
        <div className="mt-4">
          <MockDataNotice
            subject="The price feed returned nothing for some components on this page"
            compact
          />
        </div>
      ) : (
        <div className="mt-4">
          <MockDataNotice subject="The prices and held values on this page" compact />
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        Target weights are fixed when the basket is created.{' '}
        {fees.redeemFeeBps > 0 || fees.depositFeeBps > 0
          ? 'Fees are charged on deposit and redemption. '
          : null}
        Actual weights move with component prices and are not rebalanced by this version of the
        protocol, so the two will differ over time.
      </p>
    </div>
  );
}

/**
 * A figure that does not exist, said in words.
 *
 * Deliberately not a zero and deliberately not blank. A blank cell in a column
 * of numbers reads as a rendering bug; a zero reads as a fact. Neither is true,
 * and the `title` gives the specific reason on hover while the screen-reader
 * text carries it for everyone else.
 */
function Unavailable({ reason }: { reason: string }) {
  return (
    <span className="text-ink-faint" title={reason}>
      —<span className="sr-only">{reason}</span>
    </span>
  );
}
