// Tests for src/rules/advancedRoll.js — the /roll expression parser.
// Covers dice arithmetic, keep-highest/lowest, adv/dis, crit doubling,
// iterations, snippets with positional args, and error handling.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { stubRandomSequence, die } from './helpers.js';

const require = createRequire(import.meta.url);
const { rollAdvanced } = require('../src/rules/advancedRoll');

afterEach(() => vi.restoreAllMocks());

const first = (r) => r.iterations[0];

describe('basic expressions', () => {
  it('rolls NdM + modifier', () => {
    stubRandomSequence([die(1, 6), die(1, 6), die(1, 6)]);
    const r = rollAdvanced('3d6+2');
    expect(r.error).toBeUndefined();
    expect(first(r).total).toBe(5);
    expect(first(r).breakdown).toBe('3d6[1, 1, 1] + 2');
  });
  it('handles plain arithmetic with no dice', () => {
    expect(first(rollAdvanced('2+3')).total).toBe(5);
  });
  it('rejects empty input and bad characters', () => {
    expect(rollAdvanced('').error).toBeTruthy();
    expect(rollAdvanced(null).error).toBeTruthy();
    expect(rollAdvanced('1d6; DROP TABLE').error).toBeTruthy();
  });
  it('rejects d1 and other invalid dice', () => {
    expect(rollAdvanced('3d1+2').error).toMatch(/Invalid dice/);
  });
});

describe('keep highest / keep lowest', () => {
  it('kh keeps the highest N dice', () => {
    stubRandomSequence([die(6, 6), die(1, 6), die(1, 6)]);
    expect(first(rollAdvanced('3d6kh2')).total).toBe(7); // 6+1, drops a 1
  });
  it('kl keeps the lowest N dice', () => {
    stubRandomSequence([die(6, 6), die(2, 6), die(5, 6)]);
    expect(first(rollAdvanced('3d6kl1')).total).toBe(2);
  });
});

describe('adv / dis', () => {
  it('adv rolls twice and keeps the higher', () => {
    stubRandomSequence([die(1, 20), die(20, 20)]);
    expect(first(rollAdvanced('1d20 adv')).total).toBe(20);
  });
  it('dis keeps the lower', () => {
    stubRandomSequence([die(15, 20), die(3, 20)]);
    expect(first(rollAdvanced('1d20 dis')).total).toBe(3);
  });
  it('adv and dis together is an error', () => {
    expect(rollAdvanced('1d20 adv dis').error).toBeTruthy();
  });
});

describe('crit doubling', () => {
  it('crit doubles the DICE COUNT (2d6 → 4d6), not the total', () => {
    stubRandomSequence([die(6, 6), die(1, 6), die(1, 6), die(1, 6)]);
    const r = rollAdvanced('crit 2d6');
    expect(first(r).total).toBe(9);
    expect(first(r).breakdown).toContain('4d6');
  });
});

describe('iterations (N#)', () => {
  it('4#1d6 rolls the expression four times', () => {
    stubRandomSequence([die(1, 6), die(2, 6), die(3, 6), die(4, 6)]);
    const r = rollAdvanced('4#1d6');
    expect(r.iterations).toHaveLength(4);
    expect(r.iterations.map(i => i.total)).toEqual([1, 2, 3, 4]);
  });
  it('caps iterations at 25', () => {
    expect(rollAdvanced('26#1d6').error).toMatch(/between 1 and 25/);
  });
});

describe('snippets', () => {
  it('expands a snippet by name', () => {
    stubRandomSequence([die(4, 6)]);
    expect(first(rollAdvanced('sneaky', { sneaky: '1d6+2' })).total).toBe(6);
  });
  it('fills positional args, using the default when omitted', () => {
    // Snippet "1d6+%1:2": %1 is arg one, ":2" is its default value.
    stubRandomSequence([die(1, 6)]);
    expect(first(rollAdvanced('sneaky', { sneaky: '1d6+%1:2' })).total).toBe(3);
    stubRandomSequence([die(1, 6)]);
    expect(first(rollAdvanced('sneaky 5', { sneaky: '1d6+%1:2' })).total).toBe(6);
  });
  it('snippet names are case-insensitive', () => {
    stubRandomSequence([die(1, 6)]);
    expect(first(rollAdvanced('SNEAKY', { sneaky: '1d6+1' })).total).toBe(2);
  });
});

describe('character variables ({{...}})', () => {
  const charEntry = {
    data: {
      abilities: { str: 18 },
      proficiencies: {},
      level: 5,
    },
    overlay: { cvars: { rage: 4 } },
  };
  it('substitutes ability modifiers', () => {
    stubRandomSequence([die(10, 20)]);
    expect(first(rollAdvanced('1d20+{{str}}', {}, charEntry)).total).toBe(14);
  });
  it('substitutes custom variables (cvars)', () => {
    stubRandomSequence([die(10, 20)]);
    expect(first(rollAdvanced('1d20+{{rage}}', {}, charEntry)).total).toBe(14);
  });
});
