// Tests for the companion stat engine — src/commands/companion/helpers.js.
//
// The bot now scales catalog animal/mount companions through @pathway/core (the
// SAME engine the website uses), so the numbers must match on Discord and the
// site. These lock that reconciliation plus the override + fallback behavior.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scaleCompanion } = require('../src/commands/companion/helpers');
const core = require('@pathway/core');

describe('scaleCompanion — core-backed catalog companion', () => {
  it('matches @pathway/core exactly (wolf, mature, level 5)', () => {
    const s = core.scaleCompanion(core.findCompanionType('wolf'), 5, 'mature');
    const r = scaleCompanion({ baseType: 'wolf', form: 'mature' }, { level: 5 });
    expect(r.maxHp).toBe(s.maxHp); // 45 — Con mod included (the old approximation dropped it)
    expect(r.ac).toBe(s.ac); // 21 — includes the +2 trained
    expect(r.perception).toBe(s.perception);
    expect(r.saves).toEqual({ fort: s.saves.fortitude, ref: s.saves.reflex, will: s.saves.will });
    expect(r.attackBonus).toBe(s.attacks[0].attack);
    expect(r.damageDice).toBe(s.attacks[0].damage); // "2d8" — dice doubled on maturity
    expect(r.damageBonus).toBe(s.attacks[0].damageBonus);
    expect(r.abilities).toEqual(s.abilityMods);
  });

  it('young form now includes the Con mod (regression against the old math)', () => {
    // wolf: hp base 6, Con +2 → (6+2)*3 = 24, not the old 6*3 = 18.
    const r = scaleCompanion({ baseType: 'wolf', form: 'young' }, { level: 3 });
    expect(r.maxHp).toBe(24);
  });
});

describe('scaleCompanion — overrides', () => {
  it('applies per-field overrides over the core-scaled stats and flags them', () => {
    const r = scaleCompanion(
      { baseType: 'wolf', form: 'mature', overrides: { ac: 25, hp: 60, saves: { will: 9 } } },
      { level: 5 },
    );
    expect(r.ac).toBe(25);
    expect(r.maxHp).toBe(60);
    expect(r.saves.will).toBe(9);
    expect(r.overriddenFields).toEqual(expect.arrayContaining(['AC', 'HP', 'saves']));
  });

  it('a perception override wins over the computed value', () => {
    const r = scaleCompanion({ baseType: 'wolf', form: 'young', overrides: { perception: 12 } }, { level: 1 });
    expect(r.perception).toBe(12);
  });
});

describe('scaleCompanion — fallback', () => {
  it('falls back to legacy math for a base type core does not know', () => {
    const r = scaleCompanion({ baseType: 'not-a-real-companion', form: 'young' }, { level: 3 });
    expect(r).toBeTruthy();
    expect(typeof r.maxHp).toBe('number');
  });

  it('familiars keep their special shape (HP 5×level, AC/saves as master)', () => {
    const r = scaleCompanion({ baseType: 'familiar', form: 'young', webStats: { kind: 'familiar' } }, { level: 6 });
    expect(r.maxHp).toBe(30);
    expect(r.ac).toBeNull();
  });
});
