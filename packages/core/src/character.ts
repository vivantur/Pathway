// The resolved-character model — the effects engine's PUBLIC INPUT SURFACE.
//
// `ResolvedCharacter` is the normalized, already-resolved statistics of a
// character: ability scores + modifiers, the named defenses/checks (AC, saves,
// Perception, skills, class DC, spell DC/attack), and their proficiency ranks.
// It is the convergence point the web builder's forward engine (deriveCharacter)
// and the Pathbuilder-import reader both produce, so the two can never disagree
// about the shape the rest of the app reads — and it is exactly what the effects
// engine's expression language reads (docs/effects-engine-design.md, "The
// expression system", namespace 1: "character stats").
//
// PURE and INPUT-ONLY: this module takes ALREADY-RESOLVED values and only reads
// them back out by selector or as a flat namespace. It performs NO PF2e rules
// math — no stacking, no progression, no degree-of-success — so there is no
// rules-from-memory risk here. How a client resolved a rank or modifier (class
// tables vs. a pre-computed import) is the client's concern; see derived.ts for
// the shared composition primitives both clients build on.

import type { Ability } from "./content.js";
import type { ProficiencyRank } from "./proficiency.js";
import { SKILL_SLUGS, type SaveSelector, type Selector } from "./selectors.js";

/**
 * A resolved statistic: its final total and the proficiency rank behind it. For
 * a check (Perception, a save, a skill, an attack) `modifier` is the roll
 * modifier; for a `*-dc` statistic (class DC, spell DC) `modifier` holds the
 * resolved DC. `rank` is the proficiency the total was built from (0–4).
 */
export interface StatValue {
  modifier: number;
  rank: ProficiencyRank;
}

/** A skill's resolved value plus the ability that governs it. */
export interface SkillStat extends StatValue {
  ability: Ability;
}

/** One spellcasting entry's resolved spell attack + spell DC, by tradition. */
export interface SpellcastingStat {
  tradition: string;
  spellAttack: StatValue;
  spellDc: StatValue;
}

/**
 * A fully resolved character, ready to read. Both the builder's forward engine
 * and the Pathbuilder reader emit this shape. Fields a client needs but the
 * engine does not (weapon detail, effect provenance) stay on that client's
 * richer type, which maps TO this — they are not duplicated here.
 */
export interface ResolvedCharacter {
  level: number;
  scores: Record<Ability, number>;
  mods: Record<Ability, number>;
  hp: { max: number };
  /** AC total, plus the extra AC a raised shield would add (0 if none). */
  ac: { value: number; shieldBonus: number };
  perception: StatValue;
  saves: Record<SaveSelector, StatValue>;
  /** null for classes without a class DC. */
  classDc: StatValue | null;
  /** Speeds in feet, keyed by movement type; `land` is always present. */
  speeds: { land: number } & Record<string, number>;
  /** Keyed by skill slug (the 16) and any lore slugs. */
  skills: Record<string, SkillStat>;
  /** One entry per spellcasting class/tradition the character has, if any. */
  spellcasting?: SpellcastingStat[];
  focusPoints?: { max: number };
}

/**
 * Look up the resolved modifier (or DC) for a single statistic by selector — the
 * operation the effects engine performs when a Layer-1 effect targets a stat.
 *
 * Reads only values the model carries; a valid-but-unbacked selector (`attack`,
 * `damage`, `initiative` — reserved in selectors.ts) returns 0 rather than a
 * guessed value. Spell selectors read the FIRST spellcasting entry (a
 * multi-tradition caster's other entries aren't reachable by a scalar selector
 * yet — a known v1 limitation, not a rules assumption).
 */
export function resolveSelector(rc: ResolvedCharacter, selector: Selector): number {
  switch (selector) {
    case "ac":
      return rc.ac.value;
    case "fortitude":
    case "reflex":
    case "will":
      return rc.saves[selector].modifier;
    case "perception":
      return rc.perception.modifier;
    case "class-dc":
      return rc.classDc?.modifier ?? 0;
    case "spell-dc":
      return rc.spellcasting?.[0]?.spellDc.modifier ?? 0;
    case "spell-attack":
      return rc.spellcasting?.[0]?.spellAttack.modifier ?? 0;
    case "speed:land":
      return rc.speeds.land;
    // Reserved selectors the resolved model does not carry yet.
    case "attack":
    case "damage":
    case "initiative":
      return 0;
    default:
      // A skill (or lore) slug.
      return rc.skills[selector]?.modifier ?? 0;
  }
}

/**
 * The flat variable bag the bounded expression evaluator reads — the concrete
 * "character stats" namespace of the effects engine's expression system. Keys
 * are stable names (`strengthMod`, `perception`, `classDc`, each skill slug, …);
 * values are resolved numbers. Lores are omitted (open-ended); skills with no
 * entry on the character are omitted rather than reported as 0.
 */
export function characterNamespace(rc: ResolvedCharacter): Record<string, number> {
  const ns: Record<string, number> = {
    level: rc.level,
    strengthMod: rc.mods.str,
    dexterityMod: rc.mods.dex,
    constitutionMod: rc.mods.con,
    intelligenceMod: rc.mods.int,
    wisdomMod: rc.mods.wis,
    charismaMod: rc.mods.cha,
    maxHp: rc.hp.max,
    ac: rc.ac.value,
    perception: rc.perception.modifier,
    fortitude: rc.saves.fortitude.modifier,
    reflex: rc.saves.reflex.modifier,
    will: rc.saves.will.modifier,
    classDc: rc.classDc?.modifier ?? 0,
    speed: rc.speeds.land,
  };
  for (const slug of SKILL_SLUGS) {
    const s = rc.skills[slug];
    if (s) ns[slug] = s.modifier;
  }
  const primary = rc.spellcasting?.[0];
  if (primary) {
    ns.spellDc = primary.spellDc.modifier;
    ns.spellAttack = primary.spellAttack.modifier;
  }
  return ns;
}
