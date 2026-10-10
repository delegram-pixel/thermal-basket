import { createHmac } from 'node:crypto';

/**
 * Signing a Binance Web3 API request.
 *
 * Kept apart from the request itself so it can be exercised without a network.
 * Every failure mode this API has is a signing failure — a wrong prefix, a
 * reordered field, a re-serialised body — and each of them produces the same
 * opaque `40102`, so the one function worth being able to test in isolation is
 * this one.
 */

/**
 * The string that gets signed.
 *
 * Order and separators are load-bearing and there are no separators to get wrong
 * in a way you can see: the four fields are concatenated with nothing between
 * them, so a missing `requestPath` does not shift a boundary, it silently signs
 * a different string. `body` is `''` for every GET rather than `'{}'` — the API
 * signs what is sent, and signing an empty object that was never transmitted
 * produces a signature that is wrong in a way the message does not describe.
 *
 * `requestPath` must include the `/build` prefix *and* the query string exactly
 * as transmitted, in the order transmitted. Re-sorting query parameters for
 * tidiness is enough to invalidate it.
 */
export function preHash(timestamp: string, method: string, requestPath: string, body = ''): string {
  return `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
}

/** Base64-encoded HMAC-SHA256 of {@link preHash}, keyed on the API secret. */
export function sign(apiSecret: string, signed: string): string {
  return createHmac('sha256', apiSecret).update(signed, 'utf8').digest('base64');
}
