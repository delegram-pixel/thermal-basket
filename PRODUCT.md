# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS, wagmi/viem for wallet and chain access, TanStack Query for server state, Zod for runtime validation. Monorepo via Yarn workspaces: `packages/contracts` (Hardhat 2 + `@nomicfoundation/hardhat-toolbox`, OpenZeppelin), `packages/config`, `packages/types`, `apps/web`. Components and prices are a fully mocked on-chain stack on testnet (mock tokenized-stock ERC-20s, mock price provider, mock DEX router with seeded liquidity) behind the same `IPriceProvider` / `IDexAdapter` interfaces the production adapters implement.

## Users

**Retail investors** who want exposure to a theme — AI, semiconductors, payments — rather than a single ticker, and who are already comfortable signing transactions in a browser wallet. Their job: find a theme they believe in, see exactly what they are buying and what it costs, and hold it without needing to construct the basket themselves.

**Creators** — analysts, newsletter writers, community figures — who publish a thesis as a weighted basket and earn a share of the fees it generates. Their job: define a basket, deploy it, watch it accumulate fees, and claim them.

## Product Purpose

Lets anyone create, discover, and invest in thematic baskets of tokenized stocks on BNB Smart Chain. A creator defines a theme and its weighted components; a factory deploys an ERC-20 whose supply is backed one-for-one by the component tokens the basket actually holds. Investors deposit the settlement asset and receive basket tokens; redeeming burns them and returns the settlement asset. Success means the full loop — create, discover, deposit, redeem, earn — is verifiable on-chain end to end, not merely rendered in a UI.

## Positioning

The basket is **actually collateralized**. Deposits are swapped into the component tokens and held by the basket contract; exiting swaps them back. NAV is derived from what the contract holds, not from a number a backend asserts. A neighboring product could copy the fee split or the UI in a weekend; it could not copy this without also building the custody, valuation, and redemption path — or without lying about what backs the token.

## Operating Context

- A **BNB Chain hackathon submission**. The deliverable is judged by people who will open the contracts on BscScan and check whether the claimed economics are the implemented economics.
- Because of that, on-chain verifiability is a feature of the interface itself: contract addresses, transaction hashes, and explorer links are surfaced, not buried.
- Development runs local → BSC testnet → (explicit confirmation) mainnet. Mainnet is never a default.
- The basket token is disclosed as experimental. Tokenized assets carry market risk, prices move, transactions can fail, and the contracts have not been audited.

## Capabilities and Constraints

Capabilities: basket creation with validated weights; deposit → swap → mint; redeem → burn → swap → settlement; per-basket fee accounting split between creator and protocol; creator fee claims; basket enumeration, metadata, NAV, and holdings reads; wallet connection with network detection; event-driven UI updates.

Confirmed technical constraints:

- **Weights use basis points.** `10000 = 100%`. Percentage math like `weight / 100` is not used where precision matters.
- **Maximum component count is enforced** so no unbounded loop over user-controlled arrays can grief a transaction. Documented in the contracts README.
- **Fee model:** 0.5% deposit fee (`50` bps), split 80% creator / 20% protocol (`8000` / `2000` bps of the fee). Redemption carries no fee in the MVP. Precision convention is basis points throughout, never mixed with percentages.
- **Every basket is pinned to the economics it launched with.** The protocol admin may change defaults for future baskets; it cannot reach into a live basket and alter its fee split. The protocol admin's powers are limited to: setting defaults for new baskets, registering allowed component assets, and treasury withdrawal of accrued protocol fees.
- **ERC-7641 is treated as a draft standard, not a slogan.** Only the revenue-sharing behavior that is actually implemented is claimed. Anything unimplemented is documented as unimplemented rather than implied by the name.
- **NAV is never fabricated.** Real and mocked prices are visually distinguished in the UI at all times.
- **Prices on testnet are mock data**, settable by the protocol admin so NAV movement can be demonstrated. This is stated in the UI, not hidden.

Explicitly undecided / out of MVP scope: dividend handling, automated rebalancing, community-created baskets beyond the standard creator flow, multiple DEXs, multiple wallet vendors, and any indexing layer. Blockchain is the source of truth; any index introduced later is a read optimization, never the financial ledger.

## Brand Commitments

None supplied. No existing name, logo, voice, or identity assets were provided, and none may be invented and presented as established. The project name is working-titled "Thematic Baskets".

One binding constraint: the visual identity must **not** reuse the previous arbitrage-monitor project's system — no Space Grotesk, IBM Plex Mono, or Inter; no terminal-style or dense developer-dashboard aesthetic; no purple/black crypto palette.

## Evidence on Hand

- No real users, deposits, testimonials, press, or performance history exist. None may be fabricated for the interface.
- Sample baskets are illustrative and seeded by the team, not customer activity. The UI must not present them as traction.
- The deployed contract addresses, their verified source on BscScan, and real testnet transaction hashes are the only genuine evidence the product will have, and are the proof the interface is built around.

## Product Principles

1. **What backs the token is the product.** Contract behavior is the claim; the interface exists to make that behavior legible and checkable.
2. **Show the cost before the signature.** Fees, weights, expected output, and slippage tolerance are visible pre-confirmation, never discovered afterward.
3. **Verification over assertion.** Every state the UI shows links to the on-chain artifact that proves it.
4. **Mocked data is labelled as mocked.** The product would rather look less impressive than imply real market data it does not have.
5. **Scoped honestly beats scoped broadly.** What is not built is documented, not dressed up.

## Accessibility & Inclusion

Standard practice is required: keyboard reachability, visible focus, semantic HTML, labelled form controls, correct modal focus handling, contrast meeting WCAG AA in both themes, and no financial state communicated by color alone — gains, losses, warnings, and errors all carry a non-color indicator. Transaction state changes are announced to assistive technology rather than only rendered.
