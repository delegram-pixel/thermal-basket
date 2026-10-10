import {
  BINANCE_API_BASE,
  BINANCE_CHAIN_ID,
  BINANCE_TIMEOUT_MS,
  readCredentials,
} from '@/lib/binance/env.ts';
import { ENDPOINTS, searchUnderlying } from '@/lib/binance/rwa.ts';
import { signedPath } from '@/lib/binance/client.ts';
import { preHash, sign } from '@/lib/binance/sign.ts';
import type { HealthProbe, HealthReport } from '@/lib/binance/wire.ts';

/**
 * Say, per endpoint, whether the Binance Web3 API is answering.
 *
 * This exists because the integration was built against an API that could not be
 * reached from the development machine at all, and "which part is broken" is not
 * a question the application itself can answer when the answer is different on
 * every network. A panel that names each endpoint, its status, its latency and
 * the API's own error code turns a bad afternoon into a screenshot.
 *
 * It is a diagnostic, so it calls the API directly rather than going through
 * `binanceGet` — the shared client collapses every failure into one result, and
 * the point of this route is that failures stay distinguishable.
 *
 * It exposes nothing secret: the key is never echoed, and the body excerpt is
 * truncated and only returned to whoever can already reach this route.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Do not let this run from a United States region: Binance's RWA endpoints answer
// `40304 Service not available due to compliance restriction` from `iad1`. The
// region is pinned in `vercel.json`, not here, because the `preferredRegion` route
// segment config is deprecated in this version of Next.

/** A ticker the demo deployment definitely refers to. */
const PROBE_SYMBOL = 'NVDA';

export async function GET() {
  const credentials = readCredentials();

  if (!credentials) {
    const report: HealthReport = {
      source: 'binance-web3',
      fetchedAt: new Date().toISOString(),
      configured: false,
      probes: [],
    };
    return Response.json(report, { headers: { 'cache-control': 'no-store' } });
  }

  // The profile and fundamentals endpoints are keyed by contract address and
  // answer `40001 Parameter tokenContractAddress is required` when handed a ticker.
  // The probe resolves the ticker through the same helper the application uses, so
  // what is exercised here is the path the product actually takes. When resolution
  // fails the probe still runs and the endpoint's own complaint is what appears —
  // worth seeing rather than hiding.
  const resolved = await searchUnderlying(PROBE_SYMBOL);
  const addressParams: Record<string, string | number> =
    resolved.ok && resolved.data.tokenAddress
      ? { binanceChainId: BINANCE_CHAIN_ID, tokenContractAddress: resolved.data.tokenAddress }
      : { binanceChainId: BINANCE_CHAIN_ID };

  const targets: Array<[string, Record<string, string | number>]> = [
    [ENDPOINTS.search, { binanceChainId: BINANCE_CHAIN_ID, keyword: PROBE_SYMBOL }],
    [ENDPOINTS.price, { binanceChainId: BINANCE_CHAIN_ID, symbol: PROBE_SYMBOL }],
    [ENDPOINTS.tokens, { binanceChainId: BINANCE_CHAIN_ID }],
    [ENDPOINTS.profile, addressParams],
    [ENDPOINTS.market, addressParams],
  ];

  // Sequential rather than concurrent: this is a probe, and five simultaneous
  // requests against an API that may be rate-limiting produce a result that is
  // about the probe rather than about the API.
  const probes: HealthProbe[] = [];
  for (const [endpoint, query] of targets) {
    probes.push(await probe(endpoint, query, credentials));
  }

  const report: HealthReport = {
    source: 'binance-web3',
    fetchedAt: new Date().toISOString(),
    configured: true,
    probes,
  };

  return Response.json(report, { headers: { 'cache-control': 'no-store' } });
}

async function probe(
  endpoint: string,
  query: Record<string, string | number>,
  credentials: { apiKey: string; apiSecret: string },
): Promise<HealthProbe> {
  const requestPath = signedPath(endpoint, query);
  const timestamp = new Date().toISOString();
  const startedAt = Date.now();

  try {
    const response = await fetch(`${BINANCE_API_BASE}${requestPath}`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(BINANCE_TIMEOUT_MS),
      headers: {
        'X-OC-APIKEY': credentials.apiKey,
        'X-OC-TIMESTAMP': timestamp,
        'X-OC-SIGN': sign(credentials.apiSecret, preHash(timestamp, 'GET', requestPath)),
        'X-OC-RECV-WINDOW': '60000',
        Accept: 'application/json',
      },
    });

    const text = await response.text();
    const ms = Date.now() - startedAt;

    let code: string | undefined;
    let message: string | undefined;
    try {
      const parsed = JSON.parse(text) as { code?: unknown; msg?: unknown; message?: unknown };
      if (parsed.code !== undefined && parsed.code !== null && String(parsed.code) !== '0') {
        code = String(parsed.code);
      }
      const raw = parsed.msg ?? parsed.message;
      if (typeof raw === 'string') message = raw;
    } catch {
      message = 'Response was not JSON.';
    }

    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      ms,
      ...(code ? { code } : {}),
      ...(message ? { message } : {}),
      // 500 characters, not 240. The success envelope is what the readers in
      // `rwa.ts` have to guess at, and a truncated search response can cut off
      // before the field that matters.
      sample: text.slice(0, 500),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      endpoint,
      ok: false,
      status: 0,
      ms: Date.now() - startedAt,
      message: timedOut
        ? `No answer within ${BINANCE_TIMEOUT_MS}ms.`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}
