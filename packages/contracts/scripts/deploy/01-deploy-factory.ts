import hre, { ethers, network } from 'hardhat';
import { FACTORY_DEFAULTS, MOCK_TOKENS, SETTLEMENT_DECIMALS } from '../lib/config';
import {
  assertNotMainnet,
  banner,
  field,
  addressLink,
  needsMockStack,
  saveDeployment,
  type Deployment,
} from '../lib/deployment';

/**
 * Deploys the protocol.
 *
 * On a test network this stands up the whole stack: a mock settlement asset, the
 * mock equity tokens, an administrator-set price feed, a constant-product DEX and
 * the adapter in front of it, then the factory. On a chain with real
 * infrastructure the mock half is skipped and the addresses come from the
 * environment instead.
 *
 * Mainnet is refused outright. Deploying to BSC mainnet is a separate, deliberate
 * operation with a checklist — see docs/DEPLOYMENT.md.
 */
async function main(): Promise<void> {
  assertNotMainnet(hre);

  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const useMocks = needsMockStack(chainId);

  banner(`Deploying Thematic Baskets — ${network.name} (chain ${chainId})`);
  field('Deployer', deployer.address);
  field('Balance', `${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);
  field('Stack', useMocks ? 'mock tokens + mock price feed + mock DEX' : 'existing infrastructure');

  if (!useMocks) {
    throw new Error(
      `Network "${network.name}" is not a recognised test network. This script only deploys the ` +
        'mock stack; wiring real infrastructure is a separate, reviewed deployment.',
    );
  }

  const transactions: Record<string, string> = {};

  // -------------------------------------------------------------------
  // Settlement asset
  // -------------------------------------------------------------------
  const settlement = await (
    await ethers.getContractFactory('MockERC20')
  ).deploy('Mock Tether USD', 'mUSDT', SETTLEMENT_DECIMALS);
  await settlement.waitForDeployment();
  transactions.settlementToken = settlement.deploymentTransaction()?.hash ?? '';
  field('mUSDT', addressLink(chainId, await settlement.getAddress()));

  // -------------------------------------------------------------------
  // Component tokens
  // -------------------------------------------------------------------
  const componentFactory = await ethers.getContractFactory('MockERC20');
  const components: Record<string, string> = {};

  for (const token of MOCK_TOKENS) {
    const contract = await componentFactory.deploy(token.name, token.symbol, token.decimals);
    await contract.waitForDeployment();
    components[token.symbol] = await contract.getAddress();
    transactions[`component:${token.symbol}`] = contract.deploymentTransaction()?.hash ?? '';
    field(token.symbol, addressLink(chainId, components[token.symbol]));
  }

  // -------------------------------------------------------------------
  // Price feed
  // -------------------------------------------------------------------
  const priceProvider = await (
    await ethers.getContractFactory('MockPriceProvider')
  ).deploy(deployer.address);
  await priceProvider.waitForDeployment();
  transactions.priceProvider = priceProvider.deploymentTransaction()?.hash ?? '';

  const symbols = MOCK_TOKENS.map((t) => t.symbol);
  const prices = MOCK_TOKENS.map((t) => ethers.parseUnits(t.price, SETTLEMENT_DECIMALS));
  await (
    await priceProvider.setPrices(
      symbols.map((s) => components[s]),
      prices,
    )
  ).wait();
  field('PriceProvider', addressLink(chainId, await priceProvider.getAddress()));
  field('Prices seeded', `${symbols.length} assets (mock — not market data)`);

  // -------------------------------------------------------------------
  // DEX
  // -------------------------------------------------------------------
  const wrappedNative = await (
    await ethers.getContractFactory('MockERC20')
  ).deploy('Mock Wrapped BNB', 'mWBNB', 18);
  await wrappedNative.waitForDeployment();
  transactions.wrappedNative = wrappedNative.deploymentTransaction()?.hash ?? '';

  const router = await (
    await ethers.getContractFactory('MockDexRouter')
  ).deploy(await wrappedNative.getAddress());
  await router.waitForDeployment();
  transactions.router = router.deploymentTransaction()?.hash ?? '';
  field('DEX router', addressLink(chainId, await router.getAddress()));

  const adapter = await (
    await ethers.getContractFactory('PancakeSwapAdapter')
  ).deploy(await router.getAddress());
  await adapter.waitForDeployment();
  transactions.dexAdapter = adapter.deploymentTransaction()?.hash ?? '';
  field('DEX adapter', addressLink(chainId, await adapter.getAddress()));

  // -------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------
  const factory = await (
    await ethers.getContractFactory('BasketFactory')
  ).deploy(
    await settlement.getAddress(),
    deployer.address, // protocol admin — replace with a multisig before mainnet
    await priceProvider.getAddress(),
    await adapter.getAddress(),
    deployer.address, // protocol treasury
    FACTORY_DEFAULTS,
  );
  await factory.waitForDeployment();
  transactions.factory = factory.deploymentTransaction()?.hash ?? '';
  field('BasketFactory', addressLink(chainId, await factory.getAddress()));

  // -------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------
  const deployment: Deployment = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      settlementToken: await settlement.getAddress(),
      priceProvider: await priceProvider.getAddress(),
      dexAdapter: await adapter.getAddress(),
      router: await router.getAddress(),
      factory: await factory.getAddress(),
      wrappedNative: await wrappedNative.getAddress(),
      components,
    },
    roles: {
      protocolAdmin: deployer.address,
      protocolTreasury: deployer.address,
      priceProviderAdmin: deployer.address,
    },
    transactions,
  };

  const path = saveDeployment(deployment);

  banner('Deployment complete');
  field('Factory', await factory.getAddress());
  field('Settlement', await settlement.getAddress());
  field('Metadata', path);
  field(
    'Next',
    `yarn workspace @thematic/contracts seed:${network.name === 'localhost' ? 'local' : 'testnet'}`,
  );
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
