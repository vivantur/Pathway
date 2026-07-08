// Tests for src/lib/dice.js — degree of success, MAP, basic saves, damage rolls.
// These lock the bot's core check-resolution math: if a refactor changes any
// of these answers, a test fails and we know before game night does.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { stubRandomSequence, die } from './helpers.js';

const require = createRequire(import.meta.url);
const {
  rollD20Plus,
  rollDamageExpression,
  determineDegreeOfSuccess,
  calculateMap,
  basicSaveDamage,
} = require('../src/lib/dice');

afterEach(() => vi.restoreAllMocks());

describe('determineDegreeOfSuccess', () => {
  // PF2e: beat the DC by 10+ → critical success; meet it → success;
  // miss by 10+ → critical failure; otherwise failure.
  it('beats DC by 10 → crit success (boundary exact)', () => {
    expect(determineDegreeOfSuccess(25, 10, 15)).toBe('crit-success');
  });
  it('beats DC by 9 → plain success', () => {
    expect(determineDegreeOfSuccess(24, 10, 15)).toBe('success');
  });
  it('meets DC exactly → success', () => {
    expect(determineDegreeOfSuccess(15, 10, 15)).toBe('success');
  });
  it('misses DC by 1 → failure', () => {
    expect(determineDegreeOfSuccess(14, 10, 15)).toBe('failure');
  });
  it('misses DC by 10 → crit failure (boundary exact)', () => {
    expect(determineDegreeOfSuccess(5, 10, 15)).toBe('crit-failure');
  });
  it('misses DC by 9 → plain failure', () => {
    expect(determineDegreeOfSuccess(6, 10, 15)).toBe('failure');
  });

  // Natural 20 improves the result one step; natural 1 worsens it one step.
  it('nat 20 upgrades failure → success', () => {
    expect(determineDegreeOfSuccess(14, 20, 15)).toBe('success');
  });
  it('nat 20 upgrades success → crit success', () => {
    expect(determineDegreeOfSuccess(16, 20, 15)).toBe('crit-success');
  });
  it('nat 20 upgrades crit failure → failure', () => {
    expect(determineDegreeOfSuccess(5, 20, 15)).toBe('failure');
  });
  it('nat 1 downgrades success → failure', () => {
    expect(determineDegreeOfSuccess(16, 1, 15)).toBe('failure');
  });
  it('nat 1 downgrades crit success → success', () => {
    expect(determineDegreeOfSuccess(25, 1, 15)).toBe('success');
  });
  it('nat 1 downgrades failure → crit failure', () => {
    expect(determineDegreeOfSuccess(14, 1, 15)).toBe('crit-failure');
  });

  it('returns null when the DC is unknown', () => {
    expect(determineDegreeOfSuccess(15, 10, null)).toBeNull();
    expect(determineDegreeOfSuccess(15, 10, undefined)).toBeNull();
  });
});

describe('calculateMap (Multiple Attack Penalty)', () => {
  // First attack 0, second -5 (-4 agile), third and later -10 (-8 agile).
  it('first attack has no penalty', () => {
    expect(calculateMap(0, false)).toBe(0);
    expect(calculateMap(0, true)).toBe(0);
  });
  it('second attack: -5, or -4 with an agile weapon', () => {
    expect(calculateMap(1, false)).toBe(-5);
    expect(calculateMap(1, true)).toBe(-4);
  });
  it('third attack: -10, or -8 agile', () => {
    expect(calculateMap(2, false)).toBe(-10);
    expect(calculateMap(2, true)).toBe(-8);
  });
  it('fourth+ attack caps at the third-attack penalty', () => {
    expect(calculateMap(5, false)).toBe(-10);
    expect(calculateMap(5, true)).toBe(-8);
  });
  it('missing/negative map level counts as the first attack', () => {
    expect(calculateMap(undefined, false)).toBe(0);
    expect(calculateMap(-1, true)).toBe(0);
  });
});

describe('basicSaveDamage', () => {
  // Basic save: crit success none, success half (rounded down), failure full,
  // crit failure double.
  it('crit success takes no damage', () => {
    expect(basicSaveDamage(15, 'crit-success')).toBe(0);
  });
  it('success takes half, rounded down', () => {
    expect(basicSaveDamage(15, 'success')).toBe(7);
  });
  it('failure takes full damage', () => {
    expect(basicSaveDamage(15, 'failure')).toBe(15);
  });
  it('crit failure takes double damage', () => {
    expect(basicSaveDamage(15, 'crit-failure')).toBe(30);
  });
  it('unknown degree falls back to full damage', () => {
    expect(basicSaveDamage(15, null)).toBe(15);
  });
});

describe('rollD20Plus', () => {
  it('adds the modifier to the die and reports both', () => {
    stubRandomSequence([die(13, 20)]);
    expect(rollD20Plus(7)).toEqual({ total: 20, roll: 13, mod: 7 });
  });
});

describe('rollDamageExpression', () => {
  it('rolls simple NdM+B and formats the display', () => {
    stubRandomSequence([die(4, 6), die(3, 6)]);
    const r = rollDamageExpression('2d6+3');
    expect(r.rolls).toEqual([4, 3]);
    expect(r.sum).toBe(7);
    expect(r.total).toBe(10);
    expect(r.display).toBe('2d6[4, 3]+3');
  });
  it('defaults a bare dM to one die', () => {
    stubRandomSequence([die(5, 8)]);
    const r = rollDamageExpression('d8');
    expect(r.numDice).toBe(1);
    expect(r.total).toBe(5);
  });
  it('tolerates whitespace and case', () => {
    stubRandomSequence([die(2, 4)]);
    expect(rollDamageExpression(' 1D4 ').total).toBe(2);
  });
  it('rejects nonsense and out-of-range dice', () => {
    expect(rollDamageExpression('hello')).toBeNull();
    expect(rollDamageExpression('101d6')).toBeNull();
    expect(rollDamageExpression('1d10001')).toBeNull();
    expect(rollDamageExpression('')).toBeNull();
  });
  it('falls back to the advanced parser for complex expressions', () => {
    stubRandomSequence([die(6, 6), die(1, 6)]);
    const r = rollDamageExpression('2d6kh1+3');
    expect(r.total).toBe(9); // keeps the 6, drops the 1, +3
  });
});
