# Thematic Baskets

Weighted baskets of tokenized stocks on BNB Smart Chain. A creator defines a
theme and its components; a factory deploys an ERC-20 whose supply is backed by
the component tokens the basket actually holds. Investors deposit a settlement
asset and receive basket tokens. Redeeming burns them and returns the settlement
asset. Creators earn a share of the fees.

The basket is **actually collateralized**. A deposit swaps into the component
tokens and the basket contract holds them; an exit swaps them back. NAV is
derived from what the contract holds, not from a number a backend asserts.

> **This is a prototype on a mock asset stack, and it is unaudited.** On local
> and testnet deployments the component tokens are openly-mintable mocks and
> prices come from an administrator-set feed. No figure in such a deployment is
> market data. Read [docs/SECURITY.md](docs/SECURITY.md) before pointing it at
> anything that holds value.

---

## Contents

- [Product](#product)
- [Architecture](#architecture)
- [Reference prices](#reference-prices)
- [Smart contracts](#smart-contracts)
- [Economic model](#economic-model)
- [Supported networks](#supported-networks)
- [Deployment](#deployment)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Security](#security)
- [Roadmap](#roadmap)
- [Developer experience report](docs/DX-REPORT.md)

---

## Product

**Discover** (`/`) — the baskets that exist, with NAV, assets under management
and the disclosure that the figures come from a mock feed.

**Browse** (`/baskets`) — the full list, sortable, with each basket's
composition and fees visible before you commit anything.

**Basket detail** (`/baskets/[address]`) — the composition and weights as
deployed, the contract's own holdings and NAV, the fee schedule, a deposit and a
redemption panel, and your own position. Every figure links to the chain it came
from.

**Create** (`/create`) — compose a basket: pick components, set weights in basis
points, set the four fee parameters within the factory's ceilings, and see the
resulting economics before deploying. Weights are validated client-side and
again on-chain; a composition that would fail the contract is refused before a
transaction is offered.

**Creator studio** (`/creator`) — the baskets you created, their outstanding
supply, and the fees accrued and claimable. Claiming clears one basket at a
time.

**Disclosures** (`/disclosures`) — what is simulated, what the basket token is
and is not, and what the contracts do not claim.

Two conventions the interface holds to throughout, because both are places where
a financial product can quietly lie:

- **A figure that is an estimate says so, and is replaced by the realised number
  once the transaction lands.** Previews exclude swap cost and price impact; the
  `Deposit` and `Redeem` events are the authority, and the interface reads them
  rather than leaving the estimate on screen.
- **Nothing is claimed that the page has no basis for.** A disconnected wallet is
  told to connect, not told it holds nothing.

---

## Architecture

A Yarn-classic workspace monorepo.

```
apps/web                  Next.js 16 App Router — the interface
packages/contracts        Solidity, tests, and the deploy/seed/verify scripts
packages/blockchain       viem reads and writes, formatting, error translation
packages/config           chain definitions and validated public environment
packages/types            shared types and constants
```

**The web app is a read layer over the chain, not a backend.** There is no
database and no indexer, and no state survives a request. Baskets are discovered
by enumerating the factory; composition, NAV and holdings are read from each
basket contract; positions are read from the basket token's `balanceOf`.
`packages/blockchain` holds those reads and the formatting they feed, so a unit
convention is stated once rather than at each call site. TanStack Query caches
them and invalidates on the transaction receipts that change them.

The one server-side component is a small set of Next.js Route Handlers under
`apps/web/src/app/api/reference/`. They exist for exactly one reason: the Binance
Web3 API key pair signs every request, and a signature computed in the browser
would ship the secret to every visitor. These handlers hold the credential, sign
the request, and pass the response on. They store nothing, and the app is fully
functional without them — see [Reference prices](#reference-prices).

Two constraints shape the client:

- **Multicall3 is not deployed on the local Hardhat node**, so batched reads go
  through `Promise.all`/`mapLimit` and `createConfig` sets
  `batch: { multicall: false }`. Enabling multicall silently would make every
  read return empty on local.
- **Nothing derived from the mock feed is presented as market data.** §10 and §39
  of the engineering specification require the disclosure, and it is carried on
  every surface that shows a price, a valuation or a NAV.

---

## Reference prices

There are two kinds of price on a basket page and they are not the same thing.
The one the contracts value against is an administrator-set feed of fixed
numbers. Beside it the interface shows the **underlying company's real market
price**, fetched from the Binance Web3 API, so a reader can see the distance
between the two.

That distance is the point. A basket of tokenized equities is only as useful as
the market it tracks, and an application that shows a NAV without ever showing
the market it claims to follow is asking to be trusted rather than checked. The
column is labelled, and the gap is explained on the page rather than left for
someone to misread as an arbitrage.

### Endpoints used

Five RWA Data endpoints, against `https://web3.binance.com`, all with
`chainId=56`:

| Endpoint                                        | What this application uses it for                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/dex/market/rwa/search`             | Resolves a ticker before anything is priced. Its name and token address are what the table shows beside the ticker, so a "tokenized NVDA" claim carries a contract. |
| `GET /api/v1/dex/market/rwa/price`              | The reference price itself, one call per ticker.                                                                                                                    |
| `GET /api/v1/dex/market/rwa/underlying-profile` | Company context on a basket page: name, sector, industry and description.                                                                                           |
| `GET /api/v1/dex/market/rwa/underlying-market`  | Market capitalisation, fetched alongside the profile.                                                                                                               |
| `GET /api/v1/dex/market/rwa/tokens`             | The catalogue size, reported beside the reference column so a row with no price can be read against how many listings exist at all.                                 |

None of the four ticker-scoped calls offers a batch form — it is one request per
ticker — which is why the caller caps its ticker list at sixteen. The catalogue
call is the one request made for the whole deployment rather than per ticker.

### Authentication

Each request is signed with HMAC-SHA256 over `timestamp + method + requestPath +
body`, with no separators between the parts, and the signature is Base64. The
`requestPath` **includes the `/build` prefix**; signing the path without it is
the documented cause of `40102`.

| Header             | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| `X-OC-APIKEY`      | The API key.                                                 |
| `X-OC-TIMESTAMP`   | ISO 8601 with milliseconds.                                  |
| `X-OC-SIGN`        | Base64 HMAC-SHA256 of the pre-hash above.                    |
| `X-OC-RECV-WINDOW` | Sent explicitly at 60000 ms rather than left to the default. |

**The key pair never reaches the browser.** `BINANCE_WEB3_API_KEY` and
`BINANCE_WEB3_API_SECRET` are read only inside the Route Handlers, and the module
that reads them throws if it is ever evaluated in a browser context. A signature
computed client-side would publish the secret to every visitor, because the
secret is the only input a visitor would need to forge one.

### When it fails

The routes answer `200` with the reason in the body rather than a `5xx`. On a
deployment with no key, "the reference feed is not configured" is a correct and
expected state, and a `5xx` would make it indistinguishable from the handler
being broken — those want different words on screen. The API's own error code is
carried through verbatim, because `40102`, `40103` and `40304` are the codes worth
recognising and none of them survives being paraphrased.

The failure this integration actually met in production is worth naming, because
it is not a client defect:

```
HTTP 200 · code 40304 · Service not available due to compliance restriction
```

All five endpoints returned that, from a serverless function in `iad1`. The
transport, the path and the parameters were all correct — a malformed request
returns `40102`, not a business code. Binance's RWA data is refused to a United
States origin, which is expected for a tokenized-equity product rather than a
bug. The deployment therefore pins its function region in `apps/web/vercel.json`:

```json
{ "regions": ["sin1"] }
```

so the request leaves from outside the restricted region. It is set there rather
than with the `preferredRegion` route segment config, which this version of Next
has deprecated and which now accepts only `auto`, `global` and `home` — handing it
a region code fails the deploy. `regions` in `vercel.json` overrides the Function
Region in Project Settings, so the choice is version-controlled rather than living
in a dashboard. See [docs/DX-REPORT.md](docs/DX-REPORT.md) for the full finding,
including why `40304` is the least actionable code in the API.

`/diagnostics` calls all five endpoints and prints each one's status, latency,
error code and a truncated body excerpt. It exists because the network path to
`web3.binance.com` was filtered from the development machine for the whole of
this integration's construction — DNS first, then the connection — so every
question about the API had to be asked from somewhere else. A panel that names
each endpoint and reports what it actually said is the instrument that was
missing, and it is also the honest way to demonstrate the integration: elsewhere
a failure is a quietly empty column, and here it is the subject.

The response envelopes are parsed defensively — key candidates are searched for
at a bounded depth rather than read by a fixed path — because a live
authenticated response was not observed while the client was written. That is a
finding, and it is recorded as one in [docs/DX-REPORT.md](docs/DX-REPORT.md)
rather than papered over.

---

## Smart contracts

`packages/contracts/contracts/`, Solidity 0.8.28, OpenZeppelin 5.6.1.

| Contract                          | What it is                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ThematicBasket.sol`              | One ERC-20 per basket. Holds component tokens, mints and burns shares, charges fees.                      |
| `BasketFactory.sol`               | Deploys baskets, keeps the registry, holds the ceilings new baskets must fit inside. Holds no user funds. |
| `libraries/BasketMath.sol`        | Composition validation, share maths, fee splitting, decimal handling. Pure.                               |
| `adapters/PancakeSwapAdapter.sol` | The real `IDexAdapter` over an `IPancakeRouter02`.                                                        |
| `interfaces/IPriceProvider.sol`   | The valuation seam.                                                                                       |
| `interfaces/IDexAdapter.sol`      | The venue seam. States that `amountOutMin = 0` is never passed.                                           |
| `contracts/mocks/`                | The local asset stack, plus two hostile tokens and a shortchanging venue the tests arm on purpose.        |

**The two seams are the point.** `IPriceProvider` and `IDexAdapter` are the
production interfaces; the mocks implement them. Moving to a real feed and a
real router is a configuration change, not a rewrite. A basket's provider and
adapter are `immutable` and set at construction.

The basket token implements **ERC-20 only**. No ERC-165, ERC-1363, ERC-2612,
ERC-4626 or ERC-7641, no proxy and no upgrade path. See
[docs/SECURITY.md §7](docs/SECURITY.md) — ERC-7641 in particular appears in the
planning documents and in no Solidity file, and claiming it would be claiming a
standard the contracts do not satisfy.

Compiled with `viaIR: true` (the valuation and swap loops exceed the legacy code
generator's stack), `optimizer.runs: 200`, and `metadata.bytecodeHash: 'none'`
(custom errors replaced revert strings, so metadata can be trimmed without
losing diagnostics).

---

## Economic model

The full treatment is [docs/ECONOMIC-MODEL.md](docs/ECONOMIC-MODEL.md). The
short version:

**Every rate is basis points** out of `BPS_DENOMINATOR = 10_000`, and every
division floors through `Math.mulDiv`.

| Rate              | Absolute cap | Deploy default |
| ----------------- | ------------ | -------------- |
| `depositFeeBps`   | 200 (2%)     | 50 (0.5%)      |
| `redeemFeeBps`    | 200 (2%)     | 0              |
| `creatorShareBps` | 9000 (90%)   | 8000 (80%)     |
| `maxSlippageBps`  | 1000 (10%)   | 300 (3%)       |

A deposit takes the fee first, on what actually arrived, then buys the
components by weight. The fee splits `creator = fee × share / 10000` with the
protocol taking the **remainder**, so the parts always sum exactly and nothing is
stranded. Accrued fees are held inside the basket contract and are _liabilities_:
`totalAssets()` — and therefore NAV — excludes them.

`navPerShare()` returns settlement smallest units per one whole basket token. An
empty basket returns one whole settlement unit, not zero: zero would make "no
shares exist" indistinguishable from "the basket is worthless".

**Rounding always favours the basket.** Share maths floors, so a deposit credited
fractionally less than it contributed leaves the remainder in `totalAssets()` for
everyone. A deposit that would mint zero shares reverts rather than taking
something for nothing.

**The contracts refuse the quiet loss.** A fee-on-transfer settlement token, an
unpriceable component, a venue that fills worse than the basket's own tolerance,
and a redemption that would pay out zero all revert rather than succeed. There is
no code path in the repository that swaps with a zero minimum output.

---

## Supported networks

| Chain                   | Id    | Status                                                                                              |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| Hardhat                 | 31337 | Development. Mock stack, addresses derived from the default mnemonic.                               |
| BNB Smart Chain testnet | 97    | Demo deployment. Mock stack — there is no liquid tokenized-equity market on testnet to use instead. |
| BNB Smart Chain         | 56    | **Refused by every script.** See [docs/DEPLOYMENT.md §5](docs/DEPLOYMENT.md).                       |

`assertNotMainnet()` is the first statement in each deploy and seed script and
throws on chain 56. Mainnet requires real infrastructure addresses, a multisig,
and an audit — it is a separate, reviewed operation, not a command with a flag.

---

## Deployment

Full instructions, including the local-node and `blockGasLimit` notes, are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The short version:

```bash
yarn install

# Local
nohup yarn node:chain > /tmp/thematic-node.log 2>&1 < /dev/null &
yarn deploy:local && yarn seed:local && yarn baskets:local
yarn dev                                    # http://localhost:3000

# BSC testnet — needs DEPLOYER_PRIVATE_KEY in .env
yarn deploy:testnet && yarn seed:testnet && yarn baskets:testnet
yarn verify:testnet                          # needs BSCSCAN_API_KEY
```

Every script is run through Yarn. There is no `npm` or `npx` step anywhere in the
repository — the workspace tree is Yarn-classic and installing with npm will not
produce a working one.

Each deploy writes `packages/contracts/deployments/<network>.json`, which the
later scripts read so the operator never re-types an address, and which the
frontend reads for a non-local chain.

```bash
yarn workspace @thematic/blockchain verify:reads
yarn workspace @thematic/blockchain run verify:reads bscTestnet   # or bscMainnet
```

Points the exact functions the frontend calls at a live node and compares the
contract's own `totalAssets()` against the read layer's independently computed
sum. Two routes, two numeric types, and they must agree — the fastest way to
catch a unit or ABI drift that a stubbed unit test cannot see. It defaults to
your local node and reads the matching `deployments/<network>.json` for any
network you name.

---

## Environment variables

Copy `.env.example` to `.env`. **Every variable is optional**: a fresh clone with
no `.env` runs `yarn dev` against a local node using the baked-in Hardhat
addresses.

### Read by the web app at build time — put these in `apps/web/.env.local`

Next loads env files only from the directory it runs in, and `next build` runs in
`apps/web/`. It never reads the repo-root `.env`. A `NEXT_PUBLIC_*` value placed
there produces a bundle where the variable is `undefined` — the local-chain
fallback, and a site that cannot read anything. The root `.env` is for the
deploy scripts and the `NEXT_PUBLIC_*` values in `.env.example` are templates for
this file, not entries to fill in where they sit.

Next.js inlines `NEXT_PUBLIC_*` into the browser bundle. Contract addresses are
public by definition and belong there; keys and paid RPC credentials do not.
These are inlined at build time, so changing one needs a rebuild, not a restart.

| Variable                                      | Meaning                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CHAIN_ID`                        | Which chain the app talks to. Must be 31337, 97 or 56 — a value outside that list is rejected at startup with the variable named, rather than producing a wallet pointed at nothing. Defaults to 31337. **A production build must name its chain**; see below.                                                                           |
| `NEXT_PUBLIC_ALLOW_LOCAL_CHAIN_IN_PRODUCTION` | Permits a production build pointed at the local Hardhat chain. For `yarn build && yarn start` against your own node, where `127.0.0.1` is reachable from the browser. On only when exactly `true`. Leave unset for anything deployed.                                                                                                    |
| `NEXT_PUBLIC_RPC_URL`                         | JSON-RPC endpoint for the chain `NEXT_PUBLIC_CHAIN_ID` names — one endpoint serves one chain, so the other supported chains fall back to their own public endpoints. Optional; the public fallback is fine for reading. The app issues one `eth_call` per basket and per component, so a busy session will rate-limit a public endpoint. |
| `NEXT_PUBLIC_FACTORY_ADDRESS`                 | The `BasketFactory` to create through and enumerate from. **The one address the app cannot function without on a remote chain.**                                                                                                                                                                                                         |
| `NEXT_PUBLIC_SETTLEMENT_TOKEN`                | The ERC-20 users deposit and redeem into. Every basket on a factory settles in whatever that factory was deployed with.                                                                                                                                                                                                                  |
| `NEXT_PUBLIC_PRICE_PROVIDER`                  | The `IPriceProvider` the baskets read component prices from.                                                                                                                                                                                                                                                                             |
| `NEXT_PUBLIC_DEX_ADAPTER`                     | The `IDexAdapter` component purchases route through.                                                                                                                                                                                                                                                                                     |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`        | Enables the WalletConnect connector. A project id is not a secret — it ships in the bundle and on every QR code the connector issues. Absent is a supported configuration; the injected connector still works.                                                                                                                           |

### Why a production build must name its chain

The default chain is the local Hardhat one, which is the right default for
`yarn dev`: a fresh clone with no `.env` has to land on a working app, and the
only node it can rely on is the developer's own.

It is the wrong default for a deployed bundle, and it fails in the worst way
available. An unset `NEXT_PUBLIC_RPC_URL` on chain 31337 falls through to viem's
own default for Hardhat, `http://127.0.0.1:8545` — correct on the build machine,
and meaningless everywhere else, because `127.0.0.1` in a deployed bundle is the
_visitor's_ computer. Nothing is listening there, so every read fails with a bare
`Failed to fetch` and each page renders an error where its content should be.

The build itself looks entirely healthy, which is the actual defect — so
`next build` now fails loudly when the resolved chain is 31337 and the override
above is not set. 31337 is still permitted, but only when stated explicitly:
the distinction being enforced is between a chain someone chose and one they
fell into. `next dev` is untouched.

### Read by the web app at request time — server only

These go in `apps/web/.env.local` too. They are read by the Route Handlers that
sign requests to the Binance Web3 API, on the server, per request.

| Variable                  | Meaning                                                                                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BINANCE_WEB3_API_KEY`    | The Web3 API key. Sent as `X-OC-APIKEY`.                                                                                                                                                                                                                         |
| `BINANCE_WEB3_API_SECRET` | The HMAC-SHA256 key the request signature is computed with. It is never sent to Binance, and it must never be given a `NEXT_PUBLIC_` prefix — Next inlines those into the browser bundle, which would publish the key that signs every request to every visitor. |

Both are optional. Absent, the reference feed reports itself as unconfigured, the
reference columns are not rendered, and every other part of the app works
normally — this is a deliberate failure mode, not a degraded one. Neither
variable reaches the client bundle, and neither belongs in Vercel with a
`NEXT_PUBLIC_` prefix.

Read [Reference prices](#reference-prices) for what they are used for and
`/diagnostics` for whether they work.

### Read by Hardhat only

These never reach the browser.

| Variable               | Meaning                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BSC_TESTNET_RPC_URL`  | RPC for the `bscTestnet` network. Falls back to a public BNB Chain endpoint, adequate for deploying but not for anything that must land promptly.                                                                                     |
| `BSC_MAINNET_RPC_URL`  | Same, for `bscMainnet`. Only used by read-only tasks — the deploy scripts refuse chain 56.                                                                                                                                            |
| `DEPLOYER_PRIVATE_KEY` | The key transactions are sent from, 32 bytes with the `0x` prefix. Local development does not need one; `deploy:local` uses the node's own unlocked accounts. **Use a key created for deployment and nothing else.** Never commit it. |
| `BSCSCAN_API_KEY`      | Contract verification. Required by `verify:testnet`, which fails with an authentication error rather than silently skipping when it is unset.                                                                                         |
| `REPORT_GAS`           | Prints a gas report after `hardhat test`. On only when exactly `true`. `yarn test:gas` sets it.                                                                                                                                       |
| `FORCE`                | Lets `baskets:local` create the sample baskets on a node that already has them. Without it the script refuses rather than deploying a second copy and doubling every figure on the discover page.                                     |

**Never commit `.env`.** Only `.env.example` is tracked, and it holds
placeholders. If a real key has been committed, move the funds and treat the key
as burned — removing it from history is not enough.

---

## Testing

```bash
yarn test              # contracts: 100 tests, no chain required
yarn test:gas          # with a per-method gas report
yarn lint              # prettier, contracts and web
yarn typecheck         # tsc --noEmit, web
yarn format            # the canonical formatter (prettier 3.6)
yarn build             # contracts + web production build
yarn check:contracts   # ABI export is current, then the suite
```

Six suites in `packages/contracts/test/`, covering what the contract _claims_
rather than only what it computes:

| Suite                      | Covers                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `BasketFactory.test.ts`    | Composition validation, the ceilings, the registry, allowlist enforcement.                            |
| `Basket.deposit.test.ts`   | The deposit sequence, fee-on-transfer rejection, slippage guards, reentrancy, pause.                  |
| `Basket.redeem.test.ts`    | The redemption sequence, the zero-payout refusal, per-swap floors, reentrancy.                        |
| `Basket.fees.test.ts`      | The split summing exactly, the two claim paths, who may not claim, reentrancy on both.                |
| `Basket.valuation.test.ts` | `totalAssets`, `navPerShare`, the empty-basket branch across decimal regimes, unpriceable components. |
| `Basket.access.test.ts`    | The trust model — including an ABI enumeration asserting a live basket has **zero** `set*` functions. |

The mocks earn their place here: `MockCallbackERC20` fires a callback after every
balance change, so the reentrancy guard is tested rather than assumed;
`MockShortchangingAdapter` is a venue that fills badly, so the basket's own
slippage guard is reachable; `MockFeeOnTransferERC20` proves the deposit
rejection.

[docs/SECURITY.md §8](docs/SECURITY.md) maps each security claim to the test
that proves it, and names the two gaps: fee-on-transfer _component_ tokens are
untested, and the swap paths run against a mock router with seeded reserves
rather than a fork of real PancakeSwap liquidity.

---

## Security

Read [docs/SECURITY.md](docs/SECURITY.md) in full before deploying anywhere that
holds value. The summary:

- **Three immutable roles, no `Ownable`, no admin transfer.** The protocol admin
  can pause indefinitely and withdraw accrued _protocol_ fees. It cannot change a
  live basket's fees, composition, provider or adapter; it cannot mint; it cannot
  move holder assets or reach the creator's fees.
- **The price provider is the larger trust surface.** Its admin can change prices
  for baskets already deployed, and prices set the slippage floors. In a
  production deployment it must be a real feed and a different key from the
  protocol admin.
- **One open finding:** `protocolTreasury` is recorded at construction and never
  used — `withdrawProtocolFees(to)` sends to an admin-named address. Documented
  rather than patched, because changing it is a revenue-sharing decision. See
  [docs/SECURITY.md §2.4](docs/SECURITY.md).
- **Pause halts deposit and redemption, not transfers.** Holders keep custody.
- **Reentrancy guards on all four state-changing entry points**, each tested with
  a hostile callback token that also asserts nothing moved.
- **The contracts are unaudited.** They are a working prototype of the mechanism.

---

## Roadmap

Not implemented, and not claimed.

**Community baskets.** Today a basket is created by whoever deploys it and its
fees accrue to that address alone. The next step is shared ownership of a basket
— several creators on one thesis, and a claim on its fees that can be split or
transferred — which needs a revenue-sharing token. ERC-7641 is the design
reference; nothing in this repository implements it, and none of it should be
claimed until it does.

**Dividend handling.** Tokenized equities pay dividends; this basket does not
distinguish one from a price move. A dividend arrives as settlement the basket
did not earn through a swap, gets counted in `totalAssets()`, and raises NAV for
whoever holds at that moment. Correct handling means recognising the payment,
deciding whether to distribute or reinvest, and doing it without a keeper.

**Automated rebalancing.** Weights are fixed at deployment and never drift back
— a basket's composition is whatever its deposits bought, and a component that
runs appreciates into a larger share of NAV than its weight states. Restoring the
stated weights needs either a keeper or a permissionless rebalance with a bond,
and both need care around who pays the swap cost.

**Additional wallets.** Injected and WalletConnect today. Coinbase Wallet and
Safe are the ones that matter for BNB Chain; both need a connector and a
passkey/multisig-aware transaction path, not just a config entry.

**Additional DEXs.** `PancakeSwapAdapter` is one `IDexAdapter` over
PancakeSwap V2. The interface is the seam — a V3 adapter, or one that routes
across venues for a better fill, is a new implementation rather than a change to
the basket. The basket would need a way to choose among them, which is exactly
the kind of decision that should not be reachable after deployment.

**Better indexing.** The app enumerates the factory and reads each basket
directly, which is honest and slow: one `eth_call` per basket per field, against
a public endpoint that will rate-limit a busy session. An indexer fed by the
events the contracts already emit — `BasketCreated`, `Deposit`, `Redeem` — would
make discovery and history cheap without a backend holding the authoritative
numbers. The chain stays the source of truth; the index is a cache.

**Advanced revenue sharing.** The current split is one creator share per basket,
fixed at deployment. Referrers, a revenue share that vests, per-component
attribution, and a protocol fee that can be redirected without an admin deciding
the recipient each time — that last one is the open finding in
[docs/SECURITY.md §2.4](docs/SECURITY.md) seen as a feature rather than a defect.
