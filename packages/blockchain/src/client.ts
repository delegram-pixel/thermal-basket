import { createPublicClient, http, type PublicClient } from 'viem';
import { createConfig, createStorage } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import {
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

type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

/**
 * The chain this build was configured for, first.
 *
 * wagmi starts on the **first** entry of `chains` — `createConfig` sets
 * `chainId: chains.getState()[0].id` — so the order of this array *is* the
 * runtime default. `SUPPORTED_CHAINS` is ordered for the reader (local, testnet,
 * mainnet) and its first entry is Hardhat, which means passing it through
 * unchanged starts every build on 31337.
 *
 * That is harmless on a developer's machine and wrong everywhere else. On a
 * chain-97 build `useChainId()` answers 31337 until a wallet connects, and
 * everything derived from it follows: `usePublicClient()` hands back the local
 * client, `getAddressBook()` returns the chain-97 book while the client reads
 * chain 31337, and `explorerAddressUrl()` returns `null` because Hardhat has no
 * explorer. The reads only appeared to work because the RPC gate below was
 * misdirecting the testnet endpoint into the 31337 transport.
 *
 * Reordering here rather than in `chains.ts` keeps `SUPPORTED_CHAINS` as the one
 * readable list of what is supported, while making the chain wagmi actually
 * starts on the one the build was pointed at.
 */
const CHAINS_BY_PRIORITY: readonly [SupportedChain, ...SupportedChain[]] = [
  getChain(publicEnv.chainId),
  ...SUPPORTED_CHAINS.filter((chain) => chain.id !== publicEnv.chainId),
];

/**
 * The RPC URL for a chain, when this build has one.
 *
 * `NEXT_PUBLIC_RPC_URL` is a single endpoint and an endpoint serves exactly one
 * chain — the one this build is configured for. Every other supported chain
 * falls through to `undefined`, which viem reads as "use your bundled default
 * for this chain".
 *
 * The comparison is against `publicEnv.chainId`. It used to be against
 * `DEFAULT_CHAIN_ID`, which is the *development* default of 31337, so the
 * configured URL was handed to the local chain and the configured chain was left
 * on its bundled default — the exact inverse of what the variable is for. It
 * went unnoticed because `NEXT_PUBLIC_RPC_URL` happened to be byte-identical to
 * viem's bundled BSC testnet endpoint; point it at a paid or private node and the
 * setting would have been ignored on the only chain that used it.
 */
function rpcUrlFor(chainId: number): string | undefined {
  return chainId === publicEnv.chainId ? publicEnv.rpcUrl : undefined;
}

/** A transport per chain. See {@link rpcUrlFor}. */
const transports = Object.fromEntries(
  SUPPORTED_CHAINS.map((chain) => [chain.id, http(rpcUrlFor(chain.id))]),
) as Record<SupportedChainId, ReturnType<typeof http>>;

export const wagmiConfig = createConfig({
  chains: CHAINS_BY_PRIORITY,
  connectors,
  transports,
  ssr: true,
  /**
   * Deliberately **not** the default `wagmi` namespace.
   *
   * wagmi persists `chainId` to `localStorage` and restores it on mount if it is
   * one of the configured chains — and 31337 is configured even on a chain-97
   * build. Anyone who loaded the earlier, misconfigured site therefore has
   * `chainId: 31337` in storage, and after this fix they would still hydrate onto
   * 31337 and keep seeing the local client, no explorer links and no reads, while
   * a first-time visitor saw the working site.
   *
   * A distinct namespace guarantees the first state is the one computed above.
   * The cost is that already-connected wallets reconnect once, which for an
   * injected wallet is silent.
   */
  storage: createStorage({
    key: 'thematic',
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
 *
 * The default is the configured chain, not `DEFAULT_CHAIN_ID`. A caller that
 * omits the argument wants the deployment this build is for; defaulting to
 * Hardhat would silently read a local node that a deployed server does not have.
 */
export function getPublicClient(chainId: SupportedChainId = publicEnv.chainId): PublicClient {
  const chain = getChain(chainId);
  return createPublicClient({
    chain,
    transport: http(rpcUrlFor(chainId)),
    batch: { multicall: false },
  });
}

declare module 'wagmi' {
  interface Register {
    config: WagmiConfig;
  }
}
