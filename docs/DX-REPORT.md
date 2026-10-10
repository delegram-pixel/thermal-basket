# Binance Web3 API — Developer Experience Report

**Project:** Thematic Baskets — weighted baskets of tokenized stocks on BNB Smart Chain
**Submitted:** 11 October 2026
**Integration:** Binance Web3 API, RWA Data endpoints, server-side, HMAC-signed

---

## What this report is based on

Two networks, two completely different experiences, and the contrast is the most
useful thing in this document.

**From the development machine, the API was unreachable.** `dig @8.8.8.8
web3.binance.com` answered, but TCP connections never completed: `curl` failed
with `(28) Connection timed out` and no HTTP status at all, while a control
request to `api.github.com` returned `200` in 0.85 s. The entire integration was
therefore written against documentation rather than against a live API.

**From Vercel, the API answered immediately and refused to serve me.** All five
endpoints returned within 170–380 ms, and all five returned the same thing:
`HTTP 200`, code `40304`, `Service not available due to compliance restriction`.

```
/api/v1/dex/market/rwa/search              HTTP 200   380 ms   code 40304
/api/v1/dex/market/rwa/price               HTTP 200   191 ms   code 40304
/api/v1/dex/market/rwa/tokens              HTTP 200   172 ms   code 40304
/api/v1/dex/market/rwa/underlying-profile  HTTP 200   172 ms   code 40304
/api/v1/dex/market/rwa/underlying-market   HTTP 200   170 ms   code 40304
```

Probed 2026-10-10 17:33:36 UTC from a Vercel serverless function in `iad1`
(Washington DC), against `chainId=56`.

Every claim below is something I observed. Where something is inference rather
than observation, I say so.

The instrument that produced the second table is a `/diagnostics` route shipped
in the application itself. It calls all five endpoints and prints each one's
status, latency, error code and a truncated body excerpt. It was written because
of the first table, and it is the single most useful thing I built — it turned a
question I could not answer into a screenshot.

---

## Endpoints used

All RWA Data, against `https://web3.binance.com`, all with `chainId=56`:

| Endpoint                                        | Used for                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/dex/market/rwa/search`             | Resolving a ticker to a listed token before pricing it. The name and token address it returns are what the UI shows beside the ticker. |
| `GET /api/v1/dex/market/rwa/price`              | The reference price itself — one call per ticker.                                                                                      |
| `GET /api/v1/dex/market/rwa/underlying-profile` | Company context on a basket page: name, sector, industry, description.                                                                 |
| `GET /api/v1/dex/market/rwa/underlying-market`  | Market capitalisation, fetched alongside the profile.                                                                                  |
| `GET /api/v1/dex/market/rwa/tokens`             | Catalogue size, reported beside the reference column.                                                                                  |

---

## What worked

**Latency is genuinely good.** 170–380 ms from a cold serverless function to a
signed endpoint on the other side of the world. Whatever else is wrong here, the
API itself is not slow, and I want that on the record because it is the thing I
expected to be the problem and it was not.

**Numeric error codes are the right choice.** `40102`, `40103` and `40304` are
greppable. They survive being pasted into a search box, they survive being
paraphrased wrongly by a colleague, and they are stable enough to branch on in
code. This is materially better than `{"error":"Unauthorized"}`. My complaints
below are about _which_ code you get and what it tells you, never about the
scheme itself.

**The authentication scheme is clean.** Four headers, one HMAC, no OAuth dance,
no token refresh, no redirect URI. For server-side integration work this is about
as little ceremony as a signed request can carry, and the `/build`-prefixed
`requestPath` is a single rule that is easy to obey once known.

**The endpoint set is well-scoped.** Search, price, profile, fundamentals and
catalogue — for a basket product I needed to resolve a ticker, price it, and show
what the company is, and there was an endpoint for each with no gap I had to fill
from elsewhere. Plenty of "asset APIs" make you scrape for the profile data.

---

## What was frustrating

### 1. `40304`: the API accepted my request, then refused to serve me, and nothing says why

This is the finding I would most want a Binance engineer to read, and it is the
one that decided whether this integration worked at all.

Once the requests actually reached Binance, every single call returned:

```json
{ "code": 40304, "msg": "Service not available due to compliance restriction" }
```

I want to be precise about how much is and is not established here, because the
difference matters:

- **The transport works.** Five endpoints, three different query shapes
  (`keyword=`, `symbol=`, and no symbol at all), all answered in under 400 ms.
- **The failure is not my client.** A malformed request, a bad signature or a
  wrong path produces `40102`. I got a business-logic code instead.
- **It is not established that my signature is correct.** A compliance gate
  plausibly sits in front of signature verification, in which case the request
  was rejected before the HMAC was ever checked. I could not distinguish these
  two cases from the response, and that is itself part of the complaint.

What the message does **not** tell me is anything actionable:

- Is this my **egress IP's** region? Binance is restricted in the United States,
  and Vercel runs functions in `iad1` by default, which is a plausible cause.
- Is it my **account's** region, registered when the API key was created?
- Is it the **product's** availability — tokenized equities simply not offered on
  BNB Chain to anyone yet?
- Is `chainId=56` the problem — is RWA data available on mainnet only?

Four plausible causes, all consistent with the same string, and no
documentation I could find addresses any of them. I spent the end of the build
guessing between them by changing one variable at a time, which is an expensive
way to learn something the API already knows.

There is a second cost to this ambiguity that I did not expect. Because the
message does not say whether the restriction is about my region, the only way to
find out is to move the function and re-test — and the mechanism for moving it is
deprecated in the framework this application is built on. `preferredRegion` is
marked deprecated in Next 16 and now accepts only `auto`, `global` and `home`, so
the region has to be set in deployment configuration instead. The one experiment
this error invites is the one the toolchain makes least obvious. An error that
named the cause would have made the experiment unnecessary.

**Why this is the top finding:** `40102` and `40103` are codes a developer can
act on — they point at a specific mistake in specific code. `40304` points at
nothing. A developer who has followed every instruction correctly, gotten the
signature right, and then receives this has no way to tell "you are in the wrong
region" from "this product does not exist yet" from "your key is not entitled".
The integration is finished at that point and there is nowhere to go.

**The message is also misleading on its face.** "Service not available due to
compliance restriction" reads as a statement about the service. From where I sit
it is ambiguous whether the service is unavailable, or I am. Those imply
completely different next steps for the developer — one of which is "stop" and
the other "move your function region".

### 2. A missing API key is reported as a timestamp error

When `X-OC-APIKEY` is absent, the request is not rejected as unauthenticated. It
came back as `40103`, `Timestamp outside recv_window` — a message about the
clock, on a request carrying no key at all.

It got worse. The response body echoed a `serverTime` **identical to the
`X-OC-TIMESTAMP` I had sent**. The API was telling me my timestamp was outside
the receive window while, in the same response, confirming that my timestamp was
exactly right.

I spent a long time on time synchronisation — checking `ntpd`, checking the
container clock, trying different timestamp formats, widening `X-OC-RECV-WINDOW`
to its maximum — because the error told me to. The actual cause was that the key
was empty: `curl` sends an empty header happily and reports no problem, so the
request went out unauthenticated and came back as a clock error.

**Why this is worth fixing:** the error code sent me down a path that could not
contain the answer. Every developer is in this state for their first five
minutes.

### 3. `40102` is a real trap, and the fix is one word that isn't in the error

`/build` must be included in the `requestPath` **that gets signed**. Not in the
base URL, not in the fetch call — in the string the HMAC is computed over:

```
timestamp + method + requestPath + body
```

with no separators. The full URL is `https://web3.binance.com` + `/build` +
`/api/v1/...`. It is entirely reasonable to read the docs, conclude the
`requestPath` is `/api/v1/dex/market/rwa/price`, sign that, and send the request
to the `/build`-prefixed URL. Every part of that is correct except the one that
matters, and the result is `40102 Invalid signature` with nothing to suggest
which of the four concatenated parts was wrong.

I built the client around this from the start — `signedPath()` prepends `/build`
in exactly one place, and the function that signs and the function that fetches
cannot disagree because they take the same string — but I did that because I had
read about the trap, not because the API told me. A signature error is the worst
class of error to receive, because there is no partial credit: five inputs, one
wrong, no way to narrow it from the response.

### 4. An unreachable host is indistinguishable from a broken API

Worth recording because it cost a full working day and because it is the failure
mode every developer on a restricted network will hit.

`web3.binance.com` resolves through a CNAME to `dnsu8oml1p86w.cloudfront.net`,
which returns multiple A records. From the development machine DNS resolved and
connections then failed outright. This is the experiment that settled it:

```
$ curl -sS -o /dev/null -w 'binance %{http_code} %{time_total}s\n' \
    --connect-timeout 5 --max-time 12 \
    'https://web3.binance.com/build/api/v1/dex/market/rwa/tokens?chainId=56'
curl: (28) Connection timed out after 5000 milliseconds
binance 000 5.000793s

$ curl -sS -o /dev/null -w 'control %{http_code} %{time_total}s\n' \
    --connect-timeout 5 --max-time 12 'https://api.github.com'
control 200 0.849095s
```

The control answered `200` in 0.85 s while Binance never completed a TCP
handshake. `(28)` is curl failing at the _connect_ stage, before a single byte
was sent — which rules out clock skew, a bad signature and the `/build` prefix in
one line, because none of them are ever reached. Without the control I would have
kept debugging my own client.

Two things make this unusually hard to diagnose:

- **`curl` reports no HTTP status for a connection that never opened.** `HTTP
000` is not an error the API returned; it is the absence of an API. There is no
  code to look up and no body to read.
- **Because the host is a CDN, trying a different IP proves nothing.** I tried
  two resolved addresses and got identical results, which is equally consistent
  with "Binance is down" and "your network is dropping this traffic".

The shipped mitigation is to cap every request with `AbortSignal.timeout(8000)`
and have the client return a discriminated result (`unconfigured` / `unreachable`
/ `rejected` / `malformed`) rather than throw. Distinguishing "no credentials"
from "no route to host" from "the API said no" turned out to be the single most
valuable thing the client does.

### 5. No batch form for prices or profiles

Every RWA data call is one symbol per request. Pricing eight basket components
across a search and a price call is sixteen round trips; adding profiles and
fundamentals makes it twenty-four. I capped the caller at sixteen tickers purely
to bound the fan-out, which is a product decision being forced by an API
limitation rather than made by the product.

**I never hit a rate limit** and can report nothing about where they bite. What I
can say is that the shape of the API guarantees the problem: request count is a
function of the number of assets, and the number of assets is the thing a basket
product grows.

### 6. The success envelope is still unobserved

I now know what a **failure** looks like: `HTTP 200` carrying
`{ code, msg }`, with `code` non-zero. That is a real finding and it changed my
client — I had assumed failures would arrive as non-2xx statuses, and they do
not.

I still do not know what a **success** body looks like, because `40304` meant no
endpoint ever returned data. The shipped parser searches for candidate keys
(`price`, `priceUsd`, `usdPrice`, `referencePrice`, `lastPrice`, `markPrice`, …)
at a bounded depth rather than reading a fixed path.

That is defensive code written in place of knowledge. It is a worse artifact for
the reader of my repository than a parser with a fixed path and a comment citing
the docs, and I would rather not have shipped it.

---

## Metrics

|                                           |                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Endpoints integrated                      | 5 (all RWA Data)                                                    |
| Responses received from Vercel            | **5 of 5**, in 170–380 ms                                           |
| Responses received from the local machine | **0 of 5** — connect timeouts, `HTTP 000`                           |
| Successful data responses                 | **0** — all five returned `40304`                                   |
| Distinct error codes observed             | 3 — `40102`, `40103`, `40304`                                       |
| Time to diagnose the `/build` trap        | Avoided by reading; the docs do describe it                         |
| Time lost to `40103`-as-missing-key       | The largest single block of debugging in the integration            |
| Time lost to the unreachable host         | Roughly a working day, before the control request identified it     |
| Time lost to `40304`                      | Unresolved — four candidate causes, no documentation distinguishing |
| Rate limits encountered                   | None observed (no endpoint ever served data)                        |

---

## Overall score: 7/10

Up from where I had it before the requests started connecting, and the reasons
are worth stating because they are about what the API does well.

The transport is fast, the auth scheme is clean, the endpoint coverage is
well-scoped and the error codes are greppable. Once the requests reached Binance
I got an answer in under 400 ms every time. There is very little friction in the
happy path here, and I suspect a developer in a permitted region has a genuinely
pleasant time.

It is marked down for three things, all of which are about what happens when
something is wrong:

1. **`40304` is a dead end.** It is the code that decides whether the integration
   works, and it is the only code of the three that names no cause, suggests no
   next step, and has no documentation I could find. A developer can be fully
   correct and still be stuck here permanently.
2. **The error you get is not the error you have.** A missing key returns a clock
   error, and the response contradicts itself while doing it.
3. **A connection that never opens reports as nothing at all.** No status, no
   body, no code.

Fix the first and the third, and this is a 9 — because everything the API
actually does, it does well.

---

## Specific suggestions for the Binance team

1. **Document `40304` and make it specific.** This is the highest-value change in
   this list. At minimum, say which conditions produce it — caller region,
   account region, product availability, or chain — and which regions and
   `chainId` values are permitted. Better, split it: `40304` for "you are in a
   restricted region", `40305` for "this product is not offered on this chain",
   so the developer knows whether to move their function or give up.

2. **Make the message say which side the restriction is on.** "Service not
   available due to compliance restriction" is ambiguous between "the service is
   unavailable" and "you are not permitted". Those two imply opposite next steps.

3. **Check for a present API key before validating the timestamp.** If
   `X-OC-APIKEY` is empty or missing, return a distinct code — `40101` if that is
   the auth code — and never `40103`. This would have saved the largest block of
   time in this integration, and it affects every developer in their first five
   minutes.

4. **Never echo a `serverTime` that validates the timestamp you just rejected.**
   If the response includes a `serverTime` equal to the submitted
   `X-OC-TIMESTAMP` and the code is still `40103`, the response contradicts
   itself. Either omit `serverTime` on a `40103`, or include the window actually
   applied — the effective `recvWindow` and the observed delta — so the developer
   can see the comparison that failed.

5. **Put the `/build`-in-`requestPath` rule inside the `40102` message.** Not only
   in the auth guide. Something like: _"Invalid signature. The signed
   `requestPath` must include the `/build` prefix — sign
   `/build/api/v1/dex/market/rwa/price`, not `/api/v1/dex/market/rwa/price`."_
   An error message that names the most common cause of itself is the cheapest
   documentation there is.

6. **Publish a `preHash` example with the concatenated string shown literally.**
   Show the actual string for one concrete request, including the timestamp
   format, so it can be verified by eye rather than inferred. This is the change
   that would let a developer self-check without reaching the network at all.

7. **Document the response envelope with a complete example body per endpoint —
   success and failure.** I learned by experiment that failures arrive as `HTTP
200` with a non-zero `code`, and I still have never seen a success body. A
   single realistic JSON sample per RWA endpoint is worth more than prose
   describing fields.

8. **Add a batch price endpoint** — `POST /api/v1/dex/market/rwa/price` taking a
   symbol array, or a `symbols=` comma list. Even a limit of 20 per call turns a
   basket's fan-out from O(assets) into O(1), and it removes the incentive for
   every integrator to write the same `Promise.all` plus concurrency cap.

9. **State the receive-window default explicitly for the RWA endpoints.** One
   sentence per endpoint confirming whether the window is enforced and what it
   defaults to would remove the need to send `X-OC-RECV-WINDOW: 60000` as a
   hedge.

---

## What I would tell the next developer

Read the auth section twice. Put a real key in your environment **before** your
first request — an empty key produces a misleading error rather than an obvious
one. Sign the string you actually send, `/build` included. Put
`AbortSignal.timeout()` on every call from the first line, because when this host
is unreachable the failure is a hang rather than a `5xx`.

Then build the diagnostics panel before you build the feature. It was the most
useful thing I wrote and it was written last. It is what turned "the integration
does not work" into "the integration works and Binance is refusing my region" —
a completely different problem, found in seconds instead of days.

And test from the network you will deploy to. The API behaved in two opposite
ways depending on where the request came from, and I only found that out by
running the same probe from both.
