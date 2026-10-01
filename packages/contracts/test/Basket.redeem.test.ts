import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import type { Log } from 'ethers';
import {
  callbackSettlementFixture,
  createBasket,
  fundSettlement,
  futureDeadline,
  pastDeadline,
  shortchangingAdapterFixture,
  standardFixture,
} from './fixtures';
import type { ThematicBasket } from '../typechain-types';

/** Reads one of a contract's own events out of a receipt. */
function findEvent<T>(contract: ThematicBasket, logs: readonly Log[], name: string): T {
  for (const log of logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === name) return parsed.args as unknown as T;
    } catch {
      // Not one of ours.
    }
  }
  throw new Error(`${name} event not found in the receipt.`);
}

/**
 * Redemptions.
 *
 * The properties that matter: a holder can always get out, the payout reflects
 * what the basket actually holds rather than a notional NAV, exiting does not
 * take value from the holders who stay, and fees never become holder assets.
 */
describe('ThematicBasket — redeem', () => {
  describe('payout', () => {
    it('returns the proceeds of selling the holder’s own slice', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const shares = await basket.balanceOf(f.signers.alice.address);
      const before = await f.settlement.balanceOf(f.signers.alice.address);

      const receipt = await (
        await basket.connect(f.signers.alice).redeem(shares, 0, await futureDeadline())
      ).wait();

      const redeemed = findEvent<{ grossSettlement: bigint; netSettlement: bigint }>(
        basket,
        receipt!.logs,
        'Redeem',
      );

      // A round trip costs the 0.5% entry fee plus the AMM's 0.3% in each
      // direction — 995 × 0.997 × 0.997. Price impact largely cancels, because
      // the same pool is walked back down on the way out.
      expect(redeemed.netSettlement).to.be.closeTo(
        ethers.parseUnits('989.04', 18),
        ethers.parseUnits('0.1', 18),
      );
      expect(await f.settlement.balanceOf(f.signers.alice.address)).to.equal(
        before + redeemed.netSettlement,
      );
    });

    it('burns exactly the shares it was asked to burn', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const shares = await basket.balanceOf(f.signers.alice.address);
      const half = shares / 2n;

      await basket.connect(f.signers.alice).redeem(half, 0, await futureDeadline());

      expect(await basket.balanceOf(f.signers.alice.address)).to.equal(shares - half);
      expect(await basket.totalSupply()).to.equal(shares - half);
    });

    it('pays out a slice worth roughly half the basket', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const shares = await basket.balanceOf(f.signers.alice.address);

      const receipt = await (
        await basket.connect(f.signers.alice).redeem(shares / 2n, 0, await futureDeadline())
      ).wait();
      const redeemed = findEvent<{ netSettlement: bigint }>(basket, receipt!.logs, 'Redeem');

      const full = await basket.previewRedeem(shares);
      expect(redeemed.netSettlement).to.be.closeTo(full.gross / 2n, ethers.parseUnits('2', 18));
    });

    it('empties the component balances when the last holder leaves', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      await basket
        .connect(f.signers.alice)
        .redeem(await basket.balanceOf(f.signers.alice.address), 0, await futureDeadline());

      expect(await basket.totalSupply()).to.equal(0);
      for (const component of f.components) {
        expect(await component.balanceOf(basketAddress)).to.equal(0);
      }
      // Nothing left but the fees the basket is holding on someone's behalf.
      expect(await basket.totalAssets()).to.equal(0);
    });
  });

  describe('the fee-liability invariant', () => {
    it('leaves the basket holding exactly the fees it collected', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      await basket
        .connect(f.signers.alice)
        .redeem(await basket.balanceOf(f.signers.alice.address), 0, await futureDeadline());

      const fees = (await basket.accruedCreatorFees()) + (await basket.accruedProtocolFees());

      // The whole economic claim: after the only holder has left with everything
      // they are owed, what remains is exactly the fee, and none of it counts as
      // holder assets.
      expect(fees).to.equal(ethers.parseUnits('5', 18));
      expect(await f.settlement.balanceOf(basketAddress)).to.equal(fees);
      expect(await basket.freeSettlementBalance()).to.equal(0);
    });

    it('charges the redemption fee on the gross proceeds and splits it', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f, { depositFeeBps: 0, redeemFeeBps: 100 });
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const receipt = await (
        await basket
          .connect(f.signers.alice)
          .redeem(await basket.balanceOf(f.signers.alice.address), 0, await futureDeadline())
      ).wait();

      const redeemed = findEvent<{ grossSettlement: bigint; netSettlement: bigint }>(
        basket,
        receipt!.logs,
        'Redeem',
      );

      const gross = redeemed.grossSettlement;
      const fee = (gross * 100n) / 10_000n;
      const creator = await basket.accruedCreatorFees();
      const protocol = await basket.accruedProtocolFees();

      expect(redeemed.netSettlement).to.equal(gross - fee);
      expect(creator + protocol).to.equal(fee);
      expect(creator).to.equal((fee * 8_000n) / 10_000n);
      expect(fee).to.be.greaterThan(0);
    });
  });

  describe('exiting does not tax the holders who stay', () => {
    it('leaves NAV per share unchanged for the remaining holders', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const aliceAmount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(aliceAmount, 0, await futureDeadline());

      const bobAmount = await fundSettlement(f, f.signers.bob, 1_000, basketAddress);
      await basket.connect(f.signers.bob).deposit(bobAmount, 0, await futureDeadline());

      const navBefore = await basket.navPerShare();
      const aliceShares = await basket.balanceOf(f.signers.alice.address);

      await basket.connect(f.signers.alice).redeem(aliceShares, 0, await futureDeadline());

      // Alice sold her own pro-rata slice of every component, so what is left is
      // the same portfolio in the same proportions, held by fewer shares.
      expect(await basket.navPerShare()).to.be.closeTo(
        navBefore,
        ethers.parseUnits('0.000001', 18),
      );
    });

    it('pays two equal holders the same amount', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const aliceAmount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(aliceAmount, 0, await futureDeadline());
      const bobAmount = await fundSettlement(f, f.signers.bob, 1_000, basketAddress);
      await basket.connect(f.signers.bob).deposit(bobAmount, 0, await futureDeadline());

      const aliceReceipt = await (
        await basket
          .connect(f.signers.alice)
          .redeem(await basket.balanceOf(f.signers.alice.address), 0, await futureDeadline())
      ).wait();
      const bobReceipt = await (
        await basket
          .connect(f.signers.bob)
          .redeem(await basket.balanceOf(f.signers.bob.address), 0, await futureDeadline())
      ).wait();

      const aliceOut = findEvent<{ netSettlement: bigint }>(
        basket,
        aliceReceipt!.logs,
        'Redeem',
      ).netSettlement;
      const bobOut = findEvent<{ netSettlement: bigint }>(
        basket,
        bobReceipt!.logs,
        'Redeem',
      ).netSettlement;

      // Bob entered second and paid slightly more slippage, so his slice is
      // marginally smaller — but the two must not diverge meaningfully.
      expect(aliceOut).to.be.closeTo(bobOut, ethers.parseUnits('2', 18));
    });

    it('leaves the fees claimable after everyone has exited', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      await basket
        .connect(f.signers.alice)
        .redeem(await basket.balanceOf(f.signers.alice.address), 0, await futureDeadline());

      const creator = await basket.accruedCreatorFees();
      const protocol = await basket.accruedProtocolFees();

      await basket.connect(f.signers.creator).claimCreatorFees();
      await basket
        .connect(f.signers.protocolAdmin)
        .withdrawProtocolFees(f.signers.treasury.address);

      expect(await f.settlement.balanceOf(f.signers.creator.address)).to.equal(creator);
      expect(await f.settlement.balanceOf(f.signers.treasury.address)).to.equal(protocol);
      expect(await f.settlement.balanceOf(basketAddress)).to.equal(0);
      expect(await basket.freeSettlementBalance()).to.equal(0);
    });
  });

  describe('slippage and pricing protection', () => {
    it('previews optimistically, and the shortfall is the cost of exiting', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const shares = await basket.balanceOf(f.signers.alice.address);

      const preview = await basket.previewRedeem(shares);
      const receipt = await (
        await basket.connect(f.signers.alice).redeem(shares, 0, await futureDeadline())
      ).wait();
      const actual = findEvent<{ netSettlement: bigint }>(
        basket,
        receipt!.logs,
        'Redeem',
      ).netSettlement;

      // The preview values holdings at the oracle rate and ignores swap costs, so
      // it always reads high by at least the AMM fee. That gap is the reason the
      // UI must not present it as a quote.
      expect(preview.settlementOut).to.be.greaterThan(actual);
      expect(preview.settlementOut - actual).to.be.lessThan(ethers.parseUnits('4', 18));
    });

    it('reverts when the payout falls below the holder minimum', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const shares = await basket.balanceOf(f.signers.alice.address);

      const [quoted] = await basket.previewRedeem(shares);
      await expect(
        basket.connect(f.signers.alice).redeem(shares, quoted, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'RedemptionSlippageExceeded');
    });

    it('reverts when the venue under-delivers, even though it reports success', async () => {
      const f = await loadFixture(shortchangingAdapterFixture);
      const basket = await createBasket(f);
      const adapterAddress = await f.adapter.getAddress();
      const basketAddress = await basket.getAddress();

      const venue = await ethers.getContractAt('MockShortchangingAdapter', adapterAddress);

      // Fill the venue honestly to get in — it pays out its own inventory at the
      // floor it is handed, which is exactly the basket's tolerance.
      await (await venue.setFillBps(10_000)).wait();
      for (const component of f.components) {
        await (await component.mint(adapterAddress, ethers.parseUnits('10', 18))).wait();
      }

      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const shares = await basket.balanceOf(f.signers.alice.address);
      expect(shares).to.be.greaterThan(0);

      // Now the venue starts keeping half of every sale.
      await (await venue.setFillBps(5_000)).wait();
      await (await f.settlement.mint(adapterAddress, ethers.parseUnits('100', 18))).wait();

      const [quoted] = await basket.previewRedeem(shares);
      await expect(
        basket.connect(f.signers.alice).redeem(shares, quoted, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'RedemptionSlippageExceeded');

      // Nothing moved: the holder still owns every share, the basket still holds
      // the components, and the only settlement in the contract is the entry fee.
      expect(await basket.balanceOf(f.signers.alice.address)).to.equal(shares);
      expect(await basket.totalSupply()).to.equal(shares);
      expect(await f.settlement.balanceOf(basketAddress)).to.equal(
        (await basket.accruedCreatorFees()) + (await basket.accruedProtocolFees()),
      );
    });

    it('reverts when a component cannot be priced', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const shares = await basket.balanceOf(f.signers.alice.address);

      await f.priceProvider.clearPrice(await f.components[1].getAddress());

      await expect(
        basket.connect(f.signers.alice).redeem(shares, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'ComponentNotPriceable');
    });

    it('refuses to burn shares for nothing', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      // One wei of supply rounds to a zero slice of every component.
      await expect(
        basket.connect(f.signers.alice).redeem(1n, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'RedemptionYieldsNothing');
    });
  });

  describe('input guards', () => {
    it('reverts on zero shares', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      await expect(
        basket.connect(f.signers.alice).redeem(0, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'ZeroAmount');
    });

    it('reverts when redeeming more than the caller holds', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const shares = await basket.balanceOf(f.signers.alice.address);

      await expect(
        basket.connect(f.signers.bob).redeem(shares, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'InsufficientShares');
    });

    it('reverts past the deadline', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const shares = await basket.balanceOf(f.signers.alice.address);

      await expect(
        basket.connect(f.signers.alice).redeem(shares, 0, await pastDeadline()),
      ).to.be.revertedWithCustomError(basket, 'DeadlineExpired');
    });

    it('reverts while paused and resumes afterwards', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const shares = await basket.balanceOf(f.signers.alice.address);

      await basket.connect(f.signers.protocolAdmin).pause();
      await expect(
        basket.connect(f.signers.alice).redeem(shares, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'EnforcedPause');

      await basket.connect(f.signers.protocolAdmin).unpause();
      await basket.connect(f.signers.alice).redeem(shares, 0, await futureDeadline());
      expect(await basket.balanceOf(f.signers.alice.address)).to.equal(0);
    });
  });

  describe('reentrancy', () => {
    it('rejects a reentrant redemption entered from the payout transfer', async () => {
      const f = await loadFixture(callbackSettlementFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const shares = await basket.balanceOf(f.signers.alice.address);

      const malicious = await ethers.getContractAt(
        'MockCallbackERC20',
        await f.settlement.getAddress(),
      );

      // The settlement token re-enters `redeem` while the payout that would end
      // the outer redemption is in flight — after the burn, before the caller has
      // been paid, and with component balances already sold down.
      const deadline = await futureDeadline();
      await (
        await malicious.armCallback(
          basketAddress,
          basket.interface.encodeFunctionData('redeem', [shares, 0, deadline]),
        )
      ).wait();

      await expect(
        basket.connect(f.signers.alice).redeem(shares, 0, deadline),
      ).to.be.revertedWithCustomError(basket, 'ReentrancyGuardReentrantCall');

      // The whole transaction unwound: the holder still owns the position.
      expect(await basket.balanceOf(f.signers.alice.address)).to.equal(shares);
      expect(await basket.totalSupply()).to.equal(shares);
    });
  });
});
