import { BINANCE_CHAIN_ID } from './env.ts';
import { binanceGet, type BinanceFailure, type BinanceResult } from './client.ts';

/**
 * The RWA Data endpoints, and the normalising that sits between them and the UI.
 *
 * The host was unreachable from the development machine for the whole window in
 * which this was written — DNS first, then the connection — so every request was
 * signed and sent blind. The first answers arrived only from a deployment, and
 * only once its functions ran outside a United States region, which the API
 * refuses with `40304`. The bodies then arrived a few at a time, and each one
 * corrected an assumption the last had left standing:
 *
 *   - `40001 Parameter binanceChainId is required`. The chain is not `chainId`.
 *   - `/search` files the contract address under `tokenContractAddress`, which is
 *     not any of the names this reader was looking for. Resolution had been
 *     returning nothing, quietly, for as long as it had been running.
 *   - A ticker is not one token. Searching `NVDA` returns the same underlying
 *     twice — chain 56 at `0x9aee…f75f`, chain 1 at `0x2d1f…bdee` — so the chain
 *     is part of the identity and not an attribute to pick a favourite from.
 *   - `/price` answers `40001 Parameter tokenContractAddresses is required`,
 *     plural, while its sibling `/underlying-profile` spells the same concept in
 *     the singular. Neither accepts a ticker, though both of the endpoints that
 *     resolve one do.
 *
 * The search and tokens payloads have now been seen, so `searchUnderlying` and
 * `listedTokens` read them exactly. The price and profile payloads still have
 * not, so those readers walk candidate keys and return `null` rather than
 * throwing — an unanticipated shape degrades to an empty column instead of a
 * broken page. Replacing a walker with a fixed path is what it means for a body
 * to stop being a guess, and it should happen one endpoint at a time as each is
 * seen rather than all at once.
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

/** The real key leads. It was absent from the first version of this list, which
 *  is why address resolution returned `null` on every search for as long as it
 *  ran without anyone being told. */
const ADDRESS_KEYS = [
  'tokenContractAddress',
  'tokenAddress',
  'contractAddress',
  'address',
] as const;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A trimmed non-empty string, or `null`. The API pads some fields and sends
 *  `""` for others, and the two are the same absence as far as the UI goes. */
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

/**
 * Reads one `/search` payload.
 *
 * This indexes rather than walks, because the body has been seen:
 *
 *   {"code":0,"msg":"success","data":[{"ticker":"NVDA",
 *     "companyName":"Nvidia Corp","assets":[
 *       {"platformId":"ondo","binanceChainId":"56","tokenContractAddress":"0x9aee…f75f",…},
 *       {"platformId":"ondo","binanceChainId":"1","tokenContractAddress":"0x2d1f…bdee",…}]}]}
 *
 * The one thing it does not take on trust is *which* asset to read. `NVDA`
 * resolves to two tokens on two chains at two addresses, so the chain decides;
 * taking `assets[0]` would be correct here by accident and wrong the moment the
 * API ordered them the other way, and the failure would be a price for the wrong
 * chain rather than a missing one.
 *
 * Exported for the test that pins it against the payload above. That test earns
 * its place more than most: the field name this reader was originally looking for
 * simply did not appear in the response, and because the reader returns `null`
 * rather than throwing, nothing anywhere said so.
 */
export function readSearchResult(payload: unknown, symbol: string): ReferencePrice {
  const listings = Array.isArray(payload) ? payload.filter(isRecord) : [];

  // The endpoint is a search, not a lookup. An exact ticker match is preferred,
  // and the API's own first result is the fallback: for a ticker it does not
  // list, the honest answer is whatever it offered rather than an error invented
  // here. `companyName` is the company; `ticker` is the fallback name, because a
  // name equal to the ticker still reads better than a blank cell.
  const listing =
    listings.find(
      (entry) => nonEmptyString(entry.ticker)?.toUpperCase() === symbol.toUpperCase(),
    ) ?? listings[0];

  const assets = Array.isArray(listing?.assets) ? listing.assets.filter(isRecord) : [];
  const onChain = assets.find(
    (asset) => nonEmptyString(asset.binanceChainId) === String(BINANCE_CHAIN_ID),
  );

  return {
    symbol,
    // `/search` carries no price. The field exists so this shares a type with a
    // resolved price row, and it is `null` because the endpoint said nothing —
    // not because a lookup failed.
    price: null,
    name: nonEmptyString(listing?.companyName) ?? nonEmptyString(listing?.ticker),
    tokenAddress: nonEmptyString(onChain?.tokenContractAddress),
  };
}

/** Resolves a ticker through `rwa/search`, so the price call can be told what it
 *  is pricing rather than being asked to guess. */
export async function searchUnderlying(symbol: string): Promise<BinanceResult<ReferencePrice>> {
  const cached = searchCache.get(symbol);
  if (cached) return { ok: true, data: cached };

  const result = await binanceGet<unknown>(ENDPOINTS.search, {
    binanceChainId: BINANCE_CHAIN_ID,
    keyword: symbol,
  });

  if (!result.ok) return result;

  const resolved = readSearchResult(result.data, symbol);
  searchCache.set(symbol, resolved);

  return { ok: true, data: resolved };
}

/**
 * Reference prices for a list of tickers.
 *
 * Two requests per ticker, not one: `/price` is keyed by contract address and
 * answers `40001` to a ticker, so the search call has to run first. It is cached
 * for the life of the process, so the second and later pages pay for the price
 * call only. Neither endpoint documents a batch form, which is itself a finding —
 * a deployment holding eight components makes eight round trips per feed.
 */
export async function referencePrices(
  symbols: readonly string[],
): Promise<BinanceResult<ReferencePrice[]>> {
  const prices: ReferencePrice[] = [];
  let lastFailure: BinanceFailure | null = null;

  for (const symbol of symbols) {
    const resolved = await searchUnderlying(symbol);
    if (!resolved.ok) {
      lastFailure = resolved;
      prices.push({ symbol, price: null, name: null, tokenAddress: null });
      continue;
    }

    const { name, tokenAddress } = resolved.data;

    // No address means the ticker is not listed on this chain, and `/price` has
    // nothing to be asked about. Worth saying in those words: an empty price
    // beside a ticker the API does not carry is a different fact from a price
    // call that failed, and the row reads the same either way without this.
    if (!tokenAddress) {
      lastFailure = {
        ok: false,
        reason: 'rejected',
        status: 0,
        code: '40001',
        message: `The API lists no tokenized ${symbol} on chain ${BINANCE_CHAIN_ID}, and /price is keyed by contract address.`,
      };
      prices.push({ symbol, price: null, name, tokenAddress: null });
      continue;
    }

    const result = await binanceGet<unknown>(ENDPOINTS.price, {
      binanceChainId: BINANCE_CHAIN_ID,
      // Plural, and the API's own spelling: the sibling `/underlying-profile`
      // wants `tokenContractAddress`. One address is sent because one address was
      // resolved. Whether the parameter takes a list, and in what syntax, is not
      // yet known, and is not worth guessing at while a single address may be the
      // whole of what it wants.
      tokenContractAddresses: tokenAddress,
    });

    if (!result.ok) {
      lastFailure = result;
      prices.push({ symbol, price: null, name, tokenAddress });
      continue;
    }

    // The price body has not been seen, so the readers walk it — but the name and
    // address are already known from the search, and falling back to those means
    // an unexpected field name costs a column rather than a row.
    prices.push({
      symbol,
      price: firstNumber(result.data, PRICE_KEYS),
      name: firstString(result.data, NAME_KEYS) ?? name,
      tokenAddress: firstString(result.data, ADDRESS_KEYS) ?? tokenAddress,
    });
  }

  // Every ticker failing is a failed request, not eight empty rows. Reporting it
  // as success would put a table of dashes on screen with no explanation.
  if (prices.length > 0 && prices.every((entry) => entry.price === null) && lastFailure) {
    return lastFailure;
  }

  return { ok: true, data: prices };
}

/**
 * The company behind a ticker, from the profile and fundamentals endpoints.
 *
 * Both are keyed by contract address rather than by ticker: handed a symbol they
 * answer `40001 Parameter tokenContractAddress is required`. So the ticker is
 * resolved through `rwa/search` first — the only one of the five that accepts a
 * human-readable name — and the address it returns is what the other two are
 * asked about. That makes the search call load-bearing rather than decorative.
 */
export async function underlyingProfile(symbol: string): Promise<BinanceResult<UnderlyingProfile>> {
  const resolved = await searchUnderlying(symbol);
  if (!resolved.ok) return resolved;

  const tokenContractAddress = resolved.data.tokenAddress;
  if (!tokenContractAddress) {
    const failure: BinanceFailure = {
      ok: false,
      reason: 'rejected',
      status: 0,
      code: '40001',
      message: `The API lists no tokenized ${symbol} on chain ${BINANCE_CHAIN_ID}, and the profile endpoints are keyed by contract address.`,
    };
    return failure;
  }

  const query = { binanceChainId: BINANCE_CHAIN_ID, tokenContractAddress };
  const [profile, market] = await Promise.all([
    binanceGet<unknown>(ENDPOINTS.profile, query),
    binanceGet<unknown>(ENDPOINTS.market, query),
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
 * How many listings one `/tokens` call returns.
 *
 * Deliberately not described as the size of the API's catalogue. Whether this
 * endpoint paginates has not been established — the response seen so far carries
 * no total to compare a page against — so a count presented as the catalogue
 * size could be a page size wearing the wrong label. What one call returned is
 * what the sentence beside this number is allowed to claim.
 *
 * The count is the smallest honest use of the endpoint available; anything more —
 * showing the catalogue itself — would be a new surface rather than a fifth call.
 */
export async function listedTokens(): Promise<BinanceResult<number>> {
  const result = await binanceGet<unknown>(ENDPOINTS.tokens, { binanceChainId: BINANCE_CHAIN_ID });
  if (!result.ok) return result;

  // The envelope has been seen — `data` is the array of listings — so this counts
  // it rather than searching the payload for something array-shaped. Answering
  // `0` for an unrecognised shape would render as "holds 0 tokenized stocks",
  // which is a claim about the API rather than about this reader.
  if (!Array.isArray(result.data)) {
    return {
      ok: false,
      reason: 'malformed',
      status: 0,
      message: 'The /tokens payload did not contain the array of listings it has returned before.',
    };
  }

  return { ok: true, data: result.data.length };
}
