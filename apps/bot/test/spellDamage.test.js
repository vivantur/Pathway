// Tests for src/lib/spellDamage.js — spell damage + heightening resolution.
// Heightening is the PF2e rule where casting a spell using a higher-rank
// slot increases its damage. Two data shapes exist:
//   per_rank: "+1d6 per rank above base"  (e.g. Fireball)
//   fixed:    a table of specific ranks    (e.g. "Heightened (3rd): 5d6")

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { stubRandomSequence, die } from './helpers.js';

const require = createRequire(import.meta.url);
const {
  resolveSpellDamage,
  rollCompoundExpression,
  multiplyDice,
  extractDiceFromFixedText,
  findApplicableFixedLevel,
} = require('../src/lib/spellDamage');

afterEach(() => vi.restoreAllMocks());

describe('multiplyDice', () => {
  it('multiplies the dice count: 1d6 ×3 → 3d6', () => {
    expect(multiplyDice('1d6', 3)).toBe('3d6');
    expect(multiplyDice('2d8', 2)).toBe('4d8');
  });
  it('a bare dM counts as one die', () => {
    expect(multiplyDice('d10', 4)).toBe('4d10');
  });
  it('rejects non-dice input and factors below 1', () => {
    expect(multiplyDice('+5', 2)).toBeNull();
    expect(multiplyDice('1d6', 0)).toBeNull();
    expect(multiplyDice(null, 2)).toBeNull();
  });
});

describe('extractDiceFromFixedText', () => {
  it('"increases to X" replaces the base damage', () => {
    expect(extractDiceFromFixedText('The damage increases to 5d6.'))
      .toEqual({ diceExpr: '5d6', mode: 'replace' });
  });
  it('"increases by X" adds to the base damage', () => {
    expect(extractDiceFromFixedText('The damage increases by 2d6.'))
      .toEqual({ diceExpr: '2d6', mode: 'add' });
  });
  it('keeps an attached flat bonus', () => {
    expect(extractDiceFromFixedText('increases to 5d6 + 3'))
      .toEqual({ diceExpr: '5d6+3', mode: 'replace' });
  });
  it('returns null when there are no dice', () => {
    expect(extractDiceFromFixedText('The duration increases to 1 minute.')).toBeNull();
    expect(extractDiceFromFixedText(null)).toBeNull();
  });
});

describe('findApplicableFixedLevel', () => {
  const levels = { 3: 'increases to 5d6', 5: 'increases to 7d6' };
  it('picks the highest table entry at or below the cast rank', () => {
    expect(findApplicableFixedLevel(levels, 4).rank).toBe(3);
    expect(findApplicableFixedLevel(levels, 5).rank).toBe(5);
    expect(findApplicableFixedLevel(levels, 9).rank).toBe(5);
  });
  it('returns null below every entry', () => {
    expect(findApplicableFixedLevel(levels, 2)).toBeNull();
    expect(findApplicableFixedLevel(null, 5)).toBeNull();
  });
});

describe('resolveSpellDamage', () => {
  it('per-rank heightening adds multiplied dice (Fireball-style)', () => {
    const spell = {
      level: 3,
      damage: { base: '6d6', type: 'fire' },
      heightening: { type: 'per_rank', damage_bonus: '2d6' },
    };
    // Cast at rank 5 = 2 ranks above base → +2×2d6 = +4d6
    const r = resolveSpellDamage(spell, 5);
    expect(r.diceExpr).toBe('6d6 + 4d6');
    expect(r.damageType).toBe('fire');
    expect(r.bonusRanks).toBe(2);
  });
  it('no heightening below or at base rank', () => {
    const spell = {
      level: 3,
      damage: { base: '6d6', type: 'fire' },
      heightening: { type: 'per_rank', damage_bonus: '2d6' },
    };
    expect(resolveSpellDamage(spell, 3).diceExpr).toBe('6d6');
  });
  it('per-rank with a step only triggers every N ranks', () => {
    const spell = {
      level: 1,
      damage: { base: '1d6', type: 'acid' },
      heightening: { type: 'per_rank', step: 2, damage_bonus: '1d6' },
    };
    expect(resolveSpellDamage(spell, 2).diceExpr).toBe('1d6');       // 1 rank up: no step yet
    expect(resolveSpellDamage(spell, 3).diceExpr).toBe('1d6 + 1d6'); // 2 ranks up: one step
  });
  it('fixed heightening replaces the dice at the table rank', () => {
    const spell = {
      level: 1,
      damage: { base: '2d6', type: 'electricity' },
      heightening: { type: 'fixed', levels: { 3: 'The damage increases to 5d6.' } },
    };
    const r = resolveSpellDamage(spell, 4);
    expect(r.diceExpr).toBe('5d6');
    expect(r.fixedReplaced).toBe(true);
  });
  it('post-normalize shape (damageBase/damageType fields) also works', () => {
    const spell = { level: 2, damageBase: '3d8', damageType: 'void' };
    const r = resolveSpellDamage(spell, 2);
    expect(r.diceExpr).toBe('3d8');
    expect(r.damageType).toBe('void');
  });
  it('returns null diceExpr for a damageless spell', () => {
    expect(resolveSpellDamage({ level: 1 }, 1).diceExpr).toBeNull();
    expect(resolveSpellDamage(null, 1)).toBeNull();
  });
});

describe('rollCompoundExpression', () => {
  it('rolls each term and sums: "2d6 + 1d4 + 3"', () => {
    stubRandomSequence([die(4, 6), die(2, 6), die(3, 4)]);
    const r = rollCompoundExpression('2d6 + 1d4 + 3');
    expect(r.grandTotal).toBe(12); // 4+2 +3 +3
  });
  it('handles subtraction', () => {
    stubRandomSequence([die(5, 6)]);
    expect(rollCompoundExpression('1d6 - 2').grandTotal).toBe(3);
  });
  it('returns null on unparseable input', () => {
    expect(rollCompoundExpression('banana')).toBeNull();
    expect(rollCompoundExpression('')).toBeNull();
  });
});
