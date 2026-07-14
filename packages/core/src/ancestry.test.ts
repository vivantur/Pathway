// Worked-example tests for the ancestry + heritage schemas and adapters.
//
// The four ancestries the owner provided as rules-source (Dwarf, Human, Kobold,
// plus the standalone versatile heritage Ardande + a Dwarf heritage) between them
// exercise every branch: fixed-boosts-plus-flaw vs two-free-no-flaw, Medium vs
// Small, Common vs Uncommon, darkvision vs none, explicit vs "any common" language
// pools, special abilities (Clan Dagger), and versatile vs ancestry-specific
// heritages. Rules text is from the prompt (rules-from-source).

import { describe, it, expect } from 'vitest';
import {
  coerceAncestry,
  coerceHeritage,
  parseAbility,
  parseBoost,
  parseSize,
  parseSpeed,
  ancestrySchema,
  type Ancestry,
  type Heritage,
} from './ancestry.js';

function ancestry(raw: unknown): Ancestry {
  const r = coerceAncestry(raw);
  if (!r.ok) throw new Error(`coerceAncestry failed: ${r.issues.join(' | ')}`);
  return r.ancestry;
}
function heritage(raw: unknown): Heritage {
  const r = coerceHeritage(raw);
  if (!r.ok) throw new Error(`coerceHeritage failed: ${r.issues.join(' | ')}`);
  return r.heritage;
}

describe('coerceAncestry — worked examples', () => {
  it('Dwarf: fixed boosts + flaw, darkvision, a special ability, explicit language pool', () => {
    const a = ancestry({
      name: 'Dwarf',
      traits: 'Dwarf Humanoid',
      source: 'Player Core pg. 43',
      hp: 10,
      size: 'Medium',
      speed: '20 feet',
      boosts: ['Constitution', 'Wisdom', 'Free'],
      flaws: ['Charisma'],
      languages: ['Common', 'Dwarven'],
      bonusLanguages: 0,
      bonusLanguageChoices: ['Gnomish', 'Goblin', 'Jotun', 'Orcish', 'Petran', 'Sakvroth'],
      senses: ['Darkvision'],
      specialAbilities: [
        { name: 'Clan Dagger', description: 'You get one clan dagger for free, given at birth.' },
      ],
      description: 'Dwarves are a short, stocky people who are often stubborn, fierce, and devoted.',
    });

    expect(a).toEqual({
      id: 'dwarf',
      version: 1,
      name: 'Dwarf',
      ownerKind: 'official',
      source: { title: 'Player Core', page: 43 },
      rarity: 'common',
      traits: ['Dwarf', 'Humanoid'],
      isLegacy: false,
      hp: 10,
      size: 'medium',
      speed: 20,
      boosts: ['con', 'wis', 'free'],
      flaws: ['cha'],
      languages: ['Common', 'Dwarven'],
      bonusLanguages: 0,
      bonusLanguageChoices: ['Gnomish', 'Goblin', 'Jotun', 'Orcish', 'Petran', 'Sakvroth'],
      anyCommonLanguage: false,
      senses: ['Darkvision'],
      specialAbilities: [
        { name: 'Clan Dagger', description: 'You get one clan dagger for free, given at birth.' },
      ],
      description: 'Dwarves are a short, stocky people who are often stubborn, fierce, and devoted.',
    });
  });

  it('Human: two free boosts, no flaw, no senses, "any common" language pool (bonusLanguages 1)', () => {
    const a = ancestry({
      name: 'Human',
      traits: 'Human Humanoid',
      source: 'Player Core pg. 63',
      hp: 8,
      size: 'Medium',
      speed: '25 feet',
      boosts: ['Free', 'Free'],
      flaws: [],
      languages: ['Common'],
      bonusLanguages: 1,
      anyCommonLanguage: true,
      bonusLanguageChoices: [],
      description: 'Humans are diverse and adaptable people with wide potential.',
    });

    expect(a.boosts).toEqual(['free', 'free']);
    expect(a.flaws).toEqual([]);
    expect(a.bonusLanguages).toBe(1);
    expect(a.anyCommonLanguage).toBe(true);
    expect(a.bonusLanguageChoices).toEqual([]);
    expect(a.senses).toEqual([]);
    expect(a.specialAbilities).toEqual([]);
    expect(a.rarity).toBe('common');
    expect(a.traits).toEqual(['Human', 'Humanoid']);
  });

  it('Kobold: Uncommon, Small, fixed boosts + flaw, darkvision', () => {
    const a = ancestry({
      name: 'Kobold',
      traits: 'Uncommon Humanoid Kobold',
      source: 'Player Core 2 pg. 21',
      hp: 6,
      size: 'Small',
      speed: '25 feet',
      boosts: ['Dexterity', 'Charisma', 'Free'],
      flaws: ['Constitution'],
      languages: ['Common', 'Sakvroth'],
      bonusLanguages: 0,
      bonusLanguageChoices: ['Aklo', 'Diabolic', 'Draconic', 'Dwarven', 'Empyrean', 'Fey', 'Gnomish', 'Petran'],
      senses: ['Darkvision'],
      description: 'Kobolds are small and reptilian, with features marked by the power they follow.',
    });

    expect(a.rarity).toBe('uncommon');
    expect(a.traits).toEqual(['Humanoid', 'Kobold']);
    expect(a.size).toBe('small');
    expect(a.speed).toBe(25);
    expect(a.boosts).toEqual(['dex', 'cha', 'free']);
    expect(a.flaws).toEqual(['con']);
    expect(a.source).toEqual({ title: 'Player Core 2', page: 21 });
  });
});

describe('coerceHeritage', () => {
  it('Ardande: standalone versatile heritage, Uncommon, no ancestry', () => {
    const h = heritage({
      name: 'Ardande',
      traits: 'Uncommon',
      source: 'Rage of Elements pg. 47',
      versatile: true,
      ancestryId: '',
      description: 'You descend from wood elementals or a heritage influenced by the Plane of Wood.',
    });

    expect(h).toEqual({
      id: 'ardande',
      version: 1,
      name: 'Ardande',
      ownerKind: 'official',
      source: { title: 'Rage of Elements', page: 47 },
      rarity: 'uncommon',
      traits: [],
      isLegacy: false,
      ancestryId: '',
      versatile: true,
      description: 'You descend from wood elementals or a heritage influenced by the Plane of Wood.',
    });
  });

  it('Ancient-Blooded Dwarf: ancestry-specific heritage keyed by ancestryId', () => {
    const h = heritage({
      name: 'Ancient-Blooded Dwarf',
      source: 'Player Core pg. 43',
      ancestryId: 'dwarf',
      versatile: false,
      description: "Dwarven heroes of old could shrug off their enemies' magic.",
    });

    expect(h.id).toBe('ancient_blooded_dwarf');
    expect(h.ancestryId).toBe('dwarf');
    expect(h.versatile).toBe(false);
    expect(h.rarity).toBe('common');
  });
});

describe('coerceAncestry / coerceHeritage — rejections', () => {
  it('rejects an ancestry with no name', () => {
    const r = coerceAncestry({ hp: 8, size: 'medium', speed: 25, description: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/name/);
  });

  it('rejects an ancestry with an unparseable size', () => {
    const r = coerceAncestry({ name: 'X', hp: 8, size: 'Colossal', speed: 25, description: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/size/);
  });

  it('rejects an ancestry with no HP', () => {
    const r = coerceAncestry({ name: 'X', size: 'medium', speed: 25, description: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/hp/);
  });

  it('rejects a heritage with no name', () => {
    const r = coerceHeritage({ ancestryId: 'dwarf', description: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/name/);
  });
});

describe('ancestry parse helpers', () => {
  it('parseAbility normalizes full names and abbreviations', () => {
    expect(parseAbility('Constitution')).toBe('con');
    expect(parseAbility('wis')).toBe('wis');
    expect(parseAbility('Charisma')).toBe('cha');
    expect(parseAbility('nonsense')).toBeUndefined();
  });

  it('parseBoost handles free, fixed, and restricted-choice', () => {
    expect(parseBoost('Free')).toBe('free');
    expect(parseBoost('Dexterity')).toBe('dex');
    expect(parseBoost(['str', 'dex'])).toEqual(['str', 'dex']); // restricted choice
    expect(parseBoost(['con'])).toBe('con'); // single-element array collapses
  });

  it('parseSize and parseSpeed', () => {
    expect(parseSize('Medium')).toBe('medium');
    expect(parseSize('small')).toBe('small');
    expect(parseSize('Colossal')).toBeUndefined();
    expect(parseSpeed('20 feet')).toBe(20);
    expect(parseSpeed(30)).toBe(30);
    expect(parseSpeed('fast')).toBeNaN();
  });

  it('a restricted-choice boost round-trips through the schema', () => {
    const base = ancestry({
      name: 'Test', source: 'Test Book pg. 1', hp: 8, size: 'medium', speed: 25,
      boosts: ['Strength'], flaws: [], languages: ['Common'], description: 'ok',
    });
    const withChoice = { ...base, boosts: [['str', 'dex'], 'free'] };
    expect(ancestrySchema.safeParse(withChoice).success).toBe(true);
  });
});
