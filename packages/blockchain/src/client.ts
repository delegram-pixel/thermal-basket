import { createPublicClient, http, type PublicClient } from 'viem';
import { createConfig, createStorage } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import {
  DEFAULT_CHAIN_ID,
  SUPPORTED_CHAINS,
  getChain,
  publicEnv,
  type SupportedChainId,
} from '@thematic/config';

/**
 * Wallet and RPC client construction.
 *
 * Two clients exist here and they are not interchangeable:
 *
 * - `wagmiConfig` is the browser config, owned by the React tree.
 * - `getPublicClient(chainId)` is a plain viem client, for server components,
 *   route handlers and tests. No React, no wallet, no storage.
 *
 * **Multicall is switched off explicitly.** Multicall3 is deployed at a fixed
 * address on mainnet and most public testnets, and viem routes `multicall` and
 * `useReadContracts` through it. Hardhat's development node does not deploy it,
 * so any batched read works everywhere except the machine this is developed on.
 * The `batch.multicall: false` below turns the default off at the source rather
 * than relying on everyone remembering not to reach for it. `reads.ts` fans out
 * with a bounded `mapLimit` instead, which is correct on every chain.
 */

/**
 * Storage that does nothing, for the server.
 *
 * wagmi reads connector state from storage during render. On the server there is
 * no `localStorage`, and reaching for it throws. Substituting an in-memory store
 * keeps the server render working; the browser hydrates over it with the real
 * one, which is what `ssr: true` is for.
 */
const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const connectors = [
  injected({ shimDisconnect: true }),
  // WalletConnect is optional. Without a project id the connector throws while
  // the module is evaluated, which would take the whole app down over an
  // integration the local development flow does not use.
  ...(publicEnv.walletConnectProjectId
    ? [walletConnect({ projectId: publicEnv.walletConnectProjectId, showQrModal: true })]
    : []),
];

/** A transport per chain. The configured RPC URL is used for the default chain only. */
const transports = Object.fromEntries(
  SUPPORTED_CHAINS.map((chain) => [
    chain.id,
    http(chain.id === DEFAULT_CHAIN_ID && publicEnv.rpcUrl ? publicEnv.rpcUrl : undefined),
  ]),
) as Record<SupportedChainId, ReturnType<typeof http>>;

export const wagmiConfig = createConfig({
  chains: SUPPORTED_CHAINS,
  connectors,
  transports,
  ssr: true,
  storage: createStorage({
    storage: typeof window === 'undefined' ? noopStorage : window.localStorage,
  }),
  batch: { multicall: false },
});

/** The browser config's chain type, for components that need it. */
export type WagmiConfig = typeof wagmiConfig;

/**
 * A read-only client for one chain, with no wallet attached.
 *
 * Server components use this, which is why it takes a chain id rather than
 * reading one from a hook: the server has no connected account and no way to ask
 * for one.
 */
export function getPublicClient(chainId: SupportedChainId = DEFAULT_CHAIN_ID): PublicClient {
  const chain = getChain(chainId);
  return createPublicClient({
    chain,
    transport: http(
      chainId === DEFAULT_CHAIN_ID && publicEnv.rpcUrl ? publicEnv.rpcUrl : undefined,
    ),
    batch: { multicall: false },
  });
}

declare module 'wagmi' {
  interface Register {
    config: WagmiConfig;
  }
}
