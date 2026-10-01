import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HardhatRuntimeEnvironment } from 'hardhat/types';

/**
 * Shared deployment bookkeeping.
 *
 * Every deploy and seed script reads and writes the same per-network metadata
 * file, so a later script (seeding, basket creation, verification) can run
 * without the operator re-typing addresses, and so the frontend has a single
 * place to read the deployed addresses from. Nothing here holds a secret: it is
 * addresses and transaction hashes only.
 */

export interface Deployment {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  contracts: {
    settlementToken?: string;
    priceProvider: string;
    dexAdapter: string;
    router: string;
    factory: string;
    wrappedNative: string;
    /** Component token symbol -> address. Test networks only. */
    components: Record<string, string>;
  };
  /** Protocol addresses baked into the factory at construction. */
  roles: {
    protocolAdmin: string;
    protocolTreasury: string;
    priceProviderAdmin: string;
  };
  /**
   * Baskets the sample-basket script created, in creation order. The frontend
   * discovers baskets from the factory on-chain; this is for scripts and for a
   * human who wants the addresses without reading an explorer.
   */
  baskets?: Array<{
    name: string;
    symbol: string;
    theme: string;
    address: string;
    creator: string;
  }>;
  transactions: Record<string, string>;
}

const DEPLOYMENTS_DIR = resolve(__dirname, '../../deployments');

export function deploymentPath(network: string): string {
  return join(DEPLOYMENTS_DIR, `${network}.json`);
}

export function saveDeployment(deployment: Deployment): string {
  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const path = deploymentPath(deployment.network);
  writeFileSync(path, `${JSON.stringify(deployment, null, 2)}\n`, 'utf8');
  return path;
}

export function loadDeployment(network: string): Deployment {
  const path = deploymentPath(network);
  if (!existsSync(path)) {
    throw new Error(
      `No deployment found for network "${network}" at ${path}.\n` +
        `Run the deploy script for this network first.`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Deployment;
}

/** Explorer base URL, or null on a local chain where there is nothing to link to. */
export function explorerUrl(chainId: number): string | null {
  switch (chainId) {
    case 56:
      return 'https://bscscan.com';
    case 97:
      return 'https://testnet.bscscan.com';
    default:
      return null;
  }
}

export function addressLink(chainId: number, address: string): string {
  const base = explorerUrl(chainId);
  return base ? `${base}/address/${address}` : address;
}

export function txLink(chainId: number, hash: string): string {
  const base = explorerUrl(chainId);
  return base ? `${base}/tx/${hash}` : hash;
}

/**
 * Refuses to proceed on a network that would spend real money.
 *
 * Mainnet deployment is a deliberate, separate act with its own checklist; it is
 * not something a script should be able to do because a flag was mistyped. See
 * docs/DEPLOYMENT.md.
 */
export function assertNotMainnet(hre: HardhatRuntimeEnvironment): void {
  const chainId = hre.network.config.chainId;
  if (chainId === 56) {
    throw new Error(
      'This script deploys mock tokens and a mock price feed and refuses to run on BNB Smart Chain mainnet.\n' +
        'Mainnet requires real infrastructure addresses — see docs/DEPLOYMENT.md.',
    );
  }
}

/** True when the network has no real infrastructure and needs the mock stack. */
export function needsMockStack(chainId: number | undefined): boolean {
  return chainId === 31337 || chainId === 97 || chainId === 1337;
}

export function banner(title: string): void {
  const line = '='.repeat(64);
  console.log(`\n${line}\n${title}\n${line}`);
}

export function field(label: string, value: string): void {
  console.log(`  ${label.padEnd(22)} ${value}`);
}
