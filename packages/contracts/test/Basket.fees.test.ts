import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import {
  callbackSettlementFixture,
  createBasket,
  fundSettlement,
  futureDeadline,
  standardFixture,
} from './fixtures';

/**
 * Fees.
 *
 * A basket's fees are a liability, not revenue recognised on arrival. They sit in
 * the same settlement token as holder assets, so the whole design problem is
 * keeping the two apart: what holders own must exclude them, only the addresses
 * entitled to them may move them, and neither can reach the other's.
 */
describe('ThematicBasket — fees', () => {
  describe('accrual', () => {
    it('accumulates across deposits and redemptions', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f, { depositFeeBps: 100, redeemFeeBps: 100 });
      const basketAddress = await basket.getAddress();

      const aliceAmount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(aliceAmount, 0, await futureDeadline());
      const afterDeposit = await basket.accruedCreatorFees();

      const bobAmount = await fundSettlement(f, f.signers.bob, 1_000, basketAddress);
      await basket.connect(f.signers.bob).deposit(bobAmount, 0, await futureDeadline());
      const afterSecondDeposit = await basket.accruedCreatorFees();

      await basket
        .connect(f.signers.alice)
        .redeem(await basket.balanceOf(f.signers.alice.address), 0, await futureDeadline());
      const afterRedeem = await basket.accruedCreatorFees();

      // 1% of 1 000, then 1% of the next 1 000, then the creator's share of the
      // redemption fee on top.
      expect(afterDeposit).to.equal(ethers.parseUnits('8', 18));
      expect(afterSecondDeposit).to.equal(ethers.parseUnits('16', 18));
      expect(afterRedeem).to.be.greaterThan(afterSecondDeposit);
    });

    it('never counts accrued fees as holder assets', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const assets = await basket.totalAssets();
      const supply = await basket.totalSupply();
      const fees = (await basket.accruedCreatorFees()) + (await basket.accruedProtocolFees());

      // If the fee leaked into holder assets, NAV per share would read above 1.
      expect(assets).to.equal(supply);
      expect(await basket.navPerShare()).to.equal(ethers.parseUnits('1', 18));
      expect(fees).to.equal(ethers.parseUnits('5', 18));
    });

    it('treats a direct transfer into the basket as holder value', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const navBefore = await basket.navPerShare();

      // Someone sends settlement to the basket without asking for shares. It is
      // not a fee, so it belongs to the holders — and NAV per share shows it.
      await (
        await f.settlement.mint(f.signers.stranger.address, ethers.parseUnits('10', 18))
      ).wait();
      await (
        await f.settlement
          .connect(f.signers.stranger)
          .transfer(basketAddress, ethers.parseUnits('10', 18))
      ).wait();

      expect(await basket.freeSettlementBalance()).to.equal(ethers.parseUnits('10', 18));
      expect(await basket.navPerShare()).to.be.greaterThan(navBefore);
    });
  });

  describe('creator claims', () => {
    it('pays the creator exactly what was accrued', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const accrued = await basket.accruedCreatorFees();
      const before = await f.settlement.balanceOf(f.signers.creator.address);

      await expect(basket.connect(f.signers.creator).claimCreatorFees())
        .to.emit(basket, 'CreatorFeesClaimed')
        .withArgs(f.signers.creator.address, accrued);

      expect(await f.settlement.balanceOf(f.signers.creator.address)).to.equal(before + accrued);
      expect(await basket.accruedCreatorFees()).to.equal(0);
      // The protocol's share is untouched by the creator's claim.
      expect(await basket.accruedProtocolFees()).to.equal(ethers.parseUnits('1', 18));
    });

    it('reverts when there is nothing to claim', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      await expect(
        basket.connect(f.signers.creator).claimCreatorFees(),
      ).to.be.revertedWithCustomError(basket, 'NothingToClaim');
    });

    it('reverts when the creator claims twice', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      await basket.connect(f.signers.creator).claimCreatorFees();
      await expect(
        basket.connect(f.signers.creator).claimCreatorFees(),
      ).to.be.revertedWithCustomError(basket, 'NothingToClaim');
    });

    it('cannot be claimed by anyone else', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      // Not the protocol admin, not a holder, not the treasury.
      for (const signer of [f.signers.alice, f.signers.protocolAdmin, f.signers.treasury]) {
        await expect(basket.connect(signer).claimCreatorFees()).to.be.revertedWithCustomError(
          basket,
          'NotCreator',
        );
      }
    });

    it('cannot reach the protocol’s share', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      await basket.connect(f.signers.creator).claimCreatorFees();

      // The creator's own share is gone; the protocol's is still there and the
      // basket still owes it.
      expect(await basket.accruedProtocolFees()).to.equal(ethers.parseUnits('1', 18));
      expect(await f.settlement.balanceOf(basketAddress)).to.equal(ethers.parseUnits('1', 18));
    });

    it('leaves holder assets alone', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const assetsBefore = await basket.totalAssets();
      await basket.connect(f.signers.creator).claimCreatorFees();

      // Paying the creator moves settlement that was never in `totalAssets`.
      expect(await basket.totalAssets()).to.equal(assetsBefore);
      expect(await basket.navPerShare()).to.equal(ethers.parseUnits('1', 18));
    });

    it('works while the basket is paused', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      await basket.connect(f.signers.protocolAdmin).pause();

      // Pausing halts user flows; it is not a way to withhold revenue already
      // earned. Neither side's claim is affected.
      await expect(basket.connect(f.signers.creator).claimCreatorFees()).to.not.be.reverted;
      await expect(
        basket.connect(f.signers.protocolAdmin).withdrawProtocolFees(f.signers.treasury.address),
      ).to.not.be.reverted;
    });
  });

  describe('protocol withdrawals', () => {
    it('sends the protocol share to the address the admin names', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const accrued = await basket.accruedProtocolFees();
      await expect(
        basket.connect(f.signers.protocolAdmin).withdrawProtocolFees(f.signers.treasury.address),
      )
        .to.emit(basket, 'ProtocolFeesWithdrawn')
        .withArgs(f.signers.treasury.address, accrued);

      expect(await f.settlement.balanceOf(f.signers.treasury.address)).to.equal(accrued);
      expect(await basket.accruedProtocolFees()).to.equal(0);
    });

    it('leaves the creator’s share in place', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      await basket
        .connect(f.signers.protocolAdmin)
        .withdrawProtocolFees(f.signers.treasury.address);

      expect(await basket.accruedCreatorFees()).to.equal(ethers.parseUnits('4', 18));
      expect(await f.settlement.balanceOf(basketAddress)).to.equal(ethers.parseUnits('4', 18));
    });

    it('cannot be withdrawn by anyone else', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      for (const signer of [f.signers.alice, f.signers.creator, f.signers.treasury]) {
        await expect(
          basket.connect(signer).withdrawProtocolFees(f.signers.treasury.address),
        ).to.be.revertedWithCustomError(basket, 'NotProtocolAdmin');
      }
    });

    it('reverts when there is nothing to withdraw', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f, { depositFeeBps: 0 });
      await expect(
        basket.connect(f.signers.protocolAdmin).withdrawProtocolFees(f.signers.treasury.address),
      ).to.be.revertedWithCustomError(basket, 'NothingToClaim');
    });

    it('refuses to send the funds nowhere', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      await expect(
        basket.connect(f.signers.protocolAdmin).withdrawProtocolFees(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(basket, 'ZeroAddress');
    });

    it('cannot reach holder assets or creator fees', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      await basket
        .connect(f.signers.protocolAdmin)
        .withdrawProtocolFees(f.signers.treasury.address);

      // The admin's claim is capped at `accruedProtocolFees`: a second attempt
      // finds nothing, and the components are exactly where they were.
      await expect(
        basket.connect(f.signers.protocolAdmin).withdrawProtocolFees(f.signers.treasury.address),
      ).to.be.revertedWithCustomError(basket, 'NothingToClaim');

      const assets = await basket.totalAssets();
      expect(assets).to.equal(await basket.totalSupply());
      expect(await basket.accruedCreatorFees()).to.equal(ethers.parseUnits('4', 18));
      expect(await f.settlement.balanceOf(basketAddress)).to.equal(ethers.parseUnits('4', 18));
    });
  });

  describe('reentrancy', () => {
    it('rejects a reentrant creator claim entered from the payout transfer', async () => {
      const f = await loadFixture(callbackSettlementFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const malicious = await ethers.getContractAt(
        'MockCallbackERC20',
        await f.settlement.getAddress(),
      );
      const accrued = await basket.accruedCreatorFees();

      // The settlement token re-enters the claim while the creator's payout is
      // in flight, i.e. after the liability was zeroed.
      await (
        await malicious.armCallback(
          basketAddress,
          basket.interface.encodeFunctionData('claimCreatorFees'),
        )
      ).wait();

      await expect(
        basket.connect(f.signers.creator).claimCreatorFees(),
      ).to.be.revertedWithCustomError(basket, 'ReentrancyGuardReentrantCall');

      // Untouched: the fee is still owed and still unclaimed.
      expect(await basket.accruedCreatorFees()).to.equal(accrued);
      expect(await f.settlement.balanceOf(f.signers.creator.address)).to.equal(0);
    });

    it('rejects a reentrant protocol withdrawal entered from the payout transfer', async () => {
      const f = await loadFixture(callbackSettlementFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const malicious = await ethers.getContractAt(
        'MockCallbackERC20',
        await f.settlement.getAddress(),
      );
      const treasury = f.signers.treasury.address;

      await (
        await malicious.armCallback(
          basketAddress,
          basket.interface.encodeFunctionData('withdrawProtocolFees', [treasury]),
        )
      ).wait();

      await expect(
        basket.connect(f.signers.protocolAdmin).withdrawProtocolFees(treasury),
      ).to.be.revertedWithCustomError(basket, 'ReentrancyGuardReentrantCall');

      expect(await basket.accruedProtocolFees()).to.equal(ethers.parseUnits('0.1', 18));
      expect(await f.settlement.balanceOf(treasury)).to.equal(0);
    });
  });
});
