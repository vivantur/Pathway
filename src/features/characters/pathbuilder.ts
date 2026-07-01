/**
 * Types + helpers for the Pathbuilder 2e JSON export shape.
 *
 * The bot stores this as `characters.pathbuilder_data`. In this database the
 * build lives at the root of the JSON (there is no `.build` wrapper), so
 * `pathbuilder_data.name`, `pathbuilder_data.level`, etc. We only type the
 * fields we actually render; anything else is preserved but ignored.
 */

// -------- Types --------

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

/** Pathbuilder encodes proficiency ranks as raw bonuses: 0/2/4/6/8. */
export type ProfRank = 0 | 2 | 4 | 6 | 8;

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
  /** 1=Tiny, 2=Small, 3=Medium, 4=Large, 5=Huge, 6=Gargantuan */
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
  abilities?: Partial<Record<Ability, number>> & { breakdown?: unknown };
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
  weapons?: Array<Record<string, unknown>>;
  armor?: Array<Record<string, unknown>>;
  money?: { pp?: number; gp?: number; sp?: number; cp?: number };
  equipment?: Array<[string, number]>;
  formula?: unknown;
  spellCasters?: Array<Record<string, unknown>>;
  focus?: Record<string, unknown>;
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

// -------- Constants --------

const SIZE_LABELS: Record<number, string> = {
  1: 'Tiny',
  2: 'Small',
  3: 'Medium',
  4: 'Large',
  5: 'Huge',
  6: 'Gargantuan',
};

export const ABILITY_LABELS: Record<Ability, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
};

export const ABILITY_ORDER: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Which ability governs each PF2e skill. */
export const SKILL_ABILITY: Record<string, Ability> = {
  acrobatics: 'dex',
  arcana: 'int',
  athletics: 'str',
  crafting: 'int',
  deception: 'cha',
  diplomacy: 'cha',
  intimidation: 'cha',
  medicine: 'wis',
  nature: 'wis',
  occultism: 'int',
  performance: 'cha',
  religion: 'wis',
  society: 'int',
  stealth: 'dex',
  survival: 'wis',
  thievery: 'dex',
};

export const SKILL_ORDER: string[] = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion',
  'society', 'stealth', 'survival', 'thievery',
];

// -------- Small helpers --------

export function abilityMod(score: number | undefined): number {
  if (typeof score !== 'number' || Number.isNaN(score)) return 0;
  return Math.floor((score - 10) / 2);
}

export function fmtMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function profLabel(rank: number | undefined): string {
  switch (rank) {
    case 8: return 'Legendary';
    case 6: return 'Master';
    case 4: return 'Expert';
    case 2: return 'Trained';
    default: return 'Untrained';
  }
}

export function sizeLabel(size: number | undefined): string | undefined {
  return size == null ? undefined : SIZE_LABELS[size];
}

// -------- PF2e math --------

/**
 * Standard PF2e proficiency-based bonus: ability mod + (rank + level) if
 * trained-or-above, else just ability mod. Ignores item bonuses for now — the
 * bot's `mods` object can override individual totals later.
 */
export function proficiencyBonus(
  build: PathbuilderBuild,
  rank: number | undefined,
  ability: Ability,
): number {
  const level = build.level ?? 1;
  const mod = abilityMod(build.abilities?.[ability]);
  return (rank ?? 0) > 0 ? mod + (rank ?? 0) + level : mod;
}

export function skillBonus(build: PathbuilderBuild, skillName: string): number {
  const ability = SKILL_ABILITY[skillName];
  if (!ability) return 0;
  const rank = build.proficiencies?.[skillName];
  return proficiencyBonus(build, rank, ability);
}

export function saveBonus(
  build: PathbuilderBuild,
  save: 'fortitude' | 'reflex' | 'will',
): number {
  const ability: Ability = save === 'fortitude' ? 'con' : save === 'reflex' ? 'dex' : 'wis';
  return proficiencyBonus(build, build.proficiencies?.[save], ability);
}

export function perceptionBonus(build: PathbuilderBuild): number {
  return proficiencyBonus(build, build.proficiencies?.perception, 'wis');
}

/**
 * Max HP from ancestry / class / bonuses. Pathbuilder stores per-level extras
 * as `bonushpPerLevel`. Constitution mod contributes at every level after 1st
 * (already baked into `classhp` by Pathbuilder if it's a class HP total).
 * Falls back to `bonushp` alone if the calculation misses.
 */
export function maxHp(build: PathbuilderBuild): number | undefined {
  const a = build.attributes;
  if (!a) return undefined;
  const level = build.level ?? 1;
  const conMod = abilityMod(build.abilities?.con);
  const ancestry = a.ancestryhp ?? 0;
  const cls = a.classhp ?? 0;
  const bonus = a.bonushp ?? 0;
  const bonusPer = (a.bonushpPerLevel ?? 0) * level;
  const conAtLevels = conMod * level;
  const total = ancestry + cls * level + bonus + bonusPer + conAtLevels;
  return total > 0 ? total : undefined;
}

/** Land speed in feet. Falls back to 25 if not stored. */
export function speed(build: PathbuilderBuild): number {
  const a = build.attributes;
  if (!a) return 25;
  return (a.speed ?? 25) + (a.speedBonus ?? 0);
}

/** AC total. Pathbuilder pre-calculates this into `acTotal.acTotal`. */
export function acTotal(build: PathbuilderBuild): number | undefined {
  return build.acTotal?.acTotal;
}

/** Class DC for classes that have one (kineticist, monk, most casters). */
export function classDC(build: PathbuilderBuild): number | undefined {
  const cdc = build.proficiencies?.classDC;
  if (cdc == null) return undefined;
  const ability = build.keyability;
  if (!ability) return undefined;
  const level = build.level ?? 1;
  return 10 + abilityMod(build.abilities?.[ability]) + (cdc > 0 ? cdc + level : 0);
}
