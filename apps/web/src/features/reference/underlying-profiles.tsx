'use client';

import { Notice } from '@/components/ui/notice.tsx';
import { LoadingRows } from '@/components/ui/states.tsx';
import { useUnderlyingProfiles } from './use-reference-feed.ts';

/**
 * What the holdings in a basket actually are.
 *
 * A ticker is a claim to nothing on its own, and a basket called "AI Winners"
 * holding `mNVDA`, `mMSFT` and `mGOOGL` is only legible to someone who already
 * knows what those companies do. This says so, from the company-profile endpoint
 * of the Binance Web3 API.
 *
 * It is context and it is labelled as context. A company description on a page
 * about a basket is one step away from reading as an argument that the basket is
 * a good idea, so the heading frames it as what the holdings *are* and the
 * component adds no view about them.
 *
 * Absent credentials collapse this to one notice rather than one per holding.
 * A deployment with no API key is one fact, and repeating it six times is six
 * times the space spent saying nothing new.
 */
export function UnderlyingProfiles({ symbols }: { symbols: readonly string[] }) {
  const profiles = useUnderlyingProfiles(symbols);

  if (symbols.length === 0) return null;

  if (profiles.some(({ result }) => result.isPending)) {
    return <LoadingRows rows={2} />;
  }

  const available = profiles.filter(({ result }) => result.data?.profile);
  const firstError = profiles.find(({ result }) => result.data?.error)?.result.data?.error;

  if (available.length === 0) {
    return (
      <Notice
        tone={firstError?.reason === 'unconfigured' ? 'neutral' : 'warning'}
        title={
          firstError?.reason === 'unconfigured'
            ? 'No Binance Web3 API credentials on this deployment'
            : 'Company profiles are unavailable'
        }
      >
        {firstError?.reason === 'unconfigured' ? (
          <>
            These come from the Binance Web3 API, which this deployment has not been given a key
            pair for. Set <code>BINANCE_WEB3_API_KEY</code> and <code>BINANCE_WEB3_API_SECRET</code>{' '}
            in <code>apps/web/.env.local</code>.
          </>
        ) : (
          (firstError?.message ?? 'The Binance Web3 API returned no profiles for these tickers.')
        )}
      </Notice>
    );
  }

  return (
    <dl className="grid gap-x-10 gap-y-8 border-t border-rule pt-6 sm:grid-cols-2 lg:grid-cols-3">
      {available.map(({ ticker, result }) => {
        const profile = result.data?.profile;
        if (!profile) return null;

        return (
          <div key={ticker}>
            <dt className="flex items-baseline gap-2">
              <span className="figure text-sm text-ink">{ticker}</span>
              {profile.name ? (
                <span className="truncate text-sm text-ink-muted">{profile.name}</span>
              ) : null}
            </dt>

            <dd className="mt-2 space-y-2">
              {profile.sector || profile.industry ? (
                <p className="label">
                  {[profile.sector, profile.industry].filter(Boolean).join(' · ')}
                </p>
              ) : null}

              {profile.description ? (
                <p className="text-sm leading-relaxed text-ink-muted">{profile.description}</p>
              ) : (
                <p className="text-sm leading-relaxed text-ink-faint">
                  The API returned no description for this company.
                </p>
              )}

              {profile.marketCap ? (
                <p className="figure text-xs text-ink-faint">
                  {formatLargeNumber(profile.marketCap)} market capitalisation
                </p>
              ) : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * A large number, abbreviated.
 *
 * Market capitalisations arrive in the billions and trillions, and printing all
 * fifteen digits of one pushes the column wide enough to break the grid without
 * telling the reader anything the abbreviation does not.
 */
function formatLargeNumber(value: number): string {
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];

  for (const [threshold, suffix] of units) {
    if (Math.abs(value) >= threshold) {
      return `$${(value / threshold).toFixed(2)}${suffix}`;
    }
  }

  return `$${value.toFixed(2)}`;
}
