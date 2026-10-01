import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import {
  createBasket,
  fundSettlement,
  futureDeadline,
  mixedDecimalFixture,
  oversizedDecimalsFixture,
  standardFixture,
  wideFixture,
} from './fixtures';

/**
 * Basket creation.
 *
 * The composition a basket is created with is the only thing standing between a
 * depositor and a basket that cannot be valued or exited, so every malformed
 * shape is rejected at creation rather than discovered inside a user's deposit.
 */
describe('BasketFactory — creation', () => {
  describe('composition validation', () => {
    it('creates a basket and records its composition', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);

      expect(await basket.name()).to.equal('Test Basket');
      expect(await basket.symbol()).to.equal('TST');
      expect(await basket.componentCount()).to.equal(3);

      const [components, weights] = await basket.getComposition();
      expect(components).to.deep.equal(await Promise.all(f.components.map((c) => c.getAddress())));
      expect(weights.map(Number)).to.deep.equal(f.weights);
      expect(weights.reduce((sum: number, w: bigint) => sum + Number(w), 0)).to.equal(10_000);
    });

    it('rejects an empty composition', async () => {
      const f = await loadFixture(standardFixture);
      await expect(createBasket(f, { components: [], weights: [] })).to.be.revertedWithCustomError(
        f.factory,
        'NoComponents',
      );
    });

    it('rejects a component and weight length mismatch', async () => {
      const f = await loadFixture(standardFixture);
      const addresses = await Promise.all(f.components.map((c) => c.getAddress()));
      await expect(
        createBasket(f, { components: addresses, weights: [5_000, 5_000] }),
      ).to.be.revertedWithCustomError(f.factory, 'WeightLengthMismatch');
    });

    it('rejects weights that do not sum to 10 000 basis points', async () => {
      const f = await loadFixture(standardFixture);
      await expect(
        createBasket(f, { weights: [4_000, 4_000, 1_000] }),
      ).to.be.revertedWithCustomError(f.factory, 'InvalidWeightTotal');
    });

    it('rejects a zero weight', async () => {
      const f = await loadFixture(standardFixture);
      await expect(createBasket(f, { weights: [6_000, 4_000, 0] })).to.be.revertedWithCustomError(
        f.factory,
        'ZeroWeight',
      );
    });

    it('rejects the zero address as a component', async () => {
      const f = await loadFixture(standardFixture);
      const addresses = await Promise.all(f.components.map((c) => c.getAddress()));
      await expect(
        createBasket(f, { components: [addresses[0], ethers.ZeroAddress, addresses[2]] }),
      ).to.be.revertedWithCustomError(f.factory, 'ZeroComponentAddress');
    });

    it('rejects a repeated component', async () => {
      const f = await loadFixture(standardFixture);
      const addresses = await Promise.all(f.components.map((c) => c.getAddress()));
      await expect(
        createBasket(f, { components: [addresses[0], addresses[1], addresses[0]] }),
      ).to.be.revertedWithCustomError(f.factory, 'DuplicateComponent');
    });

    it('rejects more components than the cap allows', async () => {
      const f = await loadFixture(standardFixture);
      const many = Array.from({ length: 11 }, () => ethers.Wallet.createRandom().address);
      await expect(
        createBasket(f, {
          components: many,
          weights: Array.from({ length: 11 }, () => 909),
        }),
      ).to.be.revertedWithCustomError(f.factory, 'TooManyComponents');
    });

    it('accepts exactly the maximum number of components', async () => {
      const wide = await loadFixture(wideFixture);
      const basket = await createBasket(wide);
      expect(await basket.componentCount()).to.equal(10);
    });

    it('rejects the settlement token as a component', async () => {
      const f = await loadFixture(standardFixture);
      const addresses = await Promise.all(f.components.map((c) => c.getAddress()));
      await expect(
        createBasket(f, {
          components: [addresses[0], addresses[1], await f.settlement.getAddress()],
        }),
      ).to.be.revertedWithCustomError(f.factory, 'SettlementTokenIsComponent');
    });

    it('rejects a component that is not an ERC-20 with decimals', async () => {
      const f = await loadFixture(standardFixture);
      const addresses = await Promise.all(f.components.map((c) => c.getAddress()));
      // The factory itself has code but exposes no decimals(), the same shape a
      // proxy or a non-token contract presents.
      await expect(
        createBasket(f, {
          components: [addresses[0], addresses[1], await f.factory.getAddress()],
        }),
      ).to.be.revertedWithCustomError(f.factory, 'ComponentNotERC20Metadata');
    });

    it('rejects an empty name', async () => {
      const f = await loadFixture(standardFixture);
      await expect(createBasket(f, { name: '' })).to.be.revertedWithCustomError(
        f.factory,
        'InvalidName',
      );
    });
  });

  describe('mixed component decimals', () => {
    it('values a basket whose components do not share a decimal count', async () => {
      const f = await loadFixture(mixedDecimalFixture);

      const basket = await createBasket(f);
      expect(await basket.decimalsAt(0)).to.equal(18);
      expect(await basket.decimalsAt(1)).to.equal(8);
      expect(await basket.decimalsAt(2)).to.equal(6);

      const amount = await fundSettlement(f, f.signers.alice, 1_000, await basket.getAddress());
      await basket.connect(f.signers.alice).deposit(amount, 0, await futureDeadline());

      // 1 000 settlement in, less the 0.5% fee and roughly 0.4% of AMM cost.
      const assets = await basket.totalAssets();
      expect(assets).to.be.greaterThan(ethers.parseUnits('985', 18));
      expect(assets).to.be.lessThan(ethers.parseUnits('995', 18));
    });

    it('caps decimals at 36', async () => {
      const f = await loadFixture(oversizedDecimalsFixture);
      await expect(createBasket(f)).to.be.revertedWithCustomError(
        f.factory,
        'ComponentDecimalsTooHigh',
      );
    });
  });

  describe('registry', () => {
    it('enumerates every basket in creation order', async () => {
      const f = await loadFixture(standardFixture);
      const first = await createBasket(f, { name: 'First', symbol: 'FST' });
      const second = await createBasket(f, { name: 'Second', symbol: 'SND' });

      expect(await f.factory.basketCount()).to.equal(2);
      expect(await f.factory.basketAt(0)).to.equal(await first.getAddress());
      expect(await f.factory.basketAt(1)).to.equal(await second.getAddress());
      expect(await f.factory.allBaskets()).to.deep.equal([
        await first.getAddress(),
        await second.getAddress(),
      ]);
    });

    it('reports which addresses it deployed', async () => {
      const f = await loadFixture(standardFixture);
      const basket = await createBasket(f);
      expect(await f.factory.isBasket(await basket.getAddress())).to.equal(true);
      expect(await f.factory.isBasket(f.signers.alice.address)).to.equal(false);
    });

    it('tracks baskets per creator', async () => {
      const f = await loadFixture(standardFixture);
      const mine = await createBasket(f, { creator: f.signers.creator.address });
      const theirs = await createBasket(f, { creator: f.signers.alice.address });

      expect(await f.factory.basketsByCreator(f.signers.creator.address)).to.deep.equal([
        await mine.getAddress(),
      ]);
      expect(await f.factory.basketsByCreator(f.signers.alice.address)).to.deep.equal([
        await theirs.getAddress(),
      ]);
      expect(await f.factory.basketsByCreator(f.signers.bob.address)).to.deep.equal([]);
    });

    it('emits the full composition on creation', async () => {
      const f = await loadFixture(standardFixture);
      const addresses = await Promise.all(f.components.map((c) => c.getAddress()));
      const tx = await f.factory.createBasket({
        name: 'Evented',
        symbol: 'EVT',
        description: 'Checks the event.',
        theme: 'Testing',
        components: addresses,
        weightsBps: f.weights,
        creator: f.signers.creator.address,
        depositFeeBps: 50,
        redeemFeeBps: 0,
        creatorShareBps: 8_000,
        maxSlippageBps: 300,
      });
      const receipt = await tx.wait();
      const parsed = receipt!.logs
        .map((log) => {
          try {
            return f.factory.interface.parseLog({ topics: [...log.topics], data: log.data });
          } catch {
            return null;
          }
        })
        .find((log) => log?.name === 'BasketCreated');

      expect(parsed).to.not.equal(undefined);
      expect(parsed!.args.name).to.equal('Evented');
      expect(parsed!.args.symbol).to.equal('EVT');
      expect(parsed!.args.creator).to.equal(f.signers.creator.address);
      expect(parsed!.args.components).to.deep.equal(addresses);
      expect(parsed!.args.weightsBps.map(Number)).to.deep.equal(f.weights);
    });
  });
});

// ---------------------------------------------------------------------------
