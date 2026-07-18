// PF2e bonus & penalty stacking — the rule every layer resolves modifiers through
// — plus the flat `SheetEffects` bag a character builder derives from.
//
// THIS MODULE NO LONGER READS FOUNDRY. It used to: `collectSheetEffects` walked
// their rule elements on every sheet derive, which made their schema load-bearing
// at runtime — the coupling the doc's locked decision forbids ("map into our schema
// at ingest, never store or read their shape at runtime"). Foundry's shape now lives
// only in foundry.ts, is mapped at ingest, and the bag is produced from OUR
// `PassiveEffect[]` by `collectPassiveSheetEffects` (passive.ts).
//
// `evalNumeric` went with it: it existed solely to evaluate Foundry's value strings
// at runtime. expr.ts owns the expression language, and foundry.ts parses their
// values to an AST at ingest instead.

import type { ProficiencyRank } from "./proficiency.js";

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
  /** Character level. */
  level: number;
  /**
   * Ability modifiers, if known — so a value expression can reference `strengthMod`,
   * `dexterityMod`, … (the `characterNamespace` names). Deliberately ONLY the ability
   * mods and level: at collect time (pre-derivation) these base inputs exist, but derived
   * stats (proficiencyBonus, a skill total) do not — a value that referenced one would be
   * circular. Absent → level-only scope, as before.
   */
  abilityMods?: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
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

/**
 * A modifier that DOES apply, but only in a situation the sheet cannot know —
 * "+1 circumstance to Will, vs undead". It is deliberately NOT folded into any
 * total: there is no roll context at derivation time, and a situational bonus
 * shown as permanent is a wrong sheet.
 *
 * It is carried rather than counted because a player uses a situational bonus by
 * READING it and applying it at the table. `condition` is display prose from
 * `describePredicate`; the predicate itself remains the meaning.
 */
export interface ConditionalModifier {
  /** The feat/feature that granted it. */
  source: string;
  /** The affected stat key — same vocabulary as `EffectProvenance.stat`. */
  stat: string;
  /** The modifier itself, e.g. "+1 circumstance to Will". */
  summary: string;
  /** When it applies, e.g. "vs undead". */
  condition: string;
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
   * Situational modifiers — real, displayed, never folded into a total. See
   * `ConditionalModifier`. Empty when nothing conditional was collected.
   */
  conditional: ConditionalModifier[];
  /**
   * Count of rule elements that would affect the sheet but fall outside this
   * increment's scope (choice-driven, unparseable value, strikes, ability/
   * proficiency-typed). Kept for reporting so silently-skipped effects are
   * visible, never hidden.
   */
  skipped: number;
}
