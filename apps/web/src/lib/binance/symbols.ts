/**
 * The mapping from this deployment's components to the underlyings they stand in
 * for.
 *
 * The demo runs on mock tokens — `mNVDA`, `mMSFT` and six others, seeded by
 * `packages/contracts/scripts/lib/config.ts`. Those names carry an `m` prefix
 * precisely so nothing reads them as real equities, and the prefix is what has to
 * come off before the Binance Web3 API can be asked about them: it knows `NVDA`,
 * not `mNVDA`.
 *
 * This is a mapping between two naming schemes and nothing more. It is not a
 * claim that `mNVDA` is NVDA, or that it is backed by it, or that it is worth
 * anything — it is a claim about which real company's reference price is a
 * meaningful thing to show next to a token whose *name* says NVIDIA. The
 * interface states that distinction wherever the two numbers appear together.
 *
 * A chain with real tokenized equities does not use this: those tokens are
 * already named for the underlying, and the lookup falls through to the symbol
 * itself. See {@link underlyingFor}.
 */

export const UNDERLYING_BY_COMPONENT: Readonly<Record<string, string>> = {
  MNVDA: 'NVDA',
  MMSFT: 'MSFT',
  MGOOGL: 'GOOGL',
  MAMZN: 'AMZN',
  MMETA: 'META',
  MTSLA: 'TSLA',
  MCOIN: 'COIN',
  MMSTR: 'MSTR',
};

/**
 * The underlying ticker for a component symbol.
 *
 * Accepts the symbol case-insensitively, because ERC-20 `symbol()` is whatever
 * the deployer wrote and mixed-case tokens are common enough that comparing
 * exactly would silently price half a basket. Falls back to the symbol stripped
 * of a leading `m` when it is not in the table, so a component added to the
 * deployment without a corresponding entry here still gets a lookup rather than
 * an unexplained blank.
 */
export function underlyingFor(componentSymbol: string): string {
  const trimmed = componentSymbol.trim();
  const known = UNDERLYING_BY_COMPONENT[trimmed.toUpperCase()];
  if (known) return known;

  return trimmed.replace(/^m(?=[A-Z])/, '');
}

/** Every underlying this deployment knows how to ask about. */
export const KNOWN_UNDERLYINGS: readonly string[] = Object.values(UNDERLYING_BY_COMPONENT);
