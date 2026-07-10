// Worked-example locks for the derived-stat compositions.
import { describe, expect, it } from 'vitest';
import { armorClass, maxHitPoints, proficientDC, proficientModifier } from './derived.js';

describe('proficientModifier', () => {
  it('is ability mod + proficiency bonus', () => {
    // Trained (rank 1) at level 1 with Wis +3: 3 + (1 + 2) = 6.
    expect(proficientModifier({ abilityMod: 3, rank: 1, level: 1 })).toBe(6);
    // Expert (rank 2) at level 5 with Dex +4: 4 + (5 + 4) = 13.
    expect(proficientModifier({ abilityMod: 4, rank: 2, level: 5 })).toBe(13);
  });

  it('untrained drops the proficiency term but keeps the ability mod', () => {
    expect(proficientModifier({ abilityMod: 2, rank: 0, level: 10 })).toBe(2);
  });

  it('adds item and other bonuses (other can be a negative penalty)', () => {
    // Master (rank 3) at level 12, Con +5, resilient +2, −1 penalty:
    // 5 + (12 + 6) + 2 − 1 = 24.
    expect(
      proficientModifier({ abilityMod: 5, rank: 3, level: 12, itemBonus: 2, otherBonus: -1 }),
    ).toBe(24);
  });

  it('honors Proficiency Without Level (drops the level term)', () => {
    // Expert (rank 2) at level 5 with Dex +4, no level: 4 + 4 = 8.
    expect(proficientModifier({ abilityMod: 4, rank: 2, level: 5, withoutLevel: true })).toBe(8);
  });
});

describe('armorClass', () => {
  it('unarmored is 10 + defense proficiency + full Dex', () => {
    // Level-1 fighter, trained (rank 1) unarmored, Dex +1: 10 + (1+2) + 1 = 14.
    expect(armorClass({ dexMod: 1, dexCap: null, rank: 1, level: 1 })).toBe(14);
  });

  it('caps Dex at the armor Dex cap and adds the armor bonus', () => {
    // Full plate: +6 AC, Dex cap 0; Dex +3 is capped to 0. Trained, level 1:
    // 10 + 3 + 0 + 6 = 19.
    expect(
      armorClass({ dexMod: 3, dexCap: 0, rank: 1, level: 1, armorBonus: 6 }),
    ).toBe(19);
    // Leather: +1 AC, Dex cap 4; Dex +2 is under the cap. Expert, level 5:
    // 10 + (5+4) + 2 + 1 = 22.
    expect(
      armorClass({ dexMod: 2, dexCap: 4, rank: 2, level: 5, armorBonus: 1 }),
    ).toBe(22);
  });

  it('adds the item bonus and honors Proficiency Without Level', () => {
    // Unarmored, trained, level 5, Dex +2, +1 potency, no level term:
    // 10 + 2 + 2 + 1 = 15.
    expect(
      armorClass({ dexMod: 2, dexCap: null, rank: 1, level: 5, itemBonus: 1, withoutLevel: true }),
    ).toBe(15);
  });
});

describe('proficientDC', () => {
  it('is 10 + ability mod + proficiency bonus', () => {
    // Level-1 fighter, class DC trained (rank 1), key STR +4: 10 + 4 + (1+2) = 17.
    expect(proficientDC({ abilityMod: 4, rank: 1, level: 1 })).toBe(17);
    // Level-12, class DC master (rank 3), key +5: 10 + 5 + (12+6) = 33.
    expect(proficientDC({ abilityMod: 5, rank: 3, level: 12 })).toBe(33);
  });

  it('drops the proficiency term when untrained', () => {
    // 10 + 3 + 0 = 13 (a class with no class DC still yields 10 + mod here).
    expect(proficientDC({ abilityMod: 3, rank: 0, level: 5 })).toBe(13);
  });
});

describe('maxHitPoints', () => {
  it('is ancestry HP + (class HP + Con mod) per level', () => {
    // Human (8) fighter (10), Con +2, level 1: 8 + (10+2)·1 = 20.
    expect(maxHitPoints({ ancestryHp: 8, classHp: 10, conMod: 2, level: 1 })).toBe(20);
    // Same character at level 5: 8 + 12·5 = 68.
    expect(maxHitPoints({ ancestryHp: 8, classHp: 10, conMod: 2, level: 5 })).toBe(68);
    // Dwarf (10) wizard (6), Con +3, level 3: 10 + 9·3 = 37.
    expect(maxHitPoints({ ancestryHp: 10, classHp: 6, conMod: 3, level: 3 })).toBe(37);
  });

  it('applies flat and per-level bonus HP on top', () => {
    // 8 + (10+2)·3 + 6 flat + 1·3 per-level = 8 + 36 + 6 + 3 = 53.
    expect(
      maxHitPoints({
        ancestryHp: 8,
        classHp: 10,
        conMod: 2,
        level: 3,
        bonusHp: 6,
        bonusHpPerLevel: 1,
      }),
    ).toBe(53);
  });

  it('lets a negative Con modifier reduce per-level HP', () => {
    // 8 + (10 + (-1))·4 = 8 + 36 = 44.
    expect(maxHitPoints({ ancestryHp: 8, classHp: 10, conMod: -1, level: 4 })).toBe(44);
  });
});
