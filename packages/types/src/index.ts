/**
 * Domain types shared by the blockchain layer and the web app.
 *
 * Two conventions run through everything here and are worth stating once:
 *
 * 1. **Basis points, never percentages.** Weights and fees are integers out of
 *    `BPS_DENOMINATOR`. A weight of 3500 is 35%. Mixing the two units is the
 *    single easiest way to be wrong by a factor of 100, so the type alias
 *    `Bps` exists to make the unit visible at every use site.
 *
 * 2. **Amounts are `bigint` in the token's smallest unit.** Nothing in this
 *    codebase stores a token amount as a float. Formatting happens once, at the
 *    edge, in `@thematic/blockchain`'s format helpers.
 */

/** An EVM address, in the checksum-agnostic form viem uses. */
export type Address = `0x${string}`;

/** Basis points: 1 bps = 0.01%. Always out of {@link BPS_DENOMINATOR}. */
export type Bps = number;

/** 100% expressed in basis points. Composition weights must sum to exactly this. */
export const BPS_DENOMINATOR = 10_000;

/** An integer token amount, denominated in that token's smallest unit. */
export type TokenAmount = bigint;

/** ERC-20 identity, as read from the token itself rather than assumed. */
export interface TokenMetadata {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

/** One constituent of a basket, with the live figures the UI displays. */
export interface BasketComponent extends TokenMetadata {
  /**
   * Target weight in basis points. This is the basket's published rule; the
   * realised weight drifts with price between rebalances, and there are no
   * rebalances in this version.
   */
  weightBps: Bps;
  /**
   * Value of one whole component token, in settlement smallest units.
   *
   * `null` when the price feed has no usable price for this asset. A feed with
   * a gap in it is a real operating condition, and it is not the same statement
   * as "this asset is worth zero" — collapsing the two would quietly value a
   * holding at nothing and misreport the basket's composition.
   */
  price: bigint | null;
  /** Component tokens the basket currently holds, in component smallest units. */
  balance: bigint;
  /** `balance` valued at `price`, in settlement smallest units. `null` with `price`. */
  value: bigint | null;
  /**
   * Realised share of the basket's assets, in basis points. `null` when the
   * basket holds nothing, or when any component is unpriceable and the total is
   * therefore unknown.
   */
  realisedWeightBps: Bps | null;
}

/** A basket's fee parameters, all immutable once the basket exists. */
export interface BasketFees {
  depositFeeBps: Bps;
  redeemFeeBps: Bps;
  creatorShareBps: Bps;
  maxSlippageBps: Bps;
}

/** Everything the basket detail page needs, from one on-chain read pass. */
export interface Basket {
  address: Address;
  name: string;
  symbol: string;
  /** Basket token decimals. Always 18; kept explicit so the UI never assumes. */
  decimals: number;
  description: string;
  theme: string;
  creator: Address;
  settlementToken: Address;
  settlementDecimals: number;
  /** Basket tokens outstanding, in basket smallest units. */
  totalSupply: bigint;
  /**
   * Value of everything held, in settlement smallest units, fees excluded.
   * `null` when the price feed cannot value every holding, so no total exists.
   */
  totalAssets: bigint | null;
  /**
   * Value of one whole basket token, in settlement smallest units.
   *
   * There is exactly one scale to undo when displaying this — the settlement
   * token's own decimals — and it is
   * `@thematic/blockchain`'s `formatNavPerShare` that undoes it. The contract's
   * internal `SHARE_SCALE` is not a second display scale.
   *
   * `null` when the feed cannot value every holding. Reporting a figure derived
   * from the components that *could* be priced would understate the basket while
   * looking entirely plausible, which is worse than saying nothing.
   */
  navPerShare: bigint | null;
  components: BasketComponent[];
  fees: BasketFees;
  paused: boolean;
}

/**
 * The subset the discover list reads.
 *
 * Kept separate from {@link Basket} because the list loads many baskets at
 * once and only needs the headline figures and the composition band. Reading
 * full component balances for every row would mean hundreds of calls to render
 * one page.
 */
export interface BasketSummary {
  address: Address;
  name: string;
  symbol: string;
  theme: string;
  description: string;
  creator: Address;
  totalSupply: bigint;
  /** `null` for a basket nobody has deposited into yet. */
  totalAssets: bigint | null;
  navPerShare: bigint | null;
  componentCount: number;
  paused: boolean;
  /** Composition as published, without live balances. Drives the allocation band. */
  weights: Array<{ address: Address; symbol: string; weightBps: Bps }>;
}

/** A connected wallet's holding in one basket. */
export interface BasketPosition {
  basket: Address;
  shares: bigint;
  /** `shares` valued at the current NAV, in settlement smallest units. */
  value: bigint;
  /** Share of the basket's supply, in basis points. Zero for a non-holder. */
  ownershipBps: Bps;
}

/** A creator's accrued fees across the baskets they created. */
export interface CreatorEarnings {
  basket: Address;
  symbol: string;
  name: string;
  /**
   * Claimable right now, in settlement smallest units.
   *
   * `null` when the read failed — which is not the same as zero. A dashboard
   * that renders an unreadable balance as `0` tells a creator there is nothing
   * to claim, and they believe it.
   */
  claimable: bigint | null;
}

/**
 * Transaction lifecycle, mirroring §20's state list exactly.
 *
 * `confirmed` and `failed` are the only terminal states. Nothing in the UI may
 * render a success state before `confirmed`: a transaction that has been
 * submitted is not a transaction that has happened.
 */
export type TransactionStatus =
  | 'idle'
  | 'preparing'
  | 'awaiting-wallet'
  | 'confirming'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'rejected';

/** A transaction as the UI tracks it. */
export interface TransactionState {
  status: TransactionStatus;
  /** Set once the wallet returns a hash, before confirmation. */
  hash?: Address;
  /** Set on `failed`. Human-readable; never a raw RPC string (§21). */
  error?: string;
  /** Whether the user can sensibly retry the same intent. */
  retryable: boolean;
}

/** The settlement asset and the mock component tokens, as deployed. */
export interface DeploymentAddresses {
  chainId: number;
  factory: Address;
  settlementToken: Address;
  priceProvider: Address;
  dexAdapter: Address;
  /**
   * Component symbol to address. Test networks only — on mainnet the
   * components are real tokenized equities and are discovered from the
   * baskets themselves, not from a list shipped in the bundle.
   */
  components: Record<string, Address>;
}
