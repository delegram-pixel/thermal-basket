import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The test runner for the interface and the layer under it (§36).
 *
 * One config at the root rather than one per workspace, because `@thematic/*`
 * are consumed as TypeScript source rather than built output — `main` points
 * straight at `src/index.ts` — so a test of `format.ts` and a test of the
 * component that renders it are the same kind of test over the same module
 * graph. Splitting them would mean two runners, two dependency islands and two
 * ways for the same import to resolve.
 *
 * The environment is jsdom for the whole run. The pure modules under
 * `packages/blockchain` need nothing from it, but the cost of giving them a DOM
 * they ignore is a few milliseconds, and the alternative — per-file environment
 * docblocks or a multi-project config — is a second thing to get wrong for no
 * gain.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The app's own `@/` paths, resolved from where the app's tsconfig points
      // them. Without this every component test fails on its first import.
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['apps/web/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.ts'],
    // Playwright's specs match `*.spec.ts` and are driven by its own runner.
    // Named explicitly so that a future `*.test.ts` under `e2e/` is a decision
    // rather than an accident.
    exclude: ['**/node_modules/**', '**/.next/**', 'apps/web/e2e/**'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['apps/web/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        // Declarations carry no executable code, so they can only ever report
        // as uncovered.
        '**/*.d.ts',
        // Next's route files and the root layout: they are wiring, and the
        // things they wire together are covered directly. §36 puts the critical
        // end-to-end flow in Playwright, not here.
        'apps/web/src/app/**',
        'packages/blockchain/src/abis.ts',
        'packages/blockchain/src/reads.ts',
        'packages/blockchain/src/writes.ts',
        'packages/blockchain/src/hooks.ts',
      ],
    },
  },
});
