// Check resolution — the shared primitive that `attack`, `save`, and `check`
// automation nodes all route through (Layer 2, slice 3a). Roll one d20 through
// the seeded RNG, add a modifier, and resolve the four-degree outcome via the
// degree-of-success resolver (degree.ts, already implemented from rules text).
//
// TWO PF2e RULES ARE ENCODED HERE, both from pasted Archives text:
//   • `dcFromModifier` — "Like any other DC derived from a modifier, the DC for a
//     saving throw is 10 + the total modifier for that saving throw." This is how
//     a target-stat-derived DC is computed (e.g. an Athletics check vs a target's
//     Reflex DC = 10 + that creature's Reflex modifier).
//   • the four degrees + the natural-20/1 shift come from `degree.ts` — not
//     re-derived here; `rollCheck` just feeds it the natural die face.
//
// The basic-save damage mapping (none/half/full/double) is a DAMAGE rule and lives
// with the damage node (slice 4), not here — this module resolves the DEGREE only.
//
// PURE: the only nondeterminism is the passed seeded `Rng`, so a resolution is
// replayable and unit-testable.

import { DEGREES, degreeOfSuccess, type DegreeOfSuccess } from "./degree.js";
import type { Rng } from "./rng.js";

/** The DC derived from a modifier: 10 + the modifier (pasted Archives rule). */
export function dcFromModifier(modifier: number): number {
  return 10 + modifier;
}

/**
 * A degree's ordinal 0–3 (critical-failure … critical-success), so degrees can be
 * compared numerically in the expression language (`gte(saveDegree, 2)` = "success
 * or better"). Mirrors `degree.ts`'s worst→best ordering.
 */
export function degreeOrdinal(degree: DegreeOfSuccess): number {
  return DEGREES.indexOf(degree);
}

export interface CheckResult {
  /** The natural d20 face rolled (1–20). */
  die: number;
  /** The check total: the die plus the modifier. */
  total: number;
  /** The DC checked against. */
  dc: number;
  /** The resolved degree of success. */
  degree: DegreeOfSuccess;
}

/**
 * Roll a d20 + modifier against a DC and resolve the degree. The natural die face
 * is passed to the degree resolver so the nat-20/nat-1 one-degree shift applies.
 * (Assurance / Fortune / Misfortune degree adjustments are deferred — the resolver
 * supports them, but nothing wires them in yet.)
 */
export function rollCheck(input: { modifier: number; dc: number; rng: Rng }): CheckResult {
  const die = input.rng.int(1, 20);
  const total = die + input.modifier;
  const degree = degreeOfSuccess({ total, dc: input.dc, die });
  return { die, total, dc: input.dc, degree };
}
