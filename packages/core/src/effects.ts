// Effects engine — turn the machine-readable rule elements carried on a
// character's chosen feats (ingested from the Foundry pf2e system) into the
// concrete sheet adjustments those feats grant.
//
// SCOPE (increment 1): the two static-sheet effects that need no bonus-stacking
// rules, so they can be applied with confidence today:
//   - HP bonuses      — unconditional `FlatModifier` on the `hp` selector. Every
//                       such modifier in the corpus is untyped, and untyped
//                       bonuses simply add, so we sum them. (Toughness → +level.)
//   - proficiency ups — fixed-path `ActiveEffectLike` "upgrade" of a skill / save
//                       / Perception rank. A rank is the highest you've been
//                       granted, so we take the max — exactly how the rest of the
//                       engine already treats proficiency.
//
// Deliberately NOT handled here (they require the PF2e bonus & penalty *stacking*
// rules, which must come from pasted rules text, or a player CHOICE we don't yet
// store): typed FlatModifiers on AC/saves/skills/strikes, and ChoiceSet-driven
// grants (paths containing `{item|…}` / values referencing a selection).
//
// The evaluator only understands the bounded expression grammar the corpus
// actually uses for these two effects; anything outside it (references to other
// proficiencies, choice selections, infix arithmetic) throws and the effect is
// skipped and counted, never guessed.

import { evaluate, parseExpr } from "./expr.js";
import type { ProficiencyRank } from "./proficiency.js";
import { isSkillSlug } from "./selectors.js";
import { RANK_LABEL } from "./stats.js";

/** A Foundry rule element. Only the fields we read are typed; the rest is open. */
export interface RuleElement {
  key: string;
  [field: string]: unknown;
}

// ---------------------------------------------------------------------------
// PF2e bonus & penalty stacking
// ---------------------------------------------------------------------------
//
// Implemented verbatim from the Player Core "Bonuses and Penalties" rules
// (corroborated against Archive of Nethys "Bonuses"/"Penalties", ID 2281/2282):
//
//   Bonuses come in three types — circumstance, status, item. (There are no
//   untyped bonuses in the rules.) If you have more than one bonus of the same
//   type, you use only the HIGHEST. Bonuses of different types all add together.
//
//   Penalties come in the same three types plus UNTYPED. For each *typed*
//   penalty, if you have more than one of the same type you use only the WORST.
//   Penalties of different types all add together. Untyped penalties are the
//   exception: you always add ALL of them together rather than taking the worst.
//
// Data note: the Foundry corpus occasionally tags a *bonus* as "untyped" (which
// the rules say shouldn't exist). Such bonuses are authored to always apply, so
// we stack them — matching how the source system evaluates them.

export type BonusType = "circumstance" | "status" | "item" | "untyped";

export interface Modifier {
  type: BonusType;
  /** Positive = bonus, negative = penalty. Zero contributes nothing. */
  value: number;
}

/**
 * Net modifier from a set of typed bonuses/penalties, per the PF2e stacking
 * rules above. Bonuses and penalties are resolved independently and summed.
 */
export function stackModifiers(mods: Modifier[]): number {
  // Highest bonus per typed category; untyped bonuses all stack.
  const bestBonus: Record<string, number> = {};
  let untypedBonus = 0;
  // Worst (most negative) penalty per typed category; untyped penalties all stack.
  const worstPenalty: Record<string, number> = {};
  let untypedPenalty = 0;

  for (const m of mods) {
    if (!m || !Number.isFinite(m.value) || m.value === 0) continue;
    if (m.value > 0) {
      if (m.type === "untyped") untypedBonus += m.value;
      else bestBonus[m.type] = Math.max(bestBonus[m.type] ?? 0, m.value);
    } else {
      if (m.type === "untyped") untypedPenalty += m.value;
      else worstPenalty[m.type] = Math.min(worstPenalty[m.type] ?? 0, m.value);
    }
  }

  const sum = (o: Record<string, number>) => Object.values(o).reduce((s, n) => s + n, 0);
  return sum(bestBonus) + untypedBonus + sum(worstPenalty) + untypedPenalty;
}

export interface EffectContext {
  /** Character level — the only actor value the supported expressions reference. */
  level: number;
}

/** A proficiency-rank grant resolved from a feat. */
export interface RankGrant {
  kind: "skill" | "save" | "perception";
  /** Skill id ("athletics") or save id ("fortitude"); "perception" for Perception. */
  key: string;
  rank: ProficiencyRank;
}

/**
 * One resolved sheet adjustment, attributed to its source, for "why did this
 * change?" display. `stat` is the affected stat key ("hp", "perception", a skill
 * slug, …); `summary` is a ready-to-show phrase ("+5 HP", "Trained in Thievery",
 * "+2 circumstance to Perception").
 *
 * NOT to be confused with `AppliedEffect` in applied.ts — that is the Layer-1.5
 * combat entity (the doc's "applied effect"). This is a display record from the
 * transitional Foundry-ingest path.
 */
export interface EffectProvenance {
  source: string;
  stat: string;
  summary: string;
}

export interface SheetEffects {
  /** Total flat HP bonus (summed untyped `hp` FlatModifiers). */
  hpBonus: number;
  /** Highest granted rank per skill id. */
  skillRanks: Map<string, ProficiencyRank>;
  /** Highest granted rank per save id (fortitude/reflex/will). */
  saveRanks: Map<string, ProficiencyRank>;
  /** Highest granted Perception rank, if any. */
  perceptionRank: ProficiencyRank | null;
  /**
   * Typed bonus/penalty modifiers to combine per stat, keyed by selector:
   * `ac`, `saving-throw`, `fortitude`/`reflex`/`will`, `perception`,
   * `skill-check`, an individual skill slug, or `land-speed`. The consumer
   * gathers the relevant selectors for a stat and runs them through
   * `stackModifiers`. (Raw lists — stacking is applied at use, once the stat's
   * own item bonuses are folded in, so item bonuses don't double-count.)
   */
  statModifiers: Map<string, Modifier[]>;
  /** Every applied effect, attributed to its source, for provenance display. */
  applied: EffectProvenance[];
  /**
   * Count of rule elements that would affect the sheet but fall outside this
   * increment's scope (choice-driven, unparseable value, strikes, ability/
   * proficiency-typed). Kept for reporting so silently-skipped effects are
   * visible, never hidden.
   */
  skipped: number;
}

// ---------------------------------------------------------------------------
// value expression evaluator
// ---------------------------------------------------------------------------
//
// Effect values in the corpus are a number, an integer string, `@actor.level`,
// or a function-call expression like `ternary(gte(@actor.level,13),2,1)`. Parsing
// and evaluation live in the shared expression language (expr.ts) — one
// implementation for both the ingest path here and the effect engine. This is a
// thin adapter: it binds the single actor variable this path exposes
// (`@actor.level` → `level`) and coerces the result to a number.

/** Evaluate a supported value expression to a number, or throw if unsupported. */
export function evalNumeric(expr: unknown, ctx: EffectContext): number {
  if (typeof expr === "number") return expr;
  if (typeof expr !== "string") throw new Error(`unsupported value ${JSON.stringify(expr)}`);
  return evaluate(parseExpr(expr.trim()), { vars: { level: ctx.level } }, "number") as number;
}

// ---------------------------------------------------------------------------
// effect collection
// ---------------------------------------------------------------------------

/** A rule element is conditional (not always-on) if it carries a non-empty predicate. */
function isConditional(rule: RuleElement): boolean {
  const p = rule.predicate;
  return Array.isArray(p) && p.length > 0;
}

/** Clamp any evaluated rank into the 0–4 proficiency range. */
function toRank(n: number): ProficiencyRank | null {
  const r = Math.round(n);
  return r >= 0 && r <= 4 ? (r as ProficiencyRank) : null;
}

// Foundry-ingest FlatModifier selectors this increment applies to the static
// sheet. These are the names Foundry's rule elements carry (`saving-throw`,
// `land-speed`, `skill-check`) — an import vocabulary, distinct from the
// resolved-read `Selector` namespace in selectors.ts. The 16 skill slugs ARE
// shared between the two, so they come from there (`isSkillSlug`); a
// `skill-check` FlatModifier hits all of them, a skill-slug selector hits one.
const STAT_SELECTORS = new Set(["ac", "saving-throw", "fortitude", "reflex", "will", "perception", "skill-check", "land-speed"]);

/** Which stat-modifier bucket(s) a FlatModifier selector maps to, if any. */
function statBucketFor(selector: unknown): string | null {
  if (typeof selector !== "string") return null;
  if (STAT_SELECTORS.has(selector) || isSkillSlug(selector)) return selector;
  return null;
}

const titleCase = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Human label for a stat bucket, for provenance summaries. */
function statLabel(bucket: string): string {
  switch (bucket) {
    case "ac": return "AC";
    case "saving-throw": return "saves";
    case "fortitude": return "Fortitude";
    case "reflex": return "Reflex";
    case "will": return "Will";
    case "perception": return "Perception";
    case "skill-check": return "skill checks";
    case "land-speed": return "Speed";
    default: return titleCase(bucket); // a skill slug
  }
}

/** The stacking type for a modifier, or null if it's a base-calc type we skip. */
function modifierType(rawType: unknown): BonusType | null {
  if (rawType === "circumstance" || rawType === "status" || rawType === "item") return rawType;
  // Missing type or "untyped" → untyped. "ability"/"proficiency"/etc. are part of
  // the base statistic already (attribute mod + proficiency) — not stacked here.
  if (rawType == null || rawType === "untyped") return "untyped";
  return null;
}

// Rule-element kinds that change the static sheet but are deferred to a later
// increment; counted toward `skipped` so deferred coverage is measurable.
const DEFERRED_SHEET_KINDS = new Set([
  "BaseSpeed",
  "Sense",
  "Resistance",
  "Weakness",
  "Immunity",
  "MartialProficiency",
  "CreatureSize",
  "DamageDice",
]);

const SKILL_RANK_PATH = /^system\.skills\.([a-z]+)\.rank$/;
const SAVE_RANK_PATH = /^system\.saves\.(fortitude|reflex|will)\.rank$/;
const PERCEPTION_RANK_PATH = /^system\.(?:attributes\.)?perception\.rank$/;

/**
 * Resolve every in-scope sheet effect from a set of chosen items' rule arrays.
 * `itemRules` is one rule-element array per chosen feat/feature; `labels[i]` is
 * the display name of item `i` (for the attributed `applied` list — pass the
 * feat/feature names). Labels are optional so existing callers/tests still work.
 */
export function collectSheetEffects(
  itemRules: RuleElement[][],
  ctx: EffectContext,
  labels: string[] = [],
): SheetEffects {
  const effects: SheetEffects = {
    hpBonus: 0,
    skillRanks: new Map(),
    saveRanks: new Map(),
    perceptionRank: null,
    statModifiers: new Map(),
    applied: [],
    skipped: 0,
  };

  const raise = (map: Map<string, ProficiencyRank>, key: string, rank: ProficiencyRank) => {
    const cur = map.get(key) ?? 0;
    if (rank > cur) map.set(key, rank);
  };
  const addModifier = (bucket: string, mod: Modifier) => {
    const list = effects.statModifiers.get(bucket);
    if (list) list.push(mod);
    else effects.statModifiers.set(bucket, [mod]);
  };

  itemRules.forEach((rules, itemIndex) => {
    const source = labels[itemIndex] ?? "";
    const note = (stat: string, summary: string) => effects.applied.push({ source, stat, summary });
    if (!Array.isArray(rules)) return;
    for (const rule of rules) {
      if (!rule || typeof rule.key !== "string" || rule.ignored) continue;

      // --- HP: unconditional untyped FlatModifier on the hp selector ---
      if (rule.key === "FlatModifier" && rule.selector === "hp") {
        if (isConditional(rule) || (typeof rule.type === "string" && rule.type !== "untyped")) {
          effects.skipped += 1;
          continue;
        }
        try {
          const v = evalNumeric(rule.value, ctx);
          effects.hpBonus += v;
          if (v !== 0) note("hp", `${v >= 0 ? "+" : ""}${v} HP`);
        } catch {
          effects.skipped += 1;
        }
        continue;
      }

      // --- typed stat modifiers: unconditional FlatModifier on a sheet stat ---
      if (rule.key === "FlatModifier") {
        const bucket = statBucketFor(rule.selector);
        if (!bucket) {
          effects.skipped += 1; // strike-*, initiative, spell DCs, … — deferred
          continue;
        }
        const type = modifierType(rule.type);
        if (type === null || isConditional(rule)) {
          effects.skipped += 1; // ability/proficiency-typed or situational
          continue;
        }
        let value: number;
        try {
          value = evalNumeric(rule.value, ctx);
        } catch {
          effects.skipped += 1;
          continue;
        }
        if (value !== 0) {
          addModifier(bucket, { type, value });
          note(bucket, `${value >= 0 ? "+" : ""}${value} ${type} to ${statLabel(bucket)}`);
        }
        continue;
      }

      // --- proficiency rank: fixed-path ActiveEffectLike upgrade/override ---
      if (rule.key === "ActiveEffectLike" && typeof rule.path === "string") {
        const path = rule.path;
        if (!/\.rank$/.test(path)) continue;
        const mode = rule.mode;
        if (mode !== "upgrade" && mode !== "override") continue;
        // Choice-driven paths (`{item|…}`) need a stored selection we don't have yet.
        if (path.includes("{item")) {
          effects.skipped += 1;
          continue;
        }
        if (isConditional(rule)) {
          effects.skipped += 1;
          continue;
        }
        let value: number;
        try {
          value = evalNumeric(rule.value, ctx);
        } catch {
          effects.skipped += 1;
          continue;
        }
        const rank = toRank(value);
        if (rank === null) {
          effects.skipped += 1;
          continue;
        }
        const skill = SKILL_RANK_PATH.exec(path);
        if (skill?.[1]) {
          raise(effects.skillRanks, skill[1], rank);
          note(skill[1], `${RANK_LABEL[rank]} in ${titleCase(skill[1])}`);
          continue;
        }
        const save = SAVE_RANK_PATH.exec(path);
        if (save?.[1]) {
          raise(effects.saveRanks, save[1], rank);
          note(save[1], `${RANK_LABEL[rank]} ${titleCase(save[1])}`);
          continue;
        }
        if (PERCEPTION_RANK_PATH.test(path)) {
          if (effects.perceptionRank === null || rank > effects.perceptionRank) effects.perceptionRank = rank;
          note("perception", `${RANK_LABEL[rank]} Perception`);
          continue;
        }
        // A rank path we don't map (e.g. spellcasting-entry ranks) — out of scope.
        effects.skipped += 1;
        continue;
      }

      // Anything else that would change the sheet but is deferred to a later
      // increment (speed/senses/resistances → the class-feature pass) is counted,
      // so deferred coverage stays visible. (FlatModifiers are fully handled above.)
      if (DEFERRED_SHEET_KINDS.has(rule.key)) {
        effects.skipped += 1;
      }
    }
  });

  return effects;
}
