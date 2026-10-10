/**
 * Server-side configuration for the Binance Web3 API.
 *
 * This module reads the only secret pair in the application. It must never be
 * imported from a component: the secret signs every request, so a copy of it in
 * the browser bundle is a published credential rather than a configured one. The
 * `window` tripwire in {@link readCredentials} cannot stop a bundler from
 * inlining a value it can see, but it turns a silent leak into a loud failure the
 * first time a client component imports this file — which is the difference
 * between finding it here and reading about it later.
 *
 * Everything here is read per request on the server, which is why it lives in the
 * app rather than in `@thematic/config`. That package is built around
 * `NEXT_PUBLIC_*` values inlined at build time, and a secret cannot be inlined at
 * build time without being inlined into the client.
 */

export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

/**
 * The API host, without the `/build` prefix.
 *
 * The split matters and is the documented cause of `40102 Invalid signature`:
 * `/build` belongs to the *signed* path but not to this base. The signature must
 * cover `/build/api/v1/...` while the request goes to
 * `https://web3.binance.com/build/api/v1/...`. Appending the prefix here as well
 * would produce `/build/build/...`, and omitting it from the signature produces a
 * request the server can verify as nothing.
 */
export const BINANCE_API_BASE = process.env.BINANCE_WEB3_API_BASE ?? 'https://web3.binance.com';

/** BNB Smart Chain, where the tokenized equities are listed. */
export const BINANCE_CHAIN_ID = Number(process.env.BINANCE_WEB3_CHAIN_ID ?? 56);

/**
 * How long a request's timestamp stays valid.
 *
 * Sent explicitly rather than left to the documented 5-second default. During
 * development a signed request was rejected with `40103 Timestamp outside
 * recv_window` while the response echoed a timestamp identical to the server's
 * own clock — which is only consistent with the window being applied at zero
 * width. Sending the maximum the API documents costs nothing and removes the
 * default as a variable. See the DX report.
 */
export const BINANCE_RECV_WINDOW_MS = Number(process.env.BINANCE_WEB3_RECV_WINDOW_MS ?? 60_000);

/**
 * How long to wait before treating the API as unreachable.
 *
 * Deliberately short. The failure this guards against is not slowness but
 * silence: a request to this host from a filtered network hangs until curl's
 * 300-second default, and a Route Handler that waits three minutes has already
 * failed — it has just failed slowly enough to take the page down with it.
 */
export const BINANCE_TIMEOUT_MS = Number(process.env.BINANCE_WEB3_TIMEOUT_MS ?? 8_000);

/**
 * The credentials, or `null` when the deployment has none.
 *
 * Absent credentials are a supported configuration, not an error: every clone
 * without a `.env.local` runs against the mock price feed, and the surfaces that
 * would call the API say so rather than rendering an error. Returning `null`
 * rather than throwing is what lets the caller choose between "not configured"
 * and "configured but broken" — two states that want different words on screen.
 */
export function readCredentials(): BinanceCredentials | null {
  if (typeof window !== 'undefined') {
    throw new Error(
      'Binance Web3 API credentials were read in a browser context. These values ' +
        'sign every request; a copy in the client bundle is a published secret. ' +
        'Move the call behind a Route Handler.',
    );
  }

  const apiKey = process.env.BINANCE_WEB3_API_KEY;
  const apiSecret = process.env.BINANCE_WEB3_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  return { apiKey, apiSecret };
}
