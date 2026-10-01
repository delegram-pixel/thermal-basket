import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { artifacts } from 'hardhat';
import { banner, field } from '../lib/deployment';

/**
 * Exports the ABIs the frontend needs.
 *
 * The frontend consumes interfaces, not deployments, so it must not have to
 * compile Solidity or read Hardhat's artifact tree (which is gitignored and
 * shaped for the compiler, not for a bundler). This emits a small, checked-in
 * `abis/` directory instead: canonical JSON for anything that wants data, and a
 * TypeScript module for the app.
 *
 * The TypeScript matters more than it looks. Every ABI is emitted `as const`, so
 * viem reads literal types out of it — `readContract({ functionName: ... })`
 * autocompletes and rejects a typo at compile time rather than at runtime. A
 * plain JSON import would widen to `string` and throw that away.
 *
 * Run `ABI_CHECK=1` to verify the checked-in files match the compiled contracts
 * without writing anything. That is the CI mode: a stale ABI is a frontend bug
 * that type-checks cleanly, so it needs its own gate.
 */

interface AbiExport {
  /** Artifact name as Hardhat knows it. */
  artifact: string;
  /** Identifier the app imports. */
  exportName: string;
  /** Basename for the JSON file, which need not match the artifact name. */
  file: string;
  /** One line, emitted as a comment above the export. */
  description: string;
}

/**
 * Deliberately interfaces over implementations where one exists. `IERC20Metadata`
 * rather than `MockERC20`: the app talks to whatever token is configured, and
 * shipping an ABI with `mint` on it invites someone to call it on mainnet.
 * The two mocks that earn their place are here because the demo genuinely needs
 * them — the price feed is moved to show NAV responding, and that is the point
 * of the demo.
 */
const EXPORTS: AbiExport[] = [
  {
    artifact: 'ThematicBasket',
    exportName: 'thematicBasketAbi',
    file: 'ThematicBasket',
    description: 'A basket: deposits, redemptions, fees, valuations and its ERC-20 surface.',
  },
  {
    artifact: 'BasketFactory',
    exportName: 'basketFactoryAbi',
    file: 'BasketFactory',
    description: 'Creates baskets and enumerates them; the protocol admin lives here.',
  },
  {
    artifact: 'IERC20Metadata',
    exportName: 'erc20Abi',
    file: 'ERC20',
    description: 'The settlement asset and every component token. Standard ERC-20.',
  },
  {
    artifact: 'IPriceProvider',
    exportName: 'priceProviderAbi',
    file: 'PriceProvider',
    description: 'Read path for component prices. One whole token, in settlement units.',
  },
  {
    artifact: 'MockPriceProvider',
    exportName: 'mockPriceProviderAbi',
    file: 'MockPriceProvider',
    description: 'Demo price feed. Test networks only — these prices are invented.',
  },
];

interface Emitted {
  file: string;
  contents: string;
}

const OUTPUT_DIR = resolve(__dirname, '../../abis');

/** Deterministic serialisation, so a re-run with no source change is a no-op. */
function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function generatedHeader(source: string): string {
  return [
    '// GENERATED FILE — do not edit by hand.',
    `// Source: ${source}`,
    '// Regenerate: yarn workspace @thematic/contracts export:abi',
    '',
  ].join('\n');
}

async function collect(): Promise<Emitted[]> {
  const emitted: Emitted[] = [];
  const exportDeclarations: string[] = [];

  for (const entry of EXPORTS) {
    const artifact = await artifacts.readArtifact(entry.artifact);
    const abi = artifact.abi;

    emitted.push({
      file: join(OUTPUT_DIR, `${entry.file}.json`),
      contents: stableJson(abi),
    });

    // `as const` is what preserves the literal types viem infers from. Without
    // it the ABI is just `string[]` and the type safety evaporates.
    exportDeclarations.push(
      [
        `/** ${entry.description} */`,
        `export const ${entry.exportName} = ${JSON.stringify(abi, null, 2)} as const;`,
      ].join('\n'),
    );
  }

  emitted.push({
    file: join(OUTPUT_DIR, 'index.ts'),
    contents: `${generatedHeader('the compiled contracts')}${exportDeclarations.join('\n\n')}\n`,
  });

  return emitted;
}

/**
 * Every file is regenerated from one pass over the artifacts, so the JSON and
 * the TypeScript can never disagree about what a contract exposes.
 */
async function main(): Promise<void> {
  const check = process.env.ABI_CHECK === '1' || process.argv.includes('--check');

  banner(check ? 'Export ABIs (check)' : 'Export ABIs');

  const emitted = await collect();
  const drifted: string[] = [];

  if (!check) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const file of emitted) {
    const label = file.file.slice(OUTPUT_DIR.length + 1);
    const existing = existsSync(file.file) ? readFileSync(file.file, 'utf8') : null;

    if (check) {
      // Byte comparison, not a deep-equal: the output is deterministic, so any
      // difference at all — including key order — is something to regenerate.
      if (existing === file.contents) {
        field(label, 'up to date');
      } else {
        drifted.push(label);
        field(label, existing === null ? 'MISSING' : 'STALE');
      }
      continue;
    }

    writeFileSync(file.file, file.contents, 'utf8');
    field(label, existing === file.contents ? 'unchanged' : 'written');
  }

  field('output', OUTPUT_DIR);

  if (drifted.length > 0) {
    console.error(
      `\n${drifted.length} ABI file(s) out of date: ${drifted.join(', ')}\n` +
        'Run: yarn workspace @thematic/contracts export:abi',
    );
    process.exitCode = 1;
    return;
  }

  console.log(check ? '\nABIs match the compiled contracts.\n' : '\nDone.\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
