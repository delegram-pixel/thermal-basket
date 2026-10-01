import type { Bps } from '@thematic/types';
import { formatWeight } from '@thematic/blockchain';
import { allocationTone } from '@/lib/allocation.ts';

/**
 * The allocation band.
 *
 * This is the app's signature object and the reason §24's "data visualisations
 * that are easy to read" is taken seriously here. A basket's composition is
 * proportional data, so it is drawn proportionally: one bar, segments sized to
 * their weights. Three ring charts or a row of percentage cards would each take
 * more space to say less.
 *
 * Weights are published basis points, not realised value shares, so the band
 * shows the *rule* the basket follows. Where the two differ — and they drift
 * with price — the detailed chart says so explicitly rather than leaving a
 * reader to assume the band is live.
 */
export function BasketAllocation({
  segments,
  size = 'md',
  className = '',
}: {
  segments: ReadonlyArray<{ symbol: string; weightBps: Bps }>;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const heights = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' } as const;

  if (segments.length === 0) {
    return (
      <div
        className={`${heights[size]} w-full rounded-sm bg-rule ${className}`}
        aria-hidden="true"
      />
    );
  }

  // A weight of zero draws nothing, which is correct — but an all-zero
  // composition would render an empty strip that looks like a loading state.
  const total = segments.reduce((running, segment) => running + segment.weightBps, 0);
  const normalise = total !== 10_000 && total > 0;

  return (
    <div
      className={`flex w-full overflow-hidden rounded-sm bg-rule ${heights[size]} ${className}`}
      role="img"
      aria-label={segments
        .map((segment) => `${segment.symbol} ${formatWeight(segment.weightBps)}`)
        .join(', ')}
    >
      {segments.map((segment, index) => {
        const share = normalise ? (segment.weightBps / total) * 100 : segment.weightBps / 100;

        return (
          <span
            key={segment.symbol}
            className="block h-full first:rounded-l-sm last:rounded-r-sm"
            style={{
              width: `${share}%`,
              backgroundColor: allocationTone(index),
              // A hairline gap so two adjacent segments of similar tone still
              // read as two. The gap is drawn as an inset shadow rather than a
              // margin, because a margin would change the proportions the band
              // exists to show.
              boxShadow: index > 0 ? 'inset 1px 0 0 var(--color-paper)' : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * The band's legend, as a table.
 *
 * A `<table>` and not a list of divs, because this is tabular data with a header
 * row and columns that need to line up — and because a screen reader announcing
 * "table, three rows, two columns" tells the user what they are in.
 */
export function AllocationLegend({
  segments,
  className = '',
}: {
  segments: ReadonlyArray<{ symbol: string; weightBps: Bps }>;
  className?: string;
}) {
  return (
    <table className={`w-full text-sm ${className}`}>
      <caption className="sr-only">Published target allocation by component</caption>
      <thead>
        <tr className="border-b border-rule">
          <th scope="col" className="label py-2 text-left font-semibold">
            Component
          </th>
          <th scope="col" className="label py-2 text-right font-semibold">
            Target
          </th>
        </tr>
      </thead>
      <tbody>
        {segments.map((segment, index) => (
          <tr key={segment.symbol} className="border-b border-rule last:border-0">
            <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: allocationTone(index) }}
                />
                <span className="figure">{segment.symbol}</span>
              </span>
            </th>
            <td className="py-2 text-right">
              <span className="figure text-ink">{formatWeight(segment.weightBps)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
