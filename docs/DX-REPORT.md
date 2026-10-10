# Binance Web3 API — Developer Experience Report

**Project:** Thematic Baskets — weighted baskets of tokenized stocks on BNB Smart Chain
**Submitted:** 11 October 2026
**Integration:** Binance Web3 API, RWA Data endpoints, server-side, HMAC-signed

---

## What this report is based on

Three environments, three completely different experiences, and the contrast
between them is the most useful thing in this document.

**1. From the development machine, the API was unreachable.** `dig @8.8.8.8
web3.binance.com` answered, but TCP connections never completed: `curl` failed
with `(28) Connection timed out` and no HTTP status at all, while a control
request to `api.github.com` returned `200` in 0.85 s. The first version of this
integration was therefore written against documentation rather than against a live
API.

**2. From Vercel's default function region, the API answered immediately and
refused to serve me.** All five endpoints returned within 170–380 ms, and all five
returned the same thing: `HTTP 200`, code `40304`, `Service not available due to
compliance restriction`.

```
/api/v1/dex/market/rwa/search              HTTP 200   380 ms   code 40304
/api/v1/dex/market/rwa/price               HTTP 200   191 ms   code 40304
/api/v1/dex/market/rwa/tokens              HTTP 200   172 ms   code 40304
/api/v1/dex/market/rwa/underlying-profile  HTTP 200   172 ms   code 40304
/api/v1/dex/market/rwa/underlying-market   HTTP 200   170 ms   code 40304
```

Probed 2026-10-10 17:33:36 UTC, against `chainId=56`.

One honesty note, because this report promises to mark inference as inference: the
default region is `iad1` (Washington DC) per Vercel's documentation for new
projects. That is where I believe these ran, but I did not read the region off a
response header at the time, so it is documented-default rather than observation.
I only learned to check the header afterwards, and that is how the move below was
confirmed.

**3. From a function region in Singapore, the API served data.** Moving the
deployment's function region removed `40304` completely. On the next probe, four
endpoints returned real bodies and the fifth named exactly what it wanted:

```
/api/v1/dex/market/rwa/search              HTTP 200   104 ms   success
/api/v1/dex/market/rwa/price               HTTP 200    96 ms   success
/api/v1/dex/market/rwa/tokens              HTTP 200   197 ms   success
/api/v1/dex/market/rwa/underlying-profile  HTTP 200    94 ms   success
/api/v1/dex/market/rwa/underlying-market   HTTP 429    82 ms   code 42900
```

Probed 2026-10-10 19:46:21 UTC. The region was verified from the `x-vercel-id`
response header, which lists the edge point of presence and the function execution
region:

```
$ curl -sI https://thermal-basket.vercel.app/api/reference/health | grep -i x-vercel-id
x-vercel-id: cpt1::sin1::zcgtl-1791655433405-be7fa034b941
```

`cpt1` is the Cape Town edge; `sin1` is where the function ran. That header is the
single most useful thing Vercel gave me in this build, and it is the only way to
confirm a region change without trusting a dashboard.

Every claim below is something I observed. Where something is inference rather
than observation, I say so.

### The instrument

The tables above came from a `/diagnostics` route shipped in the application
itself. It calls all five endpoints and prints each one's status, latency, error
code and a body excerpt. It was written because of the first table, and it is the
most useful thing I built — it turned a question I could not answer into a
screenshot.

It also had a bug that cost me a day, and the bug is instructive. The route
returned a 240-character excerpt of every response body from the beginning. The
page that renders the panel printed the status, the latency and the error message,
and **did not print the excerpt**. So for the entire period in which I was trying
to learn the success envelope, the envelope was arriving on every successful call,
being serialised into the API response, and discarded one layer above the screen.
When I finally rendered it, the answer that had been unobtainable for a day was on
screen in the first attempt. A diagnostic that collects a fact and does not show
it is not a diagnostic.

---

## Endpoints used

All RWA Data, against `https://web3.binance.com`, all with `binanceChainId=56`:

| Endpoint                                        | Query parameters                           | Used for                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/dex/market/rwa/tokens`             | `binanceChainId`                           | The catalogue. One call returns every listing, which resolves all of a basket's tickers to contract addresses at once — and supplies the count shown beside the reference column. |
| `GET /api/v1/dex/market/rwa/price`              | `binanceChainId`, `tokenContractAddresses` | The reference price for a resolved token.                                                                                                                                         |
| `GET /api/v1/dex/market/rwa/search`             | `binanceChainId`, `keyword`                | Resolving a human-readable ticker to a listing. The fallback when the catalogue does not carry a ticker, and the only endpoint that accepts one.                                  |
| `GET /api/v1/dex/market/rwa/underlying-profile` | `binanceChainId`, `tokenContractAddress`   | Who issues the tokenized form, the token-to-share ratio, and links to the issuer's attestation reports.                                                                           |
| `GET /api/v1/dex/market/rwa/underlying-market`  | `binanceChainId`, `tokenContractAddress`   | The underlying's market capitalisation and its exchange session (`marketStatus`), shown beside the profile. Its own `referencePrice` is deliberately not used — see finding 6.    |

---

## What worked

**Latency is genuinely good.** 82–197 ms from a cold serverless function to a
signed endpoint on the other side of the world, once the region was right. The API
is not slow, and I want that on the record because it is what I expected to be the
problem and it was not.

**`40001` is the best error in the API, and it is worth copying.** It names the
missing parameter literally:

```json
{ "code": 40001, "msg": "Parameter binanceChainId is required", "data": null }
```

Not "invalid request", not "bad parameters" — the name of the thing, spelled the
way the API spells it. Every parameter bug in this integration was found by
reading one of these and changing exactly what it said. It is the single reason
the last stage of this build went quickly, and it is the yardstick `40304` fails
against.

**`statusInfo` is a genuinely thoughtful field, and it is the reason prices can be
shown honestly.** `/underlying-market` carries the underlying exchange's session
alongside its figures:

```json
"statusInfo": { "openState": true, "marketStatus": "offhours",
                "reasonCode": "TRADING", "nextOpenTime": "1791762900000" }
```

A reference price means something different when the market it refers to is closed:
it is a last close rather than a live quote. Very few market data APIs tell you
that, and the ones that do usually make you infer it from a timestamp. This one
states it, in a field with a name you can guess right the first time. A client that
ignores `statusInfo` will present a stale price as a current one — which is exactly
the kind of mistake the field exists to prevent, and it is a mistake I would have
made without it.

**Numeric error codes are the right choice.** `40102`, `40001`, `40304`, `42900`
are greppable. They survive being pasted into a search box, they survive being
paraphrased wrongly by a colleague, and they are stable enough to branch on in
code. This is materially better than `{"error":"Unauthorized"}`. My complaints
below are about _which_ code you get and what it tells you, never about the scheme
itself.

**The authentication scheme is clean.** Four headers, one HMAC, no OAuth dance, no
token refresh, no redirect URI. For server-side integration work this is about as
little ceremony as a signed request can carry, and the `/build`-prefixed
`requestPath` is a single rule that is easy to obey once known.

**The endpoint set is well-scoped, and two of the five are genuinely clever.**
`/underlying-profile` returns attestation-report links, which is the evidence that
a tokenized equity is backed rather than a claim that it is — for a product about
tokenized stocks that is the most interesting field in the API, and it is not one
I would have thought to ask for. `/tokens` returning every listing in one call is
what makes resolving a whole basket affordable.

---

## What was frustrating

### 1. `40304`: the API accepted my request, then refused to serve me, and nothing says why

This is the finding I would most want a Binance engineer to read. It decided
whether this integration worked at all, and it was eventually resolved — so it can
now be reported with an ending.

Once the requests actually reached Binance, every single call returned:

```json
{ "code": 40304, "msg": "Service not available due to compliance restriction" }
```

Four plausible causes are consistent with that one string:

- My **egress IP's** region. Binance is restricted in the United States, and
  Vercel runs functions in a US region by default.
- My **account's** region, fixed when the API key was created.
- The **product's** availability — tokenized equities not offered on BNB Chain to
  anyone yet.
- The **chain** — RWA data available on mainnet only.

No documentation I could find addresses any of them, and the message does not
distinguish "the service is unavailable" from "you are not permitted". Those imply
opposite next steps: one is "stop", the other is "move your function region".

**It was the region.** Setting the deployment's function region to Singapore
removed `40304` on the very next probe, with nothing else changed. That is the
answer, and it took a correct guess to get — because the experiment that produces
it is expensive and the error does not suggest it.

**The retroactive lesson is the sharpest thing in this report.** The
`40304` probes were sent with `chainId=56`. That parameter name is wrong — the API
wants `binanceChainId`, as `40001` later told me in as many words. But `40304`
came back instead of `40001`. So the compliance gate runs **before parameter
validation**, which means every error I received during that period was
uninformative about my own request: a request with a known-bad parameter got a
compliance refusal rather than a parameter complaint. I spent that time
re-examining my signature, my timestamp and my signing path, none of which were
wrong. It also means I could not have discovered the parameter bug by any amount of
care while the gate was in front of it.

Two smaller notes on the same code:

- **It is not established that a valid signature is required to receive it.** A
  gate that runs before validation may also run before authentication. For a day I
  could not tell whether my HMAC was correct, and I only found out afterwards: the
  identical signing code produced successful responses once the region changed. It
  was correct the whole time. An error that does not tell you whether you were
  authenticated makes every other debugging question unanswerable.
- **The one experiment the error invites is the one the toolchain makes least
  obvious.** To test the region hypothesis you have to move the function's region,
  and in Next 16 the `preferredRegion` route segment config is deprecated — it now
  accepts only `auto`, `global` and `home`, and passing a region code fails the
  Vercel build while passing locally, because Next only logs a deprecation warning
  and the platform's builder is what rejects it. The region has to be set in
  deployment configuration instead. An error that named the cause would have made
  the experiment unnecessary; an error that hints at a cause the framework has just
  deprecated is a trap.

### 2. A missing API key is reported as a timestamp error

When `X-OC-APIKEY` is absent, the request is not rejected as unauthenticated. It
came back as `40103`, `Timestamp outside recv_window` — a message about the clock,
on a request carrying no key at all.

It got worse. The response body echoed a timestamp **identical to the
`X-OC-TIMESTAMP` I had sent**. The API was telling me my timestamp was outside the
receive window while, in the same response, confirming that my timestamp was
exactly right.

I spent a long time on time synchronisation — checking `ntpd`, checking the
container clock, trying different timestamp formats, widening `X-OC-RECV-WINDOW`
to its maximum — because the error told me to. The actual cause was that the key
was empty: `curl` sends an empty header happily and reports no problem, so the
request went out unauthenticated and came back as a clock error.

**Why this is worth fixing:** the error code sent me down a path that could not
contain the answer. Every developer is in this state for their first five minutes.

### 3. `40102` is a real trap, and the fix is one word that isn't in the error

`/build` must be included in the `requestPath` **that gets signed**. Not in the
base URL, not in the fetch call — in the string the HMAC is computed over:

```
timestamp + method + requestPath + body
```

with no separators. The full URL is `https://web3.binance.com` + `/build` +
`/api/v1/...`. It is entirely reasonable to read the docs, conclude the
`requestPath` is `/api/v1/dex/market/rwa/price`, sign that, and send the request to
the `/build`-prefixed URL. Every part of that is correct except the one that
matters, and the result is `40102 Invalid signature` with nothing to suggest which
of the four concatenated parts was wrong.

I built the client around this from the start — `signedPath()` prepends `/build` in
exactly one place, so the function that signs and the function that fetches cannot
disagree, and there is a test pinning the prefix — but I did that because I had
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
handshake. `(28)` is curl failing at the _connect_ stage, before a single byte was
sent — which rules out clock skew, a bad signature and the `/build` prefix in one
line, because none of them are ever reached. Without the control I would have kept
debugging my own client.

Two things make this unusually hard to diagnose:

- **`curl` reports no HTTP status for a connection that never opened.** `HTTP 000`
  is not an error the API returned; it is the absence of an API. There is no code
  to look up and no body to read.
- **Because the host is a CDN, trying a different IP proves nothing.** I tried two
  resolved addresses and got identical results, which is equally consistent with
  "Binance is down" and "your network is dropping this traffic".

The shipped mitigation is to cap every request with `AbortSignal.timeout(8000)` and
have the client return a discriminated result (`unconfigured` / `unreachable` /
`rejected` / `malformed`) rather than throw. Distinguishing "no credentials" from
"no route to host" from "the API said no" turned out to be the single most valuable
thing the client does.

### 5. Sibling endpoints disagree about the name of the same parameter, and nothing documents either

This is the finding that cost the most time once the API started answering.

The chain parameter is `binanceChainId`, not `chainId`. That one is fair enough —
`40001` named it on the first call and it was fixed in a minute:

```json
{ "code": 40001, "msg": "Parameter binanceChainId is required", "data": null }
```

The contract-address parameter is where it stops being fair. `/search` and
`/tokens` accept a human-readable ticker. The other three endpoints do not — they
are keyed by contract address, so a ticker has to be resolved first. Fine. But the
three of them do not agree on what that parameter is called:

```
/underlying-profile   →  40001  Parameter tokenContractAddress is required
/underlying-market    →  40001  Parameter tokenContractAddress is required
/price                →  40001  Parameter tokenContractAddresses is required
```

**Plural, on one endpoint out of three.** Same concept, same API family, same
version, adjacent paths, different word. I found it only because `40001` names the
parameter exactly — which is a good argument for `40001`, and a bad argument for
having to rely on it.

`40001` also names the parameter but never its **shape**. `tokenContractAddresses`
being plural strongly implies a list, and the obvious inference is that one call
could price several tokens. What is not stated anywhere is how that list is
encoded: comma-separated, repeated keys, or a JSON array in the query string. That
is a real capability question — it is the difference between O(1) and O(assets)
requests — and it is unanswerable from the error message. I sent a single address,
which is the form I could be confident about, and left the batch unknown.

A related one, in the same family: `/search` takes `keyword`, `/price` takes
`tokenContractAddresses`, `/tokens` takes neither. There is no naming convention to
infer from, so every parameter has to be discovered by provoking an error.

### 6. The success envelope is undocumented, and its field names are not guessable

For most of this build `40304` meant no endpoint ever returned data, so I knew
exactly what a **failure** looked like — `HTTP 200` carrying `{ code, msg }` with a
non-zero `code` — and had never seen a success. I wrote the parser defensively as a
result: it walked each payload looking for a price under any of eight plausible
names, a company name under any of six, an address under any of four.

**That defensive code hid a real bug for the entire build.** The address list did
not contain `tokenContractAddress`. It contained `tokenAddress`,
`contractAddress`, `address` and `token` — all reasonable, none correct. Because
the reader returns `null` rather than throwing, address resolution returned nothing
on every call and said nothing, and the only visible symptom was two endpoints
reporting that a parameter was required. That reads as the API's problem, and I
read it as the API's problem for longer than I want to admit.

Once the bodies arrived, three things became clear that no amount of documentation
reading would have produced:

**The envelope is not uniform.** `/search`, `/price` and `/tokens` return `data` as
an **array**; `/underlying-profile` returns `data` as an **object**. Same version,
same family, same afternoon:

```json
{ "code": 0, "msg": "success", "data": [ { "ticker": "NVDA", … } ], "success": true }
{ "code": 0, "msg": "success", "data": { "underlyingFullName": "NVIDIA (Ondo)", … }, "success": true }
```

**The field names are product names, not schema names.** `tokenContractAddress`,
`underlyingFullName`, `underlyingTicker`, `tokenToShareRatio`, `tokenPrice`,
`referencePrice`, `tokenPriceUpdatedAt`. Every one of these is a guess until it is
seen. My candidate lists were reasonable and wrong.

**One response carries two different prices, under names that do not say which is
which.**

```json
{
  "binanceChainId": "56",
  "tokenContractAddress": "0x9aee…f75f",
  "platformId": "ondo",
  "tokenPrice": "231.210905150846385687",
  "referencePrice": "230.815",
  "tokenPriceUpdatedAt": 1791661578408
}
```

`referencePrice` is `230.815`; `tokenPrice` is `231.210905150846385687`. They are
close enough that picking the wrong one would look entirely plausible on screen —
and my key-walker would have picked `referencePrice` only because the name happened
to be in its list. Had the payload also carried a field called `price`, a figure
with no provenance would have appeared in a column that promises one. I have since
replaced the walker with a fixed read of `referencePrice` and a comment saying why,
and once `/underlying-market` finally returned a body — on the fifth attempt, an
afternoon later — all five payloads were read by name. There is no walker left in
the client.

This is the one place where I think a documentation gap is doing real damage rather
than costing time. A single realistic success sample per endpoint would have
replaced a day of guessing, and it would have prevented a bug that produced no
error message at all.

**The same field name, two different prices.** When `/underlying-market` finally
answered, it carried this:

```json
"marketData": { "referencePrice": "230.349893", "high52w": "243.37", "low52w": … }
```

`/price` had returned `"referencePrice": "230.705"` for the same token, at the same
contract address, minutes earlier. One field name, two endpoints, two values, and
nothing in either response explaining the difference — whether they are struck at
different times, from different sources, or one is a close and one is a mid. The
gap is small enough that a client would never notice it and large enough that a
column labelled "reference price" cannot honestly show whichever arrived first.

I resolved this by **not using it**. `/underlying-market` is read for the market
capitalisation and the session status, and its `referencePrice` is deliberately
ignored, with a test asserting the reader returns no price at all — so that
whoever adds one back has to write down which source it came from. That is a
reasonable outcome for a client and a poor one for an API: it means one of the two
fields is decorative.

### 7. The rate limit is undocumented, and it is tight enough to bite a health check

The first probe that reached `/underlying-market` returned:

```
HTTP 429   {"code":42900,"timestamp":1791661581662,"msg":"Rate limit exceeded","data":""}
```

It cleared on its own. Reloading the same panel some hours later returned the
`/underlying-market` body that this report now quotes — so the limit is a burst
window rather than a quota, which is a useful thing to know and not something the
response says.

The probe that hit it was **five sequential requests** taking 573 ms in total —
roughly nine requests per second. The first four succeeded; the fifth was refused.
Whatever the limit is, it is low enough that a diagnostic panel exercising the five
endpoints can exhaust it, which is a strange property for an API to have: the tool
you would reach for to find out whether you are being rate-limited is itself
capable of causing it.

What is not documented, and what I could not determine from the response:

- **No rate-limit headers.** No `X-RateLimit-Limit`, no `X-RateLimit-Remaining`, no
  `Retry-After`. Nothing tells you the budget, how much of it you have spent, or
  when it resets. The only signal is a `429` after the fact.
- **What the limit applies to.** Per key, per IP, per endpoint, or per account? I
  have one key and one deployment, so I cannot separate these.
- **What the window is.** A burst limit of a few per second and a daily quota of a
  few thousand produce the same response.

Note also that this response body is shaped differently from every other failure I
received: it has `data: ""` and **no `success` field**, where `40304` and `40001`
both carry `"success": false`. A client branching on `success` — the field the API
itself supplies for that purpose — would read this as a success carrying an empty
string. Mine branches on HTTP status as well, so it is caught, but that is luck
rather than design.

This matters more than it looks. A basket of eight components needs nine requests
to render one table, and that is after I went out of my way to reduce it — the
first version made seventeen, one `/search` per ticker, until I noticed `/tokens`
returns every listing in a single call. A product built on this API has its request
count as a function of its asset count, with an undocumented, easily-reached limit
on the other side.

### 8. There is no batch form, and the one that appears to exist is undocumented

Every RWA data call is one symbol (or one address) per request. Pricing eight basket
components across a resolution and a price call is nine round trips; adding profiles
and fundamentals makes it seventeen. I capped the caller at sixteen tickers purely
to bound the fan-out, which is a product decision being forced by an API limitation
rather than made by the product.

The frustrating part is that `tokenContractAddresses` — plural — suggests a batch
form is intended. It is simply not described, and a wrong guess about the list
encoding costs a request against a limit I cannot measure. See finding 5.

---

## Metrics

|                                          |                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Endpoints integrated                     | 5 (all RWA Data)                                                      |
| Endpoints returning data                 | **5 of 5** (after the function region was moved)                      |
| Responses from the local machine         | **0 of 5** — connect timeouts, `HTTP 000`                             |
| Responses from Vercel, default region    | **5 of 5**, in 170–380 ms, all `40304`                                |
| Responses from Vercel, `sin1`            | **5 of 5**, in 82–197 ms, every one of them with data after the retry |
| Distinct error codes observed            | 5 — `40102`, `40103`, `40001`, `40304`, `42900`                       |
| Success envelopes read exactly           | 5 of 5 — no key-walker remains in the client                          |
| Time to diagnose the `/build` trap       | Avoided by reading; the docs do describe it                           |
| Time lost to `40103`-as-missing-key      | The largest single block of debugging in the integration              |
| Time lost to the unreachable host        | Roughly a working day, before the control request identified it       |
| Time lost to `40304`                     | Most of a day, resolved by moving the function region                 |
| Time lost to a silently-wrong field name | A day — no error was produced; the reader returned `null` in silence  |
| Requests to render one 8-component table | 9 (was 17 before `/tokens` was used for resolution)                   |
| Rate limits encountered                  | 1 — `42900` on the fifth request of a five-request health probe       |

---

## Overall score: 8/10

The API works, and it works well. 82–197 ms for a signed request from a cold
serverless function is good, the endpoint coverage has no gap I had to fill from
elsewhere, two of the five endpoints return data I would not have thought to ask
for, and `40001` is a genuinely excellent error that found every parameter bug in
this integration. A developer in a permitted region with the reference docs open
would have a good time with this API.

It is marked down for four things, all about what happens when something is wrong:

1. **`40304` is a dead end, and it sits in front of validation.** It is the code
   that decided whether the integration worked, it names no cause, suggests no next
   step, and — as established above — it fires before parameter validation, which
   means a request with a known-bad parameter receives a compliance refusal instead
   of a parameter complaint. It makes every other error unreachable while it is
   happening. The cause turned out to be the function region, and an error that
   said so would have saved a day.
2. **The success envelope is undocumented, and its field names are unguessable.**
   An array in three endpoints and an object in the other two, with nothing
   announcing the switch; product names rather than schema names; and two
   differently-sourced prices sharing one field name across two endpoints. I shipped
   a knowingly-defensive parser for a week because of this, and that parser
   concealed a bug that produced no error at all.
3. **The rate limit is undocumented and low enough to interrupt a health check.**
   No headers, no window, no scope — and the fifth of five sequential requests was
   refused.
4. **The error you get is not the error you have.** A missing key returns a clock
   error, and the response contradicts itself while doing it.

Fix the first and the second, and this is a 9. Nothing here is about the API being
slow, unreliable or badly scoped — it is about what it declines to tell you.

---

## Specific suggestions for the Binance team

1. **Make `40304` say which side the restriction is on, and which one it is.**
   This is the highest-value change in this list. At minimum, distinguish caller
   region, account region, product availability and chain, and say which regions
   and `chainId` values are permitted. Better, split it: `40304` for "you are in a
   restricted region", `40305` for "this product is not offered on this chain", so
   the developer knows whether to move their function or give up.

2. **Move the compliance gate behind authentication and parameter validation.** Or,
   if it must stay in front, say so in the message. Today a request with a
   misspelled parameter receives `40304` rather than `40001`, so the parameter
   check that would have solved the problem never runs, and the developer cannot
   tell whether their signature was even examined. Two words — "before
   authentication" — would have told me the signature was not the problem.

3. **Check for a present API key before validating the timestamp.** If
   `X-OC-APIKEY` is empty or missing, return a distinct code — `40101` if that is
   the auth code — and never `40103`. This would have saved the largest block of
   time in this integration, and it affects every developer in their first five
   minutes.

4. **Never echo a timestamp that validates the `X-OC-TIMESTAMP` you just
   rejected.** If the response includes a `serverTime` equal to the submitted
   timestamp and the code is still `40103`, the response contradicts itself. Either
   omit `serverTime` on a `40103`, or include the window actually applied — the
   effective `recvWindow` and the observed delta — so the developer can see the
   comparison that failed.

5. **Publish a complete success sample per endpoint, next to the parameter table.**
   Not prose describing fields — one realistic JSON body each. This is the second
   highest-value change here, and it addresses the failure mode that cost me the
   most: a wrong field name produces no error, so the only way to find it is to see
   the body. While you are there, document that `/underlying-profile` returns an
   object where the other endpoints return an array, and say explicitly that
   `/price` carries both `tokenPrice` and `referencePrice` and what the difference
   is.

   **Add one line explaining the two `referencePrice` fields.** `/price` and
   `/underlying-market` both return a field called `referencePrice` for the same
   token, and on the same afternoon they disagreed: `230.705` against `230.349893`.
   Either name one of them differently, or say which is authoritative and why they
   can differ — a different sampling time, a different venue, a close rather than a
   quote. As it stands, a client has to pick one and cannot defend the choice, and
   the one that loses is effectively dead weight in the schema.

6. **Rename `tokenContractAddresses` to `tokenContractAddress`, or rename the
   other two to match.** Three sibling endpoints, one concept, two spellings.
   `40001` naming the parameter exactly is what let me find this, and it is the
   only reason this was a ten-minute problem rather than an unfindable one — but it
   should not have been necessary.

7. **Document the list encoding for `tokenContractAddresses`, and say whether it
   accepts several.** The name is plural and nothing else about it is. State the
   separator, the maximum, and whether one request can price a whole basket — even
   a limit of 20 turns a portfolio's fan-out from O(assets) into O(1) and removes
   the incentive for every integrator to write the same `Promise.all` plus
   concurrency cap.

8. **Publish rate limits per endpoint, and send the standard headers.** A
   `Retry-After` on the `429`, and `X-RateLimit-Limit` / `X-RateLimit-Remaining` on
   every response, would turn an unanswerable question into a readable one. At
   present the only way to discover the budget is to exceed it, and the discovery
   costs a request against a limit that is low enough for a five-endpoint health
   check to trip.

9. **Give the `42900` body the same shape as every other failure.** It carries
   `"data": ""` and no `success` field, where `40304` and `40001` both carry
   `"success": false`. A client that branches on the field the API provides for
   exactly this purpose will read a rate limit as a success.

10. **Put the `/build`-in-`requestPath` rule inside the `40102` message.** Not only
    in the auth guide. Something like: _"Invalid signature. The signed
    `requestPath` must include the `/build` prefix — sign
    `/build/api/v1/dex/market/rwa/price`, not `/api/v1/dex/market/rwa/price`."_ An
    error message that names the most common cause of itself is the cheapest
    documentation there is.

11. **Publish a `preHash` example with the concatenated string shown literally.**
    Show the actual string for one concrete request, including the timestamp
    format, so it can be verified by eye rather than inferred. This is the change
    that would let a developer self-check without reaching the network at all.

12. **State the receive-window default explicitly for the RWA endpoints.** One
    sentence per endpoint confirming whether the window is enforced and what it
    defaults to would remove the need to send `X-OC-RECV-WINDOW: 60000` as a hedge.

---

## What I would tell the next developer

Read the auth section twice. Put a real key in your environment **before** your
first request — an empty key produces a misleading error rather than an obvious
one. Sign the string you actually send, `/build` included. Put
`AbortSignal.timeout()` on every call from the first line, because when this host is
unreachable the failure is a hang rather than a `5xx`.

If you receive `40304`, do not debug your client. Try a different function region
first — it was the region for me, and nothing in the message will tell you that.

Then build the diagnostics panel before you build the feature, and **render
everything it collects**. Mine returned the response body from the first day and
displayed it from the second, and that one missing line is why a wrong field name
went unnoticed for a week. It was the most useful thing I wrote and it was written
last; the second most useful thing was fixing it.

Expect the field names to be guesses. Do not write a parser that searches a payload
for plausible keys — I did, and it turned a loud failure into a silent one. Get one
real response body per endpoint first, then write the parser against it. If you
cannot, then at least make the search return an explicit "nothing matched" rather
than `null`, because `null` is indistinguishable from an absent value and will be
treated as one.

And when a parameter error names a parameter, read it literally and change exactly
that. `40001` is the best-behaved part of this API, and it is where every answer in
the last stage of this build came from.
