# Deployment

How to stand the protocol up locally, on BSC testnet, and — with a checklist
rather than a command — on mainnet.

The scripts deploy the **mock asset stack** and refuse to run against BSC
mainnet. That refusal is deliberate and is not a flag to flip; see §5.

---

## 1. Prerequisites

| Requirement | Version          | Note                                                                                                                     |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Node        | ≥ 20.0.0         | Enforced by `engines` in the root `package.json`.                                                                        |
| Yarn        | 1.22.x (classic) | Workspaces. **Yarn only** — the repository has no `package-lock.json` and `npm install` will not produce a working tree. |

```bash
yarn install
yarn compile          # writes artifacts/, typechain-types/
yarn test             # 100 tests, no chain required
```

`yarn install` at the root installs all four workspaces. There is no per-package
install step.

---

## 2. Local deployment

Runs the whole stack against a Hardhat node: mock settlement asset, eight mock
equity tokens, an administrator-set price feed, a constant-product DEX seeded
from a reserve model, the adapter in front of it, and the factory.

### 2.1 Start the chain

```bash
nohup yarn node:chain > /tmp/thematic-node.log 2>&1 < /dev/null &
```

**The `nohup`, the redirect and the `&` are all load-bearing** if you are
starting the node from a shell that will hand it to a background job — an agent
session, a script, an SSH command. `hardhat node` is a foreground server; a
plain `yarn node:chain &` under such a shell receives `SIGHUP` when the job is
reaped and dies silently, and every later step then fails with a connection
refused against a node that was never running.

Confirm it is up before continuing:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  http://127.0.0.1:8545
# {"jsonrpc":"2.0","id":1,"result":"0x7a69"}   (0x7a69 = 31337)
```

### 2.2 Deploy

```bash
yarn deploy:local     # factory + mock stack
yarn seed:local       # mint demo tokens, seed DEX liquidity
yarn baskets:local    # create the three sample baskets
```

Each script prints what it deployed and writes
`packages/contracts/deployments/localhost.json`. The later scripts read the
addresses from that file, so they must run in this order and against the same
node. Re-running `seed:local` is safe — it deepens the pools. Re-running
`deploy:local` on a node that already has a deployment is not: it deploys a
second factory, and the frontend will still be pointed at whichever address is
in the metadata file.

`baskets:local` refuses to run twice and says so. `FORCE=true` overrides it,
which is only what you want when you deliberately want a second copy.

### 2.3 Point the app at it

Nothing to do. With no `.env`, the app falls back to the addresses Hardhat
derives from its default mnemonic, and the deploy scripts above produce exactly
those. `isLocalDefaults` is true and the interface says the figures come from a
local mock deployment.

```bash
yarn dev              # http://localhost:3000
```

If you deployed from a different mnemonic or a non-default node, copy
`.env.example` to `.env` and set `NEXT_PUBLIC_FACTORY_ADDRESS` and friends from
the metadata file.

### 2.4 Check the read layer

```bash
yarn workspace @thematic/blockchain verify:reads
```

This points the exact functions the frontend calls at the live node and prints
what comes back, then compares the contract's own `totalAssets()` against the
sum of component values the read layer computes independently — two different
routes, two different numeric types, and they must agree. It is the fastest way
to catch a unit or ABI drift that a unit test with stubs would not see. It needs
a deployed and seeded node.

---

## 3. A note on `blockGasLimit`

Worth reading before you touch `hardhat.config.ts`, because the failure it
describes is confusing.

Hardhat 2.29 defaults the block gas limit to 60 000 000. Its EDR node enforces
the **EIP-7825 per-transaction gas cap of 2²⁴ = 16 777 216** independently.
Worse, `@nomicfoundation/hardhat-ethers` copies the configured block limit onto
every transaction it sends to a node reached over `localhost` — so at the
default, _every_ transaction is rejected before it executes, with a message
about the gas cap that points at the transaction rather than at the config.

The repository sets `blockGasLimit: 16_000_000`, comfortably under the cap and
roughly three times the largest transaction the scripts send (deploying the
factory is about 5.0M gas, creating a basket about 2.7M). **Do not raise it to
the cap itself.** The boundary buys nothing here and is a needless risk to sit
on.

---

## 4. BSC testnet

### 4.1 Configure

```bash
cp .env.example .env
```

Fill in:

```bash
BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.bnbchain.org:8545
DEPLOYER_PRIVATE_KEY=0x...     # a key created for deployment and nothing else
BSCSCAN_API_KEY=...            # required before verify:testnet, not before deploy

NEXT_PUBLIC_CHAIN_ID=97
```

`BSCSCAN_API_KEY` is required by the verify step and by nothing else. Fund the
deployer with testnet BNB from a faucet — the full sequence costs a few
hundredths of a BNB.

**The deployer key becomes three privileged addresses.** `01-deploy-factory.ts`
passes `deployer.address` as the factory's `protocolAdmin`, its
`protocolTreasury` and the price provider's admin. That is fine on a testnet and
is exactly what you must not do on mainnet (§5).

### 4.2 Deploy

```bash
yarn deploy:testnet
yarn seed:testnet
yarn baskets:testnet
```

Same order, same metadata contract — the file lands at
`packages/contracts/deployments/bscTestnet.json`.

`NEXT_PUBLIC_*` values in `.env` do not affect the deploy scripts; set them from
the metadata file afterwards so the app reads the testnet deployment:

```bash
NEXT_PUBLIC_FACTORY_ADDRESS=0x...
NEXT_PUBLIC_SETTLEMENT_TOKEN=0x...
NEXT_PUBLIC_PRICE_PROVIDER=0x...
NEXT_PUBLIC_DEX_ADAPTER=0x...
```

### 4.3 Verify

```bash
yarn verify:testnet
```

Publishes the source of the factory, the price provider, the adapter, the router,
the settlement token and every component to BscScan, reconstructing each
constructor's arguments from the metadata file. It is idempotent: an
already-verified contract is reported and skipped rather than treated as a
failure. It refuses to run anywhere but chain 97, and it fails loudly if
`BSCSCAN_API_KEY` is unset rather than silently skipping.

Unverified contracts are unauditable contracts. If the deploy is part of a
submission, verify before anyone looks at it.

### 4.4 On chain 97, the assets are still mock

`needsMockStack()` returns true for 31337, 1337 and 97, so the testnet
deployment uses the same openly-mintable tokens and the same administrator-set
price feed as local. There is no liquid tokenized-equity market on BSC testnet
to point at instead. Every figure the app shows carries a notice saying so, and
that notice is not decoration — see `docs/ECONOMIC-MODEL.md` §9.

---

## 5. Mainnet

**Not automated, deliberately.** `assertNotMainnet()` is the first statement in
every deploy and seed script and throws on chain 56:

> This script deploys mock tokens and a mock price feed and refuses to run on
> BNB Smart Chain mainnet. Mainnet requires real infrastructure addresses — see
> docs/DEPLOYMENT.md.

A mainnet deployment is a different script pointed at real addresses, and it
needs all of the following settled first. None of them are code changes in this
repository.

**Before deploying:**

1. **Real infrastructure.** A production `IPriceProvider` backed by an audited
   feed, and a `PancakeSwapAdapter` pointed at the live PancakeSwap V2 router.
   Neither can be swapped out afterwards — both are `immutable` per basket.
2. **A multisig, not an EOA, for `protocolAdmin` and for the price provider's
   admin.** These must be different keys: the provider admin has strictly more
   practical power over a live basket than the basket admin does
   (`docs/SECURITY.md` §2.3), and collapsing them removes the only separation
   that exists.
3. **A real settlement token.** Every basket on a factory settles in the token
   that factory was deployed with. It must not be fee-on-transfer — the deposit
   path rejects those outright.
4. **An audit.** The contracts are unaudited. `docs/SECURITY.md` lists the known
   limitations including one open finding — `protocolTreasury` is recorded but
   `withdrawProtocolFees` sends wherever the admin names.
5. **A decision on the ceilings.** `FACTORY_DEFAULTS` is `[50, 0, 8000, 300]` —
   a 0.5% deposit fee, no redemption fee, an 80% creator share, a 3% slippage
   allowance. Review them against real liquidity before the first basket exists;
   the absolute maxima (`2% / 2% / 90% / 10%`) are compile-time constants no role
   can raise.

**Deploying:**

There is no `yarn deploy:mainnet`. Write the deployment as a reviewed,
separately-audited operation that deploys `BasketFactory` directly with the
addresses above, and record it in `deployments/bscMainnet.json` in the same
shape as the other networks so `verify:reads` and the frontend can read it.

**After deploying:**

- Verify every contract on BscScan.
- Deploy the first basket yourself and walk a deposit and a redemption through
  it before telling anyone the address. `verify:reads` is written for a local
  node; its checks are the ones worth reproducing by hand against mainnet.
- Confirm the app's `NEXT_PUBLIC_CHAIN_ID=56` build reads the right factory and
  that the mock-data notices are gone, since on mainnet they would be false.

---

## 6. Deployment metadata

`packages/contracts/deployments/<network>.json`, written by the deploy script
and read by every script after it.

```jsonc
{
  "network": "bscTestnet",
  "chainId": 97,
  "deployedAt": "2026-...",
  "deployer": "0x...",
  "contracts": {
    "settlementToken": "0x...",
    "priceProvider": "0x...",
    "dexAdapter": "0x...",
    "router": "0x...",
    "factory": "0x...",
    "wrappedNative": "0x...",
    "components": { "mNVDA": "0x...", "...": "0x..." },
  },
  "roles": {
    "protocolAdmin": "0x...",
    "protocolTreasury": "0x...",
    "priceProviderAdmin": "0x...",
  },
  "baskets": [{ "name": "AI Winners", "symbol": "AIW", "address": "0x...", "creator": "0x..." }],
  "transactions": { "factory": "0x...", "...": "0x..." },
}
```

Addresses and transaction hashes only — never a key. The file is what makes the
seed, basket and verify scripts resumable without an operator re-typing
anything.

---

## 7. Troubleshooting

**Every transaction is rejected with a gas-cap error.** The block gas limit is
at or above 16 777 216. See §3.

**`No deployment found for network "localhost"`.** The deploy script has not run
against _this_ node. A fresh `hardhat node` is an empty chain; metadata from a
previous run does not apply. Run the sequence from §2.2.

**`baskets:local` refuses to run.** A basket already exists on this node and the
script will not silently double every figure on the discover page.
`FORCE=true yarn baskets:local` when that is what you want.

**The app shows no baskets but the deploy succeeded.** The app reads baskets
from the factory by enumerating it on-chain, so an empty list means the factory
address the app has does not match the one that was deployed. Check
`NEXT_PUBLIC_FACTORY_ADDRESS` against `deployments/<network>.json`.

**`verify:testnet` fails with an authentication error.** `BSCSCAN_API_KEY` is
unset or wrong. The script names it rather than skipping.

**The local node dies between steps.** See §2.1 — it was started without
`nohup`.

---

## 8. Gas

```bash
yarn test:gas                                   # per-method table after the suite
yarn workspace @thematic/contracts run test:gas
```

The basket loops over its components on deposit and redemption, so cost scales
with the composition: a three-component basket is materially cheaper to use than
a ten-component one. That is inherent to the design — the basket buys and sells
each component individually so the holder owns real tokens rather than a claim —
and it is why `MAX_COMPONENTS` is 10.

Factory deployment is roughly 5.0M gas and basket creation roughly 2.7M. Both
sit well under the EIP-7825 cap, which is what makes the local block limit in §3
workable.
