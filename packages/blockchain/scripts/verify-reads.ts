import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createPublicClient, http, type Address } from 'viem';
import { hardhat } from 'viem/chains';
import {
  readBasket,
  readBasketAddresses,
  readBasketSummaries,
  readFactoryConfig,
  readPosition,
} from '../src/reads.ts';
import { formatBps, formatNavPerShare, formatSettlement, formatWeight } from '../src/format.ts';

/**
 * Exercises the read layer against a live chain.
 *
 * Not a unit test — those use stubs and live beside the code. This is the other
 * half: it points the *exact functions the frontend calls* at a real node and
 * prints what comes back. A function name that drifted from the ABI, a unit
 * convention that disagrees with the contract, or a valuation formula off by a
 * scale factor shows up here, rather than as a wrong number on a page that
 * nobody has compared against the chain.
 *
 * The check that matters most is at the foot of each basket: the contract's own
 * `totalAssets()` and the sum of component values this layer computes from
 * prices and balances are derived by different routes and must agree. They are
 * also computed in different units — the contract in Solidity `uint256`, this in
 * JavaScript `bigint` — so a disagreement is a real defect, not a rounding
 * artifact to be waved through.
 *
 * Run against a node that has been deployed and seeded:
 *   yarn workspace @thematic/contracts deploy:local
 *   yarn workspace @thematic/contracts seed:local
 *   yarn workspace @thematic/contracts baskets:local
 *   yarn workspace @thematic/blockchain verify:reads
 */

interface DeploymentShape {
  network: string;
  chainId: string | number;
  deployer: string;
  contracts: { factory: string };
}

const here = dirname(fileURLToPath(import.meta.url));
const deploymentPath = resolve(here, '../../contracts/deployments/localhost.json');

function loadDeployment(): DeploymentShape {
  try {
    return JSON.parse(readFileSync(deploymentPath, 'utf8')) as DeploymentShape;
  } catch {
    throw new Error(
      `No local deployment at ${deploymentPath}. Run the contracts package's deploy:local, seed:local and baskets:local first.`,
    );
  }
}

function field(label: string, value: string): void {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

function rule(title: string): void {
  console.log('');
  console.log(`  ${title}`);
  console.log(`  ${'─'.repeat(Math.max(title.length, 8))}`);
}

async function main(): Promise<void> {
  const deployment = loadDeployment();
  const factory = deployment.contracts.factory as Address;

  const client = createPublicClient({ chain: hardhat, transport: http('http://127.0.0.1:8545') });

  rule(`Read layer — ${deployment.network} (chain ${deployment.chainId})`);
  field('Factory', factory);

  // -- Factory configuration ------------------------------------------------
  const config = await readFactoryConfig(client, factory);
  field(
    'Settlement',
    `${config.settlementToken.symbol} (${config.settlementToken.decimals} decimals)`,
  );
  field('Price provider', config.priceProvider);
  field('DEX adapter', config.dexAdapter);
  field('Baskets', String(config.basketCount));
  field('Allowlist enforced', config.allowlistEnforced ? 'yes' : 'no');
  field(
    'Defaults',
    `deposit ${formatBps(config.defaults.depositFeeBps)} · redeem ${formatBps(config.defaults.redeemFeeBps)} · creator ${formatBps(config.defaults.creatorShareBps)} · slippage ${formatBps(config.defaults.maxSlippageBps)}`,
  );
  field(
    'Limits',
    `deposit ${formatBps(config.limits.depositFeeBps)} · redeem ${formatBps(config.limits.redeemFeeBps)} · creator ${formatBps(config.limits.creatorShareBps)} · slippage ${formatBps(config.limits.maxSlippageBps)}`,
  );

  const { decimals: settlementDecimals, symbol: settlementSymbol } = config.settlementToken;

  // -- List -----------------------------------------------------------------
  const addresses = await readBasketAddresses(client, factory);
  const summaries = await readBasketSummaries(client, addresses);

  field('Addresses read', String(addresses.length));
  field('Summaries read', String(summaries.length));

  const failures: string[] = [];
  if (addresses.length !== summaries.length) {
    failures.push('the address list and its summaries disagree on how many baskets exist');
  }

  let componentTotal = 0;

  for (const summary of summaries) {
    rule(`${summary.symbol} — ${summary.name}`);
    field('Address', summary.address);
    field('Theme', summary.theme);
    field('Creator', summary.creator);
    field('Supply', summary.totalSupply.toString());
    field(
      'NAV/share',
      summary.navPerShare === null
        ? 'unavailable'
        : `${formatNavPerShare(summary.navPerShare, settlementDecimals)} ${settlementSymbol}`,
    );
    field(
      'Assets',
      summary.totalAssets === null
        ? 'unavailable'
        : formatSettlement(summary.totalAssets, settlementDecimals, settlementSymbol),
    );
    field(
      'Published weights',
      summary.weights
        .map((weight) => `${weight.symbol} ${formatWeight(weight.weightBps)}`)
        .join(' · '),
    );

    // -- Detail --------------------------------------------------------------
    const basket = await readBasket(client, summary.address);
    componentTotal += basket.components.length;

    if (basket.decimals !== 18) {
      failures.push(`${summary.symbol}: basket decimals read as ${basket.decimals}, expected 18`);
    }
    if (basket.settlementDecimals !== settlementDecimals) {
      failures.push(
        `${summary.symbol}: basket reports settlement decimals ${basket.settlementDecimals}, factory says ${settlementDecimals}`,
      );
    }
    if (basket.components.length !== summary.componentCount) {
      failures.push(
        `${summary.symbol}: read ${basket.components.length} components, contract says ${summary.componentCount}`,
      );
    }

    for (const component of basket.components) {
      field(
        `  ${component.symbol}`,
        [
          `w ${formatWeight(component.weightBps)}`,
          `price ${component.price === null ? 'none' : formatSettlement(component.price, settlementDecimals, settlementSymbol)}`,
          `bal ${component.balance.toString()}`,
          `val ${component.value === null ? 'none' : formatSettlement(component.value, settlementDecimals, settlementSymbol)}`,
          `realised ${component.realisedWeightBps === null ? '—' : formatWeight(component.realisedWeightBps)}`,
        ].join('   '),
      );
    }

    // The check this script exists for: two independent routes to one figure.
    // The contract computes the total in Solidity `uint256` from its own price
    // reads; this layer computes it in JavaScript `bigint` from prices and
    // balances it fetched itself. They must agree exactly.
    const computed = basket.components.reduce(
      (total, component) => total + (component.value ?? 0n),
      0n,
    );
    field(
      'Assets (contract)',
      basket.totalAssets === null
        ? 'unavailable'
        : formatSettlement(basket.totalAssets, settlementDecimals, settlementSymbol),
    );
    field('Assets (summed)', formatSettlement(computed, settlementDecimals, settlementSymbol));

    if (basket.totalAssets === null) {
      failures.push(
        `${summary.symbol}: the contract could not value the basket, so no total exists`,
      );
    } else if (computed !== basket.totalAssets) {
      const difference =
        computed > basket.totalAssets
          ? computed - basket.totalAssets
          : basket.totalAssets - computed;
      failures.push(
        `${summary.symbol}: computed valuation differs from the contract's by ${difference.toString()} settlement smallest units`,
      );
    }

    // NAV must stay on the one-whole-settlement-unit-per-basket-token
    // convention. A basket that has only ever been deposited into sits at 1.0;
    // a value a factor away means the display convention and the contract have
    // come apart again, which is the bug this convention replaced.
    const launchPrice = 10n ** BigInt(settlementDecimals);
    if (basket.navPerShare === null) {
      failures.push(`${summary.symbol}: the contract returned no NAV while the basket is funded`);
    } else {
      if (basket.totalSupply > 0n && basket.navPerShare < launchPrice / 100n) {
        failures.push(
          `${summary.symbol}: NAV read as ${basket.navPerShare.toString()}, which is not on the settlement-smallest-unit scale`,
        );
      }
      // The detail reader and the list reader reach NAV by different routes —
      // one reads it alongside the full component set, the other on its own —
      // so a disagreement between them means one of the two is reading a
      // different contract or a different block.
      if (summary.navPerShare !== null && summary.navPerShare !== basket.navPerShare) {
        failures.push(
          `${summary.symbol}: NAV differs between the list (${summary.navPerShare.toString()}) and the detail view (${basket.navPerShare.toString()})`,
        );
      }
      field(
        'NAV (display)',
        `${formatNavPerShare(basket.navPerShare, settlementDecimals)} ${settlementSymbol} per ${basket.symbol}`,
      );
    }

    // -- Position ------------------------------------------------------------
    const holder = deployment.deployer as Address;
    const position = await readPosition(client, summary.address, holder);
    field(
      'Position',
      `${position.shares.toString()} shares · ${formatSettlement(position.value, settlementDecimals, settlementSymbol)} · ${formatBps(position.ownershipBps)} of supply`,
    );

    if (position.shares > 0n && position.value === 0n) {
      failures.push(`${summary.symbol}: the deployer holds shares but the value read back is zero`);
    }
  }

  if (failures.length > 0) {
    rule(`${failures.length} check${failures.length === 1 ? '' : 's'} failed`);
    for (const failure of failures) console.log(`  · ${failure}`);
    process.exitCode = 1;
    return;
  }

  rule('Read layer agrees with the chain');
  field('Checked', `${summaries.length} baskets, ${componentTotal} components`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
