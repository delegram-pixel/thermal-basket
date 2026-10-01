# Thematic Baskets for Tokenized Stocks


## PHASE 0: FIRST 48 HOURS (Validation)

### What You're Validating
Can you write smart contracts solo? Before committing 6 weeks to this (vs arbitrage monitor), prove it.

### Day 1: Understand the Weave Model (3 hours)

**Read in order:**
1. What Weave does: https://weave.finance/ (15 min) — note the UI, creator flow, revenue model
2. ERC-7641 spec (Revenue Sharing): https://eips.ethereum.org/EIPS/eip-7641 (20 min, skim OK)
3. Thematic investing (why it matters): BlackRock AI ETF sales numbers (10 min Google)

**Mental model to build:**
```
User creates basket: "AI Winners" = [NVDA, MSFT, GOOGL, META, TSLA]
  ↓
Basket token (AIW) mints automatically (1 AIW = equal weight of all 5)
  ↓
Users buy AIW token (don't buy individual stocks)
  ↓
Creator earns 80% of management fees
  ↓
Binance/Protocol earns 20%
```

**Question to answer:** Can you replicate this on BNB without building Weave from scratch?

### Day 2: Write Your First Smart Contract (4 hours)

**Goal:** Deploy a simple ERC-20 basket token to BSC testnet.

**What you're building:**
- A contract that mints a "basket token" (e.g., AIWEB = AI Winners Basket)
- Token = equal parts NVDA + MSFT + GOOGL
- Users can deposit USDT, get AIWEB back
- Creator can withdraw fees

**Contract Template (Don't panic, this is 95% copy-paste):**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract ThematicBasket is ERC20, Ownable, Pausable {
    // Component tokens (NVDA, MSFT, GOOGL tokenized versions)
    address[] public componentTokens;
    uint256[] public weights; // e.g., [33, 33, 34] for equal weight
    
    // Creator info
    address public creator;
    uint256 public creatorFeePercent = 80; // Creator gets 80% of fees
    uint256 public protocolFeePercent = 20; // Protocol gets 20%
    
    // Fee tracking
    uint256 public accumulatedCreatorFees;
    uint256 public accumulatedProtocolFees;

    constructor(
        string memory name,
        string memory symbol,
        address[] memory _components,
        uint256[] memory _weights,
        address _creator
    ) ERC20(name, symbol) {
        require(_components.length == _weights.length, "Mismatch");
        require(_components.length > 0, "Need components");
        
        componentTokens = _components;
        weights = _weights;
        creator = _creator;
    }

    // User deposits USDT, gets basket tokens in return
    function depositUSDT(uint256 amountUSDT) external returns (uint256 basketTokensReceived) {
        // Fee: 0.5% of deposit
        uint256 fee = (amountUSDT * 5) / 1000;
        uint256 amountAfterFee = amountUSDT - fee;
        
        // Split fee
        accumulatedCreatorFees += (fee * creatorFeePercent) / 100;
        accumulatedProtocolFees += (fee * protocolFeePercent) / 100;
        
        // Mint basket tokens (simplified: 1 USDT = 1 basket token)
        basketTokensReceived = amountAfterFee;
        _mint(msg.sender, basketTokensReceived);
        
        emit Deposit(msg.sender, amountUSDT, basketTokensReceived);
    }

    // Creator withdraws accumulated fees
    function withdrawCreatorFees() external {
        require(msg.sender == creator, "Only creator");
        uint256 amount = accumulatedCreatorFees;
        accumulatedCreatorFees = 0;
        
        // Transfer USDT to creator (would actually call USDT.transfer here)
        // For now, just event logging
        emit CreatorFeeWithdrawn(creator, amount);
    }

    // View: Get basket composition
    function getComposition() external view returns (
        address[] memory tokens,
        uint256[] memory pcts
    ) {
        return (componentTokens, weights);
    }

    event Deposit(address indexed user, uint256 amountIn, uint256 basketTokensOut);
    event CreatorFeeWithdrawn(address indexed creator, uint256 amount);
}
```

**Deploy to BSC Testnet:**
- Use Hardhat (easiest for solo dev)
- Get testnet BNB faucet: https://testnet.binance.org/faucet
- Deploy command: `npx hardhat run scripts/deploy.js --network bscTestnet`
- **If this works in 1 hour:** Proceed to Phase 1
- **If stuck 2+ hours:** Ask Hardhat Discord (response time ~30 min)

### Day 2 Evening: Commit Decision
- ✅ Contract deploys to testnet → **Proceed to Phase 1**
- ⚠️ Contract deploys but unsure how it works → **Spend 1 extra day learning Solidity fundamentals**
- ❌ Contract won't compile → **Reach out to Hardhat Discord or BNB Telegram NOW**

---

## PHASE 1: WEEKS 1-2 (Core Smart Contracts + Basic UI)

### Goal
Build the **smart contract system for basket creation, trading, and fee distribution**. This is 70% of the work and all blockchain.

### Week 1 (Oct 1-4)

**Mon-Tue: Multi-Component Basket Contract (8 hours)**

What you're building:
```
BasketFactory contract (like OpenZeppelin factory pattern)
  ↓
User says: "Create 'AI Winners': 30% NVDA, 40% MSFT, 30% GOOGL"
  ↓
Factory deploys new ThematicBasket contract
  ↓
Basket has deposit/withdraw functions
  ↓
Auto-tracks creator fees + protocol fees
```

**Contract Structure:**

```solidity
// BasketFactory.sol
pragma solidity ^0.8.0;

contract BasketFactory {
    address[] public baskets;
    mapping(address => address) public basketToCreator;
    
    event BasketCreated(
        address indexed basketToken,
        address indexed creator,
        string name,
        address[] components,
        uint256[] weights
    );
    
    function createBasket(
        string memory name,
        string memory symbol,
        address[] memory components,
        uint256[] memory weights
    ) external returns (address) {
        // Deploy new ThematicBasket
        ThematicBasket basket = new ThematicBasket(
            name,
            symbol,
            components,
            weights,
            msg.sender
        );
        
        baskets.push(address(basket));
        basketToCreator[address(basket)] = msg.sender;
        
        emit BasketCreated(address(basket), msg.sender, name, components, weights);
        return address(basket);
    }
    
    function getBasketCount() external view returns (uint256) {
        return baskets.length;
    }
}
```

**Deliverables by Tuesday EOD:**
- [ ] BasketFactory contract deployed to testnet
- [ ] Can create new basket via factory
- [ ] Each basket has deposit/withdraw functions
- [ ] Fee tracking works
- [ ] Test with 3 sample baskets: "AI Winners", "Semiconductor Kings", "Finance Leaders"

**Wed-Thu: DEX Integration (Swap Baskets) (8 hours)**

What you're building:
```
Basket token (AIWEB) needs to be tradable
  ↓
User wants to sell 10 AIWEB for USDT
  ↓
Basket is broken down into components (30% NVDA, 40% MSFT, 30% GOOGL)
  ↓
Each component swapped for USDT on PancakeSwap
  ↓
USDT sent back to user (minus fee)
```

**Add to ThematicBasket contract:**

```solidity
interface IPancakeRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract ThematicBasket is ERC20, Ownable {
    address constant PANCAKESWAP_ROUTER = 0x10ED43C718714eb63d5aA57B78f6c768a25883A7;
    address constant USDT_BSC = 0x55d398326f99059fF775485246999027B3197955;
    
    // User withdraws basket: AIWEB → NVDA + MSFT + GOOGL → USDT
    function withdrawToUSDT(uint256 basketAmount, uint256 minUSDT) external returns (uint256) {
        // Burn basket tokens
        _burn(msg.sender, basketAmount);
        
        // For each component, calculate share and swap to USDT
        uint256 totalUSDT = 0;
        for (uint i = 0; i < componentTokens.length; i++) {
            uint256 componentShare = (basketAmount * weights[i]) / 100;
            
            // Swap component to USDT (simplified)
            address[] memory path = new address[](2);
            path[0] = componentTokens[i];
            path[1] = USDT_BSC;
            
            IPancakeRouter(PANCAKESWAP_ROUTER).swapExactTokensForTokens(
                componentShare,
                0,
                path,
                address(this),
                block.timestamp + 300
            );
        }
        
        // Get remaining USDT balance and send to user
        uint256 usdtBalance = IERC20(USDT_BSC).balanceOf(address(this));
        require(usdtBalance >= minUSDT, "Slippage too high");
        IERC20(USDT_BSC).transfer(msg.sender, usdtBalance);
        
        return usdtBalance;
    }
}
```

**Deliverables by Thursday EOD:**
- [ ] Can deposit USDT, get basket tokens
- [ ] Can burn basket tokens, get USDT back
- [ ] Swaps work on testnet (test with small amounts)
- [ ] Fee tracking updates correctly

**Fri: Testing + Documentation (4 hours)**

- [ ] Write contract README (what each function does)
- [ ] Test deposit/withdraw flow end-to-end
- [ ] Verify fees accumulate correctly
- [ ] Screenshot proof on testnet (Etherscan)
- [ ] Deploy to mainnet OR keep on testnet (decision: depends on confidence)

### Week 2 (Oct 5-11)

**Mon-Tue: Frontend Dashboard (8 hours)**

What you're building:
```
React dashboard showing:
- List of all baskets (AI Winners, Finance Leaders, Semiconductors)
- Basket composition (% of each stock)
- Current NAV (Net Asset Value = total value)
- Your holdings (if you own any baskets)
- Deposit/Withdraw buttons
```

**Tech Stack:**
- React
- Ethers.js (for contract calls)
- MetaMask integration (for wallet connection)
- Tailwind CSS (styling)

**Code Template:**

```jsx
import React, { useState, useEffect } from "react";
import { ethers } from "ethers";

const FACTORY_ADDRESS = "0x..."; // Your deployed factory
const FACTORY_ABI = [...]; // Contract ABI

export default function Baskets() {
  const [baskets, setBaskets] = useState([]);
  const [signer, setSigner] = useState(null);

  useEffect(() => {
    connectWallet();
    loadBaskets();
  }, []);

  async function connectWallet() {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    setSigner(signer);
  }

  async function loadBaskets() {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const factory = new ethers.Contract(
      FACTORY_ADDRESS,
      FACTORY_ABI,
      provider
    );
    
    const count = await factory.getBasketCount();
    const basketsArray = [];
    
    for (let i = 0; i < count; i++) {
      const addr = await factory.baskets(i);
      // Load basket details (name, components, weights)
      basketsArray.push({ address: addr });
    }
    
    setBaskets(basketsArray);
  }

  async function depositToBasket(basketAddress, amountUSDT) {
    const contract = new ethers.Contract(
      basketAddress,
      BASKET_ABI,
      signer
    );
    
    const tx = await contract.depositUSDT(ethers.parseUnits(amountUSDT, 6));
    await tx.wait();
    
    alert("Deposit successful!");
    loadBaskets(); // Refresh
  }

  return (
    <div className="min-h-screen bg-dark-bg text-text-primary p-6">
      <h1 className="font-heading text-4xl font-bold mb-8">Thematic Baskets</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {baskets.map((basket) => (
          <div key={basket.address} className="bg-dark-card p-6 rounded border border-dark-card">
            <h2 className="font-heading text-2xl mb-4">{basket.name}</h2>
            <p className="text-text-secondary mb-4">Components: {basket.components.join(", ")}</p>
            <button
              onClick={() => depositToBasket(basket.address, "100")}
              className="w-full bg-profit text-dark-bg py-2 rounded font-bold"
            >
              Deposit 100 USDT
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Deliverables by Tuesday EOD:**
- [ ] React app loads all baskets from blockchain
- [ ] Can deposit USDT to any basket
- [ ] Can withdraw basket tokens for USDT
- [ ] Shows basket composition
- [ ] Responsive design (mobile + desktop)

**Wed-Thu: Creator Dashboard (6 hours)**

Add a separate "Creator" section where creators can:
- [ ] See all baskets they created
- [ ] View accumulated fees
- [ ] Withdraw fees
- [ ] Edit basket composition (for future versions)

**Fri: Deploy Frontend (2 hours)**

- [ ] Frontend to Vercel (free)
- [ ] Connect to testnet first (safer)
- [ ] Test deposit/withdraw flow
- [ ] Verify on Etherscan that transactions land on blockchain

---

## PHASE 2: WEEKS 3-4 (Revenue Sharing + Advanced Features)

### Goal
Add **ERC-7641 revenue sharing**, **rebalancing logic**, and **dividend handling**.

### Week 3: ERC-7641 Revenue Sharing (8 hours)

**What it is:** Standard for automatic revenue distribution
- Creator gets 80% of fees
- Protocol gets 20%
- Automatic payouts (no manual claims)

**Implementation:**

```solidity
// Simplified ERC-7641 implementation
contract ThematicBasket is ERC20 {
    mapping(address => uint256) public creatorShares; // 80%
    mapping(address => uint256) public protocolShares; // 20%
    
    function distributeFees(uint256 amount) internal {
        uint256 creatorFee = (amount * 80) / 100;
        uint256 protocolFee = (amount * 20) / 100;
        
        creatorShares[creator] += creatorFee;
        protocolShares[PROTOCOL_ADDRESS] += protocolFee;
        
        emit FeeDistributed(creator, creatorFee, PROTOCOL_ADDRESS, protocolFee);
    }
    
    function claimShares() external {
        uint256 amount = creatorShares[msg.sender];
        require(amount > 0, "No shares");
        
        creatorShares[msg.sender] = 0;
        IERC20(USDT_BSC).transfer(msg.sender, amount);
        
        emit SharesClaimed(msg.sender, amount);
    }
}
```

**Deliverables by Wed EOD:**
- [ ] ERC-7641 logic implemented
- [ ] Fees automatically split 80/20
- [ ] Creator can claim shares
- [ ] Protocol fees accrue to contract owner

### Week 3-4: Dividend Handling (Advanced, Optional)

**Real problem:** What happens when NVDA pays dividends on-chain?

**Simple solution (for MVP):**
- Dividends accumulate in contract
- Creator can decide: reinvest or distribute
- Rebuild basket if composition drifts > 5%

**Advanced (don't do this week 3, save for polish):**
- Automatic dividend reinvestment
- Automatic rebalancing on schedule

**For now:** Just log it, don't solve it. You can win without this.

### Week 4: Community Baskets (Optional UI)

Allow any user to:
- [ ] Create their own basket
- [ ] Share with friends
- [ ] Earn fees if others invest in their basket

**This is 90% UI, minimal smart contract changes:**
- Add `creator` field to contract
- Add "My Baskets" page to React app
- Allow users to submit basket ideas (name, components, weights)

---

## PHASE 3: WEEKS 5-6 (Deployment + Submission)

### Week 5: Mainnet Deployment + Hardening

**Mon-Tue: Security Checks**

Before deploying to mainnet, you need:
- [ ] No obvious bugs (test deposit/withdraw 10+ times)
- [ ] Gas optimization (basic: combine loops, avoid storage reads)
- [ ] Error handling (all require() statements have messages)

**Code review checklist:**
```
- [ ] All external functions have access control (only creator can withdraw fees)
- [ ] Math checks: no division by zero, overflow/underflow impossible
- [ ] Token approvals are safe (check allowance before transfer)
- [ ] Re-entrance protection (if needed; probably not for this MVP)
```

**Wed-Thu: Deploy to Mainnet**

- [ ] Deploy factory to BSC mainnet
- [ ] Create sample baskets (AI Winners, Finance, Semiconductors)
- [ ] Have creator deposit and earn fees (proof for pitch)
- [ ] Mainnet addresses go in README

**Fri: Create Demo Video (3 hours)**

**Your 4-minute Demo:**
1. Connect wallet to dApp (30 sec)
2. Show list of baskets (20 sec)
3. Deposit USDT, get basket tokens (40 sec)
4. Show composition breakdown (30 sec)
5. Withdraw back to USDT (40 sec)
6. Show creator fees accumulating (30 sec)
7. Explain the problem + why it matters (1 min)

---

### Week 6: Final Submission

**Mon-Tue: Cleanup + README**

```markdown
# Thematic Baskets for Tokenized Stocks

## What it does
Allows users to invest in thematic baskets of tokenized stocks (e.g., "AI Winners" = NVDA + MSFT + GOOGL).
Creators earn 80% of management fees via ERC-7641 revenue sharing.

## Live Links
- Mainnet contract: 0x...
- Frontend: https://baskets.example.com
- Demo video: https://youtube.com/...

## How it works
1. Creator defines a basket (name, stocks, weights)
2. Factory deploys ERC-20 token for that basket
3. Users deposit USDT, get basket tokens
4. Basket is automatically balanced (equal or weighted allocation)
5. Users withdraw basket tokens, get USDT back
6. Creator earns 80% of 0.5% deposit fee

## Tech Stack
- Smart Contracts: Solidity, Hardhat
- Frontend: React, Ethers.js, Tailwind
- Blockchain: BNB Smart Chain
- DEX: PancakeSwap for component swaps

## Deployment
All contracts on BSC mainnet. See addresses in .env.example.
```

**Wed-Thu: Developer Experience Report (3 hours)**

```
## Binance Web3 API + Smart Contracts Developer Experience Report

### What Worked Well
- RWA token search API is fast and comprehensive (found all 709 stocks in seconds)
- Token price endpoints have good latency (< 100ms)
- Hardhat setup is smooth (BSC testnet faucet is reliable)
- OpenZeppelin contracts are battle-tested (used ERC-20 + Ownable from their library)

### What Was Frustrating
- No "get all tokenized stocks with prices" endpoint (had to loop 709 times, hit rate limits)
  - Suggestion: Add batch endpoint for bulk price queries
  
- Dividend handling not documented
  - Which tokenized stocks pay dividends on-chain? 
  - How do they transfer dividends to token holders?
  - No example in docs
  - Suggestion: Add dividend section in RWA docs with example

- Reference price vs on-chain price confusion (same issue as arbitrage monitor)
  - Docs say "derived from on-chain" but don't show the formula
  - Suggestion: Add calculation example

- No standard for "basket token rebalancing" in DeFi docs
  - Had to invent it myself (custom contract logic)
  - Suggestion: Add "Baskets & Indices" section to docs

### Blockchain Specifics (Not Binance API)
- BNB Smart Chain gas fees are low ($0.01 per tx, great for retail)
- PancakeSwap integration is standard (good liquidity for component swaps)
- Testnet faucet is fast (< 1 min to get testnet BNB)

### Overall: 8/10
API is solid for basket creation. Main gap is batch endpoints and dividend documentation.
With those 2 improvements, would be 9.5/10.
```

**Fri: Submit All 3 Forms**

1. **Project Submission:**
   - Name: "Thematic Baskets for Tokenized Stocks"
   - Description: "Creator-driven platform for thematic baskets. Users invest in curated themes (AI Winners, Semiconductors). Creators earn 80% of fees via ERC-7641 revenue sharing."
   - Endpoints used: RWA Data (search, price, tokens), Trading API (swap quotes), Wallet API (balances)
   - Repo: GitHub link (public)
   - Video: 4-minute demo link
   - Deployed: https://baskets.example.com + contract addresses on BSC mainnet
   - Tracks: Main track (required), optional special prizes (Agentic Wallet if you add NL basket creation, Agent Studio if you build autonomous rebalancer)

2. **Developer Experience Report:**
   - Use template above (honest, specific feedback)
   - Same email as registration + project submission

3. **Confirm DX Report** in project form

---

## REALISTIC TIMELINE CHECK

| Week | Deliverable | Status | Blocker Risk |
|------|-------------|--------|--------------|
| **1** | Smart contracts (factory + basket) | Critical | Solidity learning curve (day 2 validation helps) |
| **2** | Frontend dashboard | Critical | Ethers.js wallet integration |
| **3** | ERC-7641 revenue sharing | Important | New standard, but boilerplate exists |
| **4** | Community baskets (optional) | Nice-to-have | Skip if time pressure |
| **5** | Mainnet deployment | Critical | Contract security checks |
| **6** | DX Report + submission | Critical | Honesty (don't BS) |

**Reality check:** Weeks 1-2 are 60% of the work. Weeks 3-4 are polish. Weeks 5-6 are deployment + submission.

---

## WHAT COULD DERAIL YOU

### 1. **Solidity Learning (Week 1 Blocker)**
**Problem:** Contracts won't compile or logic is wrong
**Solution:**
- Use OpenZeppelin boilerplate (don't write from scratch)
- Keep contracts simple (no fancy math, no assembly)
- Test early, test often on testnet
- **If stuck 4+ hours:** Ask Hardhat Discord or BNB Telegram

### 2. **Ethers.js Integration (Week 2)**
**Problem:** React can't call smart contracts
**Solution:**
- Use ethers.js v6 (latest, most documented)
- MetaMask is your only wallet (don't support 5 wallets)
- Test with small transactions first
- **If stuck 3+ hours:** Use ethers.js examples (https://docs.ethers.org/v5/cookbook/)

### 3. **Dividend Handling (Weeks 3-4)**
**Problem:** You don't know how dividends work on-chain
**Solution:**
- **For MVP:** Don't solve it. Just note: "Dividends not yet handled"
- Judges won't dock points for honest scoping
- Add to roadmap for future versions
- **Reality:** Only 2-3% of RWA tokens pay dividends yet

### 4. **Rate Limits (Week 2-3)**
**Problem:** API calls hit rate limit when loading all baskets
**Solution:**
- Cache basket list locally (don't query every pageload)
- Use GraphQL (if Binance offers it; they might by Oct)
- Fetch every 5 minutes instead of every second
- **Reality:** This won't block you unless you're sloppy

### 5. **Time Pressure (Week 5)**
**Problem:** You're running out of time
**Solution:**
- **By Oct 1:** Contracts deployed to testnet (don't wait for "perfect")
- **By Oct 5:** Frontend working on testnet
- **By Oct 8:** Mainnet deployment + video recorded
- **By Oct 10:** DX Report written
- **Oct 11:** Submit by noon UTC

---

## PARTNERSHIP WITH YOUR WEB3 PARTNER

**What they should handle:**
- Creator outreach (recruit 3-5 creators to build sample baskets on launch)
- Pitch narrative ("Why baskets? Because retail wants thematic exposure")
- Post-launch: community building, user acquisition
- Post-win: fundraising story

**What you handle:**
- Everything technical
- Shipping on time
- DX Report

**Weekly sync (30 min):**
- You: "Contracts working, frontend 80% done"
- Them: "Got 3 creators interested, they'll make sample baskets"
- Both: "What could go wrong next week?"

---

## WEEK 1 STARTING CHECKLIST

- [ ] Clone Hardhat project template
- [ ] Setup BSC testnet in Hardhat config
- [ ] Get testnet BNB faucet
- [ ] Deploy BasketFactory to testnet (Day 1)
- [ ] Write ThematicBasket contract (Day 2)
- [ ] Test deposit/withdraw flow locally (Day 3)
- [ ] Join BNB Builder Telegram
- [ ] Create Vercel + GitHub accounts
- [ ] Read OpenZeppelin ERC-20 docs (1 hour)

---

## SUCCESS METRIC

**By Oct 11, 12:00 UTC, you've won if:**
- ✅ 3-5 sample baskets deployed on mainnet
- ✅ Dashboard shows all baskets, allows deposit/withdraw
- ✅ Fees accumulate and creators can withdraw
- ✅ GitHub repo public, README clear
- ✅ Demo video showing end-to-end flow (create basket → deposit → earn fees)
- ✅ Honest DX report
- ✅ All 3 forms submitted

**You don't need:**
- ❌ Perfect smart contract security audit
- ❌ Mobile app (responsive web is fine)
- ❌ 100 baskets at launch
- ❌ Dividend reinvestment (optional for future)
- ❌ Fancy UI (functional beats pretty)

---

## RESOURCES YOU'LL ACTUALLY USE

**Solidity + Hardhat:**
- Hardhat docs: https://hardhat.org/docs
- OpenZeppelin contracts: https://github.com/OpenZeppelin/openzeppelin-contracts
- Solidity docs: https://docs.soliditylang.org/

**Frontend:**
- Ethers.js: https://docs.ethers.org/v6/
- React docs: https://react.dev/
- Tailwind CSS: https://tailwindcss.com/

**Blockchain Tooling:**
- BSC testnet faucet: https://testnet.binance.org/faucet
- BSC Mainnet: https://www.bscscan.com/
- MetaMask: https://metamask.io/

**Community:**
- BNB Builder Telegram: https://t.me/+MhiOLT0YUnlmNWFk
- Hardhat Discord: https://discord.gg/hardhat
- Stack Exchange (Solidity): https://ethereum.stackexchange.com/

---

## DIFFERENCE FROM ARBITRAGE MONITOR

| Dimension | Arbitrage Monitor | Thematic Baskets |
|-----------|-------------------|------------------|
| **Smart Contracts** | Optional (for execution) | Mandatory (core product) |
| **Blockchain Complexity** | Low (just fetch prices) | Medium (token minting, swaps, fees) |
| **Data Pipeline** | Heavy (real-time monitoring) | Light (just static composition) |
| **Frontend** | Dashboard + alerts | Dashboard + creator forms |
| **Time to MVP** | 1 week | 1.5 weeks |
| **Scalability** | Unlimited stocks | Limited by gas (10-20 components max) |
| **Revenue Model** | Who pays? Unknown | Clear (creator fees) |
| **Competition** | None on BNB | Weave exists (Robinhood Chain) |
| **Difficulty** | Medium | High |

**Verdict:** Thematic Baskets is harder but has better revenue model + precedent (Weave). Pick this if you want to win on innovation.

---

## ONE LAST THING

**Week 1 is the truth test for Solidity.** If by Oct 2 you can't:
- Write an ERC-20 contract ✅
- Deploy to testnet ✅
- Call it from React ✅

Then you need to:
1. Reach out to Hardhat Discord (don't spin your wheels)
2. Consider hiring a Solidity dev part-time ($500-1000 for 2 weeks)
3. Or pivot to **Arbitrage Monitor** (which needs zero Solidity)


