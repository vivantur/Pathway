// Tests for src/lib/format.js — ability mods, proficiency, currency, bulk, XP.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  getMod, fmt, calcProfNum,
  walletToCopper, copperToWallet,
  bulkToLightUnits,
  xpToNextLevel, renderXpBar,
} = require('../src/lib/format');

describe('ability modifiers', () => {
  it('follows the (score - 10) / 2 rounded-down formula', () => {
    expect(getMod(18)).toBe('+4');
    expect(getMod(10)).toBe('+0');
    expect(getMod(11)).toBe('+0');
    expect(getMod(7)).toBe('-2');
    expect(getMod(8)).toBe('-1');
  });
  it('fmt signs raw numbers', () => {
    expect(fmt(3)).toBe('+3');
    expect(fmt(0)).toBe('+0');
    expect(fmt(-1)).toBe('-1');
  });
});

describe('calcProfNum', () => {
  it('adds level to a nonzero proficiency; untrained stays 0', () => {
    expect(calcProfNum(4, 5)).toBe(9);
    expect(calcProfNum(0, 20)).toBe(0);
  });
});

describe('currency (pp/gp/sp/cp)', () => {
  it('converts a wallet to copper: 1pp=1000, 1gp=100, 1sp=10', () => {
    expect(walletToCopper({ pp: 1, gp: 2, sp: 3, cp: 4 })).toBe(1234);
    expect(walletToCopper({})).toBe(0);
  });
  it('converts copper back to the largest coins', () => {
    expect(copperToWallet(1234)).toEqual({ pp: 1, gp: 2, sp: 3, cp: 4 });
    expect(copperToWallet(99)).toEqual({ pp: 0, gp: 0, sp: 9, cp: 9 });
  });
  it('round-trips', () => {
    const w = { pp: 3, gp: 9, sp: 9, cp: 9 };
    expect(copperToWallet(walletToCopper(w))).toEqual(w);
  });
});

describe('bulk', () => {
  // Internally bulk is tracked in tenths: L(ight) = 1, "1 Bulk" = 10.
  it('maps PF2e bulk notation to light units', () => {
    expect(bulkToLightUnits('L')).toBe(1);
    expect(bulkToLightUnits('1')).toBe(10);
    expect(bulkToLightUnits('2')).toBe(20);
    expect(bulkToLightUnits('—')).toBe(0);
    expect(bulkToLightUnits(null)).toBe(0);
    expect(bulkToLightUnits('weird')).toBeNull();
  });
});

describe('XP', () => {
  it('every level costs 1000 XP (PF2e standard progression)', () => {
    expect(xpToNextLevel()).toBe(1000);
  });
  it('renders a proportional progress bar', () => {
    expect(renderXpBar(500)).toBe('▰▰▰▰▰▱▱▱▱▱');
    expect(renderXpBar(0)).toBe('▱▱▱▱▱▱▱▱▱▱');
    expect(renderXpBar(1000)).toBe('▰▰▰▰▰▰▰▰▰▰');
    expect(renderXpBar(2000)).toBe('▰▰▰▰▰▰▰▰▰▰'); // clamps
  });
});
