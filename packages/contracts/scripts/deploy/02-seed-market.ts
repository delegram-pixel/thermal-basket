import hre, { ethers, network } from 'hardhat';
import { MOCK_TOKENS, SETTLEMENT_DECIMALS } from '../lib/config';
import {
  assertNotMainnet,
  banner,
  field,
  loadDeployment,
  needsMockStack,
  saveDeployment,
} from '../lib/deployment';

/**
 * Mints the demo tokens and seeds DEX liquidity.
 *
 * Every component is paired against the settlement asset with enough depth that
 * a realistic deposit does not move the price much — but not so much that price
 * impact is invisible, because the point of the demo is to show that deposits are
 * priced against a real market rather than a constant.
 *
 * Safe to re-run: minting more and seeding again simply deepens the pools.
 */
async function main(): Promise<void> {
  assertNotMainnet(hre);

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (!needsMockStack(chainId)) {
    throw new Error(`Seeding requires a mock stack; "${network.name}" does not use one.`);
  }

  const [deployer] = await ethers.getSigners();
  const deployment = loadDeployment(network.name);
  const { settlementToken, router, components } = deployment.contracts;

  if (!settlementToken) {
    throw new Error('Deployment metadata has no settlement token. Run the deploy script first.');
  }

  banner(`Seeding demo market — ${network.name} (chain ${chainId})`);
  field('Settlement', settlementToken);
  field('Router', router);

  const settlement = await ethers.getContractAt('MockERC20', settlementToken);
  const dex = await ethers.getContractAt('MockDexRouter', router);

  const transactions: Record<string, string> = {};

  // Fund the deployer with the settlement asset to seed against.
  const totalLiquidity = MOCK_TOKENS.reduce((sum, token) => sum + token.liquidityUsd, 0);
  const settlementNeeded = ethers.parseUnits(String(totalLiquidity), SETTLEMENT_DECIMALS);
  await (await settlement.mint(deployer.address, settlementNeeded)).wait();
  field('Minted mUSDT', `${totalLiquidity.toLocaleString('en-US')} to the deployer`);

  for (const token of MOCK_TOKENS) {
    const address = components[token.symbol];
    if (!address) throw new Error(`No deployed address for ${token.symbol}.`);

    const component = await ethers.getContractAt('MockERC20', address);

    // Token side of the pool: settlement liquidity divided by price, expressed
    // in the component's own decimals so the pool opens at exactly the
    // configured price.
    const wholeTokens = BigInt(Math.round(token.liquidityUsd / Number(token.price)));
    const tokenAmount = ethers.parseUnits(wholeTokens.toString(), token.decimals);

    await (await component.mint(deployer.address, tokenAmount)).wait();
    await (await component.approve(router, tokenAmount)).wait();
    await (
      await settlement.approve(
        router,
        ethers.parseUnits(token.liquidityUsd.toString(), SETTLEMENT_DECIMALS),
      )
    ).wait();

    const tx = await dex.seed(
      settlementToken,
      address,
      ethers.parseUnits(token.liquidityUsd.toString(), SETTLEMENT_DECIMALS),
      tokenAmount,
    );
    await tx.wait();
    transactions[`seed:${token.symbol}`] = tx.hash;

    field(
      token.symbol,
      `${token.liquidityUsd.toLocaleString('en-US')} mUSDT paired, priced at ${token.price}`,
    );
  }

  deployment.transactions = { ...deployment.transactions, ...transactions };
  const path = saveDeployment(deployment);

  banner('Market seeded');
  field('Note', 'Prices and liquidity are mock values, not market data.');
  field('Metadata', path);
  field(
    'Next',
    `yarn workspace @thematic/contracts baskets:${network.name === 'localhost' ? 'local' : 'testnet'}`,
  );
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
