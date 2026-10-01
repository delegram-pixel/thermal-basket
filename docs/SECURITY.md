# Security

What these contracts are, what they trust, what they deliberately refuse to do,
and what is known not to be finished. This document is a precondition for a
mainnet deployment, and the contracts say so in their own NatSpec — read it
before deploying anywhere that holds value.

**Status: unaudited, and deployed only against a mock asset stack.** The deploy
scripts refuse BNB Smart Chain mainnet outright (chain 56), and the assets a
local or testnet deployment uses are openly mintable test tokens with no market.
Nothing here has been reviewed by a third party. Treat the code as a working
prototype of the mechanism, not as a place to put money.

---

## 1. Scope

In scope:

| Contract                          | What it is                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ThematicBasket.sol`              | The basket. Holds component tokens, mints and burns shares, charges fees. One instance per basket.                                                  |
| `BasketFactory.sol`               | Deploys baskets, keeps the registry, holds the ceilings new baskets must fit inside. Holds no user funds and has no function that transfers tokens. |
| `libraries/BasketMath.sol`        | Composition validation, share maths, fee splitting, decimal handling. Pure.                                                                         |
| `adapters/PancakeSwapAdapter.sol` | The DEX integration — the seam a production deployment would keep and re-point.                                                                     |
| `interfaces/`                     | `IPriceProvider`, `IDexAdapter` — the two seams.                                                                                                    |

Out of scope, and named so nobody assumes otherwise: the web application, the
deployment scripts, and everything in `contracts/mocks/`. The mocks are not
production code and several of them are hostile on purpose.

---

## 2. Trust model

There is no `Ownable` and no `AccessControl`. Every privileged address is
`immutable` and set at construction. There is therefore **no admin transfer and
no renounce function** — changing who administers a basket means deploying a new
basket.

| Role           | Held by                              | Can do                                                                                       | Cannot do                                                                                                 |
| -------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Holder         | anyone                               | `deposit`, `redeem`, transfer shares                                                         | —                                                                                                         |
| Creator        | `creator`, fixed at deployment       | `claimCreatorFees()`                                                                         | touch protocol fees, change fees, mint, pause                                                             |
| Protocol admin | `protocolAdmin`, fixed at deployment | `pause()`, `unpause()`, `withdrawProtocolFees(to)`                                           | change a live basket's fees, composition, provider or adapter; mint; seize components; claim creator fees |
| Factory admin  | `protocolAdmin` on the factory       | change the ceilings, defaults, infrastructure and allowlist that apply to **future** baskets | change any basket already deployed                                                                        |

### 2.1 The admin's power, stated exactly

Three things, and no more:

1. **Halt deposits and redemptions, indefinitely.** There is no timelock, no
   maximum duration and no holder-side escape hatch. Holders keep custody — the
   basket token still transfers, and pausing does not freeze secondary trading —
   but while paused there is no route back to the settlement token through the
   contract.
2. **Withdraw the accrued protocol fee balance, to any address it names.**
3. **Change the rules for future baskets** — ceilings, defaults, price provider,
   DEX adapter, treasury, component allowlist. None of these are retroactive.

### 2.2 The admin cannot

- **Change a live basket's fees.** All four rates are `immutable` and the basket
  has no setter. There is a test that enumerates the basket's ABI and asserts
  there are **zero** functions matching `set[A-Z]`.
- **Re-point a live basket's price provider or adapter.** The test calls
  `factory.setInfrastructure(...)` and asserts the basket's own `priceProvider`
  and `dexAdapter` are unchanged.
- **Move holder assets.** `withdrawProtocolFees` transfers only
  `accruedProtocolFees`, which is only ever incremented by a real fee on a real
  deposit or redemption. After a withdrawal, `totalAssets()` is unchanged and
  every holder balance is intact — asserted directly.
- **Mint.** `_mint` is called from exactly one place, inside `deposit`.
- **Reach the creator's fees.** `NotCreator`. And the creator cannot reach the
  protocol's.

### 2.3 The price provider is the larger trust surface

A basket's `priceProvider` address is immutable. The behaviour behind it is not.
`MockPriceProvider` has its own admin who can set or clear any price at any
time, including for baskets already deployed, and prices feed three things: what
NAV reports, how many shares a deposit mints, and what floor each swap is given.

A price set too low weakens slippage protection. Too high, and deposits and
redemptions revert. Either way, the provider admin has more practical influence
over a basket than the basket's own admin does, and the code does not — cannot —
bound it. In a production deployment this address must be a real feed or an
audited oracle, and it must not be the same key as the protocol admin. **In the
demo deployment it is the same EOA.**

### 2.4 `protocolTreasury` is recorded but not enforced

Each basket stores an immutable `protocolTreasury`, and `withdrawProtocolFees(to)`
ignores it — the recipient is whatever the admin passes. The field is validated
non-zero at construction and then never read again.

This is stated rather than fixed because it is a revenue-sharing decision, not a
bug to be quietly patched: the parameter exists so protocol fees can still be
swept after the protocol's treasury address changes, which the per-basket
snapshot could not do. But it does mean the on-chain `protocolTreasury` is
documentation of intent, not a constraint, and the honest reading is that
protocol fee recipients are at the admin's discretion. Anyone auditing a
deployment should know that before reading the field as a guarantee.

---

## 3. Pause

`pause()` and `unpause()` are protocol-admin only.

**Blocked while paused:** `deposit` and `redeem`, both carrying `whenNotPaused`.

**Not blocked while paused, deliberately:**

- `claimCreatorFees()` and `withdrawProtocolFees()`. Revenue that has already
  been earned is not a risk to the basket, and freezing it during an incident
  would punish the creator for someone else's problem.
- **ERC-20 `transfer`.** `ThematicBasket` does not override `_update`, so pause
  is not a freeze. Holders keep their tokens and can move them; there is an
  explicit test asserting a transfer succeeds while paused and that supply is
  unchanged.
- Every view function. A paused basket still reports its composition, its NAV
  and its previews, because "you cannot trade right now" is information the page
  should be able to state.

The interface reflects this: a paused basket says it is paused and disables the
deposit and redemption actions rather than presenting a button the contract will
reject.

---

## 4. Reentrancy

`ReentrancyGuard` on all four state-changing entry points that make external
calls: `deposit`, `redeem`, `claimCreatorFees`, `withdrawProtocolFees`.

The contracts hold no ETH at all — there is no `receive`, no `fallback`, no
`payable` and no `msg.value` anywhere. All value is ERC-20, which means the
realistic attack is a token that calls back mid-transfer.

That attack is implemented and tested, not assumed away. `MockCallbackERC20`
fires a one-shot call after every balance change, and there are four tests
arming it against deposit, redemption and both fee claims. Each expects
`ReentrancyGuardReentrantCall`, and each additionally asserts that nothing
moved: supply unchanged, balances unchanged, fee balances unchanged.

Effects are ordered before interactions throughout: shares are burned before the
payout swap, fee balances are zeroed before the transfer.

`PancakeSwapAdapter` carries no guard, and does not need one — by construction it
holds nothing between calls. Output goes from the router straight to the
recipient, and the approval is set and then cleared to zero within the same
call, so a compromised adapter cannot accumulate funds by leaving a swap
half-finished. The adapter also re-checks the output floor itself rather than
trusting the router's word.

---

## 5. What the contracts refuse to do

Every one of these is a case where the quiet behaviour would have been to
succeed and take something from someone.

| Situation                                                                      | Contract's answer                                                        | Why not the quiet option                                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settlement token delivers less than sent (fee-on-transfer, rebasing)           | `UnsupportedSettlementToken(expected, received)`                         | Accounting at face value would tax every depositor invisibly, and the tax would compound.                                                        |
| A component has no price                                                       | `ComponentNotPriceable(component)`                                       | Valuing it at zero would let a deposit mint nothing and a redemption pay nothing.                                                                |
| A deposit's purchase returns less value than the basket's own tolerance allows | `DepositSlippageExceeded(valueAdded, minimumValue)`                      | The venue may lie. The basket checks the result itself rather than trusting the adapter's success.                                               |
| A redemption would pay out zero                                                | `RedemptionYieldsNothing(shares)`                                        | Burning shares for nothing is a total loss that looks like a successful transaction, and no slippage parameter protects against it.              |
| A purchase or sale would trade in a quantity that rounds to zero               | `DepositTooSmall` / `RedemptionTooSmall`                                 | Same reason.                                                                                                                                     |
| A component is not an ERC-20 with readable decimals, or has more than 36       | `ComponentNotERC20Metadata` / `ComponentDecimalsTooHigh`, at deploy time | Discovering it at deposit time would be discovering it with a holder's money.                                                                    |
| A swap would return less than its floor                                        | `InsufficientOutput`, from the adapter                                   | The adapter contract requires implementations to revert here, and the interface states that `amountOutMin = 0` is never passed by this protocol. |

**No code path in this repository swaps with a zero minimum output.** The floors
are derived from the basket's `maxSlippageBps` at every swap, and the adapter
re-checks independently.

---

## 6. Known limitations

Honest list, worst first.

**The asset stack is invented.** Component prices come from an admin-set mock
feed; the DEX is a local constant-product AMM seeded from a reserve model; the
tokens are openly mintable with no supply cap. `MockERC20`'s own header says it
"must never be deployed to a network where it would be treated as carrying
value". No figure on any screen in this deployment is market data, and every
surface that shows one says so.

**Previews are not quotes.** `previewDeposit` and `previewRedeem` price at the
provider and ignore swap cost, price impact and the trade moving its own market.
`previewRedeem` is _always_ the optimistic number — there is a test asserting the
actual payout is strictly below it. The authoritative figures are the `Deposit`
and `Redeem` events' minted and paid amounts, and the interface reads those.

**A caller-supplied zero minimum disables their own protection.** Nothing forces
`minSharesOut` or `minSettlementOut` to be non-zero. A caller passing zero still
gets the basket's own per-swap floor, but they have given up their own. The
interface never defaults to zero; it derives the minimum from the quote.

**The slippage allowance is up to 10% per swap, chosen by the creator.** A basket
deployed at the cap will tolerate a great deal. It is a creation parameter a
depositor can read before depositing, and the interface shows it — but it is not
bounded below.

**Pause is indefinite and has no holder escape.** See §2.1.

**Fees are charged in both directions and the AMM takes its cut both ways.** A
round trip costs the deposit fee plus the redemption fee plus the AMM fee on
each leg. The test suite's standard basket round-trips 1 000 to about 989 —
roughly 1.1% — and that is with a redemption fee of zero. This is a real cost of
using the mechanism, not a defect, but a basket is a position to hold, not a
vehicle to trade in and out of.

**Anyone can move NAV by donating settlement.** Sending settlement tokens
straight to the basket raises `totalAssets()` and therefore NAV per share; this
is deliberate and tested. It is a gift to holders, and it means NAV per share is
not solely a function of trading.

**A component can become untradeable after deployment.** Nothing validates
liquidity or routability at creation beyond the token having `decimals()`.
Delisting, a pulled pool or a frozen feed makes `deposit` and `redeem` revert
until it recovers. The interface surfaces this by disabling trade on a basket
with an unpriced component rather than letting the user find out from a reverted
transaction.

**The total-loss restart dilutes nothing, but it does reset the price.** If a
basket's supply is non-zero and its assets have fallen to zero, the next deposit
is priced as a first deposit. The existing shares are already worth zero, so no
holder loses anything they had — but it is a branch worth knowing about.

**Not implemented, and not claimed:** no rebalancing, no dividend handling, no
share transfer restrictions, no upgrade path (baskets are plain
`new ThematicBasket(...)`, not proxies), no `permit`, no `supportsInterface`, no
`ERC-4626`, no `ERC-1363`, and no `ERC-7641`.

---

## 7. Standards

**The basket token implements ERC-20, and nothing else.** `ThematicBasket`
inherits OpenZeppelin `ERC20`, `ReentrancyGuard` and `Pausable`; the extra
surface in `IThematicBasket` is protocol-specific and standard to nobody.

**ERC-7641 is not implemented and is not claimed.** It appears in the planning
documents as a design reference for revenue-sharing tokens, and in no Solidity
file, ABI or test. What is implemented is a plain fee split — a per-basket
`creatorShareBps`, two accrued balances, and a pull-based `claimCreatorFees` —
which is a simpler thing than ERC-7641 describes. Naming it ERC-7641 in the
interface or the docs would be claiming a standard the contracts do not satisfy.

---

## 8. Assurance

100 tests across six files, all passing. The cases that matter for the claims
above:

| Claim                                                                       | Where it is proved                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Only the admin can pause; nobody can move holder assets                     | `Basket.access.test.ts`                                                            |
| A live basket has no setters and cannot be re-pointed                       | `Basket.access.test.ts` (ABI enumeration)                                          |
| Pause blocks deposit and redeem but not transfers                           | `Basket.access.test.ts`, `Basket.deposit.test.ts`, `Basket.redeem.test.ts`         |
| Fee-on-transfer settlement is rejected, and nothing is minted               | `Basket.deposit.test.ts`                                                           |
| A venue that fills badly is caught by the basket's own guard                | `Basket.deposit.test.ts`, `Basket.redeem.test.ts` (via `MockShortchangingAdapter`) |
| A redemption that would pay zero reverts                                    | `Basket.redeem.test.ts`                                                            |
| Callback tokens cannot re-enter any of the four entry points                | `Basket.deposit.test.ts`, `Basket.redeem.test.ts`, `Basket.fees.test.ts`           |
| Fee parts sum exactly, with no stranded dust, and are excluded from NAV     | `Basket.deposit.test.ts`, `Basket.fees.test.ts`                                    |
| An empty basket's NAV is one whole settlement token, across decimal regimes | `Basket.valuation.test.ts`                                                         |
| Composition validation rejects every malformed case                         | `BasketFactory.test.ts`                                                            |

Two gaps worth naming. Fee-on-transfer **component** tokens are not tested — only
the settlement token, and only on the deposit path; a shortchanging component
would be caught by the basket's slippage guard rather than by a dedicated check,
which is reasonable but is an inference rather than a test. And the swap paths
are exercised against a mock router with seeded reserves, not against a fork of
real PancakeSwap liquidity.

Run them:

```bash
yarn test                       # the full suite
yarn workspace @thematic/contracts run test:gas    # with a gas report
```

---

## 9. Reporting

This is a prototype repository and there is no bug bounty. If you find something
in the mechanism itself, open an issue describing the scenario — the state
required, the call sequence, and what you expected to happen instead. Please do
not test anything against a deployment holding other people's funds; there
should not be one, and if there is, that is the first thing worth reporting.
