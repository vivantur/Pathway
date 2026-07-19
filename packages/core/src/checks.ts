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

import { DEGREES, degreeOfSuccess, type DegreeAdjustment, type DegreeOfSuccess } from "./degree.js";
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

/**
 * The damage MULTIPLIER for a basic saving throw, by degree (pasted Archives rule):
 * critical success → no damage (0), success → half (0.5), failure → full (1),
 * critical failure → double (2). The caller multiplies the damage total by this and
 * ROUNDS DOWN once (PF2e's standard rounding) — the round-down lives at the damage
 * node, not here, so this stays a pure factor. (A "minimum 1" applies to some effects
 * like feat-granted resistance, not to basic-save half damage.)
 */
export function basicSaveMultiplier(degree: DegreeOfSuccess): number {
  switch (degree) {
    case "critical-success":
      return 0;
    case "success":
      return 0.5;
    case "failure":
      return 1;
    case "critical-failure":
      return 2;
  }
}

/**
 * The damage MULTIPLIER for a Strike / attack roll, by degree: a critical hit deals
 * DOUBLE damage (pasted Archives "Critical Hits" rule → 2); a hit (success) deals
 * full damage (1); a failure or critical failure is a miss and deals none (0). Only
 * the ×2-on-crit is from the pasted text; success = full / miss = none is the
 * standard Strike behavior, owner-confirmed.
 */
export function attackDamageMultiplier(degree: DegreeOfSuccess): number {
  switch (degree) {
    case "critical-success":
      return 2;
    case "success":
      return 1;
    case "failure":
    case "critical-failure":
      return 0;
  }
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
 * Resolve the degree for an ALREADY-ROLLED d20 (its natural face + final total)
 * against a DC. This is the path a SHARED roll takes: one attack roll compared
 * against several targets' ACs yields a different degree per target, because the
 * DC differs even though the roll doesn't.
 *
 * `adjustments` are the ROLLING creature's degree adjustments — note that for a
 * save the roller is the TARGET, not the acting character. Select them from a
 * creature's collected passives with `degreeAdjustmentsFor` (passive.ts).
 */
export function resolveCheck(input: {
  die: number;
  total: number;
  dc: number;
  adjustments?: readonly DegreeAdjustment[];
}): CheckResult {
  const degree = degreeOfSuccess({
    total: input.total,
    dc: input.dc,
    die: input.die,
    adjustments: input.adjustments ? [...input.adjustments] : undefined,
  });
  return { die: input.die, total: input.total, dc: input.dc, degree };
}

/**
 * Roll a d20 + modifier against a DC and resolve the degree. The natural die face
 * is passed to the degree resolver so the nat-20/nat-1 one-degree shift applies,
 * before any `adjustments`.
 *
 * (Fortune / Misfortune is a REROLL, not a degree adjustment; it operates on dice
 * and is still unwired. `degreeAdjustmentsFor` drops reroll payloads for that
 * reason rather than approximating them as a shift.)
 */
export function rollCheck(input: {
  modifier: number;
  dc: number;
  rng: Rng;
  adjustments?: readonly DegreeAdjustment[];
}): CheckResult {
  const die = input.rng.int(1, 20);
  return resolveCheck({ die, total: die + input.modifier, dc: input.dc, adjustments: input.adjustments });
}
