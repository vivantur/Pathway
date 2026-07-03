/**
 * A tiny hand-authored dataset + state builders for the engine's worked-example
 * tests. Kept small and ORC-safe (invented labels only) so the numbers are easy
 * to verify by hand against the PF2e rules the engine implements.
 */

import type { Dataset } from './schema';
import { emptyBuilderState, type BuilderState } from './character';

export const testDataset: Dataset = {
  ancestries: [
    {
      id: 'testfolk',
      name: 'Testfolk',
      hp: 8,
      size: 'medium',
      speed: 25,
      boosts: ['con', 'free'],
      flaws: ['cha'],
      languages: [],
      bonusLanguages: 0,
      bonusLanguageChoices: [],
      traits: [],
      heritages: [{ id: 'hardy', ancestryId: 'testfolk', name: 'Hardy', description: '', source: 'test' }],
      source: 'test',
      description: '',
    },
  ],
  versatileHeritages: [],
  backgrounds: [
    {
      id: 'warrior-bg',
      name: 'Warrior Background',
      boosts: [['str', 'con'], 'free'],
      trainedSkill: 'athletics',
      loreSkill: 'warfare',
      source: 'test',
      description: '',
    },
  ],
  classes: [
    {
      id: 'fighter',
      name: 'Fighter',
      keyAbility: ['str'],
      hp: 10,
      initialProficiencies: {
        perception: 1,
        fortitude: 3,
        reflex: 2,
        will: 1,
        classDC: 1,
        trainedSkillCount: 3,
        trainedSkills: ['athletics'],
        attacks: { unarmed: 2, simple: 2, martial: 2, advanced: 1, unarmored: 2 },
        defenses: { unarmored: 1, light: 1, medium: 1, heavy: 1 },
      },
      proficiencyIncreases: [
        { level: 5, target: 'attacks.martial', rank: 3 },
        { level: 9, target: 'will', rank: 2 },
      ],
      source: 'test',
      description: '',
    },
    {
      id: 'wizard',
      name: 'Wizard',
      keyAbility: ['int'],
      hp: 6,
      initialProficiencies: {
        perception: 1,
        fortitude: 1,
        reflex: 1,
        will: 2,
        classDC: 1,
        trainedSkillCount: 2,
        trainedSkills: ['arcana'],
        attacks: { unarmed: 1, simple: 1, martial: 0, advanced: 0, unarmored: 1 },
        defenses: { unarmored: 1, light: 0, medium: 0, heavy: 0 },
      },
      proficiencyIncreases: [
        { level: 1, target: 'spell', rank: 1 },
        { level: 7, target: 'spell', rank: 2 },
      ],
      source: 'test',
      description: '',
    },
  ],
  skills: [
    { id: 'athletics', name: 'Athletics', ability: 'str' },
    { id: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
    { id: 'arcana', name: 'Arcana', ability: 'int' },
    { id: 'intimidation', name: 'Intimidation', ability: 'cha' },
    { id: 'medicine', name: 'Medicine', ability: 'wis' },
  ],
  feats: [],
  items: [
    {
      id: 'longsword',
      kind: 'weapon',
      name: 'Longsword',
      category: 'martial',
      group: 'sword',
      damageDie: 'd8',
      damageType: 'S',
      hands: '1',
      ranged: false,
      traits: [],
      bulk: '1',
      price: 1,
      source: 'test',
    },
    {
      id: 'leather',
      kind: 'armor',
      name: 'Leather Armor',
      category: 'light',
      acBonus: 1,
      dexCap: 4,
      strength: 10,
      checkPenalty: 0,
      speedPenalty: 0,
      group: 'leather',
      traits: [],
      bulk: '1',
      price: 2,
      source: 'test',
    },
  ],
  spells: [
    { id: 'cantrip-a', name: 'Arc Bolt', rank: 0, traditions: ['arcane'], traits: ['cantrip'], cast: '2', source: 'test', description: '' },
    { id: 'spell-1a', name: 'Arc Blast', rank: 1, traditions: ['arcane'], traits: [], cast: '2', source: 'test', description: '' },
  ],
  provenance: 'seed',
  attribution: 'test',
};

/** A complete, valid level-1 fighter used across the worked-example tests. */
export function fighterState(): BuilderState {
  return {
    ...emptyBuilderState(),
    name: 'Test Fighter',
    level: 1,
    ancestryId: 'testfolk',
    heritageId: 'hardy',
    backgroundId: 'warrior-bg',
    classId: 'fighter',
    keyAbility: 'str',
    // testfolk boosts ['con','free']: one free slot → dex.
    ancestryBoostChoices: ['dex'],
    // warrior-bg boosts [['str','con'],'free']: restricted → str, free → wis.
    backgroundBoostChoices: ['str', 'wis'],
    freeBoosts: ['str', 'dex', 'con', 'int'],
    skillChoices: ['acrobatics', 'arcana', 'intimidation', 'medicine'],
    inventory: [
      { itemId: 'longsword', qty: 1, equipped: true },
      { itemId: 'leather', qty: 1, equipped: true },
    ],
  };
}
