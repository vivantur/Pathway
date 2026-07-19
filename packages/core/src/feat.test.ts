// Worked-example tests for the feat schema + adapter (display/lookup scope).
//
// The six feats the owner provided cover the surface: skill feat with a prereq,
// ancestry feat (Legacy, Uncommon, access requirement), general feat with an
// ability prereq, class feat (passive), class feat granting a one-action, and a
// reaction feat with trigger + requirements. Rules text is from the prompt.

import { describe, it, expect } from 'vitest';
import { coerceFeat, type Feat } from './feat.js';

function feat(raw: unknown): Feat {
  const r = coerceFeat(raw);
  if (!r.ok) throw new Error(`coerceFeat failed: ${r.issues.join(' | ')}`);
  return r.feat;
}

describe('coerceFeat — worked examples', () => {
  it('Acrobatic Performer: skill feat with a prerequisite, no action cost', () => {
    const f = feat({
      name: 'Acrobatic Performer',
      level: 1,
      traits: 'General Skill',
      source: 'Player Core 2 pg. 226',
      featType: 'skill',
      prerequisites: 'trained in Acrobatics',
      description: 'You can roll an Acrobatics check instead of a Performance check when using Perform.',
    });

    expect(f).toEqual({
      id: 'acrobatic_performer',
      version: 1,
      name: 'Acrobatic Performer',
      ownerKind: 'official',
      source: { title: 'Player Core 2', page: 226 },
      rarity: 'common',
      traits: ['General', 'Skill'],
      isLegacy: false,
      level: 1,
      featType: 'skill',
      prerequisites: 'trained in Acrobatics',
      classIds: [],
      description: 'You can roll an Acrobatics check instead of a Performance check when using Perform.',
    });
  });

  it('Arcane Tattoos: ancestry feat — Uncommon, Legacy, an access requirement', () => {
    const f = feat({
      name: 'Arcane Tattoos',
      level: 1,
      traits: 'Uncommon Human',
      source: 'Character Guide pg. 11',
      isLegacy: true,
      featType: 'ancestry',
      ancestryId: 'human',
      access: 'Varisian ethnicity or New Thassilon nationality',
      description: 'You have tattoos corresponding to an ancient Thassilonian school of magic.',
    });

    expect(f.rarity).toBe('uncommon');
    expect(f.traits).toEqual(['Human']);
    expect(f.isLegacy).toBe(true);
    expect(f.featType).toBe('ancestry');
    expect(f.ancestryId).toBe('human');
    expect(f.access).toBe('Varisian ethnicity or New Thassilon nationality');
    expect(f.prerequisites).toBeUndefined();
  });

  it('Fast Recovery: general feat with an ability-score prerequisite', () => {
    const f = feat({
      name: 'Fast Recovery',
      level: 1,
      traits: 'General',
      source: 'Player Core pg. 255',
      featType: 'general',
      prerequisites: 'Constitution +2',
      description: 'Your body quickly bounces back from afflictions.',
    });
    expect(f.featType).toBe('general');
    expect(f.prerequisites).toBe('Constitution +2');
    expect(f.actionCost).toBeUndefined();
  });

  it('Sap Life: class feat (Cleric), level 2, passive', () => {
    const f = feat({
      name: 'Sap Life',
      level: 2,
      traits: 'Cleric Healing',
      source: 'Player Core pg. 115',
      featType: 'class',
      classIds: ['cleric'],
      description: 'When you cast a harm spell and damage a living creature, you regain Hit Points.',
    });
    expect(f.level).toBe(2);
    expect(f.traits).toEqual(['Cleric', 'Healing']);
    expect(f.classIds).toEqual(['cleric']);
    expect(f.actionCost).toBeUndefined();
  });

  it("Channeler's Stance: class feat granting a one-action activity", () => {
    const f = feat({
      name: "Channeler's Stance",
      level: 1,
      traits: 'Animist Stance',
      source: 'War of Immortals pg. 22',
      actionCost: '[one-action]',
      featType: 'class',
      classIds: ['animist'],
      description: 'You enter a stance that allows power to flow through you.',
    });
    expect(f.actionCost).toEqual({ kind: 'actions', min: 1, max: 1 });
  });

  it('Nimble Dodge: reaction feat with trigger + requirements', () => {
    const f = feat({
      name: 'Nimble Dodge',
      level: 1,
      traits: 'Rogue',
      source: 'Player Core pg. 169',
      actionCost: '[reaction]',
      trigger: 'A creature targets you with an attack and you can see the attacker',
      requirements: 'You are not encumbered',
      featType: 'class',
      classIds: ['rogue'],
      description: 'You deftly dodge out of the way, gaining a +2 circumstance bonus to AC.',
    });
    expect(f.actionCost).toEqual({ kind: 'reaction' });
    expect(f.trigger).toBe('A creature targets you with an attack and you can see the attacker');
    expect(f.requirements).toBe('You are not encumbered');
  });
});

describe('coerceFeat — effects + rejections', () => {
  it('carries OUR mapped effects', () => {
    const f = feat({
      name: 'Toughness',
      level: 1,
      traits: 'General',
      source: 'Player Core pg. 258',
      description: 'You can withstand more punishment.',
      effects: [{ kind: 'modifier', target: 'hp', bonusType: 'untyped', value: { kind: 'var', name: 'level' } }],
    });
    expect(f.effects).toEqual([
      { kind: 'modifier', target: 'hp', bonusType: 'untyped', value: { kind: 'var', name: 'level' } },
    ]);
  });

  it('does NOT carry a Foundry `rules` array — their shape is not a field on our content', () => {
    // It used to, as "dormant feedstock", and collectSheetEffects read it at runtime.
    // Rule elements are now mapped to `effects` at ingest and the raw is quarantined
    // in the admin-only sidecar; an incoming row's `rules` is simply ignored.
    const f = feat({
      name: 'Toughness',
      level: 1,
      traits: 'General',
      source: 'Player Core pg. 258',
      description: 'You can withstand more punishment.',
      rules: [{ key: 'FlatModifier', selector: 'hp', value: '@actor.level', type: 'untyped' }],
    });
    expect(f).not.toHaveProperty('rules');
    expect(f.effects).toBeUndefined();
  });

  it('coerces a level-0 feat-like (some data stores deity boons at level 0)', () => {
    const r = coerceFeat({
      name: 'Blessing of the Five', level: 0, traits: 'General', source: 'Book pg. 1', description: 'x',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feat.level).toBe(0);
  });

  it('rejects a feat with no name', () => {
    const r = coerceFeat({ level: 1, traits: 'General', description: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/name/);
  });

  it('rejects a feat whose level cannot be determined', () => {
    const r = coerceFeat({ name: 'No Level', traits: 'General', source: 'Book pg. 1', description: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/level/);
  });
});

describe('coerceFeat — granted actions', () => {
  // The trees here are SHAPE-ONLY demonstrations (a text node, a flat roll), never a
  // rules claim about a real activity: no rules text was supplied for this slice, and
  // authoring a real action from memory is exactly the failure rules-from-source
  // exists to prevent. What is under test is that a feat CAN carry a GrantedAction and
  // that it validates against core's schema — not what any real feat's action does.

  it("carries a runnable GrantedAction in core's shape", () => {
    const f = feat({
      name: 'Demo Stance',
      level: 1,
      traits: 'Class',
      source: 'Book pg. 1',
      featType: 'class',
      classIds: ['fighter'],
      description: 'A feat that hands you an activity.',
      grantedActions: [
        {
          id: 'demo-stance-strike',
          name: 'Demo Stance Strike',
          actionCost: { kind: 'actions', min: 1, max: 1 },
          automation: [{ kind: 'text', body: 'Shape-only demonstration, not a Pathfinder rule.' }],
        },
      ],
    });
    expect(f.grantedActions).toHaveLength(1);
    expect(f.grantedActions?.[0]).toMatchObject({
      id: 'demo-stance-strike',
      name: 'Demo Stance Strike',
      actionCost: { kind: 'actions', min: 1, max: 1 },
    });
  });

  it('accepts a feat that grants an action with no automation tree yet (name/cost only)', () => {
    // A granted action can be declared before its tree is authored — the interpreter
    // simply has nothing to run. This is the state most decided actions start in.
    const f = feat({
      name: 'Placeholder Grant',
      level: 1,
      traits: 'General',
      source: 'Book pg. 1',
      description: 'x',
      grantedActions: [{ id: 'ph', name: 'Placeholder Activity' }],
    });
    expect(f.grantedActions?.[0]?.automation).toBeUndefined();
  });

  it('a feat that grants no activity has no field', () => {
    const f = feat({
      name: 'Passive Feat', level: 1, traits: 'General', source: 'Book pg. 1', description: 'x',
    });
    expect(f.grantedActions).toBeUndefined();
  });

  it("rejects a granted action missing a name (core's GrantedAction schema is strict)", () => {
    const r = coerceFeat({
      name: 'Bad Grant', level: 1, traits: 'General', source: 'Book pg. 1', description: 'x',
      grantedActions: [{ id: 'no-name', automation: [{ kind: 'text', body: 'x' }] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/grantedActions/);
  });

  it('rejects a granted action whose automation tree is invalid', () => {
    const r = coerceFeat({
      name: 'Bad Tree', level: 1, traits: 'General', source: 'Book pg. 1', description: 'x',
      grantedActions: [{ id: 'bad', name: 'Bad', automation: [{ kind: 'roll', notation: 'not dice' }] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/grantedActions/);
  });
});
