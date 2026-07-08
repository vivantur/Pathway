// Tests for src/rules/effects.js — the PF2e condition presets.
// Conditions like Frightened apply numeric penalties to rolls; these tests
// lock the numbers and the alias handling (e.g. old "flat-footed" name).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getPreset, listPresets } = require('../src/rules/effects');
const { sumEffectModifiers } = require('../src/rules/combatEffects');

describe('getPreset', () => {
  it('frightened N penalizes everything by -N', () => {
    const built = getPreset('frightened').build(2);
    expect(built.attackBonus).toBe(-2);
    expect(built.acBonus).toBe(-2);
    expect(built.saveBonus).toBe(-2);
    expect(built.skillBonus).toBe(-2);
  });
  it('stupefied N penalizes mental rolls but NOT AC or damage', () => {
    const built = getPreset('stupefied').build(1);
    expect(built.attackBonus).toBe(-1);
    expect(built.saveBonus).toBe(-1);
    expect(built.acBonus).toBeUndefined();
  });
  it('lookup is case- and whitespace-insensitive', () => {
    expect(getPreset(' Frightened ')).toBeTruthy();
    expect(getPreset('FRIGHTENED')).toBeTruthy();
  });
  it('legacy names alias to the Remaster condition', () => {
    expect(getPreset('flat-footed').key).toBe('off-guard');
    expect(getPreset('flatfooted').key).toBe('off-guard');
  });
  it('persistent-damage aliases resolve to persistent presets', () => {
    expect(getPreset('bleeding').key).toBe('persistent-bleed');
    expect(getPreset('burning').key).toBe('persistent-fire');
  });
  it('unknown names return null', () => {
    expect(getPreset('confuzzled')).toBeNull();
    expect(getPreset('')).toBeNull();
  });
});

describe('listPresets', () => {
  it('returns every preset with a key and name', () => {
    const all = listPresets();
    expect(all.length).toBeGreaterThan(20);
    for (const p of all) {
      expect(p.key).toBeTruthy();
      expect(p.name).toBeTruthy();
    }
  });
});

describe('sumEffectModifiers', () => {
  it('adds up modifiers across multiple active effects', () => {
    const combatant = {
      effects: [
        { modifiers: { attackBonus: -2, acBonus: -2 } }, // frightened 2
        { modifiers: { attackBonus: 1 } },               // e.g. bless
      ],
    };
    const sum = sumEffectModifiers(combatant);
    expect(sum.attackBonus).toBe(-1);
    expect(sum.acBonus).toBe(-2);
  });
  it('handles a combatant with no effects', () => {
    expect(sumEffectModifiers({ effects: [] }).attackBonus).toBe(0);
    expect(sumEffectModifiers(null).attackBonus).toBe(0);
  });
});
