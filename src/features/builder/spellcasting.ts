import { findClass, getDataset, type AbilityKey, type Spell } from '@/features/builder/data';
import { abilityModifier, computeAbilityScores, proficiencyBonus, opt } from './rules';
import { OPT } from './options/config';
import type { BuilderState } from './types';

export type Tradition = 'arcane' | 'divine' | 'occult' | 'primal';
export type CasterType = 'prepared' | 'spontaneous';

export interface CasterConfig {
  tradition: Tradition;
  type: CasterType;
  keyAbility: AbilityKey;
  /** Cantrips known/prepared (most full casters: 5). */
  cantrips: number;
}

/**
 * Curated spellcasting config for the full casters. A few classes have a
 * tradition that depends on a sub-choice (sorcerer bloodline, witch patron); we
 * use a sensible default and note it in the UI. Partial casters (magus,
 * summoner) are out of scope for this pass.
 */
const CASTERS: Record<string, CasterConfig> = {
  wizard: { tradition: 'arcane', type: 'prepared', keyAbility: 'int', cantrips: 5 },
  cleric: { tradition: 'divine', type: 'prepared', keyAbility: 'wis', cantrips: 5 },
  druid: { tradition: 'primal', type: 'prepared', keyAbility: 'wis', cantrips: 5 },
  witch: { tradition: 'occult', type: 'prepared', keyAbility: 'int', cantrips: 5 },
  bard: { tradition: 'occult', type: 'spontaneous', keyAbility: 'cha', cantrips: 5 },
  sorcerer: { tradition: 'arcane', type: 'spontaneous', keyAbility: 'cha', cantrips: 5 },
  oracle: { tradition: 'divine', type: 'spontaneous', keyAbility: 'cha', cantrips: 5 },
  psychic: { tradition: 'occult', type: 'spontaneous', keyAbility: 'int', cantrips: 5 },
};

export function casterConfig(classId: string | undefined): CasterConfig | undefined {
  return classId ? CASTERS[classId] : undefined;
}

export function isCaster(classId: string | undefined): boolean {
  return Boolean(casterConfig(classId));
}

/** Highest spell rank a full caster can cast at a given level. */
export function maxSpellRank(level: number): number {
  return Math.min(10, Math.ceil(level / 2));
}

/**
 * Approximate spells to pick at a given rank for a full caster (mirrors the
 * standard spells-per-day table): a newly-gained rank offers 2, matured ranks
 * offer 3, and 10th rank is capped at 1. Good enough to guide selection; exact
 * per-class nuances (e.g. wizard spellbook size) are a later refinement.
 */
export function slotsForRank(level: number, rank: number): number {
  if (rank < 1 || rank > maxSpellRank(level)) return 0;
  if (rank === 10) return 1;
  return level >= 2 * rank ? 3 : 2;
}

/** Spell attack modifier and spell DC (trained at L1 → rank 1). */
export function spellStats(state: BuilderState): { attack: number; dc: number; ability: AbilityKey } | null {
  const cfg = casterConfig(state.classId);
  if (!cfg) return null;
  const level = state.level || 1;
  const mods = computeAbilityScores(state);
  const abilityMod = abilityModifier(mods[cfg.keyAbility]);
  const pwl = opt(state, OPT.proficiencyWithoutLevel);
  const bonus = proficiencyBonus(1, level, pwl); // trained
  return { attack: bonus + abilityMod, dc: 10 + bonus + abilityMod, ability: cfg.keyAbility };
}

const isCantrip = (s: Spell) => s.traits.includes('cantrip');
const isFocus = (s: Spell) => s.traits.includes('focus');

/** Cantrips available to a tradition (sorted by name). */
export function cantripsFor(tradition: Tradition): Spell[] {
  return getDataset()
    .spells.filter((s) => isCantrip(s) && !isFocus(s) && s.traditions.includes(tradition))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Non-cantrip, non-focus spells of a given rank for a tradition. */
export function spellsForRank(tradition: Tradition, rank: number): Spell[] {
  return getDataset()
    .spells.filter(
      (s) => !isCantrip(s) && !isFocus(s) && s.rank === rank && s.traditions.includes(tradition),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Subclass name (muse/patron/bloodline) — used to hint variable traditions. */
export function subclassNote(state: BuilderState): string | undefined {
  const klass = state.classId ? findClass(state.classId) : undefined;
  const sub = klass?.subclasses?.find((s) => s.id === state.subclassId);
  return sub?.name;
}
