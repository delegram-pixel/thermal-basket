import { describe, expect, it } from 'vitest';
import type { Address, Bps } from '@thematic/types';
import {
  BASKET_TOKEN_DECIMALS,
  formatAmount,
  formatBps,
  formatNavPerShare,
  formatRelativeTime,
  formatSettlement,
  formatWeight,
  parseAmountInput,
  ratioBps,
  shortenAddress,
} from './format.ts';

/**
 * The edge: the only place an integer becomes text.
 *
 * Two properties are load-bearing and every test below is an instance of one of
 * them.
 *
 * 1. **A displayed amount is never larger than the real one.** Rounding is
 *    truncation, so nobody reads a balance and then finds less on redemption.
 * 2. **A basis point is never treated as a percentage.** 3500 is 35%, and the
 *    `formatWeight` case that used to produce "34.99.99%" is pinned here.
 */

const USDT = 10n ** 18n;

describe('formatAmount', () => {
  it('renders a whole amount with the minimum fraction digits', () => {
    expect(formatAmount(1_000n * USDT, 18)).toBe('1,000.00');
  });

  it('groups thousands', () => {
    expect(formatAmount(1_234_567n * USDT, 18)).toBe('1,234,567.00');
  });

  it('pads a short fraction out to the minimum, so a column of figures lines up', () => {
    // Not written as `1_5n`: numeric separators are ignored, so `1_5n` *is*
    // `15n`, and the mistake is invisible in a diff.
    const oneAndAHalf = 15n * 10n ** 17n;
    expect(formatAmount(oneAndAHalf, 18)).toBe('1.50');
    expect(formatAmount(15n * USDT, 18)).toBe('15.00');
  });

  it('truncates rather than rounding, so no balance is displayed as more than it is', () => {
    // 0.999999999999999999 tokens. Rounding to two places would show "1.00" —
    // a figure the holder does not have.
    expect(formatAmount(999_999_999_999_999_999n, 18)).toBe('0.9999');
    expect(formatAmount(999_999_999_999_999_999n, 18, { displayDecimals: 2 })).toBe('0.99');
  });

  it('never rounds a value up into a larger figure', () => {
    const justUnderTwo = 1_999_999_999_999_999_999n;
    expect(formatAmount(justUnderTwo, 18, { displayDecimals: 2 })).toBe('1.99');
  });

  it('trims trailing zeros before padding, keeping the shortest true representation', () => {
    expect(formatAmount(150_000_000_000_000_000n, 18)).toBe('0.15');
    expect(formatAmount(100_100_000_000_000_000n, 18)).toBe('0.1001');
  });

  it('shows small balances as zero rather than inventing precision', () => {
    // One wei of an 18-decimal token is below every display precision the app
    // uses. It reads as zero, which is honest at this scale.
    expect(formatAmount(1n, 18)).toBe('0.00');
  });

  it('handles zero', () => {
    expect(formatAmount(0n, 18)).toBe('0.00');
  });

  it('respects the token’s own decimals rather than assuming eighteen', () => {
    expect(formatAmount(1_500n, 6)).toBe('0.0015');
    expect(formatAmount(1_000_000n, 6)).toBe('1.00');
    expect(formatAmount(1_000_000n, 6, { displayDecimals: 2 })).toBe('1.00');
  });

  it('uses the typographic minus, not a hyphen', () => {
    // U+2212 is digit-width; a hyphen is the width of a full stop and the
    // digits fail to line up in a column.
    expect(formatAmount(-50n * USDT, 18)).toBe('−50.00');
    expect(formatAmount(-50n * USDT, 18)).not.toContain('-');
  });

  it('renders an explicit plus only when asked, and never on zero', () => {
    expect(formatAmount(50n * USDT, 18, { showSign: true })).toBe('+50.00');
    expect(formatAmount(0n, 18, { showSign: true })).toBe('0.00');
    expect(formatAmount(-50n * USDT, 18, { showSign: true })).toBe('−50.00');
  });

  it('honours a display precision of zero', () => {
    expect(formatAmount(1_500n, 6, { displayDecimals: 0 })).toBe('0');
  });

  it('defaults the display precision to four places, capped by the token’s own', () => {
    expect(formatAmount(1_234_567_890_123_456_789n, 18)).toBe('1.2345');
    // A 2-decimal token cannot show more than two, whatever the default is.
    expect(formatAmount(123n, 2)).toBe('1.23');
  });

  it('does not drop the integer part when the value is below one', () => {
    expect(formatAmount(500_000_000_000_000_000n, 18)).toBe('0.50');
  });
});

describe('formatSettlement', () => {
  it('appends the symbol', () => {
    expect(formatSettlement(1_250n * USDT, 18, 'mUSDT')).toBe('1,250.00 mUSDT');
  });

  it('passes its options through', () => {
    expect(formatSettlement(1_250n * USDT, 18, 'mUSDT', { displayDecimals: 0 })).toBe(
      '1,250 mUSDT',
    );
  });
});

describe('formatBps', () => {
  it('reads basis points as percentages, two places by default', () => {
    expect(formatBps(3_500)).toBe('35.00%');
    expect(formatBps(50)).toBe('0.50%');
    expect(formatBps(1)).toBe('0.01%');
    expect(formatBps(0)).toBe('0.00%');
    expect(formatBps(10_000)).toBe('100.00%');
  });

  it('takes a display precision', () => {
    expect(formatBps(3_500, 0)).toBe('35%');
  });
});

describe('formatNavPerShare', () => {
  it('reads a settlement-denominated value with no extra scale factor', () => {
    // Regression: an earlier version of the contract and this formatter each
    // applied the 1e18 share scale, so a NAV of 1.0 rendered as 1e18. The
    // contract was fixed; this pins the formatter's half of it.
    expect(formatNavPerShare(1n * USDT, 18)).toBe('1.00');
    expect(formatNavPerShare(1n * USDT, 18)).not.toMatch(/1,000,000,000,000,000,000/);
  });

  it('shows four places, because NAV moves in small increments', () => {
    expect(formatNavPerShare(1_0234n * 10n ** 14n, 18)).toBe('1.0234');
  });

  it('keeps two places even when the value is below the display precision', () => {
    expect(formatNavPerShare(1n * USDT, 18)).toBe('1.00');
  });

  it('respects a six-decimal settlement token', () => {
    expect(formatNavPerShare(1_250_000n, 6)).toBe('1.25');
  });
});

describe('formatWeight', () => {
  it('drops the fraction when the weight is a whole percent', () => {
    expect(formatWeight(3_500)).toBe('35%');
    expect(formatWeight(100)).toBe('1%');
    expect(formatWeight(10_000)).toBe('100%');
    expect(formatWeight(0)).toBe('0%');
  });

  it('renders the hundredths without repeating the whole part', () => {
    // Regression: `3499 / 100` is 34.99 as a float, which stringifies to
    // "34.99"; appending the remainder produced "34.99.99%".
    expect(formatWeight(3_499)).toBe('34.99%');
    expect(formatWeight(3_499)).not.toMatch(/\.\d+\..*%/);
  });

  it('compresses a trailing zero in the hundredths place', () => {
    expect(formatWeight(3_490)).toBe('34.9%');
    expect(formatWeight(3_400)).toBe('34%');
  });

  it('keeps the leading zero below one percent', () => {
    expect(formatWeight(1)).toBe('0.01%');
    expect(formatWeight(10)).toBe('0.1%');
    expect(formatWeight(99)).toBe('0.99%');
  });
});

describe('ratioBps', () => {
  it('returns a value’s share of a total in basis points', () => {
    expect(ratioBps(50n, 100n)).toBe(5_000);
    expect(ratioBps(25n, 100n)).toBe(2_500);
    expect(ratioBps(100n, 100n)).toBe(10_000);
    expect(ratioBps(0n, 100n)).toBe(0);
  });

  it('truncates towards zero rather than producing a fraction of a basis point', () => {
    // A third of 10000 is 3333.33; basis points are integers.
    expect(ratioBps(1n, 3n)).toBe(3_333);
    expect(Number.isInteger(ratioBps(7n, 13n))).toBe(true);
  });

  it('returns null for an empty total, which is a different statement from zero', () => {
    // "0% of nothing" and "we cannot say" are rendered differently.
    expect(ratioBps(100n, 0n)).toBeNull();
    expect(ratioBps(0n, 0n)).toBeNull();
  });

  it('handles amounts far larger than a float can hold exactly', () => {
    const one = 10n ** 27n;
    expect(ratioBps(one, one * 4n)).toBe(2_500);
  });
});

describe('shortenAddress', () => {
  const address = '0x1111111111111111111111111111111111111111' as Address;

  it('keeps the head and tail with an ellipsis between', () => {
    expect(shortenAddress(address)).toBe('0x1111…1111');
  });

  it('takes a visibility width', () => {
    expect(shortenAddress(address, 2)).toBe('0x11…11');
  });

  it('returns an address too short to shorten unchanged', () => {
    expect(shortenAddress('0x1111' as Address)).toBe('0x1111');
    // Exactly at the threshold: 2 + 4 * 2, so 10 characters pass through.
    expect(shortenAddress('0x11111111' as Address)).toBe('0x11111111');
  });

  it('shortens one character past the threshold', () => {
    expect(shortenAddress('0x111111111' as Address)).toBe('0x1111…1111');
  });
});

describe('parseAmountInput', () => {
  it('parses a plain amount at the token’s scale', () => {
    expect(parseAmountInput('1', 18)).toBe(1n * USDT);
    expect(parseAmountInput('1.5', 18)).toBe(15n * 10n ** 17n);
    expect(parseAmountInput('2500', 18)).toBe(2_500n * USDT);
  });

  it('accepts a leading decimal point', () => {
    expect(parseAmountInput('.5', 18)).toBe(5n * 10n ** 17n);
  });

  it('tolerates grouping commas, which people paste from elsewhere', () => {
    expect(parseAmountInput('1,000', 18)).toBe(1_000n * USDT);
    expect(parseAmountInput('1,234.5', 18)).toBe(1_234_5n * 10n ** 17n);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseAmountInput('  12  ', 18)).toBe(12n * USDT);
  });

  it('returns null for a half-typed or absent field rather than throwing', () => {
    // This runs on every keystroke, so an empty field is the normal case.
    for (const input of ['', '   ', '.', ',', 'abc', '1.2.3', '-5', '1e3', '1 2']) {
      expect(parseAmountInput(input, 18), `expected "${input}" to be null`).toBeNull();
    }
  });

  it('rejects more fraction digits than the token has instead of silently truncating', () => {
    // A deposit field that quietly drops the seventh decimal of a 6-decimal
    // token is a field that lies about what it will send.
    expect(parseAmountInput('1.123456', 6)).toBe(1_123_456n);
    expect(parseAmountInput('1.1234567', 6)).toBeNull();
  });

  it('refuses zero and anything that rounds to it', () => {
    for (const input of ['0', '0.0', '0.00']) {
      expect(parseAmountInput(input, 18), `expected "${input}" to be null`).toBeNull();
    }
  });

  it('refuses an amount too small to be representable at the token’s scale', () => {
    // 0.0000001 of a 6-decimal token is zero smallest-units, which is not a
    // deposit. Caught by the fraction-digit rule before it gets that far.
    expect(parseAmountInput('0.0000001', 6)).toBeNull();
  });

  it('round-trips with formatAmount for a value that is exactly representable', () => {
    const parsed = parseAmountInput('1,234.5', 18);
    expect(parsed).not.toBeNull();
    expect(formatAmount(parsed as bigint, 18)).toBe('1,234.50');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('counts seconds below a minute', () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe('30 seconds ago');
  });

  it('counts minutes below an hour', () => {
    expect(formatRelativeTime(ago(2 * 60_000), now)).toBe('2 minutes ago');
  });

  it('counts hours below a day', () => {
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('3 hours ago');
  });

  it('counts days beyond that', () => {
    expect(formatRelativeTime(ago(2 * 86_400_000), now)).toBe('2 days ago');
  });

  it('reads forward for a time in the future', () => {
    expect(formatRelativeTime(new Date(now.getTime() + 3 * 3_600_000), now)).toBe('in 3 hours');
  });

  it('says "now" rather than "0 seconds ago"', () => {
    // `numeric: 'auto'` is what makes the singular and this read naturally.
    expect(formatRelativeTime(now, now)).toBe('now');
  });

  it('picks up the singular form', () => {
    expect(formatRelativeTime(ago(60_000), now)).toBe('1 minute ago');
  });

  it('defaults to the current time when none is given', () => {
    const justNow = new Date(Date.now() - 5_000);
    expect(formatRelativeTime(justNow)).toBe('5 seconds ago');
  });
});

describe('BASKET_TOKEN_DECIMALS', () => {
  it('is eighteen, the invariant every deployed basket shares', () => {
    // Named rather than passed as a bare `18` so a call site cannot be mistaken
    // for a guess.
    expect(BASKET_TOKEN_DECIMALS).toBe(18);
  });

  it('agrees with a NAV formatted using it', () => {
    expect(formatNavPerShare(1n * USDT, BASKET_TOKEN_DECIMALS)).toBe(
      formatNavPerShare(1n * USDT, 18),
    );
  });
});

describe('Bps typing', () => {
  it('accepts the protocol’s own integers', () => {
    // Compile-time only: this exists so the file fails to typecheck if `Bps`
    // ever stops being the integer type these functions are written against.
    const twoPercent: Bps = 200;
    expect(formatBps(twoPercent)).toBe('2.00%');
  });
});
