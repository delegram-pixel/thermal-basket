import { describe, expect, it } from 'vitest';
import { BINANCE_CHAIN_ID } from './env.ts';
import { readMarketResult, readPriceResult, readProfileResult, readSearchResult } from './rwa.ts';

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

/**
 * `/price`, captured the same way and on the same afternoon.
 *
 * Two prices arrive in this one response. They are close enough that reading the
 * wrong one would have looked plausible on screen — 231.21 against 230.815 — which
 * is precisely why the choice is written down here rather than left to whichever
 * key a walker happened to reach first.
 */
const NVDA_PRICE_RESPONSE = [
  {
    binanceChainId: '56',
    tokenContractAddress: '0x9aee28c8bf960b889afdd190205218cba016f75f',
    platformId: 'ondo',
    tokenPrice: '231.210905150846385687',
    referencePrice: '230.815',
    tokenPriceUpdatedAt: 1791661578408,
  },
];

describe('readPriceResult', () => {
  it('reads the reference price, not the token price beside it', () => {
    expect(readPriceResult(NVDA_PRICE_RESPONSE)).toBe(230.815);
  });

  it('reads a price the API encoded as a string', () => {
    // Both figures in this payload are strings while the timestamp is a number,
    // in one object. `Number()` on the way in is not defensive here, it is the
    // only thing that makes the field readable at all.
    expect(typeof NVDA_PRICE_RESPONSE[0].referencePrice).toBe('string');
    expect(typeof readPriceResult(NVDA_PRICE_RESPONSE)).toBe('number');
  });

  it('returns null when the field is absent rather than zero', () => {
    // A missing price and a price of zero are different facts about the market,
    // and only one of them should ever reach a column.
    expect(readPriceResult([{ binanceChainId: '56', tokenPrice: '1' }])).toBeNull();
    expect(readPriceResult(null)).toBeNull();
    expect(readPriceResult({ data: [] })).toBeNull();
  });
});

/** `/underlying-profile` for the same token. The monthly report was truncated in
 *  the capture, so its URL is the daily one — the shape is what matters here. */
const NVDA_PROFILE_RESPONSE = {
  binanceChainId: '56',
  tokenContractAddress: '0x9aee28c8bf960b889afdd190205218cba016f75f',
  platformId: 'ondo',
  underlyingTicker: 'NVDA',
  underlyingFullName: 'NVIDIA (Ondo)',
  assetType: '1',
  tokenToShareRatio: '1.0017152487959898',
  protections: {
    dailyAttestationReport: {
      supported: true,
      description: null,
      url: 'https://onchainos.bnbstatic.com/images/web3-data/public/token/ondo/pdf/daily-2026-10-07.pdf',
    },
    monthlyAttestationReport: {
      supported: false,
      description: null,
      url: 'https://onchainos.bnbstatic.com/images/web3-data/public/token/ondo/pdf/monthly.pdf',
    },
  },
};

describe('readProfileResult', () => {
  it('reads the full name and the platform', () => {
    const profile = readProfileResult(NVDA_PROFILE_RESPONSE, 'NVDA', 'Nvidia Corp');

    expect(profile.name).toBe('NVIDIA (Ondo)');
    expect(profile.platform).toBe('ondo');
  });

  it('reads the token-to-share ratio as a number', () => {
    expect(readProfileResult(NVDA_PROFILE_RESPONSE, 'NVDA', null).tokenToShareRatio).toBe(
      1.0017152487959898,
    );
  });

  it('lists only the reports the issuer supports and links', () => {
    const profile = readProfileResult(NVDA_PROFILE_RESPONSE, 'NVDA', null);

    // The monthly report carries a URL and says it is not supported, so it is not
    // offered. Linking a document the issuer does not stand behind would put this
    // component's name on a claim it has no business making.
    expect(profile.attestations.map((report) => report.label)).toEqual([
      'Daily attestation report',
    ]);
  });

  it('drops a supported report that has no link', () => {
    const profile = readProfileResult(
      {
        ...NVDA_PROFILE_RESPONSE,
        protections: {
          dailyAttestationReport: { supported: true, description: null, url: null },
        },
      },
      'NVDA',
      null,
    );

    expect(profile.attestations).toEqual([]);
  });

  it('falls back to the name resolution found when the profile has none', () => {
    // `/search` calls it `Nvidia Corp`; this endpoint calls it `NVIDIA (Ondo)`.
    // Either is better than a blank beside a ticker, so the fallback is used
    // rather than the field being rendered empty.
    const profile = readProfileResult({ platformId: 'ondo' }, 'NVDA', 'Nvidia Corp');

    expect(profile.name).toBe('Nvidia Corp');
  });

  it('survives a payload that is not the shape it expects', () => {
    for (const payload of [null, undefined, {}, 'nope', [], { protections: 'nope' }]) {
      expect(() => readProfileResult(payload, 'NVDA', null)).not.toThrow();
    }
  });
});

/**
 * `/underlying-market` — the last body to arrive, and the only one that had to be
 * fetched more than once. The probe that first reached it drew
 * `42900 Rate limit exceeded`; the one that succeeded ran on 2026-10-10 at
 * 21:28:52 UTC and is the source of everything below.
 *
 * One caveat about this fixture, stated rather than buried: the diagnostics panel
 * truncates each body at 500 characters, and the cut fell in the middle of the
 * market-capitalisation key — `"marketCa`. `marketStatus` is captured verbatim.
 * The market cap is not: the key's spelling is unknowable from the evidence and
 * its value was never seen, so the number below is a placeholder chosen to be
 * unmistakable rather than plausible. Nothing here claims to know NVIDIA's market
 * capitalisation, and a reader who finds `123456789` in this file should read it
 * as the fixture admitting what it does not have.
 */
const NVDA_MARKET_RESPONSE = {
  binanceChainId: '56',
  tokenContractAddress: '0x9aee28c8bf960b889afdd190205218cba016f75f',
  platformId: 'ondo',
  assetType: '1',
  statusInfo: {
    openState: true,
    marketStatus: 'offhours',
    reasonCode: 'TRADING',
    reasonMessage: null,
    nextOpenTime: '1791762900000',
  },
  marketData: {
    referencePrice: '230.349893',
    high52w: '243.37',
    low52w: '164.27',
    volumeShares24H: '8464559.605683',
    avgDailyVolume1Y: '160783246',
    totalShares: '24147000000',
    marketCap: '123456789',
  },
};

describe('readMarketResult', () => {
  it('reads the session status the API reported, in its own word', () => {
    expect(readMarketResult(NVDA_MARKET_RESPONSE).marketStatus).toBe('offhours');
  });

  it('reads the market capitalisation out of marketData', () => {
    expect(readMarketResult(NVDA_MARKET_RESPONSE).marketCap).toBe(123456789);
  });

  it('does not mistake a neighbouring figure for the market cap', () => {
    // `totalShares` is 24147000000 and `avgDailyVolume1Y` is 160783246, both
    // larger than the market cap in this fixture and both sitting in the same
    // object. The reader this replaced walked the payload for any of four
    // plausible names and would have returned the first number it met; the
    // number that reaches a column has to be the one the field names.
    const { marketCap } = readMarketResult(NVDA_MARKET_RESPONSE);

    expect(marketCap).not.toBe(24147000000);
    expect(marketCap).not.toBe(160783246);
  });

  it('accepts the other spelling of the market-cap key', () => {
    // The truncation at `"marketCa` leaves `marketCap` and `marketCapUsd` equally
    // consistent with what was seen, so both are read. This is the only name in
    // the reader that is inferred, and it is bounded to a known object.
    const payload = { marketData: { marketCapUsd: '987654321', totalShares: '1' } };

    expect(readMarketResult(payload).marketCap).toBe(987654321);
  });

  it('returns no price, because two endpoints disagree about the price', () => {
    // `marketData.referencePrice` is `230.349893` here and `/price` returned
    // `230.705` for the same token minutes earlier — one field name, two
    // endpoints, two values, no explanation. Reading either one silently would
    // put a number in the price column that its own heading cannot justify, so
    // this reader returns neither. If this assertion fails, someone has added a
    // price back and owes the column an account of which source it is.
    expect(Object.keys(readMarketResult(NVDA_MARKET_RESPONSE)).sort()).toEqual([
      'marketCap',
      'marketStatus',
    ]);
  });

  it('returns null rather than zero when the payload is not the expected shape', () => {
    for (const payload of [null, undefined, {}, 'nope', [], { marketData: 'nope' }]) {
      expect(() => readMarketResult(payload)).not.toThrow();
      expect(readMarketResult(payload)).toEqual({ marketCap: null, marketStatus: null });
    }
  });
});
