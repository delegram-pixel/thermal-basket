import { describe, expect, it } from 'vitest';
import { BINANCE_CHAIN_ID } from './env.ts';
import { readSearchResult } from './rwa.ts';

/**
 * The `/search` reader, pinned against the payload the API actually sent.
 *
 * This fixture is copied from a live response captured on 2026-10-10 by the
 * `/diagnostics` panel, not written from the documentation — the documentation
 * does not describe this body, which is how the reader came to be looking for a
 * field name that was never in it.
 *
 * The bug that hid here is the reason these tests exist. The reader looked for
 * `tokenAddress`; the API sends `tokenContractAddress`. Since the reader returns
 * `null` rather than throwing, address resolution had been returning nothing on
 * every call, and the only visible symptom was two endpoints reporting that a
 * parameter was required — which read as the API's problem rather than ours.
 */

/** Verbatim from the deployment, with the two asset addresses truncated nowhere:
 *  a fixture is only worth keeping if it is the whole of what was received. */
const NVDA_RESPONSE = [
  {
    ticker: 'NVDA',
    companyName: 'Nvidia Corp',
    assets: [
      {
        platformId: 'ondo',
        binanceChainId: '56',
        tokenContractAddress: '0x9aee28c8bf960b889afdd190205218cba016f75f',
        tokenSymbol: 'NVDAon',
        assetType: '1',
      },
      {
        platformId: 'ondo',
        binanceChainId: '1',
        tokenContractAddress: '0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee',
        tokenSymbol: 'NVDAon',
        assetType: '1',
      },
    ],
  },
];

describe('readSearchResult', () => {
  it('reads the contract address under the name the API uses', () => {
    expect(readSearchResult(NVDA_RESPONSE, 'NVDA').tokenAddress).toBe(
      '0x9aee28c8bf960b889afdd190205218cba016f75f',
    );
  });

  it('reads the company name, not the ticker, when the API supplies one', () => {
    expect(readSearchResult(NVDA_RESPONSE, 'NVDA').name).toBe('Nvidia Corp');
  });

  it('carries no price, because /search does not return one', () => {
    // Not a lookup that failed. The endpoint was asked and it has no price field,
    // and the distinction matters to the row that renders this.
    expect(readSearchResult(NVDA_RESPONSE, 'NVDA').price).toBeNull();
  });

  it('selects the asset on the chain asked about, not the first asset offered', () => {
    // The expectations below name the address the API gave for chain 56. A
    // deployment reconfigured onto another chain should fail this loudly rather
    // than assert, in silence, against an asset it is not going to trade.
    expect(BINANCE_CHAIN_ID).toBe(56);

    // The real response lists chain 56 first, so an index-based reader would pass
    // this by accident. Reversing the order is the whole test: the chain decides,
    // and the address returned must not change when the API reorders its assets.
    const reversed = [{ ...NVDA_RESPONSE[0], assets: [...NVDA_RESPONSE[0].assets].reverse() }];

    expect(readSearchResult(reversed, 'NVDA').tokenAddress).toBe(
      '0x9aee28c8bf960b889afdd190205218cba016f75f',
    );
  });

  it('resolves nothing when the ticker is listed on another chain only', () => {
    const ethereumOnly = [{ ...NVDA_RESPONSE[0], assets: [NVDA_RESPONSE[0].assets[1]] }];

    // `null`, and the caller is expected to say so in words. An address from the
    // wrong chain is worse than no address: it would price a real ticker against
    // a token this deployment cannot hold.
    expect(readSearchResult(ethereumOnly, 'NVDA').tokenAddress).toBeNull();
  });

  it('prefers the listing whose ticker was asked for', () => {
    const several = [
      { ticker: 'NVDAX', companyName: 'Something Else', assets: [] },
      ...NVDA_RESPONSE,
    ];

    expect(readSearchResult(several, 'NVDA').name).toBe('Nvidia Corp');
  });

  it('falls back to the API first result when no ticker matches exactly', () => {
    // The endpoint is a search, so its first result is its answer for a ticker it
    // does not list. Inventing a failure here would report the API as broken when
    // it had replied.
    expect(readSearchResult(NVDA_RESPONSE, 'NVD').name).toBe('Nvidia Corp');
  });

  it('survives a payload that is not the shape it expects', () => {
    for (const payload of [null, undefined, {}, 'nope', [], [{ ticker: 'NVDA' }]]) {
      expect(() => readSearchResult(payload, 'NVDA')).not.toThrow();
    }
  });
});
