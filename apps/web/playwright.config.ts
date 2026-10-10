import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration (§36).
 *
 * The suite runs against a *running app*, not against fixtures, because the
 * claim §36 asks to be able to make is that the interface reads a real
 * deployment. Two projects, because §28 asks for a phone and the same flows have
 * to work at 390px — a desktop-only run would leave the responsive requirement
 * untested while the suite reported green.
 *
 * The default target is `yarn dev` on the app itself, so `yarn test:e2e` works
 * from a clean checkout with no manual setup. Point `PLAYWRIGHT_BASE_URL` at a
 * preview deployment to run the same suite against a production build, which is
 * the run that matters before submitting.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  // Chain reads over a public RPC are slower than a page load, and an assertion
  // that gives up after the default five seconds would report a slow testnet as
  // a broken page.
  expect: { timeout: 15_000 },
  timeout: 60_000,

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  // Skipped entirely when the caller supplied a base URL: that run is pointed at
  // something already serving, and starting a second dev server would be wrong.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'yarn dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
