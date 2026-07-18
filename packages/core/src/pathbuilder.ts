// The Pathbuilder 2e boundary — the format description plus the readers that turn
// an exported build into core's `ResolvedCharacter`.
//
// WHY THIS IS IN CORE: Pathbuilder JSON is not merely an import format, it is the
// STORAGE format. The bot keeps it verbatim in `characters.pathbuilder_data`, and
// even characters built in Pathway's own web builder are saved as Pathbuilder JSON
// with the native builder state riding along under `_pathwayBuild`. So every
// consumer — web sheet, bot, effects engine — eventually needs to read this shape,
// and `character.ts` already names "the Pathbuilder-import reader" as one of the two
// producers of `ResolvedCharacter`. A second reader would be exactly the drift this
// package exists to prevent.
//
// WHAT THIS DOES AND DOESN'T DO: it trusts Pathbuilder's BUILD DECISIONS (which
// feats, which proficiency ranks, what armor) and re-derives the ARITHMETIC through
// core's own math (`proficientModifier`, `proficientDC`, `maxHitPoints`). It does
// not invert a build back into builder state — Pathbuilder stores `athletics: 4`,
// not "expert from class plus a level-3 skill increase", and reconstructing that
// would be guesswork.
//
// PURE: no I/O, no network. Reads a plain object, returns values.
//
// NAMING: exports are `pathbuilder*`-qualified because core's index re-exports every
// module with `export *` into ONE flat namespace — an unprefixed `speed()` or
// `acTotal()` there would be both ambiguous and a collision waiting to happen.
// `apps/web` aliases them back to its historical short names.

import type { ResolvedCharacter, SkillStat } from "./character.js";
import { ABILITIES, type Ability } from "./content.js";
import { maxHitPoints, proficientDC, proficientModifier } from "./derived.js";
import { SKILL_ABILITY } from "./selectors.js";
import { abilityModifier, rawBonusToRank } from "./stats.js";

// ---------------------------------------------------------------------------
// the format
// ---------------------------------------------------------------------------

/** Pathbuilder encodes proficiency ranks as raw bonuses: 0/2/4/6/8. */
export type ProfRank = 0 | 2 | 4 | 6 | 8;

/** One spellcaster entry inside `pathbuilder_data.spellCasters`. */
export interface Spellcaster {
  name: string;
  innate: boolean;
  /** Slots per day, indexed by spell level (0 = cantrips). */
  perDay: number[];
  /** Known / accessible spells, grouped by spell level. */
  spells: Array<{ spellLevel: number; list: string[] }>;
  /** For prepared casters: today's selection, grouped by level. */
  prepared?: Array<{ spellLevel?: number; list?: string[] }>;
  ability: Ability;
  focusPoints: number;
  proficiency: number;
  blendedSpells?: unknown[];
  magicTradition: "arcane" | "divine" | "occult" | "primal" | string;
  spellcastingType: "spontaneous" | "prepared" | string;
}

/** `pathbuilder_data.focus` shape: tradition → ability → pool descriptor. */
export type FocusPools = Record<
  string,
  Record<
    string,
    {
      itemBonus?: number;
      focusSpells?: string[];
      focusCantrips?: string[];
      proficiency?: number;
      abilityBonus?: number;
    }
  >
>;

export interface Weapon {
  name: string;
  display?: string;
  die?: string;
  /** Total to-hit modifier (Pathbuilder pre-computes it). */
  attack?: number;
  damageBonus?: number;
  /** Single-letter code: S=slashing, P=piercing, B=bludgeoning, etc. */
  damageType?: string;
  prof?: string;
  qty?: number;
  pot?: number;
  runes?: string[];
  mat?: string | null;
  grade?: string;
  str?: string;
  extraDamage?: unknown[];
  increasedDice?: boolean;
  isInventor?: boolean;
}

export interface Armor {
  name: string;
  display?: string;
  prof?: string;
  worn?: boolean;
  qty?: number;
  pot?: number;
  runes?: string[];
  mat?: string | null;
  res?: string;
  grade?: string;
}

export interface Money {
  pp?: number;
  gp?: number;
  sp?: number;
  cp?: number;
}

export interface PathbuilderBuild {
  name?: string;
  class?: string;
  dualClass?: string | null;
  level?: number;
  ancestry?: string;
  heritage?: string;
  background?: string;
  alignment?: string;
  gender?: string;
  age?: string;
  deity?: string;
  /** 0=Tiny, 1=Small, 2=Medium, 3=Large, 4=Huge, 5=Gargantuan */
  size?: number;
  keyability?: Ability;
  languages?: string[];
  attributes?: {
    ancestryhp?: number;
    classhp?: number;
    bonushp?: number;
    bonushpPerLevel?: number;
    speed?: number;
    speedBonus?: number;
  };
  abilities?: Partial<Record<Ability, number>> & {
    breakdown?: {
      /** Fixed ancestry boosts (e.g. Elf: Dex + Int). */
      ancestryBoosts?: string[];
      /** Free ancestry boosts the player picked. */
      ancestryFree?: string[];
      /** Ancestry flaws (usually one). */
      ancestryFlaws?: string[];
      /** Background boosts (usually two). */
      backgroundBoosts?: string[];
      /** Class key boosts. */
      classBoosts?: string[];
      /** Level-5/10/15/20 boosts, keyed by level. */
      mapLevelledBoosts?: Record<string, string[]>;
    };
  };
  /** Static bonuses/penalties keyed by target. */
  mods?: Record<string, unknown>;
  proficiencies?: Partial<Record<string, number>> & {
    fortitude?: number;
    reflex?: number;
    will?: number;
    perception?: number;
    classDC?: number;
  };
  /** Skill lores: [name, rank]. */
  lores?: Array<[string, number]>;
  /** [feat name, sourcebook, type/category, level acquired]. */
  feats?: Array<[string, string | null, string, number]>;
  specificProficiencies?: Record<string, unknown>;
  weapons?: Weapon[];
  armor?: Armor[];
  money?: Money;
  equipment?: Array<[string, number]>;
  formula?: unknown;
  spellCasters?: Spellcaster[];
  focus?: FocusPools;
  /** Top-level focus pool count (the web builder writes this alongside `focus`). */
  focusPoints?: number;
  /**
   * Damage-typed defenses. Stored inconsistently in Pathbuilder exports —
   * sometimes a single string ("Silver 1"), sometimes a comma-separated string
   * ("Silver 1, Cold Iron 3"), sometimes an array. Consumers should run through
   * `normalizeDefenseList()` before rendering.
   */
  resistances?: string | string[] | null;
  weaknesses?: string | string[] | null;
  immunities?: string | string[] | null;
  pets?: unknown[];
  familiars?: unknown[];
  acTotal?: {
    acProfBonus?: number;
    acAbilityBonus?: number;
    acItemBonus?: number;
    acTotal?: number;
    shieldBonus?: number;
  };
}

// ---------------------------------------------------------------------------
// format decoding
// ---------------------------------------------------------------------------

/**
 * Pathbuilder 2e exports `size` as a 0-indexed integer (0=Tiny → 5=Gargantuan).
 * A 1-indexed mapping here was once off by one, which is why every Medium
 * character rendered as Small — Pathbuilder writes `2` for Medium.
 */
const SIZE_LABELS: Record<number, string> = {
  0: "Tiny",
  1: "Small",
  2: "Medium",
  3: "Large",
  4: "Huge",
  5: "Gargantuan",
};

/** Decode Pathbuilder's numeric size code; undefined when unset or unknown. */
export function pathbuilderSize(size: number | undefined): string | undefined {
  return size == null ? undefined : SIZE_LABELS[size];
}

/**
 * Normalize a resistance/weakness/immunity slot to a string[] of individual
 * entries. Handles all three storage shapes Pathbuilder / the bot use:
 *   - null / undefined → []
 *   - string ("Silver 1") → ["Silver 1"]
 *   - comma-or-semicolon-separated string ("Silver 1, Fire 2") → 2 entries
 *   - array → filtered to non-empty strings
 */
export function normalizeDefenseList(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return v
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// readers — Pathbuilder's stored ranks/scores through core's arithmetic
// ---------------------------------------------------------------------------

/**
 * Standard PF2e proficiency-based modifier: ability mod + proficiency bonus,
 * routed through core's `proficientModifier` — the same composition the web
 * builder and the sheet share. Pathbuilder's stored rank is the raw bonus
 * (0/2/4/6/8), converted to a core rank first. Item bonuses are not applied
 * here; a host's own `mods` may override individual totals later.
 *
 * TODO(variant-rules): Pathbuilder JSON carries no variant-rule flags, so this
 * always adds level. Builds saved with Proficiency Without Level would need the
 * flag threaded through once a caller can supply it.
 */
export function pathbuilderModifier(
  build: PathbuilderBuild,
  rank: number | undefined,
  ability: Ability,
): number {
  return proficientModifier({
    abilityMod: abilityModifier(build.abilities?.[ability]),
    rank: rawBonusToRank(rank),
    level: build.level ?? 1,
  });
}

export function pathbuilderSkillBonus(build: PathbuilderBuild, skillName: string): number {
  const ability = SKILL_ABILITY[skillName as keyof typeof SKILL_ABILITY];
  if (!ability) return 0;
  return pathbuilderModifier(build, build.proficiencies?.[skillName], ability);
}

export function pathbuilderSaveBonus(
  build: PathbuilderBuild,
  save: "fortitude" | "reflex" | "will",
): number {
  const ability: Ability = save === "fortitude" ? "con" : save === "reflex" ? "dex" : "wis";
  return pathbuilderModifier(build, build.proficiencies?.[save], ability);
}

export function pathbuilderPerception(build: PathbuilderBuild): number {
  return pathbuilderModifier(build, build.proficiencies?.perception, "wis");
}

/**
 * Max HP from ancestry / class / bonuses. Pathbuilder stores per-level extras as
 * `bonushpPerLevel`. Constitution mod contributes at every level after 1st
 * (already baked into `classhp` by Pathbuilder if it's a class HP total).
 * Falls back to undefined if the build carries no attributes block.
 */
export function pathbuilderMaxHp(build: PathbuilderBuild): number | undefined {
  const a = build.attributes;
  if (!a) return undefined;
  const total = maxHitPoints({
    ancestryHp: a.ancestryhp ?? 0,
    classHp: a.classhp ?? 0,
    conMod: abilityModifier(build.abilities?.con),
    level: build.level ?? 1,
    bonusHp: a.bonushp ?? 0,
    bonusHpPerLevel: a.bonushpPerLevel ?? 0,
  });
  return total > 0 ? total : undefined;
}

/** Land speed in feet. Falls back to 25 if not stored. */
export function pathbuilderSpeed(build: PathbuilderBuild): number {
  const a = build.attributes;
  if (!a) return 25;
  return (a.speed ?? 25) + (a.speedBonus ?? 0);
}

/**
 * AC total. Pathbuilder pre-calculates this into `acTotal.acTotal`, and unlike
 * every other statistic here it arrives as an OPAQUE TOTAL with no breakdown.
 *
 * Consequence for the effects engine: a flat AC modifier composes fine, but an
 * effect that ought to move AC by changing an input (Dex, armor proficiency, an
 * item bonus) has nothing to recompute from and will silently not apply. Web
 * characters carrying `_pathwayBuild` can go through the builder's forward engine
 * instead; a pure Pathbuilder import cannot.
 */
export function pathbuilderAc(build: PathbuilderBuild): number | undefined {
  return build.acTotal?.acTotal;
}

/** Base AC bonus for a shield by name (0 if the name isn't a shield). */
function shieldBonusForName(name: string): number {
  const n = name.toLowerCase();
  if (!n) return 0;
  if (n.includes("buckler")) return 1;
  // Wooden / steel / tower / darkwood / etc. all give +2 when raised.
  if (n.includes("shield")) return 2;
  return 0;
}

function isShieldArmor(a: Armor): boolean {
  if ((a.prof ?? "").toLowerCase() === "shield") return true;
  return shieldBonusForName(a.display || a.name || "") > 0;
}

function shieldBonusFromArmor(armor: Armor[]): number {
  let best = 0;
  for (const a of armor) {
    if (!isShieldArmor(a)) continue;
    // Known shield entry: use the name's bonus, defaulting to +2 when the prof
    // says "shield" but the name is unexpected.
    best = Math.max(best, shieldBonusForName(a.display || a.name || "") || 2);
  }
  return best;
}

function shieldBonusFromNames(names: string[]): number {
  let best = 0;
  for (const name of names) best = Math.max(best, shieldBonusForName(name ?? ""));
  return best;
}

/**
 * The AC bonus a raised shield grants (0 if the character carries no shield).
 *
 * Pathbuilder is inconsistent about this: it only populates `acTotal.shieldBonus`
 * when the shield is flagged as equipped/raised in the builder, so plenty of real
 * exports carry a shield in the `armor` list (or the loose `equipment` list) while
 * leaving `acTotal.shieldBonus` at 0/undefined. We therefore fall back to
 * detecting the shield ourselves and deriving its AC bonus from its type
 * (buckler +1, every other shield +2 by default).
 */
export function pathbuilderShieldBonus(build: PathbuilderBuild): number {
  // 1. Pathbuilder's pre-computed value wins when it's actually there.
  const pre = build.acTotal?.shieldBonus;
  if (typeof pre === "number" && pre > 0) return pre;

  // 2. A shield listed alongside armor (Pathbuilder files shields there,
  //    usually with prof === 'shield').
  const fromArmor = shieldBonusFromArmor(build.armor ?? []);
  if (fromArmor > 0) return fromArmor;

  // 3. Last resort: a shield sitting in the loose [name, qty] equipment list.
  return shieldBonusFromNames((build.equipment ?? []).map((e) => (Array.isArray(e) ? e[0] : "")));
}

/**
 * The character's focus-pool size (0 if they have no focus spells).
 *
 * Per the focus rules the pool equals the number of focus spells known, capped at
 * 3 — so count the spells stored in `build.focus` (the web builder writes them
 * there). Explicit counts (Pathbuilder's per-caster `focusPoints`, or the
 * top-level `focusPoints` field) are honored when larger, still capped at 3.
 */
export function pathbuilderFocusPool(build: PathbuilderBuild): number {
  let known = 0;
  for (const byAbility of Object.values(build.focus ?? {})) {
    for (const p of Object.values(byAbility)) {
      known += (p.focusSpells?.length ?? 0) + (p.focusCantrips?.length ?? 0);
    }
  }
  let explicit = 0;
  for (const c of build.spellCasters ?? []) {
    if (typeof c.focusPoints === "number" && c.focusPoints > 0) explicit += c.focusPoints;
  }
  const topLevel = typeof build.focusPoints === "number" ? build.focusPoints : 0;
  return Math.min(3, Math.max(known, explicit, topLevel));
}

/** Class DC for classes that have one (kineticist, monk, most casters). */
export function pathbuilderClassDc(build: PathbuilderBuild): number | undefined {
  const cdc = build.proficiencies?.classDC;
  if (cdc == null) return undefined;
  const ability = build.keyability;
  if (!ability) return undefined;
  // Pathbuilder stores the pre-doubled rank (0/2/4/6/8); core adds the level term.
  return proficientDC({
    abilityMod: abilityModifier(build.abilities?.[ability]),
    rank: rawBonusToRank(cdc),
    level: build.level ?? 1,
  });
}

// ---------------------------------------------------------------------------
// the convergence point
// ---------------------------------------------------------------------------

/**
 * Assemble core's shared `ResolvedCharacter` from a Pathbuilder build — the same
 * read-surface the web builder's `toResolvedCharacter` produces, so a character
 * imported from Pathbuilder and one built in-app are read identically, and both
 * can feed the effects engine.
 *
 * Adds no new rules math: every number here comes from a reader above. Spell
 * attack/DC are omitted (Pathbuilder stores caster proficiency but this reader
 * doesn't resolve spell stats yet), matching the builder adapter; spell selectors
 * resolve to 0 until a real resolver lands.
 */
export function resolvedFromPathbuilder(build: PathbuilderBuild): ResolvedCharacter {
  const level = build.level ?? 1;
  const scores = ABILITIES.reduce(
    (acc, a) => {
      acc[a] = build.abilities?.[a] ?? 10;
      return acc;
    },
    {} as Record<Ability, number>,
  );
  const mods = ABILITIES.reduce(
    (acc, a) => {
      acc[a] = abilityModifier(scores[a]);
      return acc;
    },
    {} as Record<Ability, number>,
  );

  const skills: Record<string, SkillStat> = {};
  for (const [slug, ability] of Object.entries(SKILL_ABILITY)) {
    skills[slug] = {
      modifier: pathbuilderSkillBonus(build, slug),
      rank: rawBonusToRank(build.proficiencies?.[slug]),
      ability,
    };
  }

  const cdc = pathbuilderClassDc(build);

  return {
    level,
    scores,
    mods,
    keyAbility: build.keyability ?? null,
    hp: { max: pathbuilderMaxHp(build) ?? 0 },
    ac: { value: pathbuilderAc(build) ?? 0, shieldBonus: pathbuilderShieldBonus(build) },
    perception: {
      modifier: pathbuilderPerception(build),
      rank: rawBonusToRank(build.proficiencies?.perception),
    },
    saves: {
      fortitude: {
        modifier: pathbuilderSaveBonus(build, "fortitude"),
        rank: rawBonusToRank(build.proficiencies?.fortitude),
      },
      reflex: {
        modifier: pathbuilderSaveBonus(build, "reflex"),
        rank: rawBonusToRank(build.proficiencies?.reflex),
      },
      will: {
        modifier: pathbuilderSaveBonus(build, "will"),
        rank: rawBonusToRank(build.proficiencies?.will),
      },
    },
    classDc: cdc == null ? null : { modifier: cdc, rank: rawBonusToRank(build.proficiencies?.classDC) },
    speeds: { land: pathbuilderSpeed(build) },
    skills,
    focusPoints: { max: pathbuilderFocusPool(build) },
  };
}
