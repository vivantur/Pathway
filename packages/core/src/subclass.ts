/**
 * Mechanical effects a level-1 subclass choice has on the build. Kept focused on
 * effects that concretely change the numbers and are unambiguously correct:
 *  - a caster's magic tradition (sorcerer bloodline, witch patron)
 *  - a rogue's key ability (racket)
 *  - whether the subclass grants a focus spell (→ a focus point)
 *  - a subclass that widens armor proficiency (e.g. Ruffian → medium)
 *
 * Situational/feat-like grants (rage damage, hunted-prey bonuses, kineticist
 * impulses) are surfaced via the subclass description in the app, not here.
 *
 * NOTE (ORC debt): the subclass ids below mirror the dataset's own ids. Some are
 * Paizo-derived proper nouns; relabeling them ORC-safe is part of the tracked PI
 * cleanup, not this module's job.
 */

import type { AbilityKey } from './schema';
import type { BuilderState } from './character';

export type Tradition = 'arcane' | 'divine' | 'occult' | 'primal';

const SORCERER_TRADITION: Record<string, Tradition> = {
  aberrant: 'occult',
  angelic: 'divine',
  demonic: 'divine',
  diabolic: 'divine',
  draconic: 'arcane',
  elemental: 'primal',
  fey: 'primal',
  hag: 'occult',
  imperial: 'arcane',
  undead: 'divine',
};

const WITCH_TRADITION: Record<string, Tradition> = {
  'faiths-flamekeeper': 'divine',
  'the-inscribed-one': 'arcane',
  'the-resentment': 'occult',
  'silence-in-snow': 'primal',
  'spinner-of-threads': 'occult',
  'starless-shadow': 'occult',
  'wilding-steward': 'primal',
};

// A summoner's spell tradition follows their eidolon's essence (Player Core 2).
const SUMMONER_TRADITION: Record<string, Tradition> = {
  angel: 'divine',
  beast: 'primal',
  construct: 'arcane',
  dragon: 'arcane',
  elemental: 'primal',
  fey: 'primal',
  fiend: 'divine',
  plant: 'primal',
  psychopomp: 'divine',
  undead: 'divine',
};

export const ROGUE_RACKET_ABILITY: Record<string, AbilityKey> = {
  ruffian: 'str',
  scoundrel: 'cha',
  thief: 'dex',
  mastermind: 'int',
};

/** Classes whose level-1 subclass grants a focus spell (and thus a focus point). */
const FOCUS_SUBCLASS_CLASSES = new Set(['druid', 'sorcerer', 'witch', 'oracle', 'bard', 'psychic']);

/** The tradition a caster's subclass dictates, if any (else use the class default). */
export function subclassTradition(classId?: string, subclassId?: string): Tradition | undefined {
  if (!subclassId) return undefined;
  if (classId === 'sorcerer') return SORCERER_TRADITION[subclassId];
  if (classId === 'witch') return WITCH_TRADITION[subclassId];
  if (classId === 'summoner') return SUMMONER_TRADITION[subclassId];
  return undefined;
}

export function rogueRacketAbility(subclassId?: string): AbilityKey | undefined {
  return subclassId ? ROGUE_RACKET_ABILITY[subclassId] : undefined;
}

/** Level-1 focus points granted by the subclass choice (0 or 1). */
export function focusPoints(state: BuilderState): number {
  return state.classId && FOCUS_SUBCLASS_CLASSES.has(state.classId) && state.subclassId ? 1 : 0;
}

/** Armor proficiency a subclass grants beyond the class default (e.g. Ruffian → medium). */
export function subclassArmorRank(state: BuilderState, category: string): number {
  if (state.classId === 'rogue' && state.subclassId === 'ruffian' && category === 'medium') return 1;
  return 0;
}
