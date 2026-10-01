import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';

import {
  createBasket,
  fundSettlement,
  futureDeadline,
  sixDecimalSettlementFixture,
  standardFixture,
} from './fixtures';

/**
 * The NAV convention, pinned.
 *
 * `navPerShare()` reports the value of one whole basket token **in the
 * settlement token's smallest unit**, with no additional display scale. The
 * consequence, and the thing these tests exist to hold, is continuity: a basket
 * must report the same NAV immediately before and immediately after its first
 * deposit. If the empty-basket branch and the priced branch disagree by any
 * factor, then the number a visitor sees on a freshly created basket is wrong,
 * and it is wrong in the most visible place in the product.
 *
 * The scale is easy to get wrong because the basket token's own 18 decimals
 * cancel against `SHARE_SCALE` in the priced branch. That cancellation only
 * holds when the settlement token also has 18 decimals, so the 6-decimal case
 * is tested too — it is where a fix that "works" on the demo asset breaks.
 */
describe('Basket valuation', () => {
  it('reports one whole settlement unit per basket token while empty', async () => {
    const f = await loadFixture(standardFixture);
    const basket = await createBasket(f);

    expect(await basket.totalSupply()).to.equal(0n);
    expect(await basket.navPerShare()).to.equal(
      ethers.parseUnits('1', await f.settlement.decimals()),
    );
  });

  it('keeps that value across the first deposit', async () => {
    const f = await loadFixture(standardFixture);
    const basket = await createBasket(f);
    const basketAddress = await basket.getAddress();

    const before = await basket.navPerShare();

    await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
    await (
      await basket
        .connect(f.signers.alice)
        .deposit(ethers.parseUnits('1000', 18), 0, await futureDeadline())
    ).wait();

    // Deployment rounds the minted shares down by at most one wei, so the NAV
    // may move by a wei; what it must not do is change by a factor.
    const after = await basket.navPerShare();
    const tolerance = before / 1_000_000n;
    expect(after).to.be.closeTo(before, tolerance);
  });

  it('holds the same convention with a 6-decimal settlement token', async () => {
    const f = await loadFixture(sixDecimalSettlementFixture);
    const basket = await createBasket(f);
    const basketAddress = await basket.getAddress();
    const scale = 10n ** 6n;

    expect(await basket.navPerShare()).to.equal(scale);

    await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
    await (
      await basket
        .connect(f.signers.alice)
        .deposit(ethers.parseUnits('1000', 6), 0, await futureDeadline())
    ).wait();

    const after = await basket.navPerShare();
    expect(after).to.be.closeTo(scale, scale / 1_000_000n);
  });
});
