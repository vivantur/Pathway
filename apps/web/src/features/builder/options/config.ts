/**
 * The catalog of character/app options, grouped like Pathbuilder's settings.
 *
 * `implemented: true` means the toggle actually changes behavior today.
 * `implemented: false` means it's shown for parity/roadmap but is inert — the
 * `note` says what it's waiting on. We never let an inert toggle silently
 * pretend to work.
 */
export type OptionScope = 'character' | 'global';

export interface OptionDef {
  id: string;
  label: string;
  scope: OptionScope;
  implemented: boolean;
  /** Shown when not implemented, or as extra help when implemented. */
  note?: string;
}

export interface OptionGroup {
  title: string;
  options: OptionDef[];
}

export const OPTION_GROUPS: OptionGroup[] = [
  {
    title: 'Character Options',
    options: [
      { id: 'confirmSpellbook', label: 'Confirm when adding/removing from spellbook?', scope: 'character', implemented: false, note: 'Needs the spellbook feature (Increment 4).' },
      { id: 'separateAdventurersKit', label: "Separate Adventurer's Kit into individual inventory items?", scope: 'character', implemented: false, note: 'Needs the inventory feature (Increment 3).' },
      { id: 'genericCompanion', label: 'Add generic companion (used by 3rd party custom packs)', scope: 'character', implemented: false, note: 'Needs the companion feature.' },
      { id: 'genericCaster', label: 'Add generic caster for staves etc?', scope: 'character', implemented: false, note: 'Needs the spellcasting feature.' },
      { id: 'showRareFeats', label: 'Display rare feats (Aftermath, Deviant, etc.)?', scope: 'character', implemented: true, note: 'Rare feats are hidden from the feat pickers by default (they need GM permission); turn this on to choose them.' },
    ],
  },
  {
    title: 'App Global Options',
    options: [
      { id: 'autosave', label: 'Autosave character?', scope: 'global', implemented: true, note: 'Automatically saves an already-saved character to your vault as you edit.' },
      { id: 'showDiceButtons', label: 'Show dice rolling buttons', scope: 'global', implemented: false, note: 'Needs the dice roller.' },
      { id: 'playDiceSound', label: 'Play dice rolling sound', scope: 'global', implemented: false, note: 'Needs the dice roller.' },
      { id: 'openDialogsWithFilters', label: 'Open dialogs with filters visible?', scope: 'global', implemented: false, note: 'Filters already show inline; dialog mode is planned.' },
      { id: 'showCursedItems', label: 'Show cursed items?', scope: 'global', implemented: false, note: 'Needs the item catalog (Increment 3).' },
      { id: 'disableBackupWarnings', label: 'Disable database backup warnings?', scope: 'global', implemented: false, note: 'Needs account sync.' },
      { id: 'disableAllAutosaving', label: 'Disable all automatic saving?', scope: 'global', implemented: true, note: 'Overrides Autosave; you save manually with the Save button.' },
    ],
  },
  {
    title: 'Remaster Options (for this character)',
    options: [
      { id: 'showMythic', label: 'Show Mythic options?', scope: 'character', implemented: false, note: 'Needs mythic content.' },
      { id: 'updatedMagusPsychicSpells', label: 'Use updated spells for magus and psychic?', scope: 'character', implemented: false, note: 'Needs the spell data.' },
    ],
  },
  {
    title: 'Advanced Options',
    options: [
      { id: 'freeArchetype', label: 'Use Free Archetype variant rules?', scope: 'character', implemented: true, note: 'Adds an archetype feat slot at even levels; the dataset carries 1,800+ archetype feats including dedications.' },
      { id: 'removeFreeArchetypeFeatRestrictions', label: 'Remove Free Archetype feat restrictions?', scope: 'character', implemented: false, note: 'Needs archetype content.' },
      { id: 'removeFreeArchetypeAbilityRequirements', label: 'Remove Free Archetype ability requirements', scope: 'character', implemented: false, note: 'Needs archetype content.' },
      { id: 'automaticBonusProgression', label: 'Use Automatic Bonus Progression variant rules?', scope: 'character', implemented: true, note: 'Replaces the “big six” magic items with automatic bonuses by level (attack, AC, saves, Perception, extra weapon dice).' },
      { id: 'proficiencyWithoutLevel', label: 'Use Proficiency Without Level variant rules?', scope: 'character', implemented: true, note: 'Removes your level from proficiency-based numbers (a lower-magic play style).' },
      { id: 'ancestryParagon', label: 'Use Ancestry Paragon variant rules?', scope: 'character', implemented: true, note: 'Grants extra ancestry feats (levels 1, 3, 7, 11, 15, 19).' },
      { id: 'gradualAbilityBoosts', label: 'Use Gradual Ability Boost variant rules?', scope: 'character', implemented: true, note: 'Spreads the four level-up boosts across several levels instead of all at once.' },
      { id: 'applyMythicCustomOnly', label: 'Apply Mythic via custom feat choices only?', scope: 'character', implemented: false, note: 'Needs mythic content.' },
      { id: 'mythicDestiniesAsArchetypes', label: 'Use Mythic Destinies as high level archetypes?', scope: 'character', implemented: false, note: 'Needs mythic content.' },
      { id: 'legacyDualClass', label: 'Use Legacy GMG Dual Classing variant rules?', scope: 'character', implemented: false, note: 'Planned — a second class.' },
      { id: 'legacyStamina', label: 'Use Legacy GMG Stamina variant rules?', scope: 'character', implemented: true, note: 'Adds Stamina Points and Resolve Points (GMG formula — confirm with your GM).' },
    ],
  },
];

/** Option ids the rules engine reads (kept here so string ids stay canonical). */
export const OPT = {
  freeArchetype: 'freeArchetype',
  ancestryParagon: 'ancestryParagon',
  showRareFeats: 'showRareFeats',
  proficiencyWithoutLevel: 'proficiencyWithoutLevel',
  gradualAbilityBoosts: 'gradualAbilityBoosts',
  automaticBonusProgression: 'automaticBonusProgression',
  legacyStamina: 'legacyStamina',
  autosave: 'autosave',
  disableAllAutosaving: 'disableAllAutosaving',
} as const;
