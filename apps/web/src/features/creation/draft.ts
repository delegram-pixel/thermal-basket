import { BPS_DENOMINATOR } from '@thematic/types';
import type { Address, Bps } from '@thematic/types';
import type { CreationTerms } from '@thematic/blockchain';

/**
 * The creation form's model, and every rule it enforces.
 *
 * Kept out of the component so the arithmetic and the validation can be reasoned
 * about — and tested — without rendering anything. The form is a view over this;
 * where the two disagree, this is right.
 *
 * The unit question is the one thing to get straight here. §1 and the whole
 * contracts layer work in basis points, and nothing on-chain ever sees a
 * percentage. But a creator types "30", not "3000", and asking them to type basis
 * points is how you get a basket weighted 30/10000. So the *input* is a percent
 * string and the *state that leaves this module* is basis points. The conversion
 * happens in exactly two functions below, and nothing else is allowed to do it.
 */

export interface BasketDraft {
  name: string;
  symbol: string;
  theme: string;
  description: string;
  /** Selected components, in the order the creator added them. */
  components: Address[];
  /** Weight as typed, as a percentage string, keyed by lowercase address. */
  weights: Record<string, string>;
  /** Fees and tolerance as typed percentages. Converted on the way out. */
  depositFee: string;
  redeemFee: string;
  creatorShare: string;
  slippage: string;
}

export function emptyDraft(defaults: CreationTerms): BasketDraft {
  return {
    name: '',
    symbol: '',
    theme: '',
    description: '',
    components: [],
    weights: {},
    // Prefilled from the factory's advisory defaults rather than left blank, so
    // a creator who does not care about fee design can accept them and move on.
    depositFee: bpsToPercent(defaults.depositFeeBps),
    redeemFee: bpsToPercent(defaults.redeemFeeBps),
    creatorShare: bpsToPercent(defaults.creatorShareBps),
    slippage: bpsToPercent(defaults.maxSlippageBps),
  };
}

// ---------------------------------------------------------------------------
// The conversion, in both directions
// ---------------------------------------------------------------------------

export type Parsed = { ok: true; bps: Bps } | { ok: false; error: string };

/**
 * A percentage string to basis points.
 *
 * Rejects more than two decimal places rather than rounding them away. `30.555`
 * is not representable in basis points, and silently storing 3056 would mean the
 * creator's basket does not match what they typed — with the difference landing
 * on somebody's deposit.
 */
export function percentToBps(raw: string): Parsed {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, error: 'Enter a percentage.' };

  if (!/^\d*\.?\d*$/.test(trimmed)) {
    return { ok: false, error: 'Use digits and at most one decimal point.' };
  }

  const decimals = trimmed.split('.')[1] ?? '';
  if (decimals.length > 2) {
    return {
      ok: false,
      error: 'Two decimal places is the most basis points can represent.',
    };
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, error: 'That is not a number.' };

  // `Math.round` on a value that is already an exact multiple of 0.01 is exact
  // for every input that reaches here, so this does not round in practice — it
  // only converts the float to an integer without a binary-representation
  // surprise like 3050.0000000000005.
  const bps = Math.round(value * 100);
  if (bps > BPS_DENOMINATOR) {
    return { ok: false, error: 'Cannot exceed 100%.' };
  }

  return { ok: true, bps };
}

/** Basis points to the shortest percentage string that round-trips. */
export function bpsToPercent(bps: Bps): string {
  const percent = bps / 100;
  return String(percent);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Whether the draft can be deployed, and what is stopping it if not.
 *
 * `errors` is keyed by field so the form can attach each message to the control
 * that caused it. The contract is still the authority — every rule here mirrors
 * one it enforces — but a creator should learn about them in the form rather
 * than by paying gas to be told.
 */
export interface DraftCheck {
  identity: { name?: string; symbol?: string; theme?: string; description?: string };
  composition: { components?: string; weights?: Record<string, string>; total?: string };
  fees: { depositFee?: string; redeemFee?: string; creatorShare?: string; slippage?: string };
  /** True when nothing at all is wrong. */
  valid: boolean;
  /** Weight total in basis points, whether or not it is valid. */
  totalBps: number;
}

/** ERC-20 symbols longer than this are truncated in most wallets. */
const SYMBOL_MAX = 11;
const NAME_MAX = 48;
const THEME_MAX = 32;
const DESCRIPTION_MAX = 600;

export function checkDraft(
  draft: BasketDraft,
  limits: CreationTerms,
  maxComponents: number,
): DraftCheck {
  const identity: DraftCheck['identity'] = {};
  const composition: DraftCheck['composition'] = {};
  const fees: DraftCheck['fees'] = {};

  // -- Identity ------------------------------------------------------------
  const name = draft.name.trim();
  if (name === '') identity.name = 'Give the basket a name.';
  else if (name.length > NAME_MAX) identity.name = `Keep it under ${NAME_MAX} characters.`;

  const symbol = draft.symbol.trim();
  if (symbol === '') identity.symbol = 'Give the basket a symbol.';
  else if (symbol.length > SYMBOL_MAX) {
    identity.symbol = `Keep it to ${SYMBOL_MAX} characters or fewer; wallets truncate longer symbols.`;
  } else if (!/^[A-Za-z0-9]+$/.test(symbol)) {
    identity.symbol = 'Letters and digits only — no spaces or punctuation.';
  }

  if (draft.theme.trim() === '') identity.theme = 'Give the basket a theme.';
  else if (draft.theme.trim().length > THEME_MAX) {
    identity.theme = `Keep it under ${THEME_MAX} characters.`;
  }

  if (draft.description.trim().length > DESCRIPTION_MAX) {
    identity.description = `Keep it under ${DESCRIPTION_MAX} characters.`;
  }

  // -- Composition ---------------------------------------------------------
  const weights: Record<string, string> = {};
  let totalBps = 0;

  if (draft.components.length === 0) {
    composition.components = 'Add at least one component.';
  } else if (draft.components.length > maxComponents) {
    composition.components = `A basket may hold at most ${maxComponents} components.`;
  }

  for (const component of draft.components) {
    const key = component.toLowerCase();
    const parsed = percentToBps(draft.weights[key] ?? '');
    if (!parsed.ok) {
      weights[key] = parsed.error;
      continue;
    }
    if (parsed.bps === 0) {
      weights[key] = 'Every component needs a weight above zero.';
      continue;
    }
    totalBps += parsed.bps;
  }

  if (Object.keys(weights).length > 0) {
    composition.weights = weights;
  } else if (draft.components.length > 0 && totalBps !== BPS_DENOMINATOR) {
    // Only report the total once every individual weight is a real number;
    // otherwise the total is meaningless and the per-field messages are the
    // ones that need reading.
    const difference = BPS_DENOMINATOR - totalBps;
    composition.total =
      difference > 0
        ? `Weights total ${(totalBps / 100).toFixed(2)}%. They must total 100% — ${(difference / 100).toFixed(2)}% is unassigned.`
        : `Weights total ${(totalBps / 100).toFixed(2)}%, which is ${(Math.abs(difference) / 100).toFixed(2)}% over 100%.`;
  }

  // -- Fees ----------------------------------------------------------------
  const feeFields: Array<[keyof DraftCheck['fees'], string, number, string]> = [
    ['depositFee', draft.depositFee, limits.depositFeeBps, 'The deposit fee'],
    ['redeemFee', draft.redeemFee, limits.redeemFeeBps, 'The redemption fee'],
    ['creatorShare', draft.creatorShare, limits.creatorShareBps, "The creator's share"],
    ['slippage', draft.slippage, limits.maxSlippageBps, 'The slippage tolerance'],
  ];

  // The slippage tolerance may legitimately be zero — a creator can require an
  // exact fill. The fee rates may not: a zero fee is a valid choice too, so the
  // only floor is that the value parses and is within the ceiling.
  for (const [field, raw, ceiling, label] of feeFields) {
    const parsed = percentToBps(raw);
    if (!parsed.ok) {
      fees[field] = parsed.error;
      continue;
    }
    if (parsed.bps > ceiling) {
      fees[field] = `${label} cannot exceed ${(ceiling / 100).toFixed(2)}% on this deployment.`;
    }
  }

  const valid =
    Object.keys(identity).length === 0 &&
    Object.keys(composition).length === 0 &&
    Object.keys(fees).length === 0;

  return { identity, composition, fees, valid, totalBps };
}

// ---------------------------------------------------------------------------
// Weight editing
// ---------------------------------------------------------------------------

/**
 * Spreads 100% as evenly as basis points allow.
 *
 * The remainder goes to the earliest components rather than being dropped, so
 * the result always totals exactly `BPS_DENOMINATOR` — three components get
 * 33.34 / 33.33 / 33.33, not 33.33 three times and a 0.01% hole the form would
 * then refuse to deploy.
 */
export function equalWeights(count: number): Bps[] {
  if (count <= 0) return [];
  const base = Math.floor(BPS_DENOMINATOR / count);
  const remainder = BPS_DENOMINATOR - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function addComponent(draft: BasketDraft, component: Address): BasketDraft {
  const key = component.toLowerCase();
  if (draft.components.some((existing) => existing.toLowerCase() === key)) return draft;

  // The newcomer takes whatever is unassigned, and nothing already typed is
  // touched. Silently rescaling a creator's existing weights to make room would
  // be this form editing a number they chose, which is the one thing a form
  // must never do to a value with money attached to it. When there is no
  // headroom left the newcomer gets nothing and the total error says so, with
  // "Distribute evenly" one click away.
  const assigned = draft.components.reduce((running, address) => {
    const parsed = percentToBps(draft.weights[address.toLowerCase()] ?? '');
    return running + (parsed.ok ? parsed.bps : 0);
  }, 0);
  const headroom = Math.max(0, BPS_DENOMINATOR - assigned);

  return {
    ...draft,
    components: [...draft.components, component],
    weights: {
      ...draft.weights,
      [key]: bpsToPercent(draft.components.length === 0 ? BPS_DENOMINATOR : headroom),
    },
  };
}

/** Drops a component. The remaining weights are left exactly as they were. */
export function removeComponent(draft: BasketDraft, component: Address): BasketDraft {
  const key = component.toLowerCase();
  const components = draft.components.filter((existing) => existing.toLowerCase() !== key);
  if (components.length === draft.components.length) return draft;

  const weights = { ...draft.weights };
  delete weights[key];

  return { ...draft, components, weights };
}

/** Re-spreads the current components evenly, keeping the selection. */
export function redistribute(draft: BasketDraft): BasketDraft {
  const spread = equalWeights(draft.components.length);
  return {
    ...draft,
    weights: Object.fromEntries(
      draft.components.map((address, index) => [
        address.toLowerCase(),
        bpsToPercent(spread[index] ?? 0),
      ]),
    ),
  };
}
