import { describe, expect, it } from 'vitest';
import { signedPath } from './client.ts';
import { preHash, sign } from './sign.ts';

/**
 * The signing path, pinned.
 *
 * Every failure this API has is a signing failure, and every one of them comes
 * back as the same opaque `40102`. So the value of these tests is not that they
 * check behaviour nobody doubts — it is that the details the error message
 * refuses to name are written down somewhere a future change has to argue with.
 * `signedPath` is exported for this and nothing else.
 */

describe('signedPath', () => {
  it('signs the /build prefix, which is the documented cause of 40102', () => {
    expect(signedPath('/api/v1/dex/market/rwa/price', { symbol: 'NVDA' })).toBe(
      '/build/api/v1/dex/market/rwa/price?symbol=NVDA',
    );
  });

  it('keeps query parameters in the order given, because the signature covers the transmitted string', () => {
    expect(signedPath('/x', { binanceChainId: 56, symbol: 'NVDA' })).toBe(
      '/build/x?binanceChainId=56&symbol=NVDA',
    );
    expect(signedPath('/x', { symbol: 'NVDA', binanceChainId: 56 })).toBe(
      '/build/x?symbol=NVDA&binanceChainId=56',
    );
  });

  it('omits empty values rather than signing a parameter it will not send', () => {
    expect(signedPath('/x', { symbol: 'NVDA', keyword: '' })).toBe('/build/x?symbol=NVDA');
  });

  it('signs a bare path when there is no query string', () => {
    expect(signedPath('/api/v1/dex/market/rwa/tokens')).toBe('/build/api/v1/dex/market/rwa/tokens');
  });
});

describe('preHash', () => {
  it('concatenates with no separators and uppercases the method', () => {
    expect(preHash('2026-10-10T18:07:28.000Z', 'get', '/build/x?symbol=NVDA')).toBe(
      '2026-10-10T18:07:28.000ZGET/build/x?symbol=NVDA',
    );
  });

  it('signs an empty body for a GET rather than an empty JSON object', () => {
    expect(preHash('t', 'GET', '/p')).toBe('tGET/p');
  });
});

describe('sign', () => {
  it('returns a base64 HMAC-SHA256, decided by the secret', () => {
    const digest = sign('secret', 'payload');

    // Asserted structurally rather than against a hard-coded digest: a constant
    // copied into a test is a fact nobody can check, and HMAC output is not worth
    // inventing one for.
    expect(digest).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(digest, 'base64')).toHaveLength(32);

    expect(sign('secret', 'payload')).toBe(digest);
    expect(sign('another-secret', 'payload')).not.toBe(digest);
  });
});
