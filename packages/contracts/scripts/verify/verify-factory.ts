import hre, { ethers, network } from 'hardhat';
import { MOCK_TOKENS, SETTLEMENT_DECIMALS, FACTORY_DEFAULTS } from '../lib/config';
import { banner, field, loadDeployment } from '../lib/deployment';

/**
 * Publishes the source of every deployed contract to BscScan.
 *
 * Unverified contracts are unauditable contracts, and an unauditable fund is
 * asking to be trusted on the say-so of its authors. Judges, and anyone else,
 * should be able to read the code that holds the money at the address they were
 * given. This script exists so that is never a manual step someone forgets.
 *
 * Verification is idempotent: a contract that is already verified is reported
 * and skipped rather than treated as a failure.
 */
async function main(): Promise<void> {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 97) {
    throw new Error('Verification is configured for BSC testnet (chain 97) only.');
  }

  const [deployer] = await ethers.getSigners();
  const deployment = loadDeployment(network.name);
  const { factory, priceProvider, dexAdapter, router, settlementToken, wrappedNative, components } =
    deployment.contracts;

  banner(`Verifying — ${network.name} (chain ${chainId})`);

  if (!process.env.BSCSCAN_API_KEY) {
    throw new Error(
      'BSCSCAN_API_KEY is not set. Add it to .env (see .env.example) before verifying.',
    );
  }

  const targets: { name: string; address: string; args: unknown[] }[] = [
    {
      name: 'BasketFactory',
      address: factory,
      args: [
        settlementToken,
        deployment.roles.protocolAdmin,
        priceProvider,
        dexAdapter,
        deployment.roles.protocolTreasury,
        FACTORY_DEFAULTS,
      ],
    },
    {
      name: 'MockPriceProvider',
      address: priceProvider,
      args: [deployment.roles.priceProviderAdmin],
    },
    { name: 'PancakeSwapAdapter', address: dexAdapter, args: [router] },
    { name: 'MockDexRouter', address: router, args: [wrappedNative] },
    {
      name: 'MockERC20',
      address: settlementToken,
      args: ['Mock Tether USD', 'mUSDT', SETTLEMENT_DECIMALS],
    },
    { name: 'MockERC20', address: wrappedNative, args: ['Mock Wrapped BNB', 'mWBNB', 18] },
    ...MOCK_TOKENS.map((token) => ({
      name: 'MockERC20',
      address: components[token.symbol],
      args: [token.name, token.symbol, token.decimals],
    })),
  ];

  let verified = 0;
  let skipped = 0;

  for (const target of targets) {
    if (!target.address) {
      field(target.name, 'skipped — no address in deployment metadata');
      skipped += 1;
      continue;
    }

    // Let the explorer index the deployment before asking it to verify.
    const code = await ethers.provider.getCode(target.address);
    if (code === '0x') {
      field(target.name, `skipped — no code at ${target.address}`);
      skipped += 1;
      continue;
    }

    try {
      await hre.run('verify:verify', {
        address: target.address,
        constructorArguments: target.args,
      });
      field(target.name, `verified — ${target.address}`);
      verified += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('already verified')) {
        field(target.name, `already verified — ${target.address}`);
        verified += 1;
      } else {
        field(target.name, `FAILED — ${target.address}`);
        console.error(`    ${message}`);
        skipped += 1;
      }
    }
  }

  banner('Verification complete');
  field('Verified', String(verified));
  field('Not verified', String(skipped));
  field('Deployer', deployer.address);
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
