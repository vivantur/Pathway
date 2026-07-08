// Tests for src/rules/pf2eMath.js — proficiency math.
//
// Two import sources use different number conventions for proficiency:
//   • Pathbuilder JSON stores the bonus directly: 2/4/6/8 (trained→legendary)
//   • Pathway-native characters store the rank: 1/2/3/4 (bot doubles it)
// These tests lock that both conventions produce the SAME final modifier.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  usesRankProficiencies,
  calcCharacterProfNum,
  calcEditableProfNum,
  editableProfValue,
  characterProfValue,
  characterProfLabel,
  SKILL_ABIL_MAP,
  computeCharSkillModifier,
} = require('../src/rules/pf2eMath');

const pathbuilderChar = { _pathwaySource: undefined };
const nativeChar = { _pathwaySource: 'native' };

describe('usesRankProficiencies', () => {
  it('is true only for Pathway-native characters', () => {
    expect(usesRankProficiencies(nativeChar)).toBe(true);
    expect(usesRankProficiencies(pathbuilderChar)).toBe(false);
    expect(usesRankProficiencies(null)).toBe(false);
  });
});

describe('calcCharacterProfNum — level + proficiency', () => {
  it('Pathbuilder expert (4) at level 5 → 9', () => {
    expect(calcCharacterProfNum(pathbuilderChar, 4, 5)).toBe(9);
  });
  it('native expert (rank 2) at level 5 → also 9 (rank doubled)', () => {
    expect(calcCharacterProfNum(nativeChar, 2, 5)).toBe(9);
  });
  it('both conventions agree for every rank', () => {
    // trained/expert/master/legendary at level 10
    const pathbuilderValues = [2, 4, 6, 8].map(p => calcCharacterProfNum(pathbuilderChar, p, 10));
    const nativeValues = [1, 2, 3, 4].map(r => calcCharacterProfNum(nativeChar, r, 10));
    expect(nativeValues).toEqual(pathbuilderValues); // [12, 14, 16, 18]
  });
  it('untrained (0) gets NO level bonus — untrained is flat 0', () => {
    expect(calcCharacterProfNum(pathbuilderChar, 0, 20)).toBe(0);
    expect(calcCharacterProfNum(nativeChar, 0, 20)).toBe(0);
  });
});

describe('editable overrides (manually set proficiencies)', () => {
  it('small values (ranks 1-4) are doubled; big values pass through', () => {
    expect(editableProfValue(2)).toBe(4);   // rank → bonus
    expect(editableProfValue(6)).toBe(6);   // already a bonus
    expect(editableProfValue(0)).toBe(0);
  });
  it('calcEditableProfNum adds level using the same rule', () => {
    expect(calcEditableProfNum(2, 5)).toBe(9);  // rank 2 → +4, +5 level
    expect(calcEditableProfNum(6, 5)).toBe(11); // bonus 6, +5 level
    expect(calcEditableProfNum(0, 5)).toBe(0);
  });
});

describe('proficiency labels', () => {
  it('maps bonus values to rank names', () => {
    expect(characterProfLabel(pathbuilderChar, 0)).toBe('Untrained');
    expect(characterProfLabel(pathbuilderChar, 2)).toBe('Trained');
    expect(characterProfLabel(pathbuilderChar, 4)).toBe('Expert');
    expect(characterProfLabel(pathbuilderChar, 6)).toBe('Master');
    expect(characterProfLabel(pathbuilderChar, 8)).toBe('Legendary');
  });
  it('native ranks map to the same labels', () => {
    expect(characterProfLabel(nativeChar, 1)).toBe('Trained');
    expect(characterProfLabel(nativeChar, 4)).toBe('Legendary');
  });
  it('characterProfValue normalizes both conventions to the 0-8 scale', () => {
    expect(characterProfValue(pathbuilderChar, 6)).toBe(6);
    expect(characterProfValue(nativeChar, 3)).toBe(6);
  });
});

describe('SKILL_ABIL_MAP', () => {
  it('covers Perception plus the 16 core skills', () => {
    expect(Object.keys(SKILL_ABIL_MAP)).toHaveLength(17);
    expect(SKILL_ABIL_MAP.athletics).toBe('str');
    expect(SKILL_ABIL_MAP.stealth).toBe('dex');
    expect(SKILL_ABIL_MAP.perception).toBe('wis');
  });
});

describe('computeCharSkillModifier', () => {
  const charEntry = {
    data: {
      abilities: { str: 18, dex: 14, wis: 12 },
      proficiencies: { athletics: 4, stealth: 0 },
      level: 5,
    },
  };

  it('adds ability mod + level + proficiency (Athletics: +4 str, expert 4, level 5 → +13)', () => {
    const r = computeCharSkillModifier(charEntry, 'athletics');
    expect(r).toEqual({ modifier: 13, profLabel: 'Expert', profNum: 4 });
  });
  it('untrained skill is just the ability mod', () => {
    const r = computeCharSkillModifier(charEntry, 'stealth');
    expect(r).toEqual({ modifier: 2, profLabel: 'Untrained', profNum: 0 });
  });
  it('an edits overlay with an explicit total wins outright', () => {
    const edited = { ...charEntry, edits: { skillOverrides: { athletics: { total: 20 } } } };
    expect(computeCharSkillModifier(edited, 'athletics').modifier).toBe(20);
  });
  it('an edits overlay with a rank recomputes from that rank', () => {
    const edited = { ...charEntry, edits: { skillOverrides: { athletics: { rank: 6 } } } };
    const r = computeCharSkillModifier(edited, 'athletics');
    expect(r.modifier).toBe(15); // +4 str + (6 + 5 level)
    expect(r.profLabel).toBe('Master');
  });
  it('returns null for a missing character or unknown skill', () => {
    expect(computeCharSkillModifier(null, 'athletics')).toBeNull();
    expect(computeCharSkillModifier(charEntry, 'basketweaving')).toBeNull();
  });
});
