/**
 * Types + helpers for the Pathbuilder 2e JSON export shape.
 *
 * The bot stores this as `characters.pathbuilder_data`. In this database the
 * build lives at the root of the JSON (there is no `.build` wrapper), so
 * `pathbuilder_data.name`, `pathbuilder_data.level`, etc. We only type the
 * fields we actually render; anything else is preserved but ignored.
 */

import {
  abilityModifier,
  maxHitPoints,
  proficientModifier,
  rankLabel,
  rawBonusToRank,
} from '@pathway/core';

// -------- Types --------

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

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
  magicTradition: 'arcane' | 'divine' | 'occult' | 'primal' | string;
  spellcastingType: 'spontaneous' | 'prepared' | string;
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

// -------- Constants --------

/**
 * Pathbuilder 2e exports `size` as a 0-indexed integer (0=Tiny → 5=Gargantuan).
 * The 1-indexed mapping this table used before was off by one, which is why
 * every Medium character rendered as Small — Pathbuilder writes `2` for
 * Medium, and we were mapping 2 → 'Small'.
 */
const SIZE_LABELS: Record<number, string> = {
  0: 'Tiny',
  1: 'Small',
  2: 'Medium',
  3: 'Large',
  4: 'Huge',
  5: 'Gargantuan',
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

// The sheet's historical name for core's abilityModifier.
export const abilityMod = abilityModifier;

export function fmtMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function profLabel(rank: number | undefined): string {
  // Pathbuilder stores the raw bonus (0/2/4/6/8); convert to a core rank.
  return rankLabel(rawBonusToRank(rank));
}

export function sizeLabel(size: number | undefined): string | undefined {
  return size == null ? undefined : SIZE_LABELS[size];
}

// -------- PF2e math --------

/**
 * Standard PF2e proficiency-based modifier: ability mod + proficiency bonus,
 * routed through core's `proficientModifier` (the same composition the builder
 * and the sheet's saves/Perception/skills all share). Pathbuilder's stored rank
 * is the raw bonus (0/2/4/6/8), converted to a core rank first. Item bonuses are
 * not applied here — the bot's `mods` object can override individual totals later.
 *
 * TODO(core-migration): Pathbuilder JSON carries no variant-rule flags, so
 * this always adds level. Builds saved with Proficiency Without Level should
 * pass the flag through once the sheet reads options from _pathwayBuild.
 */
export function proficiencyBonus(
  build: PathbuilderBuild,
  rank: number | undefined,
  ability: Ability,
): number {
  return proficientModifier({
    abilityMod: abilityMod(build.abilities?.[ability]),
    rank: rawBonusToRank(rank),
    level: build.level ?? 1,
  });
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
  const total = maxHitPoints({
    ancestryHp: a.ancestryhp ?? 0,
    classHp: a.classhp ?? 0,
    conMod: abilityMod(build.abilities?.con),
    level: build.level ?? 1,
    bonusHp: a.bonushp ?? 0,
    bonusHpPerLevel: a.bonushpPerLevel ?? 0,
  });
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

/**
 * The AC bonus a raised shield grants (0 if the character carries no shield).
 *
 * Pathbuilder is inconsistent about this: it only populates
 * `acTotal.shieldBonus` when the shield is flagged as equipped/raised in the
 * builder, so plenty of real exports carry a shield in the `armor` list (or the
 * loose `equipment` list) while leaving `acTotal.shieldBonus` at 0/undefined.
 * We therefore fall back to detecting the shield ourselves and deriving its AC
 * bonus from its type (buckler +1, every other shield +2 by default).
 */
export function shieldBonus(build: PathbuilderBuild): number {
  // 1. Pathbuilder's pre-computed value wins when it's actually there.
  const pre = build.acTotal?.shieldBonus;
  if (typeof pre === 'number' && pre > 0) return pre;

  // 2. A shield listed alongside armor (Pathbuilder files shields there,
  //    usually with prof === 'shield').
  const fromArmor = shieldBonusFromArmor(build.armor ?? []);
  if (fromArmor > 0) return fromArmor;

  // 3. Last resort: a shield sitting in the loose [name, qty] equipment list.
  return shieldBonusFromNames((build.equipment ?? []).map((e) => (Array.isArray(e) ? e[0] : '')));
}

/** Base AC bonus for a shield by name (0 if the name isn't a shield). */
function shieldBonusForName(name: string): number {
  const n = name.toLowerCase();
  if (!n) return 0;
  if (n.includes('buckler')) return 1;
  // Wooden / steel / tower / darkwood / etc. all give +2 when raised.
  if (n.includes('shield')) return 2;
  return 0;
}

function isShieldArmor(a: Armor): boolean {
  if ((a.prof ?? '').toLowerCase() === 'shield') return true;
  return shieldBonusForName(a.display || a.name || '') > 0;
}

function shieldBonusFromArmor(armor: Armor[]): number {
  let best = 0;
  for (const a of armor) {
    if (!isShieldArmor(a)) continue;
    // Known shield entry: use the name's bonus, defaulting to +2 when the
    // prof says "shield" but the name is unexpected.
    best = Math.max(best, shieldBonusForName(a.display || a.name || '') || 2);
  }
  return best;
}

function shieldBonusFromNames(names: string[]): number {
  let best = 0;
  for (const name of names) best = Math.max(best, shieldBonusForName(name ?? ''));
  return best;
}

/**
 * The character's focus-pool size (0 if they have no focus spells).
 *
 * Per the focus rules the pool equals the number of focus spells known,
 * capped at 3 — so count the spells stored in `build.focus` (the web builder
 * writes them there). Explicit counts (Pathbuilder's per-caster `focusPoints`,
 * or the top-level `focusPoints` field) are honored when larger, still capped
 * at 3. The old behavior inferred a flat pool of 1 whenever any focus spell
 * existed, which showed 1/1 for characters who know three focus spells.
 */
export function focusPoolMax(build: PathbuilderBuild): number {
  let known = 0;
  for (const byAbility of Object.values(build.focus ?? {})) {
    for (const p of Object.values(byAbility)) {
      known += (p.focusSpells?.length ?? 0) + (p.focusCantrips?.length ?? 0);
    }
  }
  let explicit = 0;
  for (const c of build.spellCasters ?? []) {
    if (typeof c.focusPoints === 'number' && c.focusPoints > 0) explicit += c.focusPoints;
  }
  const topLevel = typeof build.focusPoints === 'number' ? build.focusPoints : 0;
  return Math.min(3, Math.max(known, explicit, topLevel));
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

// -------- Spells / weapons / money --------

/** Single-letter Pathbuilder damage-type codes → human labels. */
const DAMAGE_TYPE_LABEL: Record<string, string> = {
  S: 'slashing',
  P: 'piercing',
  B: 'bludgeoning',
  A: 'acid',
  C: 'cold',
  E: 'electricity',
  F: 'fire',
  Ne: 'void',
  Po: 'poison',
  Ps: 'psychic',
  So: 'sonic',
  Vo: 'void',
  Sp: 'spirit',
};

export function damageTypeLabel(code: string | undefined): string {
  if (!code) return '';
  return DAMAGE_TYPE_LABEL[code] ?? code.toLowerCase();
}

/** Formatted damage line like `1d8+3 slashing`. */
export function weaponDamage(w: Weapon): string {
  const die = w.die ?? '';
  const dmgType = damageTypeLabel(w.damageType);
  const bonus = w.damageBonus;
  const bonusStr = bonus == null || bonus === 0 ? '' : bonus > 0 ? `+${bonus}` : `${bonus}`;
  return `1${die}${bonusStr}${dmgType ? ` ${dmgType}` : ''}`.trim();
}

/** Ordered tradition list (arcane, divine, occult, primal) for consistent UI. */
export const TRADITION_ORDER = ['arcane', 'divine', 'occult', 'primal'] as const;

/** Nice display for the tradition, matching the palette. */
export const TRADITION_COLOR: Record<string, string> = {
  arcane: 'arcane',
  divine: 'gold',
  occult: 'gold-soft',
  primal: 'emerald',
};

/** Highest spell level a caster actually has slots for. */
export function highestSlotLevel(caster: Spellcaster): number {
  const slots = caster.perDay ?? [];
  for (let i = slots.length - 1; i >= 0; i--) {
    if ((slots[i] ?? 0) > 0) return i;
  }
  return 0;
}

/** Total money as gold pieces (for a rough "how rich" display). */
export function totalGp(money: Money | undefined): number {
  if (!money) return 0;
  const { pp = 0, gp = 0, sp = 0, cp = 0 } = money;
  return pp * 10 + gp + sp / 10 + cp / 100;
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

/**
 * Build a "Resist X 5 · Weak Silver 1 · Immune Sleep" line from a character's
 * three defense slots. Returns [] if none set so the caller can render a
 * placeholder.
 */
export function defenseLine(build: PathbuilderBuild): string[] {
  const parts: string[] = [];
  for (const r of normalizeDefenseList(build.resistances)) parts.push(`Resist ${r}`);
  for (const w of normalizeDefenseList(build.weaknesses)) parts.push(`Weak ${w}`);
  for (const i of normalizeDefenseList(build.immunities)) parts.push(`Immune ${i}`);
  return parts;
}
