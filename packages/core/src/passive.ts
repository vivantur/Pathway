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
//     through the degree resolver — nothing to apply to a static sheet. Turn the
//     bucket into resolver input with `degreeAdjustmentsFor` (below).
//
// PURE: no I/O, no new rules math. Stacking is `stackModifiers` (effects.ts,
// from rules text); values are the shared expression evaluator (expr.ts);
// predicates are predicate.ts. So there is no rules-from-memory risk here.

import { z } from "zod";
import type { ResolvedCharacter } from "./character.js";
import { characterScope } from "./character.js";
import { DEGREES, type DegreeAdjustment } from "./degree.js";
import { evaluate, exprSchema, type Expr } from "./expr.js";
import { stackModifiers, type BonusType, type EffectContext, type Modifier, type SheetEffects } from "./effects.js";
import { describePredicate, predicateHolds, predicateSchema, staticTags, type Predicate } from "./predicate.js";
import type { ProficiencyRank } from "./proficiency.js";
import {
  isScopedSelector,
  isSelector,
  isSkillSlug,
  type ScopedSelector,
  type Selector,
} from "./selectors.js";
import { RANK_LABEL } from "./stats.js";

// ---------------------------------------------------------------------------
// sub-vocabularies
// ---------------------------------------------------------------------------

const bonusTypeSchema = z.enum(["circumstance", "status", "item", "untyped"]);
/** Any readable stat selector (a fixed stat or a skill slug); validated by isSelector. */
const selectorSchema = z.custom<Selector>((v) => isSelector(v), { message: "unknown stat selector" });
const rankSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

/**
 * A granted rank: a literal 0–4, or an EXPRESSION for the ranks that vary by level
 * (Canny Acumen grants expert, or master at 17th). Decision 1 — "every value IS an
 * expression" — applied to `rank`, and for the same reason it was applied to a
 * grant's numeric payload: the rank is authored/ingested with no character in hand,
 * so a literal would make a level-scaled rank literally unrepresentable.
 *
 * The literal stays first in the union so all existing stored data (every rank in
 * the corpus but one) validates unchanged and reads back as a plain number.
 */
const rankValueSchema = z.union([rankSchema, exprSchema]);
export type RankValue = z.infer<typeof rankValueSchema>;

/**
 * Resolve a granted rank VALUE against a level. Distinct from character.ts's
 * `resolveRank`, which reads a rank OFF a character — this evaluates one authored
 * BY content. Throws when it lands outside 0–4 rather than clamping: a rank the
 * model can't represent is a content bug, and callers count it (`skipped`) instead
 * of applying a guess.
 */
export function resolveRankValue(rank: RankValue, level: number): ProficiencyRank {
  if (typeof rank === "number") return rank;
  const n = evaluate(rank, { vars: { level } }, "number") as number;
  if (!Number.isInteger(n) || n < 0 || n > 4) throw new Error(`rank evaluated to ${n}, outside 0–4`);
  return n as ProficiencyRank;
}

const movementSchema = z.enum(["land", "fly", "swim", "climb", "burrow"]);
const senseAcuitySchema = z.enum(["precise", "imprecise", "vague"]);
export type SenseAcuity = z.infer<typeof senseAcuitySchema>;

/**
 * A `grant`'s payload — a structured, closed vocabulary of the non-numeric things
 * a passive effect can bestow (the doc's sense/speed/resistance/weakness/immunity/
 * trait/action list). DATA ONLY in v1: validated and carried, not resolved onto
 * the sheet (the resolved model has no senses/resistances field yet).
 *
 * NUMERIC PAYLOADS ARE EXPRESSIONS (`exprSchema`), not plain numbers, exactly like
 * `modifier`'s value — per the doc's decision 1, every value IS an expression under
 * the hood and a plain number is just `{kind:"lit"}`. This is not speculative
 * generality: "fire resistance equal to half your level" is common content, and a
 * grant is authored/ingested with NO character in hand, so there is nothing to
 * evaluate against at write time. A number here would make level-scaled grants
 * literally unrepresentable. Evaluation happens per character, at read time.
 */
export const grantSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sense"), name: z.string().min(1), range: z.number().int().nonnegative().optional(), acuity: senseAcuitySchema.optional() }).strict(),
  z.object({ type: z.literal("speed"), movement: movementSchema, value: exprSchema }).strict(),
  z.object({ type: z.literal("resistance"), damageType: z.string().min(1), value: exprSchema, exceptions: z.array(z.string()).optional() }).strict(),
  z.object({ type: z.literal("weakness"), damageType: z.string().min(1), value: exprSchema }).strict(),
  z.object({ type: z.literal("immunity"), to: z.string().min(1) }).strict(),
  z.object({ type: z.literal("trait"), trait: z.string().min(1) }).strict(),
  z.object({ type: z.literal("action"), ref: z.string().min(1) }).strict(),
]);
export type Grant = z.infer<typeof grantSchema>;

/**
 * A `rollAdjust`'s payload: a BLANKET one-degree shift (Assurance-style "treat as
 * one degree better/worse"), a CONDITIONAL per-degree rewrite, or a reroll keeping
 * the higher/lower die (PF2e Fortune / Misfortune). Consumed by the Layer-2 degree
 * resolver, never here.
 *
 * `degreeMap` exists because most PF2e degree prose is conditional on the incoming
 * result — "when you roll a success …, you get a critical success instead" — which
 * a blanket shift cannot say without lying about the other three degrees. It also
 * subsumes the "clamp to a floor" shape (Forager) without a third primitive. See
 * `DegreeAdjustment` in degree.ts for the encodings and the multi-effect ordering.
 *
 * The map must be non-empty: a `degreeMap` that rewrites nothing is content that
 * failed to say anything, and should surface as a gap rather than validate silently.
 */
export const rollAdjustmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("degree"), direction: z.enum(["improve", "worsen"]) }).strict(),
  z
    .object({
      type: z.literal("degreeMap"),
      map: z
        .partialRecord(z.enum(DEGREES), z.enum(DEGREES))
        .refine((m) => Object.keys(m).length > 0, { message: "degreeMap must rewrite at least one degree" }),
    })
    .strict(),
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
  /** A literal 0–4, or an expression for a level-scaled rank. See `resolveRankValue`. */
  rank: rankValueSchema,
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
// authored player choices
// ---------------------------------------------------------------------------
//
// Some content does not know its own effect until a player picks something: Canny
// Acumen raises a save OR Perception; Skill Training trains a skill of your choice.
// The CHOICE is the player's, but the OPTIONS and what each one does are fixed by
// the content — so they are resolved at ingest and stored, exactly like any other
// effect. Only the selection happens at runtime.
//
// This is what keeps the Foundry boundary closed. Their encoding of the same idea
// (a `ChoiceSet` whose flag is string-substituted into an `ActiveEffectLike` path,
// `system.skills.{item|flags.system.rulesSelections.skillOne}.rank`) is a runtime
// template-substitution engine. Ours is a list of options, each holding finished
// `PassiveEffect`s. The interpretation happens once, at ingest, in foundry.ts.

const effectChoiceOptionSchema = z
  .object({
    /** Stored in the character's state to record the pick. OUR vocabulary. */
    value: z.string().min(1),
    /** What the player sees in the dropdown. */
    label: z.string().min(1),
    /** What picking this option does — already-finished effects, resolved at ingest. */
    effects: z.array(passiveEffectSchema).min(1),
  })
  .strict();

export const effectChoiceSchema = z
  .object({
    /** Key the selection is stored under, unique within the entity. */
    flag: z.string().min(1),
    /** Short dropdown label ("Proficiency", "Skill", "Save"). */
    prompt: z.string().min(1),
    options: z.array(effectChoiceOptionSchema).min(1),
  })
  .strict();
export type EffectChoice = z.infer<typeof effectChoiceSchema>;
export type EffectChoiceOption = z.infer<typeof effectChoiceOptionSchema>;

/**
 * The effects a set of authored choices yields, given the player's stored picks
 * (`flag → option value`). An absent or unrecognized pick contributes nothing —
 * an unmade choice is not an error, it is simply not yet made.
 */
export function resolveChoiceEffects(
  choices: readonly EffectChoice[] | undefined,
  picks: Readonly<Record<string, string>> | undefined,
): PassiveEffect[] {
  if (!choices?.length || !picks) return [];
  const out: PassiveEffect[] = [];
  for (const choice of choices) {
    const picked = picks[choice.flag];
    if (!picked) continue;
    const option = choice.options.find((o) => o.value === picked);
    if (option) out.push(...option.effects);
  }
  return out;
}

// ---------------------------------------------------------------------------
// collection into the derivation bag
// ---------------------------------------------------------------------------
//
// `collectPassiveSheetEffects` is the sibling of `applyPassiveEffects`, and the two
// exist because there are two DIFFERENT moments to consume a passive effect:
//
//   • applyPassiveEffects — POST-hoc. Folds modifiers onto an already-resolved
//     sheet. Cannot apply a `proficiency` grant, because a raised rank changes the
//     derivation that produced the sheet.
//   • collectPassiveSheetEffects (this one) — PRE-derivation. Gathers effects into
//     the flat `SheetEffects` bag a builder consumes WHILE deriving, so rank grants
//     land before proficiency is computed rather than after.
//
// It replaces `collectSheetEffects`, which read FOUNDRY's rule elements at runtime.
// Same output contract, so `deriveCharacter` is untouched — the only change is the
// input: OUR `PassiveEffect[]`, mapped at ingest, instead of their shape.
//
// The broadcast selectors are gone by construction: Foundry's `saving-throw` and
// `skill-check` fan out to the individual stats AT INGEST (foundry.ts), so a caller
// gathers `fortitude`, not `saving-throw` + `fortitude`.

/** Human label for a selector, for provenance summaries. */
function selectorLabel(target: Selector): string {
  switch (target) {
    case "ac":
      return "AC";
    case "hp":
      return "HP";
    case "speed:land":
      return "Speed";
    case "class-dc":
      return "class DC";
    case "spell-dc":
      return "spell DC";
    case "spell-attack":
      return "spell attack";
    default:
      if (isScopedSelector(target)) return scopedSelectorLabel(target);
      return target.replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/**
 * Human label for a scoped attack/damage selector — `damage:strike:melee` reads
 * as "melee Strike damage", not "Damage:Strike:Melee". Provenance summaries are
 * shown to players on the sheet, so a raw selector string leaking through would
 * be a visible defect.
 */
function scopedSelectorLabel(target: ScopedSelector): string {
  const [base, ...segments] = target.split(":");
  const qualifiers: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    switch (seg) {
      case "strike":
        qualifiers.push("Strike");
        break;
      case "group":
        qualifiers.push(`${segments[++i]} weapon`);
        break;
      case "weapon":
        qualifiers.push(String(segments[++i]));
        break;
      default:
        // melee / ranged / unarmed read naturally as bare adjectives.
        qualifiers.push(seg);
        break;
    }
  }
  const noun = base === "attack" ? "attack rolls" : "damage";
  return qualifiers.length > 0 ? `${qualifiers.join(" ")} ${noun}` : noun;
}

/**
 * Gather a character's chosen items' passive effects into the flat sheet bag a
 * builder derives from. `itemEffects` is one effect array per chosen feat/feature;
 * `labels[i]` names item `i` for the attributed `applied` list.
 *
 * CONDITIONAL effects (`when`) are never folded into a total — predicates evaluate
 * against a roll context and there is none at derivation time, so applying one
 * would turn a situational bonus into a permanent one. A conditional `modifier` is
 * instead SURFACED in `conditional` for display; conditional effects of the other
 * kinds have no display form here and are counted in `skipped`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO — each counted in `skipped`, never guessed:
 *   • `grant` (senses/resistances/speeds) — the derived sheet has no field for them.
 *   • `rollAdjust` — Layer 2 consumes it at a check; it is not a sheet number.
 * `note` effects are display text, not sheet numbers: ignored here, not counted.
 */
/**
 * The variable scope a COLLECT-time value expression may read: `level` + the ability mods,
 * under the same names `characterNamespace` uses, so `strengthMod` resolves here exactly as
 * it does under `applyPassiveEffects`. Derived stats are deliberately absent — at collect
 * (pre-derivation) time they don't exist yet, and a value referencing one would be circular.
 */
function collectVars(ctx: EffectContext): Record<string, number> {
  const m = ctx.abilityMods;
  if (!m) return { level: ctx.level };
  return { level: ctx.level, strengthMod: m.str, dexterityMod: m.dex, constitutionMod: m.con, intelligenceMod: m.int, wisdomMod: m.wis, charismaMod: m.cha };
}

export function collectPassiveSheetEffects(
  itemEffects: readonly (readonly PassiveEffect[])[],
  ctx: EffectContext,
  labels: readonly string[] = [],
): SheetEffects {
  const out: SheetEffects = {
    hpBonus: 0,
    skillRanks: new Map(),
    saveRanks: new Map(),
    perceptionRank: null,
    statModifiers: new Map(),
    applied: [],
    conditional: [],
    skipped: 0,
  };

  const raise = (map: Map<string, ProficiencyRank>, key: string, rank: ProficiencyRank) => {
    const cur = map.get(key) ?? 0;
    if (rank > cur) map.set(key, rank);
  };

  itemEffects.forEach((effects, itemIndex) => {
    const source = labels[itemIndex] ?? "";
    const note = (stat: string, summary: string) => out.applied.push({ source, stat, summary });
    if (!Array.isArray(effects)) return;

    for (const effect of effects) {
      // A CONDITIONAL effect can never change a sheet TOTAL — predicates evaluate
      // against a roll context, and this is the pre-derivation collector, so there
      // isn't one. But "cannot fold it in" is not "throw it away": a situational
      // `modifier` is carried to `conditional` with its condition rendered, because
      // that is exactly how a player uses one (read it, apply it at the table).
      // The other kinds have no display form here, so they stay counted.
      if (effect.when !== undefined) {
        if (effect.kind === "modifier") {
          let value: number;
          try {
            value = evaluate(effect.value, { vars: collectVars(ctx) }, "number") as number;
          } catch {
            out.skipped += 1;
            continue;
          }
          if (value === 0) continue;
          out.conditional.push({
            source,
            stat: effect.target,
            summary: `${value >= 0 ? "+" : ""}${value} ${effect.bonusType} to ${selectorLabel(effect.target)}`,
            condition: describePredicate(effect.when),
          });
          continue;
        }
        out.skipped += 1;
        continue;
      }

      switch (effect.kind) {
        case "modifier": {
          let value: number;
          try {
            value = evaluate(effect.value, { vars: collectVars(ctx) }, "number") as number;
          } catch {
            out.skipped += 1;
            continue;
          }
          if (value === 0) continue;
          // HP is not a stacked stat on the derived sheet — the builder takes a
          // single flat `bonusHp`. Untyped bonuses all stack, so they sum; a TYPED
          // HP bonus has nowhere to go without changing derivation, so it is
          // counted rather than silently folded in as if untyped.
          if (effect.target === "hp") {
            if (effect.bonusType !== "untyped") {
              out.skipped += 1;
              continue;
            }
            out.hpBonus += value;
            note("hp", `${value >= 0 ? "+" : ""}${value} HP`);
            continue;
          }
          const mod: Modifier = { type: effect.bonusType, value };
          const list = out.statModifiers.get(effect.target);
          if (list) list.push(mod);
          else out.statModifiers.set(effect.target, [mod]);
          note(effect.target, `${value >= 0 ? "+" : ""}${value} ${effect.bonusType} to ${selectorLabel(effect.target)}`);
          continue;
        }
        case "proficiency": {
          // `set` would need to LOWER a rank as well as raise it, which this bag
          // (a highest-wins map) cannot express. Only `upgrade` is applied.
          if (effect.mode !== "upgrade") {
            out.skipped += 1;
            continue;
          }
          const target: Selector = effect.target;
          let rank: ProficiencyRank;
          try {
            rank = resolveRankValue(effect.rank, ctx.level);
          } catch {
            out.skipped += 1; // a level-scaled rank we can't resolve — never guessed
            continue;
          }
          if (target === "perception") {
            if (out.perceptionRank === null || rank > out.perceptionRank) out.perceptionRank = rank;
            note("perception", `${RANK_LABEL[rank]} Perception`);
          } else if (target === "fortitude" || target === "reflex" || target === "will") {
            raise(out.saveRanks, target, rank);
            note(target, `${RANK_LABEL[rank]} ${selectorLabel(target)}`);
          } else if (isSkillSlug(target)) {
            raise(out.skillRanks, target, rank);
            note(target, `${RANK_LABEL[rank]} in ${selectorLabel(target)}`);
          } else {
            out.skipped += 1; // a rank on a stat the bag has no slot for
          }
          continue;
        }
        case "grant":
        case "rollAdjust":
          out.skipped += 1;
          continue;
        case "note":
          continue;
      }
    }
  });

  return out;
}

// ---------------------------------------------------------------------------
// trait collection (senses & resistances)
// ---------------------------------------------------------------------------

/** A special sense granted to the character (darkvision, scent, tremorsense, …). */
export interface GrantedSense {
  /** Sense name, e.g. "darkvision", "low-light-vision", "scent", "wavesense". */
  type: string;
  /** Acuity, when the sense specifies one. */
  acuity?: SenseAcuity;
  /** Range in feet, when the sense is limited. */
  range?: number;
  /** Attribution (the ancestry/heritage/feat that granted it). */
  source: string;
}

/** A damage resistance granted to the character, resolved at the character's level. */
export interface GrantedResistance {
  /** Damage type resisted, e.g. "cold", "fire", "poison". */
  type: string;
  /** Resistance amount at the character's level (always ≥ 1). */
  value: number;
  /** Attribution (the ancestry/heritage/feat that granted it). */
  source: string;
}

export interface CharacterTraits {
  senses: GrantedSense[];
  resistances: GrantedResistance[];
  /** Count of sense/resistance grants that couldn't be resolved. */
  skipped: number;
}

/**
 * How "strong" a sense acuity is, for DISPLAY DEDUPING only — this is not a rules
 * claim, it is the heuristic that decides which of two same-named senses to show.
 * An absent acuity ranks lowest so an explicit one always wins.
 */
const ACUITY_RANK: Record<string, number> = { precise: 3, imprecise: 2, vague: 1 };

/**
 * Resolve the special senses and damage resistances granted by a character's items
 * (an ancestry's effects, a heritage's, …). `itemEffects` is one effect array per
 * item; `labels[i]` attributes item `i`.
 *
 * This is the third consumer of `PassiveEffect[]`, alongside `applyPassiveEffects`
 * and `collectPassiveSheetEffects`, and it exists for the same reason they do — it
 * reads a DIFFERENT slice at a different moment. Both of those deliberately punt on
 * `grant` (the derived sheet has no senses/resistances field); this one consumes
 * exactly that kind and nothing else.
 *
 * Attribution comes from the caller, not the effect: provenance lives on the content
 * envelope, never on a passive effect (design doc, "Layer 1").
 *
 * Senses dedupe by name keeping the more useful (by acuity, then longer range);
 * resistances dedupe by type keeping the highest value. CONDITIONAL grants (`when`)
 * are skipped, not applied — a situational resistance shown as permanent is a wrong
 * sheet, which is worse than an absent one.
 */
export function collectTraits(
  itemEffects: readonly (readonly PassiveEffect[])[],
  ctx: EffectContext,
  labels: readonly string[] = [],
): CharacterTraits {
  const senses = new Map<string, GrantedSense>();
  const resistances = new Map<string, GrantedResistance>();
  let skipped = 0;

  const senseBetter = (a: GrantedSense, b: GrantedSense): boolean => {
    const ra = ACUITY_RANK[a.acuity ?? ""] ?? 0;
    const rb = ACUITY_RANK[b.acuity ?? ""] ?? 0;
    if (ra !== rb) return ra > rb;
    // Unlimited range (undefined) beats any finite range; otherwise longer wins.
    if ((a.range ?? Infinity) !== (b.range ?? Infinity)) return (a.range ?? Infinity) > (b.range ?? Infinity);
    return false;
  };

  itemEffects.forEach((effects, itemIndex) => {
    const source = labels[itemIndex] ?? "";
    if (!Array.isArray(effects)) return;

    for (const effect of effects) {
      if (effect.kind !== "grant") continue; // another collector's slice, not a miss
      if (effect.when !== undefined) {
        skipped += 1;
        continue;
      }
      const grant = effect.grant;

      if (grant.type === "sense") {
        const next: GrantedSense = {
          type: grant.name,
          source,
          ...(grant.acuity ? { acuity: grant.acuity } : {}),
          ...(grant.range ? { range: grant.range } : {}),
        };
        const cur = senses.get(grant.name);
        if (!cur || senseBetter(next, cur)) senses.set(grant.name, next);
        continue;
      }

      if (grant.type === "resistance") {
        // A grant's numeric payload is an EXPRESSION ("resistance equal to half your
        // level"), evaluated per character at read time — which is this moment.
        let value: number;
        try {
          value = evaluate(grant.value, { vars: collectVars(ctx) }, "number") as number;
        } catch {
          skipped += 1;
          continue;
        }
        value = Math.floor(value);
        if (value < 1) continue; // a resistance that rounds to 0 doesn't apply yet
        const cur = resistances.get(grant.damageType);
        if (!cur || value > cur.value) resistances.set(grant.damageType, { type: grant.damageType, value, source });
        continue;
      }
      // speed/weakness/immunity/trait/action grants are carried by the model but
      // have no home on this view yet; they are not this collector's slice.
    }
  });

  // Darkvision supersedes low-light vision — it does everything low-light does, so
  // listing both is noise when a heritage upgrades an ancestry's vision. Like the
  // acuity ranking above this is a DISPLAY rule, not a rules-text claim; it lives
  // here because both the builder and the imported-character sheet need it, and a
  // sense rule implemented twice is the exact duplication core exists to prevent.
  let senseList = [...senses.values()];
  if (senseList.some((s) => s.type === "darkvision")) {
    senseList = senseList.filter((s) => s.type !== "low-light-vision");
  }

  const byType = (a: { type: string }, b: { type: string }) => a.type.localeCompare(b.type);
  return {
    senses: senseList.sort(byType),
    resistances: [...resistances.values()].sort(byType),
    skipped,
  };
}

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
        try {
          rankGrants.push({ target: effect.target, rank: resolveRankValue(effect.rank, rc.level), mode: effect.mode });
        } catch {
          skipped += 1;
        }
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
 * Select the degree adjustments that apply to a roll of `target`, from a creature's
 * collected `rollAdjusts` — the bridge from the Layer-1 bucket to the Layer-2 degree
 * resolver (`resolveCheck` / `rollCheck` take the result as `adjustments`).
 *
 * Two things it deliberately drops:
 *   • Effects aimed at a DIFFERENT stat. Adaptive Vision's "+1 to saving throws
 *     against visual effects" fans out to one effect per save, so a Fortitude roll
 *     must not pick up the Reflex one.
 *   • `reroll` payloads (Fortune/Misfortune). A reroll operates on DICE, not on the
 *     degree; rendering one as a degree shift would be a different mechanic wearing
 *     this one's clothes. It stays unwired until it is wired honestly.
 *
 * CONDITIONS ARE THE CALLER'S JOB. `when` predicates were already evaluated when the
 * bucket was collected, against whatever tags `applyPassiveEffects` was given. A
 * roll-conditional adjustment ("against visual effects") therefore only survives if
 * the caller passed the roll's tags via `PassiveContext.tags` — see `rollTags` in
 * predicate.ts. Collect with static tags alone and Adaptive Vision is correctly
 * absent, because on a save against something non-visual it does not apply.
 */
export function degreeAdjustmentsFor(
  rollAdjusts: readonly RollAdjustEffect[],
  target: Selector,
): DegreeAdjustment[] {
  const out: DegreeAdjustment[] = [];
  for (const effect of rollAdjusts) {
    if (effect.target !== target) continue;
    if (effect.adjust.type === "degree") out.push(effect.adjust.direction);
    else if (effect.adjust.type === "degreeMap") out.push({ map: effect.adjust.map });
  }
  return out;
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
      // Reserved: derived at play time, carries no field on the model.
      case "initiative":
        break;
      default: {
        // Scoped attack/damage modifiers are NEVER folded into the resolved
        // character: they apply to some strikes and not others, so there is no
        // character-wide total to fold them into. They are collected and applied
        // by the strike pipeline instead (docs/strikes-and-weapons.md). Skipping
        // them here is the correct behavior, not a gap.
        if (isScopedSelector(target)) break;
        // A skill (or lore) slug — folded only if the character has that entry.
        const sk = next.skills[target];
        if (sk) next.skills[target] = { ...sk, modifier: sk.modifier + delta };
        break;
      }
    }
  }
  return next;
}
