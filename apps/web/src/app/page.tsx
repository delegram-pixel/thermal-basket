'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { describeError, formatAmount, useBasketList, useFactoryConfig } from '@thematic/blockchain';
import { Container, Section, SectionHeading } from '@/components/ui/layout.tsx';
import { BasketCard } from '@/components/baskets/basket-card.tsx';
import { SupportedAssets } from '@/features/baskets/supported-assets.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states.tsx';
import { MockDataNotice, Notice } from '@/components/ui/notice.tsx';

/**
 * Discover.
 *
 * The landing page has one job: get someone from "what is this" to "here is a
 * basket I understand" in a single scroll. §22 lists eight sections for it, and
 * the risk with eight is that they become eight boxes of three cards each.
 *
 * So the page is built as a printed report instead: a masthead statement, a
 * live ledger, then sections separated by rules rather than by containers. The
 * composition band does most of the visual work, because a basket's allocation
 * is the one thing that distinguishes it from every other basket, and a
 * proportional bar communicates it in less space than any other form.
 */
export default function DiscoverPage() {
  const config = useFactoryConfig();
  const baskets = useBasketList();

  const settlement = config.data?.settlementToken;

  /** The distinct themes actually in use, with how many baskets carry each. */
  const themes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const basket of baskets.data ?? []) {
      const theme = basket.theme.trim();
      if (!theme) continue;
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [baskets.data]);

  const totalAssets = useMemo(() => {
    if (!baskets.data) return null;
    // A basket whose feed cannot value every holding reports `null`, and one
    // unpriceable basket makes the sum unknown rather than smaller. Reporting a
    // total that quietly omits a basket is the failure this guards against.
    if (baskets.data.some((basket) => basket.totalAssets === null)) return null;
    return baskets.data.reduce((running, basket) => running + (basket.totalAssets ?? 0n), 0n);
  }, [baskets.data]);

  const funded = (baskets.data ?? []).filter((basket) => basket.totalSupply > 0n);

  return (
    <>
      {/* -- Masthead ------------------------------------------------------- */}
      <Section className="pt-12 pb-10 sm:pt-20 sm:pb-14">
        <Container width="wide">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:gap-20">
            <div>
              <h1 className="max-w-[22ch] text-[2.5rem] leading-[1.05] text-ink sm:text-[3.5rem]">
                Own a theme, not a ticker.
              </h1>

              <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-ink-muted">
                A thematic basket is a fixed, published set of tokenized equities held together
                on-chain. You deposit a settlement asset, you receive a basket token, and you can
                redeem it at net asset value whenever you want. Every weight, every fee and every
                holding is readable from the contract that holds it.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/baskets"
                  className="inline-flex h-12 items-center justify-center rounded bg-accent px-6 text-[0.9375rem] font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  Explore baskets
                </Link>
                <Link
                  href="/create"
                  className="inline-flex h-12 items-center justify-center rounded border border-rule-strong px-6 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-sunken"
                >
                  Create a basket
                </Link>
              </div>

              <div className="mt-8 max-w-2xl">
                <MockDataNotice subject="Every price and valuation in this application" />
              </div>
            </div>

            {/* -- Live ledger ---------------------------------------------- */}
            <aside aria-label="Protocol summary" className="lg:pt-2">
              <div className="border-t border-ink pt-3">
                <p className="label">The protocol right now</p>

                <dl className="mt-4 divide-y divide-rule border-b border-rule">
                  <LedgerRow
                    label="Baskets"
                    value={baskets.data ? String(baskets.data.length) : '—'}
                  />
                  <LedgerRow label="Themes" value={baskets.data ? String(themes.length) : '—'} />
                  <LedgerRow
                    label="Funded baskets"
                    value={baskets.data ? String(funded.length) : '—'}
                  />
                  <LedgerRow
                    label="Assets under management"
                    value={
                      totalAssets !== null && settlement
                        ? `${formatAmount(totalAssets, settlement.decimals, { displayDecimals: 2, minDecimals: 2 })} ${settlement.symbol}`
                        : '—'
                    }
                    note={
                      totalAssets === null && baskets.data ? 'a holding is unpriced' : undefined
                    }
                  />
                  <LedgerRow
                    label="Settlement asset"
                    value={settlement ? settlement.symbol : '—'}
                    note={settlement ? `${settlement.decimals} decimals` : undefined}
                  />
                  <LedgerRow
                    label="Deposit fee"
                    value={
                      config.data
                        ? `${(config.data.defaults.depositFeeBps / 100).toFixed(2)}%`
                        : '—'
                    }
                    note={
                      config.data
                        ? `${(config.data.defaults.creatorShareBps / 100).toFixed(0)}% to creators`
                        : undefined
                    }
                  />
                </dl>
              </div>
            </aside>
          </div>
        </Container>
      </Section>

      {/* -- Featured baskets ------------------------------------------------ */}
      <Section divided>
        <Container width="wide">
          <SectionHeading
            title="Baskets"
            description="Each one is a published composition with its own fee terms, fixed at creation."
            action={
              <Link href="/baskets" className="text-sm text-accent hover:underline">
                All baskets →
              </Link>
            }
          />

          {baskets.isPending ? (
            <LoadingRows rows={3} />
          ) : baskets.isError ? (
            <ErrorState
              title="Baskets could not be read"
              detail={describeError(baskets.error).detail}
              raw={baskets.error instanceof Error ? baskets.error.message : undefined}
              onRetry={() => void baskets.refetch()}
            />
          ) : baskets.data.length === 0 ? (
            <EmptyState
              title="No baskets yet"
              description="This deployment has a factory but nobody has created a basket in it. You can be the first."
              action={
                <Link
                  href="/create"
                  className="inline-flex h-10 items-center rounded bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  Create the first basket
                </Link>
              }
            />
          ) : (
            <div className="border-t border-rule">
              {baskets.data.map((basket) => (
                <BasketCard
                  key={basket.address}
                  basket={basket}
                  settlementSymbol={settlement?.symbol ?? '—'}
                  settlementDecimals={settlement?.decimals ?? 18}
                />
              ))}
            </div>
          )}
        </Container>
      </Section>

      {/* -- Themes ---------------------------------------------------------- */}
      {themes.length > 0 ? (
        <Section divided>
          <Container width="wide">
            <SectionHeading
              title="Themes in use"
              description="Groupings creators have published so far. A theme is a label, not a rule — what the basket holds is the composition, and that is written on-chain."
            />

            <ul className="flex flex-wrap gap-x-3 gap-y-3">
              {themes.map(([theme, count]) => (
                <li key={theme}>
                  <Link
                    href={`/baskets?theme=${encodeURIComponent(theme)}`}
                    className="inline-flex items-baseline gap-2 rounded border border-rule bg-surface px-4 py-2.5 transition-colors hover:border-rule-strong hover:bg-sunken"
                  >
                    <span className="text-sm text-ink">{theme}</span>
                    <span className="figure text-xs text-ink-faint">
                      {count} {count === 1 ? 'basket' : 'baskets'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </Section>
      ) : null}

      {/* -- How it works ---------------------------------------------------- */}
      <Section divided>
        <Container width="wide">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
            <div>
              <h2 className="text-2xl sm:text-3xl">How a basket works</h2>
              <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-ink-muted">
                Most of what a basket does is arithmetic the contract performs in public. This is
                the whole of it, in the order it happens.
              </p>
            </div>

            <ol className="border-t border-rule">
              <Step
                index="01"
                title="A creator publishes a composition"
                body="Weights in basis points, a theme, a name and a fee schedule. Weights must total exactly 10,000 — a basket that does not add up to 100% cannot be created."
              />
              <Step
                index="02"
                title="You deposit the settlement asset"
                body="Your deposit is split across the components according to the published weights. A fee is taken first, and the remainder is what actually buys the holdings."
              />
              <Step
                index="03"
                title="You receive a basket token"
                body="One ERC-20 per basket, minted in proportion to the net asset value at the moment of your deposit. Nothing about your share is custodial: the token is yours and the holdings behind it are in the basket contract."
              />
              <Step
                index="04"
                title="You redeem whenever you want"
                body="Burning basket tokens returns the settlement asset at the prevailing net asset value, less the redemption fee. There is no lock-up and no queue — the redemption is a single transaction."
              />
              <Step
                index="05"
                title="Weights drift, and that is stated"
                body="This version does not rebalance. If one holding outperforms, the basket holds more of it in value terms than its published weight. The composition view shows both figures side by side so the difference is never a surprise."
                last
              />
            </ol>
          </div>
        </Container>
      </Section>

      {/* -- Creators -------------------------------------------------------- */}
      <Section divided>
        <Container width="wide">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-20">
            <div>
              <h2 className="text-2xl sm:text-3xl">If you publish the theme, you earn the fees</h2>
              <p className="mt-3 max-w-[60ch] leading-relaxed text-ink-muted">
                A creator sets the deposit and redemption fees when the basket is created, within
                protocol limits. Those fees accrue to the creator on every deposit and redemption,
                and are claimable at any time. The rates are immutable afterwards — a creator cannot
                raise the fee on a basket people have already invested in, and neither can the
                protocol.
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <Notice tone="info" title="What a creator controls">
                  The composition, the theme, the description, the symbol, the fee rates within
                  protocol limits, and the slippage tolerance depositors must accept.
                </Notice>
                <Notice tone="neutral" title="What a creator cannot do">
                  Withdraw the basket's holdings, mint basket tokens for themselves, change the
                  weights after creation, or change the fees.
                </Notice>
              </div>

              <div className="mt-7">
                <Link
                  href="/create"
                  className="inline-flex h-12 items-center justify-center rounded bg-accent px-6 text-[0.9375rem] font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  Create a basket
                </Link>
              </div>
            </div>

            <aside className="lg:pt-1">
              <div className="border-t border-ink pt-3">
                <p className="label">The default schedule</p>
                <table className="mt-4 w-full text-sm">
                  <tbody className="divide-y divide-rule border-b border-rule">
                    <ScheduleRow
                      label="Deposit fee"
                      value={
                        config.data
                          ? `${(config.data.defaults.depositFeeBps / 100).toFixed(2)}%`
                          : '—'
                      }
                    />
                    <ScheduleRow
                      label="Redemption fee"
                      value={
                        config.data
                          ? `${(config.data.defaults.redeemFeeBps / 100).toFixed(2)}%`
                          : '—'
                      }
                    />
                    <ScheduleRow
                      label="To the creator"
                      value={
                        config.data
                          ? `${(config.data.defaults.creatorShareBps / 100).toFixed(0)}% of each fee`
                          : '—'
                      }
                    />
                    <ScheduleRow
                      label="To the protocol"
                      value={
                        config.data
                          ? `${((10_000 - config.data.defaults.creatorShareBps) / 100).toFixed(0)}% of each fee`
                          : '—'
                      }
                    />
                    <ScheduleRow
                      label="Slippage tolerance"
                      value={
                        config.data
                          ? `${(config.data.defaults.maxSlippageBps / 100).toFixed(2)}%`
                          : '—'
                      }
                    />
                  </tbody>
                </table>
                <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                  Defaults shown; a creator may set different values within the protocol's limits.
                  Every basket's own terms are on its page.
                </p>
              </div>
            </aside>
          </div>
        </Container>
      </Section>

      {/* -- Supported assets ------------------------------------------------ */}
      <Section divided>
        <Container width="wide">
          <SectionHeading
            title="Assets available in this deployment"
            description="The component tokens this deployment recognises, with their live prices from the configured feed."
          />
          <SupportedAssets />
        </Container>
      </Section>

      {/* -- Risk ------------------------------------------------------------ */}
      <Section divided>
        <Container width="wide">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
            <h2 className="text-2xl sm:text-3xl">Before you put anything in</h2>
            <div className="space-y-4 text-sm leading-relaxed text-ink-muted">
              <p>
                <strong className="font-semibold text-ink">The assets can lose value.</strong> A
                basket holds tokenized equities, and equities fall as well as rise. A basket's net
                asset value is a market figure, not a promise, and nothing here is designed to
                preserve your principal.
              </p>
              <p>
                <strong className="font-semibold text-ink">The contracts are unaudited.</strong>{' '}
                They are an MVP written for a hackathon. They have a test suite, and a suite passing
                is not the same as a security review. Assume there are bugs.
              </p>
              <p>
                <strong className="font-semibold text-ink">Transactions are final.</strong> Once a
                deposit or redemption is confirmed in a block, no one — not this application, not
                the creator, not the protocol administrator — can reverse it.
              </p>
              <p>
                <strong className="font-semibold text-ink">Pricing can fail.</strong> A deposit
                reverts rather than proceeding when a holding cannot be priced. That is the design,
                but it means a degraded price feed makes the basket temporarily unusable rather than
                merely inaccurate.
              </p>
              <p>
                <Link
                  href="/disclosures"
                  className="text-accent underline decoration-rule-strong underline-offset-2 hover:decoration-accent"
                >
                  The full disclosures, including exactly what is simulated in this deployment
                </Link>
                .
              </p>
            </div>
          </div>
        </Container>
      </Section>

      {/* -- Closing CTA ----------------------------------------------------- */}
      <Section divided className="pb-20">
        <Container width="wide">
          <div className="flex flex-col items-start justify-between gap-6 border-t border-ink pt-8 sm:flex-row sm:items-end">
            <div>
              <p className="font-display text-2xl text-ink sm:text-3xl">
                Start with a basket you understand.
              </p>
              <p className="mt-2 max-w-[52ch] text-sm text-ink-muted">
                Every basket page states its composition, its fees and its holdings before it asks
                you for anything.
              </p>
            </div>
            <Link
              href="/baskets"
              className="inline-flex h-12 shrink-0 items-center justify-center rounded bg-accent px-6 text-[0.9375rem] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Explore baskets
            </Link>
          </div>
        </Container>
      </Section>
    </>
  );
}

/** A row of the live ledger: hairline-separated, right-aligned figures. */
function LedgerRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-ink-muted">
        {label}
        {note ? <span className="mt-0.5 block text-xs text-ink-faint">{note}</span> : null}
      </dt>
      <dd className="figure text-right text-sm text-ink">{value}</dd>
    </div>
  );
}

/** One numbered step in the mechanics list. */
function Step({
  index,
  title,
  body,
  last = false,
}: {
  index: string;
  title: string;
  body: string;
  last?: boolean;
}) {
  return (
    <li
      className={`grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 gap-y-1 py-5 ${last ? '' : 'border-b border-rule'}`}
    >
      <span className="figure pt-0.5 text-xs text-ink-faint">{index}</span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="col-start-2 max-w-[62ch] text-sm leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}

function ScheduleRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th scope="row" className="py-2.5 text-left font-normal text-ink-muted">
        {label}
      </th>
      <td className="py-2.5 text-right">
        <span className="figure text-ink">{value}</span>
      </td>
    </tr>
  );
}
