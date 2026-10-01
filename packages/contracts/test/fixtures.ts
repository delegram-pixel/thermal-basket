import { ethers } from 'hardhat';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import type {
  BasketFactory,
  MockDexRouter,
  MockERC20,
  MockPriceProvider,
  MockShortchangingAdapter,
  PancakeSwapAdapter,
  ThematicBasket,
} from '../typechain-types';

/**
 * Shared test fixture.
 *
 * Stands up the same stack the deploy scripts do — settlement token, components,
 * price feed, constant-product DEX, adapter, factory — so tests exercise the real
 * adapter against real AMM arithmetic rather than a stub that always returns what
 * it was asked for.
 *
 * Prices and liquidity are set to round numbers so expected values can be
 * computed by hand in the assertions.
 */

export const BPS = 10_000n;
export const PRICE_SCALE = 10n ** 18n;

export interface ComponentSpec {
  symbol: string;
  name: string;
  decimals: number;
  /** Price in whole settlement units. */
  price: number;
  /** Settlement liquidity to seed, in whole units. */
  liquidity: number;
}

export const DEFAULT_COMPONENTS: ComponentSpec[] = [
  { symbol: 'mAAA', name: 'Mock Alpha', decimals: 18, price: 100, liquidity: 1_000_000 },
  { symbol: 'mBBB', name: 'Mock Beta', decimals: 18, price: 250, liquidity: 1_000_000 },
  { symbol: 'mCCC', name: 'Mock Gamma', decimals: 18, price: 40, liquidity: 500_000 },
];

/** Weights matching {DEFAULT_COMPONENTS}: 40% / 40% / 20%. */
export const DEFAULT_WEIGHTS = [4_000, 4_000, 2_000];

export interface FixtureOptions {
  components?: ComponentSpec[];
  weights?: number[];
  settlementDecimals?: number;
  /** Use a fee-on-transfer token as the settlement asset. */
  feeOnTransferSettlement?: boolean;
  /** Use a settlement token that can call back into the basket mid-transfer. */
  callbackSettlement?: boolean;
  /**
   * Point the factory at an adapter that under-delivers and returns success,
   * so the basket's own slippage gates are reachable.
   */
  shortchangingAdapter?: boolean;
  depositFeeBps?: number;
  redeemFeeBps?: number;
  creatorShareBps?: number;
  maxSlippageBps?: number;
  /** Skip DEX seeding, so swaps have no liquidity. */
  skipSeeding?: boolean;
}

export interface Fixture {
  signers: {
    deployer: HardhatEthersSigner;
    protocolAdmin: HardhatEthersSigner;
    treasury: HardhatEthersSigner;
    creator: HardhatEthersSigner;
    alice: HardhatEthersSigner;
    bob: HardhatEthersSigner;
    stranger: HardhatEthersSigner;
  };
  settlement: MockERC20;
  components: MockERC20[];
  specs: ComponentSpec[];
  weights: number[];
  priceProvider: MockPriceProvider;
  router: MockDexRouter;
  /**
   * The venue the factory points baskets at. Usually the PancakeSwap adapter;
   * a deliberate under-deliverer when the fixture asked for one.
   */
  adapter: PancakeSwapAdapter | MockShortchangingAdapter;
  factory: BasketFactory;
  /**
   * The fee parameters this fixture's factory hands to new baskets. Creating a
   * basket without explicit overrides uses these, so a fixture can set the
   * economics for every basket a test creates.
   */
  defaults: {
    depositFeeBps: number;
    redeemFeeBps: number;
    creatorShareBps: number;
    maxSlippageBps: number;
  };
  chainId: number;
}

export async function deployFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const specs = options.components ?? DEFAULT_COMPONENTS;
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const settlementDecimals = options.settlementDecimals ?? 18;

  const signerList = await ethers.getSigners();
  const [deployer, protocolAdmin, treasury, creator, alice, bob, stranger] = signerList;
  const signers = { deployer, protocolAdmin, treasury, creator, alice, bob, stranger };

  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  const settlement = (await (
    await ethers.getContractFactory(
      options.feeOnTransferSettlement
        ? 'MockFeeOnTransferERC20'
        : options.callbackSettlement
          ? 'MockCallbackERC20'
          : 'MockERC20',
    )
  ).deploy(
    'Mock Tether USD',
    'mUSDT',
    settlementDecimals,
    ...(options.feeOnTransferSettlement ? [100] : []),
  )) as unknown as MockERC20;
  await settlement.waitForDeployment();

  const erc20 = await ethers.getContractFactory('MockERC20');
  const components: MockERC20[] = [];
  for (const spec of specs) {
    const token = (await erc20.deploy(
      spec.name,
      spec.symbol,
      spec.decimals,
    )) as unknown as MockERC20;
    await token.waitForDeployment();
    components.push(token);
  }

  const priceProvider = (await (
    await ethers.getContractFactory('MockPriceProvider')
  ).deploy(deployer.address)) as unknown as MockPriceProvider;
  await priceProvider.waitForDeployment();

  await (
    await priceProvider.setPrices(
      components.map((c) => c.getAddress()),
      specs.map((s) => ethers.parseUnits(String(s.price), settlementDecimals)),
    )
  ).wait();

  const wrappedNative = await erc20.deploy('Mock Wrapped BNB', 'mWBNB', 18);
  await wrappedNative.waitForDeployment();

  const router = (await (
    await ethers.getContractFactory('MockDexRouter')
  ).deploy(await wrappedNative.getAddress())) as unknown as MockDexRouter;
  await router.waitForDeployment();

  const adapter = (options.shortchangingAdapter
    ? await (
        await ethers.getContractFactory('MockShortchangingAdapter')
      ).deploy(deployer.address, 5_000)
    : await (
        await ethers.getContractFactory('PancakeSwapAdapter')
      ).deploy(await router.getAddress())) as unknown as
    | PancakeSwapAdapter
    | MockShortchangingAdapter;
  await adapter.waitForDeployment();

  const defaults = {
    depositFeeBps: options.depositFeeBps ?? 50,
    redeemFeeBps: options.redeemFeeBps ?? 0,
    creatorShareBps: options.creatorShareBps ?? 8_000,
    maxSlippageBps: options.maxSlippageBps ?? 300,
  };

  const factory = (await (
    await ethers.getContractFactory('BasketFactory')
  ).deploy(
    await settlement.getAddress(),
    protocolAdmin.address,
    await priceProvider.getAddress(),
    await adapter.getAddress(),
    treasury.address,
    [
      defaults.depositFeeBps,
      defaults.redeemFeeBps,
      defaults.creatorShareBps,
      defaults.maxSlippageBps,
    ],
  )) as unknown as BasketFactory;
  await factory.waitForDeployment();

  if (!options.skipSeeding) {
    const routerAddress = await router.getAddress();
    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i];
      const token = components[i];

      const settlementSide = ethers.parseUnits(String(spec.liquidity), settlementDecimals);
      // Token side chosen so the pool's initial ratio is exactly the configured
      // price: liquidity / price whole tokens, in the token's own decimals.
      const wholeTokens = BigInt(Math.round(spec.liquidity / spec.price));
      const tokenSide = ethers.parseUnits(wholeTokens.toString(), spec.decimals);

      await (await settlement.mint(deployer.address, settlementSide)).wait();
      await (await token.mint(deployer.address, tokenSide)).wait();
      await (await settlement.approve(routerAddress, settlementSide)).wait();
      await (await token.approve(routerAddress, tokenSide)).wait();
      await (
        await router.seed(
          await settlement.getAddress(),
          await token.getAddress(),
          settlementSide,
          tokenSide,
        )
      ).wait();
    }
  }

  return {
    signers,
    settlement,
    components,
    specs,
    weights,
    priceProvider,
    router,
    adapter,
    factory,
    defaults,
    chainId,
  };
}

export interface CreateBasketOverrides {
  name?: string;
  symbol?: string;
  theme?: string;
  description?: string;
  components?: string[];
  weights?: number[];
  creator?: string;
  depositFeeBps?: number;
  redeemFeeBps?: number;
  creatorShareBps?: number;
  maxSlippageBps?: number;
}

/** Creates a basket through the factory and returns a typed handle to it. */
export async function createBasket(
  fixture: Fixture,
  overrides: CreateBasketOverrides = {},
): Promise<ThematicBasket> {
  const componentAddresses =
    overrides.components ?? (await Promise.all(fixture.components.map((c) => c.getAddress())));

  const tx = await fixture.factory.createBasket({
    name: overrides.name ?? 'Test Basket',
    symbol: overrides.symbol ?? 'TST',
    description: overrides.description ?? 'A basket used in tests.',
    theme: overrides.theme ?? 'Testing',
    components: componentAddresses,
    weightsBps: overrides.weights ?? fixture.weights,
    creator: overrides.creator ?? fixture.signers.creator.address,
    depositFeeBps: overrides.depositFeeBps ?? fixture.defaults.depositFeeBps,
    redeemFeeBps: overrides.redeemFeeBps ?? fixture.defaults.redeemFeeBps,
    creatorShareBps: overrides.creatorShareBps ?? fixture.defaults.creatorShareBps,
    maxSlippageBps: overrides.maxSlippageBps ?? fixture.defaults.maxSlippageBps,
  });
  const receipt = await tx.wait();

  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = fixture.factory.interface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed?.name === 'BasketCreated') {
        const basket = await ethers.getContractAt('ThematicBasket', parsed.args.basket as string);
        return basket as unknown as ThematicBasket;
      }
    } catch {
      // Not one of ours.
    }
  }

  throw new Error('BasketCreated event not found in the creation receipt.');
}

/** Funds `signer` with settlement tokens and approves `spender`. */
export async function fundSettlement(
  fixture: Fixture,
  signer: HardhatEthersSigner,
  wholeAmount: number,
  spender: string,
): Promise<bigint> {
  const amount = ethers.parseUnits(String(wholeAmount), await fixture.settlement.decimals());
  await (await fixture.settlement.mint(signer.address, amount)).wait();
  await (await fixture.settlement.connect(signer).approve(spender, amount)).wait();
  return amount;
}

/** A deadline one hour from the latest block, in the chain's own clock. */
export async function futureDeadline(): Promise<number> {
  const block = await ethers.provider.getBlock('latest');
  return (block?.timestamp ?? Math.floor(Date.now() / 1000)) + 3_600;
}

/** A deadline one hour in the past. */
export async function pastDeadline(): Promise<number> {
  const block = await ethers.provider.getBlock('latest');
  return (block?.timestamp ?? Math.floor(Date.now() / 1000)) - 3_600;
}

// ---------------------------------------------------------------------------
// Named fixtures
//
// `loadFixture` snapshots the chain against the fixture function's identity, so
// each fixture must be a named, stable reference rather than an inline arrow.
// Every variant the suite needs is declared here.
// ---------------------------------------------------------------------------

/** The default stack: three 18-decimal components, 40/40/20, 5 bps deposit fee. */
export async function standardFixture(): Promise<Fixture> {
  return deployFixture();
}

/** Ten components, the maximum the protocol allows. */
export async function wideFixture(): Promise<Fixture> {
  const specs: ComponentSpec[] = Array.from({ length: 10 }, (_, i) => ({
    symbol: `mX${i}`,
    name: `Mock ${i}`,
    decimals: 18,
    price: 100,
    liquidity: 500_000,
  }));
  return deployFixture({ components: specs, weights: Array.from({ length: 10 }, () => 1_000) });
}

/** Components with 18, 8 and 6 decimals. */
export async function mixedDecimalFixture(): Promise<Fixture> {
  return deployFixture({
    components: [
      { symbol: 'm18', name: 'Eighteen', decimals: 18, price: 100, liquidity: 1_000_000 },
      { symbol: 'm8', name: 'Eight', decimals: 8, price: 250, liquidity: 1_000_000 },
      { symbol: 'm6', name: 'Six', decimals: 6, price: 40, liquidity: 500_000 },
    ],
    weights: [4_000, 4_000, 2_000],
  });
}

/** A component claiming more decimals than the protocol will value. */
export async function oversizedDecimalsFixture(): Promise<Fixture> {
  return deployFixture({
    components: [
      { symbol: 'mBig', name: 'Big', decimals: 40, price: 100, liquidity: 1_000_000 },
      ...DEFAULT_COMPONENTS.slice(1),
    ],
    weights: [4_000, 4_000, 2_000],
  });
}

/** Deep liquidity: a normal deposit moves the price very little. */
export async function deepLiquidityFixture(): Promise<Fixture> {
  return deployFixture();
}

/** Shallow liquidity: a normal deposit consumes most of the pool. */
export async function thinLiquidityFixture(): Promise<Fixture> {
  return deployFixture({
    components: DEFAULT_COMPONENTS.map((spec) => ({ ...spec, liquidity: 1_200 })),
  });
}

/** No liquidity at all, so every swap reverts. */
export async function noLiquidityFixture(): Promise<Fixture> {
  return deployFixture({ skipSeeding: true });
}

/** A settlement asset that burns a cut of every transfer. */
export async function feeOnTransferFixture(): Promise<Fixture> {
  return deployFixture({ feeOnTransferSettlement: true });
}

/**
 * A settlement asset that calls back into the basket while a deposit is
 * mid-flight. The hook is dormant until a test arms it.
 */
export async function callbackSettlementFixture(): Promise<Fixture> {
  return deployFixture({ callbackSettlement: true });
}

/** A venue that pays out half of the floor it is given and reports success. */
export async function shortchangingAdapterFixture(): Promise<Fixture> {
  return deployFixture({ shortchangingAdapter: true });
}

/** A basket that charges a redemption fee, for the fee-split paths. */
export async function redeemFeeFixture(): Promise<Fixture> {
  return deployFixture({ redeemFeeBps: 100, depositFeeBps: 100 });
}

/** A basket whose creator keeps the whole fee, for remainder arithmetic. */
export async function fullCreatorShareFixture(): Promise<Fixture> {
  return deployFixture({ creatorShareBps: 9_000 });
}

/**
 * A 6-decimal settlement asset, like the real USDT on BSC.
 *
 * The basket token always has 18 decimals, so this fixture is where the share
 * scale and the settlement scale stop cancelling. Anything that reads correctly
 * on an 18-decimal settlement asset and wrongly here is a bug that only shows up
 * in production.
 */
export async function sixDecimalSettlementFixture(): Promise<Fixture> {
  return deployFixture({ settlementDecimals: 6 });
}
