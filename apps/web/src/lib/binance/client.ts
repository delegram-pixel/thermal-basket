import {
  BINANCE_API_BASE,
  BINANCE_RECV_WINDOW_MS,
  BINANCE_TIMEOUT_MS,
  readCredentials,
} from './env.ts';
import { preHash, sign } from './sign.ts';

/**
 * A signed GET against the Binance Web3 API.
 *
 * Two things about this file are deliberate.
 *
 * The first is that it never throws for an expected failure. A missing
 * credential, a filtered network and a rejected request are all states the
 * interface has to describe in words, and an exception is a poor carrier for
 * "this deployment has no API key" — the caller ends up catching to find out
 * something it could have been told. So the result is a discriminated union and
 * the caller switches on `ok`.
 *
 * The second is the timeout. Requests to this host from a network that filters
 * it do not fail, they hang: a probe during development ran to curl's 300-second
 * default three times over before anything was learned. A Route Handler that
 * waits three minutes has not avoided the failure, it has exported it to
 * whoever requested the page, so this gives up in seconds and says so.
 */

export type BinanceFailureReason =
  /** No credentials configured. The supported state for a fresh clone. */
  | 'unconfigured'
  /** The request never completed: DNS, TLS, a hang, a reset connection. */
  | 'unreachable'
  /** The API answered and said no. `code` carries its own reason. */
  | 'rejected'
  /** The API answered with something that is not the JSON envelope. */
  | 'malformed';

export interface BinanceFailure {
  ok: false;
  reason: BinanceFailureReason;
  /** HTTP status, or 0 when no response was received. */
  status: number;
  /** The API's own error code, when it supplied one. Recorded verbatim. */
  code?: string;
  message: string;
}

export interface BinanceSuccess<T> {
  ok: true;
  data: T;
}

export type BinanceResult<T> = BinanceSuccess<T> | BinanceFailure;

/**
 * The shape every endpoint answers in.
 *
 * Failures have been observed to arrive as `HTTP 200` carrying a non-zero `code`
 * and a `msg`, which is why the HTTP status is not what decides success here.
 * Success bodies have only been seen as a truncated excerpt, so the fields stay
 * optional and the code below tolerates their absence rather than asserting them.
 */
interface Envelope<T> {
  code?: string | number;
  msg?: string;
  message?: string;
  success?: boolean;
  data?: T;
}

/** Builds the signed path. Exported for the test that pins the `/build` prefix. */
export function signedPath(path: string, query: Record<string, string | number> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const queryString = search.toString();
  return `/build${path}${queryString ? `?${queryString}` : ''}`;
}

export async function binanceGet<T>(
  path: string,
  query: Record<string, string | number> = {},
): Promise<BinanceResult<T>> {
  const credentials = readCredentials();
  if (!credentials) {
    return {
      ok: false,
      reason: 'unconfigured',
      status: 0,
      message:
        'No Binance Web3 API credentials on this deployment. Set ' +
        'BINANCE_WEB3_API_KEY and BINANCE_WEB3_API_SECRET in apps/web/.env.local.',
    };
  }

  const requestPath = signedPath(path, query);
  const timestamp = new Date().toISOString();

  const headers: Record<string, string> = {
    'X-OC-APIKEY': credentials.apiKey,
    'X-OC-TIMESTAMP': timestamp,
    'X-OC-SIGN': sign(credentials.apiSecret, preHash(timestamp, 'GET', requestPath)),
    'X-OC-RECV-WINDOW': String(BINANCE_RECV_WINDOW_MS),
    Accept: 'application/json',
  };

  let response: Response;
  try {
    response = await fetch(`${BINANCE_API_BASE}${requestPath}`, {
      method: 'GET',
      headers,
      // Never cached. The API has no cache validators and a stale reference
      // price is worse than a missing one.
      cache: 'no-store',
      signal: AbortSignal.timeout(BINANCE_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      reason: 'unreachable',
      status: 0,
      message: timedOut
        ? `The Binance Web3 API did not answer within ${BINANCE_TIMEOUT_MS}ms.`
        : `The Binance Web3 API could not be reached: ${
            error instanceof Error ? error.message : String(error)
          }`,
    };
  }

  let envelope: Envelope<T>;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    return {
      ok: false,
      reason: 'malformed',
      status: response.status,
      message: `The Binance Web3 API answered with a non-JSON body (HTTP ${response.status}).`,
    };
  }

  const apiCode = envelope.code === undefined ? undefined : String(envelope.code);
  const apiMessage = envelope.msg ?? envelope.message;

  if (!response.ok || envelope.success === false) {
    return {
      ok: false,
      reason: 'rejected',
      status: response.status,
      code: apiCode,
      // The API's own message, verbatim. Paraphrasing an error code is how the
      // one detail that identifies it gets lost.
      message: apiMessage ?? `The Binance Web3 API rejected the request (HTTP ${response.status}).`,
    };
  }

  return { ok: true, data: (envelope.data ?? (envelope as unknown)) as T };
}
