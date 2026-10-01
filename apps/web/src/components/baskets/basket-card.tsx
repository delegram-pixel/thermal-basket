'use client';

import Link from 'next/link';
import {
  formatAmount,
  formatNavPerShare,
  formatWeight,
  shortenAddress,
} from '@thematic/blockchain';
import type { BasketSummary } from '@thematic/types';
import { BasketAllocation } from './basket-allocation.tsx';
import { PausedBadge } from '@/components/ui/badge.tsx';

/**
 * One basket, as a row.
 *
 * A row and not a card. §24 rules out the card grid, and there is a functional
 * reason too: nine baskets as cards is nine boxes competing for attention and
 * three per screen, where nine rows is one scannable list with the composition
 * of every one of them visible at once. A reader comparing baskets is comparing
 * allocation bands, and the band is the thing a card would shrink to fit.
 *
 * The whole row is one link. The creator address inside it is set as text rather
 * than a nested anchor, because a link inside a link is invalid markup and
 * behaves unpredictably with a keyboard.
 */
export function BasketCard({
  basket,
  settlementSymbol,
  settlementDecimals,
}: {
  basket: BasketSummary;
  settlementSymbol: string;
  settlementDecimals: number;
}) {
  const funded = basket.totalSupply > 0n;

  return (
    <article className="group border-b border-rule last:border-b-0">
      <Link
        href={`/baskets/${basket.address}`}
        className="block px-1 py-5 transition-colors hover:bg-sunken/70 focus-visible:bg-sunken/70 sm:px-3"
      >
        <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          {/* -- Identity and composition ---------------------------------- */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h3 className="font-display text-xl text-ink">{basket.name}</h3>
              <span className="figure text-xs tracking-wide text-ink-muted">{basket.symbol}</span>
              <PausedBadge paused={basket.paused} />
            </div>

            <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-muted">
              <span>{basket.theme}</span>
              <span aria-hidden="true" className="text-rule-strong">
                ·
              </span>
              <span>
                by <span className="figure">{shortenAddress(basket.creator)}</span>
              </span>
              <span aria-hidden="true" className="text-rule-strong">
                ·
              </span>
              <span>{basket.componentCount} components</span>
            </p>

            <div className="mt-4 max-w-2xl">
              <BasketAllocation segments={basket.weights} />
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {basket.weights.map((weight) => (
                  <li key={weight.address} className="figure text-xs text-ink-muted">
                    {weight.symbol}{' '}
                    <span className="text-ink">{formatWeight(weight.weightBps)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* -- Figures ---------------------------------------------------- */}
          <dl className="flex shrink-0 items-start gap-8 lg:gap-10 lg:pr-6">
            <div className="min-w-20">
              <dt className="label">NAV / token</dt>
              <dd className="mt-1">
                {funded && basket.navPerShare !== null ? (
                  <span className="figure text-base text-ink">
                    {formatNavPerShare(basket.navPerShare, settlementDecimals)}
                    <span className="ml-1 text-xs text-ink-muted">{settlementSymbol}</span>
                  </span>
                ) : (
                  <span
                    className="text-sm text-ink-muted"
                    title="No deposits yet, so no net asset value exists"
                  >
                    Not yet funded
                  </span>
                )}
              </dd>
            </div>

            <div className="min-w-24">
              <dt className="label">Assets</dt>
              <dd className="mt-1">
                {basket.totalAssets === null ? (
                  <span className="text-sm text-ink-muted" title="A component has no usable price">
                    Unavailable
                  </span>
                ) : (
                  <span className="figure text-base text-ink">
                    {formatAmount(basket.totalAssets, settlementDecimals, {
                      displayDecimals: 2,
                      minDecimals: 2,
                    })}
                    <span className="ml-1 text-xs text-ink-muted">{settlementSymbol}</span>
                  </span>
                )}
              </dd>
            </div>

            <span
              aria-hidden="true"
              className="mt-5 hidden text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent lg:block"
            >
              →
            </span>
          </dl>
        </div>
      </Link>
    </article>
  );
}
