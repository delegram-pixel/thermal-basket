import { describe, expect, it } from 'vitest';
import {
  CHAIN_IDS,
  DEFAULT_CHAIN_ID,
  SUPPORTED_CHAINS,
  explorerAddressUrl,
  explorerTxUrl,
  getChain,
  isMockEnvironment,
  isSupportedChain,
} from './chains.ts';

/**
 * The chain book.
 *
 * Two things here are load-bearing well beyond this file.
 *
 * `isMockEnvironment` is the single switch that decides whether the app tells a
 * visitor that the prices on screen are invented. §10 and §39 make that
 * disclosure mandatory, so a regression here is not a rendering bug — it is the
 * app quietly presenting mock data as market data.
 *
 * `explorerTxUrl` returning `null` is what keeps the transaction view honest
 * (§21): on the local chain there is genuinely nowhere to link to, and a link
 * that goes nowhere is worse than no link.
 */

describe('CHAIN_IDS', () => {
  it('names the three chains rather than leaving magic numbers at call sites', () => {
    expect(CHAIN_IDS.local).toBe(31_337);
    expect(CHAIN_IDS.bscTestnet).toBe(97);
    expect(CHAIN_IDS.bsc).toBe(56);
  });

  it('draws its numbers from viem rather than restating them', () => {
    // The whole point of importing the chain definitions: if viem ever changed
    // an id, this file would be wrong in the same instant, not later.
    for (const chain of SUPPORTED_CHAINS) {
      expect(Object.values(CHAIN_IDS)).toContain(chain.id);
    }
  });
});

describe('DEFAULT_CHAIN_ID', () => {
  it('is the local chain, so a fresh clone with no .env lands on a working app', () => {
    expect(DEFAULT_CHAIN_ID).toBe(CHAIN_IDS.local);
  });
});

describe('isMockEnvironment', () => {
  it('is true where every price and every token is invented', () => {
    // Local: the price feed is a mock contract. Testnet: the "mNVDA" and its
    // quote are ours too. Both require the disclosure banner.
    expect(isMockEnvironment(CHAIN_IDS.local)).toBe(true);
    expect(isMockEnvironment(CHAIN_IDS.bscTestnet)).toBe(true);
  });

  it('is false on mainnet, where the prices are real', () => {
    expect(isMockEnvironment(CHAIN_IDS.bsc)).toBe(false);
  });

  it('is false for a chain the app does not support, rather than assuming the worst', () => {
    // An unsupported chain renders the wrong-network guard, not a mock-data
    // notice. Claiming "these prices are fake" about a chain we know nothing
    // about would be its own inaccuracy.
    expect(isMockEnvironment(1)).toBe(false);
    expect(isMockEnvironment(0)).toBe(false);
    expect(isMockEnvironment(Number.NaN)).toBe(false);
  });

  it('covers every supported chain with a definite answer', () => {
    for (const chain of SUPPORTED_CHAINS) {
      expect(typeof isMockEnvironment(chain.id), chain.name).toBe('boolean');
    }
  });
});

describe('isSupportedChain', () => {
  it('accepts exactly the configured chains', () => {
    expect(isSupportedChain(CHAIN_IDS.local)).toBe(true);
    expect(isSupportedChain(CHAIN_IDS.bscTestnet)).toBe(true);
    expect(isSupportedChain(CHAIN_IDS.bsc)).toBe(true);
  });

  it('rejects mainnet Ethereum and anything else a wallet might be pointed at', () => {
    expect(isSupportedChain(1)).toBe(false);
    expect(isSupportedChain(137)).toBe(false);
    expect(isSupportedChain(-1)).toBe(false);
  });
});

describe('getChain', () => {
  it('returns the chain, with its viem metadata intact', () => {
    expect(getChain(CHAIN_IDS.bscTestnet).name).toBe('BNB Smart Chain Testnet');
    expect(getChain(CHAIN_IDS.bsc).id).toBe(56);
    expect(getChain(CHAIN_IDS.local).id).toBe(31_337);
  });

  it('throws with the supported list in the message, because the caller cannot guess', () => {
    expect(() => getChain(1)).toThrow(/Unsupported chain 1/);
    expect(() => getChain(1)).toThrow(/31337/);
  });
});

describe('explorerTxUrl', () => {
  const hash = '0xabc123';

  it('links a testnet transaction to BscScan testnet', () => {
    expect(explorerTxUrl(CHAIN_IDS.bscTestnet, hash)).toBe(
      `https://testnet.bscscan.com/tx/${hash}`,
    );
  });

  it('links a mainnet transaction to the mainnet explorer', () => {
    expect(explorerTxUrl(CHAIN_IDS.bsc, hash)).toBe(`https://bscscan.com/tx/${hash}`);
  });

  it('returns null on the local chain, which has no explorer at all', () => {
    // viem's `hardhat` definition carries no `blockExplorers`, which is the
    // fact that lets the UI render plain text instead of a dead link.
    expect(getChain(CHAIN_IDS.local).blockExplorers).toBeUndefined();
    expect(explorerTxUrl(CHAIN_IDS.local, hash)).toBeNull();
  });

  it('returns null rather than throwing for a chain the app does not support', () => {
    // A user can switch their wallet to any chain mid-session. That is a normal
    // condition, so it must not take the page down.
    expect(explorerTxUrl(1, hash)).toBeNull();
  });
});

describe('explorerAddressUrl', () => {
  const address = '0x1111111111111111111111111111111111111111';

  it('links an address on the chains that have an explorer', () => {
    expect(explorerAddressUrl(CHAIN_IDS.bscTestnet, address)).toBe(
      `https://testnet.bscscan.com/address/${address}`,
    );
    expect(explorerAddressUrl(CHAIN_IDS.bsc, address)).toBe(
      `https://bscscan.com/address/${address}`,
    );
  });

  it('returns null on the local chain, matching the transaction case', () => {
    expect(explorerAddressUrl(CHAIN_IDS.local, address)).toBeNull();
  });

  it('returns null for an unsupported chain', () => {
    expect(explorerAddressUrl(1, address)).toBeNull();
  });
});
