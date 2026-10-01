'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAccount, useChainId, usePublicClient, useReadContract } from 'wagmi';
import type {
  Address,
  Basket,
  BasketPosition,
  BasketSummary,
  CreatorEarnings,
  TokenMetadata,
} from '@thematic/types';
import { getAddressBook, isMockEnvironment } from '@thematic/config';
import { erc20Abi, thematicBasketAbi } from './abis.ts';
import { mapLimit } from './utils.ts';
import {
  previewDeposit,
  previewRedeem,
  readBasket,
  readBasketAddresses,
  readBasketBalances,
  readBasketSummaries,
  readComponentAllowlist,
  readCreatorBaskets,
  readCreatorEarnings,
  readFactoryConfig,
  readPosition,
  readTokenMetadata,
  readTokenPrices,
  type DepositQuote,
  type FactoryConfig,
  type RedeemQuote,
} from './reads.ts';

/**
 * TanStack Query wrappers over `reads.ts`.
 *
 * The split matters: `reads.ts` knows nothing about React, and this file adds
 * only caching, refetching and wallet context. Anything that needs to be tested
 * or reused outside a component lives in the other file.
 *
 * Query keys are built by the helpers below rather than spelled inline, so a
 * mutation can invalidate exactly the reads it changed without a string literal
 * appearing in two files and drifting.
 */

/** Query key roots. One place, so invalidation cannot miss a variant. */
export const queryKeys = {
  all: ['thematic'] as const,
  factoryConfig: (chainId: number, factory: Address) =>
    [...queryKeys.all, 'factory', chainId, factory, 'config'] as const,
  basketList: (chainId: number, factory: Address) =>
    [...queryKeys.all, 'factory', chainId, factory, 'baskets'] as const,
  basket: (chainId: number, basket: Address) =>
    [...queryKeys.all, 'basket', chainId, basket] as const,
  position: (chainId: number, basket: Address, account: Address) =>
    [...queryKeys.all, 'basket', chainId, basket, 'position', account] as const,
  creatorBaskets: (chainId: number, factory: Address, creator: Address) =>
    [...queryKeys.all, 'factory', chainId, factory, 'creator', creator] as const,
  creatorEarnings: (chainId: number, creator: Address) =>
    [...queryKeys.all, 'creator', chainId, creator, 'earnings'] as const,
  depositQuote: (chainId: number, basket: Address, amountIn: bigint) =>
    [...queryKeys.all, 'basket', chainId, basket, 'quote', 'deposit', amountIn.toString()] as const,
  redeemQuote: (chainId: number, basket: Address, shares: bigint) =>
    [...queryKeys.all, 'basket', chainId, basket, 'quote', 'redeem', shares.toString()] as const,
  tokenMetadata: (chainId: number, token: Address) =>
    [...queryKeys.all, 'token', chainId, token] as const,
};

/**
 * How often read data is considered stale.
 *
 * A block on BSC is around three seconds, so anything under that is a poll that
 * cannot see new data. Ten seconds keeps a table live without turning a page of
 * twenty rows into a request flood, and the values that genuinely need to be
 * current — quotes, allowances, balances — are refetched on the events that
 * change them instead.
 */
const STALE_TIME = 10_000;

/** The address book for the configured chain, or `null` if none is deployed. */
export function useAddressBook() {
  return useMemo(() => getAddressBook(), []);
}

/**
 * Whether the figures on screen come from mock contracts.
 *
 * Every component that renders a price or a valuation calls this and shows the
 * disclosure when it is true. §10 and §39 are not satisfied by a banner on one
 * page: a mock price presented without qualification anywhere is a mock price
 * presented as market data.
 */
export function useIsMockEnvironment(): boolean {
  const chainId = useChainId();
  return isMockEnvironment(chainId);
}

/** Protocol configuration: settlement asset, creation terms, ceilings. */
export function useFactoryConfig(): UseQueryResult<FactoryConfig> {
  const chainId = useChainId();
  const client = usePublicClient();
  const book = useAddressBook();

  return useQuery({
    queryKey: queryKeys.factoryConfig(chainId, book?.factory ?? '0x'),
    enabled: Boolean(client && book),
    staleTime: STALE_TIME,
    queryFn: async () => {
      if (!client || !book) throw new Error('No deployment configured for this chain.');
      return readFactoryConfig(client, book.factory);
    },
  });
}

/**
 * Every basket, with the headline figures each row needs.
 *
 * Two queries rather than one: the address list changes rarely, and re-reading
 * it on every poll would be wasted work. The summaries query depends on it and
 * refetches on its own schedule.
 */
export function useBasketList(): UseQueryResult<BasketSummary[]> {
  const chainId = useChainId();
  const client = usePublicClient();
  const book = useAddressBook();

  return useQuery({
    queryKey: queryKeys.basketList(chainId, book?.factory ?? '0x'),
    enabled: Boolean(client && book),
    staleTime: STALE_TIME,
    queryFn: async () => {
      if (!client || !book) throw new Error('No deployment configured for this chain.');
      const addresses = await readBasketAddresses(client, book.factory);
      return readBasketSummaries(client, addresses);
    },
  });
}

/** Everything the basket detail page shows. */
export function useBasket(address: Address | undefined): UseQueryResult<Basket> {
  const chainId = useChainId();
  const client = usePublicClient();

  return useQuery({
    queryKey: queryKeys.basket(chainId, address ?? '0x'),
    enabled: Boolean(client && address),
    staleTime: STALE_TIME,
    queryFn: async () => {
      if (!client || !address) throw new Error('No basket address.');
      return readBasket(client, address);
    },
  });
}

/** The connected wallet's holding in one basket. */
export function usePosition(basket: Address | undefined): UseQueryResult<BasketPosition> {
  const chainId = useChainId();
  const client = usePublicClient();
  const { address: account } = useAccount();

  return useQuery({
    queryKey: queryKeys.position(chainId, basket ?? '0x', account ?? '0x'),
    enabled: Boolean(client && basket && account),
    staleTime: STALE_TIME,
    queryFn: async () => {
      if (!client || !basket || !account) throw new Error('Wallet not connected.');
      return readPosition(client, basket, account);
    },
  });
}

/** The baskets the connected wallet created. */
export function useCreatorBaskets(): UseQueryResult<Address[]> {
  const chainId = useChainId();
  const client = usePublicClient();
  const book = useAddressBook();
  const { address: account } = useAccount();

  return useQuery({
    queryKey: queryKeys.creatorBaskets(chainId, book?.factory ?? '0x', account ?? '0x'),
    enabled: Boolean(client && book && account),
    staleTime: STALE_TIME,
    queryFn: async () => {
      if (!client || !book || !account) throw new Error('Wallet not connected.');
      return readCreatorBaskets(client, book.factory, account);
    },
  });
}

/**
 * A creator's claimable fees, across every basket they made.
 *
 * The address list is passed in rather than read here so this can be called
 * after `useCreatorBaskets` has resolved, without duplicating that query. An
 * empty list returns an empty result without touching the network.
 */
export function useCreatorEarnings(baskets: readonly Address[]): UseQueryResult<CreatorEarnings[]> {
  const chainId = useChainId();
  const client = usePublicClient();
  const { address: account } = useAccount();

  return useQuery({
    queryKey: [...queryKeys.creatorEarnings(chainId, account ?? '0x'), baskets.length],
    enabled: Boolean(client && account && baskets.length > 0),
    staleTime: STALE_TIME,
    queryFn: async () => {
      if (!client || !account) throw new Error('Wallet not connected.');
      return readCreatorEarnings(client, baskets, account);
    },
  });
}

/** A basket's free balance and accrued fees, for the creator's treasury view. */
export function useBasketBalances(basket: Address | undefined) {
  const chainId = useChainId();
  const client = usePublicClient();

  return useQuery({
    queryKey: [...queryKeys.basket(chainId, basket ?? '0x'), 'balances'] as const,
    enabled: Boolean(client && basket),
    staleTime: STALE_TIME,
    queryFn: async () => {
      if (!client || !basket) throw new Error('No basket address.');
      return readBasketBalances(client, basket);
    },
  });
}

/**
 * What a deposit would produce right now.
 *
 * `previewDeposit` reverts with `ComponentNotPriceable` when a component has no
 * price, and with `DepositTooSmall` below the floor. Both are states the form
 * has to explain rather than crash on, so the query's error is left in place for
 * the caller to interpret rather than being swallowed here.
 */
export function useDepositQuote(
  basket: Address | undefined,
  amountIn: bigint | null,
): UseQueryResult<DepositQuote> {
  const chainId = useChainId();
  const client = usePublicClient();

  return useQuery({
    queryKey: queryKeys.depositQuote(chainId, basket ?? '0x', amountIn ?? 0n),
    enabled: Boolean(client && basket && amountIn && amountIn > 0n),
    // A quote is only good for the state it was read at, so it is never served
    // from cache without checking.
    staleTime: 0,
    queryFn: async () => {
      if (!client || !basket || !amountIn) throw new Error('No amount.');
      return previewDeposit(client, basket, amountIn);
    },
  });
}

/** What a redemption would pay right now. Same contract caveats as above. */
export function useRedeemQuote(
  basket: Address | undefined,
  shares: bigint | null,
): UseQueryResult<RedeemQuote> {
  const chainId = useChainId();
  const client = usePublicClient();

  return useQuery({
    queryKey: queryKeys.redeemQuote(chainId, basket ?? '0x', shares ?? 0n),
    enabled: Boolean(client && basket && shares && shares > 0n),
    staleTime: 0,
    queryFn: async () => {
      if (!client || !basket || !shares) throw new Error('No amount.');
      return previewRedeem(client, basket, shares);
    },
  });
}

/**
 * A token's symbol, name and decimals, cached per token.
 *
 * One token. For a list, use {@link useTokenMetadataList} — calling this in a
 * loop would tie the number of hooks in a component to the length of a list
 * that changes when the wallet switches chain, and React's rules of hooks do not
 * survive that.
 */
export function useTokenMetadata(token: Address | undefined) {
  const chainId = useChainId();
  const client = usePublicClient();

  return useQuery({
    queryKey: queryKeys.tokenMetadata(chainId, token ?? '0x'),
    enabled: Boolean(client && token),
    // Name, symbol and decimals are fixed for a token's lifetime. There is no
    // reason to ever refetch them.
    staleTime: Infinity,
    queryFn: async () => {
      if (!client || !token) throw new Error('No token address.');
      return readTokenMetadata(client, token);
    },
  });
}

/** The same, for a list, in one query. See the note above. */
export function useTokenMetadataList(tokens: readonly Address[]): UseQueryResult<TokenMetadata[]> {
  const chainId = useChainId();
  const client = usePublicClient();
  const key = tokens.join(',');

  return useQuery({
    queryKey: [...queryKeys.all, 'token-list', chainId, key] as const,
    enabled: Boolean(client && tokens.length > 0),
    staleTime: Infinity,
    queryFn: async () => {
      if (!client) throw new Error('No client.');
      return mapLimit(tokens, 8, (token) => readTokenMetadata(client, token));
    },
  });
}

/**
 * The connected wallet's balance of one token.
 *
 * Uses wagmi's own hook rather than wrapping a read, because wagmi already
 * watches the account, the chain and the block number. Re-implementing that
 * produces a balance that silently stops updating after a transfer.
 */ export function useTokenBalance(token: Address | undefined) {
  const { address: account } = useAccount();

  return useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: account ? [account] : undefined,
    query: { enabled: Boolean(token && account), staleTime: STALE_TIME },
  });
}

/** The connected wallet's allowance to a spender, watched the same way. */
export function useAllowance(token: Address | undefined, spender: Address | undefined) {
  const { address: account } = useAccount();

  return useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: account && spender ? [account, spender] : undefined,
    query: { enabled: Boolean(token && spender && account), staleTime: STALE_TIME },
  });
}

/** The connected wallet's balance of one basket token. */
export function useBasketBalance(basket: Address | undefined) {
  const { address: account } = useAccount();

  return useReadContract({
    address: basket,
    abi: thematicBasketAbi,
    functionName: 'balanceOf',
    args: account ? [account] : undefined,
    query: { enabled: Boolean(basket && account), staleTime: STALE_TIME },
  });
}

/**
 * The price of each token in a list.
 *
 * Keyed on the joined list rather than the array reference, because an array
 * literal rebuilt on every render is a new value every time and would refetch
 * forever. The joined string is stable for a stable set of tokens, and the list
 * is short enough that joining it costs nothing.
 */
export function useTokenPrices(
  priceProvider: Address | undefined,
  tokens: readonly Address[],
): UseQueryResult<Array<{ token: Address; price: bigint | null }>> {
  const chainId = useChainId();
  const client = usePublicClient();
  const key = tokens.join(',');

  return useQuery({
    queryKey: [...queryKeys.all, 'prices', chainId, priceProvider ?? '0x', key] as const,
    enabled: Boolean(client && priceProvider && tokens.length > 0),
    staleTime: STALE_TIME,
    queryFn: async () => {
      if (!client || !priceProvider) throw new Error('No price provider configured.');
      return readTokenPrices(client, priceProvider, tokens);
    },
  });
}

/**
 * Which of these tokens the factory currently accepts as components.
 *
 * Only meaningful when the factory enforces its allowlist; when it does not,
 * every address is accepted and the contract says so by returning `true` for
 * everything. The caller is expected to have read `allowlistEnforced` and to skip
 * this query when it is false — reading it anyway is a round trip per token to
 * learn nothing.
 *
 * The result is keyed by lowercase address, because that is what the contract
 * compares and what a caller looking a token up will have to hand.
 */
export function useComponentAllowlist(
  factory: Address | undefined,
  tokens: readonly Address[],
  /** Pass `false` when the factory does not enforce its allowlist. */
  enabled: boolean,
): UseQueryResult<Record<string, boolean>> {
  const chainId = useChainId();
  const client = usePublicClient();
  const key = tokens.join(',');

  return useQuery({
    queryKey: [...queryKeys.all, 'allowlist', chainId, factory ?? '0x', key] as const,
    enabled: Boolean(client && factory && enabled && tokens.length > 0),
    staleTime: STALE_TIME,
    queryFn: async () => {
      if (!client || !factory) throw new Error('No factory configured.');
      const raw = await readComponentAllowlist(client, factory, tokens);
      return Object.fromEntries(
        Object.entries(raw).map(([token, allowed]) => [token.toLowerCase(), allowed]),
      );
    },
  });
}
