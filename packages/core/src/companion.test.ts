import { describe, expect, it } from 'vitest';
import { findCompanionType, isMountType, scaleCompanion } from './companion.js';

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
  // Player Core pg. 206: "ancestry Hit Points from its type, plus a number of
  // Hit Points equal to 6 plus its Constitution modifier for each level".
  it('HP = ancestryHp + (6 + conMod) × level', () => expect(c.maxHp).toBe(14)); // 6 + (6+2)*1
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
  it('HP uses the raised Con mod', () => expect(c.maxHp).toBe(51)); // 6 + (6+3)*5
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
  it('HP', () => expect(c.maxHp).toBe(86)); // 6 + (6+4)*8
  it('adds +3 flat damage on top of doubled dice', () =>
    expect(c.attacks[0]).toMatchObject({ damage: '2d8', damageBonus: 8 })); // str5 + 3
  it('grows two sizes (small → large)', () => expect(c.size).toBe('large'));
});

describe('size growth re-checks "Medium or smaller" at every stage (PC pg. 211)', () => {
  // Both mature and savage grow the companion only "if your companion is
  // Medium or smaller" — a Medium base grows once at mature and is then Large,
  // so the savage stage's check fails. Only the mature step applies.
  const horse = findCompanionType('horse')!; // medium base
  it('mature horse: medium → large', () =>
    expect(scaleCompanion(horse, 5, 'mature').size).toBe('large'));
  it('savage horse stops at large (was wrongly huge)', () =>
    expect(scaleCompanion(horse, 10, 'savage').size).toBe('large'));
  it('nimble adds no growth of its own: medium → large via mature only', () =>
    expect(scaleCompanion(horse, 10, 'nimble').size).toBe('large'));

  const drake = findCompanionType('riding drake')!; // large base
  it('a Large base never grows', () => {
    expect(scaleCompanion(drake, 5, 'mature').size).toBe('large');
    expect(scaleCompanion(drake, 10, 'savage').size).toBe('large');
  });
});

describe('scaleCompanion — item AC bonus (barding) is capped at +3', () => {
  it('caps the barding bonus', () => {
    const c = scaleCompanion(wolf, 1, 'young', 5);
    expect(c.ac).toBe(19); // 16 + min(3,5)
  });
});

// Specialized animal companions (Player Core pg. 211): unarmed attacks expert;
// saves + Perception master; +1 Dex, +2 Int; two dice → three dice; additional
// damage 2→4 (nimble) or 3→6 (savage); plus the specialization's own benefit.
describe('scaleCompanion — specialized (savage wolf, level 8, wrecker)', () => {
  const c = scaleCompanion(wolf, 8, 'savage', 0, 'wrecker');
  it('adds the shared package (+1 Dex, +2 Int) plus wrecker Str', () =>
    expect(c.abilityMods).toEqual({ str: 6, dex: 6, con: 4, int: -2, wis: 3, cha: 0 }));
  it('unarmed attacks rise to expert', () =>
    // prof(expert) = 8 + 4 = 12; finesse jaws uses max(Str, Dex) = 6.
    expect(c.attacks[0]!.attack).toBe(18));
  it('three damage dice, savage additional damage 3 → 6', () =>
    expect(c.attacks[0]).toMatchObject({ damage: '3d8', damageBonus: 12 })); // Str 6 + 6
  it('saves and Perception rise to master', () => {
    expect(c.saves).toEqual({ fortitude: 18, reflex: 20, will: 17 }); // prof 14 + mods
    expect(c.perception).toBe(17);
  });
  it('type skill untouched by a non-matching specialization', () =>
    expect(c.skill).toEqual({ name: 'survival', modifier: 15 })); // expert 12 + Wis 3
  it('unarmored defense stays trained for wrecker', () => expect(c.ac).toBe(26)); // 10+10+6
  it('reports the specialization', () => expect(c.specialization?.slug).toBe('wrecker'));
});

describe('scaleCompanion — specialization variants', () => {
  it('tracker raises the matching type skill to master', () => {
    const c = scaleCompanion(wolf, 8, 'savage', 0, 'tracker');
    // Survival master: prof 14 + Wis (3 + 1 tracker) = 18.
    expect(c.skill).toEqual({ name: 'survival', modifier: 18 });
  });

  it('racer raises Fortitude to legendary', () => {
    const c = scaleCompanion(wolf, 8, 'nimble', 0, 'racer');
    // Nimble mods: Str 4, Dex 6, Con 4, Wis 3; spec +1 Dex; racer +1 Con.
    expect(c.saves.fortitude).toBe(8 + 8 + 5); // legendary prof + Con 5
    expect(c.saves.reflex).toBe(8 + 6 + 7); // master prof + Dex 7
  });

  it('daredevil raises unarmored defense to expert', () => {
    const c = scaleCompanion(wolf, 8, 'nimble', 0, 'daredevil');
    // Dex 6 (nimble) + 1 (shared) + 1 (daredevil) = 8; AC 10 + (8+4) + 8.
    expect(c.ac).toBe(30);
  });

  it('nimble additional damage 2 doubles to 4', () => {
    const c = scaleCompanion(wolf, 8, 'nimble', 0, 'tracker');
    expect(c.attacks[0]!.damageBonus).toBe(4 + 4); // Str 4 + doubled nimble bonus
  });

  it('is ignored on young and mature forms (specialized advances nimble/savage)', () => {
    expect(scaleCompanion(wolf, 8, 'young', 0, 'wrecker').specialization).toBeNull();
    expect(scaleCompanion(wolf, 8, 'mature', 0, 'wrecker').specialization).toBeNull();
    expect(scaleCompanion(wolf, 8, 'mature', 0, 'wrecker').attacks[0]!.damage).toBe('2d8');
  });
});

describe('mount special ability + mindless skill', () => {
  it('flags the catalog types whose stat block says "mount"', () => {
    expect(isMountType(findCompanionType('horse')!)).toBe(true);
    expect(isMountType(findCompanionType('riding drake')!)).toBe(true);
    expect(isMountType(findCompanionType('wolf')!)).toBe(false);
  });

  it('mindless companions ("Skill none") derive no type skill', () => {
    const head = findCompanionType('severed head')!;
    expect(scaleCompanion(head, 5, 'young').skill).toBeNull();
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
