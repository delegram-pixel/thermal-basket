'use client';

import { Notice } from '@/components/ui/notice.tsx';
import { ErrorState, LoadingRows } from '@/components/ui/states.tsx';
import { underlyingFor } from '@/lib/binance/symbols.ts';
import { useReferenceFeed } from './use-reference-feed.ts';

/**
 * The Binance reference price, beside the price this deployment actually uses.
 *
 * The point of this table is a comparison, and the honesty of it is in naming
 * both columns precisely. The on-chain column is the mock feed's price for a mock
 * token — invented, and disclosed as such wherever it appears. The reference
 * column is a real market price for the company that mock token is *named after*.
 * Neither column is the other's correction: the gap between them is not an
 * arbitrage, it is the distance between a demo and a market, and the copy says so
 * rather than letting a reader infer a trading signal.
 *
 * It is on the page anyway because that distance is the honest version of what
 * this protocol does when it is pointed at real assets. A basket whose components
 * are real tokenized equities is priced by the same arithmetic, against a feed
 * that is not invented, and the divergence figure is then a real one.
 */

export interface ReferenceComponent {
  symbol: string;
  /** On-chain price of one whole token, in settlement smallest units. */
  price: bigint | null;
}

export function ReferencePrices({
  components,
  settlementDecimals,
  settlementSymbol,
}: {
  components: readonly ReferenceComponent[];
  settlementDecimals: number;
  settlementSymbol: string;
}) {
  const feed = useReferenceFeed(components.map((component) => component.symbol));

  if (components.length === 0) return null;
  if (feed.isPending) return <LoadingRows rows={3} />;

  if (feed.isError) {
    return (
      <ErrorState
        title="The reference prices could not be read"
        detail="This application's own route for reference prices did not answer. The route is part of this app, so this is a defect here rather than at Binance."
        raw={feed.error instanceof Error ? feed.error.message : undefined}
        onRetry={() => void feed.refetch()}
      />
    );
  }

  const error = feed.data.error;

  if (error) {
    return (
      <Notice
        tone={error.reason === 'unconfigured' ? 'neutral' : 'warning'}
        title={
          error.reason === 'unconfigured'
            ? 'No Binance Web3 API credentials on this deployment'
            : 'The Binance Web3 API could not be reached'
        }
      >
        {error.reason === 'unconfigured' ? (
          <>
            Reference prices come from the Binance Web3 API, which needs a key pair this deployment
            has not been given. The on-chain figures on this page are unaffected — they come from
            this project&apos;s own price feed. Set <code>BINANCE_WEB3_API_KEY</code> and{' '}
            <code>BINANCE_WEB3_API_SECRET</code> in <code>apps/web/.env.local</code> to fill this
            table in.
          </>
        ) : (
          <>
            {error.message}
            {error.code ? (
              <>
                {' '}
                The API reported code <code>{error.code}</code>.
              </>
            ) : null}
          </>
        )}
      </Notice>
    );
  }

  const byTicker = new Map(
    feed.data.prices.map((entry) => [entry.symbol.toUpperCase(), entry] as const),
  );

  const rows = components.map((component) => {
    const ticker = underlyingFor(component.symbol).toUpperCase();
    const entry = byTicker.get(ticker);

    const onChain =
      component.price === null ? null : Number(component.price) / 10 ** settlementDecimals;
    const reference = entry?.price ?? null;
    const gapPct =
      onChain !== null && reference !== null && reference !== 0
        ? ((onChain - reference) / reference) * 100
        : null;

    return { component, ticker, entry, onChain, reference, gapPct };
  });

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] border-t border-rule">
          <caption className="sr-only">
            Each component&apos;s price from this deployment&apos;s mock feed, beside the Binance
            Web3 API reference price for the company it is named after.
          </caption>
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="label py-2.5 pr-4 text-left font-medium">
                Underlying
              </th>
              <th scope="col" className="label py-2.5 pr-4 text-right font-medium">
                This deployment
              </th>
              <th scope="col" className="label py-2.5 pr-4 text-right font-medium">
                Binance reference
              </th>
              <th scope="col" className="label py-2.5 text-right font-medium">
                Gap
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ component, ticker, entry, onChain, reference, gapPct }) => (
              <tr key={component.symbol} className="border-b border-rule last:border-0">
                <th scope="row" className="py-3 pr-4 text-left font-normal">
                  <span className="figure block text-sm text-ink">{ticker}</span>
                  <span className="block truncate text-xs text-ink-faint">
                    {component.symbol}
                    {entry?.name ? ` · ${entry.name}` : ''}
                  </span>
                </th>

                <td className="py-3 pr-4 text-right align-top">
                  {onChain === null ? (
                    <span className="text-xs text-ink-faint">Not priced</span>
                  ) : (
                    <span className="figure text-sm text-ink">
                      {onChain.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      <span className="text-xs text-ink-faint">{settlementSymbol}</span>
                    </span>
                  )}
                </td>

                <td className="py-3 pr-4 text-right align-top">
                  {reference === null ? (
                    <span className="text-xs text-ink-faint">No reference</span>
                  ) : (
                    <span className="figure text-sm text-ink">
                      $
                      {reference.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  )}
                </td>

                <td className="py-3 text-right align-top">
                  {gapPct === null ? (
                    <span className="text-xs text-ink-faint">—</span>
                  ) : (
                    <span className="figure text-sm text-ink">
                      {gapPct >= 0 ? '+' : ''}
                      {gapPct.toFixed(1)}%
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 max-w-3xl space-y-3">
        <Notice tone="warning" title="Only one column is a market price">
          The Binance reference column is the real market price of the company each token is named
          after, from the Binance Web3 API. The deployment column is this project&apos;s own mock
          feed — a fixed number on a contract, not a quotation. The gap between them is the distance
          between a demonstration and a market, not an arbitrage opportunity, and nothing here is a
          recommendation to trade.
        </Notice>

        <p className="text-xs leading-relaxed text-ink-faint">
          Reference prices from the Binance Web3 API, chain {feed.data.chainId}, read at{' '}
          {new Date(feed.data.fetchedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC.
          Unqualified figures of {settlementSymbol} are the mock feed&apos;s.
        </p>
      </div>
    </div>
  );
}
