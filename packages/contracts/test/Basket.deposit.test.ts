import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import {
  callbackSettlementFixture,
  createBasket,
  feeOnTransferFixture,
  fundSettlement,
  futureDeadline,
  noLiquidityFixture,
  pastDeadline,
  shortchangingAdapterFixture,
  standardFixture,
  thinLiquidityFixture,
} from './fixtures';

const THOUSAND = ethers.parseUnits('1000', 18);
const ONE_WEI = 1n;

/**
 * Deposits.
 *
 * The properties that matter: shares are minted against value the basket
 * actually received, fees are accounted as a liability rather than as holder
 * value, and a deposit cannot land at a price the depositor did not accept.
 */
describe('ThematicBasket — deposit', () => {
  describe('minting', () => {
    it('mints shares against the value actually bought, not the amount sent', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());

      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const shares = await basket.balanceOf(f.signers.alice.address);
      // 1 000 in, less the 0.5% deposit fee and the AMM's own 0.3% plus price
      // impact, and the remainder is what the basket's holdings are worth.
      expect(shares).to.be.closeTo(ethers.parseUnits('991.62', 18), ethers.parseUnits('0.1', 18));
      // And strictly less than the amount invested after fees: the depositor pays
      // their own execution costs rather than passing them to existing holders.
      expect(shares).to.be.lessThan(ethers.parseUnits('995', 18));
    });

    it('launches at one settlement unit per basket token', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());

      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      // Shares were minted at exactly the value received, so NAV per share is
      // 1.0 by construction — 1e18 in settlement smallest units. It is also what
      // proves the accrued fee is excluded: including it would read above 1e18.
      expect(await basket.navPerShare()).to.equal(ethers.parseUnits('1', 18));
    });

    it('buys every component in proportion to its weight', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);

      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const total = await basket.totalAssets();
      const balances = await Promise.all(f.components.map((c) => c.balanceOf(basketAddress)));
      balances.forEach((balance) => expect(balance).to.be.greaterThan(0));

      for (let i = 0; i < balances.length; i += 1) {
        const value = (balances[i] * ethers.parseUnits(String(f.specs[i].price), 18)) / 10n ** 18n;
        // The oracle value of each leg, as a fraction of the basket.
        const share = Number((value * 10_000n) / total) / 10_000;
        expect(share).to.be.closeTo(f.weights[i] / 10_000, 0.001);
      }
    });

    it('leaves no settlement sitting idle after a deposit', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());

      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      // Everything except the fee was swapped into components, and the fee is a
      // liability rather than free assets.
      expect(await basket.freeSettlementBalance()).to.equal(0);
      expect(await f.settlement.balanceOf(await basket.getAddress())).to.equal(
        (await basket.accruedCreatorFees()) + (await basket.accruedProtocolFees()),
      );
    });

    it('prices a second deposit pro-rata against the first', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const first = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(first, 0, await futureDeadline());
      const sharesAfterFirst = await basket.balanceOf(f.signers.alice.address);

      const second = await fundSettlement(f, f.signers.bob, 1_000, basketAddress);
      await basket.connect(f.signers.bob).deposit(second, 0, await futureDeadline());
      const sharesAfterSecond = await basket.balanceOf(f.signers.bob.address);

      // Equal deposits into a basket whose holdings have not moved should mint
      // equal shares, give or take the second deposit's own price impact.
      expect(sharesAfterSecond).to.be.closeTo(sharesAfterFirst, ethers.parseUnits('1', 18));
    });

    it('does not change the NAV of existing holders', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      const first = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);
      await basket.connect(f.signers.alice).deposit(first, 0, await futureDeadline());
      const navBefore = await basket.navPerShare();

      const second = await fundSettlement(f, f.signers.bob, 5_000, basketAddress);
      await basket.connect(f.signers.bob).deposit(second, 0, await futureDeadline());

      // A large second deposit pays its own AMM costs; it must not transfer value
      // to or from the holder who was already in. Shares are priced at the value
      // received, so this is invariant, not merely close.
      expect(await basket.navPerShare()).to.be.closeTo(
        navBefore,
        ethers.parseUnits('0.000001', 18),
      );
    });

    it('refuses a deposit too small to buy anything', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      // One smallest unit of settlement. The fee rounds to zero and the whole
      // amount lands on the last component, where it buys nothing at all.
      await (await f.settlement.mint(f.signers.alice.address, ONE_WEI)).wait();
      await (await f.settlement.connect(f.signers.alice).approve(basketAddress, ONE_WEI)).wait();

      await expect(
        basket.connect(f.signers.alice).deposit(ONE_WEI, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'DepositTooSmall');
    });

    it('reports the amount actually minted in its event', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());

      const receipt = await (
        await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline())
      ).wait();

      const deposited = (receipt?.logs ?? [])
        .map((log) => {
          try {
            return basket.interface.parseLog({ topics: [...log.topics], data: log.data });
          } catch {
            return null;
          }
        })
        .find((log) => log?.name === 'Deposit');

      expect(deposited, 'Deposit event not emitted').to.not.equal(undefined);
      expect(deposited!.args.account).to.equal(f.signers.alice.address);
      expect(deposited!.args.amountIn).to.equal(amount);
      // The fee is 0.5% of 1 000, and the event separates it from what was spent.
      expect(deposited!.args.netInvested).to.equal(amount - ethers.parseUnits('5', 18));
      // What the event claims is exactly what the holder can prove they hold.
      expect(deposited!.args.sharesOut).to.equal(await basket.balanceOf(f.signers.alice.address));
    });
  });

  describe('fees', () => {
    it('splits the deposit fee 80/20 between creator and protocol', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());

      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      // 0.5% of 1 000 is 5, split 80/20.
      expect(await basket.accruedCreatorFees()).to.equal(ethers.parseUnits('4', 18));
      expect(await basket.accruedProtocolFees()).to.equal(ethers.parseUnits('1', 18));
    });

    it('sums the two fee shares to the fee exactly, with no dust', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();

      // An amount chosen so the fee does not divide evenly.
      const amount = await fundSettlement(f, f.signers.alice, 1_337.77, basketAddress);
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const creator = await basket.accruedCreatorFees();
      const protocol = await basket.accruedProtocolFees();
      const expectedFee = (amount * 50n) / 10_000n;

      expect(creator + protocol).to.equal(expectedFee);
      expect(creator).to.equal((expectedFee * 8_000n) / 10_000n);
    });

    it('excludes accrued fees from the assets a holder owns', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());

      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const fees = (await basket.accruedCreatorFees()) + (await basket.accruedProtocolFees());
      const basketBalance = await f.settlement.balanceOf(await basket.getAddress());

      // The basket holds the fee but holders have no claim on it: `totalAssets`
      // is pure component value, and NAV per share is still exactly 1.
      expect(basketBalance).to.equal(fees);
      expect(await basket.freeSettlementBalance()).to.equal(0);
      expect(await basket.totalAssets()).to.equal(await basket.totalSupply());
    });

    it('accrues nothing when the basket charges no fee', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f, { depositFeeBps: 0 });
      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());

      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      expect(await basket.accruedCreatorFees()).to.equal(0);
      expect(await basket.accruedProtocolFees()).to.equal(0);
      expect(await f.settlement.balanceOf(await basket.getAddress())).to.equal(0);
    });

    it('leaves the protocol its minimum share at the creator ceiling', async () => {
      const f = await loadFixture(standardFixture);
      // 9 000 bps is the most a creator may keep; the protocol always retains 10%.
      const basket = await createBasket(f, { creatorShareBps: 9_000 });
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 1_337.77, basketAddress);

      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      const expectedFee = (amount * 50n) / 10_000n;
      const creator = await basket.accruedCreatorFees();
      const protocol = await basket.accruedProtocolFees();

      expect(creator).to.equal((expectedFee * 9_000n) / 10_000n);
      // The protocol's part is the remainder, so the two always sum exactly.
      expect(protocol).to.equal(expectedFee - creator);
      expect(protocol).to.be.greaterThan(0);
    });
  });

  describe('slippage and pricing protection', () => {
    it('reverts when the minted shares fall below the caller minimum', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 1_000, basketAddress);

      const [estimate] = await basket.previewDeposit(amount);
      // The preview prices at the oracle rate and ignores swap costs, so asking
      // for 5% more than it reports can never be filled.
      await expect(
        basket
          .connect(f.signers.alice)
          .deposit(amount, (estimate * 105n) / 100n, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'InsufficientSharesOut');
    });

    it('reverts when a swap cannot deliver within the basket tolerance', async () => {
      const f = await loadFixture(thinLiquidityFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      // A deposit that is large next to the pool, so price impact alone exceeds
      // the basket's 3% per-swap tolerance.
      const amount = await fundSettlement(f, f.signers.alice, 200, basketAddress);

      await expect(
        basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(f.adapter, 'InsufficientOutput');
    });

    it('accepts a deposit small enough to clear the tolerance', async () => {
      const f = await loadFixture(thinLiquidityFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 20, basketAddress);

      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      expect(await basket.balanceOf(f.signers.alice.address)).to.be.greaterThan(0);
    });

    it('refuses to mint against value it did not receive, even if the venue says it did', async () => {
      const f = await loadFixture(shortchangingAdapterFixture);
      const basket = await createBasket(f);
      const adapterAddress = await f.adapter.getAddress();
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);

      // Stock the venue with output tokens. It will pay out, just not enough:
      // half of the slippage floor it was handed, which is 48.5% of the value
      // the deposit is being priced against.
      const shortchanging = await ethers.getContractAt('MockShortchangingAdapter', adapterAddress);
      expect(await shortchanging.fillBps()).to.equal(5_000);
      for (const component of f.components) {
        await (await component.mint(adapterAddress, ethers.parseUnits('10', 18))).wait();
      }

      // The venue returns success. The basket's own check is what stops the
      // mint: the swaps delivered 46.08 of oracle value against a 95 investment,
      // below the 97% floor this basket was created with.
      await expect(
        basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'DepositSlippageExceeded');

      expect(await basket.totalSupply()).to.equal(0);
    });

    it('reverts when a component cannot be priced', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);

      await f.priceProvider.clearPrice(await f.components[1].getAddress());

      await expect(
        basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'ComponentNotPriceable');
    });

    it('reverts when a component has no market at all', async () => {
      const f = await loadFixture(noLiquidityFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 100, await basket.getAddress());

      await expect(
        basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(f.adapter, 'NoRoute');
    });
  });

  describe('input guards', () => {
    it('reverts on a zero deposit', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      await expect(
        basket.connect(f.signers.alice).deposit(0, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'ZeroAmount');
    });

    it('reverts past the deadline', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 100, await basket.getAddress());

      await expect(
        basket.connect(f.signers.alice).deposit(amount, 0, await pastDeadline()),
      ).to.be.revertedWithCustomError(basket, 'DeadlineExpired');
    });

    it('reverts without an allowance', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      await (await f.settlement.mint(f.signers.alice.address, THOUSAND)).wait();

      await expect(
        basket.connect(f.signers.alice).deposit(THOUSAND, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(f.settlement, 'ERC20InsufficientAllowance');
    });

    it('reverts when the caller lacks the balance', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      await (await f.settlement.connect(f.signers.alice).approve(basketAddress, THOUSAND)).wait();

      await expect(
        basket.connect(f.signers.alice).deposit(THOUSAND, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(f.settlement, 'ERC20InsufficientBalance');
    });

    it('rejects a settlement token that takes a cut of the transfer', async () => {
      const f = await loadFixture(feeOnTransferFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);

      const fee = await (
        await ethers.getContractAt('MockFeeOnTransferERC20', await f.settlement.getAddress())
      ).feeBps();
      const received = amount - (amount * fee) / 10_000n;

      // The basket receives less than it was asked for. Accounting at face value
      // would socialise the shortfall across every existing holder, so it refuses.
      await expect(basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline()))
        .to.be.revertedWithCustomError(basket, 'UnsupportedSettlementToken')
        .withArgs(amount, received);

      expect(await basket.totalSupply()).to.equal(0);
    });
  });

  describe('reentrancy', () => {
    it('rejects a reentrant deposit entered from a token transfer hook', async () => {
      const f = await loadFixture(callbackSettlementFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);

      const malicious = await ethers.getContractAt(
        'MockCallbackERC20',
        await f.settlement.getAddress(),
      );

      // The settlement token calls back into `deposit` while the outer deposit is
      // still running, i.e. after the guard is set and before any state settles.
      const deadline = await futureDeadline();
      await (
        await malicious.armCallback(
          basketAddress,
          basket.interface.encodeFunctionData('deposit', [amount, 0, deadline]),
        )
      ).wait();

      // The guard fires before any body code, so nothing can be minted against
      // half-updated state.
      await expect(
        basket.connect(f.signers.alice).deposit(amount, 0, deadline),
      ).to.be.revertedWithCustomError(basket, 'ReentrancyGuardReentrantCall');

      expect(await basket.totalSupply()).to.equal(0);
      expect(await f.settlement.balanceOf(basketAddress)).to.equal(0);
    });

    it('leaves the basket usable once the hook is disarmed', async () => {
      const f = await loadFixture(callbackSettlementFixture);
      const basket = await createBasket(f);
      const basketAddress = await basket.getAddress();
      const amount = await fundSettlement(f, f.signers.alice, 100, basketAddress);

      const malicious = await ethers.getContractAt(
        'MockCallbackERC20',
        await f.settlement.getAddress(),
      );
      await (await malicious.armCallback(basketAddress, '0x')).wait();
      await (await malicious.disarm()).wait();

      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      expect(await basket.balanceOf(f.signers.alice.address)).to.be.greaterThan(0);
    });
  });

  describe('pause', () => {
    it('blocks deposits while paused and allows them again afterwards', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      const amount = await fundSettlement(f, f.signers.alice, 100, await basket.getAddress());

      await basket.connect(f.signers.protocolAdmin).pause();

      await expect(
        basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline()),
      ).to.be.revertedWithCustomError(basket, 'EnforcedPause');

      await basket.connect(f.signers.protocolAdmin).unpause();
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());
      expect(await basket.balanceOf(f.signers.alice.address)).to.be.greaterThan(0);
    });
  });
});
