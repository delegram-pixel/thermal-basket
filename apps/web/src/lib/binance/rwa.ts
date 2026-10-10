import { BINANCE_CHAIN_ID } from './env.ts';
import { binanceGet, type BinanceFailure, type BinanceResult } from './client.ts';

/**
 * The RWA Data endpoints, and the normalising that sits between them and the UI.
 *
 * One caveat governs this whole file and it is better stated than hidden: the
 * response bodies have not been observed against a live authenticated call. The
 * network path to `web3.binance.com` was filtered — DNS first, then the
 * connection itself — for the entire window in which this was written, and every
 * probe attempted from the development machine either failed to resolve or hung
 * until it timed out. See the DX report.
 *
 * So the field names below are candidates, not certainties, and the readers walk
 * the payload looking for any of them rather than indexing into a shape that was
 * guessed. That is defensive in a way a typed client should not have to be, and
 * it is the honest response to writing against unverified documentation. Every
 * reader returns `null` rather than throwing when it finds nothing, so an
 * unanticipated shape degrades to an empty column instead of a broken page.
 */

/** Field names a price has plausibly been given. First match wins. */
const PRICE_KEYS = [
  'price',
  'priceUsd',
  'usdPrice',
  'referencePrice',
  'refPrice',
  'lastPrice',
  'close',
  'markPrice',
] as const;

const NAME_KEYS = [
  'name',
  'tokenName',
  'underlyingName',
  'companyName',
  'displayName',
  'shortName',
] as const;

const ADDRESS_KEYS = ['tokenAddress', 'contractAddress', 'address', 'token'] as const;

/** Depth-limited walk. Deep enough for the envelopes this API uses, bounded so a
 *  self-referencing payload cannot spin. */
function walk(value: unknown, visit: (node: Record<string, unknown>) => boolean, depth = 0): void {
  if (depth > 4 || value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (visit(item as Record<string, unknown>)) return;
      walk(item, visit, depth + 1);
    }
    return;
  }

  const node = value as Record<string, unknown>;
  if (visit(node)) return;
  for (const child of Object.values(node)) {
    if (child && typeof child === 'object') walk(child, visit, depth + 1);
  }
}

/** The first finite number filed under any of `keys`, anywhere in the payload. */
function firstNumber(payload: unknown, keys: readonly string[]): number | null {
  let found: number | null = null;

  walk(payload, (node) => {
    for (const key of keys) {
      const value = node[key];
      const parsed = typeof value === 'string' ? Number(value) : value;
      if (typeof parsed === 'number' && Number.isFinite(parsed)) {
        found = parsed;
        return true;
      }
    }
    return false;
  });

  return found;
}

/** The first non-empty string filed under any of `keys`, anywhere in the payload. */
function firstString(payload: unknown, keys: readonly string[]): string | null {
  let found: string | null = null;

  walk(payload, (node) => {
    for (const key of keys) {
      const value = node[key];
      if (typeof value === 'string' && value.trim()) {
        found = value.trim();
        return true;
      }
    }
    return false;
  });

  return found;
}

/** The list of records inside an envelope, whatever it is nested under. */
function records(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;

  let found: Array<Record<string, unknown>> | null = null;
  walk(payload, (node) => {
    for (const value of Object.values(node)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        found = value as Array<Record<string, unknown>>;
        return true;
      }
    }
    return false;
  });

  return found ?? [];
}

/** One underlying's reference price, in the shape the interface consumes. */
export interface ReferencePrice {
  /** The ticker asked about, echoed back so a caller can match on it. */
  symbol: string;
  /** USD per whole share, or `null` when the API returned nothing usable. */
  price: number | null;
  /** The company or token name, when the API supplied one. */
  name: string | null;
  /** The on-chain token the API resolved the ticker to, when it resolved one. */
  tokenAddress: string | null;
}

/** A company profile, for the basket page. */
export interface UnderlyingProfile {
  symbol: string;
  name: string | null;
  description: string | null;
  sector: string | null;
  industry: string | null;
  /** Whatever the market-fundamentals endpoint returned that we can name. */
  marketCap: number | null;
}

/** The endpoints this integration calls, named once so the UI and README agree. */
export const ENDPOINTS = {
  search: '/api/v1/dex/market/rwa/search',
  price: '/api/v1/dex/market/rwa/price',
  tokens: '/api/v1/dex/market/rwa/tokens',
  profile: '/api/v1/dex/market/rwa/underlying-profile',
  market: '/api/v1/dex/market/rwa/underlying-market',
} as const;

/**
 * Ticker → token, cached for the life of the process.
 *
 * Which stock a ticker refers to does not change between requests, so resolving
 * it more than once is a round trip spent to learn something already known. The
 * cache is a plain `Map` rather than anything with an eviction policy because the
 * working set is the eight tickers this deployment ships with.
 */
const searchCache = new Map<string, ReferencePrice>();

/** Resolves a ticker through `rwa/search`, so the price call can be told what it
 *  is pricing rather than being asked to guess. */
export async function searchUnderlying(symbol: string): Promise<BinanceResult<ReferencePrice>> {
  const cached = searchCache.get(symbol);
  if (cached) return { ok: true, data: cached };

  const result = await binanceGet<unknown>(ENDPOINTS.search, {
    chainId: BINANCE_CHAIN_ID,
    keyword: symbol,
  });

  if (!result.ok) return result;

  const resolved: ReferencePrice = {
    symbol,
    price: firstNumber(result.data, PRICE_KEYS),
    name: firstString(result.data, NAME_KEYS),
    tokenAddress: firstString(result.data, ADDRESS_KEYS),
  };
  searchCache.set(symbol, resolved);

  return { ok: true, data: resolved };
}

/** Reference prices for a list of tickers. One request per ticker: the API
 *  documents no batch form, which is itself a DX finding. */
export async function referencePrices(
  symbols: readonly string[],
): Promise<BinanceResult<ReferencePrice[]>> {
  const prices: ReferencePrice[] = [];
  let lastFailure: BinanceFailure | null = null;

  for (const symbol of symbols) {
    // The search call is what makes this more than a price lookup: it is how the
    // ticker is resolved to a token before anything is priced, and its name is
    // what the interface shows beside the ticker.
    const resolved = await searchUnderlying(symbol);
    const fromSearch = resolved.ok ? resolved.data : null;

    const result = await binanceGet<unknown>(ENDPOINTS.price, {
      chainId: BINANCE_CHAIN_ID,
      symbol,
    });

    if (!result.ok) {
      lastFailure = result;
      prices.push({
        symbol,
        price: null,
        name: fromSearch?.name ?? null,
        tokenAddress: fromSearch?.tokenAddress ?? null,
      });
      continue;
    }

    prices.push({
      symbol,
      price: firstNumber(result.data, PRICE_KEYS),
      name: firstString(result.data, NAME_KEYS) ?? fromSearch?.name ?? null,
      tokenAddress: firstString(result.data, ADDRESS_KEYS) ?? fromSearch?.tokenAddress ?? null,
    });
  }

  // Every ticker failing is a failed request, not eight empty rows. Reporting it
  // as success would put a table of dashes on screen with no explanation.
  if (prices.length > 0 && prices.every((entry) => entry.price === null) && lastFailure) {
    return lastFailure;
  }

  return { ok: true, data: prices };
}

/** The company behind a ticker, from the profile and fundamentals endpoints. */
export async function underlyingProfile(symbol: string): Promise<BinanceResult<UnderlyingProfile>> {
  const [profile, market] = await Promise.all([
    binanceGet<unknown>(ENDPOINTS.profile, { chainId: BINANCE_CHAIN_ID, symbol }),
    binanceGet<unknown>(ENDPOINTS.market, { chainId: BINANCE_CHAIN_ID, symbol }),
  ]);

  if (!profile.ok) return profile;

  return {
    ok: true,
    data: {
      symbol,
      name: firstString(profile.data, NAME_KEYS),
      description: firstString(profile.data, [
        'description',
        'businessSummary',
        'overview',
        'about',
      ]),
      sector: firstString(profile.data, ['sector']),
      industry: firstString(profile.data, ['industry']),
      marketCap: market.ok
        ? firstNumber(market.data, ['marketCap', 'marketCapUsd', 'mcap', 'capitalization'])
        : null,
    },
  };
}

/**
 * How many tokenized stocks the API's catalogue holds.
 *
 * The reference feed carries the count so a reader can tell a ticker the API
 * does not list from a price call that failed. It is the smallest honest use of
 * the endpoint available; anything more — showing the catalogue itself — would
 * be a new surface rather than a fifth call.
 */
export async function listedTokens(): Promise<BinanceResult<number>> {
  const result = await binanceGet<unknown>(ENDPOINTS.tokens, { chainId: BINANCE_CHAIN_ID });
  if (!result.ok) return result;
  return { ok: true, data: records(result.data).length };
}
