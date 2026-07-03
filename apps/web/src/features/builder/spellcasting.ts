/**
 * Thin re-export shim: spellcasting math now lives in `@pathway/core`.
 * Pure helpers come from core directly; dataset-dependent ones are bound to the
 * app's bundled dataset via `./engine`.
 */

export {
  casterConfig,
  isCaster,
  maxSpellRank,
  slotsForRank,
  maxSpellRankFor,
  slotsForRankOf,
} from '@pathway/core';
export type { Tradition, CasterType, CasterConfig, CasterProgression } from '@pathway/core';

import { engine } from './engine';

export const spellStats = engine.spellStats;
export const cantripsFor = engine.cantripsFor;
export const spellsForRank = engine.spellsForRank;
export const subclassNote = engine.subclassNote;
