import { findClass, getDataset, type AbilityKey, type Spell } from '@/features/builder/data';
import { proficiencyRankAtLevel } from './data/proficiency';
import { abilityModifier, computeAbilityScores, proficiencyBonus, opt } from './rules';
import { OPT } from './options/config';
import { subclassTradition } from './subclassEffects';
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

/**
 * Spell attack modifier and spell DC. Spellcasting proficiency advances by the
 * class progression table in `@pathway/core` (trained → expert → master →
 * legendary at class-specific levels); full casters start trained, so we floor
 * at rank 1 for a class flagged as a caster by `casterConfig`.
 */
export function spellStats(state: BuilderState): { attack: number; dc: number; ability: AbilityKey } | null {
  const cfg = casterConfig(state.classId, state.subclassId);
  if (!cfg) return null;
  const level = state.level || 1;
  const mods = computeAbilityScores(state);
  const abilityMod = abilityModifier(mods[cfg.keyAbility]);
  const pwl = opt(state, OPT.proficiencyWithoutLevel);
  const rank = Math.max(1, state.classId ? proficiencyRankAtLevel(state.classId, 'spellcasting', level) : 1);
  const bonus = proficiencyBonus(rank as 1 | 2 | 3 | 4, level, pwl);
  return { attack: bonus + abilityMod, dc: 10 + bonus + abilityMod, ability: cfg.keyAbility };
}

const isCantrip = (s: Spell) => s.traits.includes('cantrip');
const isFocus = (s: Spell) => s.traits.includes('focus');

// --------------------------------------------------------------------------
// Focus spells
// --------------------------------------------------------------------------
//
// Focus spells are a special pool of magic every focus-using class draws on —
// not just the eight prepared/spontaneous casters. The key attribute and magic
// tradition below are taken from the PF2e Remaster rules (Archive of Nethys),
// not model memory, per the project's rules-from-source policy:
//   - Monk (qi spells):      Wis; divine OR occult (chosen)  — Classes ID=60
//   - Champion (devotion):   Cha; divine                     — Classes ID=58
//   - Ranger (warden):       Wis; primal                     — Classes ID=36
//   - Magus (conflux):       Int; arcane                     — Classes ID=17
//   - Summoner (link):       Cha; the eidolon's tradition    — Classes ID=18
//   - Animist:               Wis; divine                     — Classes ID=64
// The eight full casters inherit their own tradition + key attribute (a witch's
// / sorcerer's is already resolved from the subclass via `casterConfig`).
// Focus-spell proficiency comes from the class progression table in
// `@pathway/core`; per the same rules text, gaining a focus spell makes you
// "trained in spell attacks and spell DCs", so we floor the rank at trained.

/** A focus-using class's spellcasting attribute and tradition for focus spells. */
export interface FocusConfig {
  keyAbility: AbilityKey;
  /** Fixed tradition, when the class has one. */
  tradition?: Tradition;
  /** Traditions to choose from, when the class lets the player pick. */
  traditionChoices?: Tradition[];
}

/** Focus-using classes that are NOT among the eight full casters. */
const FOCUS_ONLY: Record<string, FocusConfig> = {
  monk: { keyAbility: 'wis', traditionChoices: ['divine', 'occult'] },
  champion: { keyAbility: 'cha', tradition: 'divine' },
  ranger: { keyAbility: 'wis', tradition: 'primal' },
  magus: { keyAbility: 'int', tradition: 'arcane' },
  summoner: { keyAbility: 'cha', traditionChoices: ['arcane', 'divine', 'occult', 'primal'] },
  animist: { keyAbility: 'wis', tradition: 'divine' },
};

/** The focus config for a class, if it can have focus spells at all. */
export function focusConfig(classId?: string, subclassId?: string): FocusConfig | undefined {
  const caster = casterConfig(classId, subclassId);
  if (caster) return { keyAbility: caster.keyAbility, tradition: caster.tradition };
  return classId ? FOCUS_ONLY[classId] : undefined;
}

/** Resolve the focus tradition for a build (honoring a stored player choice). */
export function focusTraditionFor(state: BuilderState): Tradition | undefined {
  const cfg = focusConfig(state.classId, state.subclassId);
  if (!cfg) return undefined;
  if (cfg.tradition) return cfg.tradition;
  const chosen = state.spellcasting?.focusTradition as Tradition | undefined;
  return chosen && cfg.traditionChoices?.includes(chosen) ? chosen : cfg.traditionChoices?.[0];
}

/** Non-cantrip focus spells a class can draw on (joined by the class trait). */
export function focusSpellsFor(classId?: string): Spell[] {
  if (!classId) return [];
  return getDataset()
    .spells.filter((s) => isFocus(s) && !isCantrip(s) && s.traits.includes(classId))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

/** Focus cantrips a class can draw on (currently none ship in the seed data). */
export function focusCantripsFor(classId?: string): Spell[] {
  if (!classId) return [];
  return getDataset()
    .spells.filter((s) => isFocus(s) && isCantrip(s) && s.traits.includes(classId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Focus spellcasting proficiency rank (1–4). Reads the class's spellcasting
 * track from `@pathway/core`, floored at trained (1) — gaining a focus spell
 * grants trained proficiency in focus spell attacks/DCs (Remaster rules).
 */
export function focusRank(state: BuilderState): 1 | 2 | 3 | 4 {
  const level = state.level || 1;
  const core = state.classId ? proficiencyRankAtLevel(state.classId, 'spellcasting', level) : 0;
  return Math.max(1, core) as 1 | 2 | 3 | 4;
}

/** Focus spell attack modifier and DC, plus the resolved tradition. */
export function focusStats(
  state: BuilderState,
): { attack: number; dc: number; ability: AbilityKey; tradition: Tradition; rank: 1 | 2 | 3 | 4 } | null {
  const cfg = focusConfig(state.classId, state.subclassId);
  const tradition = focusTraditionFor(state);
  if (!cfg || !tradition) return null;
  const level = state.level || 1;
  const mods = computeAbilityScores(state);
  const abilityMod = abilityModifier(mods[cfg.keyAbility]);
  const pwl = opt(state, OPT.proficiencyWithoutLevel);
  const rank = focusRank(state);
  const bonus = proficiencyBonus(rank, level, pwl);
  return { attack: bonus + abilityMod, dc: 10 + bonus + abilityMod, ability: cfg.keyAbility, tradition, rank };
}

/**
 * Focus pool size for a build: the number of focus spells known, capped at 3
 * (Remaster focus pool rule). Focus cantrips count as focus spells known.
 */
export function focusPoolSize(state: BuilderState): number {
  const sc = state.spellcasting;
  const known = (sc?.focusSpells?.length ?? 0) + (sc?.focusCantrips?.length ?? 0);
  return Math.min(3, known);
}

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
