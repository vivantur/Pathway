/**
 * Thin re-export shim: the derived-stat engine now lives in `@pathway/core`.
 *
 * Dataset-independent functions come straight from core; dataset-dependent ones
 * are the engine bound to the app's bundled dataset (see `./engine`). This file
 * computes nothing itself — it only wires core to the app so existing
 * `from './rules'` imports across the builder keep resolving.
 */

export {
  proficiencyBonus,
  abilityModifier,
  opt,
  RANK_LABEL,
  gainsForLevel,
  choiceSlots,
  unmetAtLevel,
} from '@pathway/core';
export type {
  AbilityScores,
  LevelSlots,
  SkillProficiency,
  EquippedWeapon,
  DerivedCharacter,
} from '@pathway/core';

import { engine } from './engine';

export const computeAbilityScores = engine.computeAbilityScores;
export const skillRankMap = engine.skillRankMap;
export const trainedSkillIds = engine.trainedSkillIds;
export const chosenFeatIds = engine.chosenFeatIds;
export const freeSkillCount = engine.freeSkillCount;
export const deriveCharacter = engine.deriveCharacter;
export const validate = engine.validate;
