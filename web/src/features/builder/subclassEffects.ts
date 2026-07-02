import type { AbilityKey } from '@/features/builder/data';
import type { BuilderState } from './types';

/**
 * Mechanical effects a level-1 subclass choice has on the build. Kept focused on
 * effects that concretely change the numbers and are unambiguously correct:
 *  - a caster's magic tradition (sorcerer bloodline, witch patron)
 *  - a rogue's key ability (racket)
 *  - whether the subclass grants a focus spell (→ a focus point)
 * Situational/feat-like grants (rage damage, hunted-prey bonuses, kineticist
 * impulses) are surfaced via the subclass description for now.
 */
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
  return undefined;
}

export function rogueRacketAbility(subclassId?: string): AbilityKey | undefined {
  return subclassId ? ROGUE_RACKET_ABILITY[subclassId] : undefined;
}

/** Level-1 focus points granted by the subclass choice (0 or 1). */
export function focusPoints(state: BuilderState): number {
  return state.classId && FOCUS_SUBCLASS_CLASSES.has(state.classId) && state.subclassId ? 1 : 0;
}

// The specific focus spell a subclass grants at level 1, where it's a clear,
// well-known mapping. (Other focus-granting subclasses still grant a focus
// point above; their spell is surfaced via the subclass description.)
const SUBCLASS_FOCUS_SPELL: Record<string, Record<string, string>> = {
  druid: { animal: 'Heal Animal', leaf: 'Goodberry', storm: 'Tempest Surge', untamed: 'Untamed Form' },
  sorcerer: {
    aberrant: 'Tentacular Limbs',
    angelic: 'Angelic Halo',
    demonic: "Glutton's Jaw",
    diabolic: 'Diabolic Edict',
    draconic: 'Dragon Claws',
    elemental: 'Elemental Toss',
    fey: 'Faerie Dust',
    hag: 'Jealous Hex',
    imperial: 'Ancestral Memories',
    undead: 'Touch of Undeath',
  },
};

export function grantedFocusSpell(classId?: string, subclassId?: string): string | undefined {
  if (!classId || !subclassId) return undefined;
  return SUBCLASS_FOCUS_SPELL[classId]?.[subclassId];
}

/** Armor proficiency a subclass grants beyond the class default (e.g. Ruffian → medium). */
export function subclassArmorRank(state: BuilderState, category: string): number {
  if (state.classId === 'rogue' && state.subclassId === 'ruffian' && category === 'medium') return 1;
  return 0;
}
