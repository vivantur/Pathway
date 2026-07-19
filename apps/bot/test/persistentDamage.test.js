// Tests for how persistent damage stacks — rules/combatV2/model.js addEffect.
//
// Owner-supplied rules (2026-07-18):
//   • You CAN be affected by more than one persistent damage at once, as long as
//     they are DIFFERENT damage types.
//   • The SAME type applied again keeps the HIGHER damage.
//   • Comparing e.g. an existing 3 against an incoming 1d4 is a GM judgement
//     call, explicitly NOT something this system should decide.
//
// So the interesting assertions here are about restraint: the model resolves only
// what is unambiguous, and hands back the rest for a person to settle.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../src/rules/combatV2/model');
const { getPreset } = require('../src/rules/effects');

function encounter() {
  return { version: 2, id: 'ch', channelId: 'ch', combatants: [{ id: 'gob', name: 'Goblin', effects: [] }] };
}

/** Persistent damage exactly as /init addeffect builds it from a preset. */
function persistent(type, value) {
  const p = getPreset(`persistent-${type}`);
  return { name: p.name, value, modifiers: p.build(value), bonusTypes: p.bonusTypes };
}

/** A hand-built persistent effect, for notations the presets never produce. */
function custom(type, dice) {
  return {
    name: `Persistent damage (${type})`,
    modifiers: { kind: 'persistent-damage', dice, damageType: type, dc: 15 },
  };
}

const effectsOf = (enc) => enc.combatants[0].effects;

describe('different damage types coexist', () => {
  it('keeps fire and bleed side by side', () => {
    const enc = encounter();
    model.addEffect(enc, 'Goblin', persistent('fire', 1));
    model.addEffect(enc, 'Goblin', persistent('bleed', 2));
    expect(effectsOf(enc)).toHaveLength(2);
  });

  it('keeps all six types at once', () => {
    const enc = encounter();
    for (const t of ['fire', 'bleed', 'acid', 'cold', 'electricity', 'poison']) {
      model.addEffect(enc, 'Goblin', persistent(t, 1));
    }
    expect(effectsOf(enc)).toHaveLength(6);
  });
});

describe('the same damage type keeps the higher', () => {
  it('replaces a lower one with a higher one', () => {
    const enc = encounter();
    model.addEffect(enc, 'Goblin', persistent('fire', 1));
    const result = model.addEffect(enc, 'Goblin', persistent('fire', 3));
    expect(effectsOf(enc)).toHaveLength(1);
    expect(effectsOf(enc)[0].modifiers.dice).toBe('3d6');
    expect(result.declined).toBeUndefined();
  });

  it('DECLINES a lower one rather than overwriting by recency', () => {
    // The bug this closes: addEffect used to replace whatever was there, so
    // 3d6 already burning could be silently downgraded to 1d6.
    const enc = encounter();
    model.addEffect(enc, 'Goblin', persistent('fire', 3));
    const result = model.addEffect(enc, 'Goblin', persistent('fire', 1));
    expect(effectsOf(enc)[0].modifiers.dice).toBe('3d6');
    expect(result.declined).toBe(true);
    expect(result.reason).toMatch(/higher persistent damage is kept/);
  });

  it('declines an equal one, leaving what is in play alone', () => {
    const enc = encounter();
    model.addEffect(enc, 'Goblin', persistent('fire', 2));
    const result = model.addEffect(enc, 'Goblin', persistent('fire', 2));
    expect(effectsOf(enc)).toHaveLength(1);
    expect(result.declined).toBe(true);
  });
});

describe('what it refuses to decide', () => {
  it('will not compare a flat amount against dice — that is the GM\'s call', () => {
    // The owner's own example: 3 persistent bleed, then 1d4 persistent bleed.
    const enc = encounter();
    model.addEffect(enc, 'Goblin', custom('bleed', '3'));
    const result = model.addEffect(enc, 'Goblin', custom('bleed', '1d4'));

    expect(result.declined).toBe(true);
    expect(result.reason).toMatch(/not comparable/);
    expect(result.reason).toMatch(/GM's call/);
    // Nothing changed, and the message says how to swap it deliberately.
    expect(effectsOf(enc)[0].modifiers.dice).toBe('3');
    expect(result.reason).toMatch(/removeeffect/);
  });

  it('will not compare different die sizes', () => {
    const enc = encounter();
    model.addEffect(enc, 'Goblin', custom('bleed', '1d4'));
    const result = model.addEffect(enc, 'Goblin', custom('bleed', '1d6'));
    expect(result.declined).toBe(true);
    expect(result.reason).toMatch(/not comparable/);
    expect(effectsOf(enc)[0].modifiers.dice).toBe('1d4');
  });

  it('names both amounts so the GM can decide without digging', () => {
    const enc = encounter();
    model.addEffect(enc, 'Goblin', custom('bleed', '3'));
    const result = model.addEffect(enc, 'Goblin', custom('bleed', '1d4'));
    expect(result.reason).toContain('3 persistent bleed damage');
    expect(result.reason).toContain('1d4 persistent bleed damage');
  });

  it('compares flat against flat, which is unambiguous', () => {
    const enc = encounter();
    model.addEffect(enc, 'Goblin', custom('bleed', '2'));
    const result = model.addEffect(enc, 'Goblin', custom('bleed', '5'));
    expect(result.declined).toBeUndefined();
    expect(effectsOf(enc)[0].modifiers.dice).toBe('5');
  });
});

describe('ordinary effects are untouched by any of this', () => {
  it('still replaces a non-persistent effect by recency', () => {
    // Re-applying Frightened 3 over Frightened 1 must still just update it.
    const enc = encounter();
    const frightened = (v) => {
      const p = getPreset('frightened');
      return { name: p.name, value: v, modifiers: p.build(v), bonusTypes: p.bonusTypes };
    };
    model.addEffect(enc, 'Goblin', frightened(1));
    const result = model.addEffect(enc, 'Goblin', frightened(3));
    expect(effectsOf(enc)).toHaveLength(1);
    expect(effectsOf(enc)[0].value).toBe(3);
    expect(result.replaced).toBe(true);
    expect(result.declined).toBeUndefined();
  });
});
