'use client';

import { Notice } from '@/components/ui/notice.tsx';
import { LoadingRows } from '@/components/ui/states.tsx';
import { useUnderlyingProfiles } from './use-reference-feed.ts';

/**
 * What the holdings in a basket actually are.
 *
 * A ticker is a claim to nothing on its own, and a basket called "AI Winners"
 * holding `mNVDA`, `mMSFT` and `mGOOGL` is only legible to someone who already
 * knows what those companies do. This says so, from the profile endpoint of the
 * Binance Web3 API.
 *
 * The endpoint does not describe companies, and an earlier version of this
 * component assumed it did — it rendered a description, a sector and an industry,
 * none of which the API returns, so every holding was followed by the sentence
 * "the API returned no description for this company". What the endpoint does
 * return sits closer to this project's subject: who issues the tokenized form, how
 * many shares one token represents, and links to the attestation reports the
 * issuer publishes. That is what is shown.
 *
 * The reports are links to the issuer's own documents. Nothing here says a claim
 * has been checked, because nothing here checks one — it says where the issuer
 * filed it, which is the part a reader can verify.
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
              {profile.platform !== null || profile.tokenToShareRatio !== null ? (
                <p className="label">
                  {[
                    profile.platform === null ? null : `Tokenized by ${profile.platform}`,
                    // Named as the API names it. Calling this "shares per token"
                    // would be the more natural English and a claim about which
                    // way the ratio runs, which the field name does not settle.
                    profile.tokenToShareRatio === null
                      ? null
                      : `token-to-share ratio ${profile.tokenToShareRatio.toFixed(4)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}

              {profile.marketCap !== null ? (
                <p className="figure text-xs text-ink-faint">
                  {formatLargeNumber(profile.marketCap)} market capitalisation
                </p>
              ) : null}

              {profile.attestations.length > 0 ? (
                <ul className="space-y-1">
                  {profile.attestations.map((report) => (
                    <li key={report.url}>
                      <a
                        href={report.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
                      >
                        {report.label}
                      </a>
                    </li>
                  ))}
                </ul>
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
