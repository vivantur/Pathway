// The `when` builder in the authoring surface.
//
// The predicate GRAMMAR and its evaluator are core's (packages/core/src/predicate.ts);
// what is tested here is the EDITOR's flat projection of it: that what an author builds
// is a valid predicate, that an existing one reads back for editing, and — the property
// that matters most — that a tree the flat builder cannot represent is REFUSED rather
// than silently flattened.

import { describe, expect, it } from 'vitest';
import {
  collectPassiveSheetEffects,
  effectTemplateSchema,
  evaluatePredicate,
  passiveEffectSchema,
  rollTags,
  type EffectTemplate,
  type PassiveEffect,
} from '@pathway/core';
import { buildPredicate, readPredicate, type PredicateTerm } from './fields';

const term = (p: Partial<PredicateTerm> = {}): PredicateTerm => ({
  scope: 'opponent:trait',
  value: 'undead',
  negate: false,
  ...p,
});

describe('buildPredicate', () => {
  it('is undefined with no terms — an effect with no condition is unconditional', () => {
    expect(buildPredicate([], 'any')).toBeUndefined();
  });

  it('emits a BARE leaf for a single term, not a one-element group', () => {
    expect(buildPredicate([term()], 'any')).toEqual({ tag: 'opponent:trait:undead' });
  });

  it('wraps a negated term in `not`', () => {
    expect(buildPredicate([term({ negate: true })], 'any')).toEqual({
      not: { tag: 'opponent:trait:undead' },
    });
  });

  it('groups several terms under the chosen joiner', () => {
    const terms = [term(), term({ value: 'fiend' })];
    expect(buildPredicate(terms, 'any')).toEqual({
      any: [{ tag: 'opponent:trait:undead' }, { tag: 'opponent:trait:fiend' }],
    });
    expect(buildPredicate(terms, 'all')).toEqual({
      all: [{ tag: 'opponent:trait:undead' }, { tag: 'opponent:trait:fiend' }],
    });
  });

  it('slugifies the typed trait, so "Swarm Mind" and "swarm-mind" agree', () => {
    expect(buildPredicate([term({ value: '  Swarm Mind ' })], 'any')).toEqual({
      tag: 'opponent:trait:swarm-mind',
    });
  });

  it('ignores a blank term — a half-typed row must not emit a garbage tag', () => {
    expect(buildPredicate([term(), term({ value: '  ' })], 'any')).toEqual({
      tag: 'opponent:trait:undead',
    });
  });

  it('carries each scope through to its namespace', () => {
    for (const scope of ['opponent:trait', 'target:trait', 'origin:trait', 'self:trait', 'effect:trait'] as const) {
      expect(buildPredicate([term({ scope })], 'any')).toEqual({ tag: `${scope}:undead` });
    }
  });

  it('builds a 2-segment `action:<slug>` tag for the action scope', () => {
    expect(buildPredicate([term({ scope: 'action', value: 'make-an-impression' })], 'any')).toEqual({
      tag: 'action:make-an-impression',
    });
  });

  it('produces a `when` the REAL effect schema accepts', () => {
    const parsed = passiveEffectSchema.safeParse({
      kind: 'modifier',
      target: 'will',
      bonusType: 'status',
      value: { kind: 'lit', value: 1 },
      when: buildPredicate([term(), term({ value: 'fiend', negate: true })], 'any'),
    });
    expect(parsed.success).toBe(true);
  });
});

describe('readPredicate — loading an existing condition for editing', () => {
  it('reads an absent predicate as no terms', () => {
    expect(readPredicate(undefined)).toEqual({ terms: [], join: 'any' });
  });

  it('round-trips every flat shape it builds', () => {
    for (const [terms, join] of [
      [[term()], 'any'],
      [[term({ negate: true })], 'any'],
      [[term(), term({ value: 'fiend', scope: 'origin:trait' })], 'all'],
      [[term({ scope: 'self:trait', value: 'elf' }), term({ value: 'dragon', negate: true })], 'any'],
      [[term({ scope: 'action', value: 'make-an-impression' }), term({ value: 'animal' })], 'all'],
    ] as const) {
      const built = buildPredicate(terms, join);
      expect(readPredicate(built)).toEqual({ terms: [...terms], join });
    }
  });

  it('REFUSES a nested group rather than flattening it', () => {
    // Flattening would change the condition's meaning — the same failure as mapping an
    // effect by dropping a condition it can't express. The field shows these read-only.
    expect(readPredicate({ all: [{ tag: 'opponent:trait:undead' }, { any: [{ tag: 'self:trait:elf' }] }] })).toBeNull();
  });

  it('refuses tags outside the trait vocabulary this editor covers', () => {
    expect(readPredicate({ tag: 'self:condition:frightened' })).toBeNull();
    expect(readPredicate({ tag: 'self:effect:rage' })).toBeNull();
    expect(readPredicate({ tag: 'nonsense' })).toBeNull();
  });

  it('refuses a double negation it could not round-trip', () => {
    expect(readPredicate({ not: { not: { tag: 'opponent:trait:undead' } } })).toBeNull();
  });
});

describe('the authoring → sheet loop', () => {
  it('an authored condition reaches the sheet as a situational bonus', () => {
    // The whole point of the `when` control: before it, nothing in the system could
    // PRODUCE a conditional effect, so the sheet's Situational section had no input.
    // This asserts the two halves meet — what the editor builds is what the player
    // reads, with the same prose.
    const authored: PassiveEffect = {
      kind: 'modifier',
      target: 'will',
      bonusType: 'status',
      value: { kind: 'lit', value: 1 },
      when: buildPredicate(
        [
          { scope: 'opponent:trait', value: 'undead', negate: false },
          { scope: 'opponent:trait', value: 'fiend', negate: false },
        ],
        'any',
      ),
    };
    expect(passiveEffectSchema.safeParse(authored).success).toBe(true);

    const sheet = collectPassiveSheetEffects([[authored]], { level: 5 }, ['Homebrew Feat']);
    expect(sheet.conditional).toEqual([
      {
        source: 'Homebrew Feat',
        stat: 'will',
        summary: '+1 status to Will',
        condition: 'vs undead or fiend',
      },
    ]);
    // And it is NOT folded into any total.
    expect(sheet.statModifiers.size).toBe(0);
    expect(sheet.skipped).toBe(0);
  });

  it('authors "+2 circumstance against effects that would make you enfeebled"', () => {
    // The third conditional capability, end to end: the condition an author writes,
    // and the effect declaration it will be tested against.
    const when = buildPredicate([{ scope: 'effect:causes', value: 'enfeebled', negate: false }], 'any');
    expect(when).toEqual({ tag: 'effect:causes:enfeebled' });

    const sheet = collectPassiveSheetEffects(
      [[{ kind: 'modifier', target: 'fortitude', bonusType: 'circumstance', value: { kind: 'lit', value: 2 }, when }]],
      { level: 5 },
      ['Iron Constitution'],
    );
    expect(sheet.conditional[0]).toEqual({
      source: 'Iron Constitution',
      stat: 'fortitude',
      summary: '+2 circumstance to Fortitude',
      condition: 'vs effects that cause enfeebled',
    });

    // The read side: an effect declaring it inflicts Enfeebled 2 satisfies the tag.
    const inflicting: EffectTemplate = {
      name: 'Sap Vitality',
      conditions: [{ slug: 'enfeebled', value: 2 }],
      duration: { kind: 'unlimited' },
      passives: [],
    };
    expect(effectTemplateSchema.safeParse(inflicting).success).toBe(true);
    expect(evaluatePredicate(when!, rollTags({ effect: { conditions: inflicting.conditions } }))).toBe(true);
    // An effect that inflicts something else does not.
    expect(evaluatePredicate(when!, rollTags({ effect: { conditions: [{ slug: 'clumsy' }] } }))).toBe(false);
  });

  it('authors "+1 to saves against death effects" — the shape EffectTemplate.traits unlocks', () => {
    // This is the capability that was unrepresentable before the traits field: not
    // because the predicate grammar lacked anything, but because no effect DECLARED
    // what kind of effect it was. Both halves are asserted — the condition an author
    // writes, and the declaration on the effect it will be tested against.
    const when = buildPredicate([{ scope: 'effect:trait', value: 'death', negate: false }], 'any');
    expect(when).toEqual({ tag: 'effect:trait:death' });

    const sheet = collectPassiveSheetEffects(
      [[{ kind: 'modifier', target: 'fortitude', bonusType: 'status', value: { kind: 'lit', value: 1 }, when }]],
      { level: 5 },
      ['Deny the Reaper'],
    );
    expect(sheet.conditional[0]).toEqual({
      source: 'Deny the Reaper',
      stat: 'fortitude',
      summary: '+1 status to Fortitude',
      condition: 'vs death effects',
    });

    // The other half: an effect declaring itself a death effect satisfies that tag.
    const incoming: EffectTemplate = {
      name: 'Slay Living',
      traits: ['death', 'void'],
      duration: { kind: 'unlimited' },
      passives: [],
    };
    expect(effectTemplateSchema.safeParse(incoming).success).toBe(true);
    expect(evaluatePredicate(when!, rollTags({ effect: { traits: incoming.traits } }))).toBe(true);
    // An effect that is NOT a death effect does not satisfy it.
    expect(evaluatePredicate(when!, rollTags({ effect: { traits: ['mental'] } }))).toBe(false);
  });

  it('authors the Animal Elocutionist shape — a trait AND the action being performed', () => {
    // "+1 circumstance to Diplomacy to Make an Impression on animals" — the Foundry
    // corpus's `{ all: [opponent:trait:animal, action:make-an-impression] }`, now
    // authorable by hand rather than only accepted from ingest.
    const when = buildPredicate(
      [
        { scope: 'opponent:trait', value: 'animal', negate: false },
        { scope: 'action', value: 'make-an-impression', negate: false },
      ],
      'all',
    );
    expect(when).toEqual({ all: [{ tag: 'opponent:trait:animal' }, { tag: 'action:make-an-impression' }] });

    const sheet = collectPassiveSheetEffects(
      [[{ kind: 'modifier', target: 'diplomacy', bonusType: 'circumstance', value: { kind: 'lit', value: 1 }, when }]],
      { level: 5 },
      ['Animal Elocutionist'],
    );
    expect(sheet.conditional[0]).toEqual({
      source: 'Animal Elocutionist',
      stat: 'diplomacy',
      summary: '+1 circumstance to Diplomacy',
      condition: 'vs animal and using make an impression',
    });
  });
});
