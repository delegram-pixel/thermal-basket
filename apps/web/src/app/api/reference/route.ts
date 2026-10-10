import { BINANCE_CHAIN_ID } from '@/lib/binance/env.ts';
import { listedTokens, referencePrices } from '@/lib/binance/rwa.ts';
import { KNOWN_UNDERLYINGS, underlyingFor } from '@/lib/binance/symbols.ts';
import type { ReferenceFeed } from '@/lib/binance/wire.ts';

/**
 * Reference prices for the components in this deployment.
 *
 * `GET /api/reference?symbols=NVDA,MSFT` — defaults to every underlying the
 * deployment knows.
 *
 * The route answers `200` even when the feed is down, and says so in the body.
 * That is not a technicality: on a deployment with no API key, "the reference
 * feed is not configured" is the correct and expected state, and a `5xx` would
 * make it indistinguishable from this route being broken. The two want different
 * words on screen, so the status code is reserved for this handler failing
 * rather than for the upstream feed doing so.
 *
 * Caching is off. A reference price is only interesting next to the on-chain
 * price it is being compared with, and serving a cached one would silently
 * compare two figures taken at different times.
 *
 * It also returns how many listings one call to the API's token catalogue
 * endpoint returned, so a row with no reference price can be read against how
 * many listings the feed is seeing at all.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Do not let this run from a United States region: Binance's RWA endpoints answer
// `40304 Service not available due to compliance restriction` from `iad1`. The
// region is pinned in `vercel.json`, not here, because the `preferredRegion` route
// segment config is deprecated in this version of Next.

export async function GET(request: Request) {
  const requested = (new URL(request.url).searchParams.get('symbols') ?? '')
    .split(',')
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  // Everything goes through `underlyingFor`, so a caller can pass either the
  // component symbol (`mNVDA`) or the ticker (`NVDA`) and get the same answer.
  const symbols = (requested.length > 0 ? requested : [...KNOWN_UNDERLYINGS])
    .map(underlyingFor)
    .slice(0, 16);

  // Both calls go out together: the catalogue is one request for the whole
  // deployment rather than one per ticker, so running it alongside the prices
  // costs latency only when it is the slower of the two. It is also allowed to
  // fail on its own — a missing count is a missing sentence, not a missing feed.
  const [result, catalogue] = await Promise.all([referencePrices(symbols), listedTokens()]);

  const body: ReferenceFeed = {
    source: 'binance-web3',
    chainId: BINANCE_CHAIN_ID,
    fetchedAt: new Date().toISOString(),
    prices: result.ok ? result.data : [],
    listed: catalogue.ok ? catalogue.data : null,
    ...(result.ok
      ? {}
      : {
          error: {
            reason: result.reason,
            status: result.status,
            ...(result.code ? { code: result.code } : {}),
            message: result.message,
          },
        }),
  };

  return Response.json(body, {
    headers: { 'cache-control': 'no-store' },
  });
}
