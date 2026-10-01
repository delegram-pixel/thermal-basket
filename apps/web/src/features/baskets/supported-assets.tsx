'use client';

import { describeError, useFactoryConfig } from '@thematic/blockchain';
import { AssetRow } from '@/components/baskets/asset-row.tsx';
import { ErrorState, LoadingRows } from '@/components/ui/states.tsx';
import { MockDataNotice } from '@/components/ui/notice.tsx';
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
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        {catalog.source === 'deployment'
          ? 'These are mock tokens deployed by this project. Their contracts, balances and transfers are real; their prices and their names are not.'
          : 'Discovered from the components of the deployed baskets. Their contracts are real; verify what backs them before treating any of them as an equity claim.'}
      </p>

      <div className="mt-4 max-w-3xl">
        <MockDataNotice subject="The prices in this table" compact />
      </div>
    </div>
  );
}
