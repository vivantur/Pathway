// Worked-example locks for the derived-stat compositions.
import { describe, expect, it } from 'vitest';
import { maxHitPoints } from './derived.js';

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
