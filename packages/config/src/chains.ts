import { bsc, bscTestnet, hardhat } from 'viem/chains';
import type { Chain } from 'viem';

/**
 * The chains this app can talk to.
 *
 * Local development comes first on purpose: `yarn dev` with no `.env` at all
 * must land on a working app, and that only happens if the default chain is the
 * one a developer's own Hardhat node is running.
 *
 * All three definitions come from viem rather than being hand-written. A
 * hand-written chain entry gets the native currency decimals or the explorer
 * URL subtly wrong, and those are exactly the values that make a balance render
 * ten thousand times too large.
 */
export const SUPPORTED_CHAINS = [hardhat, bscTestnet, bsc] as const satisfies readonly Chain[];

export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number]['id'];

/** Chain ids, named, so no call site has to spell out 31337 or 97. */
export const CHAIN_IDS = {
  local: hardhat.id,
  bscTestnet: bscTestnet.id,
  bsc: bsc.id,
} as const;

/** The chain a fresh clone points at. See the note above. */
export const DEFAULT_CHAIN_ID: SupportedChainId = CHAIN_IDS.local;

/**
 * Chains where the contracts are mock deployments.
 *
 * This is not a cosmetic flag. On these chains the component tokens, the price
 * feed and the DEX are all invented, and every surface showing a figure sourced
 * from them has to say so. §10 and §39 both require the disclosure; this is the
 * single value that decides whether it is rendered.
 */
export function isMockEnvironment(chainId: number): boolean {
  return chainId === CHAIN_IDS.local || chainId === CHAIN_IDS.bscTestnet;
}

/**
 * Looks up a supported chain by id.
 *
 * Typed on the literal id so callers get the specific chain type rather than a
 * widened `Chain`: viem's clients and wagmi's hooks carry the chain id in their
 * types, and widening it here loses that all the way down.
 */
export function getChain<const T extends SupportedChainId>(
  chainId: T,
): Extract<(typeof SUPPORTED_CHAINS)[number], { id: T }>;
export function getChain(chainId: number): Chain;
export function getChain(chainId: number): Chain {
  const chain = SUPPORTED_CHAINS.find((candidate) => candidate.id === chainId);
  if (!chain) {
    throw new Error(
      `Unsupported chain ${chainId}. This app supports: ${SUPPORTED_CHAINS.map((c) => `${c.name} (${c.id})`).join(', ')}.`,
    );
  }
  return chain;
}

/** True when `chainId` is one of the chains configured above. */
export function isSupportedChain(chainId: number): chainId is SupportedChainId {
  return SUPPORTED_CHAINS.some((candidate) => candidate.id === chainId);
}

/**
 * Explorer links.
 *
 * Both return `null` rather than throwing on an unsupported chain, and the
 * distinction matters at the call site: a wallet connected to a chain this app
 * does not support is a normal condition — the user picked it in their wallet —
 * so the page has to render without the link rather than fail to render at all.
 * The local Hardhat chain is the common case: it has no explorer, so there is
 * genuinely nowhere to link to.
 */
export function explorerAddressUrl(chainId: number, address: string): string | null {
  if (!isSupportedChain(chainId)) return null;
  const base = SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.blockExplorers?.default.url;
  return base ? `${base}/address/${address}` : null;
}

export function explorerTxUrl(chainId: number, hash: string): string | null {
  if (!isSupportedChain(chainId)) return null;
  const base = SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}
