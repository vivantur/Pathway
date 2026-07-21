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

/** Whether a rider carries a MAP multiplier the host still needs to apply. */
export function riderMapMultiplier(rider: StrikeRider): number {
  return rider.strikeMods?.mapMultiplier ?? 1;
}

/**
 * Compose a rider onto a base Strike, returning the runnable Layer-2 tree.
 *
 * The base tree is `strikeAutomation`'s single `attack` node with per-degree damage;
 * this returns a fresh tree with the rider merged (nothing here mutates its inputs).
 *
 * `bonusDamage` is folded into the Strike's own damage so the interpreter doubles it
 * on a crit exactly as it doubles the weapon's dice — a tacked-on un-scaled damage
 * node would UNDER-count a critical Power Attack, which is precisely the kind of
 * silent damage bug the Strike model keeps `deadlyDamage` separate to avoid.
 *
 * `mapMultiplier` is NOT applied here (it is host/turn state, not tree shape); read it
 * with `riderMapMultiplier` and advance the turn's attack count in the host.
 */
export function composeStrikeRider(strike: Strike, rider: StrikeRider, map?: MapOptions): AutomationNode[] {
  // 1. strikeMods → a copy of the Strike, so bonus dice double on a crit with the rest.
  let modified = strike;
  const bonus = rider.strikeMods?.bonusDamage;
  if (bonus && bonus.length > 0) {
    modified = {
      ...strike,
      damage: [...strike.damage, ...bonus],
      // When FATAL replaced the crit dice, the bonus dice must ride there too or the
      // crit silently loses them (onCriticalSuccess reads criticalDamage when set).
      criticalDamage: strike.criticalDamage ? [...strike.criticalDamage, ...bonus] : strike.criticalDamage,
    };
  }

  // 2. The base tree.
  const tree = strikeAutomation(modified, map);
  const base = tree[0];
  if (!base || base.kind !== "attack") return tree; // strikeAutomation always yields one attack node

  // 3. Append the degree fragments. `onHit` fans to both success branches; the base
  //    damage stays FIRST so damage resolves before a rider's applied condition reads
  //    "you hit and dealt damage".
  const onHit = rider.onHit ?? [];
  const attack: AutomationNode = {
    ...base,
    onSuccess: [...(base.onSuccess ?? []), ...onHit, ...(rider.onSuccess ?? [])],
    onCriticalSuccess: [...(base.onCriticalSuccess ?? []), ...onHit, ...(rider.onCriticalSuccess ?? [])],
    ...(rider.onFailure && rider.onFailure.length > 0
      ? { onFailure: [...(base.onFailure ?? []), ...rider.onFailure] }
      : {}),
    ...(rider.onCriticalFailure && rider.onCriticalFailure.length > 0
      ? { onCriticalFailure: [...(base.onCriticalFailure ?? []), ...rider.onCriticalFailure] }
      : {}),
  };
  return [attack, ...tree.slice(1)];
}
