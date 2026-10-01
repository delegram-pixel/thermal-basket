/**
 * The allocation palette.
 *
 * A single sequential ramp from the accent, plus a run of warm neutrals for
 * when a basket has more components than the ramp has steps. Deliberately not a
 * categorical palette of distinct hues: green and red mean something specific in
 * this interface (§26), so an allocation band that used them would be implying
 * performance where it is only showing composition. A reader should be able to
 * tell at a glance that the band is a *breakdown*, not a *result*.
 *
 * The ramp is ordered so that adjacent segments stay distinguishable — the
 * steps are unevenly spaced on purpose, because an even lightening across eight
 * steps leaves the middle four looking identical at 6px tall.
 */
const RAMP = [
  '#123a6b',
  '#33608f',
  '#5585ad',
  '#83a6c4',
  '#adc2d6',
  '#8c8577',
  '#b0a692',
  '#cfc6b4',
  '#5d6b7a',
  '#93a1ad',
] as const;

/** The colour for a segment at `index`, wrapping when a basket is very wide. */
export function allocationTone(index: number): string {
  return RAMP[index % RAMP.length]!;
}

/**
 * Shortens a symbol for a segment label.
 *
 * The mock components are prefixed `m` (`mNVDA`), which is the first thing to go
 * when space is tight, because the prefix is the same for every one of them and
 * therefore carries no information in a legend.
 */
export function shortSymbol(symbol: string, max = 5): string {
  const trimmed = symbol.length > max && /^m[A-Z]/.test(symbol) ? symbol.slice(1) : symbol;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
