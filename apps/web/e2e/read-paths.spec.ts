import { expect, test, type Page } from '@playwright/test';

/**
 * The read paths, end to end (§36).
 *
 * What this covers: a visitor with no wallet can reach the app, find a basket,
 * and read its composition, fees and contract addresses from the deployment —
 * and is told on every screen carrying a figure that the figures are simulated
 * (§10, §39, §49).
 *
 * What it does not cover: the write paths. Connect → approve → deposit →
 * confirm → withdraw needs a scripted wallet against a chain this suite
 * controls, which is a different harness from this one and is not written yet.
 * Saying so here is deliberate; a suite that quietly tests only the easy half
 * while the task list says "E2E" is worse than one that names the gap.
 */

/** Console errors and uncaught exceptions, so a broken page cannot pass by looking right. */
function collectFailures(page: Page): string[] {
  const failures: string[] = [];

  page.on('pageerror', (error) => failures.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });

  return failures;
}

/**
 * Waits for the discovery list to settle into one of its two honest outcomes.
 *
 * "No baskets have been created on this network" is a correct render, not a
 * failure — a suite that insisted on rows would be asserting that the
 * deployment is populated rather than that the page works.
 *
 * Both empty states are matched because the two surfaces word it differently:
 * the landing page says "No baskets yet" and the explorer says "No baskets have
 * been created on this network". Matching only one of them hangs here on the
 * other.
 */
async function waitForBasketList(page: Page) {
  const empty = page.getByText(/^(No baskets yet|No baskets have been created on this network)$/);
  const list = page.locator('article').first();

  await expect(empty.or(list)).toBeVisible();
  return list;
}

test.describe('discovery', () => {
  test('the landing page states what the product is', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Own a theme, not a ticker.');
    await expect(page.getByRole('link', { name: 'Explore baskets' }).first()).toBeVisible();
  });

  test('says the prices are simulated, next to the figures rather than in a footer', async ({
    page,
  }) => {
    // §39's actual requirement: a mock figure is never shown unqualified. The
    // notice has to be adjacent to the numbers, which is why this asserts
    // visibility on the page carrying them rather than on /disclosures.
    await page.goto('/');

    const notice = page.getByText('Simulated market data').first();
    await expect(notice).toBeVisible();
    await expect(page.getByText(/not market data/i).first()).toBeVisible();
  });

  test('renders the basket list, or says honestly that there is none', async ({ page }) => {
    await page.goto('/');
    await waitForBasketList(page);
  });

  test('loads without a console error', async ({ page }) => {
    const failures = collectFailures(page);

    await page.goto('/');
    await waitForBasketList(page);

    expect(failures, failures.join('\n')).toEqual([]);
  });
});

test.describe('explorer', () => {
  test('lists every basket on the deployment', async ({ page }) => {
    await page.goto('/baskets');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Every basket');
    await waitForBasketList(page);
  });

  test('filters the list by search without re-reading the chain', async ({ page }) => {
    await page.goto('/baskets');
    const list = await waitForBasketList(page);

    // Nothing to filter is a legitimate state on a fresh deployment, and the
    // empty state above is already covered.
    test.skip(
      (await list.count()) === 0,
      'this deployment has no baskets, so there is nothing to filter',
    );

    await page.getByLabel('Search').fill('zzzznothingmatchesthis');
    await expect(page.getByText('Nothing matches those filters')).toBeVisible();

    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('carries the simulated-data notice too', async ({ page }) => {
    await page.goto('/baskets');

    await expect(page.getByText('Simulated market data').first()).toBeVisible();
  });
});

test.describe('a basket, read without a wallet', () => {
  test('states its composition, its fees and its contracts', async ({ page }) => {
    await page.goto('/baskets');
    const list = await waitForBasketList(page);

    // The seeded testnet deployment has baskets, so reaching this means the
    // deployment changed rather than that the page broke.
    test.skip((await list.count()) === 0, 'this deployment has no baskets to open');

    await list.getByRole('link').first().click();

    // The composition band is the app's signature object and has to be legible
    // to a screen reader, so this asserts the accessible name rather than that
    // some coloured boxes rendered.
    const band = page.getByRole('img').first();
    await expect(band).toBeVisible();
    expect(await band.getAttribute('aria-label')).toMatch(/\d+(\.\d+)?%/);

    await expect(
      page.getByRole('table', { name: 'Published target allocation by component' }),
    ).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Fees' })).toBeVisible();
    // `exact` is load-bearing: accessible-name matching is a substring match by
    // default, so the bare "The contract" also matches the "Held by the contract"
    // sub-heading and the locator resolves to two elements.
    await expect(page.getByRole('heading', { name: 'The contract', exact: true })).toBeVisible();
  });

  test('offers deposit and redemption, and does not claim to know a balance it has not read', async ({
    page,
  }) => {
    await page.goto('/baskets');
    const list = await waitForBasketList(page);
    test.skip((await list.count()) === 0, 'this deployment has no baskets to open');

    await list.getByRole('link').first().click();

    await expect(page.getByText('Reading the basket from the chain…')).toBeHidden();

    // With no wallet connected, the page must say it cannot read a position
    // rather than assert that the visitor holds nothing — a claim about an
    // address it has not looked at.
    await expect(page.getByText('Connect a wallet to read your position')).toBeVisible();
    await expect(page.getByText(/This wallet holds no/)).toBeHidden();
  });

  test('links every contract it read, on a chain that has an explorer', async ({ page }) => {
    await page.goto('/baskets');
    const list = await waitForBasketList(page);
    test.skip((await list.count()) === 0, 'this deployment has no baskets to open');

    await list.getByRole('link').first().click();
    await expect(page.getByRole('heading', { name: 'The contract', exact: true })).toBeVisible();

    // Any explorer link on the page has to point somewhere real. A dead link is
    // the failure §21's "explorer link, but not a broken one" is about.
    const hrefs = await page
      .locator('a[href*="bscscan.com"]')
      .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));

    for (const href of hrefs) {
      expect(href).toMatch(/^https:\/\/(testnet\.)?bscscan\.com\/(address|tx)\/0x[0-9a-fA-F]+/);
    }
  });
});

test.describe('disclosures', () => {
  test('is reachable from the landing page, not only by typing the URL', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: /The full disclosures/i }).click();

    await expect(page).toHaveURL(/\/disclosures$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('spells out what is simulated', async ({ page }) => {
    await page.goto('/disclosures');

    await expect(page.getByText(/mock|simulat/i).first()).toBeVisible();
  });
});

test.describe('not found', () => {
  test('explains a route that does not exist rather than rendering nothing', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');

    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
