// Tests for src/rules/variables.js — the {{variable}} system used in rolls.
// Players can write /roll 1d20+{{str}} or {{athletics}} and the bot fills in
// values from their character sheet, custom variables (cvars), and counters.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveVariable, expandVariables } = require('../src/rules/variables');

const charEntry = {
  name: 'Testy',
  hp: 17,
  data: {
    abilities: { str: 18, dex: 14, con: 12, int: 10, wis: 16, cha: 8 },
    proficiencies: { athletics: 4, fortitude: 2, will: 6, warfare_lore: 2 },
    level: 5,
    keyability: 'str',
  },
  overlay: {
    cvars: { rage: 4 },
    counters: { panache: { current: 2, max: 3 } },
  },
};

describe('resolveVariable', () => {
  it('ability names give the MODIFIER, not the score', () => {
    expect(resolveVariable('str', charEntry)).toBe(4);
    expect(resolveVariable('cha', charEntry)).toBe(-1);
  });
  it('key resolves via the class key ability', () => {
    expect(resolveVariable('key', charEntry)).toBe(4);
  });
  it('basics: name, level, hp, speed default', () => {
    expect(resolveVariable('name', charEntry)).toBe('Testy');
    expect(resolveVariable('level', charEntry)).toBe(5);
    expect(resolveVariable('hp', charEntry)).toBe(17);
    expect(resolveVariable('speed', charEntry)).toBe(25);
  });
  it('skills are ability mod + level + proficiency', () => {
    expect(resolveVariable('athletics', charEntry)).toBe(13); // +4 str + (5 + 4)
  });
  it('saves work, including the short aliases', () => {
    expect(resolveVariable('fortitude', charEntry)).toBe(8); // +1 con + (5 + 2)
    expect(resolveVariable('fort', charEntry)).toBe(8);
    expect(resolveVariable('will', charEntry)).toBe(14);     // +3 wis + (5 + 6)
  });
  it('lore skills match with either separator and use Int', () => {
    expect(resolveVariable('warfare-lore', charEntry)).toBe(7); // +0 int + (5 + 2)
    expect(resolveVariable('warfare_lore', charEntry)).toBe(7);
  });
  it('rank.<skill> exposes the raw proficiency number', () => {
    expect(resolveVariable('rank.athletics', charEntry)).toBe(4);
    expect(resolveVariable('rank.stealth', charEntry)).toBe(0);
  });
  it('cvars win over built-ins and resolve by name', () => {
    expect(resolveVariable('rage', charEntry)).toBe(4);
  });
  it('counter.<name> and counter.<name>.max read custom counters', () => {
    expect(resolveVariable('counter.panache', charEntry)).toBe(2);
    expect(resolveVariable('counter.panache.max', charEntry)).toBe(3);
  });
  it('unknown variables are undefined', () => {
    expect(resolveVariable('nonsense', charEntry)).toBeUndefined();
    expect(resolveVariable('str', null)).toBeUndefined();
  });
});

describe('expandVariables', () => {
  it('replaces every known {{variable}} in a string', () => {
    expect(expandVariables('1d20+{{str}} and {{athletics}}', charEntry))
      .toBe('1d20+4 and 13');
  });
  it('tolerates spaces inside the braces', () => {
    expect(expandVariables('{{ str }}', charEntry)).toBe('4');
  });
  it('leaves unknown variables untouched so users can spot the typo', () => {
    expect(expandVariables('1d20+{{stir}}', charEntry)).toBe('1d20+{{stir}}');
  });
  it('passes through text with no variables', () => {
    expect(expandVariables('1d20+5', charEntry)).toBe('1d20+5');
  });
});
