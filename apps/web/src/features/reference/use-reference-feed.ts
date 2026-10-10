'use client';

import { useMemo } from 'react';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { underlyingFor } from '@/lib/binance/symbols.ts';
import type { ProfileFeed, ReferenceFeed } from '@/lib/binance/wire.ts';

/**
 * The reference feed, as the browser sees it.
 *
 * It calls this application's own Route Handler rather than the Binance Web3 API
 * directly, and that is not a convenience. The API is authenticated with a secret
 * that signs every request; anything the browser can call, the browser can read
 * the credentials for. The Route Handler exists so the secret stays on the
 * server, which means this hook's job is to talk to `/api/reference` and treat
 * the upstream API as an implementation detail it cannot see.
 *
 * The feed answers `200` even when it is down, carrying the reason in the body,
 * so a failure here is data rather than an exception. Only a failure of this
 * application's own route — which would mean the route is broken, not the feed —
 * becomes a rejected query.
 */

/** How often to re-poll. A reference price is a market figure; a minute keeps it
 *  current without turning a page of eight rows into a request flood. */
const REFETCH_INTERVAL = 60_000;

export function useReferenceFeed(
  componentSymbols: readonly string[],
): UseQueryResult<ReferenceFeed> {
  /**
   * Distinct underlyings, sorted.
   *
   * `mNVDA` and `NVDA` are the same underlying, and asking twice would be two
   * identical requests that then disagree about freshness. The sort is what makes
   * the key stable: a basket listing its holdings in a different order is the
   * same question.
   */
  const tickers = useMemo(
    () => [...new Set(componentSymbols.map(underlyingFor))].sort(),
    [componentSymbols],
  );
  const key = tickers.join(',');

  return useQuery({
    // Keyed on the joined tickers, not the array — see the note in
    // `@thematic/blockchain`'s `useTokenPrices`; an array identity that changes
    // every render is a query that refetches every render.
    queryKey: ['binance', 'reference', key],
    enabled: tickers.length > 0,
    staleTime: 30_000,
    refetchInterval: REFETCH_INTERVAL,
    queryFn: async (): Promise<ReferenceFeed> => {
      const response = await fetch(`/api/reference?symbols=${encodeURIComponent(key)}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`This application's own reference route answered ${response.status}.`);
      }

      return (await response.json()) as ReferenceFeed;
    },
  });
}

/**
 * Company profiles for a list of underlyings.
 *
 * A query per ticker rather than one batched call, because the API documents a
 * single-symbol profile endpoint and no batch form. That is a real cost — a
 * six-holding basket is six requests — and it is the API's design rather than
 * this hook's; it is recorded as a suggestion in the DX report.
 *
 * The stale time is long because the answer barely changes: a company's sector
 * and description are not market data, and refetching them on a sixty-second
 * timer alongside the prices would be five requests to learn nothing.
 */
export function useUnderlyingProfiles(
  componentSymbols: readonly string[],
): Array<{ ticker: string; result: UseQueryResult<ProfileFeed> }> {
  const tickers = useMemo(
    () => [...new Set(componentSymbols.map(underlyingFor))].sort(),
    [componentSymbols],
  );

  const results = useQueries({
    queries: tickers.map((ticker) => ({
      queryKey: ['binance', 'profile', ticker],
      staleTime: 6 * 60 * 60 * 1000,
      queryFn: async (): Promise<ProfileFeed> => {
        const response = await fetch(
          `/api/reference/profile?symbol=${encodeURIComponent(ticker)}`,
          { cache: 'no-store' },
        );

        if (!response.ok) {
          throw new Error(`This application's own profile route answered ${response.status}.`);
        }

        return (await response.json()) as ProfileFeed;
      },
    })),
  });

  // Paired here rather than in the component: `useQueries` preserves order, so
  // this is the only place that has to know it does, and a caller indexing the
  // results against a list it derived separately is a caller that can get it
  // wrong without anything failing.
  return tickers.map((ticker, index) => ({ ticker, result: results[index] }));
}
