import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AllocationLegend, BasketAllocation } from './basket-allocation.tsx';

/**
 * The allocation band and its legend.
 *
 * Two properties matter here and neither is visual. The band's accessible name
 * has to be a complete statement of the composition, because a `role="img"`
 * with no label is a blank to a screen reader (§29); and the widths have to be
 * the weights, because a band whose segments do not match its numbers is a
 * chart that quietly disagrees with the data beside it (§24).
 */

const SEGMENTS = [
  { symbol: 'mNVDA', weightBps: 6_000 as const },
  { symbol: 'mMSFT', weightBps: 4_000 as const },
];

/** The band's segments, in document order. */
function band(): HTMLElement[] {
  // `querySelectorAll` is generic over its result type and defaults to `Element`,
  // which carries no `style` — the whole point of these assertions. Naming
  // `HTMLElement` here is what makes `segment.style.width` compile.
  return Array.from(screen.getByRole('img').querySelectorAll<HTMLElement>(':scope > span'));
}

describe('BasketAllocation', () => {
  it('draws nothing, and says nothing, when there is nothing to draw', () => {
    // An empty band is a placeholder, not an image of a composition. Announcing
    // it as one would have a screen reader read out an empty list of holdings.
    const { container } = render(<BasketAllocation segments={[]} />);

    expect(screen.queryByRole('img')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('describes the whole composition in its accessible name', () => {
    // The assertion that carries §29 for this component: the band is legible
    // without seeing it, symbols and percentages both.
    render(<BasketAllocation segments={SEGMENTS} />);

    expect(screen.getByRole('img')).toHaveAccessibleName('mNVDA 60%, mMSFT 40%');
  });

  it('sizes each segment to its published weight', () => {
    render(<BasketAllocation segments={SEGMENTS} />);

    const [first, second] = band();
    expect(first.style.width).toBe('60%');
    expect(second.style.width).toBe('40%');
  });

  it('gives adjacent segments different tones, so the boundary is visible', () => {
    render(<BasketAllocation segments={SEGMENTS} />);

    const [first, second] = band();
    expect(first.style.backgroundColor).not.toBe('');
    expect(second.style.backgroundColor).not.toBe(first.style.backgroundColor);
  });

  it('separates segments with a hairline rather than a margin', () => {
    // A margin would shrink the segment and change the proportion the band
    // exists to show. The gap is an inset shadow instead, so only the segments
    // after the first get one.
    render(<BasketAllocation segments={SEGMENTS} />);

    const [first, second] = band();
    expect(first.style.boxShadow).toBe('');
    expect(second.style.boxShadow).not.toBe('');
  });

  it('draws weights that already total 100% without rescaling them', () => {
    render(<BasketAllocation segments={SEGMENTS} />);

    expect(band().map((segment) => segment.style.width)).toEqual(['60%', '40%']);
  });

  it('rescales a composition that does not total 100%, rather than leaving a gap', () => {
    // Weights are read from the chain and can be mid-update, or come from a
    // basket whose total is not exactly 10 000. Drawing them literally would
    // leave a strip of background that reads as an eleventh holding.
    render(
      <BasketAllocation
        segments={[
          { symbol: 'mNVDA', weightBps: 3_000 },
          { symbol: 'mMSFT', weightBps: 3_000 },
        ]}
      />,
    );

    expect(band().map((segment) => segment.style.width)).toEqual(['50%', '50%']);
  });

  it('still states the real weights in its label when it has rescaled the drawing', () => {
    // The drawing is normalised; the words are not. A user reading the
    // accessible name must get the figures that are actually published.
    render(
      <BasketAllocation
        segments={[
          { symbol: 'mNVDA', weightBps: 3_000 },
          { symbol: 'mMSFT', weightBps: 3_000 },
        ]}
      />,
    );

    expect(screen.getByRole('img')).toHaveAccessibleName('mNVDA 30%, mMSFT 30%');
  });

  it('handles an all-zero composition without dividing by zero', () => {
    // Not reachable through the factory, which rejects a zero weight — but the
    // band reads chain state, and `NaN%` is the kind of thing that ships.
    render(
      <BasketAllocation
        segments={[
          { symbol: 'mNVDA', weightBps: 0 },
          { symbol: 'mMSFT', weightBps: 0 },
        ]}
      />,
    );

    expect(band().map((segment) => segment.style.width)).toEqual(['0%', '0%']);
  });

  it('takes a size, and defaults to the middle one', () => {
    const { container: small } = render(<BasketAllocation segments={SEGMENTS} size="lg" />);
    expect(small.querySelector('.h-4')).not.toBeNull();

    const { container: defaulted } = render(<BasketAllocation segments={SEGMENTS} />);
    expect(defaulted.querySelector('.h-2\\.5')).not.toBeNull();
  });

  it('renders one segment per holding, in the order given', () => {
    render(
      <BasketAllocation
        segments={[
          { symbol: 'mNVDA', weightBps: 4_000 },
          { symbol: 'mMSFT', weightBps: 3_000 },
          { symbol: 'mGOOGL', weightBps: 3_000 },
        ]}
      />,
    );

    expect(band()).toHaveLength(3);
    expect(screen.getByRole('img')).toHaveAccessibleName('mNVDA 40%, mMSFT 30%, mGOOGL 30%');
  });
});

describe('AllocationLegend', () => {
  it('is a table, so a screen reader announces it as tabular data', () => {
    render(<AllocationLegend segments={SEGMENTS} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Component' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Target' })).toBeInTheDocument();
  });

  it('names itself, so the table is not an anonymous grid on the page', () => {
    render(<AllocationLegend segments={SEGMENTS} />);

    expect(screen.getByRole('table')).toHaveAccessibleName(
      'Published target allocation by component',
    );
  });

  it('gives every holding a row with its symbol and its weight', () => {
    render(<AllocationLegend segments={SEGMENTS} />);

    expect(screen.getByRole('rowheader', { name: 'mNVDA' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'mMSFT' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '60%' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '40%' })).toBeInTheDocument();
  });

  it('shows the published weight, not the normalised drawing width', () => {
    render(
      <AllocationLegend
        segments={[
          { symbol: 'mNVDA', weightBps: 3_000 },
          { symbol: 'mMSFT', weightBps: 3_000 },
        ]}
      />,
    );

    // Both components are published at 30% of a basket whose weights total 60%,
    // so the band normalises them to half its width each. The legend must not
    // follow it there: the number beside a component is its target weight, and 30
    // is what the basket's own definition says. Asserting on every cell rather
    // than on the first match, because "30%" appearing twice is the fixture —
    // and 50%, the normalised width, is what must appear nowhere.
    expect(screen.getAllByRole('cell', { name: '30%' })).toHaveLength(2);
    expect(screen.queryAllByRole('cell', { name: '50%' })).toHaveLength(0);
  });

  it('renders an empty body rather than failing when there are no holdings', () => {
    render(<AllocationLegend segments={[]} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryAllByRole('rowheader')).toHaveLength(0);
  });
});
