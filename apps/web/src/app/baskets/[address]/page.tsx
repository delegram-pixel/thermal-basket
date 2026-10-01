'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import {
  describeError,
  formatAmount,
  formatBps,
  formatNavPerShare,
  formatSettlement,
  useBasket,
  useBasketBalances,
  useFactoryConfig,
  usePosition,
} from '@thematic/blockchain';
import type { Address, Basket, TokenMetadata } from '@thematic/types';
import {
  Container,
  Detail,
  Panel,
  PanelHeader,
  Section,
  SectionHeading,
} from '@/components/ui/layout.tsx';
import { Stat, StatCell, StatRow } from '@/components/ui/stat.tsx';
import { Button } from '@/components/ui/button.tsx';
import { PausedBadge } from '@/components/ui/badge.tsx';
import { AddressChip } from '@/components/ui/address.tsx';
import { ErrorState, LoadingState, RiskMark } from '@/components/ui/states.tsx';
import { MockDataNotice, Notice } from '@/components/ui/notice.tsx';
import { AllocationChart } from '@/components/baskets/allocation-chart.tsx';
import { BasketAllocation, AllocationLegend } from '@/components/baskets/basket-allocation.tsx';
import { FeeSummary } from '@/components/baskets/fee-summary.tsx';
import { DepositModal } from '@/features/deposits/deposit-modal.tsx';
import { WithdrawModal } from '@/features/withdrawals/withdraw-modal.tsx';

/** The amount the worked fee example is computed on: 1,000 settlement units. */
const EXAMPLE_UNITS = 1_000n;

export default function BasketDetailPage() {
  const params = useParams<{ address: string }>();
  const address = params.address as Address | undefined;

  const basket = useBasket(address);
  const config = useFactoryConfig();
  const settlement = config.data?.settlementToken;

  const [depositOpen, setDepositOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  if (basket.isPending || (basket.isSuccess && !settlement)) {
    return (
      <Container width="wide" className="py-16">
        <LoadingState message="Reading the basket from the chain…" />
      </Container>
    );
  }

  if (basket.isError) {
    const error = describeError(basket.error);
    return (
      <Container width="wide" className="py-16">
        <ErrorState
          title="This basket could not be read"
          detail={`${error.detail} The address may not be a Thematic basket on this network, or it may be a basket on a different network than the one your wallet is connected to.`}
          raw={basket.error instanceof Error ? basket.error.message : undefined}
          onRetry={() => void basket.refetch()}
          retryLabel="Read it again"
        />
        <p className="mt-6 text-sm">
          <Link href="/baskets" className="text-accent hover:underline">
            ← All baskets
          </Link>
        </p>
      </Container>
    );
  }

  if (!settlement) {
    return (
      <Container width="wide" className="py-16">
        <ErrorState
          title="No deployment is configured"
          detail="The settlement asset could not be determined, so no figure on this page can be denominated. Check the application's environment configuration."
        />
      </Container>
    );
  }

  return (
    <BasketView
      basket={basket.data}
      settlement={settlement}
      depositOpen={depositOpen}
      redeemOpen={redeemOpen}
      onOpenDeposit={() => setDepositOpen(true)}
      onOpenRedeem={() => setRedeemOpen(true)}
      onCloseDeposit={() => setDepositOpen(false)}
      onCloseRedeem={() => setRedeemOpen(false)}
    />
  );
}

function BasketView({
  basket,
  settlement,
  depositOpen,
  redeemOpen,
  onOpenDeposit,
  onOpenRedeem,
  onCloseDeposit,
  onCloseRedeem,
}: {
  basket: Basket;
  settlement: TokenMetadata;
  depositOpen: boolean;
  redeemOpen: boolean;
  onOpenDeposit: () => void;
  onOpenRedeem: () => void;
  onCloseDeposit: () => void;
  onCloseRedeem: () => void;
}) {
  const { isConnected } = useAccount();
  const position = usePosition(basket.address);
  const balances = useBasketBalances(basket.address);

  const funded = basket.totalSupply > 0n;
  const priced = basket.navPerShare !== null && basket.totalAssets !== null;

  // Every component must be priceable for the basket to be tradeable at all.
  // One gap in the feed and `previewDeposit` reverts, so the buttons must not
  // offer an action the contract will refuse.
  const unpriced = basket.components.filter((component) => component.price === null);

  const canTransact = !basket.paused && unpriced.length === 0;

  return (
    <>
      {/* -- Header --------------------------------------------------------- */}
      <Section className="pt-10 pb-8 sm:pt-14">
        <Container width="wide">
          <p className="text-xs">
            <Link href="/baskets" className="text-ink-muted hover:text-ink">
              ← All baskets
            </Link>
          </p>

          <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-16">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="font-display text-[2rem] leading-tight sm:text-[2.5rem]">
                  {basket.name}
                </h1>
                <span className="figure text-sm tracking-wide text-ink-muted">{basket.symbol}</span>
                <PausedBadge paused={basket.paused} />
              </div>

              <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-muted">
                {basket.theme ? (
                  <>
                    <Link
                      href={`/baskets?theme=${encodeURIComponent(basket.theme)}`}
                      className="hover:text-ink"
                    >
                      {basket.theme}
                    </Link>
                    <span aria-hidden="true" className="text-rule-strong">
                      ·
                    </span>
                  </>
                ) : null}
                <span>
                  created by <AddressChip address={basket.creator} visible={4} />
                </span>
                <span aria-hidden="true" className="text-rule-strong">
                  ·
                </span>
                <span>{basket.components.length} components</span>
              </p>

              {basket.description ? (
                <p className="mt-4 max-w-[68ch] leading-relaxed text-ink-muted">
                  {basket.description}
                </p>
              ) : null}

              <div className="mt-6">
                <BasketAllocation segments={basket.components} size="lg" />
              </div>

              <div className="mt-3 max-w-3xl">
                <AllocationLegend segments={basket.components} />
              </div>
            </div>

            {/* -- Actions --------------------------------------------------- */}
            <div className="w-full shrink-0 lg:w-72">
              <div className="rounded border border-rule bg-surface px-5 py-5">
                {basket.paused ? (
                  <p className="mb-4 flex items-start gap-2 text-sm text-warning">
                    <RiskMark tone="warning" />
                    <span>
                      This basket is paused. Deposits and redemptions are disabled until the creator
                      unpauses it. Your tokens are unaffected and the holdings have not moved.
                    </span>
                  </p>
                ) : null}

                <div className="flex flex-col gap-2">
                  <Button
                    variant="primary"
                    size="lg"
                    block
                    disabled={!canTransact}
                    onClick={onOpenDeposit}
                  >
                    Deposit {settlement.symbol}
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    block
                    disabled={!canTransact}
                    onClick={onOpenRedeem}
                  >
                    Redeem tokens
                  </Button>
                </div>

                {!canTransact && !basket.paused ? (
                  <p className="mt-3 text-xs leading-relaxed text-warning">
                    {unpriced.length === 1
                      ? `${unpriced[0]?.symbol ?? 'A component'} has no price from the feed, so the basket cannot be priced and any deposit or redemption would be rejected by the contract.`
                      : `${unpriced.length} components have no price from the feed, so the basket cannot be priced and any deposit or redemption would be rejected by the contract.`}
                  </p>
                ) : null}

                <p className="mt-4 border-t border-rule pt-3 text-xs leading-relaxed text-ink-faint">
                  Fees are {formatBps(basket.fees.depositFeeBps)} to deposit and{' '}
                  {formatBps(basket.fees.redeemFeeBps)} to redeem. The contract holds your deposit;
                  this application never does.
                </p>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* -- Figures --------------------------------------------------------- */}
      <Section className="pt-0 pb-10">
        <Container width="wide">
          <div className="border-t border-ink pt-6">
            <StatRow>
              <StatCell>
                <Stat
                  label="NAV per token"
                  size="lg"
                  unavailable={!funded || !priced}
                  value={
                    basket.navPerShare !== null
                      ? formatNavPerShare(basket.navPerShare, settlement.decimals)
                      : '—'
                  }
                  unit={funded && priced ? settlement.symbol : undefined}
                  hint={
                    !funded
                      ? 'No deposits yet, so no net asset value exists'
                      : !priced
                        ? 'A component cannot be priced'
                        : 'One whole basket token, at the feed'
                  }
                />
              </StatCell>

              <StatCell>
                <Stat
                  label="Assets held"
                  size="lg"
                  unavailable={basket.totalAssets === null}
                  value={
                    basket.totalAssets !== null
                      ? formatAmount(basket.totalAssets, settlement.decimals, {
                          displayDecimals: 2,
                          minDecimals: 2,
                        })
                      : '—'
                  }
                  unit={basket.totalAssets !== null ? settlement.symbol : undefined}
                  hint="Everything the contract holds, before fees"
                />
              </StatCell>

              <StatCell>
                <Stat
                  label="Tokens outstanding"
                  value={formatAmount(basket.totalSupply, basket.decimals, {
                    displayDecimals: 2,
                    minDecimals: 2,
                  })}
                  unit={basket.symbol}
                  hint={funded ? 'Basket tokens in circulation' : 'None minted yet'}
                />
              </StatCell>

              <StatCell>
                {/*
                  Four states, and the old fall-through collapsed three of them
                  into one. `position.data` is undefined while the query is
                  switched off for want of a wallet, while it is in flight, and
                  after it has failed — and all three rendered "None · You do
                  not hold this basket". For a disconnected visitor that is a
                  claim about an address the page has not read; for a connected
                  one it is a false claim that corrected itself a moment later,
                  which is worse, because it is the kind a reader believes.

                  The em-dash is this page's existing mark for "no figure
                  exists", so each of those three says why in its hint rather
                  than inventing a fourth vocabulary.
                */}
                {position.data && position.data.shares > 0n ? (
                  <Stat
                    label="Your position"
                    value={formatSettlement(
                      position.data.value,
                      settlement.decimals,
                      settlement.symbol,
                      {
                        displayDecimals: 2,
                        minDecimals: 2,
                      },
                    )}
                    hint={`${formatAmount(position.data.shares, basket.decimals)} ${basket.symbol} · ${formatBps(position.data.ownershipBps)} of the basket`}
                  />
                ) : !isConnected ? (
                  <Stat
                    label="Your position"
                    value="—"
                    hint="Connect a wallet to read your position"
                  />
                ) : position.isPending ? (
                  <Stat label="Your position" value="—" hint="Reading your balance…" />
                ) : position.isError ? (
                  <Stat label="Your position" value="—" hint="Your balance could not be read" />
                ) : (
                  <Stat label="Your position" value="None" hint="You do not hold this basket" />
                )}
              </StatCell>
            </StatRow>
          </div>

          <div className="mt-6 max-w-3xl">
            <MockDataNotice
              subject="The prices, valuations and net asset value on this page"
              compact
            />
          </div>
        </Container>
      </Section>

      {/* -- Composition ----------------------------------------------------- */}
      <Section divided>
        <Container width="wide">
          <SectionHeading
            title="Composition"
            description="The published target weights, and what the basket actually holds after prices have moved."
          />
          <AllocationChart
            components={basket.components}
            fees={basket.fees}
            settlementDecimals={settlement.decimals}
            settlementSymbol={settlement.symbol}
          />
        </Container>
      </Section>

      {/* -- Fees ------------------------------------------------------------ */}
      <Section divided>
        <Container width="wide">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-20">
            <div>
              <h2 className="text-2xl sm:text-3xl">Fees</h2>
              <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-ink-muted">
                Set by the creator when this basket was deployed, and immutable since. There is no
                mechanism — for the creator or for the protocol — to change any of these on a basket
                that already exists.
              </p>
              <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-ink-muted">
                <Link href="/disclosures#fees" className="text-accent hover:underline">
                  How the fees are taken, in full
                </Link>
                .
              </p>
            </div>

            <FeeSummary
              fees={basket.fees}
              settlementDecimals={settlement.decimals}
              settlementSymbol={settlement.symbol}
              exampleAmount={EXAMPLE_UNITS * 10n ** BigInt(settlement.decimals)}
            />
          </div>
        </Container>
      </Section>

      {/* -- Position and treasury ------------------------------------------- */}
      <Section divided>
        <Container width="wide">
          <SectionHeading
            title="Position and treasury"
            description="What this wallet holds, and what the contract is holding on everyone's behalf."
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <PanelHeader
                title="Your position"
                action={
                  position.data && position.data.shares > 0n && canTransact ? (
                    <Button size="sm" variant="secondary" onClick={onOpenRedeem}>
                      Redeem
                    </Button>
                  ) : null
                }
              />
              <div className="px-5 py-5">
                {/*
                  The disconnected case comes first, and has to.

                  `usePosition` is gated on having an account, so with no wallet
                  the query never runs — and TanStack's `isPending` is
                  `status === 'pending'`, which a query that never runs stays in
                  forever. Branching on it alone left a spinner that resolved for
                  nobody, which is the one thing a loading state must never do.

                  The obvious repair — test `isLoading` instead, which is
                  `isPending && isFetching` — falls through to the branch below
                  and tells a visitor with no wallet "This wallet holds no AIW."
                  That is a claim about an address the page has not read. It might
                  be true. The page cannot know, so it must not say it.

                  So the state is stated plainly, and the copy names what would
                  change it. It deliberately does not offer a connect button: the
                  masthead already carries one, and a second entry point would
                  make this panel look like a gate rather than a report.
                */}
                {!isConnected ? (
                  <div className="py-2">
                    <p className="text-sm leading-relaxed text-ink-muted">
                      Connect a wallet to see what it holds in this basket. Nothing is read from
                      your address until you do.
                    </p>
                  </div>
                ) : position.isPending ? (
                  <LoadingState message="Reading your position…" />
                ) : position.data && position.data.shares > 0n ? (
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
                    <Detail label="Basket tokens">
                      <span className="figure">
                        {formatAmount(position.data.shares, basket.decimals)}
                      </span>{' '}
                      <span className="text-xs text-ink-faint">{basket.symbol}</span>
                    </Detail>
                    <Detail label="Value at NAV">
                      <span className="figure">
                        {formatSettlement(
                          position.data.value,
                          settlement.decimals,
                          settlement.symbol,
                          {
                            displayDecimals: 2,
                            minDecimals: 2,
                          },
                        )}
                      </span>
                    </Detail>
                    <Detail label="Share of basket">
                      <span className="figure">{formatBps(position.data.ownershipBps)}</span>
                    </Detail>
                    <Detail label="Redeemable for" hint="Before the redemption fee">
                      <span className="figure">
                        {formatSettlement(
                          position.data.value,
                          settlement.decimals,
                          settlement.symbol,
                          {
                            displayDecimals: 2,
                            minDecimals: 2,
                          },
                        )}
                      </span>
                    </Detail>
                  </dl>
                ) : (
                  <div className="py-2">
                    <p className="text-sm text-ink-muted">This wallet holds no {basket.symbol}.</p>
                    {canTransact ? (
                      <Button variant="primary" size="sm" className="mt-4" onClick={onOpenDeposit}>
                        Deposit {settlement.symbol}
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            </Panel>

            <Panel tone="sunken">
              <PanelHeader title="Held by the contract" />
              <div className="px-5 py-5">
                {balances.isPending ? (
                  <LoadingState message="Reading the contract's balances…" />
                ) : balances.data ? (
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
                    <Detail label="Free balance" hint="Available to back redemptions">
                      <span className="figure">
                        {formatSettlement(
                          balances.data.free,
                          settlement.decimals,
                          settlement.symbol,
                          {
                            displayDecimals: 2,
                            minDecimals: 2,
                          },
                        )}
                      </span>
                    </Detail>
                    <Detail label="Unclaimed creator fees" hint="Accrued, not yet withdrawn">
                      <span className="figure">
                        {formatSettlement(
                          balances.data.creatorFees,
                          settlement.decimals,
                          settlement.symbol,
                          { displayDecimals: 2, minDecimals: 2 },
                        )}
                      </span>
                    </Detail>
                    <Detail label="Unclaimed protocol fees">
                      <span className="figure">
                        {formatSettlement(
                          balances.data.protocolFees,
                          settlement.decimals,
                          settlement.symbol,
                          { displayDecimals: 2, minDecimals: 2 },
                        )}
                      </span>
                    </Detail>
                  </dl>
                ) : (
                  <p className="text-sm text-ink-muted">
                    The contract's balances could not be read.
                  </p>
                )}
              </div>
            </Panel>
          </div>
        </Container>
      </Section>

      {/* -- Contract -------------------------------------------------------- */}
      <Section divided className="pb-20">
        <Container width="wide">
          <SectionHeading
            title="The contract"
            description="Everything on this page was read from the addresses below. Read them yourself and check."
          />

          <div className="grid gap-x-12 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="label">Basket</p>
              <div className="mt-1.5">
                <AddressChip address={basket.address} visible={6} />
              </div>
            </div>
            <div>
              <p className="label">Settlement asset</p>
              <div className="mt-1.5">
                <AddressChip address={settlement.address} visible={6} />
              </div>
            </div>
            <div>
              <p className="label">Creator</p>
              <div className="mt-1.5">
                <AddressChip address={basket.creator} visible={6} />
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {basket.components.map((component) => (
              <div key={component.address} className="border-t border-rule pt-3">
                <p className="figure text-sm text-ink">{component.symbol}</p>
                <p className="mt-0.5 truncate text-xs text-ink-faint">{component.name}</p>
                <div className="mt-2">
                  <AddressChip address={component.address} visible={5} />
                </div>
              </div>
            ))}
          </div>

          <Notice tone="neutral" className="mt-8 max-w-3xl">
            This application is unaudited software reading unaudited contracts. If a figure here
            disagrees with the contract, the contract is right — this page is a rendering of it, not
            a record of it.
          </Notice>
        </Container>
      </Section>

      {/* -- Action dialogs -------------------------------------------------- */}
      <DepositModal
        open={depositOpen}
        onClose={onCloseDeposit}
        basket={basket}
        settlement={settlement}
      />
      <WithdrawModal
        open={redeemOpen}
        onClose={onCloseRedeem}
        basket={basket}
        settlement={settlement}
      />
    </>
  );
}
