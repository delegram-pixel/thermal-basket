# Economic model

How a Thematic basket turns a deposit into shares, what it charges on the way in
and out, and where that money goes. Every figure below is the implemented
behaviour of `packages/contracts/contracts/ThematicBasket.sol` and
`libraries/BasketMath.sol`, not a design intention.

Two conventions run through everything here.

**Basis points.** Every rate is an integer out of `BPS_DENOMINATOR = 10_000`.
50 bps is 0.5%, 8000 bps is 80%. The contracts never store a percentage and the
interface converts at exactly one boundary, so there is no place where a value
is 0.5 in one layer and 50 in the next.

**Integer arithmetic, rounded down.** All division goes through
`Math.mulDiv`, which floors. Rounding is not incidental — the sections below
name every place it lands and who it favours, because "rounds down" is a
different answer depending on whose balance you are rounding.

---

## 1. Basket creation

`BasketFactory.createBasket(CreateBasketParams)` deploys one `ThematicBasket`
and records it. The parameters are fixed at deployment and, with the two
exceptions noted in §5, cannot be changed afterwards. There is no rebalancing
and no fee update: the only way to change what a basket is or what it charges is
to deploy another basket.

| Parameter         | Bound                                         | Enforced by                      |
| ----------------- | --------------------------------------------- | -------------------------------- |
| `components`      | 1–10 (`MAX_COMPONENTS`)                       | `BasketMath.validateComposition` |
| `weightsBps`      | each non-zero, summing to exactly 10 000      | `validateComposition`            |
| `depositFeeBps`   | ≤ factory's live ceiling, itself ≤ 200 (2%)   | `FeeTooHigh`                     |
| `redeemFeeBps`    | ≤ factory's live ceiling, itself ≤ 200 (2%)   | `FeeTooHigh`                     |
| `creatorShareBps` | ≤ factory's live ceiling, itself ≤ 9000 (90%) | `FeeTooHigh`                     |
| `maxSlippageBps`  | ≤ factory's live ceiling, itself ≤ 1000 (10%) | `FeeTooHigh`                     |

Composition is validated before anything is deployed: length mismatch, an empty
list, more than ten components, a zero address, a zero weight, a repeated
component, or weights that do not sum to exactly 10 000 each revert with their
own error. The settlement token cannot be a component of its own basket. If the
factory enforces a component allowlist, every component must be on it.

The registry stores the basket address, a `isBasket` flag and a per-creator
list. It does **not** store the composition or the fees — those live only in the
deployed basket, which is the authority on them.

---

## 2. Deposits

`deposit(amountIn, minSharesOut, deadline)` runs in a fixed order, and the order
is the substance of the design:

1. **Pull the settlement.** `safeTransferFrom`, then measure the balance delta.
   If what arrived is not exactly `amountIn`, revert
   `UnsupportedSettlementToken(expected, received)`. A fee-on-transfer or
   deflationary settlement token is rejected rather than silently taxing every
   deposit by an amount the user cannot see.
2. **Take the fee first, on what actually arrived.** The deposit fee is charged
   on `received`, before a single component is bought. The split is credited to
   the creator and protocol balances, which are excluded from NAV.
3. **Buy the components.** The net amount is split across components by weight
   and each share is swapped through the DEX adapter, with a per-swap floor of
   `expected * (10_000 - maxSlippageBps) / 10_000`.
4. **Check the total.** If the value actually received across all the swaps is
   less than `netInvested` net of `maxSlippageBps`, revert
   `DepositSlippageExceeded(valueAdded, minimumValue)`. This is the basket's own
   guard, and it is independent of whatever the adapter promised.
5. **Mint.** Shares are computed against the _pre-deposit_ asset and supply
   snapshots, so the depositor's own purchase cannot move the price they pay.
6. **Check the depositor's floor.** Fewer shares than `minSharesOut` reverts
   `InsufficientSharesOut`.

### Splitting the deposit across components

Each component but the last receives `amount * weight / 10_000`, floored. **The
last component receives the remainder**, not its own floored share. Because the
weights sum to exactly 10 000, that remainder is at most a few smallest units
per component, and giving it to the last one means the parts always sum to the
whole. The alternative — flooring every part — strands dust in the contract on
every deposit, and "dust that accumulates forever" is how a basket quietly
becomes unattributable.

### Free settlement

Settlement the basket holds that is not owed to the creator or the protocol:
`freeSettlementBalance() = settlementBalance - (accruedCreatorFees +
accruedProtocolFees)`, floored at zero. It rises when a deposit's component
purchase rounds down and the leftover cannot buy a whole unit of anything, and
when a redemption's sale returns slightly more than the pro-rata claim. It
belongs to the basket's holders — it is counted in `totalAssets()` and so in
NAV. It is not the creator's money and the creator cannot withdraw it.

---

## 3. Basket token minting

A basket token is a plain 18-decimal ERC-20. `ThematicBasket` inherits
OpenZeppelin `ERC20` and never overrides `decimals()`, so 18 is the ERC-20
default and the protocol's `SHARE_SCALE = 1e18` is a compile-time constant
rather than a per-basket property.

`BasketMath.sharesForDeposit(valueAdded, totalAssetsBefore, supplyBefore, settlementScale)`:

```
if (supplyBefore == 0 || totalAssetsBefore == 0)
    shares = valueAdded * 1e18 / settlementScale     // first deposit
else
    shares = valueAdded * supplyBefore / totalAssetsBefore
```

**First deposit.** One whole basket token per whole settlement unit, whatever
the settlement token's decimals are. A basket settling in an 18-decimal token
mints 1e18 shares for 1e18 units; one settling in a 6-decimal token mints 1e18
shares for 1e6 units. The two branches are written to produce the same unit, so
NAV does not jump by a factor of 10^12 at the moment the second depositor
arrives.

**Subsequent deposits.** Pro-rata against the pre-deposit assets and supply.

The `||` in the first branch is deliberate: a basket whose supply is non-zero
but whose assets have fallen to zero is treated as a fresh start. There is
nothing to dilute — the existing shares are worth nothing — so the next deposit
prices as a first one rather than dividing by zero or minting an absurd number
of shares.

**Rounding favours the basket.** Share maths floors, so a deposit that lands
fractionally more value than it is credited for leaves the remainder in
`totalAssets()` for everyone. This is the safe direction: rounding the other way
would let a depositor mint a share they did not pay for, repeatably.

A deposit that would mint zero shares reverts `ZeroAmount()`. Minting nothing
for something is a loss the depositor would not see coming, so it is refused
rather than executed.

---

## 4. Redemption

`redeem(shares, minSettlementOut, deadline)`:

1. **Snapshot the claims before burning.** For each component, the holder's
   pro-rata share of what the basket holds; plus their pro-rata share of free
   settlement. Computed against the pre-burn supply, which is the only way the
   numbers mean what they say.
2. **Burn.**
3. **Sell every component** back to settlement through the adapter, each with
   its own slippage floor.
4. **Gross** is the settlement share plus what the sales returned.
5. **Charge the redemption fee on the gross**, split creator/protocol as usual.
6. **Refuse to pay nothing.** If the net payout is zero,
   `RedemptionYieldsNothing(shares)` reverts. Burning shares for zero settlement
   is a total loss that looks like a successful transaction, and no slippage
   parameter protects against it — a holder who typed `minSettlementOut = 0` has
   not consented to losing everything, they have consented to a small loss.
7. **Check the holder's floor**, `RedemptionSlippageExceeded(net, minSettlementOut)`.
8. **Transfer.**

A component sale that would return zero reverts `RedemptionTooSmall(component)`
at step 3, and a component the price provider cannot price reverts
`ComponentNotPriceable(component)` before any swap is attempted.

### On `amountOutMin`

Every swap carries a floor derived from `maxSlippageBps`, and the redemption as
a whole carries the holder's own `minSettlementOut`. The adapter itself
re-checks its floor and reverts `InsufficientOutput` rather than filling at a
worse price. There is no code path in the repository that swaps with a zero
minimum, and the interface's default for `minSettlementOut` is the quote net of
the basket's own slippage allowance.

---

## 5. Fees

Four rates are fixed at deployment:

| Rate              | Cap        | Deploy-script default |
| ----------------- | ---------- | --------------------- |
| `depositFeeBps`   | 200 (2%)   | 50 (0.5%)             |
| `redeemFeeBps`    | 200 (2%)   | 0                     |
| `creatorShareBps` | 9000 (90%) | 8000 (80%)            |
| `maxSlippageBps`  | 1000 (10%) | 300 (3%)              |

The split is `creatorFee = fee * creatorShareBps / 10_000` and
`protocolFee = fee - creatorFee`. The protocol's part is the **remainder**, not
its own floored multiply, so the two always sum exactly to the fee charged.
Nothing is stranded between them. Because the caps allow `creatorShareBps` up to
9000 and no further, the protocol's share can never be rounded to zero.

The two caps that the factory can move are the _creation ceilings_: the admin
can tighten `maxDepositFeeBps`, `maxRedeemFeeBps`, `maxCreatorShareBps` and
`maxSlippageBps` within the absolute maxima, which changes what future baskets
may charge. It does not change any basket already deployed. That is the whole of
the admin's economic power, and it is bounded at 2% / 90% / 10% by constants
that no role can edit.

### Where the money sits

Accrued fees are settlement tokens held **inside the basket contract**. They are
liabilities, not capital: `totalAssets()` and therefore NAV exclude them, and
`freeSettlementBalance()` cannot touch them. A basket cannot spend its own fee
balance on components.

- `claimCreatorFees()` — callable only by the basket's creator. Pays the whole
  accrued creator balance. Reverts `NothingToClaim()` at zero. Zeroes the
  balance before transferring.
- `withdrawProtocolFees(to)` — callable only by the protocol admin. Same shape.

Nothing pays out automatically and nothing expires. There is no admin path to a
creator's accrued fees, and no creator path to the protocol's.

---

## 6. NAV

`navPerShare()` returns **settlement smallest units per one whole basket
token**.

```
if (totalSupply() == 0)  return 10 ** settlementDecimals
else                     return totalAssets() * 1e18 / totalSupply()
```

The empty branch is the one that needs explaining. `totalAssets()` is in
settlement smallest units and `totalSupply()` is in basket smallest units; the
`1e18` converts the supply to whole tokens. Since the basket token is always
18-decimal, the `1e18` cancels exactly, and the result is already in settlement
smallest units. So the empty basket has to report the same unit — one whole
settlement token's worth — or NAV would appear to jump by a factor of 10^18 the
instant the first deposit landed. Reporting zero for an empty basket is the
tempting alternative and it is wrong for the same reason: it makes "no shares
exist" indistinguishable from "the basket is worthless", and the interface has
to render those differently.

`totalAssets()` is free settlement plus, for each component, `balance * price /
10 ** componentDecimals`. Component decimals are read once, at construction,
from the token itself; anything that is not an ERC-20 with a readable
`decimals() <= 36` is rejected at deployment. Prices are quoted as the value of
one whole component token in settlement smallest units.

**A component the provider cannot price is valued at zero** inside
`totalAssets()`, because a view function has no good way to refuse. The state
that matters is that the deposit and redemption paths do not go through that
path: they call an internal `_priceOf` that reverts `ComponentNotPriceable`.
So an unpriceable component makes the basket's NAV read low and makes deposits
and redemptions revert — it never lets a trade execute at a price nobody knows.
The interface surfaces this: a basket with an unpriced component says so and
disables its deposit and redemption actions rather than offering a button the
contract will refuse.

---

## 7. Previews

`previewDeposit(amountIn)` and `previewRedeem(shares)` return estimates from
current state. Both exclude swap slippage and the price impact of the trade
itself, so both are advisory: the authoritative figures are the `Deposit` and
`Redeem` events' minted and paid amounts. The interface labels them as
estimates and shows the realised numbers from the transaction receipt rather
than leaving the estimate on screen.

---

## 8. Worked example

The seeded "AI Winners" basket: three components at 3500 / 3500 / 3000 bps, a
50 bps deposit fee, a 0 bps redemption fee, an 80% creator share, and a 300 bps
slippage allowance. A depositor puts in 1 000 settlement.

| Step                              | Amount                                         |
| --------------------------------- | ---------------------------------------------- |
| Deposited                         | 1 000.000000                                   |
| Deposit fee (50 bps)              | 5.000000                                       |
| → creator (80%)                   | 4.000000                                       |
| → protocol (20%)                  | 1.000000                                       |
| Net invested                      | 995.000000                                     |
| Allocated: component A (3500 bps) | 348.250000                                     |
| Allocated: component B (3500 bps) | 348.250000                                     |
| Allocated: component C (3000 bps) | 298.500000                                     |
| Slippage floor on the deposit     | 995.000000 − 3% = 965.150000 of value received |
| Shares minted                     | per §3, at the pre-deposit NAV                 |

Every figure is rounded down at the point it is computed; the last component's
allocation absorbs the rounding so the three sum to 995 exactly.

---

## 9. Simulated in this deployment

The contracts implement the model above faithfully. What is simulated is the
_venue_ and the _feed_, and both sit behind the interfaces a production
deployment would use.

| Component                       | Replaced mock              | What it stands in for                                                                                                                                        |
| ------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IPriceProvider`                | `MockPriceProvider`        | A real valuation feed. Prices are set by an admin call and are not market data.                                                                              |
| PancakeSwap V2 router           | `MockDexRouter`            | A real AMM. It is genuine constant-product maths with the real 0.3% fee, seeded from a reserve model — not a 1:1 stub — so slippage and price impact behave. |
| Settlement and component tokens | `MockERC20`                | Real tokenized equities and a real settlement asset. Openly mintable, no supply cap.                                                                         |
| Faulty venue                    | `MockShortchangingAdapter` | A venue that fills badly. Exists so the basket's own slippage guards are reachable in tests.                                                                 |
| Deflationary settlement         | `MockFeeOnTransferERC20`   | A fee-on-transfer token, to prove deposit rejection.                                                                                                         |
| Hostile token                   | `MockCallbackERC20`        | A token that calls back mid-transfer, to prove the reentrancy guard.                                                                                         |

The adapter between the basket and the router is **not** a mock:
`PancakeSwapAdapter` is the real `IDexAdapter` implementation over an
`IPancakeRouter02`, routing directly between a pair or bridging through wrapped
native. The deploy script points it at the mock router so the whole path can be
exercised locally without forking BNB Chain; pointing it at the live router is a
configuration change, not a code change.

Every surface that displays a figure derived from these — prices, valuations,
NAV, assets under management — carries a notice saying so. §10 and §39 of the
engineering specification require the disclosure and it is not a formality: a
number produced by `MockPriceProvider` is not market data and must never be
presented as if it were.
