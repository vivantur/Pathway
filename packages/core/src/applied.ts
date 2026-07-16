// Layer 1.5 — the APPLIED EFFECT: the bridge where passive and active meet.
//
// An applied effect is a container carried on a creature during play: the Layer-1
// passive effects it imposes (`passives` — the SAME `PassiveEffect` schema the
// character sheet uses, per the doc's "one passive schema, two lifecycle owners"),
// plus its duration and tick timing. See docs/effects-engine-design.md, "Layer 1.5
// — the applied effect".
//
// THIS SLICE (7a) is the shape + the duration/tick VOCABULARY + the pure resolvers.
// The `applyEffect`/`removeEffect` nodes, link groups, granted actions and buttons
// land in 7b/7c.
//
// ── The rules encoded here (from pasted Player Core "Durations" text) ────────
//   • "If a spell's duration is given in rounds, the number of rounds remaining
//     decreases by 1 AT THE START OF EACH OF THE SPELLCASTER'S TURNS, ending when
//     the duration reaches 0."  → a `rounds` duration is anchored to the ORIGIN's
//     turn (not the bearer's), at its START. This is exactly the off-by-a-turn trap:
//     cast on your own turn, the current turn's start has already passed, so the
//     first decrement is at the start of your NEXT turn.
//   • "If a spell's caster dies or is incapacitated during the spell's duration, the
//     spell remains in effect until its duration ends, USING THE CASTER'S INITIATIVE
//     ORDER." → the origin anchor outlives the origin. Nothing here reads the
//     origin's state, so this falls out for free: the host keeps feeding turn events
//     on that initiative slot.
//   • "If the spell's duration is 'sustained,' it lasts until the end of your next
//     turn unless you use the Sustain action on that turn to extend the duration."
//     → `sustained` resolves to "until the END of the ORIGIN's NEXT turn"; Sustaining
//     restarts that clock (`sustainEffect`).
//   • "Spells with an unlimited duration last until counteracted or Dismissed."
//
// SUSTAIN IS ORTHOGONAL TO DURATION. An effect can have an ordinary duration AND
// still offer a Sustain action with an ADDITIONAL effect — so `sustain` is its own
// optional field, never inferred from the duration. (`duration: sustained` is the
// separate, self-extending case.)
//
// TICKS PROMPT, THEY DO NOT RESOLVE. `tickTiming` says only WHEN a recurring effect
// fires; what it fires (and its manually-invocable twin) is a button/granted action
// in 7c, so the same automation can be triggered off-turn — assistance changing a
// flat-check DC, or an ability granting an immediate extra attempt, means pure
// automation is wrong. This mirrors the doc's existing stance on reactions.
//
// PURITY: this module has no clock. The host's combat tracker owns initiative and
// the round counter and feeds `TurnEvent`s; core owns what they MEAN. One tested
// implementation, per the reason packages/core exists.

import { z } from "zod";
import { passiveEffectSchema, type PassiveEffect } from "./passive.js";

/**
 * A moment in the turn cycle, relative to an effect: the start or end of the turn
 * of the creature that APPLIED it (`origin`) or the one it is ON (`bearer`). The
 * shared primitive behind both tick timing and expiry — modelling only start/end,
 * without *whose*, is how effects end up a turn off.
 */
export const turnMomentSchema = z
  .object({ when: z.enum(["start", "end"]), whose: z.enum(["origin", "bearer"]) })
  .strict();
export type TurnMoment = z.infer<typeof turnMomentSchema>;

/** How long an applied effect lasts. Kinds mirror the Durations rules text. */
export const durationSchema = z.discriminatedUnion("kind", [
  /** Until counteracted or Dismissed. */
  z.object({ kind: z.literal("unlimited") }).strict(),
  /** N rounds: decrements at the START of the origin's turn, ending at 0. */
  z.object({ kind: z.literal("rounds"), count: z.number().int().nonnegative() }).strict(),
  /** Until the end of the origin's NEXT turn, unless Sustained. */
  z.object({ kind: z.literal("sustained") }).strict(),
  /**
   * Until a given turn moment. `next: true` means the NEXT such turn — the
   * occurrence during the turn the effect was applied in does not count ("until the
   * end of your next turn" vs "until the end of your turn").
   */
  z.object({ kind: z.literal("until"), moment: turnMomentSchema, next: z.boolean().optional() }).strict(),
  /** Wall/game-clock durations. Not resolved by the turn machinery — the host's clock. */
  z.object({ kind: z.literal("time"), amount: z.number().positive(), unit: z.enum(["minutes", "hours", "days"]) }).strict(),
  /** Until the origin's next daily preparations. */
  z.object({ kind: z.literal("dailyPreparations") }).strict(),
]);
export type Duration = z.infer<typeof durationSchema>;

/**
 * The AUTHORED part of an applied effect — everything content can know ahead of
 * time. An `applyEffect` node carries one of these; the runtime identity
 * (`id`/`originId`/`bearerId`/`appliedAt`) is stamped by the HOST when it applies
 * the mutation, because minting an instance id and reading the clock are both
 * impure and belong outside core.
 */
export const effectTemplateSchema = z
  .object({
    name: z.string().min(1),
    duration: durationSchema,
    /**
     * Whether this effect can be Sustained — INDEPENDENT of `duration`. `extends`
     * says whether Sustaining restarts the duration clock (implicit for
     * `duration: sustained`); a fixed-duration effect with a Sustain bonus sets
     * `extends: false` and carries its extra automation in 7c.
     */
    sustain: z.object({ extends: z.boolean().optional() }).strict().optional(),
    /** WHEN a recurring effect fires/prompts. What it fires lands in 7c. */
    tickTiming: turnMomentSchema.optional(),
    /** The Layer-1 passives this effect imposes while active. */
    passives: z.array(passiveEffectSchema),
    /** Can be ended early by the Dismiss action. */
    dismissible: z.boolean().optional(),
  })
  .strict();
export type EffectTemplate = z.infer<typeof effectTemplateSchema>;

/** A live applied effect: the authored template plus the runtime identity the host stamps. */
export const appliedEffectSchema = z
  .object({
    ...effectTemplateSchema.shape,
    id: z.string().min(1),
    /** The creature that applied it — the "your" in "your next turn". */
    originId: z.string().min(1),
    /** The creature it is on. */
    bearerId: z.string().min(1),
    /**
     * When it was applied. Required to resolve "your NEXT turn" without an
     * off-by-one: an end-of-turn moment during the turn it was applied in must not
     * count. `duringTurnOf` is the creature whose turn it was (null out of combat).
     */
    appliedAt: z
      .object({ round: z.number().int().nonnegative(), duringTurnOf: z.string().min(1).nullable() })
      .strict(),
    /**
     * The link group this effect belongs to, if it was applied as part of a linked
     * set (Constrict → Grappled on the target AND Grappling on the caster).
     * Removing any member with cascade removes the whole group. The host resolves
     * an invocation's authored group LABEL into a real group id.
     */
    linkGroup: z.string().min(1).optional(),
  })
  .strict();
export type AppliedEffect = z.infer<typeof appliedEffectSchema>;

/** A turn boundary, fed by the host's combat tracker. */
export interface TurnEvent {
  when: "start" | "end";
  /** The creature whose turn is starting/ending. */
  creature: string;
  round: number;
}

/** The creature a turn moment refers to, for a given effect. */
export function momentCreature(moment: TurnMoment, effect: Pick<AppliedEffect, "originId" | "bearerId">): string {
  return moment.whose === "origin" ? effect.originId : effect.bearerId;
}

/**
 * Does this effect's recurring tick fire on this turn event? Pure matching — it
 * says only that the moment arrived, never what should happen (see the header:
 * ticks prompt, they do not resolve).
 */
export function tickFires(effect: AppliedEffect, event: TurnEvent): boolean {
  const t = effect.tickTiming;
  if (!t) return false;
  return event.when === t.when && event.creature === momentCreature(t, effect);
}

/**
 * Advance an effect's duration against a turn event, returning the (possibly
 * decremented) duration and whether it has now expired. Durations not measured in
 * turns (`unlimited`, `time`, `dailyPreparations`) never expire here — they end by
 * the host's clock, or by counteracting/Dismissing.
 */
export function advanceDuration(effect: AppliedEffect, event: TurnEvent): { duration: Duration; expired: boolean } {
  const d = effect.duration;
  switch (d.kind) {
    case "unlimited":
    case "time":
    case "dailyPreparations":
      return { duration: d, expired: false };
    case "rounds": {
      // Anchored to the ORIGIN's turn START, per the rules text.
      if (event.when !== "start" || event.creature !== effect.originId) return { duration: d, expired: false };
      const count = d.count - 1;
      return { duration: { kind: "rounds", count }, expired: count <= 0 };
    }
    case "sustained":
      // "until the end of your next turn unless you Sustain"
      return expiresAt(effect, event, { when: "end", whose: "origin" }, true);
    case "until":
      return expiresAt(effect, event, d.moment, d.next === true);
  }
}

function expiresAt(
  effect: AppliedEffect,
  event: TurnEvent,
  moment: TurnMoment,
  next: boolean,
): { duration: Duration; expired: boolean } {
  const creature = momentCreature(moment, effect);
  if (event.when !== moment.when || event.creature !== creature) return { duration: effect.duration, expired: false };
  // "your NEXT turn": the occurrence during the very turn it was applied in doesn't
  // count. (A START moment needs no such guard — that moment already passed.)
  if (next && event.round === effect.appliedAt.round && effect.appliedAt.duringTurnOf === creature) {
    return { duration: effect.duration, expired: false };
  }
  return { duration: effect.duration, expired: true };
}

/**
 * Apply the Sustain action: restart the duration clock so a `sustained` effect
 * again lasts until the end of the origin's next turn. Only durations that Sustain
 * extends are affected — an effect with a fixed duration and a Sustain *bonus* is
 * returned unchanged (its extra automation is a granted action, 7c).
 */
export function sustainEffect(
  effect: AppliedEffect,
  at: { round: number; duringTurnOf: string | null },
): AppliedEffect {
  const extendsClock = effect.duration.kind === "sustained" || effect.sustain?.extends === true;
  if (!extendsClock) return effect;
  return { ...effect, appliedAt: { round: at.round, duringTurnOf: at.duringTurnOf } };
}

/** The passives an effect contributes while active — the seam back into Layer 1. */
export function effectPassives(effects: readonly AppliedEffect[]): PassiveEffect[] {
  return effects.flatMap((e) => e.passives);
}
