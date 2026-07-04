import { describe, expect, it } from 'vitest';
import { findCompanionType, scaleCompanion } from './companion';

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
