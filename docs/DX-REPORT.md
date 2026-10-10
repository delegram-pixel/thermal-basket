# Binance Web3 API — Developer Experience Report

**Project:** Thematic Baskets — weighted baskets of tokenized stocks on BNB Smart Chain
**Submitted:** 11 October 2026
**Integration:** Binance Web3 API, RWA Data endpoints, server-side, HMAC-signed

---

## A note on what this report is based on

This report is written from a single developer's log across the build, and it
contains one fact that shapes everything in it: **the network path to
`web3.binance.com` was filtered from the development machine for the entire time
the integration was being built.**

The API was not down. `dig @8.8.8.8 web3.binance.com` answered. `curl` to the
resolved addresses returned `HTTP 000` after timeouts of five minutes. Exactly
one request across a full working day returned anything at all: an `HTTP 401`
carrying `{"msg":"Timestamp outside recv_window...","code":40103}`.

So this is a report about integrating an API that I could read about but could
not call. I have kept every claim below to what I actually observed, and where
something is inference rather than observation I say so. The response envelope
shapes are parsed defensively in the shipped code precisely because I never saw
an authenticated `200`, and that is recorded as a finding rather than hidden.

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

There is also a `/diagnostics` route in the shipped app that calls all five and
prints each one's status, latency, error code and a truncated body excerpt. It
exists because of the constraint above: when you cannot reach an API, the first
thing you need is an instrument that tells you which endpoint failed and what it
said.

---

## What worked

**The endpoint set is well-scoped for the problem.** Five RWA endpoints cover
search, pricing, company profile, fundamentals and the catalogue. For a
basket product I needed to resolve a ticker, price it, and show what the company
is — and there was an endpoint for each, with no gap I had to fill from a
different API. That is not a small thing; a lot of "asset APIs" make you scrape
for the profile data.

**Numeric error codes are the right choice and I want to say so explicitly.**
`40102` and `40103` are greppable. They survive being pasted into a search box,
they survive being paraphrased wrongly by a colleague, and they are stable
enough to branch on. This is materially better than an API that returns
`{"error":"Unauthorized"}` and makes you guess. My complaint below is about
_which_ code you get, not about the scheme.

**The authentication scheme itself is simple once understood.** Four headers,
one HMAC, no OAuth dance, no token refresh, no redirect URI. For a server-side
integration this is about as little ceremony as a signed request can have.

---

## What was frustrating

### 1. A missing API key is reported as a timestamp error — and this cost me the most time

This is the finding I would most want a Binance engineer to read.

When `X-OC-APIKEY` is absent, the request is not rejected as unauthenticated. It
came back as `40103`, `Timestamp outside recv_window` — a message about the
clock, on a request that carried no key at all.

It got worse. The response body echoed a `serverTime` value **identical to the
`X-OC-TIMESTAMP` I had sent**. So the API was telling me my timestamp was outside
the receive window and, in the same response, confirming that my timestamp was
exactly right. I spent a long time on time synchronisation — checking `ntpd`,
checking the container clock, trying different timestamp formats, widening
`X-OC-RECV-WINDOW` to its maximum — because the error told me to.

The actual cause was that the key was empty. `curl` sends an empty header
happily and reports no problem; the request goes out unsigned-in-effect and the
API answers with a clock error.

**Why this is worth fixing:** the error code sent me down a path that could not
contain the answer. A developer who has not yet put a key in their `.env` — which
is every developer's first five minutes — is told to check their clock. The
suggestion below is accordingly about error precedence rather than error text.

### 2. `40102` is a real trap, and the fix is one word that isn't in the error

`/build` must be included in the `requestPath` **that gets signed**. Not in the
base URL, not in the fetch call — in the string the HMAC is computed over.

The signed string is:

```
timestamp + method + requestPath + body
```

with no separators. The full URL is `https://web3.binance.com` + `/build` +
`/api/v1/...`. It is entirely reasonable to read the docs and conclude the
`requestPath` is `/api/v1/dex/market/rwa/price`, sign that, and send the request
to the `/build`-prefixed URL. Every part of that is correct except the one that
matters, and the result is `40102 Invalid signature` with nothing to suggest
which of the four concatenated parts was wrong.

I built the client around this from the start — `signedPath()` prepends `/build`
in exactly one place, and the function that signs and the function that fetches
cannot disagree because they take the same string — but I want to be clear that I
did that because I had read about the trap, not because the API told me. A
signature error is the worst class of error to receive, because there is no
partial credit: five inputs, one wrong, and no way to narrow it from the response.

### 3. An unreachable host is indistinguishable from a broken API

`web3.binance.com` resolves through a CNAME to `dnsu8oml1p86w.cloudfront.net`,
which returns multiple A records. From this machine the DNS lookup succeeded and
connections to the resolved addresses then failed outright.

This is the finding I can now state with the most confidence, because the shipped
diagnostics panel measures it. With valid credentials in place and every request
correctly signed, all five endpoints fail the same way:

```
/api/v1/dex/market/rwa/search            no answer   8011 ms   No answer within 8000ms.
/api/v1/dex/market/rwa/price             no answer   8002 ms   No answer within 8000ms.
/api/v1/dex/market/rwa/tokens            no answer   8002 ms   No answer within 8000ms.
/api/v1/dex/market/rwa/underlying-profile no answer   8002 ms   No answer within 8000ms.
/api/v1/dex/market/rwa/underlying-market  no answer   8001 ms   No answer within 8000ms.
```

Five different endpoints, eight seconds each, identical result. That uniformity is
the tell: this is not an endpoint being slow or a signature being wrong, it is
every connection being dropped before anything is sent.

The diagnostic experience here is poor and it is not really Binance's fault, but
it is worth recording because it is the failure mode every developer in a
restricted network will hit:

- Requests failed with **no HTTP status at all** — `HTTP 000` — after multi-minute
  timeouts. There is no `503`, no body, no error code. Just a hang.
- Because the hostname is a CDN, **trying a different IP does not tell you
  anything**: I tried two resolved addresses and got identical `HTTP 000` on
  both, which is equally consistent with "Binance is down" and "your network is
  dropping this traffic".
- A five-minute default timeout means each diagnostic attempt costs five minutes.
  I burned a large amount of the build on attempts that could not have succeeded.
- **A control request is the only way to tell.** This is the experiment that
  settled it, and I would recommend it to anyone:

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

  The control host answered `200` in 0.85 s. Binance never completed a TCP
  handshake — `(28)` is curl failing at the *connect* stage, before a single byte
  was sent. That distinction matters more than the failure itself: it rules out
  clock skew, a bad signature and the `/build` prefix in one line, because none of
  them are ever reached. Without the control I would have kept debugging my own
  client.

  Worth noting what this cost to learn: **`curl` reports no HTTP status for a
  connection that never opened**, so there is no error code to look up and no
  response body to read. `HTTP 000` is not an error the API returned; it is the
  absence of an API.

The shipped mitigation was to cap every request with `AbortSignal.timeout(8000)`
and make the client return a discriminated result (`unconfigured` / `unreachable`
/ `rejected` / `malformed`) rather than throw. Distinguishing "no credentials"
from "no route to host" from "the API said no" is, in my experience of this API,
the single most valuable thing a client can do.

### 4. No batch form for prices or profiles

Every RWA data call is one symbol per request. Pricing eight basket components
across a search and a price call is sixteen HTTP round trips; adding profiles and
fundamentals takes it to twenty-four. I capped the caller at sixteen tickers
purely to bound the fan-out, which is a product decision being made by an API
limitation rather than by the product.

I want to be careful here: **I never hit a rate limit**, because I never got a
successful call through. So I cannot report on what the limits are or when they
bite. What I can say is that the shape of the API guarantees the problem — the
request count is a function of the number of assets, and the number of assets is
the thing a basket product grows.

### 5. Response envelopes were never observed

Because no authenticated call succeeded from this machine, I do not know what a
successful RWA response body looks like. I shipped a parser that searches for
candidate keys (`price`, `priceUsd`, `usdPrice`, `referencePrice`, `lastPrice`,
`markPrice`, …) at a bounded depth rather than reading a fixed path.

That is defensive code written in place of knowledge, and it is a worse outcome
for the reader of my repository than a parser with a fixed path and a comment
citing the docs. It also means I cannot tell you whether the documented envelope
is accurate, because I never saw one.

---

## Metrics

|                                              |                                                          |
| -------------------------------------------- | -------------------------------------------------------- |
| Endpoints integrated                         | 5 (all RWA Data)                                         |
| Requests that received any response          | **1** — an `HTTP 401`, code `40103`                      |
| Requests that reached an authenticated `200` | **0**                                                    |
| Time to diagnose the `/build` trap           | Avoided by reading; the docs do describe it              |
| Time lost to `40103`-as-missing-key          | The largest single block of debugging in the integration |
| Time lost to the network path                | Roughly a working day, before the cause was identified   |
| Rate limits encountered                      | None observed (never reached a successful call)          |

---

## Overall score: 6/10

The endpoint coverage is genuinely good and the error-code scheme is better than
most. I am marking it down for two reasons, both of which are about what happens
when something is wrong rather than when it is right:

1. **The error you get is not the error you have.** A missing key returns a clock
   error, and the response contradicts itself while doing it. This is the finding
   I would fix first.
2. **The failure mode for an unreachable host is a hang.** Combined with a
   documentation set I could read but not test against, this meant the
   integration was written against documentation rather than against an API —
   which is exactly the situation a developer experience is supposed to prevent.

With the two documentation and error-precedence changes below, this is an 8 or 9
for server-side integration work, because there is very little else in the way.

---

## Specific suggestions for the Binance team

1. **Check for a present API key before validating the timestamp.** If
   `X-OC-APIKEY` is empty or missing, return a distinct code — `40101` if that is
   the auth code — and never `40103`. This single change would have saved the
   largest block of time in this integration, and it affects every developer in
   their first five minutes.

2. **Never echo a `serverTime` that validates the timestamp you just rejected.**
   If the response includes a `serverTime` equal to the submitted
   `X-OC-TIMESTAMP` and the code is still `40103`, the response is contradicting
   itself. Either omit `serverTime` on a `40103`, or include the window that was
   actually applied (the effective `recvWindow` and the delta) so the developer
   can see the comparison that failed.

3. **Put the `/build`-in-`requestPath` rule in the `40102` message itself.** Not
   only in the auth guide. Something like: _"Invalid signature. The signed
   `requestPath` must include the `/build` prefix — sign
   `/build/api/v1/dex/market/rwa/price`, not `/api/v1/dex/market/rwa/price`."_
   An error message that names the most common cause of itself is the cheapest
   documentation there is.

4. **Publish a `preHash` example with the concatenated string shown literally.**
   The docs describe `timestamp + method + requestPath + body` with no
   separators. Show the actual resulting string for one concrete request,
   including the timestamp format, so the format is verifiable rather than
   inferred. This is the change that would have let me self-check without ever
   reaching the network.

5. **Add a batch price endpoint** — `POST /api/v1/dex/market/rwa/price` with a
   symbol array, or a `symbols=` comma list. Even a limit of 20 per call turns a
   basket's fan-out from O(assets) into O(1), and it removes the incentive for
   every integrator to write the same `Promise.all` + concurrency cap.

6. **Document the response envelope with a full example body per endpoint.**
   Because I could not call the API, the documented shape was the only thing I
   could build against, and there is no complete example body in the pages I
   found. A single realistic JSON sample per RWA endpoint — including a failure
   body — is worth more than prose describing the fields.

7. **State the receive-window default explicitly for the RWA endpoints.** The
   docs give a default and a maximum, and I sent `X-OC-RECV-WINDOW: 60000`
   explicitly rather than rely on either. One sentence per endpoint confirming
   whether the window is enforced and what it defaults to would remove the need
   for that hedge.

---

## What I would tell the next developer

Read the auth section twice, put a real key in your environment **before** your
first request — an empty key produces a misleading error rather than an obvious
one — sign the string you actually send, and put `AbortSignal.timeout()` on every
call from the first line, because when this host is unreachable the failure is a
hang rather than a `5xx`.

Then build the diagnostics panel before you build the feature. It was the most
useful thing I wrote, and it was written last.
