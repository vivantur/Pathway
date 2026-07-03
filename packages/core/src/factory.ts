/**
 * `createEngine(dataset)` — bind the dataset-parameterized engine to one dataset
 * so callers can invoke the derived-stat functions without threading the dataset
 * through every call. The engine stays pure; this is just currying.
 *
 * The web app creates a single engine from its bundled dataset and re-exports
 * the bound functions, so no rules value is ever computed outside `@pathway/core`.
 */

import type { Dataset } from './schema';
import type { BuilderState } from './character';
import {
  chosenFeatIds,
  computeAbilityScores,
  deriveCharacter,
  freeSkillCount,
  skillRankMap,
  trainedSkillIds,
  unmetAtLevel,
  validate,
} from './engine';
import {
  cantripsFor,
  spellStats,
  spellsForRank,
  subclassNote,
  type Tradition,
} from './spellcasting';

export interface Engine {
  computeAbilityScores(state: BuilderState): ReturnType<typeof computeAbilityScores>;
  skillRankMap(state: BuilderState): ReturnType<typeof skillRankMap>;
  trainedSkillIds(state: BuilderState): ReturnType<typeof trainedSkillIds>;
  chosenFeatIds(state: BuilderState): ReturnType<typeof chosenFeatIds>;
  freeSkillCount(state: BuilderState): ReturnType<typeof freeSkillCount>;
  deriveCharacter(state: BuilderState): ReturnType<typeof deriveCharacter>;
  validate(state: BuilderState): ReturnType<typeof validate>;
  unmetAtLevel(state: BuilderState, level: number): ReturnType<typeof unmetAtLevel>;
  spellStats(state: BuilderState): ReturnType<typeof spellStats>;
  cantripsFor(tradition: Tradition): ReturnType<typeof cantripsFor>;
  spellsForRank(tradition: Tradition, rank: number): ReturnType<typeof spellsForRank>;
  subclassNote(state: BuilderState): ReturnType<typeof subclassNote>;
}

export function createEngine(dataset: Dataset): Engine {
  return {
    computeAbilityScores: (state) => computeAbilityScores(dataset, state),
    skillRankMap: (state) => skillRankMap(dataset, state),
    trainedSkillIds: (state) => trainedSkillIds(dataset, state),
    chosenFeatIds: (state) => chosenFeatIds(dataset, state),
    freeSkillCount: (state) => freeSkillCount(dataset, state),
    deriveCharacter: (state) => deriveCharacter(dataset, state),
    validate: (state) => validate(dataset, state),
    unmetAtLevel: (state, level) => unmetAtLevel(state, level),
    spellStats: (state) => spellStats(dataset, state),
    cantripsFor: (tradition) => cantripsFor(dataset, tradition),
    spellsForRank: (tradition, rank) => spellsForRank(dataset, tradition, rank),
    subclassNote: (state) => subclassNote(dataset, state),
  };
}
