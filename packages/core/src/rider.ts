// Strike riders — composing a keyword fragment onto a base Strike tree.
//
// See docs/strike-riders-design.md (the plan of record). The short version: a large
// class of PF2e activities is "Make a Strike, and also do X" (Intimidating Strike,
// Power Attack, Snagging Strike). Rather than author a wholly bespoke tree for each,
// the player Strikes as normal and tacks on a keyword; the rider is a SMALL Layer-2
// fragment composed onto `strikeAutomation`'s base tree at invocation.
//
// PURE, and with the grain of the engine: `strikeAutomation` already builds the base
// tree, the interpreter already has every node a rider needs. This module only
// MERGES — it introduces no new execution model and computes no PF2e rule. A rider
// INSTANCE (Intimidating Strike = Frightened) is a rules claim authored from the
// feat's text; this file is the mechanism, not the claims.
//
// TWO COMPOSITION POINTS, because riders attach at two different stages (design doc):
//   • strikeMods — modify the STRIKE itself (extra weapon dice, MAP multiplier),
//                  applied BEFORE strikeAutomation so the dice double on a crit.
//   • degree fragments — appended to the base tree's per-degree branches AFTER.

import { z } from "zod";
import {
  automationNodeSchema,
  damageComponentSchema,
  type AutomationNode,
  type MapOptions,
} from "./automation.js";
import { actionCostSchema } from "./spell.js";
import { strikeAutomation, type Strike } from "./strike.js";

export const strikeRiderSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** How a player invokes it: `/strike … rider:<keyword>`. */
    keyword: z.string().min(1),
    /**
     * The activity's real action cost (Intimidating Strike is 2), which overrides a
     * plain Strike's. Display and validation only — the cost is not spent in the tree.
     */
    actionCost: actionCostSchema.optional(),

    // ── B: modifications to the STRIKE itself, applied pre-`strikeAutomation` ──
    strikeMods: z
      .object({
        /**
         * "This counts as N attacks when calculating your multiple attack penalty"
         * (Power Attack, Spiritual Disruption = 2). DECLARATIVE here: it advances the
         * turn's attack count, which is host/interpreter state, not tree shape — so it
         * is surfaced for the host to apply, never silently dropped. See the design doc.
         */
        mapMultiplier: z.number().int().min(1).optional(),
        /** Extra WEAPON damage dice (doubled on a crit, so they ride the weapon dice). */
        bonusDamage: z.array(damageComponentSchema).optional(),
      })
      .strict()
      .optional(),

    // ── A: fragments composed onto the base tree's DEGREE branches, post ──
    /** Fanned to BOTH success branches — for a rider that does the same on any hit. */
    onHit: z.array(automationNodeSchema).optional(),
    /** A regular hit only. */
    onSuccess: z.array(automationNodeSchema).optional(),
    /** A critical hit only (Intimidating Strike's Frightened 2 vs 1). */
    onCriticalSuccess: z.array(automationNodeSchema).optional(),
    /** A miss (Certain Strike's glancing-blow failure effect). */
    onFailure: z.array(automationNodeSchema).optional(),
    onCriticalFailure: z.array(automationNodeSchema).optional(),
  })
  .strict();

export type StrikeRider = z.infer<typeof strikeRiderSchema>;

/**
 * The MAP multiplier a SET of riders imposes — "counts as N attacks". Realistically
 * only the ACTIVITY rider sets one (a rune or passive rider leaves it at 1), so the
 * max is the honest fold: two riders never make a Strike "count as three attacks".
 * The host still applies it (turn state, not tree shape).
 */
export function ridersMapMultiplier(riders: readonly StrikeRider[]): number {
  return Math.max(1, ...riders.map((r) => r.strikeMods?.mapMultiplier ?? 1));
}

/** A single rider's MAP multiplier — the one-rider form of {@link ridersMapMultiplier}. */
export function riderMapMultiplier(rider: StrikeRider): number {
  return ridersMapMultiplier([rider]);
}

/**
 * Compose a SET of riders onto a base Strike, returning the runnable Layer-2 tree.
 *
 * ONE Strike commonly carries SEVERAL riders at once — a Rooting rune (Immobilized on
 * a crit) on a weapon Struck with an activity like Power Attack (an extra die), plus
 * whatever runes/feats always apply. At mid level a real attack stacks four or more.
 * So this folds a list, not a single rider; `composeStrikeRider` is the one-rider case.
 *
 * The fold is order-preserving and additive:
 *   • every rider's `strikeMods.bonusDamage` is concatenated into the Strike's damage
 *     BEFORE the tree is built, so each extra die doubles on a crit exactly as the
 *     weapon's dice do — a tacked-on un-scaled node would under-count a critical hit,
 *     the bug the Strike model keeps `deadlyDamage` separate to avoid;
 *   • every rider's degree fragments are appended to the matching branch, in rider
 *     order, AFTER the base damage — so damage resolves first and an applied condition
 *     can read "you hit and dealt damage", and two riders' effects both land.
 *
 * Returns a fresh tree; nothing here mutates its inputs. `mapMultiplier` is NOT applied
 * here (it is host/turn state) — read it with `ridersMapMultiplier`.
 */
export function composeStrikeRiders(strike: Strike, riders: readonly StrikeRider[], map?: MapOptions): AutomationNode[] {
  // 1. Fold every rider's strikeMods into a copy of the Strike.
  const bonus = riders.flatMap((r) => r.strikeMods?.bonusDamage ?? []);
  const modified: Strike = bonus.length > 0
    ? {
        ...strike,
        damage: [...strike.damage, ...bonus],
        // When FATAL replaced the crit dice, the bonus dice must ride there too or the
        // crit silently loses them (onCriticalSuccess reads criticalDamage when set).
        criticalDamage: strike.criticalDamage ? [...strike.criticalDamage, ...bonus] : strike.criticalDamage,
      }
    : strike;

  // 2. The base tree.
  const tree = strikeAutomation(modified, map);
  const base = tree[0];
  if (!base || base.kind !== "attack") return tree; // strikeAutomation always yields one attack node

  // 3. Concatenate every rider's degree fragments. `onHit` fans to both success
  //    branches; the base damage stays FIRST.
  const collect = (pick: (r: StrikeRider) => AutomationNode[] | undefined) => riders.flatMap((r) => pick(r) ?? []);
  const onHit = collect((r) => r.onHit);
  const onFailure = collect((r) => r.onFailure);
  const onCriticalFailure = collect((r) => r.onCriticalFailure);
  const attack: AutomationNode = {
    ...base,
    onSuccess: [...(base.onSuccess ?? []), ...onHit, ...collect((r) => r.onSuccess)],
    onCriticalSuccess: [...(base.onCriticalSuccess ?? []), ...onHit, ...collect((r) => r.onCriticalSuccess)],
    ...(onFailure.length > 0 ? { onFailure: [...(base.onFailure ?? []), ...onFailure] } : {}),
    ...(onCriticalFailure.length > 0 ? { onCriticalFailure: [...(base.onCriticalFailure ?? []), ...onCriticalFailure] } : {}),
  };
  return [attack, ...tree.slice(1)];
}

/** Compose ONE rider onto a Strike — the one-rider case of {@link composeStrikeRiders}. */
export function composeStrikeRider(strike: Strike, rider: StrikeRider, map?: MapOptions): AutomationNode[] {
  return composeStrikeRiders(strike, [rider], map);
}
