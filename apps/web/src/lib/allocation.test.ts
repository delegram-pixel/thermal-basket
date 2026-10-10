import { describe, expect, it } from 'vitest';
import { allocationTone } from './allocation.ts';

/**
 * The allocation palette.
 *
 * A colour ramp is not usually worth a test, but this one carries a rule that
 * is easy to break by adding a step in the wrong place: adjacent segments have
 * to stay tellable apart at 2.5px tall, because telling them apart is the only
 * job the band has (§24). Both the distinctness and the wrap-around below are
 * that rule stated as an assertion.
 */

describe('allocationTone', () => {
  it('starts on the accent, so the largest segment reads as the app’s own colour', () => {
    expect(allocationTone(0)).toBe('#123a6b');
  });

  it('returns a valid hex colour for every position the band can use', () => {
    for (let index = 0; index < 10; index += 1) {
      expect(allocationTone(index), `index ${index}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('gives neighbouring segments different colours', () => {
    // The failure this catches is someone inserting a step that duplicates its
    // neighbour, which turns two holdings into one band on screen.
    for (let index = 0; index < 9; index += 1) {
      expect(allocationTone(index), `index ${index} vs ${index + 1}`).not.toBe(
        allocationTone(index + 1),
      );
    }
  });

  it('uses a distinct colour at every step, not merely at adjacent ones', () => {
    const ramp = Array.from({ length: 10 }, (_, index) => allocationTone(index));
    expect(new Set(ramp).size).toBe(10);
  });

  it('wraps rather than returning undefined when a basket is wider than the ramp', () => {
    // The factory caps a basket at ten components, which is exactly the ramp
    // length — but the cap is a contract value, and a component added ahead of
    // it must not paint an invisible segment.
    expect(allocationTone(10)).toBe(allocationTone(0));
    expect(allocationTone(13)).toBe(allocationTone(3));
    expect(allocationTone(25)).toBe(allocationTone(5));
  });

  it('never returns undefined for a non-negative index', () => {
    for (let index = 0; index < 40; index += 1) {
      expect(allocationTone(index), `index ${index}`).toBeDefined();
    }
  });
});
