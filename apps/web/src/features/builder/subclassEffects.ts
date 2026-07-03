/**
 * Subclass effects. The mechanical rules (tradition, racket ability, focus
 * points, armor proficiency) now live in `@pathway/core` and are re-exported
 * here so existing imports keep resolving.
 *
 * `grantedFocusSpell` stays in the app layer on purpose: it maps a subclass to a
 * focus spell *display name*, which is Paizo Product Identity (flavor), not a
 * derived rules value. Keeping it out of ORC-clean `@pathway/core` parks it with
 * the rest of the tracked PI cleanup debt.
 */

export {
  subclassTradition,
  rogueRacketAbility,
  focusPoints,
  subclassArmorRank,
  ROGUE_RACKET_ABILITY,
} from '@pathway/core';
export type { Tradition } from '@pathway/core';

// The specific focus spell a subclass grants at level 1, where it's a clear,
// well-known mapping. (Other focus-granting subclasses still grant a focus point
// in core; their spell is surfaced via the subclass description.)
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
