import { describe, expect, it } from 'vitest';
import { BPS_DENOMINATOR, type Address } from '@thematic/types';
import type { CreationTerms } from '@thematic/blockchain';
import {
  addComponent,
  bpsToPercent,
  checkDraft,
  emptyDraft,
  equalWeights,
  percentToBps,
  redistribute,
  removeComponent,
  type BasketDraft,
} from './draft.ts';

/**
 * The creation form's model.
 *
 * These are the rules that decide what a creator is allowed to deploy, and the
 * arithmetic that converts what they type into what the contract is given. Both
 * are money-adjacent: a weight that silently rounds is a basket that does not
 * hold what its creator described, and a fee that slips past its ceiling is a
 * transaction that reverts after gas has been spent.
 *
 * §33 and §35 both ask for this, and the module was written to be testable
 * without rendering anything — the form is a view over it, so a bug found here
 * is a bug found before it reaches a wallet prompt.
 */

const TERMS: CreationTerms = {
  depositFeeBps: 50,
  redeemFeeBps: 0,
  creatorShareBps: 8_000,
  maxSlippageBps: 300,
};

const MAX_COMPONENTS = 10;

const A = '0x1111111111111111111111111111111111111111' as Address;
const B = '0x2222222222222222222222222222222222222222' as Address;
const C = '0x3333333333333333333333333333333333333333' as Address;

/** A draft that is valid as it stands, so each test can vary one thing. */
function draft(overrides: Partial<BasketDraft> = {}): BasketDraft {
  return {
    ...emptyDraft(TERMS),
    name: 'AI Winners',
    symbol: 'AIW',
    theme: 'Artificial intelligence',
    description: 'Companies selling the picks and shovels of machine learning.',
    components: [A, B],
    weights: { [A]: '60', [B]: '40' },
    ...overrides,
  };
}

describe('percentToBps', () => {
  it('converts a whole percentage to basis points', () => {
    expect(percentToBps('30')).toEqual({ ok: true, bps: 3_000 });
  });

  it('converts one and two decimal places exactly', () => {
    expect(percentToBps('30.5')).toEqual({ ok: true, bps: 3_050 });
    expect(percentToBps('30.55')).toEqual({ ok: true, bps: 3_055 });
    expect(percentToBps('0.5')).toEqual({ ok: true, bps: 50 });
    expect(percentToBps('0.01')).toEqual({ ok: true, bps: 1 });
  });

  it('accepts a leading decimal point, which is how people type a fraction', () => {
    expect(percentToBps('.5')).toEqual({ ok: true, bps: 50 });
  });

  it('ignores surrounding whitespace', () => {
    expect(percentToBps('  30  ')).toEqual({ ok: true, bps: 3_000 });
  });

  it('accepts zero, leaving the "must be non-zero" rule to the caller', () => {
    // A zero redemption fee is a legitimate choice, so this layer must not
    // forbid it. `checkDraft` is where a zero *weight* is rejected, because a
    // zero-weight component is a different problem.
    expect(percentToBps('0')).toEqual({ ok: true, bps: 0 });
  });

  it('accepts exactly 100%', () => {
    expect(percentToBps('100')).toEqual({ ok: true, bps: BPS_DENOMINATOR });
  });

  it('rejects more precision than basis points can represent rather than rounding it away', () => {
    const result = percentToBps('30.555');
    expect(result.ok).toBe(false);
    // The message has to say why, because the natural reading of a rejected
    // "30.555" is that the form is broken.
    expect(result.ok === false && result.error).toMatch(/two decimal places/i);
  });

  it('rejects a value above 100%', () => {
    const result = percentToBps('100.01');
    expect(result.ok === false && result.error).toBe('Cannot exceed 100%.');
  });

  it('rejects an empty field with a message about the field, not about numbers', () => {
    const result = percentToBps('');
    expect(result.ok === false && result.error).toBe('Enter a percentage.');
    expect(percentToBps('   ').ok).toBe(false);
  });

  it('rejects anything that is not digits and at most one point', () => {
    for (const input of ['abc', '1.2.3', '-5', '1e3', '30%', '+30']) {
      const result = percentToBps(input);
      expect(result.ok, `expected "${input}" to be rejected`).toBe(false);
      expect(result.ok === false && result.error).toBe('Use digits and at most one decimal point.');
    }
  });

  it('reports a lone decimal point as "not a number" rather than as a format error', () => {
    // It passes the character check and then fails to convert, which is a
    // different sentence and the right one.
    const result = percentToBps('.');
    expect(result.ok === false && result.error).toBe('That is not a number.');
  });
});

describe('bpsToPercent', () => {
  it('produces the shortest string that round-trips', () => {
    expect(bpsToPercent(3_000)).toBe('30');
    expect(bpsToPercent(3_050)).toBe('30.5');
    expect(bpsToPercent(3_055)).toBe('30.55');
    expect(bpsToPercent(50)).toBe('0.5');
    expect(bpsToPercent(1)).toBe('0.01');
    expect(bpsToPercent(0)).toBe('0');
    expect(bpsToPercent(BPS_DENOMINATOR)).toBe('100');
  });

  it('round-trips every representable value through percentToBps', () => {
    // The property that matters: whatever the form prefills, re-reading it must
    // give back the same basis points. A single failure here is a fee that
    // changes when a creator merely focuses and blurs a field.
    for (let bps = 0; bps <= BPS_DENOMINATOR; bps += 1) {
      const parsed = percentToBps(bpsToPercent(bps));
      expect(parsed, `bps ${bps} failed to round-trip`).toEqual({ ok: true, bps });
    }
  });
});

describe('emptyDraft', () => {
  it('prefills the fee fields from the factory defaults', () => {
    const empty = emptyDraft(TERMS);
    expect(empty.depositFee).toBe('0.5');
    expect(empty.redeemFee).toBe('0');
    expect(empty.creatorShare).toBe('80');
    expect(empty.slippage).toBe('3');
  });

  it('leaves identity and composition to the creator', () => {
    const empty = emptyDraft(TERMS);
    expect(empty.name).toBe('');
    expect(empty.components).toEqual([]);
    expect(empty.weights).toEqual({});
  });

  it('prefills a valid draft with no fee errors already attached', () => {
    // The defaults are the factory's own, so they must sit at or under the
    // ceilings. If they ever did not, every creator would open the form to a
    // validation error they did not cause.
    const check = checkDraft(emptyDraft(TERMS), TERMS, MAX_COMPONENTS);
    expect(check.fees).toEqual({});
  });
});

describe('checkDraft identity rules', () => {
  it('accepts a complete draft', () => {
    expect(checkDraft(draft(), TERMS, MAX_COMPONENTS).valid).toBe(true);
  });

  it('requires a name, a symbol and a theme', () => {
    const check = checkDraft(draft({ name: '', symbol: '', theme: '' }), TERMS, MAX_COMPONENTS);
    expect(check.identity.name).toBe('Give the basket a name.');
    expect(check.identity.symbol).toBe('Give the basket a symbol.');
    expect(check.identity.theme).toBe('Give the basket a theme.');
    expect(check.valid).toBe(false);
  });

  it('treats whitespace as absent', () => {
    const check = checkDraft(draft({ name: '   ' }), TERMS, MAX_COMPONENTS);
    expect(check.identity.name).toBe('Give the basket a name.');
  });

  it('caps the name at 48 characters', () => {
    const atLimit = checkDraft(draft({ name: 'x'.repeat(48) }), TERMS, MAX_COMPONENTS);
    expect(atLimit.identity.name).toBeUndefined();

    const over = checkDraft(draft({ name: 'x'.repeat(49) }), TERMS, MAX_COMPONENTS);
    expect(over.identity.name).toBe('Keep it under 48 characters.');
  });

  it('caps the symbol at 11 characters, because wallets truncate longer ones', () => {
    expect(
      checkDraft(draft({ symbol: 'x'.repeat(11) }), TERMS, MAX_COMPONENTS).identity.symbol,
    ).toBeUndefined();
    expect(
      checkDraft(draft({ symbol: 'x'.repeat(12) }), TERMS, MAX_COMPONENTS).identity.symbol,
    ).toMatch(/11 characters or fewer/);
  });

  it('restricts the symbol to letters and digits', () => {
    const check = checkDraft(draft({ symbol: 'AI-W' }), TERMS, MAX_COMPONENTS);
    expect(check.identity.symbol).toBe('Letters and digits only — no spaces or punctuation.');
  });

  it('caps the theme at 32 characters', () => {
    expect(checkDraft(draft({ theme: 'x'.repeat(33) }), TERMS, MAX_COMPONENTS).identity.theme).toBe(
      'Keep it under 32 characters.',
    );
  });

  it('caps the description at 600 characters but does not require one', () => {
    expect(
      checkDraft(draft({ description: '' }), TERMS, MAX_COMPONENTS).identity.description,
    ).toBeUndefined();
    expect(
      checkDraft(draft({ description: 'x'.repeat(601) }), TERMS, MAX_COMPONENTS).identity
        .description,
    ).toBe('Keep it under 600 characters.');
  });
});

describe('checkDraft composition rules', () => {
  it('requires at least one component', () => {
    const check = checkDraft(draft({ components: [], weights: {} }), TERMS, MAX_COMPONENTS);
    expect(check.composition.components).toBe('Add at least one component.');
  });

  it('enforces the component cap the factory reports', () => {
    const components = Array.from({ length: 11 }, (_, i) => `0x${'a'.repeat(39)}${i}` as Address);
    const check = checkDraft(
      draft({ components, weights: Object.fromEntries(components.map((c) => [c, '9'])) }),
      TERMS,
      MAX_COMPONENTS,
    );
    expect(check.composition.components).toBe('A basket may hold at most 10 components.');
  });

  it('accepts weights that total exactly 100%', () => {
    const check = checkDraft(draft(), TERMS, MAX_COMPONENTS);
    expect(check.composition.total).toBeUndefined();
    expect(check.totalBps).toBe(BPS_DENOMINATOR);
  });

  it('names the amount unassigned when the weights fall short', () => {
    const check = checkDraft(draft({ weights: { [A]: '60', [B]: '30' } }), TERMS, MAX_COMPONENTS);
    expect(check.totalBps).toBe(9_000);
    expect(check.composition.total).toBe(
      'Weights total 90.00%. They must total 100% — 10.00% is unassigned.',
    );
  });

  it('says how far over the weights are when they exceed 100%', () => {
    const check = checkDraft(draft({ weights: { [A]: '60', [B]: '60' } }), TERMS, MAX_COMPONENTS);
    expect(check.composition.total).toBe('Weights total 120.00%, which is 20.00% over 100%.');
  });

  it('rejects a component with no weight', () => {
    const check = checkDraft(draft({ weights: { [A]: '60' } }), TERMS, MAX_COMPONENTS);
    expect(check.composition.weights?.[B]).toBe('Enter a percentage.');
  });

  it('rejects a zero weight, naming the component rather than the total', () => {
    const check = checkDraft(draft({ weights: { [A]: '100', [B]: '0' } }), TERMS, MAX_COMPONENTS);
    expect(check.composition.weights?.[B]).toBe('Every component needs a weight above zero.');
  });

  it('suppresses the total while any individual weight is still unparseable', () => {
    // A total computed from a field the creator is halfway through typing is a
    // number that is wrong and looks authoritative. The per-field messages are
    // the ones to read, so the total stays quiet.
    const check = checkDraft(
      draft({ weights: { [A]: '60', [B]: 'nonsense' } }),
      TERMS,
      MAX_COMPONENTS,
    );
    expect(check.composition.weights?.[B]).toBeDefined();
    expect(check.composition.total).toBeUndefined();
  });

  it('matches weights to components case-insensitively', () => {
    // Addresses arrive checksummed from a wallet and are stored lowercased.
    // Looking one up with the other's casing must still find it.
    const mixed = '0xAbCd00000000000000000000000000000000Ef12' as Address;
    const check = checkDraft(
      draft({ components: [mixed], weights: { [mixed.toLowerCase()]: '100' } }),
      TERMS,
      MAX_COMPONENTS,
    );
    expect(check.composition.weights).toBeUndefined();
    expect(check.composition.total).toBeUndefined();
    expect(check.valid).toBe(true);
  });
});

describe('checkDraft fee rules', () => {
  it('accepts each fee at its ceiling', () => {
    const check = checkDraft(
      draft({ depositFee: '0.5', redeemFee: '0', creatorShare: '80', slippage: '3' }),
      TERMS,
      MAX_COMPONENTS,
    );
    expect(check.fees).toEqual({});
  });

  it('rejects a fee above its ceiling, naming the field and the ceiling', () => {
    const check = checkDraft(draft({ depositFee: '0.51' }), TERMS, MAX_COMPONENTS);
    expect(check.fees.depositFee).toBe('The deposit fee cannot exceed 0.50% on this deployment.');
  });

  it('applies each ceiling to its own field', () => {
    const check = checkDraft(
      draft({
        redeemFee: '0.01',
        creatorShare: '80.01',
        slippage: '3.01',
      }),
      TERMS,
      MAX_COMPONENTS,
    );
    expect(check.fees.redeemFee).toBe('The redemption fee cannot exceed 0.00% on this deployment.');
    expect(check.fees.creatorShare).toBe(
      "The creator's share cannot exceed 80.00% on this deployment.",
    );
    expect(check.fees.slippage).toBe(
      'The slippage tolerance cannot exceed 3.00% on this deployment.',
    );
  });

  it('allows a zero slippage tolerance, which means "require an exact fill"', () => {
    const check = checkDraft(draft({ slippage: '0' }), TERMS, MAX_COMPONENTS);
    expect(check.fees.slippage).toBeUndefined();
  });

  it('reports a malformed fee as unparseable rather than as over the ceiling', () => {
    const check = checkDraft(draft({ depositFee: 'half' }), TERMS, MAX_COMPONENTS);
    expect(check.fees.depositFee).toBe('Use digits and at most one decimal point.');
  });
});

describe('equalWeights', () => {
  it('returns nothing for nothing', () => {
    expect(equalWeights(0)).toEqual([]);
  });

  it('gives a single component the whole basket', () => {
    expect(equalWeights(1)).toEqual([BPS_DENOMINATOR]);
  });

  it('splits evenly where it can', () => {
    expect(equalWeights(2)).toEqual([5_000, 5_000]);
  });

  it('gives the remainder to the earliest components so the total is exact', () => {
    // 10000 / 3 is 3333.33. Dropping the remainder would leave a 0.01% hole
    // that the form then refuses to deploy, with no explanation a creator could
    // act on.
    expect(equalWeights(3)).toEqual([3_334, 3_333, 3_333]);
  });

  it('totals exactly 10 000 for every supported component count', () => {
    for (let count = 1; count <= MAX_COMPONENTS; count += 1) {
      const weights = equalWeights(count);
      expect(weights, `count ${count}`).toHaveLength(count);
      expect(
        weights.reduce((running, weight) => running + weight, 0),
        `count ${count}`,
      ).toBe(BPS_DENOMINATOR);
    }
  });
});

describe('addComponent', () => {
  it('gives the first component the whole basket', () => {
    const next = addComponent(draft({ components: [], weights: {} }), A);
    expect(next.components).toEqual([A]);
    expect(next.weights[A]).toBe('100');
  });

  it('gives a later component only what is unassigned', () => {
    const next = addComponent(draft({ weights: { [A]: '60' }, components: [A] }), B);
    expect(next.weights[B]).toBe('40');
  });

  it('does not touch weights the creator already chose', () => {
    // Silently rescaling existing weights to make room would be the form
    // editing a number with money attached to it.
    const next = addComponent(draft({ components: [A], weights: { [A]: '60' } }), B);
    expect(next.weights[A]).toBe('60');
  });

  it('gives a newcomer nothing when there is no headroom, leaving the total to say so', () => {
    const next = addComponent(draft({ components: [A], weights: { [A]: '100' } }), B);
    expect(next.weights[B]).toBe('0');
  });

  it('ignores a duplicate, returning the same draft', () => {
    const current = draft();
    expect(addComponent(current, A)).toBe(current);
  });

  it('treats a duplicate as a duplicate regardless of address casing', () => {
    const mixed = '0x1111111111111111111111111111111111111111' as Address;
    const upper = '0x1111111111111111111111111111111111111111'
      .toUpperCase()
      .replace('0X', '0x') as Address;
    const current = draft({ components: [mixed], weights: { [mixed]: '100' } });
    expect(addComponent(current, upper)).toBe(current);
  });

  it('keys the new weight by lowercase address', () => {
    const mixed = '0xAbCd00000000000000000000000000000000Ef12' as Address;
    const next = addComponent(draft({ components: [], weights: {} }), mixed);
    expect(Object.keys(next.weights)).toEqual([mixed.toLowerCase()]);
  });
});

describe('removeComponent', () => {
  it('drops the component and its weight', () => {
    const next = removeComponent(draft(), B);
    expect(next.components).toEqual([A]);
    expect(next.weights[B]).toBeUndefined();
  });

  it('leaves the remaining weights exactly as they were', () => {
    const next = removeComponent(draft(), B);
    expect(next.weights[A]).toBe('60');
  });

  it('returns the same draft when the component is not present', () => {
    const current = draft();
    expect(removeComponent(current, C)).toBe(current);
  });
});

describe('redistribute', () => {
  it('spreads the current components evenly', () => {
    const next = redistribute(draft({ components: [A, B, C] }));
    expect(next.weights).toEqual({ [A]: '33.34', [B]: '33.33', [C]: '33.33' });
  });

  it('leaves the result deployable, with no fee or total errors', () => {
    const check = checkDraft(redistribute(draft({ components: [A, B, C] })), TERMS, MAX_COMPONENTS);
    expect(check.composition.total).toBeUndefined();
    expect(check.composition.weights).toBeUndefined();
    expect(check.valid).toBe(true);
  });

  it('handles an empty selection without inventing weights', () => {
    expect(redistribute(draft({ components: [], weights: {} })).weights).toEqual({});
  });
});
