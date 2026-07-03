import type {
  Ancestry,
  Background,
  CharacterClass,
  Dataset,
  Feat,
  Heritage,
  Item,
  RecommendationSet,
  Skill,
  Spell,
} from '@pathway/core';

import ancestries from './ancestries.json';
import versatileHeritages from './versatile-heritages.json';
import backgrounds from './backgrounds.json';
import classes from './classes.json';
import skills from './skills.json';
import feats from './feats.json';
import items from './items.json';
import spells from './spells.json';
import recommendations from './recommendations.json';

// The content schema now lives in @pathway/core; re-export its surface so
// existing `from '@/features/builder/data'` type imports keep resolving.
export type {
  AbilityKey,
  ProficiencyRank,
  Size,
  Boost,
  Heritage,
  Ancestry,
  Background,
  ClassInitialProficiencies,
  Subclass,
  CharacterClass,
  Skill,
  FeatType,
  Feat,
  Recommendation,
  RecommendationSet,
  WeaponCategory,
  ArmorCategory,
  DamageType,
  Weapon,
  Armor,
  Shield,
  Gear,
  Item,
  Spell,
  Dataset,
} from '@pathway/core';
export { ABILITY_KEYS, ABILITY_NAMES } from '@pathway/core';

const ATTRIBUTION =
  'Pathfinder Second Edition content © Paizo Inc., used under the Community Use Policy / ORC License. ' +
  'Dataset transformed from Player Core material and the Foundry VTT pf2e system.';

/**
 * The bundled dataset. This is the hand-authored **seed** (Player Core core
 * content) that ships with the repo so the builder works with no network.
 *
 * Running `npm run ingest:pf2e` writes a fuller dataset to `data/generated/`;
 * wiring the app to prefer that output is the follow-up step tracked in the
 * W0/W3 build plan.
 */
export const seedDataset: Dataset = {
  ancestries: ancestries as Ancestry[],
  versatileHeritages: versatileHeritages as Heritage[],
  backgrounds: backgrounds as Background[],
  classes: classes as CharacterClass[],
  skills: skills as Skill[],
  feats: feats as Feat[],
  items: items as Item[],
  spells: spells as Spell[],
  provenance: 'seed',
  attribution: ATTRIBUTION,
};

export function getDataset(): Dataset {
  return seedDataset;
}

// Convenience lookups ---------------------------------------------------------

export function findAncestry(id: string): Ancestry | undefined {
  return seedDataset.ancestries.find((a) => a.id === id);
}

/** Find a heritage by id across a given ancestry's heritages AND versatile heritages. */
export function findHeritage(ancestryId: string | undefined, heritageId: string | undefined): Heritage | undefined {
  if (!heritageId) return undefined;
  const ancestry = ancestryId ? findAncestry(ancestryId) : undefined;
  return (
    ancestry?.heritages.find((h) => h.id === heritageId) ??
    seedDataset.versatileHeritages.find((h) => h.id === heritageId)
  );
}

export function findBackground(id: string): Background | undefined {
  return seedDataset.backgrounds.find((b) => b.id === id);
}

export function findClass(id: string): CharacterClass | undefined {
  return seedDataset.classes.find((c) => c.id === id);
}

export function findSkill(id: string): Skill | undefined {
  return seedDataset.skills.find((s) => s.id === id);
}

export function findFeat(id: string): Feat | undefined {
  return seedDataset.feats.find((f) => f.id === id);
}

export function findItem(id: string): Item | undefined {
  return seedDataset.items.find((i) => i.id === id);
}

export function findSpell(id: string): Spell | undefined {
  return seedDataset.spells.find((s) => s.id === id);
}

const RECOMMENDATIONS = recommendations as RecommendationSet;

/** Curated beginner feat recommendations for a class id. */
export function classRecommendations(classId: string | undefined) {
  return (classId && RECOMMENDATIONS.class[classId]) || [];
}

/** Curated beginner feat recommendations for an ancestry id. */
export function ancestryRecommendations(ancestryId: string | undefined) {
  return (ancestryId && RECOMMENDATIONS.ancestry[ancestryId]) || [];
}
