# THE THEMATIC BASKETS PLATFORM

## ROLE

You are a senior full-stack Web3 engineer, Solidity engineer, smart-contract security engineer, and product-focused frontend engineer.

You are responsible for designing and implementing a production-quality MVP of:

**Thematic Baskets for Tokenized Stocks**

The application allows users to discover and invest in creator-defined baskets of tokenized stocks on BNB Smart Chain.

Example:

AI Winners

* NVDA — 30%
* MSFT — 40%
* GOOGL — 30%

A user deposits the supported settlement asset into the basket and receives the corresponding basket ERC-20 token.

Creators can create thematic baskets and receive a defined share of platform fees.

The application must be built with a strong separation between:

1. Smart-contract logic
2. Blockchain interaction layer
3. Frontend presentation
4. Application state
5. Configuration
6. Deployment infrastructure
7. Documentation and testing

Do not treat this as a simple React dashboard.

The blockchain contracts are the core product.

---

# 1. IMPORTANT ENGINEERING RULES

## Package Manager

Use:

**Yarn**

Do NOT use npm commands.

Examples:

```bash
yarn
yarn add <package>
yarn add -D <package>
yarn dev
yarn build
yarn test
yarn lint
```

Do not generate instructions containing:

```bash
npm install
npm run
npx
```

unless a third-party tool absolutely requires an external CLI invocation and there is no Yarn-compatible alternative.

Prefer Yarn-compatible project scripts.

---

# 2. DO NOT BLINDLY COPY THE ORIGINAL PLAN

The supplied project plan is the product specification and milestone reference.

However, some implementation examples in the plan are intentionally simplified and may be outdated.

Do NOT copy example Solidity, React, wallet, DEX, or deployment code verbatim.

Instead:

* Preserve the intended product behavior.
* Modernize implementation details.
* Follow current official documentation.
* Use current stable package APIs.
* Apply production security practices.
* Clearly identify assumptions.
* Never silently introduce functionality that changes the product's economic model.

The plan explicitly makes smart contracts the majority of the project's work and defines the BasketFactory → ThematicBasket architecture. Preserve that architecture unless there is a strong technical reason to change it.

---

# 3. PRODUCT OBJECTIVE

Build a decentralized application where users can:

* Discover thematic baskets
* Inspect basket composition
* View allocation percentages
* View basket token information
* Connect their wallet
* Approve the settlement token
* Deposit into a basket
* Receive basket tokens
* View their basket holdings
* Withdraw/redeem basket tokens
* Receive the appropriate settlement asset
* View transaction status
* View transaction history where practical

Creators can:

* Create thematic baskets
* Define basket name
* Define ticker/symbol
* Select supported tokenized-stock components
* Define component weights
* View their created baskets
* View accrued creator fees
* Claim/withdraw eligible fees

The protocol should:

* Track baskets
* Track creators
* Collect fees
* Distribute creator/protocol revenue
* Provide transparent on-chain events
* Maintain clear access control

---

# 4. TARGET NETWORK

Primary blockchain:

**BNB Smart Chain**

Development:

**BNB Smart Chain Testnet**

Production:

**BNB Smart Chain Mainnet**

The application must make network configuration environment-driven.

Never hardcode sensitive or environment-specific configuration throughout the codebase.

Create centralized chain configuration.

Example concepts:

```text
BSC Mainnet
BSC Testnet
Chain ID
RPC URL
Explorer URL
Settlement token address
DEX router address
Factory address
```

Never assume that an address from the original plan is correct for every environment.

Validate addresses against official network documentation before deployment.

---

# 5. SMART CONTRACT ARCHITECTURE

Use a modular architecture.

Recommended structure:

```text
contracts/
├── ThematicBasket.sol
├── BasketFactory.sol
├── interfaces/
│   ├── IThematicBasket.sol
│   ├── IBasketFactory.sol
│   └── IDexRouter.sol
├── libraries/
│   └── BasketMath.sol
└── mocks/
```

Additional contracts may be introduced if required.

---

# 6. THEMATIC BASKET CONTRACT

The basket contract represents a single thematic portfolio.

Each basket should contain:

* Name
* Symbol
* Creator
* Component tokens
* Component weights
* Supported settlement asset
* Fee configuration
* Total supply
* Relevant protocol configuration

The contract should expose read functions for the frontend to retrieve basket metadata.

Example conceptual structure:

```text
ThematicBasket

creator
components[]
weights[]
settlementToken
fee configuration
total supply
```

---

# 7. BASKET WEIGHTS

Weights must be validated.

Requirements:

* Components and weights must have equal lengths.
* At least one component must exist.
* Components must not contain invalid addresses.
* Component addresses should not be duplicated.
* Every weight must be greater than zero.
* Total weight must equal a defined basis-point denominator.

Prefer basis points:

```text
10000 = 100%

3000 = 30%
4000 = 40%
3000 = 30%
```

Do not rely on fragile percentage calculations such as:

```solidity
weight / 100
```

when precision matters.

Use explicit denominators.

---

# 8. BASKET FACTORY

Implement:

```text
BasketFactory
```

Responsibilities:

* Create basket contracts
* Record basket addresses
* Record creators
* Emit BasketCreated events
* Provide enumeration/read methods
* Prevent invalid basket creation
* Provide predictable deployment behavior

Conceptually:

```text
User
  ↓
BasketFactory
  ↓
ThematicBasket
```

The factory must not contain unnecessary business logic.

---

# 9. DEPOSIT FLOW

Expected flow:

```text
User
 ↓
Approve settlement token
 ↓
Deposit into basket
 ↓
Basket validates amount
 ↓
Fee calculated
 ↓
Fee distribution accounted for
 ↓
Basket allocation/mint calculation
 ↓
Basket tokens minted
 ↓
Deposit event emitted
```

Important:

Do not assume:

```text
1 USDT = 1 basket token
```

unless this is explicitly established as the MVP economic model.

The basket token amount must have a clearly defined relationship with:

* deposits
* underlying assets
* NAV
* existing supply
* fees

Document the economic model before implementing it.

---

# 10. NAV / VALUATION MODEL

The frontend needs to display a meaningful:

**Net Asset Value**

Do not fabricate NAV.

Determine how the basket obtains component prices.

The architecture should support a price-provider abstraction.

Example:

```text
PriceProvider
├── TokenizedStockPriceProvider
└── MockPriceProvider
```

For MVP:

* Real prices may be used where available.
* Mock prices may be used in local development.
* The UI must clearly distinguish real data from mocked data.

Never silently display mock prices as real market data.

---

# 11. WITHDRAW / REDEEM FLOW

Expected conceptual flow:

```text
User
 ↓
Select basket amount
 ↓
Calculate expected redemption value
 ↓
User specifies minimum acceptable output
 ↓
Basket tokens burned
 ↓
Underlying components redeemed/swapped
 ↓
Settlement asset received
 ↓
Output validated against slippage protection
 ↓
Settlement asset transferred to user
```

The implementation must include:

* Slippage protection
* Deadline protection
* Safe token transfers
* Reentrancy protection where appropriate
* Proper allowance handling
* Failure handling

NEVER implement a production withdrawal using:

```solidity
amountOutMin = 0
```

without explicit justification.

---

# 12. DEX INTEGRATION

Create an abstraction around DEX interactions.

Do not scatter router calls throughout the basket contract.

Conceptually:

```text
IDexAdapter
    ↓
PancakeSwapAdapter
```

The adapter should handle:

* Quotes where supported
* Token swaps
* Minimum output
* Deadlines
* Router interaction
* Token approvals
* Safe transfers

Keep the contract architecture replaceable.

Do not tightly couple the entire system to a single DEX implementation unless required by the project scope.

---

# 13. SECURITY REQUIREMENTS

Use modern OpenZeppelin contracts and security patterns.

Consider:

* Ownable / appropriate access control
* SafeERC20
* ReentrancyGuard
* Pausable where justified
* Custom errors
* Checks-effects-interactions
* Input validation
* Slippage protection
* Deadline protection
* Zero-address validation
* Duplicate component prevention
* Weight validation
* Safe allowance management

Do not add security modules merely for decoration.

Every security mechanism must have a reason.

Administrative functionality must be clearly separated from user functionality.

---

# 14. ACCESS CONTROL

Clearly define:

```text
USER
CREATOR
PROTOCOL ADMIN
```

Users should only perform user-level operations.

Creators should only perform creator-authorized operations.

Protocol administration should be limited to explicitly defined functions.

Do not give the contract owner unnecessary power.

Document every privileged function.

---

# 15. FEE MODEL

Initial product model:

```text
Deposit fee: 0.5%

Creator: 80%

Protocol: 20%
```

Represent fee percentages using precise basis-point configuration where appropriate.

Example:

```text
500 = 5%? 
```

Be careful to define the denominator correctly.

For example:

```text
10000 = 100%
50 = 0.5%
```

Never mix percentage and basis-point conventions.

Fee distribution must be mathematically testable.

---

# 16. ERC-7641

The project plan proposes ERC-7641 revenue sharing.

Treat ERC-7641 as a draft standard, not as a generic synonym for “creator gets 80% of fees.”

Before implementation:

1. Review the current specification.
2. Identify which interfaces/semantics are actually relevant.
3. Document what is implemented.
4. Document what is intentionally not implemented.
5. Avoid claiming full compliance unless the implementation satisfies the relevant standard requirements.

The MVP may implement the required revenue-sharing behavior without pretending to implement unrelated parts of the specification.

---

# 17. REVENUE DISTRIBUTION

Separate:

```text
Protocol fees
Creator fees
User/token-holder revenue sharing
```

These are not automatically the same thing.

The architecture must explicitly define who receives each type of revenue.

Do not create a confusing mapping-based accounting system that merely resembles ERC-7641.

Use clear accounting.

Events should make revenue movements auditable.

---

# 18. FRONTEND TECHNOLOGY

Use:

* React
* TypeScript
* Tailwind CSS
* Yarn
* Modern wallet integration
* Modern EVM interaction tooling
* TanStack Query or equivalent server-state solution where appropriate
* Zod for runtime validation where appropriate

Do not blindly reproduce the old:

```javascript
window.ethereum
ethers.Contract(...)
```

architecture from the plan.

Use a clean blockchain client abstraction.

The UI should not directly contain raw contract logic everywhere.

---

# 19. FRONTEND ARCHITECTURE

Recommended:

```text
src/
├── app/
├── components/
│   ├── ui/
│   ├── baskets/
│   ├── wallet/
│   ├── creator/
│   └── transactions/
├── features/
│   ├── baskets/
│   ├── deposits/
│   ├── withdrawals/
│   ├── creators/
│   └── wallet/
├── lib/
│   ├── blockchain/
│   ├── contracts/
│   ├── validation/
│   └── utils/
├── hooks/
├── types/
└── config/
```

Keep blockchain logic out of presentational components.

---

# 20. WALLET UX

Wallet connection should support the primary target wallet experience without creating unnecessary complexity.

MVP:

* Connect wallet
* Disconnect
* Display shortened address
* Display network
* Detect wrong network
* Request network switch where supported
* Display wallet balance
* Display transaction state

Transaction states:

```text
Idle
Awaiting wallet
Confirming
Pending
Confirmed
Failed
Rejected
```

Never show “success” before the transaction is confirmed.

---

# 21. TRANSACTION UX

Every blockchain mutation must provide feedback.

Example:

```text
Deposit

1. Preparing transaction
2. Waiting for wallet approval
3. Transaction submitted
4. Confirming on BNB Chain
5. Deposit successful
```

Provide:

* Transaction hash
* Explorer link
* Error message
* Retry option where appropriate

Do not expose raw RPC errors as the primary UX.

Map common failures to understandable messages.

---

# 22. PRODUCT PAGES

Create:

## Home / Discover

Purpose:

Help users understand the product and discover baskets.

Sections:

* Hero
* Featured baskets
* Popular themes
* How it works
* Creator section
* Supported assets
* Risk/experimental disclosure
* CTA

---

## Basket Explorer

Display:

* Basket name
* Symbol
* Creator
* Components
* Allocation
* NAV
* Basket token price/value
* Total supply
* User holdings
* Deposit CTA

---

## Basket Detail

Display:

* Basket overview
* Allocation breakdown
* Component assets
* Performance/history where reliable
* NAV
* Creator
* Fee information
* User position
* Deposit
* Withdraw
* Contract address
* Blockchain explorer link

---

## Creator Dashboard

Creators can:

* View created baskets
* Create basket
* View fees
* Claim fees
* View basket performance
* View investor activity where available on-chain

---

## Create Basket

Fields:

```text
Basket name
Symbol
Description
Theme
Component tokens
Weight per component
```

Provide a live allocation preview.

Example:

```text
NVDA      30%
MSFT      40%
GOOGL     30%
----------------
TOTAL    100%
```

Do not allow submission until the weights are valid.

---

# 23. BASKET CREATION UX

The creation experience should feel like building an investment theme rather than filling out a technical form.

Flow:

```text
Choose Theme
      ↓
Select Assets
      ↓
Set Allocations
      ↓
Review
      ↓
Confirm Transaction
      ↓
Basket Created
```

Show the user exactly what will happen before signing.

---

# 24. DESIGN DIRECTION

Do NOT reuse the visual identity of the previous arbitrage monitor project.

Do not automatically use:

* Space Grotesk
* IBM Plex Mono
* Inter
* Terminal-style UI
* Purple/black Web3 aesthetic
* Dense developer-dashboard styling

Those belong to the previous project.

Instead choose a visual system appropriate for an investment/product-discovery platform.

Preferred direction:

## Premium Financial Editorial

Visual characteristics:

* Clean
* Trustworthy
* Sophisticated
* Spacious
* Strong typography hierarchy
* High-quality financial cards
* Editorial-style section layouts
* Subtle motion
* Data visualizations that are easy to read
* Minimal decorative noise

Avoid making it look like a generic crypto dashboard.

---

# 25. TYPOGRAPHY

Do not automatically use the previous project's fonts.

Choose a new type system.

Potential direction:

### Primary

A refined modern grotesk or humanist sans-serif.

### Secondary

A complementary serif may be used for large editorial headings if it improves the investment/editorial feel.

### Data

Use a restrained monospace only where numerical data benefits from it.

Do not make the entire interface monospace.

Typography must establish:

```text
Brand
 ↓
Page title
 ↓
Section title
 ↓
Basket name
 ↓
Financial data
 ↓
Supporting metadata
```

---

# 26. COLOR SYSTEM

Do not reuse the previous project's palette.

Use a restrained financial color system.

Define semantic tokens:

```text
background
surface
surface-elevated
text-primary
text-secondary
border
accent
positive
negative
warning
info
```

Do not use green/red purely as decoration.

Green should communicate positive financial movement.

Red should communicate negative movement or risk.

Warning should communicate something that requires attention.

All colors must meet accessible contrast requirements.

---

# 27. COMPONENT DESIGN

Create reusable components:

```text
BasketCard
BasketAllocation
AllocationChart
AssetRow
CreatorBadge
WalletButton
NetworkBadge
TransactionStatus
DepositModal
WithdrawModal
CreateBasketForm
FeeSummary
PortfolioSummary
StatCard
EmptyState
ErrorState
LoadingState
```

Avoid duplicated UI.

---

# 28. RESPONSIVE DESIGN

Desktop and mobile are both required.

Mobile must not simply be a shrunken desktop layout.

Important mobile considerations:

* Bottom/action positioning
* Horizontal scrolling for allocation data where necessary
* Compact asset rows
* Readable charts
* Large wallet/transaction actions
* Accessible modal behavior

Test:

```text
360px
390px
768px
1024px
1440px+
```

---

# 29. ACCESSIBILITY

Follow accessible UI practices.

Requirements:

* Keyboard navigation
* Focus states
* Semantic HTML
* Accessible form labels
* Accessible modal behavior
* Sufficient color contrast
* Non-color indicators for important financial states
* Screen-reader-friendly transaction states

Do not rely on color alone to communicate:

```text
profit
loss
warning
error
```

---

# 30. DATA ARCHITECTURE

Blockchain is the source of truth for:

* Basket creation
* Basket ownership
* Token balances
* Fee accounting
* Transactions

Do not create a centralized database that contradicts blockchain state.

If an indexing/database layer is introduced, it should be treated as a read optimization/index and not as the authoritative financial ledger.

---

# 31. EVENT-DRIVEN DATA

Listen for relevant contract events.

Examples:

```text
BasketCreated
Deposit
Withdraw
FeeDistributed
FeeClaimed
```

Use events to improve the frontend's ability to update state.

Avoid unnecessary polling.

Where polling is necessary, use controlled intervals.

---

# 32. CONTRACT EVENTS

Events should contain enough indexed information for useful off-chain discovery.

Example:

```solidity
event BasketCreated(
    address indexed basket,
    address indexed creator,
    string name,
    string symbol
);
```

Design events intentionally.

Do not emit excessive or sensitive information.

---

# 33. VALIDATION

Frontend validation:

* Zod or equivalent
* Empty values
* Invalid token addresses
* Invalid weights
* Total allocation
* Invalid amounts
* Insufficient balances
* Network mismatch

Smart-contract validation must independently enforce critical rules.

Never rely on frontend validation for security.

---

# 34. ERROR HANDLING

Create a centralized error-normalization layer.

Convert:

```text
UserRejectedRequest
InsufficientFunds
WrongNetwork
ContractRevert
SlippageExceeded
InsufficientAllowance
TransactionFailed
RPCUnavailable
```

into human-readable UI messages.

Never swallow errors silently.

Log useful technical information in development.

Do not expose sensitive internal information in production.

---

# 35. SMART CONTRACT TESTING

Write comprehensive tests before mainnet deployment.

Minimum coverage:

### Basket creation

* Valid basket
* Empty components
* Mismatched weights
* Invalid weights
* Duplicate tokens
* Zero addresses

### Deposits

* Valid deposit
* Fee calculation
* Creator fee accounting
* Protocol fee accounting
* Minting
* Insufficient allowance
* Insufficient balance

### Withdrawals

* Valid withdrawal
* Burn amount
* Minimum output
* Slippage
* Deadline
* Failed swap
* Reentrancy attempts

### Access control

* Creator-only actions
* Protocol-admin actions
* Unauthorized users

### Pause

* Paused contract behavior
* Unpause
* Restricted pause controls

---

# 36. FRONTEND TESTING

Use:

* Unit tests
* Component tests
* Integration tests
* End-to-end tests

Critical E2E flow:

```text
Connect wallet
 ↓
Discover basket
 ↓
Open basket
 ↓
Approve token
 ↓
Deposit
 ↓
Confirm transaction
 ↓
Verify balance
 ↓
Withdraw
 ↓
Verify result
```

---

# 37. SECURITY REVIEW

Before mainnet:

Perform a dedicated security review.

Check:

* Reentrancy
* Access control
* Integer precision
* Fee calculations
* Token approvals
* Arbitrary token handling
* Malicious token contracts
* DEX manipulation
* Slippage
* Price manipulation
* Oracle assumptions
* Denial of service
* Gas griefing
* Unbounded loops
* Factory abuse
* Creator permissions
* Emergency controls

Do not claim that the contracts are “secure” simply because tests pass.

Document:

```text
Known limitations
Known risks
Assumptions
Out-of-scope threats
```

---

# 38. GAS / SCALABILITY

The project plan notes that baskets should remain reasonably small.

Enforce a reasonable maximum component count.

Avoid:

```solidity
for (...) {
    expensive external calls
}
```

with unbounded user-controlled arrays.

Use explicit limits.

Document the maximum number of basket components.

---

# 39. MOCKING

Local development must not depend entirely on external APIs.

Provide mock:

* Tokenized stock assets
* Price provider
* Settlement token
* DEX behavior

This allows the application to be developed and tested without constantly depending on external infrastructure.

---

# 40. ENVIRONMENT CONFIGURATION

Use environment variables for:

```text
RPC URLs
Private deployment keys
Contract addresses
API keys
Explorer configuration
Price-provider configuration
DEX addresses
```

Never commit:

* Private keys
* Seed phrases
* API secrets
* Wallet credentials

Provide:

```text
.env.example
```

with safe placeholders.

---

# 41. DEPLOYMENT

Deployment must be scripted.

Recommended structure:

```text
scripts/
├── deploy/
├── verify/
└── utilities/
```

Deployment output should clearly report:

```text
Network
Chain ID
Factory address
Implementation addresses
Configured settlement token
Configured DEX
Deployment transaction hashes
Explorer URLs
```

Save deployment metadata in a predictable location.

---

# 42. TESTNET-FIRST REQUIREMENT

Development sequence:

```text
Local
 ↓
BSC Testnet
 ↓
Security review
 ↓
Production readiness checklist
 ↓
BSC Mainnet
```

Never jump directly to mainnet during normal development.

Mainnet deployment should require explicit confirmation.

---

# 43. FRONTEND DEPLOYMENT

Deploy the frontend to Vercel or another suitable hosting provider.

Requirements:

* Production build
* Environment variables
* Correct network configuration
* Contract addresses
* Explorer links
* Error monitoring
* Responsive testing

---

# 44. PROJECT STRUCTURE

Use a clean monorepo if it materially improves separation:

```text
thematic-baskets/
├── apps/
│   └── web/
├── packages/
│   ├── contracts/
│   ├── config/
│   ├── types/
│   └── blockchain/
├── docs/
├── scripts/
├── .github/
├── .env.example
├── package.json
├── yarn.lock
└── README.md
```

If a monorepo introduces unnecessary complexity for the MVP, use a well-structured single application repository instead.

Do not introduce architecture merely because it looks sophisticated.

---

# 45. GIT WORKFLOW

Use clean commits.

Examples:

```text
feat: initialize basket contracts
feat: add basket factory
feat: implement deposit flow
feat: implement redemption flow
feat: add creator dashboard
feat: add wallet integration
test: cover basket creation
test: cover deposit accounting
fix: enforce basket weight validation
docs: document deployment
```

Do not commit:

```text
final-final
new
test123
changes
stuff
```

---

# 46. DOCUMENTATION

README must contain:

## Product

What the platform does.

## Architecture

How contracts and frontend interact.

## Smart Contracts

Contract responsibilities.

## Economic Model

Explain:

* Basket creation
* Deposits
* Basket token minting
* Fees
* Creator revenue
* Protocol revenue
* Withdrawals

## Supported Networks

Testnet and mainnet.

## Deployment

Yarn-based instructions.

## Environment Variables

Explain every variable.

## Testing

How to run tests.

## Security

Known risks and limitations.

## Roadmap

Include:

* Community baskets
* Dividend handling
* Automated rebalancing
* Additional wallets
* Additional DEXs
* Better indexing
* Advanced revenue sharing

---

# 47. DESIGN PRINCIPLE

The application should NOT feel like:

> “a developer made a crypto dashboard.”

It should feel like:

> “a financial product that happens to run on-chain.”

Prioritize:

* Trust
* Clarity
* Discoverability
* Financial information hierarchy
* Simple actions
* Transparent fees
* Visible blockchain verification

---

# 48. PRODUCT LANGUAGE

Avoid unnecessarily technical copy.

Instead of:

> Execute depositUSDT transaction

Use:

> Invest in basket

Instead of:

> Approve ERC20 allowance

Use:

> Approve USDT

Instead of:

> Transaction pending

Use:

> Confirming your investment…

Technical details can remain available under:

> View transaction

or

> View on BscScan

---

# 49. RISK DISCLOSURE

Because this is a financial/blockchain application, clearly communicate that:

* Tokenized assets can carry market risk.
* Smart contracts can contain bugs.
* Prices may change.
* Transactions may fail.
* Blockchain transactions may be irreversible.
* The MVP is experimental where applicable.

Do not make guaranteed-return claims.

Do not present projected returns as guaranteed outcomes.

---

# 50. MVP SCOPE

## MUST HAVE

* BasketFactory
* ThematicBasket
* Basket creation
* Component/weight validation
* Deposit
* Basket token minting
* Withdrawal/redemption
* Fee accounting
* Creator fee claim
* Protocol fee accounting
* Wallet connection
* Basket explorer
* Basket detail page
* Creator dashboard
* Responsive UI
* BSC testnet deployment
* Mainnet-ready architecture
* Automated tests
* README
* Deployment scripts

## SHOULD HAVE

* Price/NAV abstraction
* Transaction history
* Explorer links
* Event-driven UI updates
* Better creator profiles
* Basket performance history

## OPTIONAL

* Community baskets
* Dividend handling
* Automated rebalancing
* Multiple DEX integrations
* Multiple wallets
* Natural-language basket creation
* Autonomous rebalancing agent

Do not allow optional features to delay the core MVP.

---

# 51. IMPLEMENTATION ORDER

Build in this order:

### Phase 1 — Foundation

* Repository
* Yarn
* TypeScript
* Solidity tooling
* OpenZeppelin
* Environment configuration
* Network configuration

### Phase 2 — Contracts

* ThematicBasket
* BasketFactory
* Fee accounting
* Deposit
* Withdrawal
* Events
* Security controls

### Phase 3 — Contract Testing

* Unit tests
* Integration tests
* Edge cases
* Security tests

### Phase 4 — Testnet

* Deploy contracts
* Verify contracts
* Create sample baskets
* Execute real testnet deposits
* Execute withdrawals

### Phase 5 — Frontend

* Design system
* Layout
* Wallet
* Basket explorer
* Basket detail
* Deposit
* Withdrawal

### Phase 6 — Creator Experience

* Create basket
* Creator dashboard
* Fee claims

### Phase 7 — Integration

* Connect frontend to deployed contracts
* Transaction states
* Error handling
* Explorer links
* Event synchronization

### Phase 8 — Hardening

* Security review
* Gas review
* UX review
* Responsive testing
* Accessibility
* E2E testing

### Phase 9 — Production

* Mainnet deployment
* Contract verification
* Frontend deployment
* Documentation
* Demo preparation

---

# 52. ACCEPTANCE CRITERIA

The project is considered MVP-complete when:

* [ ] Factory deploys successfully
* [ ] Factory can create baskets
* [ ] Basket metadata is retrievable
* [ ] Basket weights are validated
* [ ] Users can approve settlement tokens
* [ ] Users can deposit
* [ ] Basket tokens are minted correctly
* [ ] Deposit fees are calculated correctly
* [ ] Creator fees are accounted for
* [ ] Protocol fees are accounted for
* [ ] Users can redeem/withdraw
* [ ] Slippage protection works
* [ ] Unauthorized fee withdrawals fail
* [ ] Reentrancy protections are tested where applicable
* [ ] Contracts work on BSC testnet
* [ ] Frontend can discover baskets
* [ ] Wallet connection works
* [ ] Deposit UI works
* [ ] Withdrawal UI works
* [ ] Creator dashboard works
* [ ] Creator fee claim works
* [ ] Transaction states are handled correctly
* [ ] Errors are human-readable
* [ ] Mobile UI works
* [ ] Tests pass
* [ ] Production build passes
* [ ] README is complete
* [ ] Deployment instructions work
* [ ] Known limitations are documented

---

# 53. DEVELOPMENT BEHAVIOR

Before writing substantial code:

1. Inspect the repository.
2. Understand the existing structure.
3. Identify current dependencies.
4. Check the installed versions.
5. Identify conflicts.
6. Establish the architecture.
7. Implement incrementally.

Do not overwrite existing work unnecessarily.

Do not create duplicate components.

Do not install packages without a reason.

Do not use deprecated APIs when a current supported API exists.

Do not blindly follow code snippets from the original project plan.

---

# 54. WHEN SOMETHING IS UNCLEAR

Do not invent financial or smart-contract behavior.

If an ambiguity affects:

* token economics
* ownership
* fees
* NAV
* redemption
* pricing
* revenue sharing
* contract security

stop and identify the ambiguity before implementing that portion.

For minor UI decisions, use reasonable product judgment.

---

# 55. FINAL ENGINEERING STANDARD

The finished application should demonstrate:

* Modern React engineering
* Strong TypeScript usage
* Clean Solidity architecture
* Safe smart-contract patterns
* Thoughtful Web3 UX
* Clear financial information architecture
* Proper testing
* Good Git hygiene
* Production-aware deployment
* Transparent limitations

The goal is not to build the largest DeFi protocol.

The goal is to build a **small, coherent, demonstrable, technically credible thematic-basket protocol** that works end-to-end.

The final demo should make this flow obvious:

```text
CREATE A BASKET
       ↓
AI WINNERS
       ↓
NVDA 30%
MSFT 40%
GOOGL 30%
       ↓
DEPLOY BASKET
       ↓
USER DISCOVERS BASKET
       ↓
CONNECT WALLET
       ↓
DEPOSIT USDT
       ↓
RECEIVE BASKET TOKENS
       ↓
CREATOR EARNS FEES
       ↓
USER WITHDRAWS
       ↓
RECEIVES SETTLEMENT ASSET
```

Every major step should be verifiable on-chain.

Build the product around that experience.
use my skill like impeccable and other design skill
no ai slop feature
no three cards features, etc