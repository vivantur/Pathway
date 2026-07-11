// Tests for src/rules/companionScaling.js — the bot's mirror of
// @pathway/core's companion advancement engine (Player Core pg. 206-211).
//
// These assert the SAME worked examples that packages/core's companion.test.ts
// locks, so the two implementations can't silently drift. If a number here
// disagrees with the matching case in core, one of the engines is wrong.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scaleCompanionStats, growSize, findSpecialization } = require('../src/rules/companionScaling.js');

// Wolf — the same baseline core tests against.
const wolf = {
  abilityMods: { str: 2, dex: 3, con: 2, int: -4, wis: 1, cha: 0 },
  ancestryHp: 6,
  size: 'small',
  skill: 'survival',
  attacks: [{ name: 'jaws', traits: ['finesse'], damageDie: '1d8', damageType: 'piercing' }],
};

describe('young wolf at level 1', () => {
  const c = scaleCompanionStats(wolf, 1, 'young');
  it('HP = ancestryHp + (6 + Con) × level', () => expect(c.maxHp).toBe(14)); // 6 + (6+2)*1
  it('AC includes +2 for trained (was the bot bug: level only)', () => expect(c.ac).toBe(16)); // 10 + (1+2) + 3
  it('perception', () => expect(c.perception).toBe(4)); // (1+2) + 1
  it('saves', () => expect(c.saves).toEqual({ fortitude: 5, reflex: 6, will: 4 }));
  it('finesse attack uses the better of Str/Dex', () =>
    expect(c.attacks[0]).toMatchObject({ attack: 6, damage: '1d8', damageBonus: 2 }));
  it('type skill trained', () => expect(c.skill).toEqual({ name: 'survival', modifier: 4 }));
  it('stays small', () => expect(c.size).toBe('small'));
});

describe('mature wolf at level 5', () => {
  const c = scaleCompanionStats(wolf, 5, 'mature');
  it('ability spread +1 Str/Dex/Con/Wis', () =>
    expect(c.abilityMods).toMatchObject({ str: 3, dex: 4, con: 3, wis: 2 }));
  it('HP', () => expect(c.maxHp).toBe(51)); // 6 + (6+3)*5
  it('AC', () => expect(c.ac).toBe(21)); // 10 + (5+2) + 4
  it('perception/saves expert', () => {
    expect(c.perception).toBe(11);
    expect(c.saves).toEqual({ fortitude: 12, reflex: 13, will: 11 });
  });
  it('two damage dice', () => expect(c.attacks[0]).toMatchObject({ attack: 11, damage: '2d8', damageBonus: 3 }));
  it('grows one size', () => expect(c.size).toBe('medium'));
});

describe('savage wolf at level 8', () => {
  const c = scaleCompanionStats(wolf, 8, 'savage');
  it('ability spread', () => expect(c.abilityMods).toMatchObject({ str: 5, dex: 5, con: 4, wis: 3 }));
  it('HP', () => expect(c.maxHp).toBe(86)); // 6 + (6+4)*8
  it('+3 flat damage on doubled dice', () =>
    expect(c.attacks[0]).toMatchObject({ damage: '2d8', damageBonus: 8 }));
  it('grows to large', () => expect(c.size).toBe('large'));
});

describe('specialized savage wolf (wrecker) at level 8', () => {
  const c = scaleCompanionStats(wolf, 8, 'savage', 0, 'wrecker');
  it('shared package +1 Dex, +2 Int plus wrecker Str', () =>
    expect(c.abilityMods).toEqual({ str: 6, dex: 6, con: 4, int: -2, wis: 3, cha: 0 }));
  it('unarmed attacks expert', () => expect(c.attacks[0].attack).toBe(18)); // (8+4) + 6
  it('three dice, additional damage 3 → 6', () =>
    expect(c.attacks[0]).toMatchObject({ damage: '3d8', damageBonus: 12 }));
  it('saves + perception master', () => {
    expect(c.saves).toEqual({ fortitude: 18, reflex: 20, will: 17 });
    expect(c.perception).toBe(17);
  });
  it('reports the specialization', () => expect(c.specialization.slug).toBe('wrecker'));
});

describe('specialization variants', () => {
  it('tracker raises the matching type skill to master', () =>
    expect(scaleCompanionStats(wolf, 8, 'savage', 0, 'tracker').skill).toEqual({ name: 'survival', modifier: 18 }));
  it('racer raises Fortitude to legendary', () => {
    const c = scaleCompanionStats(wolf, 8, 'nimble', 0, 'racer');
    expect(c.saves.fortitude).toBe(8 + 8 + 5); // legendary + Con 5
    expect(c.saves.reflex).toBe(8 + 6 + 7); // master + Dex 7
  });
  it('daredevil raises unarmored defense to expert', () =>
    expect(scaleCompanionStats(wolf, 8, 'nimble', 0, 'daredevil').ac).toBe(30));
  it('is ignored on young/mature forms', () => {
    expect(scaleCompanionStats(wolf, 8, 'young', 0, 'wrecker').specialization).toBeNull();
    expect(scaleCompanionStats(wolf, 8, 'mature', 0, 'wrecker').specialization).toBeNull();
  });
});

describe('mindless companions and size growth', () => {
  const head = { abilityMods: { str: 2, dex: 1, con: 3, int: -5, wis: 0, cha: 0 }, ancestryHp: 4, size: 'small', skill: 'none (mindless)', attacks: [{ name: 'jaws', traits: ['finesse'], damageDie: '1d6', damageType: 'piercing' }] };
  it('mindless type has no derived skill', () => expect(scaleCompanionStats(head, 5, 'young').skill).toBeNull());

  const horse = { abilityMods: { str: 3, dex: 2, con: 2, int: -4, wis: 1, cha: 0 }, ancestryHp: 8, size: 'medium', skill: 'survival', attacks: [{ name: 'hoof', traits: ['agile'], damageDie: '1d6', damageType: 'bludgeoning' }] };
  it('a Medium base grows at mature then stops at large for savage', () => {
    expect(scaleCompanionStats(horse, 5, 'mature').size).toBe('large');
    expect(scaleCompanionStats(horse, 10, 'savage').size).toBe('large');
  });
  it('growSize re-checks the gate each stage', () => {
    expect(growSize('small', 2)).toBe('large');
    expect(growSize('medium', 2)).toBe('large');
    expect(growSize('large', 2)).toBe('large');
  });
});

describe('unknown form degrades to young baseline (no crash)', () => {
  it('handles a garbage form value', () => {
    const c = scaleCompanionStats(wolf, 5, 'bogus');
    expect(c.maxHp).toBe(6 + (6 + 2) * 5); // young formula
    expect(c.specialization).toBeNull();
  });
});

describe('findSpecialization', () => {
  it('resolves the seven specializations, case-insensitive', () => {
    expect(findSpecialization('WRECKER').name).toBe('Wrecker');
    expect(findSpecialization('shade').unarmoredExpert).toBe(true);
    expect(findSpecialization('nope')).toBeNull();
  });
});
