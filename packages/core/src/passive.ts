// Layer 1 — the passive-effect schema and its application onto a resolved
// character. A passive effect is OUR canonical, declarative "what is currently ON
// an actor and modifies its numbers": a feat's status bonus, a rune's item bonus,
// a granted sense. This is the schema the homebrew builder emits and the Foundry
// ingest maps INTO — never Foundry's own shape (docs/effects-engine-design.md,
// "Layer 1 — Passive effect schema"). It is distinct from the Foundry-ingest
// `SheetEffects` bag in effects.ts, which is the transitional import path.
//
// APPLICATION IS HONEST ABOUT ITS BOUNDARY. `applyPassiveEffects` folds the two
// kinds that are safe on an already-resolved sheet — `modifier` (post-hoc typed
// bonuses/penalties, resolved by the existing `stackModifiers`) and `note`
// (display text) — and COLLECTS the rest into typed buckets for the layers that
// own them, rather than guessing:
//   • `proficiency` → rankGrants. Re-deriving a modifier from a raised rank needs
//     the level/progression context that produced the sheet — the content-blocked
//     orchestration (docs, "Dependencies & sequencing"). So a rank grant is
//     surfaced for the upstream builder to fold in, never applied to a total here.
//   • `grant` → grants. Senses/resistances/immunities/extra actions have no field
//     on the resolved model yet; carried for Layer 1.5.
//   • `rollAdjust` → rollAdjusts. Consumed at Layer 2 when a check resolves
//     through the degree resolver (Assurance, Fortune/Misfortune) — nothing to
//     apply to a static sheet.
//
// PURE: no I/O, no new rules math. Stacking is `stackModifiers` (effects.ts,
// from rules text); values are the shared expression evaluator (expr.ts);
// predicates are predicate.ts. So there is no rules-from-memory risk here.

import { z } from "zod";
import type { ResolvedCharacter } from "./character.js";
import { characterScope } from "./character.js";
import { evaluate, exprSchema, type Expr } from "./expr.js";
import { stackModifiers, type BonusType, type Modifier } from "./effects.js";
import { predicateHolds, predicateSchema, staticTags, type Predicate } from "./predicate.js";
import type { ProficiencyRank } from "./proficiency.js";
import { isSelector, type Selector } from "./selectors.js";

// ---------------------------------------------------------------------------
// sub-vocabularies
// ---------------------------------------------------------------------------

const bonusTypeSchema = z.enum(["circumstance", "status", "item", "untyped"]);
/** Any readable stat selector (a fixed stat or a skill slug); validated by isSelector. */
const selectorSchema = z.custom<Selector>((v) => isSelector(v), { message: "unknown stat selector" });
const rankSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const movementSchema = z.enum(["land", "fly", "swim", "climb", "burrow"]);
const senseAcuitySchema = z.enum(["precise", "imprecise", "vague"]);

/**
 * A `grant`'s payload — a structured, closed vocabulary of the non-numeric things
 * a passive effect can bestow (the doc's sense/speed/resistance/weakness/immunity/
 * trait/action list). DATA ONLY in v1: validated and carried, not resolved onto
 * the sheet (the resolved model has no senses/resistances field yet).
 */
export const grantSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sense"), name: z.string().min(1), range: z.number().int().nonnegative().optional(), acuity: senseAcuitySchema.optional() }).strict(),
  z.object({ type: z.literal("speed"), movement: movementSchema, value: z.number().int() }).strict(),
  z.object({ type: z.literal("resistance"), damageType: z.string().min(1), value: z.number().int().nonnegative(), exceptions: z.array(z.string()).optional() }).strict(),
  z.object({ type: z.literal("weakness"), damageType: z.string().min(1), value: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("immunity"), to: z.string().min(1) }).strict(),
  z.object({ type: z.literal("trait"), trait: z.string().min(1) }).strict(),
  z.object({ type: z.literal("action"), ref: z.string().min(1) }).strict(),
]);
export type Grant = z.infer<typeof grantSchema>;

/**
 * A `rollAdjust`'s payload: a one-degree shift (Assurance-style "treat as one
 * degree better/worse") or a reroll keeping the higher/lower die (PF2e Fortune /
 * Misfortune). Consumed by the Layer-2 degree resolver, never here.
 */
export const rollAdjustmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("degree"), direction: z.enum(["improve", "worsen"]) }).strict(),
  z.object({ type: z.literal("reroll"), keep: z.enum(["higher", "lower"]) }).strict(),
]);
export type RollAdjustment = z.infer<typeof rollAdjustmentSchema>;

// ---------------------------------------------------------------------------
// the passive-effect union
// ---------------------------------------------------------------------------

const modifierEffectSchema = z.object({
  kind: z.literal("modifier"),
  target: selectorSchema,
  bonusType: bonusTypeSchema,
  /** The bonus/penalty amount, as a value AST (a plain number is `{kind:"lit"}`). */
  value: exprSchema,
  when: predicateSchema.optional(),
}).strict();

// A proficiency grant is unconditional by design (a raised rank is a permanent
// property of the sheet, not momentary combat state) — no `when?`.
const proficiencyEffectSchema = z.object({
  kind: z.literal("proficiency"),
  target: selectorSchema,
  rank: rankSchema,
  /** `upgrade` raises to at least `rank` (max); `set` overrides to exactly `rank`. */
  mode: z.enum(["upgrade", "set"]),
}).strict();

const grantEffectSchema = z.object({
  kind: z.literal("grant"),
  grant: grantSchema,
  when: predicateSchema.optional(),
}).strict();

const rollAdjustEffectSchema = z.object({
  kind: z.literal("rollAdjust"),
  target: selectorSchema,
  adjust: rollAdjustmentSchema,
  when: predicateSchema.optional(),
}).strict();

const noteEffectSchema = z.object({
  kind: z.literal("note"),
  target: selectorSchema,
  text: z.string().min(1),
  when: predicateSchema.optional(),
}).strict();

/** The Layer-1 passive-effect union — the schema homebrew emits and Foundry maps into. */
export const passiveEffectSchema = z.discriminatedUnion("kind", [
  modifierEffectSchema,
  proficiencyEffectSchema,
  grantEffectSchema,
  rollAdjustEffectSchema,
  noteEffectSchema,
]);
export type PassiveEffect = z.infer<typeof passiveEffectSchema>;

export type ModifierEffect = z.infer<typeof modifierEffectSchema>;
export type ProficiencyEffect = z.infer<typeof proficiencyEffectSchema>;
export type GrantEffect = z.infer<typeof grantEffectSchema>;
export type RollAdjustEffect = z.infer<typeof rollAdjustEffectSchema>;
export type NoteEffect = z.infer<typeof noteEffectSchema>;

// ---------------------------------------------------------------------------
// application
// ---------------------------------------------------------------------------

/** A collected proficiency grant, for the upstream builder to fold into derivation. */
export interface ProficiencyGrant {
  target: Selector;
  rank: ProficiencyRank;
  mode: "upgrade" | "set";
}

/** A note-effect that passed its predicate, ready for per-stat display. */
export interface NoteEntry {
  target: Selector;
  text: string;
}

export interface PassiveOutcome {
  /**
   * The character with every predicate-passing `modifier`'s net folded into the
   * affected stat totals. A new object; the input is never mutated. Reserved
   * selectors the model does not carry (`attack`/`damage`/`initiative`) are not
   * folded (there is no field), but their modifiers still appear in `modifiers`.
   */
  character: ResolvedCharacter;
  /**
   * The predicate-passing modifiers per stat, BEFORE stacking — the "why did this
   * total change?" breakdown (mirrors `SheetEffects.statModifiers`). Stacking is
   * already reflected in `character`; this is the provenance.
   */
  modifiers: Map<Selector, Modifier[]>;
  /** `proficiency` effects — collected for the upstream builder, not folded here. */
  rankGrants: ProficiencyGrant[];
  /** `grant` effects that passed their predicate — carried for Layer 1.5. */
  grants: Grant[];
  /** `rollAdjust` effects that passed their predicate — carried for Layer 2. */
  rollAdjusts: RollAdjustEffect[];
  /** `note` effects that passed their predicate. */
  notes: NoteEntry[];
  /** Count of effects whose value expression failed to evaluate (skip-and-count). */
  skipped: number;
}

export interface PassiveContext {
  /**
   * Extra active tags unioned with the character's own static tags before
   * predicates are evaluated — the seam a combat tracker uses to add its runtime
   * tags (flanking, off-guard). Omitted on the static sheet.
   */
  tags?: Iterable<string>;
}

/**
 * Apply a set of passive effects onto a resolved character. Modifiers are stacked
 * per stat (`stackModifiers`) and folded into totals; notes are collected;
 * proficiency/grant/rollAdjust are collected into their typed buckets for the
 * layers that own them (see the module header). A modifier or its predicate that
 * fails to evaluate is skipped and counted, never guessed.
 */
export function applyPassiveEffects(
  rc: ResolvedCharacter,
  effects: readonly PassiveEffect[],
  ctx: PassiveContext = {},
): PassiveOutcome {
  const tags = staticTags(rc);
  for (const t of ctx.tags ?? []) tags.add(t);
  const scope = characterScope(rc);

  const modifiers = new Map<Selector, Modifier[]>();
  const rankGrants: ProficiencyGrant[] = [];
  const grants: Grant[] = [];
  const rollAdjusts: RollAdjustEffect[] = [];
  const notes: NoteEntry[] = [];
  let skipped = 0;

  const pushModifier = (target: Selector, mod: Modifier) => {
    const list = modifiers.get(target);
    if (list) list.push(mod);
    else modifiers.set(target, [mod]);
  };

  for (const effect of effects) {
    switch (effect.kind) {
      case "modifier": {
        if (!predicateHolds(effect.when, tags)) break;
        let value: number;
        try {
          value = evaluate(effect.value, scope, "number") as number;
        } catch {
          skipped += 1;
          break;
        }
        if (value !== 0) pushModifier(effect.target, { type: effect.bonusType, value });
        break;
      }
      case "proficiency":
        rankGrants.push({ target: effect.target, rank: effect.rank, mode: effect.mode });
        break;
      case "grant":
        if (predicateHolds(effect.when, tags)) grants.push(effect.grant);
        break;
      case "rollAdjust":
        if (predicateHolds(effect.when, tags)) rollAdjusts.push(effect);
        break;
      case "note":
        if (predicateHolds(effect.when, tags)) notes.push({ target: effect.target, text: effect.text });
        break;
    }
  }

  // Net each stat's modifiers via the PF2e stacking rules, then fold into totals.
  const deltas = new Map<Selector, number>();
  for (const [target, mods] of modifiers) {
    const net = stackModifiers(mods);
    if (net !== 0) deltas.set(target, net);
  }

  return { character: applyDeltas(rc, deltas), modifiers, rankGrants, grants, rollAdjusts, notes, skipped };
}

/**
 * Return a copy of `rc` with each selector's net delta added to its total. Clones
 * only the touched sub-objects; reserved selectors and absent skills are left
 * unfolded (their modifiers are still reported via `PassiveOutcome.modifiers`).
 */
function applyDeltas(rc: ResolvedCharacter, deltas: Map<Selector, number>): ResolvedCharacter {
  if (deltas.size === 0) return rc;
  const next: ResolvedCharacter = {
    ...rc,
    ac: { ...rc.ac },
    perception: { ...rc.perception },
    saves: { ...rc.saves },
    speeds: { ...rc.speeds },
    skills: { ...rc.skills },
    ...(rc.classDc ? { classDc: { ...rc.classDc } } : {}),
    ...(rc.spellcasting
      ? { spellcasting: rc.spellcasting.map((s) => ({ ...s, spellAttack: { ...s.spellAttack }, spellDc: { ...s.spellDc } })) }
      : {}),
  };

  for (const [target, delta] of deltas) {
    switch (target) {
      case "ac":
        next.ac.value += delta;
        break;
      case "fortitude":
      case "reflex":
      case "will":
        next.saves[target] = { ...next.saves[target], modifier: next.saves[target].modifier + delta };
        break;
      case "perception":
        next.perception.modifier += delta;
        break;
      case "class-dc":
        if (next.classDc) next.classDc.modifier += delta;
        break;
      case "spell-dc":
        if (next.spellcasting?.[0]) next.spellcasting[0].spellDc.modifier += delta;
        break;
      case "spell-attack":
        if (next.spellcasting?.[0]) next.spellcasting[0].spellAttack.modifier += delta;
        break;
      case "speed:land":
        next.speeds.land += delta;
        break;
      // Reserved selectors carry no field on the resolved model — not folded.
      case "attack":
      case "damage":
      case "initiative":
        break;
      default: {
        // A skill (or lore) slug — folded only if the character has that entry.
        const sk = next.skills[target];
        if (sk) next.skills[target] = { ...sk, modifier: sk.modifier + delta };
        break;
      }
    }
  }
  return next;
}
