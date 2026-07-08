// Worked-example locks for the scalar stat primitives.
import { describe, expect, it } from 'vitest';
import { abilityModifier, proficiencyBonus, rawBonusToRank, rankLabel } from './stats';

describe('abilityModifier', () => {
  it('follows floor((score - 10) / 2)', () => {
    expect(abilityModifier(18)).toBe(4);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0); // odd scores round down
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(7)).toBe(-2);
  });
  it('treats missing scores as +0', () => {
    expect(abilityModifier(undefined)).toBe(0);
    expect(abilityModifier(null)).toBe(0);
    expect(abilityModifier(Number.NaN)).toBe(0);
  });
});

describe('proficiencyBonus', () => {
  it('is level + 2×rank when trained or better', () => {
    expect(proficiencyBonus(1, 1)).toBe(3);   // trained level 1
    expect(proficiencyBonus(2, 5)).toBe(9);   // expert level 5
    expect(proficiencyBonus(3, 12)).toBe(18); // master level 12
    expect(proficiencyBonus(4, 20)).toBe(28); // legendary level 20
  });
  it('untrained is flat 0 regardless of level', () => {
    expect(proficiencyBonus(0, 1)).toBe(0);
    expect(proficiencyBonus(0, 20)).toBe(0);
  });
  it('Proficiency Without Level drops the level term only', () => {
    expect(proficiencyBonus(2, 5, true)).toBe(4);
    expect(proficiencyBonus(4, 20, true)).toBe(8);
    expect(proficiencyBonus(0, 20, true)).toBe(0);
  });
});

describe('rawBonusToRank', () => {
  it('maps Pathbuilder raw bonuses 0/2/4/6/8 to ranks 0-4', () => {
    expect(rawBonusToRank(0)).toBe(0);
    expect(rawBonusToRank(2)).toBe(1);
    expect(rawBonusToRank(4)).toBe(2);
    expect(rawBonusToRank(6)).toBe(3);
    expect(rawBonusToRank(8)).toBe(4);
  });
  it('round-trips with proficiencyBonus: raw = level-less bonus', () => {
    for (const raw of [0, 2, 4, 6, 8] as const) {
      expect(proficiencyBonus(rawBonusToRank(raw), 7, true)).toBe(raw);
    }
  });
  it('clamps garbage safely', () => {
    expect(rawBonusToRank(undefined)).toBe(0);
    expect(rawBonusToRank(-3)).toBe(0);
    expect(rawBonusToRank(99)).toBe(4);
    expect(rawBonusToRank(3)).toBe(1); // odd values round down
  });
});

describe('rankLabel', () => {
  it('names each rank', () => {
    expect(rankLabel(0)).toBe('Untrained');
    expect(rankLabel(1)).toBe('Trained');
    expect(rankLabel(2)).toBe('Expert');
    expect(rankLabel(3)).toBe('Master');
    expect(rankLabel(4)).toBe('Legendary');
  });
});
