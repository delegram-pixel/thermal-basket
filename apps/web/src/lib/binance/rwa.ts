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
 *   - A five-request probe drew `42900 Rate limit exceeded` on its fifth call,
 *     which is why resolution now comes out of the one-shot `/tokens` catalogue
 *     rather than one `/search` per ticker.
 *
 * This file began as an exercise in not knowing. The first version walked every
 * payload looking for a price under any of eight plausible field names, a company
 * name under any of six, an address under any of four — the right guess while
 * every body was unseen, and one that cost more than it saved. The address list
 * did not contain `tokenContractAddress`, so resolution returned `null` on every
 * call and said nothing, and the only symptom was two endpoints reporting a
 * parameter as required. That reads as their bug rather than ours, which is how it
 * read for a day.
 *
 * Four of the five bodies have now been seen and are indexed by name. The fifth,
 * `/underlying-market`, has not — the probe that reached it was the one that got
 * rate-limited — so one field keeps a walker, confined to the function that needs
 * it.
 */

/**
 * Depth-limited walk over a payload whose shape is not known.
 *
 * Used by {@link firstNumber} and nothing else, for the one field belonging to
 * `/underlying-market`, the only body this integration has never seen. Deep enough
 * for the envelopes this API uses, and bounded so a self-referencing payload
 * cannot spin.
 */
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

/** A finite number from a JSON value that may be a number or a numeric string.
 *  This API sends both, sometimes in the same object: `referencePrice` is the
 *  string `"230.815"` and the timestamp beside it is a number. */
function toNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

/**
 * The first finite number filed under any of `keys`, anywhere in the payload.
 *
 * The last walker left in the file, and it exists for exactly one field:
 * `/underlying-market` has not been read.
 */
function firstNumber(payload: unknown, keys: readonly string[]): number | null {
  let found: number | null = null;

  walk(payload, (node) => {
    for (const key of keys) {
      const parsed = toNumber(node[key]);
      if (parsed !== null) {
        found = parsed;
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

/**
 * What the API knows about one tokenized underlying.
 *
 * The shape follows the endpoint rather than the other way round, and the first
 * version did not. It promised `description`, `sector` and `industry` — plausible
 * fields for a company profile, and three fields this API does not have. A section
 * that renders it spent its life saying "the API returned no description for this
 * company" beside every holding, which is a true sentence about a question nobody
 * had asked.
 *
 * What the endpoint returns instead is more pointed than a blurb, and closer to
 * what this project is about: who issues the tokenized form, how many shares one
 * token represents, and links to the attestation reports the issuer publishes as
 * evidence the tokens are backed.
 */
export interface UnderlyingProfile {
  symbol: string;
  /** The issuer's full name for the underlying, e.g. `NVIDIA (Ondo)`. */
  name: string | null;
  /** Who issues the tokenized form, e.g. `ondo`. */
  platform: string | null;
  /** Units of the underlying that one token represents. */
  tokenToShareRatio: number | null;
  /** Proof-of-backing reports the issuer publishes, as links. */
  attestations: ReadonlyArray<{ label: string; url: string }>;
  /** From `/underlying-market`, whose body has not been seen. */
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

/**
 * Every listing the catalogue endpoint returns, fetched once per process.
 *
 * This is the cheap way to answer "which contract is NVDA on this chain": one
 * request for every listing, against one `/search` per ticker. That stopped being
 * a nicety when five sequential probes drew `42900 Rate limit exceeded` — a page
 * holding eight components was making seventeen calls to draw one table, and
 * nothing in the API's documentation had said a word about a burst limit.
 *
 * It is a cache and not a guarantee. Whether this endpoint paginates has not been
 * established, so a ticker missing from it still costs a `/search`. Failures are
 * deliberately not cached: a rate limit is a fact about this minute, not about the
 * catalogue, and remembering it would turn one bad request into a process that
 * can never resolve anything again.
 */
let catalogue: Array<Record<string, unknown>> | null = null;

async function catalogueListings(): Promise<BinanceResult<Array<Record<string, unknown>>>> {
  if (catalogue) return { ok: true, data: catalogue };

  const result = await binanceGet<unknown>(ENDPOINTS.tokens, { binanceChainId: BINANCE_CHAIN_ID });
  if (!result.ok) return result;

  if (!Array.isArray(result.data)) {
    return {
      ok: false,
      reason: 'malformed',
      status: 0,
      message: 'The /tokens payload did not contain the array of listings it has returned before.',
    };
  }

  catalogue = result.data.filter(isRecord);
  return { ok: true, data: catalogue };
}

/**
 * One ticker's listing in the catalogue, or `null` when it is not there.
 *
 * Matched on `underlyingTicker` and the chain together. `binanceChainId` is a
 * string in this payload and a number in the configuration, which is the kind of
 * mismatch that produces an empty table rather than an error.
 */
function catalogueMatch(
  listings: ReadonlyArray<Record<string, unknown>>,
  symbol: string,
): { tokenAddress: string | null; name: string | null } | null {
  const match = listings.find(
    (entry) =>
      nonEmptyString(entry.underlyingTicker)?.toUpperCase() === symbol.toUpperCase() &&
      nonEmptyString(entry.binanceChainId) === String(BINANCE_CHAIN_ID),
  );

  if (!match) return null;

  return {
    tokenAddress: nonEmptyString(match.tokenContractAddress),
    name: nonEmptyString(match.tokenName) ?? nonEmptyString(match.underlyingName),
  };
}

/**
 * Reads one `/price` payload.
 *
 *   {"code":0,"msg":"success","data":[{"binanceChainId":"56",
 *     "tokenContractAddress":"0x9aee…f75f","platformId":"ondo",
 *     "tokenPrice":"231.210905150846385687","referencePrice":"230.815",
 *     "tokenPriceUpdatedAt":1791661578408}]}
 *
 * Two prices arrive in one response and they are not the same number, which is
 * the whole reason this reads a named field rather than a plausible one:
 *
 *   - `referencePrice` (230.815) is the underlying company's own market price.
 *     That is the figure this interface publishes, and the one its column is
 *     labelled as being.
 *   - `tokenPrice` (231.210905150846385687) is the tokenized asset's own traded
 *     price — eighteen decimals of a related but different thing.
 *
 * The walker this replaces would have found `referencePrice` too, because the
 * name was in its candidate list, so nothing was visibly broken. It would have
 * gone on being right until a payload carried a field called `price` beside it,
 * and then a figure with no provenance would have appeared in a column that
 * promises one.
 *
 * Exported for the test that pins which of the two it reads.
 */
export function readPriceResult(payload: unknown): number | null {
  const rows = Array.isArray(payload) ? payload.filter(isRecord) : [];

  // Asked about one address, this answers with one row — but the chain is what
  // identifies which price is which, so it is matched rather than assumed.
  const row =
    rows.find((entry) => nonEmptyString(entry.binanceChainId) === String(BINANCE_CHAIN_ID)) ??
    rows[0];

  return toNumber(row?.referencePrice);
}

/** The attestation reports the profile endpoint names, and how to label them. */
const ATTESTATIONS: ReadonlyArray<readonly [string, string]> = [
  ['dailyAttestationReport', 'Daily attestation report'],
  ['monthlyAttestationReport', 'Monthly attestation report'],
];

/**
 * Reads one `/underlying-profile` payload.
 *
 *   {"code":0,"msg":"success","data":{"binanceChainId":"56",
 *     "tokenContractAddress":"0x9aee…f75f","platformId":"ondo",
 *     "underlyingTicker":"NVDA","underlyingFullName":"NVIDIA (Ondo)",
 *     "assetType":"1","tokenToShareRatio":"1.0017152487959898",
 *     "protections":{"dailyAttestationReport":{"supported":true,
 *       "description":null,"url":"https://…/daily-2026-10-07.pdf"}, …}}}
 *
 * `data` is an object here where `/search` and `/price` return an array, in the
 * same version of the same API family. That is not a detail worth smoothing over:
 * it is what a client has to be written against.
 *
 * A report is listed only when the issuer both says it supports one and supplies
 * a URL. `supported: true` with a null link is the API describing an arrangement
 * rather than a document, and a link to nothing is worse than no link.
 *
 * Exported for the test that pins the attestation filter.
 */
export function readProfileResult(
  payload: unknown,
  symbol: string,
  fallbackName: string | null,
): UnderlyingProfile {
  const data = isRecord(payload) ? payload : {};
  const protections = isRecord(data.protections) ? data.protections : {};

  const attestations = ATTESTATIONS.flatMap(([key, label]): Array<{ label: string; url: string }> => {
    const report = protections[key];
    if (!isRecord(report) || report.supported !== true) return [];
    const url = nonEmptyString(report.url);
    return url ? [{ label, url }] : [];
  });

  return {
    symbol,
    // The endpoint's full name first: `NVIDIA (Ondo)` names who tokenized it,
    // which is a fact about this asset that `Nvidia Corp` does not carry.
    name: nonEmptyString(data.underlyingFullName) ?? fallbackName,
    platform: nonEmptyString(data.platformId),
    tokenToShareRatio: toNumber(data.tokenToShareRatio),
    attestations,
    marketCap: null,
  };
}

/**
 * Resolves a ticker to the token this chain lists it as.
 *
 * The catalogue is tried first because it costs one request for the whole
 * deployment where `/search` costs one per ticker, and an address is the only
 * thing the price call actually needs. It is also the reason `/search` is still
 * here: a ticker the catalogue does not carry — because the API does not list it,
 * or because the catalogue is paginated and it is on a page we did not get — is
 * resolved the direct way, which is a request that only the miss pays for.
 */
export async function searchUnderlying(symbol: string): Promise<BinanceResult<ReferencePrice>> {
  const cached = searchCache.get(symbol);
  if (cached) return { ok: true, data: cached };

  const listings = await catalogueListings();
  if (listings.ok) {
    const match = catalogueMatch(listings.data, symbol);
    if (match?.tokenAddress) {
      const fromCatalogue: ReferencePrice = {
        symbol,
        price: null,
        name: match.name,
        tokenAddress: match.tokenAddress,
      };
      searchCache.set(symbol, fromCatalogue);
      return { ok: true, data: fromCatalogue };
    }
  }

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
 * One request per ticker, plus one for the catalogue: `/price` is keyed by
 * contract address and answers `40001` to a ticker, so an address has to be
 * resolved first, and `searchUnderlying` resolves all of them out of a single
 * `/tokens` call wherever it can. Nine requests for eight components rather than
 * seventeen, against an API that turned out to have a burst limit it does not
 * document.
 *
 * `/price` takes `tokenContractAddresses`, plural, which raises the obvious
 * question of whether one call could price a whole basket at once. That is worth
 * trying and it has not been tried; a single address is what is known to work.
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

    prices.push({
      symbol,
      price: readPriceResult(result.data),
      // Carried across from the resolution rather than looked for again: the
      // price payload has been read and it carries neither a name nor anything
      // this row needs beyond the number.
      name,
      tokenAddress,
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
 * answer `40001 Parameter tokenContractAddress is required`, so the ticker is
 * resolved first. `searchUnderlying` does that out of the cached catalogue without
 * a request of its own, which is what keeps this pair of calls from being a trio.
 *
 * `/underlying-profile` turns out to hold the more interesting half — who issues
 * the tokenized form, the token-to-share ratio, and the attestation reports the
 * issuer publishes — so the returned shape follows it rather than the company
 * blurb it was originally written to expect.
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
      ...readProfileResult(profile.data, symbol, resolved.data.name),
      // `/underlying-market` is the one body still unread — the probe that first
      // reached it drew `42900 Rate limit exceeded` — so this stays a walker, and
      // it is the only place in the file that still is one.
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
  // The same call `searchUnderlying` resolves addresses from, so the count and
  // the resolution share one request rather than making two.
  const listings = await catalogueListings();
  if (!listings.ok) return listings;

  return { ok: true, data: listings.data.length };
}
