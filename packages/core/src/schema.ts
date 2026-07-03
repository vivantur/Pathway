/**
 * Content schema for Pathway's PF2e dataset — the single source of truth.
 *
 * Defined with Zod so the same shape can be (a) inferred as TypeScript types via
 * `z.infer` for compile-time use in the apps, and (b) validated at the edges
 * (e.g. in `@pathway/db`) at runtime. The apps ship a bundled JSON dataset that
 * conforms to `datasetSchema`.
 *
 * This package is PURE: it declares the shape, it does not load any data.
 */

import { z } from 'zod';

// Abilities ------------------------------------------------------------------

export const abilityKeySchema = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export type AbilityKey = z.infer<typeof abilityKeySchema>;

export const ABILITY_KEYS: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_NAMES: Record<AbilityKey, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/** Proficiency rank: 0 untrained, 1 trained, 2 expert, 3 master, 4 legendary. */
export const proficiencyRankSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type ProficiencyRank = z.infer<typeof proficiencyRankSchema>;

export const sizeSchema = z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']);
export type Size = z.infer<typeof sizeSchema>;

/**
 * A single ability boost slot:
 *  - a fixed ability (e.g. 'con')
 *  - 'free' — the player picks any ability
 *  - an array — a restricted choice among the listed abilities
 */
export const boostSchema = z.union([abilityKeySchema, z.literal('free'), z.array(abilityKeySchema)]);
export type Boost = z.infer<typeof boostSchema>;

// Ancestry / heritage / background -------------------------------------------

export const heritageSchema = z.object({
  id: z.string(),
  /** Empty for versatile heritages (they belong to no single ancestry). */
  ancestryId: z.string(),
  name: z.string(),
  description: z.string(),
  source: z.string(),
  /** True for versatile heritages selectable by any ancestry. */
  versatile: z.boolean().optional(),
  /** Optional extra languages, senses, etc. — free text summaries for now. */
  grants: z.array(z.string()).optional(),
});
export type Heritage = z.infer<typeof heritageSchema>;

export const ancestrySchema = z.object({
  id: z.string(),
  name: z.string(),
  hp: z.number(),
  size: sizeSchema,
  speed: z.number(),
  /** Ability boosts granted at character creation. */
  boosts: z.array(boostSchema),
  /** Ability flaws (fixed). */
  flaws: z.array(abilityKeySchema),
  /** Languages always known. */
  languages: z.array(z.string()),
  /** Number of additional languages the player may choose (Int-gated at build). */
  bonusLanguages: z.number(),
  /** Pool the bonus languages are chosen from. */
  bonusLanguageChoices: z.array(z.string()),
  traits: z.array(z.string()),
  heritages: z.array(heritageSchema),
  source: z.string(),
  description: z.string(),
});
export type Ancestry = z.infer<typeof ancestrySchema>;

export const backgroundSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Usually two boosts; the first commonly a restricted choice, the second free. */
  boosts: z.array(boostSchema),
  /** Skill this background trains. */
  trainedSkill: z.string(),
  /** Lore skill this background trains (free text). */
  loreSkill: z.string(),
  /** Skill feat granted, if any (feat id). */
  skillFeat: z.string().optional(),
  source: z.string(),
  description: z.string(),
});
export type Background = z.infer<typeof backgroundSchema>;

// Class ----------------------------------------------------------------------

export const classInitialProficienciesSchema = z.object({
  perception: proficiencyRankSchema,
  fortitude: proficiencyRankSchema,
  reflex: proficiencyRankSchema,
  will: proficiencyRankSchema,
  classDC: proficiencyRankSchema,
  /** Number of skills the class trains, on top of background/Int. */
  trainedSkillCount: z.number(),
  /** Skills always trained by the class (skill ids). */
  trainedSkills: z.array(z.string()),
  attacks: z.object({
    unarmed: proficiencyRankSchema,
    simple: proficiencyRankSchema,
    martial: proficiencyRankSchema,
    advanced: proficiencyRankSchema,
    unarmored: proficiencyRankSchema,
  }),
  defenses: z.object({
    unarmored: proficiencyRankSchema,
    light: proficiencyRankSchema,
    medium: proficiencyRankSchema,
    heavy: proficiencyRankSchema,
  }),
});
export type ClassInitialProficiencies = z.infer<typeof classInitialProficienciesSchema>;

export const subclassSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
export type Subclass = z.infer<typeof subclassSchema>;

export const characterClassSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Key ability options — player picks one when more than one is offered. */
  keyAbility: z.array(abilityKeySchema),
  /** Hit points granted per level (before Con). */
  hp: z.number(),
  initialProficiencies: classInitialProficienciesSchema,
  /** e.g. "Doctrine", "Muse", "Hunter's Edge" — the level-1 subclass choice label. */
  subclassLabel: z.string().optional(),
  subclasses: z.array(subclassSchema).optional(),
  /** Named class features granted automatically at level 1. */
  features: z.array(z.string()).optional(),
  source: z.string(),
  description: z.string(),
});
export type CharacterClass = z.infer<typeof characterClassSchema>;

// Skills / feats -------------------------------------------------------------

export const skillSchema = z.object({
  id: z.string(),
  name: z.string(),
  ability: abilityKeySchema,
});
export type Skill = z.infer<typeof skillSchema>;

export const featTypeSchema = z.enum(['ancestry', 'class', 'skill', 'general', 'archetype']);
export type FeatType = z.infer<typeof featTypeSchema>;

export const featSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number(),
  type: featTypeSchema,
  traits: z.array(z.string()),
  /** Free-text prerequisites for display; enforcement is best-effort. */
  prerequisites: z.string().optional(),
  /** For class feats: which class id(s) can take it. */
  classIds: z.array(z.string()).optional(),
  /** For ancestry feats: which ancestry id. */
  ancestryId: z.string().optional(),
  /** Optional theme tags for filtering (curated or derived). */
  tags: z.array(z.string()).optional(),
  source: z.string(),
  description: z.string(),
});
export type Feat = z.infer<typeof featSchema>;

/** A curated beginner suggestion: a feat id plus a one-line plain-language reason. */
export const recommendationSchema = z.object({
  featId: z.string(),
  reason: z.string(),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

/** Beginner feat recommendations, keyed by class id and by ancestry id. */
export const recommendationSetSchema = z.object({
  class: z.record(z.array(recommendationSchema)),
  ancestry: z.record(z.array(recommendationSchema)),
});
export type RecommendationSet = z.infer<typeof recommendationSetSchema>;

// Equipment ------------------------------------------------------------------

export const weaponCategorySchema = z.enum(['unarmed', 'simple', 'martial', 'advanced']);
export type WeaponCategory = z.infer<typeof weaponCategorySchema>;

export const armorCategorySchema = z.enum(['unarmored', 'light', 'medium', 'heavy']);
export type ArmorCategory = z.infer<typeof armorCategorySchema>;

export const damageTypeSchema = z.enum(['B', 'P', 'S']);
export type DamageType = z.infer<typeof damageTypeSchema>;

export const weaponSchema = z.object({
  id: z.string(),
  kind: z.literal('weapon'),
  name: z.string(),
  category: weaponCategorySchema,
  group: z.string(),
  damageDie: z.string(), // e.g. 'd6'
  damageType: damageTypeSchema,
  hands: z.string(), // '1', '2', '1+'
  ranged: z.boolean(),
  range: z.number().optional(), // feet, for ranged/thrown
  traits: z.array(z.string()),
  bulk: z.string(), // 'L', '1', '2', '—'
  price: z.number(), // in gp
  source: z.string(),
});
export type Weapon = z.infer<typeof weaponSchema>;

export const armorSchema = z.object({
  id: z.string(),
  kind: z.literal('armor'),
  name: z.string(),
  category: armorCategorySchema,
  acBonus: z.number(),
  dexCap: z.number().nullable(), // null = no cap
  strength: z.number(), // required Str score to avoid penalties
  checkPenalty: z.number(),
  speedPenalty: z.number(), // feet
  group: z.string(),
  traits: z.array(z.string()),
  bulk: z.string(),
  price: z.number(),
  source: z.string(),
});
export type Armor = z.infer<typeof armorSchema>;

export const shieldSchema = z.object({
  id: z.string(),
  kind: z.literal('shield'),
  name: z.string(),
  acBonus: z.number(),
  hardness: z.number(),
  hp: z.number(),
  speedPenalty: z.number(),
  bulk: z.string(),
  price: z.number(),
  source: z.string(),
});
export type Shield = z.infer<typeof shieldSchema>;

export const gearSchema = z.object({
  id: z.string(),
  kind: z.literal('gear'),
  name: z.string(),
  bulk: z.string(),
  price: z.number(),
  description: z.string(),
  source: z.string(),
});
export type Gear = z.infer<typeof gearSchema>;

export const itemSchema = z.discriminatedUnion('kind', [
  weaponSchema,
  armorSchema,
  shieldSchema,
  gearSchema,
]);
export type Item = z.infer<typeof itemSchema>;

// Spells ---------------------------------------------------------------------

export const spellSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Spell rank (1–10); 0-rank cantrips carry the cantrip trait. */
  rank: z.number(),
  /** Magic traditions that have this spell (arcane/divine/occult/primal). */
  traditions: z.array(z.string()),
  traits: z.array(z.string()),
  /** Casting time, e.g. "2" (actions), "1", "reaction". */
  cast: z.string(),
  source: z.string(),
  description: z.string(),
});
export type Spell = z.infer<typeof spellSchema>;

// Dataset --------------------------------------------------------------------

export const datasetSchema = z.object({
  ancestries: z.array(ancestrySchema),
  /** Versatile heritages (selectable by any ancestry). */
  versatileHeritages: z.array(heritageSchema),
  backgrounds: z.array(backgroundSchema),
  classes: z.array(characterClassSchema),
  skills: z.array(skillSchema),
  feats: z.array(featSchema),
  items: z.array(itemSchema),
  spells: z.array(spellSchema),
  /** Where this dataset came from — 'seed' or 'generated'. */
  provenance: z.enum(['seed', 'generated']),
  /** Content attribution (Paizo Community Use / ORC). */
  attribution: z.string(),
});
export type Dataset = z.infer<typeof datasetSchema>;
