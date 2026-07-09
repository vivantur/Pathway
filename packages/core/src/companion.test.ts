import { describe, expect, it } from 'vitest';
import { findCompanionType, scaleCompanion } from './companion.js';

const wolf = findCompanionType('wolf')!;

describe('companion catalog', () => {
  it('exposes the wolf with its young baseline', () => {
    expect(wolf).toBeDefined();
    expect(wolf.hp).toBe(6);
    expect(wolf.abilityMods).toEqual({ str: 2, dex: 3, con: 2, int: -4, wis: 1, cha: 0 });
    expect(wolf.attacks[0]).toMatchObject({ name: 'jaws', damageDie: '1d8', damageType: 'piercing' });
  });

  it('is case-insensitive on slug', () => {
    expect(findCompanionType('WOLF')?.slug).toBe('wolf');
    expect(findCompanionType('nope')).toBeUndefined();
  });
});

describe('scaleCompanion — young wolf at level 1', () => {
  const c = scaleCompanion(wolf, 1, 'young');
  it('HP = (typeHp + conMod) × level', () => expect(c.maxHp).toBe(8)); // (6+2)*1
  it('AC = 10 + (level+2 trained) + dex', () => expect(c.ac).toBe(16)); // 10+3+3
  it('perception = (level+2) + wis', () => expect(c.perception).toBe(4)); // 3+1
  it('saves', () => expect(c.saves).toEqual({ fortitude: 5, reflex: 6, will: 4 }));
  it('attack uses the better of str/dex for finesse', () =>
    expect(c.attacks[0]).toMatchObject({ attack: 6, damage: '1d8', damageBonus: 2 })); // prof3 + dex3; str2
  it('type skill at trained', () => expect(c.skill).toEqual({ name: 'survival', modifier: 4 })); // 3+1
  it('stays small', () => expect(c.size).toBe('small'));
});

describe('scaleCompanion — mature wolf at level 5', () => {
  const c = scaleCompanion(wolf, 5, 'mature');
  it('applies +1 Str/Dex/Con/Wis', () =>
    expect(c.abilityMods).toMatchObject({ str: 3, dex: 4, con: 3, wis: 2 }));
  it('HP uses the raised Con mod', () => expect(c.maxHp).toBe(45)); // (6+3)*5
  it('AC', () => expect(c.ac).toBe(21)); // 10 + (5+2) + 4
  it('Perception/saves go to expert', () => {
    expect(c.perception).toBe(11); // (5+4) + 2
    expect(c.saves).toEqual({ fortitude: 12, reflex: 13, will: 11 });
  });
  it('attack and doubled damage dice', () =>
    expect(c.attacks[0]).toMatchObject({ attack: 11, damage: '2d8', damageBonus: 3 }));
  it('type skill goes to expert', () => expect(c.skill.modifier).toBe(11)); // (5+4)+2
  it('grows one size (small → medium)', () => expect(c.size).toBe('medium'));
});

describe('scaleCompanion — savage wolf at level 8', () => {
  const c = scaleCompanion(wolf, 8, 'savage');
  it('applies savage ability spread (+3 Str, +2 Dex/Con/Wis)', () =>
    expect(c.abilityMods).toMatchObject({ str: 5, dex: 5, con: 4, wis: 3 }));
  it('HP', () => expect(c.maxHp).toBe(80)); // (6+4)*8
  it('adds +3 flat damage on top of doubled dice', () =>
    expect(c.attacks[0]).toMatchObject({ damage: '2d8', damageBonus: 8 })); // str5 + 3
  it('grows two sizes (small → large)', () => expect(c.size).toBe('large'));
});

describe('scaleCompanion — item AC bonus (barding) is capped at +3', () => {
  it('caps the barding bonus', () => {
    const c = scaleCompanion(wolf, 1, 'young', 5);
    expect(c.ac).toBe(19); // 16 + min(3,5)
  });
});

import {
  COMPANION_CATALOG,
  COMPANION_KINDS,
  FAMILIAR_ABILITIES,
  EIDOLON_TYPES,
  familiarBaseStats,
  findFamiliarAbility,
} from './companion.js';

describe('companion kinds + familiars + eidolons', () => {
  it('exposes all five companion kinds', () => {
    expect(COMPANION_KINDS).toEqual(['animal', 'mount', 'familiar', 'eidolon', 'custom']);
  });

  it('has a familiar ability catalog with master abilities flagged', () => {
    expect(FAMILIAR_ABILITIES.length).toBeGreaterThan(40);
    expect(FAMILIAR_ABILITIES.some((a) => a.master)).toBe(true);
    expect(FAMILIAR_ABILITIES.every((a) => a.slug && a.name && a.description)).toBe(true);
  });

  it('looks up a familiar ability by slug', () => {
    const found = FAMILIAR_ABILITIES[0]!;
    expect(findFamiliarAbility(found.slug)).toEqual(found);
    expect(findFamiliarAbility('nope')).toBeUndefined();
  });

  it('familiar HP is 5 per level; speed 25', () => {
    expect(familiarBaseStats(1)).toEqual({ hp: 5, speed: 25 });
    expect(familiarBaseStats(8)).toEqual({ hp: 40, speed: 25 });
  });

  it('ships the full companion catalog', () => {
    expect(COMPANION_CATALOG.length).toBeGreaterThanOrEqual(45);
    const slugs = COMPANION_CATALOG.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length); // unique slugs
  });

  it('offers eidolon subtypes', () => {
    expect(EIDOLON_TYPES.length).toBe(12);
    expect(EIDOLON_TYPES.map((e) => e.slug)).toContain('dragon');
  });
});

import { findEidolonType, scaleEidolon } from './companion.js';

describe('scaleEidolon — Dragon (Marauding build)', () => {
  const dragon = findEidolonType('dragon')!;
  it('exposes builds with armor data', () => {
    expect(dragon.builds.length).toBe(2);
    expect(dragon.builds[0]).toMatchObject({ abilityMods: { str: 4, dex: 2, con: 3 }, acBonus: 2, dexCap: 3 });
  });

  it('level 1: trained everything, summoner-mirrored saves', () => {
    const s = scaleEidolon(dragon, 0, 1);
    // AC = 10 + (1+2 trained unarmored) + min(dex 2, cap 3) + acBonus 2
    expect(s.ac).toBe(17);
    // Perception trained: (1+2) + wis 0
    expect(s.perception).toBe(3);
    // fort expert (summoner base 2): (1+4)+3 ; ref trained: (1+2)+2 ; will expert: (1+4)+0
    expect(s.saves).toEqual({ fortitude: 8, reflex: 5, will: 5 });
    // attack trained: (1+2) + str 4
    expect(s.attack).toBe(7);
    expect(s.specializationDamage).toBe(0);
    expect(s.sharesHp).toBe(true);
    expect(s.secondary).toEqual({ damageDie: '1d6', traits: ['agile', 'finesse'] });
  });

  it('level 13: master attacks (Eidolon Unarmed Mastery), expert unarmored @11, spec +3', () => {
    const s = scaleEidolon(dragon, 0, 13);
    expect(s.attack).toBe(13 + 6 + 4); // level + master(6) + str
    expect(s.ac).toBe(10 + 13 + 4 + 2 + 2); // 10 + level + expert(4) + min(dex,cap)=2 + acBonus 2
    expect(s.specializationDamage).toBe(3); // master rank, pre-15th
  });

  it('level 15: Greater Eidolon Specialization doubles to 6', () => {
    expect(scaleEidolon(dragon, 0, 15).specializationDamage).toBe(6);
  });

  it('clamps a bad build index', () => {
    expect(scaleEidolon(dragon, 99, 1).buildName).toBe(dragon.builds[1]!.name);
  });
});
