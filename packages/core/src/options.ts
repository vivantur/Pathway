/**
 * Canonical option ids the rules engine reads. Kept here (not in the app's UI
 * config) so the string ids stay a single source of truth shared by every
 * consumer of the engine.
 *
 * The app owns the *presentation* of these options (labels, grouping, whether a
 * toggle is wired up yet); the engine only needs the ids.
 */
export const OPT = {
  freeArchetype: 'freeArchetype',
  ancestryParagon: 'ancestryParagon',
  proficiencyWithoutLevel: 'proficiencyWithoutLevel',
  gradualAbilityBoosts: 'gradualAbilityBoosts',
  automaticBonusProgression: 'automaticBonusProgression',
  legacyStamina: 'legacyStamina',
  autosave: 'autosave',
  disableAllAutosaving: 'disableAllAutosaving',
} as const;
