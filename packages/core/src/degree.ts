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
//   • MULTIPLE ADJUSTMENTS (owner-supplied, 2026-07-19): "apply all the effects that
//     IMPROVE the degree, followed by any that WORSEN it. Each effect can only change
//     the degree of success once." See `applyDegreeAdjustments`.
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

/**
 * A post-natural degree adjustment supplied by a Layer-1 `rollAdjust` effect.
 *
 * Two shapes:
 *   • `"improve"` / `"worsen"` — a BLANKET one-degree shift, whatever the roll came
 *     out as (Assurance-style).
 *   • `{ map }` — a CONDITIONAL rewrite keyed on the incoming degree, which is what
 *     most PF2e prose actually says: "when you roll a success …, you get a critical
 *     success instead" is `{ success: "critical-success" }`. A degree with no entry
 *     is untouched, so the map is inherently conditional — Adaptive Vision improves
 *     a success and leaves a failure alone.
 *
 * The map targets an ABSOLUTE degree rather than a step count because that is what
 * the prose says ("you get a critical success INSTEAD"), and because it expresses
 * a floor without a second primitive: Forager's "any result worse than a success,
 * you get a success" is `{ "critical-failure": "success", failure: "success" }`.
 */
export type DegreeAdjustment =
  | "improve"
  | "worsen"
  | { map: Partial<Record<DegreeOfSuccess, DegreeOfSuccess>> };

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
   * Ability-driven degree adjustments (Layer-1 `rollAdjust` hooks), resolved AFTER
   * the natural-20/1 shift per the rules' ordering, by `applyDegreeAdjustments`
   * below. Order within the array does NOT matter. (Fortune/Misfortune is a reroll,
   * a separate mechanic that operates on dice rather than degrees.)
   */
  adjustments?: DegreeAdjustment[];
}

/**
 * Resolve one adjustment against `base` into a step count (positive = improves,
 * negative = worsens, 0 = does not apply to this degree).
 */
function adjustmentDelta(adjustment: DegreeAdjustment, base: DegreeOfSuccess): number {
  if (adjustment === "improve") return 1;
  if (adjustment === "worsen") return -1;
  const target = adjustment.map[base];
  // No entry for the incoming degree — this ability says nothing about this result.
  if (target === undefined) return 0;
  return DEGREE_INDEX[target] - DEGREE_INDEX[base];
}

/**
 * Apply a set of degree adjustments to an already-natural-shifted degree.
 *
 * OWNER-SUPPLIED RULE (2026-07-19), encoded verbatim:
 *   "When multiple effects change the degree of success for a single roll, we apply
 *    all the effects that IMPROVE the degree, followed by any that WORSEN it. Each
 *    effect can only change the degree of success once."
 *
 * Two consequences worth spelling out, because both are load-bearing:
 *
 *   • WHY THE ORDER MATTERS: clamping. With one improver and one worsener on a
 *     critical success, improve-then-worsen gives crit-success (clamped) → success,
 *     while worsen-then-improve gives success → crit-success. The owner's ordering
 *     picks the first. If the buckets were merely summed the rule would be vacuous.
 *
 *   • EACH EFFECT FIRES ONCE: every adjustment is measured against the SAME incoming
 *     degree (`base`) and contributes a single step count. Adjustments therefore do
 *     not cascade into one another — Dragon's Presence maps both `success` and
 *     `failure`, but a given roll is only one of them, so only one entry can fire.
 *     Measuring against `base` also makes the result independent of array order,
 *     which a pure engine needs: effects arrive in whatever order a sheet lists them.
 */
export function applyDegreeAdjustments(
  base: DegreeOfSuccess,
  adjustments: readonly DegreeAdjustment[],
): DegreeOfSuccess {
  let improvement = 0;
  let worsening = 0;
  for (const adjustment of adjustments) {
    const delta = adjustmentDelta(adjustment, base);
    if (delta > 0) improvement += delta;
    else if (delta < 0) worsening += delta;
  }
  // Improvers first (clamped), then worseners (clamped) — the owner's ordering.
  return shiftDegree(shiftDegree(base, improvement), worsening);
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
  // Then ability adjustments: improvers, then worseners.
  return applyDegreeAdjustments(degree, input.adjustments ?? []);
}
