// Tests for rules/effectTranslation.js — core's EffectTemplate → the tracker's
// five flat modifier slots.
//
// Most of these assert what does NOT translate. That is the point: the target
// shape is far poorer than the source, and the design rule is that anything it
// cannot express exactly comes back named in `unsupported` rather than being
// approximated. A +1 to Fortitude rendered as `saveBonus: 1` would silently buff
// Reflex and Will too — a wrong combatant, which is worse than no effect at all.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { translateEffect, translateDuration } = require('../src/rules/effectTranslation');
const { SKILL_SLUGS } = require('@pathway/core');

const mod = (target, value, extra = {}) => ({
  kind: 'modifier',
  target,
  bonusType: 'status',
  value: { kind: 'lit', value },
  ...extra,
});

const template = (passives, extra = {}) => ({
  name: 'Test Effect',
  duration: { kind: 'rounds', count: 3 },
  passives,
  ...extra,
});

describe('what translates exactly', () => {
  it('maps AC, attack, and damage onto their own slots', () => {
    const { effect, unsupported } = translateEffect(
      template([mod('ac', -2), mod('attack', 1), mod('damage', 3)]),
    );
    expect(effect.modifiers).toMatchObject({ acBonus: -2, attackBonus: 1, damageBonus: 3 });
    expect(unsupported).toEqual([]);
  });

  it('collapses all three saves at the same value into saveBonus', () => {
    const { effect, unsupported } = translateEffect(
      template([mod('fortitude', -1), mod('reflex', -1), mod('will', -1)]),
    );
    expect(effect.modifiers.saveBonus).toBe(-1);
    expect(unsupported).toEqual([]);
  });

  it('collapses all sixteen skills at the same value into skillBonus', () => {
    const { effect, unsupported } = translateEffect(template(SKILL_SLUGS.map(s => mod(s, -2))));
    expect(effect.modifiers.skillBonus).toBe(-2);
    expect(unsupported).toEqual([]);
  });

  it('sums two modifiers aimed at the same selector', () => {
    const { effect } = translateEffect(template([mod('ac', -1), mod('ac', -2)]));
    expect(effect.modifiers.acBonus).toBe(-3);
  });

  it('carries the name and a held condition\'s value', () => {
    const { effect } = translateEffect(
      template([mod('ac', -2)], { name: 'Frightened', conditions: [{ slug: 'frightened', value: 2 }] }),
    );
    expect(effect.name).toBe('Frightened');
    expect(effect.value).toBe(2);
  });

  it('leaves value null for an unvalued condition', () => {
    const { effect } = translateEffect(template([mod('ac', -2)]));
    expect(effect.value).toBeNull();
  });
});

describe('what refuses to translate, and says why', () => {
  it('refuses a single save — it would buff the other two', () => {
    const { effect, unsupported } = translateEffect(template([mod('fortitude', 1)]));
    expect(effect).toBeNull(); // nothing representable survived
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].what).toBe('modifier to fortitude');
    expect(unsupported[0].reason).toMatch(/would also affect reflex, will/);
  });

  it('refuses saves at differing values', () => {
    const { unsupported } = translateEffect(
      template([mod('fortitude', 1), mod('reflex', 2), mod('will', 1)]),
    );
    expect(unsupported).toHaveLength(3);
    expect(unsupported[0].reason).toMatch(/differing values/);
  });

  it('refuses a single skill for the same reason', () => {
    const { unsupported } = translateEffect(template([mod('athletics', 2)]));
    expect(unsupported[0].what).toBe('modifier to athletics');
    expect(unsupported[0].reason).toMatch(/one skillBonus/);
  });

  it('refuses a CONDITIONAL modifier rather than showing it as permanent', () => {
    // The named failure mode: a situational bonus displayed as always-on.
    const { effect, unsupported } = translateEffect(
      template([mod('ac', 2, { when: { kind: 'trait', trait: 'undead' } })]),
    );
    expect(effect).toBeNull();
    expect(unsupported[0].reason).toMatch(/conditional/);
  });

  it('refuses a modifier whose value is an expression', () => {
    const { unsupported } = translateEffect(
      template([mod('ac', 0, { value: { kind: 'var', name: 'level' } })]),
    );
    expect(unsupported[0].reason).toMatch(/expression/);
  });

  it('refuses every non-modifier passive kind, naming the kind', () => {
    const { unsupported } = translateEffect(
      template([
        { kind: 'proficiency', target: 'ac', rank: 2, mode: 'upgrade' },
        { kind: 'note', target: 'ac', text: 'something' },
      ]),
    );
    expect(unsupported.map(u => u.what)).toEqual(['proficiency effect', 'note effect']);
  });

  it('refuses a statistic the tracker has no field for', () => {
    const { unsupported } = translateEffect(template([mod('perception', -1)]));
    expect(unsupported[0].what).toBe('modifier to perception');
    expect(unsupported[0].reason).toMatch(/no field/);
  });

  it('returns no effect at all when nothing survived', () => {
    // An empty shell that looks active but does nothing is its own kind of lie.
    const { effect, unsupported } = translateEffect(template([mod('perception', -1)]));
    expect(effect).toBeNull();
    expect(unsupported.length).toBeGreaterThan(0);
  });

  it('keeps the representable part when only some of it translates', () => {
    const { effect, unsupported } = translateEffect(
      template([mod('ac', -2), mod('athletics', -1)]),
    );
    expect(effect.modifiers.acBonus).toBe(-2);
    expect(unsupported).toHaveLength(1);
  });

  it('rejects a template with no name', () => {
    expect(translateEffect(null).effect).toBeNull();
    expect(translateEffect({ passives: [] }).effect).toBeNull();
  });
});

describe('duration', () => {
  it('translates round counts and unlimited exactly', () => {
    expect(translateDuration({ kind: 'rounds', count: 3 })).toEqual({ duration: 3, note: null });
    expect(translateDuration({ kind: 'unlimited' })).toEqual({ duration: null, note: null });
  });

  it('does not invent a round count for durations the tracker cannot model', () => {
    // Guessing "sustained ≈ 1 round" would be a rules claim. Say so instead.
    for (const d of [
      { kind: 'sustained' },
      { kind: 'until', moment: { when: 'end-of-turn' } },
      { kind: 'time', amount: 10, unit: 'minutes' },
      { kind: 'dailyPreparations' },
    ]) {
      const out = translateDuration(d);
      expect(out.duration).toBeNull();
      expect(out.note).toMatch(/manually|does not model/);
    }
  });

  it('surfaces the note on the translated effect', () => {
    const { notes } = translateEffect(template([mod('ac', -1)], { duration: { kind: 'sustained' } }));
    expect(notes[0]).toMatch(/sustained/);
  });
});
