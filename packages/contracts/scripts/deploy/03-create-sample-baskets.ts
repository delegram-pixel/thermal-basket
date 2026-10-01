import hre, { ethers, network } from 'hardhat';
import { SAMPLE_BASKETS } from '../lib/config';
import {
  addressLink,
  assertNotMainnet,
  banner,
  field,
  loadDeployment,
  saveDeployment,
  txLink,
  type Deployment,
} from '../lib/deployment';

/** Tolerance the script applies to its own deposit, beyond the basket's own bound. */
const DEMO_DEPOSIT_SLIPPAGE_BPS = 200; // 2%

const DEMO_DEPOSIT = ethers.parseUnits('2500', 18);

/**
 * Creates the sample baskets and makes one real deposit into each.
 *
 * The deposits are the deployer's own money on a test network. They exist so the
 * baskets are not empty shells: an empty basket cannot show NAV movement, fee
 * accrual or a redemption, which are the three things worth looking at. They are
 * one address's position, not traction, and nothing in the UI presents them as
 * anything else.
 *
 * Idempotent by default. The factory has no notion of a duplicate basket, so a
 * second run would otherwise quietly add three more and leave the demo showing
 * six. Re-run with FORCE=1 when that is genuinely what you want.
 */
async function main(): Promise<void> {
  assertNotMainnet(hre);

  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployment = loadDeployment(network.name);
  const { factory: factoryAddress, settlementToken, components } = deployment.contracts;

  if (!settlementToken) throw new Error('Deployment metadata has no settlement token.');

  banner(`Creating sample baskets — ${network.name} (chain ${chainId})`);
  field('Factory', addressLink(chainId, factoryAddress));

  const factory = await ethers.getContractAt('BasketFactory', factoryAddress);
  const settlement = await ethers.getContractAt('MockERC20', settlementToken);

  // Idempotence guard: if the recorded baskets are still deployed, this has
  // already been done on this chain.
  const existing = deployment.baskets ?? [];
  if (existing.length > 0 && process.env.FORCE !== '1') {
    const alive = await Promise.all(
      existing.map(async (basket) => (await ethers.provider.getCode(basket.address)) !== '0x'),
    );
    if (alive.every(Boolean)) {
      banner('Sample baskets already exist');
      for (const basket of existing) {
        field(basket.symbol, addressLink(chainId, basket.address));
      }
      field('Note', 'Nothing to do. Re-run with FORCE=1 to create another set.');
      console.log('');
      return;
    }
  }

  // Fund the deployer for the demo deposits and approvals.
  await (
    await settlement.mint(deployer.address, DEMO_DEPOSIT * BigInt(SAMPLE_BASKETS.length))
  ).wait();

  const created: NonNullable<Deployment['baskets']> = [];
  const transactions: Record<string, string> = {};

  for (const basket of SAMPLE_BASKETS) {
    const symbols = Object.keys(basket.weights);
    const addresses = symbols.map((symbol) => {
      const address = components[symbol];
      if (!address) throw new Error(`No deployed address for component ${symbol}.`);
      return address;
    });

    const tx = await factory.createBasket({
      name: basket.name,
      symbol: basket.symbol,
      description: basket.description,
      theme: basket.theme,
      components: addresses,
      weightsBps: symbols.map((symbol) => basket.weights[symbol]),
      creator: deployer.address,
      depositFeeBps: basket.depositFeeBps,
      redeemFeeBps: basket.redeemFeeBps,
      creatorShareBps: basket.creatorShareBps,
      maxSlippageBps: basket.maxSlippageBps,
    });
    const receipt = await tx.wait();
    transactions[`create:${basket.symbol}`] = tx.hash;

    // The deployed address is in the event, not the receipt's `to`.
    let address: string | undefined;
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'BasketCreated') {
          address = parsed.args.basket as string;
        }
      } catch {
        // Not one of ours.
      }
    }
    if (!address) throw new Error(`Could not read the deployed address for ${basket.name}.`);

    created.push({
      name: basket.name,
      symbol: basket.symbol,
      theme: basket.theme,
      address,
      creator: deployer.address,
    });
    field(basket.name, `${address} (${basket.symbol})`);

    // ---------------------------------------------------------------
    // One deposit, so the basket holds real assets and NAV can move.
    // ---------------------------------------------------------------
    const contract = await ethers.getContractAt('ThematicBasket', address);
    const [estimatedShares] = await contract.previewDeposit(DEMO_DEPOSIT);
    const minSharesOut = (estimatedShares * BigInt(10_000 - DEMO_DEPOSIT_SLIPPAGE_BPS)) / 10_000n;

    await (await settlement.approve(address, DEMO_DEPOSIT)).wait();
    const depositTx = await contract.deposit(
      DEMO_DEPOSIT,
      minSharesOut,
      Math.floor(Date.now() / 1000) + 3600,
    );
    await depositTx.wait();
    transactions[`deposit:${basket.symbol}`] = depositTx.hash;

    const nav = await contract.navPerShare();
    const assets = await contract.totalAssets();
    field(
      '  deposit',
      `${ethers.formatUnits(DEMO_DEPOSIT, 18)} mUSDT → ${ethers.formatUnits(await contract.balanceOf(deployer.address), 18)} ${basket.symbol}`,
    );
    field('  NAV/share', `${ethers.formatUnits(nav, 18)} mUSDT (per whole ${basket.symbol})`);
    field('  total assets', `${ethers.formatUnits(assets, 18)} mUSDT`);
    if (chainId !== 31337) field('  tx', txLink(chainId, depositTx.hash));
  }

  deployment.transactions = { ...deployment.transactions, ...transactions };
  deployment.baskets = created;
  const path = saveDeployment(deployment);

  banner('Sample baskets created');
  for (const basket of created) {
    field(basket.symbol, addressLink(chainId, basket.address));
  }
  field('Metadata', path);
  field('Note', 'All assets and prices on this network are mock values, not market data.');
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
