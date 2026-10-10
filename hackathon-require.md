# BNB Hack: Tokenized Stocks Edition
## Judges' Requirements & Scoring Checklist

**Hackathon:** BNB Hack: Tokenized Stocks Edition  
**Deadline:** October 11, 2026, 12:00 UTC (HARD DEADLINE)  
**Submission URLs:** See Section 5  
**Key Insight:** Developer Experience Report = 25% of score (MANDATORY)

---

## 1. SUBMISSION CHECKLIST (Do or Lose Points)

### Before Oct 11, 12:00 UTC, You Must Submit:

**Form 1: Team Registration** (if not already done)
- URL: https://forms.gle/NEmy3FxYc4f5Dua47
- Email: YOUR_EMAIL@domain.com (use this email on ALL 3 forms)
- Why: Binance increases your API rate limits

**Form 2: Developer Experience Report** (25% of final score)
- URL: https://docs.google.com/forms/d/e/1FAIpQLSfBkyWAYZ5JjzzUXRHlRgi7TjAIPUCkxPtV81eJgyBmGfrJiQ/viewform
- Same email as registration
- 8-page form, must be HONEST and SPECIFIC
- **Missing this = Project not scored at all**

**Form 3: Project Submission**
- URL: https://docs.google.com/forms/d/e/1FAIpQLSdMtogkNnWzkI6xUifE78Ks4TohOM1YuWMuNgV-UPLVnpHD4Q/viewform
- Same email as other two forms
- Links to GitHub, demo video, deployed app

---

## 2. DEVELOPER EXPERIENCE REPORT (25% of Score)

### Mandatory Requirement
**If you don't submit this, your project is NOT SCORED.**

### What Judges Want (Be Specific, Not Generic)

**Do This:**
- ✅ Name exact endpoints you used (e.g., `/api/v1/dex/market/rwa/search`)
- ✅ Paste actual error messages you hit (e.g., `40102 Invalid signature`)
- ✅ Describe exact issue and how long to debug (e.g., "Took 2 hours to understand /build prefix requirement")
- ✅ Be honest about frustrations (no BS, no AI-generated fluff)
- ✅ Suggest specific improvements (e.g., "Add giant warning about /build prefix in auth docs")

**Don't Do This:**
- ❌ Generic praise ("API is great!")
- ❌ Vague complaints ("Documentation was confusing")
- ❌ Copy-paste from other reports
- ❌ Perfunctory one-liners

### Template for Your Report

```
## Binance Web3 API Developer Experience Report

### Endpoints Used
- GET /api/v1/dex/market/rwa/search (to find AAPL, NVDA, TSLA)
- GET /api/v1/dex/market/rwa/price (to fetch reference prices)
- GET /api/v1/dex/market/rwa/tokens (to list all 709 stocks)
- POST /api/v1/tx/simulate (to dry-run transactions)
- GET /api/v1/wallet/token-balances (to check holdings)

### What Worked Smoothly
- RWA token list endpoint is fast (< 100ms response)
- API responses are consistent JSON format (easy to parse)
- Rate limit increase after registration was automatic
- Error codes are mostly helpful (40102, 40101, etc.)

### What Was Frustrating
1. Signature error 40102 with no guidance
   - Took 2 hours to realize /build prefix must be in signed requestPath
   - Error message doesn't mention /build or provide hint
   - Suggestion: Add note in auth docs: "Error 40102? Check your requestPath starts with /build"

2. Reference price vs on-chain price confusion
   - Docs say "derived from on-chain" but don't show calculation
   - Had to reverse-engineer from test data
   - Suggestion: Add example: "NVDA token price $127.50 on-chain = $127.50 reference price (1:1 ratio)"

3. No batch endpoint for price queries
   - Had to loop 709 tokens individually → 709 API calls
   - Hit rate limit on first try
   - Suggestion: Add POST /api/v1/dex/market/rwa/price-batch for 100 tokens per call

### Metrics
- Total API calls made: ~15,000 over 6 weeks
- Biggest blocker: Signature authentication (solved day 2)
- Most used endpoint: /tokens (list all)
- Never exceeded rate limits after registration

### Overall Score: 8/10
Main gaps are documentation clarity. With 3 doc improvements, would be 9.5/10.

### Specific Suggestions for Binance Team
1. Add /build prefix requirement in bold at top of auth docs
2. Add example of signature generation with preHash printed step-by-step
3. Add section: "Troubleshooting 40102 errors" with /build prefix as #1 reason
4. Document reference price calculation formula
5. Add batch endpoints for price/tokens queries
```

---

## 3. PROJECT SUBMISSION REQUIREMENTS

### GitHub Repository (Public, Must Stay Public)

**Checklist:**
- [ ] Repository is PUBLIC (not private)
- [ ] Stays public through October 11 (judges access it)
- [ ] Has clear README with:
  - [ ] What the project does (1-2 sentences)
  - [ ] How to set it up (npm install, env vars, deploy)
  - [ ] Which Binance Web3 API endpoints you used
  - [ ] Demo screenshot or GIF
  - [ ] Link to deployed app
  - [ ] Link to demo video
- [ ] Code is clean:
  - [ ] No console.logs left in production code
  - [ ] Comments on tricky logic
  - [ ] No hardcoded API keys or secrets
- [ ] `.env.example` file with placeholder keys (NEVER commit `.env` with real keys)
- [ ] Package.json with all dependencies listed

**Example README structure:**
```markdown
# Project Name

## Overview
Brief description of what this solves.

## Tech Stack
- Frontend: React, Ethers.js, Tailwind
- Backend: Node.js, Express
- Blockchain: BNB Smart Chain
- Database: PostgreSQL
- APIs: Binance Web3 API

## Quick Start
1. Clone repo
2. npm install
3. Create .env (copy from .env.example)
4. npm run dev
5. Open http://localhost:3000

## API Endpoints Used
- GET /api/v1/dex/market/rwa/search
- GET /api/v1/dex/market/rwa/price
- GET /api/v1/dex/market/rwa/tokens
- POST /api/v1/tx/simulate

## Demo
[Link to demo video]

## Deployed
[Link to live app]
```

---

### Demo Video (≤ 4 Minutes)

**Requirements:**
- [ ] Video is ≤ 4 minutes (judges are busy)
- [ ] Link is PUBLIC (test it: open in incognito, can you see it?)
- [ ] Shows the app WORKING (not broken, not demo mode)
- [ ] Demonstrates the actual problem being solved
- [ ] Includes walkt-through of key features

**Structure (copy this):**
```
0:00-0:30 — Show what you're solving
  "Traders want real-time arbitrage alerts but no tool exists. 
   Here's our solution: [show live dashboard]"

0:30-2:00 — Demo the features working
  - Connect wallet
  - View spreads updating live
  - Trigger an alert
  - Execute a trade (if applicable)

2:00-3:30 — Explain why it matters
  "This captures arbitrage opportunities that disappear in minutes.
   We found spreads up to 2.1% on weekends when traditional markets closed."

3:30-4:00 — Team + next steps
  "Built in 6 weeks using Binance Web3 API.
   Next: Add more stocks, community alerts, automated execution."
```

**Video Quality Standards:**
- ✅ Clear audio (no background noise)
- ✅ Readable screen (zoom in on text if needed)
- ✅ Good lighting (no dark/blurry)
- ✅ Fast pacing (don't waste judges' time)
- ✅ Professional tone (not joking around)

**If you only have time for one thing: Record a demo video that works. Everything else can be rough.**

---

### Deployed Link or Run Instructions

**Option A: Deployed App (Preferred)**
- Live URL on Vercel, Railway, or similar
- Judges click link → app works immediately
- No setup required

**Option B: Local Run Instructions (Acceptable)**
- Clear steps in README:
  ```
  1. npm install
  2. Create .env with your Binance API keys
  3. npm run dev
  4. Open http://localhost:3000
  ```
- Must work within 5 minutes for judge to test
- Judges will try it

**Judges prefer Option A** (no friction), but they'll accept B if instructions are clear.

---

## 4. CONTENT REQUIREMENTS

### What to Submit in Project Form

**Field 1: Project Name**
- Your project's name (e.g., "Arbitrage Monitor for Tokenized Stocks")

**Field 2: Project Description**
- 100-200 words explaining:
  - What problem does it solve?
  - Who uses it?
  - Which Binance Web3 API endpoints you use
  - Which tokenized stocks it touches (AAPL, NVDA, etc.)

**Example:**
```
Arbitrage Monitor for Tokenized Stocks

Real-time detection of arbitrage opportunities in tokenized equities.
Tokenized stocks trade 24/7 on-chain while traditional markets close,
creating spreads between on-chain prices and reference prices (1-2% gaps).

We monitor:
- 5 major stocks (AAPL, NVDA, TSLA, MSFT, GOOGL)
- On-chain prices via PancakeSwap
- Reference prices via Binance Web3 API (/api/v1/dex/market/rwa/price)
- Alerts traders when spread > 1.5%

Users can:
- View live dashboard (updated every 5 seconds)
- Get Telegram alerts when opportunities appear
- See historical spread data (past 24 hours)

Uses: RWA Data API (search, price, tokens), Trading API (quotes), Wallet API (balances)
Built for traders seeking alpha in the $1.2B+ tokenized stock market.
```

**Field 3: GitHub Repository**
- Public URL (https://github.com/username/repo-name)
- Must be public and stay public

**Field 4: Demo Video Link**
- YouTube, Google Drive, or Vimeo link
- Must be PUBLIC (test it)
- ≤ 4 minutes

**Field 5: Deployed Link or Run Instructions**
- Live URL: https://app.example.com OR
- Instructions: "Clone repo, npm install, npm run dev"

**Field 6: Wallet Address for Prize**
- ERC-20 / BSC compatible address (0x...)
- OR Binance UID (if you prefer Binance to deliver prize)
- This is how you get paid if you win

**Field 7: Applicable Tracks** (Check all that apply)
- [ ] Main Track: Tokenized Stocks Products & Agents (required for main prize)
- [ ] Special Prize: Best Use of Agentic Wallet ($2,000)
- [ ] Special Prize: Best Use of BNB Agent Studio ($2,000)

**Field 8: Did you submit Developer Experience Report?**
- [ ] Yes, I submitted it at [this email]
- If NO → Your project is NOT SCORED

---

## 5. TECHNICAL REQUIREMENTS

### Required APIs Used
**Your project MUST use at least 3 endpoints from Binance Web3 API:**

**RWA Data (Tokenized Stocks)** — Pick 2+:
- [ ] `GET /api/v1/dex/market/rwa/search` (find stocks by ticker)
- [ ] `GET /api/v1/dex/market/rwa/price` (fetch prices)
- [ ] `GET /api/v1/dex/market/rwa/tokens` (list all stocks)
- [ ] `GET /api/v1/dex/market/rwa/underlying-profile` (company info)
- [ ] `GET /api/v1/dex/market/rwa/underlying-market` (fundamentals)

**Trading API** — Pick 1+:
- [ ] `GET /api/v1/dex/aggregator/quote` (get swap price)
- [ ] `GET /api/v1/dex/swap` (build swap transaction)

**Wallet/Transaction API** — Pick 1+:
- [ ] `GET /api/v1/wallet/token-balances` (check holdings)
- [ ] `POST /api/v1/tx/simulate` (test transaction)
- [ ] `POST /api/v1/tx/broadcast` (send transaction)

**Scoring Impact:** Using more endpoints = higher score (shows you understand the API)

### Authentication (Critical)

**Every API request must have:**
- [ ] `X-OC-APIKEY` header (your API key)
- [ ] `X-OC-TIMESTAMP` header (ISO 8601 format)
- [ ] `X-OC-SIGN` header (HMAC-SHA256 signature)

**Signature formula (most common mistake):**
```
preHash = timestamp + method + requestPath + body
// requestPath MUST start with /build
// e.g., /build/api/v1/dex/market/rwa/price?chainId=56
signature = Base64(HMAC-SHA256(preHash, secretKey))
```

**If you get 40102 Invalid signature error:**
1. Check /build prefix is in requestPath ← 99% of failures
2. Verify timestamp format (ISO 8601: 2026-05-11T10:08:57.715Z)
3. Check body is raw string, not JSON-stringified twice

### Supported Chains
Your project should support at least 1 (ideally more):
- [ ] BNB Smart Chain (chainId: 56) ← Most tokenized stocks are here
- [ ] Ethereum (chainId: 1)
- [ ] Base (chainId: 8453)
- [ ] Solana (chainId: CT_501)

---

## 6. SCORING RUBRIC (How Judges Grade You)

### Developer Experience Report (25%)
| Score | Criteria |
|-------|----------|
| **A (90+)** | Specific examples, exact error messages, honest improvements, 8/10+ detail |
| **B (80+)** | General feedback, some specific examples, reasonable suggestions |
| **C (70+)** | Basic feedback, vague issues, surface-level improvements |
| **F (<70)** | Generic praise, no specifics, AI-generated content, or missing entirely |

**Key:** Judges are looking for EVIDENCE you actually built with the API, not assumptions.

### Project Quality (50%)
| Dimension | Excellent (10) | Good (7) | OK (5) | Bad (2) |
|-----------|---|---|---|---|
| **Does it work?** | Feature-complete, no crashes | Core features work | Some features broken | Doesn't run |
| **API Integration** | Uses 5+ endpoints creatively | Uses 3-4 endpoints well | Uses 2-3 endpoints basic | 0-1 endpoints |
| **Code Quality** | Clean, commented, tested | Readable, functional | Works but messy | Unreadable |
| **UI/UX** | Professional, intuitive | Functional, clear | Basic, confusing | Broken UI |
| **Documentation** | Excellent README, clear setup | Good README, basic setup | Minimal README | No README |

### Innovation (15%)
| Dimension | Excellent (10) | Good (7) | OK (5) | Bad (2) |
|-----------|---|---|---|---|
| **Problem Uniqueness** | First-mover advantage, real gap | Novel approach, useful | Solves known problem | Obvious/done before |
| **Execution** | Ambitious scope, well-executed | Good scope, executed | Simple scope, basic execution | Incomplete |
| **Potential Impact** | Could be a real product | Has market appeal | Niche use case | Limited appeal |

### Bonus Points (10%)
- [ ] +2 for "Best Use of Agentic Wallet" (natural language interface)
- [ ] +2 for "Best Use of BNB Agent Studio" (autonomous agent)
- [ ] +2 for honest DX report + great suggestions for Binance
- [ ] +2 for YouTube/Twitter presence (share your build journey)
- [ ] +2 for community engagement (Telegram, Discord, answering questions)

---

## 7. WHAT WINS THE HACKATHON

### Main Prize Winner Profile

**Example: Arbitrage Monitor**
```
✅ Problem: Real-time arbitrage opportunities in tokenized stocks (unsolved)
✅ Solution: Dashboard + alerts that work 24/7
✅ Technical: Uses 5+ RWA API endpoints correctly
✅ Polish: Works flawlessly, deployed, video demo clear
✅ DX Report: Specific, honest, identifies real API improvements
✅ Business: Clear user (traders), clear value (alpha capture)
✅ Scope: Realistic for 6 weeks solo
```

**Example: Thematic Baskets**
```
✅ Problem: Retail wants thematic exposure on-chain (Weave only on Robinhood)
✅ Solution: Creator-driven baskets on BNB, earn fees as creator
✅ Technical: Smart contracts work, frontend intuitive
✅ Polish: Mainnet deployment, revenue tracking working
✅ DX Report: Specific challenges, good suggestions for Binance
✅ Business: Creator economy, clear monetization
✅ Scope: Ambitious but deliverable
```

---

## 8. RED FLAGS (Things That Lose Points)

### Disqualifiers
- [ ] ❌ Project doesn't run (code won't execute)
- [ ] ❌ No GitHub link or GitHub is private
- [ ] ❌ No demo video or video is unwatchable
- [ ] ❌ Doesn't use Binance Web3 API (uses only other APIs)
- [ ] ❌ Developer Experience Report missing or blank

### Major Deductions
- [ ] ❌ All API calls hardcoded (no real integration)
- [ ] ❌ Copy-paste DX report (generic or AI-generated)
- [ ] ❌ Misleading demo (shows mockup, not working product)
- [ ] ❌ Lies about features (claims things don't actually exist)

### Minor Deductions
- [ ] ⚠️ Sloppy code (lots of console.logs, no comments)
- [ ] ⚠️ Poor README (vague setup instructions)
- [ ] ⚠️ Missing env.example (judges can't run it easily)
- [ ] ⚠️ Video is 5+ minutes (we said max 4)

---

## 9. FINAL CHECKLIST (Oct 11, Before Deadline)

**48 Hours Before Submission:**
- [ ] Demo video recorded, uploaded, link tested (public?)
- [ ] GitHub repo cleaned, README complete, .env.example added
- [ ] App deployed OR local run instructions tested
- [ ] All dependencies listed in package.json

**24 Hours Before:**
- [ ] Draft DX Report written (be specific, honest)
- [ ] Project description ready for form
- [ ] Wallet address for prize confirmed
- [ ] Demo video link tested in incognito (verify it's public)

**3 Hours Before (Noon UTC Oct 11):**
- [ ] DX Report submitted (Form 2)
- [ ] Project submission complete (Form 3)
- [ ] All three forms use same email address
- [ ] Links in forms tested one more time

**At Deadline:**
- [ ] Submitted by 12:00 UTC ✅

---

## 10. QUICK REFERENCE (Tab This)

| Item | Deadline | URL | Required? |
|------|----------|-----|-----------|
| API Key | Day 1 | https://web3.binance.com/en/dev-portal | ✅ |
| Team Registration | Oct 1 | https://forms.gle/NEmy3FxYc4f5Dua47 | ✅ |
| DX Report | Oct 11 12:00 UTC | https://docs.google.com/forms/.../dev-exp-form | ✅ |
| Project Submission | Oct 11 12:00 UTC | https://docs.google.com/forms/.../project-form | ✅ |
| GitHub Repo | Oct 11 12:00 UTC | YOUR_REPO_URL | ✅ |
| Demo Video | Oct 11 12:00 UTC | YOUR_VIDEO_URL | ✅ |
| Deployed App | Oct 11 12:00 UTC | YOUR_APP_URL | ✅ |

---

## 11. IF SOMETHING BREAKS WEEK 6

**Last-minute issues:**

**Demo video corrupt?**
- Record a new one (Loom takes 5 min)
- Upload anywhere public
- Submit link

**App won't deploy?**
- Keep local run instructions clear
- Judges will clone + npm install
- Make sure it works locally

**API key rejected?**
- Use a new one immediately
- Make sure registration is processed
- Join BNB Telegram for emergency help

**DX Report too late?**
- You have until 12:00 UTC Oct 11
- Submit incomplete is better than not at all
- But TRY to hit all 8 pages

---

**This is your checklist. Follow it. You'll win.**