'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  BASKET_TOKEN_DECIMALS,
  formatAmount,
  formatSettlement,
  useBasketBalances,
  useBasketList,
  useClaimCreatorFees,
  useCreatorBaskets,
  useCreatorEarnings,
  useFactoryConfig,
} from '@thematic/blockchain';
import type { BasketSummary, CreatorEarnings } from '@thematic/types';
import { Container, Section } from '@/components/ui/layout.tsx';
import { AddressChip } from '@/components/ui/address.tsx';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState, ErrorState, LoadingRows, RiskMark } from '@/components/ui/states.tsx';
import { Notice } from '@/components/ui/notice.tsx';
import { Stat, StatRow } from '@/components/ui/stat.tsx';
import { TransactionStatusPanel } from '@/components/transactions/transaction-status.tsx';
import { BasketAllocation } from '@/components/baskets/basket-allocation.tsx';

/**
 * The creator's studio (§23).
 *
 * A creator has exactly two things to do here: see what their baskets have
 * earned them, and take it. Everything on this page is arranged around those,
 * which is why it is a list of the creator's own baskets rather than a second
 * explorer.
 *
 * The claim is per basket, because the contracts are. `claimCreatorFees` is a
 * method on {ThematicBasket} and each basket holds its own accrued balance, so
 * "claim everything" would be N transactions wearing the clothes of one. The
 * page says so rather than pretending otherwise: one button per row, and a
 * stated count of how many transactions a full sweep would take.
 */
export default function CreatorPage() {
  const { isConnected } = useAccount();

  return (
    <Section className="pt-12 pb-20 sm:pt-16">
      <Container width="wide">
        <header className="border-b border-ink pb-4">
          <p className="label">Creator studio</p>
          <h1 className="mt-2 text-[2rem] leading-tight sm:text-[2.5rem]">Your baskets</h1>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-ink-muted">
            Fees accrue inside each basket as people deposit and redeem, and are held there until
            you claim them. Nothing is paid out automatically, and nothing expires.
          </p>
        </header>

        <div className="pt-10">
          {isConnected ? (
            <Studio />
          ) : (
            <EmptyState
              title="Connect a wallet"
              description="The studio lists the baskets a specific address created, because that address is the only one that can claim their fees. Connect the wallet you deployed with."
            />
          )}
        </div>
      </Container>
    </Section>
  );
}

function Studio() {
  const { address: account } = useAccount();
  const config = useFactoryConfig();
  const addresses = useCreatorBaskets();
  const earnings = useCreatorEarnings(addresses.data ?? []);
  const summaries = useBasketList();

  /**
   * The creator's baskets, by address.
   *
   * `useBasketList` reads every basket on the factory; this narrows it to the
   * creator's own. Both queries are already cached and shared with the explorer,
   * so this costs no extra round trips and avoids a second per-basket reader
   * that could disagree with the explorer about the same basket.
   */
  const mine = useMemo(() => {
    if (!summaries.data || !addresses.data) return [];
    const owned = new Set(addresses.data.map((basket) => basket.toLowerCase()));
    return summaries.data.filter((basket) => owned.has(basket.address.toLowerCase()));
  }, [summaries.data, addresses.data]);

  const earningsByBasket = useMemo(() => {
    const map = new Map<string, CreatorEarnings>();
    for (const entry of earnings.data ?? []) map.set(entry.basket.toLowerCase(), entry);
    return map;
  }, [earnings.data]);

  const settlement = config.data?.settlementToken;

  const totals = useMemo(() => {
    if (!settlement) return null;

    const claimable = mine.map(
      (basket) => earningsByBasket.get(basket.address.toLowerCase())?.claimable,
    );

    return {
      // `undefined` means the row has not been read yet; `null` means the read
      // failed. Both stop the sum, for the reason the discover page's AUM total
      // states: a total that silently omits a basket is worse than no total.
      claimable: claimable.some((value) => value === undefined || value === null)
        ? null
        : claimable.reduce<bigint>((running, value) => running + (value ?? 0n), 0n),
      assets: mine.some((basket) => basket.totalAssets === null)
        ? null
        : mine.reduce<bigint>((running, basket) => running + (basket.totalAssets ?? 0n), 0n),
      holders: mine.filter((basket) => basket.totalSupply > 0n).length,
    };
  }, [mine, earningsByBasket, settlement]);

  const loading = addresses.isPending || summaries.isPending;
  const failed = addresses.isError || summaries.isError;

  if (loading) {
    return <LoadingRows rows={3} />;
  }

  if (failed) {
    return (
      <ErrorState
        title="Your baskets could not be read"
        detail="The factory's registry and the baskets it lists both have to be readable before this page can say anything true. Check the network your wallet is on."
        onRetry={() => {
          void addresses.refetch();
          void summaries.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-12">
      {/* -- The three figures that answer "how is it going" ---------------- */}
      {settlement ? (
        <StatRow>
          <Stat
            label="Claimable now"
            // An unreadable fee balance renders as the em-dash "not available"
            // rather than a number. `0.00` would be a claim about the chain, and
            // this page has no basis for making it.
            unavailable={totals?.claimable === null}
            value={
              totals?.claimable
                ? formatSettlement(totals.claimable, settlement.decimals, settlement.symbol)
                : ''
            }
            hint={
              totals?.claimable === null
                ? 'A basket’s fee balance could not be read, so this total is not stated.'
                : 'Across every basket below. Claiming is one transaction per basket.'
            }
          />
          <Stat
            label="Assets across your baskets"
            unavailable={totals?.assets === null}
            value={
              totals?.assets
                ? formatSettlement(totals.assets, settlement.decimals, settlement.symbol)
                : ''
            }
            hint="What depositors have put in, valued at the current mock feed."
          />
          <Stat
            label="Baskets created"
            value={String(mine.length)}
            hint={
              mine.length === 0
                ? 'You have not deployed a basket yet.'
                : `${totals?.holders ?? 0} of them ${totals?.holders === 1 ? 'has' : 'have'} at least one depositor.`
            }
          />
        </StatRow>
      ) : null}

      {mine.length === 0 ? (
        <EmptyState
          title="You have not created a basket"
          description="A basket is deployed once with a fixed composition and fixed fees, and accrues a share of every deposit and redemption to whoever created it. Composing one takes a few minutes; the fees are yours for as long as the basket trades."
          action={
            <Link
              href="/create"
              className="inline-flex h-11 items-center justify-center rounded bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Compose a basket
            </Link>
          }
        />
      ) : (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 border-b border-ink pb-3">
            <h2 className="text-lg font-semibold text-ink">
              {mine.length} {mine.length === 1 ? 'basket' : 'baskets'}
            </h2>
            {/* The empty state below offers this too, but it disappears the
                moment the first basket exists — which is exactly when a creator
                is most likely to want a second one and least likely to find it. */}
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <p className="text-xs text-ink-muted">
                Claiming clears one basket at a time — a full sweep is {mine.length}{' '}
                {mine.length === 1 ? 'transaction' : 'transactions'}.
              </p>
              <Link
                href="/create"
                className="text-xs font-medium text-accent transition-colors hover:text-accent-hover"
              >
                Compose another →
              </Link>
            </div>
          </div>

          <ul>
            {mine.map((basket) => (
              <CreatorRow
                key={basket.address}
                basket={basket}
                earnings={earningsByBasket.get(basket.address.toLowerCase())}
                settlementDecimals={settlement?.decimals ?? 18}
                settlementSymbol={settlement?.symbol ?? ''}
                earningsLoaded={earnings.isSuccess}
              />
            ))}
          </ul>
        </div>
      )}

      {/* -- The treasury, per basket --------------------------------------- */}
      {mine.length > 0 ? (
        <div>
          <h2 className="border-b border-ink pb-3 text-lg font-semibold text-ink">
            Basket treasuries
          </h2>
          <p className="mt-3 mb-5 max-w-[70ch] text-sm leading-relaxed text-ink-muted">
            Each basket holds two separate pools of money that are not its assets: the settlement it
            has taken in fees and not yet paid out. The creator's share is claimable by you; the
            protocol's share is claimable by the treasury address. Neither can be spent by the
            basket on components — they are liabilities, not capital.
          </p>

          <div className="grid gap-6 lg:grid-cols-2">
            {mine.map((basket) => (
              <TreasuryPanel
                key={basket.address}
                basket={basket}
                decimals={settlement?.decimals ?? 18}
                symbol={settlement?.symbol ?? ''}
              />
            ))}
          </div>
        </div>
      ) : null}

      <Notice tone="neutral" title="Where the fees come from">
        A basket charges a deposit fee on the way in and a redemption fee on the way out. Only the
        creator's share of those accrues here; the rest goes to the protocol treasury. Because the
        rates are fixed at deployment, the only way to change what a basket earns you is to deploy
        another one.
      </Notice>

      {account ? (
        <p className="text-xs text-ink-faint">
          Reading baskets created by <span className="figure">{account}</span>.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One basket
// ---------------------------------------------------------------------------

function CreatorRow({
  basket,
  earnings,
  settlementDecimals,
  settlementSymbol,
  earningsLoaded,
}: {
  basket: BasketSummary;
  earnings: CreatorEarnings | undefined;
  settlementDecimals: number;
  settlementSymbol: string;
  earningsLoaded: boolean;
}) {
  const claim = useClaimCreatorFees(basket.address);
  const [open, setOpen] = useState(false);

  const claimable = earnings?.claimable;
  // `undefined` is "not read yet" and `null` is "the read failed"; only a real
  // bigint above zero offers the button.
  const canClaim = typeof claimable === 'bigint' && claimable > 0n;

  return (
    <li className="border-b border-rule py-5">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <Link
              href={`/baskets/${basket.address}`}
              className="font-display text-lg text-ink underline decoration-rule-strong decoration-1 underline-offset-4 transition-colors hover:decoration-accent"
            >
              {basket.name}
            </Link>
            <span className="figure text-xs text-ink-muted">{basket.symbol}</span>
            {basket.paused ? (
              <span className="rounded-sm bg-sunken px-1.5 py-0.5 text-[0.6875rem] font-medium text-warning">
                Paused
              </span>
            ) : null}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-muted">
            <span>{basket.theme}</span>
            <span className="figure">
              {basket.totalAssets === null
                ? 'Unpriced'
                : `${formatSettlement(basket.totalAssets, settlementDecimals, settlementSymbol)} held`}
            </span>
            <span className="figure">
              {basket.totalSupply === 0n
                ? 'No depositors yet'
                : `${formatAmount(basket.totalSupply, BASKET_TOKEN_DECIMALS)} ${basket.symbol} outstanding`}
            </span>
            <AddressChip address={basket.address} visible={4} />
          </div>

          <div className="mt-3.5 max-w-md">
            <BasketAllocation segments={basket.weights} size="sm" />
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-3">
          <div className="text-right">
            <p className="label">Claimable</p>
            <p className="figure mt-0.5 text-base text-ink">
              {claimable === undefined
                ? earningsLoaded
                  ? '—'
                  : 'Reading…'
                : claimable === null
                  ? 'Unavailable'
                  : formatSettlement(claimable, settlementDecimals, settlementSymbol, {
                      displayDecimals: 2,
                      minDecimals: 2,
                    })}
            </p>
          </div>

          <Button
            size="sm"
            variant="primary"
            disabled={!canClaim || claim.busy}
            busy={claim.busy}
            onClick={() => {
              setOpen(true);
              void claim.claim();
            }}
          >
            {claim.busy ? 'Claiming…' : 'Claim fees'}
          </Button>

          {claimable === null ? (
            <p className="flex max-w-[16rem] items-start gap-1.5 text-right text-xs text-warning">
              <RiskMark tone="warning" className="size-3.5" />
              <span>
                The basket&rsquo;s fee balance could not be read. This is not a zero balance.
              </span>
            </p>
          ) : null}
        </div>
      </div>

      {open && claim.state.status !== 'idle' ? (
        <div className="mt-4">
          <TransactionStatusPanel
            state={claim.state}
            onRetry={() => void claim.claim()}
            onDismiss={() => {
              claim.reset();
              setOpen(false);
            }}
            retryLabel="Try the claim again"
          />
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------

function TreasuryPanel({
  basket,
  decimals,
  symbol,
}: {
  basket: BasketSummary;
  decimals: number;
  symbol: string;
}) {
  const balances = useBasketBalances(basket.address);

  const amount = (value: bigint | undefined) =>
    value === undefined ? '—' : formatSettlement(value, decimals, symbol);

  return (
    <div className="rounded border border-rule bg-surface px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium text-ink">{basket.name}</p>
        <p className="figure text-xs text-ink-faint">{basket.symbol}</p>
      </div>

      {balances.isError ? (
        <p className="mt-3 text-xs text-warning">
          This basket&rsquo;s balances could not be read. The figures below are not available, which
          is not the same as being zero.
        </p>
      ) : (
        <dl className="mt-3.5 space-y-2 text-sm">
          <TreasuryRow label="Free settlement" value={amount(balances.data?.free)} />
          <TreasuryRow label="Creator fees held" value={amount(balances.data?.creatorFees)} />
          <TreasuryRow label="Protocol fees held" value={amount(balances.data?.protocolFees)} />
        </dl>
      )}

      <p className="mt-3.5 border-t border-rule pt-3 text-xs leading-relaxed text-ink-faint">
        Free settlement is what the basket holds outside its component positions — the remainder of
        deposits too small to buy a whole unit of something. It belongs to the basket&rsquo;s
        holders, not to you.
      </p>
    </div>
  );
}

function TreasuryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="figure text-ink">{value}</dd>
    </div>
  );
}
