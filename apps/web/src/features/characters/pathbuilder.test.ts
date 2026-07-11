// Tests for the sheet-side readers of pathbuilder_data.
//
// These helpers turn the frozen export into displayed numbers. Each case here
// locks a modifier the sheet used to drop even though the JSON carried it:
// resilient runes on saves, striking runes on damage dice, the Proficiency
// Without Level flag embedded in _pathwayBuild, and class DC's rank math.

import { describe, expect, it } from 'vitest';
import {
  classDC,
  proficiencyBonus,
  saveBonus,
  usesPwl,
  weaponDamage,
  type PathbuilderBuild,
} from './pathbuilder';

/** A level-9 martial: Con +3, Str +4, Wis +1, expert (4) ranks unless noted. */
function build(overrides: Partial<PathbuilderBuild> = {}): PathbuilderBuild {
  return {
    level: 9,
    keyability: 'str',
    abilities: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 10 },
    proficiencies: { fortitude: 6, reflex: 4, will: 4, perception: 6, classDC: 2 },
    ...overrides,
  };
}

describe('saveBonus', () => {
  it('rank + level + ability with no rune', () => {
    // Fortitude: master (6) + level 9 + Con +3.
    expect(saveBonus(build(), 'fortitude')).toBe(6 + 9 + 3);
  });

  it('adds the worn armor\'s resilient rune to every save', () => {
    const b = build({
      armor: [{ name: 'Full Plate', worn: true, res: 'greaterResilient' }],
    });
    expect(saveBonus(b, 'fortitude')).toBe(6 + 9 + 3 + 2);
    expect(saveBonus(b, 'reflex')).toBe(4 + 9 + 2 + 2);
    expect(saveBonus(b, 'will')).toBe(4 + 9 + 1 + 2);
  });

  it('ignores a resilient marker on a shield entry', () => {
    const b = build({
      armor: [
        { name: 'Steel Shield', prof: 'shield', res: 'resilient' },
        { name: 'Leather Armor', worn: true },
      ],
    });
    expect(saveBonus(b, 'fortitude')).toBe(6 + 9 + 3);
  });
});

describe('weaponDamage', () => {
  it('one die without a striking rune', () => {
    expect(weaponDamage({ name: 'Longsword', die: 'd8', damageBonus: 4, damageType: 'S' })).toBe(
      '1d8+4 slashing',
    );
  });

  it('striking runes add damage dice (runes[] or the str field)', () => {
    const base = { name: 'Longsword', die: 'd8', damageBonus: 4, damageType: 'S' };
    expect(weaponDamage({ ...base, runes: ['striking'] })).toBe('2d8+4 slashing');
    expect(weaponDamage({ ...base, runes: ['greaterStriking'] })).toBe('3d8+4 slashing');
    expect(weaponDamage({ ...base, str: 'majorStriking' })).toBe('4d8+4 slashing');
  });

  it('a non-striking rune does not add dice', () => {
    expect(
      weaponDamage({ name: 'Longsword', die: 'd8', damageBonus: 4, damageType: 'S', runes: ['greaterFlaming'] }),
    ).toBe('1d8+4 slashing');
  });
});

describe('Proficiency Without Level (_pathwayBuild.options)', () => {
  const pwl = { _pathwayBuild: { options: { proficiencyWithoutLevel: true } } };

  it('is off for plain Pathbuilder JSON and off-flag builds', () => {
    expect(usesPwl(build())).toBe(false);
    expect(usesPwl(build({ _pathwayBuild: { options: {} } }))).toBe(false);
    expect(usesPwl(build(pwl))).toBe(true);
  });

  it('drops the level term from every proficiency-based number', () => {
    expect(proficiencyBonus(build(), 6, 'con')).toBe(6 + 9 + 3);
    expect(proficiencyBonus(build(pwl), 6, 'con')).toBe(6 + 3);
    expect(saveBonus(build(pwl), 'fortitude')).toBe(6 + 3);
    expect(classDC(build(pwl))).toBe(10 + 2 + 4);
  });
});

describe('classDC', () => {
  it('10 + rank bonus + key ability', () => {
    // Trained (2) at level 9, Str +4.
    expect(classDC(build())).toBe(10 + 2 + 9 + 4);
  });

  it('untrained adds neither rank nor level', () => {
    expect(classDC(build({ proficiencies: { classDC: 0 } }))).toBe(10 + 4);
  });
});
