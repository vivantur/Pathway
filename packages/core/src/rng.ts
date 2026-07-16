// A small deterministic, seeded pseudo-random number generator — the ONLY source
// of randomness the Layer-2 automation interpreter uses. Threading a seeded RNG
// through every run is what makes an automation invocation REPLAYABLE and thus
// unit-testable: the same tree + the same seed always produce the same rolls,
// degrees, and damage. See docs/effects-engine-design.md, "It's a runtime, and
// it's pure" ("Seeded RNG ⇒ replayable ⇒ testable").
//
// PURE: no crypto, no global state, no I/O. The algorithm is mulberry32 — a
// well-known 32-bit generator that is tiny, fast, and good enough for dice (this
// is a game, not cryptography). It is NOT cryptographically secure and must never
// be used for anything security-sensitive.

export interface Rng {
  /** The next float in [0, 1). */
  next(): number;
  /**
   * A uniform integer in the INCLUSIVE range [min, max]. `min` and `max` are
   * rounded down; if `max < min` the range collapses and `min` is returned.
   */
  int(min: number, max: number): number;
}

/**
 * Create a seeded RNG. Equal seeds yield identical sequences; a run seeded the
 * same way is perfectly reproducible. `seed` is coerced to a 32-bit unsigned int.
 */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min: number, max: number): number {
      const lo = Math.floor(min);
      const hi = Math.floor(max);
      if (hi <= lo) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },
  };
}
