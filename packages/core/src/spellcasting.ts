/**
 * Spellcasting math for the full casters. Dataset-parameterized and I/O-free.
 *
 * Partial casters (magus, summoner) are out of scope for this pass, and the
 * per-rank slot counts are an approximation (see `slotsForRank`) — exact
 * per-class tables are a rules-sourced follow-up.
 */

import { type AbilityKey, type Dataset, type Spell } from './schema';
import type { BuilderState } from './character';
import { OPT } from './options';
import {
  abilityModifier,
  classProficiency,
  computeAbilityScores,
  opt,
  proficiencyBonus,
} from './engine';
import { subclassTradition, type Tradition } from './subclass';

export type { Tradition } from './subclass';
export type CasterType = 'prepared' | 'spontaneous';

/**
 * 'full' casters follow the standard Spells-per-Day table (up to 10th rank).
 * 'partial' casters (magus, summoner) reach 9th rank and keep only their top
 * two ranks of slots (see `partialSlotsForRank`).
 */
export type CasterProgression = 'full' | 'partial';

export interface CasterConfig {
  tradition: Tradition;
  type: CasterType;
  /** The ability that powers spell attacks/DCs (a magus casts on Int even
   * though its class key ability is Str/Dex). */
  keyAbility: AbilityKey;
  /** Cantrips known/prepared (most casters: 5). */
  cantrips: number;
  progression: CasterProgression;
}

/**
 * Curated spellcasting config. A few classes have a tradition that depends on a
 * sub-choice (sorcerer bloodline, witch patron, summoner eidolon); the default
 * here is refined by `subclassTradition`. Magus and summoner are partial casters
 * with a reduced slot table.
 */
const CASTERS: Record<string, CasterConfig> = {
  wizard: { tradition: 'arcane', type: 'prepared', keyAbility: 'int', cantrips: 5, progression: 'full' },
  cleric: { tradition: 'divine', type: 'prepared', keyAbility: 'wis', cantrips: 5, progression: 'full' },
  druid: { tradition: 'primal', type: 'prepared', keyAbility: 'wis', cantrips: 5, progression: 'full' },
  witch: { tradition: 'occult', type: 'prepared', keyAbility: 'int', cantrips: 5, progression: 'full' },
  bard: { tradition: 'occult', type: 'spontaneous', keyAbility: 'cha', cantrips: 5, progression: 'full' },
  sorcerer: { tradition: 'arcane', type: 'spontaneous', keyAbility: 'cha', cantrips: 5, progression: 'full' },
  oracle: { tradition: 'divine', type: 'spontaneous', keyAbility: 'cha', cantrips: 5, progression: 'full' },
  psychic: { tradition: 'occult', type: 'spontaneous', keyAbility: 'int', cantrips: 5, progression: 'full' },
  // Partial casters (Player Core 2): fewer slots, 9th-rank max.
  magus: { tradition: 'arcane', type: 'prepared', keyAbility: 'int', cantrips: 5, progression: 'partial' },
  summoner: { tradition: 'arcane', type: 'spontaneous', keyAbility: 'cha', cantrips: 5, progression: 'partial' },
};

export function casterConfig(
  classId: string | undefined,
  subclassId?: string,
): CasterConfig | undefined {
  const base = classId ? CASTERS[classId] : undefined;
  if (!base) return undefined;
  // Sorcerer bloodline / witch patron determine the tradition.
  const t = subclassTradition(classId, subclassId);
  return t ? { ...base, tradition: t } : base;
}

export function isCaster(classId: string | undefined): boolean {
  return Boolean(casterConfig(classId));
}

/** Highest spell rank a full caster can cast at a given level. */
export function maxSpellRank(level: number): number {
  return Math.min(10, Math.ceil(level / 2));
}

/**
 * Full-caster spell slots per rank at a given character level — the standard
 * Player Core "Spells per Day" table: a newly-gained rank offers 2 slots, each
 * matures to 3 slots at the next level (level ≥ 2 × rank), and 10th rank is
 * always a single slot. Verified against the Player Core table and Foundry's
 * `maxSpellRank = ceil(level / 2)`.
 *
 * This is the *slot* count (also the spontaneous repertoire size, closely
 * enough for build-time selection). It does NOT include bonus slots (wizard
 * curriculum, cleric divine font) or the partial-caster tables (magus/summoner),
 * which are out of scope here.
 */
export function slotsForRank(level: number, rank: number): number {
  if (rank < 1 || rank > maxSpellRank(level)) return 0;
  if (rank === 10) return 1;
  return level >= 2 * rank ? 3 : 2;
}

/**
 * Partial-caster (magus, summoner) slots per rank. Player Core 2: at most two
 * slots of your highest rank and two of the rank below it, nothing lower, with
 * the highest rank starting at a single slot the level you gain it. Reaches 9th
 * rank at 17 and never 10th. Matches both the magus ("two highest, two next")
 * and summoner ("four max, top two ranks, lose lower from 5th") tables.
 */
export function maxPartialSpellRank(level: number): number {
  return Math.min(9, Math.ceil(level / 2));
}

export function partialSlotsForRank(level: number, rank: number): number {
  const m = maxPartialSpellRank(level);
  if (rank < 1 || rank > m) return 0;
  if (rank === m) return level >= 2 * m ? 2 : 1; // 1 the level it's gained, then 2
  if (rank === m - 1) return 2;
  return 0;
}

/** Highest castable rank for a caster config (full → 10th, partial → 9th). */
export function maxSpellRankFor(cfg: CasterConfig, level: number): number {
  return cfg.progression === 'partial' ? maxPartialSpellRank(level) : maxSpellRank(level);
}

/** Slots at a rank for a caster config (dispatches full vs partial table). */
export function slotsForRankOf(cfg: CasterConfig, level: number, rank: number): number {
  return cfg.progression === 'partial'
    ? partialSlotsForRank(level, rank)
    : slotsForRank(level, rank);
}

/** Spell attack modifier and spell DC (trained at L1 → rank 1). */
export function spellStats(
  dataset: Dataset,
  state: BuilderState,
): { attack: number; dc: number; ability: AbilityKey } | null {
  const cfg = casterConfig(state.classId, state.subclassId);
  if (!cfg) return null;
  const level = state.level || 1;
  const scores = computeAbilityScores(dataset, state);
  const abilityMod = abilityModifier(scores[cfg.keyAbility]);
  const pwl = opt(state, OPT.proficiencyWithoutLevel);
  // Spellcasting proficiency starts trained and advances to expert/master/
  // legendary by level (from the class's proficiencyIncreases). Cleric's is
  // doctrine-gated and not yet modeled, so it stays trained for now.
  const klass = dataset.classes.find((c) => c.id === state.classId);
  const spellRank = classProficiency(klass, 'spell', level, 1);
  const bonus = proficiencyBonus(spellRank, level, pwl);
  return { attack: bonus + abilityMod, dc: 10 + bonus + abilityMod, ability: cfg.keyAbility };
}

const isCantrip = (s: Spell) => s.traits.includes('cantrip');
const isFocus = (s: Spell) => s.traits.includes('focus');

/** Cantrips available to a tradition (sorted by name). */
export function cantripsFor(dataset: Dataset, tradition: Tradition): Spell[] {
  return dataset.spells
    .filter((s) => isCantrip(s) && !isFocus(s) && s.traditions.includes(tradition))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Non-cantrip, non-focus spells of a given rank for a tradition. */
export function spellsForRank(dataset: Dataset, tradition: Tradition, rank: number): Spell[] {
  return dataset.spells
    .filter(
      (s) => !isCantrip(s) && !isFocus(s) && s.rank === rank && s.traditions.includes(tradition),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Subclass name (muse/patron/bloodline) — used to hint variable traditions. */
export function subclassNote(dataset: Dataset, state: BuilderState): string | undefined {
  const klass = dataset.classes.find((c) => c.id === state.classId);
  const sub = klass?.subclasses?.find((s) => s.id === state.subclassId);
  return sub?.name;
}
