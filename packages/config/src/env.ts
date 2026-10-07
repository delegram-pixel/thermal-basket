import { z } from 'zod';
import type { Address } from '@thematic/types';
import {
  CHAIN_IDS,
  DEFAULT_CHAIN_ID,
  SUPPORTED_CHAINS,
  isMockEnvironment,
  isSupportedChain,
  type SupportedChainId,
} from './chains.ts';

/**
 * Public runtime configuration.
 *
 * Everything here is `NEXT_PUBLIC_*`, which means it is inlined into the
 * browser bundle at build time. That is the correct place for contract
 * addresses — they are public by definition — and the wrong place for anything
 * else. No key, no secret and no RPC credential that costs money belongs in
 * this file; see `.env.example` for what the private side looks like.
 *
 * The variables are referenced as literal member expressions rather than read
 * through dynamic lookup, because Next's build-time substitution only rewrites
 * the literal form. `process.env[name]` would silently produce `undefined` in
 * the browser, which is the kind of failure that ships.
 */

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte hex address');

const optionalAddress = address.optional();

const schema = z.object({
  /**
   * Validated against the supported list rather than merely being a positive
   * integer.
   *
   * The same argument as the addresses below applies: a chain id this build
   * cannot serve produces a wallet pointed at nothing, and the failure surfaces
   * as an unexplained empty page rather than as an error. It is also what lets
   * `getChain(publicEnv.chainId)` resolve to the specific chain type instead of
   * a widened `Chain`, which matters because wagmi's `switchChain` is typed on
   * the literal id.
   */
  chainId: z.coerce
    .number()
    .int()
    .refine(isSupportedChain, {
      message: `must be one of ${SUPPORTED_CHAINS.map((chain) => `${chain.id} (${chain.name})`).join(', ')}`,
    })
    .default(DEFAULT_CHAIN_ID),
  rpcUrl: z.string().url().optional(),
  factoryAddress: optionalAddress,
  settlementToken: optionalAddress,
  priceProvider: optionalAddress,
  dexAdapter: optionalAddress,
  /** Enables the WalletConnect connector. Absent is a supported configuration. */
  walletConnectProjectId: z.string().min(1).optional(),
  /**
   * The escape hatch for {@link assertDeployableChain}.
   *
   * Parsed strictly rather than coerced, because `z.coerce.boolean()` reads the
   * string `"false"` as `true` — every non-empty string is truthy. A variable
   * that turns a guard off when it is set to `false` is worse than no guard.
   */
  allowLocalChainInProduction: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

/**
 * The parsed environment.
 *
 * `chainId` is restated as {@link SupportedChainId} rather than left as the
 * `number` zod infers: the refine above is what makes it true at runtime, and
 * the width of the declared type is what keeps that fact visible to every caller
 * afterwards.
 */
export type PublicEnv = Omit<z.infer<typeof schema>, 'chainId'> & {
  chainId: SupportedChainId;
};

/**
 * Addresses on a freshly started Hardhat node.
 *
 * Hardhat derives the same addresses from the same default mnemonic every time,
 * so a developer who runs `yarn node && yarn deploy:local && yarn seed:local`
 * gets exactly these. They are a development convenience and nothing else: any
 * other chain needs its own values in `.env`. `isLocalDefaults` records whether
 * the book came from here or from the environment, so the UI can say which.
 */
const LOCALHOST_DEFAULTS = {
  factory: '0x9A676e781A523b5d0C0e43731313A708CB607508',
  settlementToken: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  priceProvider: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
  dexAdapter: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82',
  components: {
    mNVDA: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    mMSFT: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    mGOOGL: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    mAMZN: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    mMETA: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    mTSLA: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    mCOIN: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    mMSTR: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
  } satisfies Record<string, Address>,
} as const;

function readEnv(): PublicEnv {
  const result = schema.safeParse({
    chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
    factoryAddress: process.env.NEXT_PUBLIC_FACTORY_ADDRESS,
    settlementToken: process.env.NEXT_PUBLIC_SETTLEMENT_TOKEN,
    priceProvider: process.env.NEXT_PUBLIC_PRICE_PROVIDER,
    dexAdapter: process.env.NEXT_PUBLIC_DEX_ADAPTER,
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    allowLocalChainInProduction: process.env.NEXT_PUBLIC_ALLOW_LOCAL_CHAIN_IN_PRODUCTION,
  });

  if (!result.success) {
    // A bad address here produces a wallet that talks to nothing and a UI that
    // looks fine. Fail loudly and name the variable instead.
    const issues = result.error.issues
      .map((issue) => `  NEXT_PUBLIC_${String(issue.path[0] ?? '?')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid public environment configuration:\n${issues}`);
  }

  // Whether the chain was chosen or merely defaulted into. Same resolved value
  // either way, but a very different message for whoever has to fix it.
  assertDeployableChain(result.data, process.env.NEXT_PUBLIC_CHAIN_ID !== undefined);

  return result.data;
}

/**
 * The chains a deployed bundle is allowed to be pointed at.
 *
 * Derived from `SUPPORTED_CHAINS` rather than restated, so that adding a chain
 * cannot leave this list behind.
 */
const DEPLOYABLE_CHAINS = SUPPORTED_CHAINS.filter((chain) => chain.id !== CHAIN_IDS.local);

/**
 * Refuses to build a production bundle pointed at the local Hardhat chain.
 *
 * `DEFAULT_CHAIN_ID` is the local chain, which is the right default for
 * `yarn dev`: a fresh clone with no `.env` has to land on a working app, and the
 * only node it can rely on is the developer's own. It is the wrong default for
 * `next build`, and it fails in the worst way available.
 *
 * The failure is silent at build time and remote at run time. An unset
 * `NEXT_PUBLIC_RPC_URL` on chain 31337 falls through to viem's own default for
 * Hardhat, `http://127.0.0.1:8545` — correct for the build machine and wrong for
 * everyone else, because `127.0.0.1` in a deployed bundle is the *visitor's*
 * computer. Nothing is listening there, so every read fails with a bare "Failed
 * to fetch" and the page renders an error where its content should be. The build
 * itself looks entirely healthy, which is the actual defect.
 *
 * So a production build has to name its chain. 31337 is still permitted, but
 * only alongside an explicit override: `yarn build && yarn start` against your
 * own node is a real workflow, and on that machine `127.0.0.1` genuinely is
 * reachable from a browser. The distinction being enforced is between a chain
 * someone chose and one they fell into.
 */
function assertDeployableChain(env: PublicEnv, chainIdWasSet: boolean): void {
  // `next dev` sets NODE_ENV to `development`; every other Next command sets
  // `production`. That is the documented split, and it is what separates a
  // developer's machine from a build that is going to be deployed.
  if (process.env.NODE_ENV !== 'production') return;
  if (env.chainId !== CHAIN_IDS.local) return;
  if (env.allowLocalChainInProduction) return;

  const deployable = DEPLOYABLE_CHAINS.map((chain) => `${chain.id} (${chain.name})`).join(', ');

  throw new Error(
    [
      'A production build is pointed at the local Hardhat chain (31337).',
      '',
      chainIdWasSet
        ? '  NEXT_PUBLIC_CHAIN_ID is set to 31337.'
        : '  NEXT_PUBLIC_CHAIN_ID is not set, so the build fell back to the development default.',
      '',
      'Hardhat runs on the machine that started it. Deployed, every read is issued',
      "against http://127.0.0.1:8545 on the visitor's own computer, where nothing is",
      'listening, and each page that touches a contract fails with "Failed to fetch".',
      '',
      `Set NEXT_PUBLIC_CHAIN_ID to one of ${deployable}, together with`,
      'NEXT_PUBLIC_FACTORY_ADDRESS and the other addresses from the deployment',
      'record in packages/contracts/deployments/.',
      '',
      'If this build is for a node on the machine serving it, where 127.0.0.1 is',
      'reachable from the browser, set NEXT_PUBLIC_ALLOW_LOCAL_CHAIN_IN_PRODUCTION=true.',
    ].join('\n'),
  );
}

export const publicEnv: PublicEnv = readEnv();

/** True when the address book below came from the baked-in local defaults. */
export const isLocalDefaults =
  publicEnv.chainId === CHAIN_IDS.local && publicEnv.factoryAddress === undefined;

export interface AddressBook {
  chainId: number;
  factory: Address;
  settlementToken: Address;
  priceProvider: Address;
  dexAdapter: Address;
  components: Record<string, Address>;
  /** True when these are the Hardhat defaults rather than configured values. */
  fromLocalDefaults: boolean;
}

/**
 * The contract addresses for the configured chain.
 *
 * Returns `null` rather than throwing when the chain is not the local one and
 * no addresses are configured, because "you have not deployed to this network
 * yet" is a state the UI renders as an explanation, not a crash.
 */
export function getAddressBook(): AddressBook | null {
  const { chainId } = publicEnv;

  if (isLocalDefaults) {
    return {
      chainId,
      factory: LOCALHOST_DEFAULTS.factory,
      settlementToken: LOCALHOST_DEFAULTS.settlementToken,
      priceProvider: LOCALHOST_DEFAULTS.priceProvider,
      dexAdapter: LOCALHOST_DEFAULTS.dexAdapter,
      components: { ...LOCALHOST_DEFAULTS.components },
      fromLocalDefaults: true,
    };
  }

  const { factoryAddress, settlementToken, priceProvider, dexAdapter } = publicEnv;
  if (!factoryAddress || !settlementToken || !priceProvider || !dexAdapter) {
    return null;
  }

  return {
    chainId,
    factory: factoryAddress as Address,
    settlementToken: settlementToken as Address,
    priceProvider: priceProvider as Address,
    dexAdapter: dexAdapter as Address,
    // Non-local chains have no bundled component list by design: components are
    // read from the baskets themselves. See `DeploymentAddresses.components`.
    components: {},
    fromLocalDefaults: false,
  };
}

export { isMockEnvironment };
