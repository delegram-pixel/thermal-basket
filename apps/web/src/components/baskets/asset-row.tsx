'use client';

import { formatSettlement, formatWeight } from '@thematic/blockchain';
import type { Address, TokenMetadata } from '@thematic/types';
import { AddressChip } from '@/components/ui/address.tsx';

/**
 * One token, as a table row.
 *
 * Used for the supported-asset list and for a basket's holdings. The address and
 * the decimals are shown rather than hidden: decimals are the thing that most
 * often explains why a displayed amount looks wrong, and the address is what
 * makes a "tokenized NVDA" claim checkable rather than asserted (§47).
 */
export function AssetRow({
  token,
  price,
  settlementDecimals,
  settlementSymbol,
  weightBps,
  referencePrice,
}: {
  token: TokenMetadata;
  /** Value of one whole token in settlement smallest units, or `null` if unpriced. */
  price: bigint | null;
  settlementDecimals: number;
  settlementSymbol: string;
  /** Published target weight, when this row is inside a basket. */
  weightBps?: number;
  /**
   * The underlying's real market price, from the Binance Web3 API.
   *
   * `undefined` omits the column entirely; `null` renders it as unavailable.
   * Those are different states and the table says so — a caller that has not
   * asked the API gets a table without the column, and a caller that asked and
   * got nothing gets a row that admits it.
   */
  referencePrice?: number | null;
}) {
  return (
    <tr className="border-b border-rule last:border-0">
      <th scope="row" className="py-3 pr-4 text-left font-normal">
        <span className="figure block text-sm text-ink">{token.symbol}</span>
        <span className="block truncate text-xs text-ink-faint">{token.name}</span>
      </th>

      <td className="hidden py-3 pr-4 align-top sm:table-cell">
        <AddressChip address={token.address as Address} visible={3} />
      </td>

      <td className="hidden py-3 pr-4 text-right align-top md:table-cell">
        <span className="figure text-xs text-ink-muted">{token.decimals}</span>
      </td>

      {weightBps !== undefined ? (
        <td className="py-3 pr-4 text-right align-top">
          <span className="figure text-sm text-ink">{formatWeight(weightBps)}</span>
        </td>
      ) : null}

      <td className="py-3 text-right align-top">
        {price === null ? (
          <span className="text-xs text-ink-faint" title="No usable price from the feed">
            Not priced
          </span>
        ) : (
          <span className="figure text-sm text-ink">
            {formatSettlement(price, settlementDecimals, settlementSymbol, {
              displayDecimals: 4,
              minDecimals: 2,
            })}
          </span>
        )}
      </td>

      {referencePrice !== undefined ? (
        <td className="py-3 pl-4 text-right align-top">
          {referencePrice === null ? (
            <span className="text-xs text-ink-faint" title="No reference price from the API">
              —
            </span>
          ) : (
            <span className="figure text-sm text-ink">
              $
              {referencePrice.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          )}
        </td>
      ) : null}
    </tr>
  );
}
