import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { createBasket, fundSettlement, futureDeadline, standardFixture } from './fixtures';

/**
 * Access control.
 *
 * Who can do what, and — more importantly — what nobody can do. Two claims carry
 * the security of the product and are asserted here directly:
 *
 *   1. A basket's economics are frozen when it is created. No role can raise a
 *      fee, change the composition, or re-point a live basket at a different
 *      price provider.
 *   2. The protocol admin's powers are a pause button and a claim on the
 *      protocol's own fee share. Nothing else.
 */
describe('Access control', () => {
  describe('basket administration', () => {
    it('lets only the protocol admin pause', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);

      for (const signer of [
        f.signers.alice,
        f.signers.creator,
        f.signers.treasury,
        f.signers.stranger,
      ]) {
        await expect(basket.connect(signer).pause()).to.be.revertedWithCustomError(
          basket,
          'NotProtocolAdmin',
        );
      }

      await expect(basket.connect(f.signers.protocolAdmin).pause()).to.not.be.reverted;
      expect(await basket.paused()).to.equal(true);
    });

    it('lets only the protocol admin unpause', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      await basket.connect(f.signers.protocolAdmin).pause();

      for (const signer of [f.signers.alice, f.signers.creator, f.signers.stranger]) {
        await expect(basket.connect(signer).unpause()).to.be.revertedWithCustomError(
          basket,
          'NotProtocolAdmin',
        );
      }

      await expect(basket.connect(f.signers.protocolAdmin).unpause()).to.not.be.reverted;
      expect(await basket.paused()).to.equal(false);
    });

    it('gives the protocol admin no way to move holder assets', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      // The admin's only withdrawal is the protocol fee, which is empty here.
      await expect(
        basket
          .connect(f.signers.protocolAdmin)
          .withdrawProtocolFees(f.signers.protocolAdmin.address),
      ).to.not.be.reverted;

      // The basket still holds every component, and the holder still owns them.
      expect(await basket.totalAssets()).to.equal(await basket.totalSupply());
      expect(await basket.balanceOf(f.signers.alice.address)).to.equal(await basket.totalSupply());
    });

    it('exposes no setter for composition, fees or infrastructure', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);

      const setters = basket.interface.fragments
        .filter((fragment) => fragment.type === 'function')
        .map((fragment) => fragment.name)
        // `setX`, not `settlementDecimals`. The capital is what distinguishes a
        // setter from a state getter that merely starts with the same letters.
        .filter((name) => /^set[A-Z]/.test(name));

      // A live basket has no configuration surface at all. If this list is ever
      // non-empty, a basket can be changed after people have put money in it.
      expect(setters).to.deep.equal([]);
    });

    it('cannot be re-pointed at another price provider or venue', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const provider = await basket.priceProvider();
      const adapter = await basket.dexAdapter();

      // The factory can be migrated, but the live basket keeps what it was born
      // with — the property that makes "your basket cannot be repriced" true.
      const otherProvider = await (
        await ethers.getContractFactory('MockPriceProvider')
      ).deploy(f.signers.deployer.address);
      await otherProvider.waitForDeployment();

      await f.factory
        .connect(f.signers.protocolAdmin)
        .setInfrastructure(await otherProvider.getAddress(), adapter);

      expect(await basket.priceProvider()).to.equal(provider);
      expect(await basket.priceProvider()).to.not.equal(await otherProvider.getAddress());

      // And the basket still values correctly against the provider it kept.
      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      expect(await basket.balanceOf(f.signers.alice.address)).to.be.greaterThan(0);
    });
  });

  describe('factory administration', () => {
    it('lets only the protocol admin change the ceilings', async () => {
      const f = await loadFixture(standardFixture);

      for (const signer of [f.signers.alice, f.signers.creator, f.signers.stranger]) {
        await expect(
          f.factory.connect(signer).setCreationLimits(100, 100, 9_000, 500),
        ).to.be.revertedWithCustomError(f.factory, 'NotProtocolAdmin');
      }

      await expect(
        f.factory.connect(f.signers.protocolAdmin).setCreationLimits(100, 100, 9_000, 500),
      ).to.not.be.reverted;
      expect(await f.factory.maxDepositFeeBps()).to.equal(100);
    });

    it('refuses to raise a ceiling above the hard cap', async () => {
      const f = await loadFixture(standardFixture);

      // 2% is the absolute maximum a basket will accept for a deposit fee.
      await expect(
        f.factory.connect(f.signers.protocolAdmin).setCreationLimits(201, 200, 9_000, 1_000),
      ).to.be.revertedWithCustomError(f.factory, 'FeeTooHigh');
    });

    it('gates every other admin function on the same role', async () => {
      const f = await loadFixture(standardFixture);
      const outsider = f.factory.connect(f.signers.alice);
      const component = await f.components[0].getAddress();

      await expect(outsider.setDefaultFees([10, 10, 5_000, 100])).to.be.revertedWithCustomError(
        f.factory,
        'NotProtocolAdmin',
      );
      await expect(
        outsider.setInfrastructure(
          await f.priceProvider.getAddress(),
          await f.adapter.getAddress(),
        ),
      ).to.be.revertedWithCustomError(f.factory, 'NotProtocolAdmin');
      await expect(
        outsider.setProtocolTreasury(f.signers.alice.address),
      ).to.be.revertedWithCustomError(f.factory, 'NotProtocolAdmin');
      await expect(outsider.setComponentAllowed(component, true)).to.be.revertedWithCustomError(
        f.factory,
        'NotProtocolAdmin',
      );
      await expect(outsider.setAllowlistEnforced(true)).to.be.revertedWithCustomError(
        f.factory,
        'NotProtocolAdmin',
      );
    });

    it('leaves an existing basket untouched when the rules change', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const feeBefore = await basket.depositFeeBps();
      const shareBefore = await basket.creatorShareBps();
      const compositionBefore = await basket.getComposition();

      // Tighten everything the admin can tighten, and change the treasury.
      await f.factory.connect(f.signers.protocolAdmin).setCreationLimits(10, 0, 1_000, 10);
      await f.factory.connect(f.signers.protocolAdmin).setDefaultFees([10, 0, 1_000, 10]);
      await f.factory
        .connect(f.signers.protocolAdmin)
        .setProtocolTreasury(f.signers.stranger.address);

      expect(await basket.depositFeeBps()).to.equal(feeBefore);
      expect(await basket.creatorShareBps()).to.equal(shareBefore);

      const compositionAfter = await basket.getComposition();
      expect([...compositionAfter.components]).to.deep.equal([...compositionBefore.components]);
      expect([...compositionAfter.weightsBps].map(Number)).to.deep.equal(
        [...compositionBefore.weightsBps].map(Number),
      );
      // The treasury a basket pays is the one it was created with, too.
      expect(await basket.protocolTreasury()).to.equal(f.signers.treasury.address);

      // And it still takes the fee it was created with, not the new default.
      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      expect(await basket.accruedCreatorFees()).to.equal(ethers.parseUnits('4', 18));
    });

    it('enforces the ceilings on baskets created after a change', async () => {
      const f = await loadFixture(standardFixture);
      // Post limits strictly below the fixture's defaults on all four axes, so a
      // basket built from those defaults is now out of bounds.
      await f.factory.connect(f.signers.protocolAdmin).setCreationLimits(10, 0, 5_000, 100);

      await expect(createBasket(f)).to.be.revertedWithCustomError(f.factory, 'FeeTooHigh');

      // Each axis is checked independently, not just the first one that trips.
      await expect(
        createBasket(f, { depositFeeBps: 50, maxSlippageBps: 100 }),
      ).to.be.revertedWithCustomError(f.factory, 'FeeTooHigh');
      await expect(
        createBasket(f, { depositFeeBps: 10, redeemFeeBps: 50, maxSlippageBps: 100 }),
      ).to.be.revertedWithCustomError(f.factory, 'FeeTooHigh');
      await expect(
        createBasket(f, { depositFeeBps: 10, redeemFeeBps: 0, creatorShareBps: 5_001 }),
      ).to.be.revertedWithCustomError(f.factory, 'FeeTooHigh');
      await expect(
        createBasket(f, {
          depositFeeBps: 10,
          redeemFeeBps: 0,
          creatorShareBps: 5_000,
          maxSlippageBps: 101,
        }),
      ).to.be.revertedWithCustomError(f.factory, 'FeeTooHigh');

      // And a basket inside all four limits still goes through.
      await expect(
        createBasket(f, {
          depositFeeBps: 10,
          redeemFeeBps: 0,
          creatorShareBps: 5_000,
          maxSlippageBps: 100,
        }),
      ).to.not.be.reverted;
    });

    it('lets the admin restrict which components new baskets may hold', async () => {
      const f = await loadFixture(standardFixture);
      const allowed = await f.components[0].getAddress();

      await f.factory.connect(f.signers.protocolAdmin).setComponentAllowed(allowed, true);
      await f.factory.connect(f.signers.protocolAdmin).setAllowlistEnforced(true);

      // A basket using only allowlisted components is fine.
      await expect(createBasket(f, { components: [allowed], weights: [10_000] })).to.not.be
        .reverted;

      // One using anything else is refused, naming the component.
      await expect(createBasket(f)).to.be.revertedWithCustomError(f.factory, 'ComponentNotAllowed');
    });

    it('does not retroactively invalidate a basket created before enforcement', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      await f.factory.connect(f.signers.protocolAdmin).setAllowlistEnforced(true);

      // The basket was legal when it was made and stays usable.
      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      expect(await basket.balanceOf(f.signers.alice.address)).to.be.greaterThan(0);
    });
  });

  describe('permissionless use', () => {
    it('lets anyone deposit and redeem', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      // No allowlist, no roles, no governance gate on the user flows.
      for (const signer of [f.signers.stranger, f.signers.treasury, f.signers.protocolAdmin]) {
        const amount = await fundSettlement(f, signer, 100, basketAddress);
        await basket.connect(signer).deposit(amount, 0, await futureDeadline());
        const shares = await basket.balanceOf(signer.address);
        expect(shares).to.be.greaterThan(0);

        await basket.connect(signer).redeem(shares, 0, await futureDeadline());
        expect(await basket.balanceOf(signer.address)).to.equal(0);
      }
    });

    it('lets a holder transfer basket tokens freely', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const shares = await basket.balanceOf(f.signers.alice.address);
      await basket.connect(f.signers.alice).transfer(f.signers.bob.address, shares);

      expect(await basket.balanceOf(f.signers.bob.address)).to.equal(shares);
      // Whoever holds the token holds the claim: Bob can now redeem it.
      await expect(basket.connect(f.signers.bob).redeem(shares, 0, await futureDeadline())).to.not
        .be.reverted;
    });

    it('does not let a paused basket block transfers', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      const shares = await basket.balanceOf(f.signers.alice.address);

      await basket.connect(f.signers.protocolAdmin).pause();

      // The pause stops value entering and leaving through the contract; it does
      // not confiscate tokens or freeze secondary transfer. Holders keep custody.
      await expect(basket.connect(f.signers.alice).transfer(f.signers.bob.address, shares)).to.not
        .be.reverted;
      expect(await basket.balanceOf(f.signers.bob.address)).to.equal(shares);
      expect(await basket.totalSupply()).to.equal(shares);
    });
  });
});
