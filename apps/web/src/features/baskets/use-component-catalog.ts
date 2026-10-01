'use client';

import { useMemo } from 'react';
import {
  useAddressBook,
  useBasketList,
  useComponentAllowlist,
  useFactoryConfig,
  useTokenMetadataList,
  useTokenPrices,
} from '@thematic/blockchain';
import type { Address, TokenMetadata } from '@thematic/types';

/**
 * The tokens that can appear in a basket on this network, with their prices.
 *
 * Where the list comes from depends on the chain, and the difference is not
 * cosmetic. On a test network the components are mock tokens this project
 * deployed, so the address book knows them up front. On a chain with real
 * tokenized equities there is no shipped list and there should not be one — a
 * bundle cannot know which equities exist on a network it was not built for.
 * There, the set is whatever the deployed baskets already hold, discovered from
 * the baskets themselves.
 *
 * This lives apart from any one screen because two screens show the same list:
 * the discover page's asset table and the creation flow's component picker.
 * Deriving it twice is how the two would come to disagree about what is
 * available, and an asset table that lists something the creator cannot pick is
 * a worse bug than either being wrong alone.
 */
export interface CatalogEntry {
  token: TokenMetadata;
  /** Value of one whole token in settlement smallest units, or `null` if unpriced. */
  price: bigint | null;
  /** Whether the factory would accept this token as a component, if it enforces a list. */
  allowed: boolean;
}

export interface ComponentCatalog {
  entries: CatalogEntry[];
  /** Where the list came from, so the UI can say which and qualify it correctly. */
  source: 'deployment' | 'baskets';
  loading: boolean;
  error: unknown;
  refetch: () => void;
}

export function useComponentCatalog(): ComponentCatalog {
  const book = useAddressBook();
  const config = useFactoryConfig();
  const baskets = useBasketList();

  /**
   * The addresses to display, and where they came from.
   *
   * Memoised on the two sources rather than computed inline, because the array
   * identity is what the metadata and price queries key on. A new array every
   * render would be a new query key every render, and the list would never
   * finish loading.
   */
  const { tokens, source } = useMemo(() => {
    const bundled = Object.values(book?.components ?? {}) as Address[];
    if (bundled.length > 0) {
      return { tokens: bundled, source: 'deployment' as const };
    }

    // No bundled list: union the components of every basket, keeping first-seen
    // order so the list does not reshuffle as baskets load.
    const seen = new Map<Address, true>();
    for (const basket of baskets.data ?? []) {
      for (const weight of basket.weights) {
        if (!seen.has(weight.address)) seen.set(weight.address, true);
      }
    }
    return { tokens: [...seen.keys()], source: 'baskets' as const };
  }, [book, baskets.data]);

  const metadata = useTokenMetadataList(tokens);

  /**
   * The factory's provider, falling back to the address book's.
   *
   * The factory is authoritative — it is the provider a basket created today
   * would be bound to — but reading it is a network call that can fail on its
   * own, and a price table is not worth failing over a superfluous dependency
   * when the deployment already names a provider.
   */
  const priceProvider = config.data?.priceProvider ?? book?.priceProvider;
  const prices = useTokenPrices(priceProvider, tokens);

  const enforcement = config.data?.allowlistEnforced ?? false;
  const allowlist = useComponentAllowlist(book?.factory, tokens, enforcement);

  const priceByToken = useMemo(() => {
    const map = new Map<string, bigint | null>();
    for (const entry of prices.data ?? []) map.set(entry.token.toLowerCase(), entry.price);
    return map;
  }, [prices.data]);

  const entries = useMemo<CatalogEntry[]>(() => {
    return (metadata.data ?? []).map((token) => {
      const lower = token.address.toLowerCase();
      return {
        token,
        price: priceByToken.get(lower) ?? null,
        // When the factory does not enforce a list, everything is allowed; the
        // query is skipped and there is nothing to consult.
        allowed: enforcement ? (allowlist.data?.[lower] ?? false) : true,
      };
    });
  }, [metadata.data, priceByToken, enforcement, allowlist.data]);

  return {
    entries,
    source,
    loading: tokens.length > 0 && (metadata.isPending || (enforcement && allowlist.isPending)),
    error: metadata.error ?? allowlist.error ?? null,
    refetch: () => {
      void metadata.refetch();
      if (enforcement) void allowlist.refetch();
    },
  };
}
