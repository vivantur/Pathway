// Worked-example locks for the derived-stat compositions.
import { describe, expect, it } from 'vitest';
import { maxHitPoints, proficientModifier } from './derived.js';

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
