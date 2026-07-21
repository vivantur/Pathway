// Tests for src/rules/strikeAdapter.js — the weapon → core Strike adapter.
//
// The adapter delegates ALL arithmetic to @pathway/core; these tests lock the
// DECODING it owns: trait normalization, die/damage-type reading, striking-rune
// rank, the trust-the-stored-total override policy, and the honesty warning when a
// weapon carries no traits. The engine's own math is core's tests' job.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildStrike,
  normalizeTrait,
  parseDieSize,
  normalizeDamageType,
  strikingRank,
} = require('../src/rules/strikeAdapter');

const actor = { level: 5, mods: { str: 4, dex: 2, con: 1, int: 0, wis: 1, cha: 0 } };

// A Pathbuilder longsword row: precomputed to-hit, no traits, single-letter type.
const pbLongsword = { name: 'Longsword', die: 'd8', attack: 13, damageBonus: 4, damageType: 'S' };

describe('convention decoding', () => {
  it('normalizes trait spellings to core tokens', () => {
    expect(normalizeTrait('Agile')).toBe('agile');
    expect(normalizeTrait('Two-Hand d10')).toBe('two-hand-d10');
    expect(normalizeTrait('  Deadly  d10 ')).toBe('deadly-d10');
    expect(normalizeTrait('Versatile P')).toBe('versatile-p');
  });

  it('reads a die size from every stored spelling', () => {
    expect(parseDieSize('d8')).toBe(8);
    expect(parseDieSize('1d8')).toBe(8);
    expect(parseDieSize('2d6')).toBe(6);
    expect(parseDieSize(10)).toBe(10);
    expect(parseDieSize('sword')).toBeNull();
  });

  it('decodes single-letter and full-word damage types, rejecting unknowns', () => {
    expect(normalizeDamageType('S')).toBe('slashing');
    expect(normalizeDamageType('piercing')).toBe('piercing');
    expect(normalizeDamageType('Fire')).toBe('fire');
    expect(normalizeDamageType('sonicboom')).toBeNull();
    expect(normalizeDamageType('')).toBeNull();
  });

  it('reads the striking-rune rank from stored runes', () => {
    expect(strikingRank({ runes: [] })).toBe(0);
    expect(strikingRank({ runes: ['striking'] })).toBe(1);
    expect(strikingRank({ runes: ['Greater Striking'] })).toBe(2);
    expect(strikingRank({ runes: ['major striking'] })).toBe(3);
  });
});

describe('buildStrike', () => {
  it('trusts the stored attack total and produces a runnable tree', () => {
    const { strike, nodes, error } = buildStrike(pbLongsword, actor);
    expect(error).toBeUndefined();
    // The stored to-hit is honored verbatim, not recomputed from rank.
    expect(strike.attack).toBe(13);
    expect(strike.breakdown.overridden).toBe(true);
    // strikeAutomation yields exactly one attack node whose bonus is that total.
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe('attack');
    expect(nodes[0].bonus).toEqual({ kind: 'lit', value: 13 });
  });

  it('folds the stored damage bonus into the base damage component', () => {
    const { strike } = buildStrike(pbLongsword, actor);
    expect(strike.damageBonus).toBe(4);
    // 1 die of d8 (no striking) + the trusted flat bonus.
    expect(strike.dice).toEqual({ count: 1, size: 8 });
    expect(strike.damage[0].formula).toContain('d8');
    expect(strike.damage[0].type).toBe('slashing');
  });

  it('lets striking runes drive the dice count, not the flat bonus', () => {
    const { strike } = buildStrike({ ...pbLongsword, runes: ['greater striking'] }, actor);
    expect(strike.dice.count).toBe(3); // 1 + greater striking (2)
    expect(strike.damageBonus).toBe(4); // unchanged — runes never touch the flat total
  });

  it('warns when a weapon has no traits (the Pathbuilder case)', () => {
    const { warnings, agile } = buildStrike(pbLongsword, actor);
    expect(agile).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no weapon traits/i);
  });

  it('applies traits when a source carries them: agile flips MAP', () => {
    const shortsword = { name: 'Shortsword', die: 'd6', attack: 13, damageBonus: 4, damageType: 'S', traits: ['Agile', 'Finesse'] };
    const { nodes, agile, warnings } = buildStrike(shortsword, actor);
    expect(agile).toBe(true);
    expect(nodes[0].map).toEqual({ agile: true });
    expect(warnings).toHaveLength(0);
  });

  it('reads deadly/fatal crit dice from traits', () => {
    const pick = { name: 'Pick', die: 'd6', attack: 13, damageBonus: 4, damageType: 'P', traits: ['Fatal d10'] };
    const { strike } = buildStrike(pick, actor);
    // Fatal replaces the base dice on a crit with a bigger die + one extra.
    expect(strike.criticalDamage).not.toBeNull();
    expect(strike.criticalDamage[0].formula).toContain('d10');
  });

  it('accepts a caller-supplied trait override (reference-item enrichment)', () => {
    const { agile, warnings } = buildStrike(pbLongsword, actor, { traits: ['agile'] });
    expect(agile).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('refuses a weapon whose damage cannot be read, rather than guessing', () => {
    expect(buildStrike({ name: 'Mystery', die: 'sword', damageType: 'S' }, actor).error).toMatch(/damage die/);
    expect(buildStrike({ name: 'Mystery', die: 'd8', damageType: 'glory' }, actor).error).toMatch(/damage type/);
  });
});
