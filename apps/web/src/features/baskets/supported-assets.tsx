'use client';

import { describeError, useFactoryConfig } from '@thematic/blockchain';
import { AssetRow } from '@/components/baskets/asset-row.tsx';
import { ErrorState, LoadingRows } from '@/components/ui/states.tsx';
import { MockDataNotice, Notice } from '@/components/ui/notice.tsx';
import { underlyingFor } from '@/lib/binance/symbols.ts';
import { useReferenceFeed } from '@/features/reference/use-reference-feed.ts';
import { useComponentCatalog } from './use-component-catalog.ts';

/**
 * The assets this deployment can value.
 *
 * The list itself comes from {@link useComponentCatalog}, which the creation
 * flow's component picker also uses — see the note there on why that derivation
 * has exactly one home.
 */
export function SupportedAssets() {
  const catalog = useComponentCatalog();
  const config = useFactoryConfig();
  const settlement = config.data?.settlementToken;

  /*
    Called before every early return below, because the number of hooks in a
    component cannot depend on the state of a query. On a cold load `entries` is
    empty, so this is disabled and costs nothing until the catalog resolves.

    The reference column is only offered when the feed actually answered. Asking
    and getting nothing is different from not asking, and a column of em dashes
    would report the second as the first.
  */
  const reference = useReferenceFeed(catalog.entries.map((entry) => entry.token.symbol));
  const referenceFeed = reference.data?.error ? null : (reference.data ?? null);

  const referenceByTicker = new Map(
    (referenceFeed?.prices ?? []).map(
      (entry) => [entry.symbol.toUpperCase(), entry.price] as const,
    ),
  );

  if (catalog.loading) return <LoadingRows rows={4} />;

  if (catalog.error) {
    const error = describeError(catalog.error);
    return (
      <ErrorState
        title="The asset list could not be read"
        detail={error.detail}
        raw={catalog.error instanceof Error ? catalog.error.message : undefined}
        onRetry={catalog.refetch}
      />
    );
  }

  if (catalog.entries.length === 0) {
    return (
      <p className="border-t border-rule pt-5 text-sm text-ink-muted">
        No component assets are known on this network yet. They are discovered from the baskets that
        hold them, so this table fills in once a basket exists.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-t border-rule">
          <caption className="sr-only">
            Assets recognised in this deployment, with their prices from the configured feed.
          </caption>
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className="label py-2.5 pr-4 text-left font-medium">
                Asset
              </th>
              <th
                scope="col"
                className="label hidden py-2.5 pr-4 text-left font-medium sm:table-cell"
              >
                Contract
              </th>
              <th
                scope="col"
                className="label hidden py-2.5 pr-4 text-right font-medium md:table-cell"
              >
                Decimals
              </th>
              <th scope="col" className="label py-2.5 text-right font-medium">
                Price
              </th>
              {referenceFeed ? (
                <th scope="col" className="label py-2.5 pl-4 text-right font-medium">
                  Reference
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {catalog.entries.map((entry) => (
              <AssetRow
                key={entry.token.address}
                token={entry.token}
                price={entry.price}
                settlementDecimals={settlement?.decimals ?? 18}
                settlementSymbol={settlement?.symbol ?? ''}
                referencePrice={
                  referenceFeed
                    ? (referenceByTicker.get(underlyingFor(entry.token.symbol).toUpperCase()) ??
                      null)
                    : undefined
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      {referenceFeed ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          <span className="text-ink-muted">Reference</span> is the underlying company&apos;s real
          market price, from the Binance Web3 API — read at{' '}
          {new Date(referenceFeed.fetchedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC. It
          is not the price this deployment uses, and the two are not meant to agree: this deployment
          values assets from a mock feed of fixed numbers.
          {referenceFeed.listed === null
            ? ''
            : ` The API's catalogue holds ${referenceFeed.listed} tokenized ${
                referenceFeed.listed === 1 ? 'stock' : 'stocks'
              }.`}
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        {catalog.source === 'deployment'
          ? 'These are mock tokens deployed by this project. Their contracts, balances and transfers are real; their prices and their names are not.'
          : 'Discovered from the components of the deployed baskets. Their contracts are real; verify what backs them before treating any of them as an equity claim.'}
      </p>

      <div className="mt-4 max-w-3xl">
        <MockDataNotice subject="The prices in this table" compact />
      </div>

      {/*
        The reference column is absent rather than empty when the feed has
        nothing to say, so the table needs to say why — otherwise "no column"
        reads as "this app does not do that" instead of "the API did not answer".
      */}
      {!referenceFeed && reference.data?.error ? (
        <div className="mt-3 max-w-3xl">
          <Notice
            tone={reference.data.error.reason === 'unconfigured' ? 'neutral' : 'warning'}
            title={
              reference.data.error.reason === 'unconfigured'
                ? 'No Binance Web3 API credentials on this deployment'
                : 'Reference prices are unavailable'
            }
            compact
          >
            {reference.data.error.reason === 'unconfigured'
              ? 'The Binance Web3 API needs a key pair this deployment has not been given, so the reference column is not shown.'
              : reference.data.error.message}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}
