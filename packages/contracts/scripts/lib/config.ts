/**
 * The mock market used on local chains and BSC testnet.
 *
 * There are no tokenized equities with real liquidity on BSC testnet, so the
 * demo runs on issued-for-the-purpose tokens and an administrator-set price
 * feed. Everything here is invented, and the frontend says so on every screen
 * that displays it. Keeping the invented values in one file makes them easy to
 * audit and easy to replace with real addresses when the protocol points at real
 * infrastructure.
 *
 * A price is the value of one whole token in whole settlement units, as a
 * string, converted to the settlement token's own smallest unit at use. That is
 * the same convention the contracts use — see IPriceProvider. These are
 * illustrative round-ish numbers, not quotes, and nothing in the interface
 * presents them as market data.
 */

export interface MockToken {
  symbol: string;
  name: string;
  decimals: number;
  /** Illustrative price per whole token, in whole settlement units. */
  price: string;
  /** Liquidity to seed against the settlement asset, in whole settlement units. */
  liquidityUsd: number;
}

/** Settlement asset decimals on the mock stack. */
export const SETTLEMENT_DECIMALS = 18;

/**
 * Deliberately not all 18 decimals. Mixed-decimal components are where valuation
 * arithmetic goes wrong, so the demo exercises them rather than avoiding them.
 */
export const MOCK_TOKENS: MockToken[] = [
  { symbol: 'mNVDA', name: 'Mock NVIDIA', decimals: 18, price: '175.42', liquidityUsd: 5_000_000 },
  {
    symbol: 'mMSFT',
    name: 'Mock Microsoft',
    decimals: 18,
    price: '512.30',
    liquidityUsd: 5_000_000,
  },
  {
    symbol: 'mGOOGL',
    name: 'Mock Alphabet',
    decimals: 18,
    price: '205.11',
    liquidityUsd: 5_000_000,
  },
  { symbol: 'mAMZN', name: 'Mock Amazon', decimals: 18, price: '228.75', liquidityUsd: 4_000_000 },
  {
    symbol: 'mMETA',
    name: 'Mock Meta Platforms',
    decimals: 8,
    price: '745.20',
    liquidityUsd: 4_000_000,
  },
  { symbol: 'mTSLA', name: 'Mock Tesla', decimals: 18, price: '412.60', liquidityUsd: 5_000_000 },
  { symbol: 'mCOIN', name: 'Mock Coinbase', decimals: 8, price: '305.90', liquidityUsd: 3_000_000 },
  {
    symbol: 'mMSTR',
    name: 'Mock MicroStrategy',
    decimals: 18,
    price: '342.15',
    liquidityUsd: 3_000_000,
  },
];

export interface SampleBasket {
  name: string;
  symbol: string;
  theme: string;
  description: string;
  /** Component symbol -> weight in basis points. Must sum to 10 000. */
  weights: Record<string, number>;
  depositFeeBps: number;
  redeemFeeBps: number;
  creatorShareBps: number;
  maxSlippageBps: number;
}

/**
 * Three baskets that differ in concentration, component count and decimal mix,
 * so the demo shows more than one shape of the product. The weights are a
 * stated editorial position, not a recommendation.
 */
export const SAMPLE_BASKETS: SampleBasket[] = [
  {
    name: 'AI Winners',
    symbol: 'AIW',
    theme: 'Artificial Intelligence',
    description:
      'The three companies with the most direct exposure to AI infrastructure spending: the ' +
      'accelerator supplier, the hyperscaler that buys them, and the search and cloud business ' +
      'whose ad revenue funds the capex. Concentrated by design — this basket is a thesis, not a ' +
      'diversified portfolio.',
    weights: { mNVDA: 3500, mMSFT: 3500, mGOOGL: 3000 },
    depositFeeBps: 50,
    redeemFeeBps: 0,
    creatorShareBps: 8000,
    maxSlippageBps: 300,
  },
  {
    name: 'Mega Cap Core',
    symbol: 'MCC',
    theme: 'Mega Cap Technology',
    description:
      'Four platforms of comparable size, equally weighted. The point of this basket is the ' +
      'rebalancing rule rather than the picks: equal weight forces the basket to sell what has ' +
      'run and buy what has lagged, which is the opposite of what a cap-weighted index does.',
    weights: { mMSFT: 2500, mGOOGL: 2500, mAMZN: 2500, mMETA: 2500 },
    depositFeeBps: 50,
    redeemFeeBps: 0,
    creatorShareBps: 8000,
    maxSlippageBps: 300,
  },
  {
    name: 'Crypto Beta',
    symbol: 'CRYB',
    theme: 'Crypto-Exposed Equities',
    description:
      'Listed companies whose earnings move with crypto prices rather than with the crypto ' +
      'assets themselves. The exchange, the corporate treasury holder, and the automaker with ' +
      'the largest disclosed digital-asset position. Higher variance than the other two baskets ' +
      'and weighted accordingly.',
    weights: { mCOIN: 4000, mMSTR: 3500, mTSLA: 2500 },
    depositFeeBps: 100,
    redeemFeeBps: 0,
    creatorShareBps: 8000,
    maxSlippageBps: 400,
  },
];

/** Default fee parameters the factory starts with. See BasketFactory. */
export const FACTORY_DEFAULTS: [number, number, number, number] = [50, 0, 8000, 300];
