/**
 * The sheet's view of the Pathbuilder 2e export shape.
 *
 * The FORMAT and its READERS now live in `@pathway/core` (`core/src/pathbuilder.ts`)
 * — the bot stores this same JSON in `characters.pathbuilder_data` and needs to
 * reach `ResolvedCharacter` from it, so a second reader here would be exactly the
 * drift `packages/core` exists to prevent.
 *
 * What remains here is PRESENTATION: display strings, orderings, and palette
 * mappings that only the web sheet cares about. Core's readers are re-exported
 * under this module's historical short names so existing importers are unchanged.
 */

import {
  ABILITIES,
  abilityModifier,
  normalizeDefenseList,
  pathbuilderAc,
  pathbuilderClassDc,
  pathbuilderFocusPool,
  pathbuilderMaxHp,
  pathbuilderModifier,
  pathbuilderPerception,
  pathbuilderSaveBonus,
  pathbuilderShieldBonus,
  pathbuilderSize,
  pathbuilderSkillBonus,
  pathbuilderSpeed,
  rankLabel,
  rawBonusToRank,
  SKILL_ABILITY as CORE_SKILL_ABILITY,
  type Ability,
  type Money,
  type PathbuilderBuild,
  type Spellcaster,
  type PathbuilderWeapon as Weapon,
} from '@pathway/core';

// -------- Format types + readers, re-exported from core --------

export type {
  Ability,
  Armor,
  FocusPools,
  Money,
  PathbuilderBuild,
  ProfRank,
  Spellcaster,
  // Core renamed this to `PathbuilderWeapon` once a real weapon CONTENT entity
  // existed (they are different things: this is what Pathbuilder wrote, that is
  // our schema). Aliased back to the historical short name so this module's
  // consumers are unaffected — the same aliasing this file already does for the
  // `pathbuilder*` readers.
  PathbuilderWeapon as Weapon,
} from '@pathway/core';

export { normalizeDefenseList, resolvedFromPathbuilder } from '@pathway/core';

/** Core's `pathbuilder*` readers under this module's historical names. */
export const proficiencyBonus = pathbuilderModifier;
export const skillBonus = pathbuilderSkillBonus;
export const saveBonus = pathbuilderSaveBonus;
export const perceptionBonus = pathbuilderPerception;
export const maxHp = pathbuilderMaxHp;
export const speed = pathbuilderSpeed;
export const acTotal = pathbuilderAc;
export const shieldBonus = pathbuilderShieldBonus;
export const focusPoolMax = pathbuilderFocusPool;
export const classDC = pathbuilderClassDc;
export const sizeLabel = pathbuilderSize;

// -------- Constants --------

export const ABILITY_LABELS: Record<Ability, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
};

export const ABILITY_ORDER: Ability[] = [...ABILITIES];

/**
 * Which ability governs each PF2e skill — re-exported from core, which is the one
 * definition. Kept exported from here so existing importers are unchanged.
 */
export const SKILL_ABILITY: Record<string, Ability> = CORE_SKILL_ABILITY;

export const SKILL_ORDER: string[] = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy',
  'intimidation', 'medicine', 'nature', 'occultism', 'performance', 'religion',
  'society', 'stealth', 'survival', 'thievery',
];

// -------- Display helpers --------

// The sheet's historical name for core's abilityModifier.
export const abilityMod = abilityModifier;

export function fmtMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function profLabel(rank: number | undefined): string {
  // Pathbuilder stores the raw bonus (0/2/4/6/8); convert to a core rank.
  return rankLabel(rawBonusToRank(rank));
}

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
