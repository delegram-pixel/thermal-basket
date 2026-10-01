import { formatUnits, parseUnits } from 'viem';
import { BPS_DENOMINATOR, type Address, type Bps } from '@thematic/types';

/**
 * Formatting at the edge.
 *
 * Every amount in this codebase is an integer in a token's smallest unit, and
 * this module is the only place that turns one into text. Keeping the
 * conversion in one file is what makes it possible to say "no amount is ever a
 * float" and mean it.
 *
 * The grouping formatter is built once. Constructing an `Intl.NumberFormat` per
 * call is the usual hidden cost in a table that renders a few hundred numbers.
 */
const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * The minus sign is U+2212, not a hyphen.
 *
 * In a column of figures a hyphen is the width of a full stop and the digits
 * fail to line up; the typographic minus is digit-width in every serious text
 * face. This is a small thing that is visible on every negative row.
 */
const MINUS = '−';

/**
 * One whole basket token, in basket smallest units.
 *
 * `BasketMath.SHARE_SCALE` is a compile-time constant in the contracts, and the
 * basket token is a plain OpenZeppelin ERC20 that never overrides `decimals()`.
 * So this is 1e18 for every basket the factory has ever deployed and for every
 * one it will deploy next — it is an invariant of the protocol, not a property
 * of a particular basket.
 *
 * It is named here because the interface has to undo exactly this to show a
 * supply as a number of tokens, and a bare `18` passed at a call site is
 * indistinguishable from a guess. Where a basket's own `decimals()` has already
 * been read — the detail page reads it — prefer that read over this constant;
 * both are correct today, and the read is the one that stays correct if the
 * protocol ever issues a basket at a different scale.
 */
export const BASKET_TOKEN_DECIMALS = 18;

export interface FormatAmountOptions {
  /** Fraction digits to show before trailing zeros are trimmed. */
  displayDecimals?: number;
  /** Fraction digits to keep even when they are zero. */
  minDecimals?: number;
  /** Render an explicit `+` on positive values. */
  showSign?: boolean;
}

/**
 * Formats a token amount for display.
 *
 * Rounding is truncation, not rounding-to-nearest. A balance is a fact, and a
 * displayed figure that is larger than the real one is the failure mode that
 * matters here: someone reading "1,000.00" as their balance and finding 999.996
 * on redemption has been misled by the interface.
 */
export function formatAmount(
  value: bigint,
  decimals: number,
  options: FormatAmountOptions = {},
): string {
  const { displayDecimals = Math.min(decimals, 4), minDecimals = 2, showSign = false } = options;

  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const raw = formatUnits(absolute, decimals);
  const [whole = '0', fraction = ''] = raw.split('.');

  const shown = fraction
    .slice(0, displayDecimals)
    .replace(/0+$/, '')
    .padEnd(Math.min(minDecimals, displayDecimals), '0');

  const grouped = integerFormat.format(BigInt(whole));
  const sign = negative ? MINUS : showSign && absolute > 0n ? '+' : '';

  return shown.length > 0 ? `${sign}${grouped}.${shown}` : `${sign}${grouped}`;
}

/** Formats a settlement-token amount with its symbol, e.g. `1,250.00 mUSDT`. */
export function formatSettlement(
  value: bigint,
  decimals: number,
  symbol: string,
  options: FormatAmountOptions = {},
): string {
  return `${formatAmount(value, decimals, options)} ${symbol}`;
}

/**
 * Formats a basis-point value as a percentage.
 *
 * Basis points are integers out of 10 000, so 50 is 0.50%. The division here is
 * exact to two places for every value the protocol permits (at most 10 000),
 * and `toFixed` on a number that small carries no representation error worth
 * worrying about — unlike the reverse direction, which is why nothing in this
 * codebase ever parses a percentage back into basis points.
 */
export function formatBps(bps: Bps, displayDecimals = 2): string {
  return `${(bps / 100).toFixed(displayDecimals)}%`;
}

/**
 * The value of one whole basket token, in whole settlement tokens.
 *
 * `navPerShare` returns settlement smallest units, so the settlement token's own
 * decimals are the only scale to undo. There is deliberately no second factor
 * here: an earlier version of the contract added one, and the fix is the reason
 * this comment exists.
 */
export function formatNavPerShare(nav: bigint, settlementDecimals: number): string {
  return formatAmount(nav, settlementDecimals, { displayDecimals: 4, minDecimals: 2 });
}

/**
 * A value's share of a total, in basis points.
 *
 * Returns `null` rather than zero for an empty total: "0% of nothing" and "we
 * cannot say" are different statements, and the UI renders them differently.
 */
export function ratioBps(value: bigint, total: bigint): Bps | null {
  if (total <= 0n) return null;
  return Number((value * BigInt(BPS_DENOMINATOR)) / total);
}

/** `0x1234…abcd`. */
export function shortenAddress(address: Address, visible = 4): string {
  if (address.length <= 2 + visible * 2) return address;
  return `${address.slice(0, 2 + visible)}…${address.slice(-visible)}`;
}

/**
 * Parses user input into a token amount.
 *
 * Returns `null` instead of throwing, because this runs on every keystroke in
 * the deposit field and half-typed input is the normal case, not an error.
 * Rejects more fraction digits than the token has rather than silently
 * truncating: a deposit field that quietly drops the fourth decimal of a
 * 6-decimal token is a field that lies about what it will send.
 */
export function parseAmountInput(input: string, decimals: number): bigint | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;

  const fraction = trimmed.split('.')[1];
  if (fraction && fraction.length > decimals) return null;

  try {
    const parsed = parseUnits(trimmed as `${number}`, decimals);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

/** A percentage for allocation labels, e.g. `35%`, `34.99%`, `34.1%`. */
export function formatWeight(bps: Bps): string {
  // `Math.floor`, not `/`. Basis points are integers, and `3499 / 100` is
  // 34.99 as a float — which stringifies to "34.99" and then gets the remainder
  // appended, producing "34.99.99%". Round weights hid this for a while, which
  // is exactly how a formatting bug survives to production.
  const whole = Math.floor(bps / 100);
  const remainder = bps % 100;
  if (remainder === 0) return `${whole}%`;
  return `${whole}.${String(remainder).padStart(2, '0').replace(/0$/, '')}%`;
}

/** `2 minutes ago`, `in 3 hours`. Used for proposal and quote timestamps. */
export function formatRelativeTime(from: Date, now: Date = new Date()): string {
  const seconds = Math.round((from.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (absolute < 60) return formatter.format(seconds, 'second');
  if (absolute < 3_600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (absolute < 86_400) return formatter.format(Math.round(seconds / 3_600), 'hour');
  return formatter.format(Math.round(seconds / 86_400), 'day');
}
