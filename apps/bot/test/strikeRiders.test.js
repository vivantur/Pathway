// Tests for src/rules/strikeRiders.js — the hand-authored rider catalog.
//
// The catalog validates every entry against core's strikeRiderSchema at load, so
// these mostly pin that the entries resolve and compose. The composition math is
// core's (rider.test.ts); here we check the bot's catalog + lookup.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('@pathway/core');
const { findRider, listRiders } = require('../src/rules/strikeRiders');
const { buildStrike } = require('../src/rules/strikeAdapter');

const actor = { level: 5, mods: { str: 4, dex: 2, con: 1, int: 0, wis: 1, cha: 0 } };
const longsword = { name: 'Longsword', die: 'd8', attack: 13, damageBonus: 4, damageType: 'S', traits: ['agile'] };

describe('the rider catalog', () => {
  it('loads and every entry is a valid StrikeRider', () => {
    const riders = listRiders();
    expect(riders.length).toBeGreaterThan(0);
    for (const r of riders) expect(core.strikeRiderSchema.safeParse(r).success).toBe(true);
  });

  it('resolves a rider by keyword, id, or name (case-insensitive)', () => {
    expect(findRider('intimidating')?.id).toBe('intimidating-strike');
    expect(findRider('SNAGGING')?.id).toBe('snagging-strike');
    expect(findRider('snagging-strike')?.id).toBe('snagging-strike');
    expect(findRider('nope')).toBeNull();
  });

  it('authors Intimidating Strike from source: Frightened 1 on hit, 2 on a crit', () => {
    const r = findRider('intimidating');
    expect(r.onSuccess[0].effect.conditions[0]).toEqual({ slug: 'frightened', value: 1 });
    expect(r.onCriticalSuccess[0].effect.conditions[0]).toEqual({ slug: 'frightened', value: 2 });
    // The condition carries its real modifiers (from core), not just a label.
    expect(r.onSuccess[0].effect.passives.length).toBeGreaterThan(0);
  });

  it('composes onto a real Strike — the rider fragment rides the hit branches', () => {
    const built = buildStrike(longsword, actor);
    const nodes = core.composeStrikeRider(built.strike, findRider('intimidating'), { agile: built.agile });
    const attack = nodes[0];
    expect(attack.kind).toBe('attack');
    expect(attack.onSuccess.some((n) => n.kind === 'applyEffect')).toBe(true);
    expect(attack.onCriticalSuccess.some((n) => n.kind === 'applyEffect')).toBe(true);
  });
});
