'use client';

import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { describeError, useBasketList, useFactoryConfig } from '@thematic/blockchain';
import type { BasketSummary } from '@thematic/types';
import { Container, Section } from '@/components/ui/layout.tsx';
import { BasketCard } from '@/components/baskets/basket-card.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states.tsx';
import { MockDataNotice } from '@/components/ui/notice.tsx';
import { SelectField, TextField } from '@/components/ui/field.tsx';
import { Button } from '@/components/ui/button.tsx';

/**
 * The explorer.
 *
 * Filtering and sorting happen in the browser over the list that was already
 * read, rather than as new queries. The whole set is one `baskets()` call to the
 * factory followed by a bounded number of per-basket reads, so re-querying on
 * every keystroke would cost a round trip per character to filter data already
 * in memory.
 *
 * The theme filter is driven by the URL so a theme chip on the discover page can
 * link into a pre-filtered view. Everything else is component state, because
 * nothing else is worth sharing as a link.
 */
export default function BasketsPage() {
  return (
    <Section className="pt-12 pb-20 sm:pt-16">
      <Container width="wide">
        <header className="border-b border-ink pb-4">
          <p className="label">Explorer</p>
          <h1 className="mt-2 text-[2rem] leading-tight sm:text-[2.5rem]">Every basket</h1>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-ink-muted">
            Read from the factory contract on this network. Each row shows the composition as
            published and the value the basket currently holds, and both come from the chain rather
            than from a database this application keeps.
          </p>
        </header>

        {/* `useSearchParams` needs a boundary: without one this page cannot be
            prerendered at all, and the whole route would fall back to
            client-only rendering on first paint. */}
        <Suspense
          fallback={
            <div className="pt-8">
              <LoadingRows rows={4} />
            </div>
          }
        >
          <BasketList />
        </Suspense>
      </Container>
    </Section>
  );
}

type Sort = 'recent' | 'assets' | 'nav' | 'name';

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'recent', label: 'Most recently created' },
  { value: 'assets', label: 'Largest by assets' },
  { value: 'nav', label: 'Highest NAV per token' },
  { value: 'name', label: 'Name, A–Z' },
];

function BasketList() {
  const params = useSearchParams();
  const initialTheme = params.get('theme') ?? 'all';

  const baskets = useBasketList();
  const config = useFactoryConfig();
  const settlement = config.data?.settlementToken;

  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState(initialTheme);
  const [sort, setSort] = useState<Sort>('recent');

  const themes = useMemo(() => {
    const distinct = new Set<string>();
    for (const basket of baskets.data ?? []) {
      const value = basket.theme.trim();
      if (value) distinct.add(value);
    }
    return [...distinct].sort((a, b) => a.localeCompare(b));
  }, [baskets.data]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = (baskets.data ?? []).filter((basket) => {
      if (theme !== 'all' && basket.theme.trim() !== theme) return false;
      if (!needle) return true;
      return (
        basket.name.toLowerCase().includes(needle) ||
        basket.symbol.toLowerCase().includes(needle) ||
        basket.theme.toLowerCase().includes(needle) ||
        basket.description.toLowerCase().includes(needle)
      );
    });

    // The factory returns baskets oldest-first, so "most recently created" is
    // that list reversed; the other three sorts are comparisons. `sort` is kept
    // stable across renders by React, so an in-place reverse would be safe, but
    // the copy is cheap and removing the question is cheaper than answering it.
    if (sort === 'recent') return [...filtered].reverse();
    return [...filtered].sort((a, b) => compare(a, b, sort));
  }, [baskets.data, query, theme, sort]);
  const filtered = query.trim() !== '' || theme !== 'all';

  if (baskets.isPending) {
    return (
      <div className="pt-8">
        <LoadingRows rows={5} />
      </div>
    );
  }

  if (baskets.isError) {
    return (
      <div className="pt-8">
        <ErrorState
          title="The basket list could not be read"
          detail={describeError(baskets.error).detail}
          raw={baskets.error instanceof Error ? baskets.error.message : undefined}
          onRetry={() => void baskets.refetch()}
        />
      </div>
    );
  }

  if (baskets.data.length === 0) {
    return (
      <div className="pt-8">
        <EmptyState
          title="No baskets have been created on this network"
          description="The factory contract is deployed and working; nobody has published a composition in it yet. Creating one is a single transaction."
          action={
            <Link
              href="/create"
              className="inline-flex h-10 items-center rounded bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Create a basket
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-rule py-5">
        <div className="min-w-[14rem] flex-1">
          <TextField
            label="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, symbol, theme or description"
            type="search"
          />
        </div>

        <div className="w-full sm:w-52">
          <SelectField
            label="Theme"
            value={theme}
            onChange={(event) => setTheme(event.target.value)}
          >
            <option value="all">All themes</option>
            {themes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="w-full sm:w-64">
          <SelectField
            label="Sort by"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-3 pt-4">
        <p className="text-xs text-ink-muted">
          <span className="figure">{visible.length}</span>{' '}
          {visible.length === 1 ? 'basket' : 'baskets'}
          {filtered ? ` of ${baskets.data.length}` : ''}
        </p>

        {filtered ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQuery('');
              setTheme('all');
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="pt-6">
          <EmptyState
            title="Nothing matches those filters"
            description="Every basket on this network has been filtered out. Clearing the filters will bring them back."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setQuery('');
                  setTheme('all');
                }}
              >
                Clear filters
              </Button>
            }
          />
        </div>
      ) : (
        <div className="border-t border-rule">
          {visible.map((basket) => (
            <BasketCard
              key={basket.address}
              basket={basket}
              settlementSymbol={settlement?.symbol ?? '—'}
              settlementDecimals={settlement?.decimals ?? 18}
            />
          ))}
        </div>
      )}

      <div className="mt-8 max-w-3xl">
        <MockDataNotice subject="The valuations and net asset values on this page" compact />
      </div>
    </>
  );
}

/**
 * Ordering for the three comparison sorts.
 *
 * The two figure-based ones deliberately sink rows with no figure to the bottom
 * rather than treating a missing value as zero. A basket nobody has funded has
 * no net asset value — it is not the cheapest basket, it is a basket with no
 * price, and sorting it among the real ones would imply a comparison that does
 * not exist.
 *
 * `recent` never reaches here: it is handled by reversing the factory's own
 * order, which is the only ordering the chain actually guarantees.
 */
function compare(a: BasketSummary, b: BasketSummary, sort: Exclude<Sort, 'recent'>): number {
  switch (sort) {
    case 'assets': {
      if (a.totalAssets === null && b.totalAssets === null) return a.name.localeCompare(b.name);
      if (a.totalAssets === null) return 1;
      if (b.totalAssets === null) return -1;
      return b.totalAssets > a.totalAssets ? 1 : b.totalAssets < a.totalAssets ? -1 : 0;
    }
    case 'nav': {
      const aFunded = a.totalSupply > 0n;
      const bFunded = b.totalSupply > 0n;
      if (!aFunded && !bFunded) return a.name.localeCompare(b.name);
      if (!aFunded) return 1;
      if (!bFunded) return -1;
      const aNav = a.navPerShare ?? 0n;
      const bNav = b.navPerShare ?? 0n;
      return bNav > aNav ? 1 : bNav < aNav ? -1 : 0;
    }
    case 'name':
      return a.name.localeCompare(b.name);
  }
}
