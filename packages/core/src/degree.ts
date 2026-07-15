// Degree of success — the core resolver `attack`, `save`, and `check` all route
// through. Implemented VERBATIM from the Player Core "Degrees of Success" rules
// (as pulled from Archive of Nethys), never from memory, per the project's
// rules-from-source rule.
//
// Rules text encoded here:
//   • You CRITICALLY SUCCEED when the result meets or exceeds the DC by 10+.
//   • You SUCCEED when the result meets or exceeds the DC (but by less than 10).
//   • You FAIL when the result is below the DC (by less than 10).
//   • You CRITICALLY FAIL when you fail by 10 or more.
//   • Natural 20: your result is ONE DEGREE BETTER than the numbers alone.
//     Natural 1: one degree WORSE. (So a nat 20 against a very high DC can be a
//     mere success or even a failure; a nat 1 with a high modifier can still
//     succeed.) The shift is clamped — it can't exceed crit success / crit fail.
//   • ORDER: "apply the adjustment from a natural 20 or natural 1 BEFORE anything
//     else" — so the natural shift precedes any ability-driven degree adjustment.
//
// This module computes only the DEGREE. It does not roll dice, deal damage, or
// know what a given degree means for a given action (that is the action's data).

/** The four degrees, worst → best. Index doubles as the ordinal used for shifts. */
export const DEGREES = ["critical-failure", "failure", "success", "critical-success"] as const;
export type DegreeOfSuccess = (typeof DEGREES)[number];

const DEGREE_INDEX: Record<DegreeOfSuccess, number> = {
  "critical-failure": 0,
  failure: 1,
  success: 2,
  "critical-success": 3,
};

/** A post-natural degree adjustment supplied by a Layer-1 `rollAdjust` effect. */
export type DegreeAdjustment = "improve" | "worsen";

/** Shift a degree by `steps` (may be negative), clamped to the crit-fail/crit-success bounds. */
export function shiftDegree(degree: DegreeOfSuccess, steps: number): DegreeOfSuccess {
  const i = Math.max(0, Math.min(DEGREES.length - 1, DEGREE_INDEX[degree] + steps));
  return DEGREES[i]!;
}

/**
 * The degree from the numbers ALONE (before any natural-20/1 or ability
 * adjustment): compare the roll `total` to the `dc` by the ±10 bands above.
 */
export function numericalDegree(total: number, dc: number): DegreeOfSuccess {
  const delta = total - dc;
  if (delta >= 10) return "critical-success"; // meets/exceeds DC by 10+
  if (delta >= 0) return "success"; // meets/exceeds DC
  if (delta > -10) return "failure"; // below DC, by less than 10
  return "critical-failure"; // fails by 10 or more
}

export interface DegreeInput {
  /** The check result: the die plus all modifiers. */
  total: number;
  /** The DC being checked against. */
  dc: number;
  /**
   * The natural d20 face (1–20), when this was a d20 roll. `20` shifts one degree
   * better, `1` one worse; any other value has no natural effect. Omit for a
   * non-rolled result (e.g. Assurance, which takes a fixed value and never rolls,
   * so the natural-20/1 rule does not apply).
   */
  die?: number;
  /**
   * Ability-driven degree adjustments (Layer-1 `rollAdjust` hooks), applied in
   * order AFTER the natural-20/1 shift, per the rules' ordering. Each is a clamped
   * one-step shift. (Conditional "treat a X as a Y" abilities and Fortune/
   * Misfortune are separate mechanics, added later from their own rules text.)
   */
  adjustments?: DegreeAdjustment[];
}

/**
 * Resolve the final degree of success: numerical degree → natural-20/1 shift →
 * ability adjustments, in that order.
 */
export function degreeOfSuccess(input: DegreeInput): DegreeOfSuccess {
  let degree = numericalDegree(input.total, input.dc);
  // Natural 20 / natural 1 — before anything else.
  if (input.die === 20) degree = shiftDegree(degree, 1);
  else if (input.die === 1) degree = shiftDegree(degree, -1);
  // Then ability adjustments, in order.
  for (const adj of input.adjustments ?? []) {
    degree = shiftDegree(degree, adj === "improve" ? 1 : -1);
  }
  return degree;
}
