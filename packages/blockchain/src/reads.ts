import type { PublicClient } from 'viem';
import {
  BPS_DENOMINATOR,
  type Address,
  type Basket,
  type BasketComponent,
  type BasketFees,
  type BasketPosition,
  type BasketSummary,
  type Bps,
  type CreatorEarnings,
  type TokenMetadata,
} from '@thematic/types';
import { basketFactoryAbi, erc20Abi, priceProviderAbi, thematicBasketAbi } from './abis.ts';
import { mapLimit, settle, sum } from './utils.ts';

/**
 * Every on-chain read the application performs.
 *
 * These functions take a `PublicClient` and return domain objects. They hold no
 * React state and import nothing from React, which is what lets the same code
 * serve a server component, a hook, and a test.
 *
 * **No multicall.** The reads below fan out with `Promise.all` and `mapLimit`
 * instead of viem's `multicall`, for a concrete reason: Multicall3 is deployed
 * at a fixed address on mainnet and most public testnets, but Hardhat's
 * development node does not deploy it. Code that batches through multicall
 * therefore works everywhere except the environment it is developed in. The
 * bounded fan-out costs a few more round trips to a local node and is correct on
 * every chain.
 */

/**
 * Simultaneous in-flight reads.
 *
 * The development node is a single-threaded process, and a hosted RPC will
 * rate-limit a discover page that fires three hundred calls at once. Eight keeps
 * both happy without making a page feel slow.
 */
const READ_CONCURRENCY = 8;

/** A basket launched at one whole settlement unit per basket token, so this is the floor. */
const EMPTY_BASKET_NAV = (settlementDecimals: number): bigint => 10n ** BigInt(settlementDecimals);

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * Reads a token's own name, symbol and decimals.
 *
 * From the token rather than from configuration: the decimals of the settlement
 * asset are the scale every figure in the application is expressed in, and a
 * hard-coded 6 for USDT is wrong on any test network that deploys a mock with
 * 18. The contracts read it the same way, so the two agree by construction.
 */
export async function readTokenMetadata(
  client: PublicClient,
  token: Address,
): Promise<TokenMetadata> {
  const [symbol, name, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
  ]);

  return { address: token, symbol, name, decimals: Number(decimals) };
}

/**
 * The current price of each token, in settlement smallest units.
 *
 * Exists so a caller that is not looking at a basket can still price a list of
 * tokens — the supported-asset table on the landing page, and the asset picker
 * in the creation flow. Both need the same thing, and neither has a basket to
 * read a provider from, so the provider is passed in explicitly here.
 *
 * That is the one place this differs from the basket path, and the difference is
 * deliberate: a basket is bound to the provider it was created with, so its
 * prices must come from that provider or an admin's later swap would reprice an
 * old basket. A list of assets that belongs to no basket has no such binding,
 * and the factory's current provider is the right one.
 *
 * A token the feed cannot price comes back with `null`, not zero.
 */
export async function readTokenPrices(
  client: PublicClient,
  priceProvider: Address,
  tokens: readonly Address[],
): Promise<Array<{ token: Address; price: bigint | null }>> {
  const prices = await mapLimit(tokens, READ_CONCURRENCY, (token) =>
    readPrice(client, priceProvider, token),
  );

  return tokens.map((token, index) => ({ token, price: prices[index] ?? null }));
}

/** An ERC-20 balance, or zero for an address that has never held the token. */
export async function readBalance(
  client: PublicClient,
  token: Address,
  account: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account],
  });
}

/** The current allowance `owner` has granted `spender`. */
export async function readAllowance(
  client: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  });
}

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

/** The protocol's creation terms: the ceiling a creator may not exceed, or the default applied. */
export interface CreationTerms {
  depositFeeBps: Bps;
  redeemFeeBps: Bps;
  creatorShareBps: Bps;
  maxSlippageBps: Bps;
}

/** Protocol-wide configuration and the creation terms currently in force. */
export interface FactoryConfig {
  settlementToken: TokenMetadata;
  priceProvider: Address;
  dexAdapter: Address;
  protocolAdmin: Address;
  protocolTreasury: Address;
  /** Baskets created so far. Also the highest valid index for `basketAt`. */
  basketCount: number;
  /** Whether the component allowlist is enforced when creating a basket. */
  allowlistEnforced: boolean;
  /** Applied when a creator does not specify their own. */
  defaults: CreationTerms;
  /** The highest values an admin will currently accept from a creator. */
  limits: CreationTerms;
  /** Immutable constants the contract enforces regardless of admin settings. */
  absoluteCeilings: {
    feeBps: Bps;
    creatorShareBps: Bps;
    slippageBps: Bps;
  };
  /** Most components a basket may hold. Read from the factory, never assumed. */
  maxComponents: number;
}

/** Reads the factory's configuration and creation terms in one pass. */
export async function readFactoryConfig(
  client: PublicClient,
  factory: Address,
): Promise<FactoryConfig> {
  const contract = { address: factory, abi: basketFactoryAbi } as const;

  const [
    settlementTokenAddress,
    priceProvider,
    dexAdapter,
    protocolAdmin,
    protocolTreasury,
    basketCount,
    allowlistEnforced,
    defaultDepositFeeBps,
    defaultRedeemFeeBps,
    defaultCreatorShareBps,
    defaultMaxSlippageBps,
    maxDepositFeeBps,
    maxRedeemFeeBps,
    maxCreatorShareBps,
    maxSlippageBps,
    absoluteMaxFeeBps,
    absoluteMaxCreatorShareBps,
    absoluteMaxSlippageBps,
    maxComponents,
  ] = await Promise.all([
    client.readContract({ ...contract, functionName: 'settlementToken' }),
    client.readContract({ ...contract, functionName: 'priceProvider' }),
    client.readContract({ ...contract, functionName: 'dexAdapter' }),
    client.readContract({ ...contract, functionName: 'protocolAdmin' }),
    client.readContract({ ...contract, functionName: 'protocolTreasury' }),
    client.readContract({ ...contract, functionName: 'basketCount' }),
    client.readContract({ ...contract, functionName: 'allowlistEnforced' }),
    client.readContract({ ...contract, functionName: 'defaultDepositFeeBps' }),
    client.readContract({ ...contract, functionName: 'defaultRedeemFeeBps' }),
    client.readContract({ ...contract, functionName: 'defaultCreatorShareBps' }),
    client.readContract({ ...contract, functionName: 'defaultMaxSlippageBps' }),
    client.readContract({ ...contract, functionName: 'maxDepositFeeBps' }),
    client.readContract({ ...contract, functionName: 'maxRedeemFeeBps' }),
    client.readContract({ ...contract, functionName: 'maxCreatorShareBps' }),
    client.readContract({ ...contract, functionName: 'maxSlippageBps' }),
    client.readContract({ ...contract, functionName: 'ABSOLUTE_MAX_FEE_BPS' }),
    client.readContract({ ...contract, functionName: 'ABSOLUTE_MAX_CREATOR_SHARE_BPS' }),
    client.readContract({ ...contract, functionName: 'ABSOLUTE_MAX_SLIPPAGE_BPS' }),
    client.readContract({ ...contract, functionName: 'MAX_COMPONENTS' }),
  ]);

  return {
    settlementToken: await readTokenMetadata(client, settlementTokenAddress),
    priceProvider,
    dexAdapter,
    protocolAdmin,
    protocolTreasury,
    basketCount: Number(basketCount),
    allowlistEnforced,
    defaults: {
      depositFeeBps: Number(defaultDepositFeeBps),
      redeemFeeBps: Number(defaultRedeemFeeBps),
      creatorShareBps: Number(defaultCreatorShareBps),
      maxSlippageBps: Number(defaultMaxSlippageBps),
    },
    limits: {
      depositFeeBps: Number(maxDepositFeeBps),
      redeemFeeBps: Number(maxRedeemFeeBps),
      creatorShareBps: Number(maxCreatorShareBps),
      maxSlippageBps: Number(maxSlippageBps),
    },
    absoluteCeilings: {
      feeBps: Number(absoluteMaxFeeBps),
      creatorShareBps: Number(absoluteMaxCreatorShareBps),
      slippageBps: Number(absoluteMaxSlippageBps),
    },
    maxComponents: Number(maxComponents),
  };
}

/**
 * Every basket address the factory knows about.
 *
 * The contract exposes `allBaskets()` in one call, and also `basketAt(index)`.
 * This prefers the single call and falls back to indexing only if it reverts,
 * which keeps the discover page to one request on every deployment we ship.
 */
export async function readBasketAddresses(
  client: PublicClient,
  factory: Address,
): Promise<Address[]> {
  try {
    return (await client.readContract({
      address: factory,
      abi: basketFactoryAbi,
      functionName: 'allBaskets',
    })) as Address[];
  } catch {
    const count = Number(
      await client.readContract({
        address: factory,
        abi: basketFactoryAbi,
        functionName: 'basketCount',
      }),
    );
    return mapLimit(
      Array.from({ length: count }, (_, index) => index),
      READ_CONCURRENCY,
      (index) =>
        client.readContract({
          address: factory,
          abi: basketFactoryAbi,
          functionName: 'basketAt',
          args: [BigInt(index)],
        }) as Promise<Address>,
    );
  }
}

/** The baskets a creator has made, for the dashboard. */
export async function readCreatorBaskets(
  client: PublicClient,
  factory: Address,
  creator: Address,
): Promise<Address[]> {
  return client.readContract({
    address: factory,
    abi: basketFactoryAbi,
    functionName: 'basketsByCreator',
    args: [creator],
  }) as Promise<Address[]>;
}

/**
 * Whether each address may be used as a component.
 *
 * Only meaningful while the allowlist is enforced; with enforcement off every
 * address is permitted and the contract returns true for all of them, so this
 * is safe to call unconditionally.
 */
export async function readComponentAllowlist(
  client: PublicClient,
  factory: Address,
  components: readonly Address[],
): Promise<Record<string, boolean>> {
  const results = await mapLimit(
    components,
    READ_CONCURRENCY,
    (component) =>
      client.readContract({
        address: factory,
        abi: basketFactoryAbi,
        functionName: 'isComponentAllowed',
        args: [component],
      }) as Promise<boolean>,
  );

  return Object.fromEntries(
    components.map((component, index) => [component, results[index] ?? false]),
  );
}

// ---------------------------------------------------------------------------
// Baskets
// ---------------------------------------------------------------------------

/** Reads the composition as published: component addresses and their target weights. */
async function readComposition(
  client: PublicClient,
  basket: Address,
): Promise<{ components: Address[]; weightsBps: bigint[] }> {
  const [components, weightsBps] = (await client.readContract({
    address: basket,
    abi: thematicBasketAbi,
    functionName: 'getComposition',
  })) as [Address[], bigint[]];

  return { components, weightsBps };
}

/**
 * Symbols for a set of components, shared across every row of a list.
 *
 * A discover page over twenty baskets of five components each would otherwise
 * request the same handful of symbols a hundred times. The same token appears in
 * many baskets, so one cache turns a hundred requests into eight.
 */
async function readSymbols(
  client: PublicClient,
  components: readonly Address[],
  cache: Map<Address, string>,
): Promise<void> {
  const missing = [...new Set(components.filter((component) => !cache.has(component)))];
  if (missing.length === 0) return;

  const symbols = await mapLimit(missing, READ_CONCURRENCY, async (component) => {
    const symbol = await settle(
      client.readContract({
        address: component,
        abi: erc20Abi,
        functionName: 'symbol',
      }) as Promise<string>,
      null,
    );
    // A component that will not report a symbol is still part of the basket, so
    // it gets a placeholder rather than dropping out of the allocation band.
    return symbol ?? '???';
  });

  missing.forEach((component, index) => cache.set(component, symbols[index] ?? '???'));
}

/**
 * The headline figures for one basket, cheap enough to run for every row.
 *
 * Valuation reads are wrapped in `settle`: a basket containing one asset whose
 * price feed has gone quiet reverts `totalAssets()` and `navPerShare()` with
 * `ComponentNotPriceable`. Letting that propagate would blank the entire
 * discover page because of one bad feed. Instead the row still renders its name,
 * theme and published composition, and the figures come back `null`, which the
 * UI reports as unavailable — which is what is actually true.
 */
export async function readBasketSummaries(
  client: PublicClient,
  addresses: readonly Address[],
  sharedSymbolCache?: Map<Address, string>,
): Promise<BasketSummary[]> {
  const symbolCache = sharedSymbolCache ?? new Map<Address, string>();

  return mapLimit(addresses, READ_CONCURRENCY, async (address): Promise<BasketSummary> => {
    const basket = { address, abi: thematicBasketAbi } as const;

    const [
      name,
      symbol,
      theme,
      description,
      creator,
      totalSupply,
      componentCount,
      paused,
      composition,
    ] = await Promise.all([
      client.readContract({ ...basket, functionName: 'name' }),
      client.readContract({ ...basket, functionName: 'symbol' }),
      client.readContract({ ...basket, functionName: 'theme' }),
      client.readContract({ ...basket, functionName: 'description' }),
      client.readContract({ ...basket, functionName: 'creator' }),
      client.readContract({ ...basket, functionName: 'totalSupply' }),
      client.readContract({ ...basket, functionName: 'componentCount' }),
      client.readContract({ ...basket, functionName: 'paused' }),
      readComposition(client, address),
    ]);

    const supply = totalSupply as bigint;
    const funded = supply > 0n;

    // Only ask for valuation once we know there is something to value.
    const [totalAssets, navPerShare] = funded
      ? await Promise.all([
          settle(
            client.readContract({ ...basket, functionName: 'totalAssets' }) as Promise<bigint>,
            null,
          ),
          settle(
            client.readContract({ ...basket, functionName: 'navPerShare' }) as Promise<bigint>,
            null,
          ),
        ])
      : [null, null];

    await readSymbols(client, composition.components, symbolCache);

    return {
      address,
      name: name as string,
      symbol: symbol as string,
      theme: theme as string,
      description: description as string,
      creator: creator as Address,
      totalSupply: supply,
      totalAssets,
      navPerShare,
      componentCount: Number(componentCount),
      paused: paused as boolean,
      weights: composition.components.map((component, index) => ({
        address: component,
        symbol: symbolCache.get(component) ?? '???',
        weightBps: Number(composition.weightsBps[index] ?? 0n),
      })),
    };
  });
}

/** A single basket summary. The list reader with one address, so there is one code path. */
export async function readBasketSummary(
  client: PublicClient,
  address: Address,
): Promise<BasketSummary> {
  const [summary] = await readBasketSummaries(client, [address]);
  if (!summary) throw new Error(`No basket at ${address}.`);
  return summary;
}

/**
 * Everything the basket detail page shows, in one pass.
 *
 * Reads per-component prices and balances because the detail page shows the
 * realised allocation alongside the published one, and the two differ as soon as
 * prices move. The published weights are the basket's rule; the realised weights
 * are what actually happened, and showing only the first would misrepresent the
 * risk someone is taking on.
 */
export async function readBasket(client: PublicClient, address: Address): Promise<Basket> {
  const contract = { address, abi: thematicBasketAbi } as const;

  const [
    name,
    symbol,
    decimals,
    description,
    theme,
    creator,
    settlementToken,
    settlementDecimals,
    priceProvider,
    totalSupply,
    paused,
    depositFeeBps,
    redeemFeeBps,
    creatorShareBps,
    maxSlippageBps,
    composition,
  ] = await Promise.all([
    client.readContract({ ...contract, functionName: 'name' }),
    client.readContract({ ...contract, functionName: 'symbol' }),
    client.readContract({ ...contract, functionName: 'decimals' }),
    client.readContract({ ...contract, functionName: 'description' }),
    client.readContract({ ...contract, functionName: 'theme' }),
    client.readContract({ ...contract, functionName: 'creator' }),
    client.readContract({ ...contract, functionName: 'settlementToken' }),
    client.readContract({ ...contract, functionName: 'settlementDecimals' }),
    client.readContract({ ...contract, functionName: 'priceProvider' }),
    client.readContract({ ...contract, functionName: 'totalSupply' }),
    client.readContract({ ...contract, functionName: 'paused' }),
    client.readContract({ ...contract, functionName: 'depositFeeBps' }),
    client.readContract({ ...contract, functionName: 'redeemFeeBps' }),
    client.readContract({ ...contract, functionName: 'creatorShareBps' }),
    client.readContract({ ...contract, functionName: 'maxSlippageBps' }),
    readComposition(client, address),
  ]);

  const supply = totalSupply as bigint;
  const provider = priceProvider as Address;

  const components = await mapLimit(
    composition.components,
    READ_CONCURRENCY,
    async (component, index): Promise<BasketComponent> => {
      const [metadata, balance, price] = await Promise.all([
        readTokenMetadata(client, component),
        settle(
          client.readContract({
            address: component,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          }) as Promise<bigint>,
          0n,
        ),
        readPrice(client, provider, component),
      ]);

      return {
        ...metadata,
        weightBps: Number(composition.weightsBps[index] ?? 0n),
        price,
        balance,
        value: valueOf(balance, price, metadata.decimals),
        realisedWeightBps: null,
      };
    },
  );

  // The contract is the authority on both figures. It reverts rather than
  // computing a total it cannot price, so a `null` here means "unknown" and
  // never "zero".
  //
  // Deriving the total by summing the components would be the tempting
  // alternative, and it is how a basket silently reports a plausible but
  // understated value: one quiet price feed contributes zero, the sum looks
  // reasonable, and nothing on the page says a holding went uncounted.
  const funded = supply > 0n;
  const [totalAssets, navPerShare] = funded
    ? await Promise.all([
        settle(
          client.readContract({ ...contract, functionName: 'totalAssets' }) as Promise<bigint>,
          null,
        ),
        settle(
          client.readContract({ ...contract, functionName: 'navPerShare' }) as Promise<bigint>,
          null,
        ),
      ])
    : [null, null];

  // The per-component values are still computed — the composition table shows
  // them, and the realised split is a share of the priced total. Realised
  // weights appear only when every component could be priced and the contract
  // agrees with the sum: two independent routes to the same figure, which is
  // the condition under which a share of it means anything.
  const summed = sum(components.map((component) => component.value ?? 0n));
  const fullyPriced =
    components.every((component) => component.value !== null) &&
    totalAssets !== null &&
    summed === totalAssets;

  const weighted = components.map((component) => ({
    ...component,
    realisedWeightBps:
      fullyPriced && totalAssets > 0n
        ? Number(((component.value ?? 0n) * BigInt(BPS_DENOMINATOR)) / totalAssets)
        : null,
  }));

  return {
    address,
    name: name as string,
    symbol: symbol as string,
    decimals: Number(decimals),
    description: description as string,
    theme: theme as string,
    creator: creator as Address,
    settlementToken: settlementToken as Address,
    settlementDecimals: Number(settlementDecimals),
    totalSupply: supply,
    totalAssets,
    // An unfunded basket has no market value to read, only its launch price.
    navPerShare: funded ? navPerShare : EMPTY_BASKET_NAV(Number(settlementDecimals)),
    components: weighted,
    fees: {
      depositFeeBps: Number(depositFeeBps),
      redeemFeeBps: Number(redeemFeeBps),
      creatorShareBps: Number(creatorShareBps),
      maxSlippageBps: Number(maxSlippageBps),
    },
    paused: paused as boolean,
  };
}

/**
 * One whole component token's value, in settlement smallest units.
 *
 * The provider address comes from the basket, not from configuration: a basket
 * is bound to the provider it was created with, and the factory's provider can
 * be swapped by an admin afterwards. Reading the factory's would price an old
 * basket with new infrastructure.
 *
 * Returns `null` rather than reverting when the feed has no price, so a single
 * unpriceable asset degrades its own row instead of the page.
 */
async function readPrice(
  client: PublicClient,
  priceProvider: Address,
  component: Address,
): Promise<bigint | null> {
  return settle(
    client.readContract({
      address: priceProvider,
      abi: priceProviderAbi,
      functionName: 'priceOf',
      args: [component],
    }) as Promise<bigint>,
    null,
  );
}

/**
 * `balance × price ÷ 10^decimals`, the valuation the contract performs.
 *
 * Plain bigint arithmetic: JavaScript's bigints do not overflow, so the
 * `mulDiv` the Solidity side needs for `uint256` has no counterpart here. The
 * two agree by truncation.
 */
function valueOf(balance: bigint, price: bigint | null, decimals: number): bigint | null {
  if (price === null) return null;
  return (balance * price) / 10n ** BigInt(decimals);
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/** A wallet's holding in one basket, valued at the current NAV. */
export async function readPosition(
  client: PublicClient,
  basket: Address,
  account: Address,
): Promise<BasketPosition> {
  const [shares, supply, settlementDecimals] = await Promise.all([
    readBalance(client, basket, account),
    client.readContract({
      address: basket,
      abi: thematicBasketAbi,
      functionName: 'totalSupply',
    }) as Promise<bigint>,
    client.readContract({
      address: basket,
      abi: thematicBasketAbi,
      functionName: 'settlementDecimals',
    }) as Promise<number>,
  ]);

  // Prefer the contract's own NAV so the figure matches what redemption would
  // actually pay. It reverts when a component is unpriceable; in that case the
  // holding is real but unpriced, and `value` is zero with `ownershipBps` still
  // reported — the position exists even when its worth cannot be stated.
  const nav = await settle(
    client.readContract({
      address: basket,
      abi: thematicBasketAbi,
      functionName: 'navPerShare',
    }) as Promise<bigint>,
    supply > 0n ? null : EMPTY_BASKET_NAV(Number(settlementDecimals)),
  );

  return {
    basket,
    shares,
    value: nav === null ? 0n : (shares * nav) / 10n ** 18n,
    ownershipBps: supply > 0n ? Number((shares * BigInt(BPS_DENOMINATOR)) / supply) : 0,
  };
}

/** A creator's claimable fees, per basket, for the dashboard. */
export async function readCreatorEarnings(
  client: PublicClient,
  baskets: readonly Address[],
  creator: Address,
): Promise<CreatorEarnings[]> {
  return mapLimit(baskets, READ_CONCURRENCY, async (basket): Promise<CreatorEarnings> => {
    const contract = { address: basket, abi: thematicBasketAbi } as const;

    const [claimable, symbol, name, basketCreator] = await Promise.all([
      // `null`, not `0n`, when the read fails. A creator who cannot read their
      // own accrued fees has to be told the figure is unknown; reporting zero
      // says there is nothing to claim, which is a different and much worse
      // statement than "this could not be read".
      settle(
        client.readContract({ ...contract, functionName: 'accruedCreatorFees' }) as Promise<bigint>,
        null,
      ),
      settle(
        client.readContract({ ...contract, functionName: 'symbol' }) as Promise<string>,
        '???',
      ),
      settle(
        client.readContract({ ...contract, functionName: 'name' }) as Promise<string>,
        'Unknown basket',
      ),
      settle(
        client.readContract({ ...contract, functionName: 'creator' }) as Promise<Address>,
        null,
      ),
    ]);

    // A basket the connected wallet did not create accrues nothing to it, and
    // the dashboard lists only its own — but the factory's list is the source of
    // truth, so the check is repeated here rather than assumed.
    //
    // This zero is a *known* zero, unlike the one above: the contract records a
    // single creator per basket, so a basket made by somebody else accrues to
    // this wallet exactly nothing, whatever that basket's fee balance happens to
    // be.
    const isOwner = basketCreator?.toLowerCase() === creator.toLowerCase();

    return { basket, symbol, name, claimable: isOwner ? claimable : 0n };
  });
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/** What a deposit would produce, as the contract would compute it. */
export interface DepositQuote {
  sharesOut: bigint;
  fee: bigint;
  netInvested: bigint;
}

/** What a redemption would pay, as the contract would compute it. */
export interface RedeemQuote {
  settlementOut: bigint;
  fee: bigint;
  gross: bigint;
}

/**
 * Simulates a deposit against current state.
 *
 * This is a preview, not a promise: prices move between the quote and the
 * transaction, which is what `minSharesOut` exists for. The UI presents it
 * alongside that minimum so the number on screen and the protection in the
 * transaction are visible together.
 */
export async function previewDeposit(
  client: PublicClient,
  basket: Address,
  amountIn: bigint,
): Promise<DepositQuote> {
  const [sharesOut, fee, netInvested] = (await client.readContract({
    address: basket,
    abi: thematicBasketAbi,
    functionName: 'previewDeposit',
    args: [amountIn],
  })) as [bigint, bigint, bigint];

  return { sharesOut, fee, netInvested };
}

/**
 * Simulates a redemption against current state.
 *
 * `previewRedeem` reverts under the same conditions `redeem` does — an
 * unpriceable component, a slice too small to sell across every holding. The
 * caller is expected to handle that: a preview that cannot be computed is
 * information, and the UI says which condition it hit rather than showing a
 * zero that would read as "your position is worthless".
 */
export async function previewRedeem(
  client: PublicClient,
  basket: Address,
  shares: bigint,
): Promise<RedeemQuote> {
  const [settlementOut, fee, gross] = (await client.readContract({
    address: basket,
    abi: thematicBasketAbi,
    functionName: 'previewRedeem',
    args: [shares],
  })) as [bigint, bigint, bigint];

  return { settlementOut, fee, gross };
}

/** A basket's raw balances, for the creator dashboard's treasury view. */
export async function readBasketBalances(
  client: PublicClient,
  basket: Address,
): Promise<{ free: bigint; creatorFees: bigint; protocolFees: bigint }> {
  const contract = { address: basket, abi: thematicBasketAbi } as const;
  const [free, creatorFees, protocolFees] = await Promise.all([
    client.readContract({ ...contract, functionName: 'freeSettlementBalance' }) as Promise<bigint>,
    client.readContract({ ...contract, functionName: 'accruedCreatorFees' }) as Promise<bigint>,
    client.readContract({ ...contract, functionName: 'accruedProtocolFees' }) as Promise<bigint>,
  ]);
  return { free, creatorFees, protocolFees };
}

/** The basket's fee parameters alone, for callers that need nothing else. */
export async function readBasketFees(client: PublicClient, basket: Address): Promise<BasketFees> {
  const contract = { address: basket, abi: thematicBasketAbi } as const;
  const [depositFeeBps, redeemFeeBps, creatorShareBps, maxSlippageBps] = await Promise.all([
    client.readContract({ ...contract, functionName: 'depositFeeBps' }) as Promise<number>,
    client.readContract({ ...contract, functionName: 'redeemFeeBps' }) as Promise<number>,
    client.readContract({ ...contract, functionName: 'creatorShareBps' }) as Promise<number>,
    client.readContract({ ...contract, functionName: 'maxSlippageBps' }) as Promise<number>,
  ]);
  return {
    depositFeeBps: Number(depositFeeBps),
    redeemFeeBps: Number(redeemFeeBps),
    creatorShareBps: Number(creatorShareBps),
    maxSlippageBps: Number(maxSlippageBps),
  };
}
