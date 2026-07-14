// Worked-example tests for the spell schema + adapter.
//
// The contract: each of the seven real spells we gathered from Archives of Nethys
// is fed to `coerceSpell` as a loose import object, and the resulting canonical
// Spell is asserted field-by-field. Between them they exercise every branch of
// the schema (legacy vs remaster defense labels, no-rarity default, focus spells
// with no traditions, attack vs save, interval vs at-rank heightening, the
// association family, variable action cost). Rules text is from the prompt, per
// the rules-from-source rule — nothing here is invented from model memory.

import { describe, it, expect } from 'vitest';
import {
  coerceSpell,
  parseActionCostText,
  parseDefenseText,
  parseDefenses,
  parseSource,
  parseHeightening,
  parseAssociations,
  extractRarity,
  splitTraits,
  spellSchema,
  type Spell,
} from './spell.js';

/** Assert a coerce succeeds and return the spell (fails loudly with issues if not). */
function coerced(raw: unknown): Spell {
  const r = coerceSpell(raw);
  if (!r.ok) throw new Error(`coerceSpell failed: ${r.issues.join(' | ')}`);
  return r.spell;
}

describe('coerceSpell — worked examples', () => {
  it('Ancient Dust: legacy non-basic save, +2 interval, area (no range), verbatim legacy traits', () => {
    const spell = coerced({
      name: 'Ancient Dust',
      rank: 1,
      cast: '[two-actions] somatic, verbal',
      traits: 'Uncommon Cantrip Necromancy Negative', // space-separated on AoN
      traditions: 'arcane, divine',
      source: "Pathfinder #186: Ghost King's Rage pg. 75",
      area: '15-foot cone',
      savingThrow: 'Fortitude', // legacy "Saving Throw" label → non-basic
      description: 'You cough up a cloud of gray soil.',
      degreeOfSuccess: {
        critSuccess: 'The creature is unaffected.',
        success: 'The creature takes half damage and no persistent damage.',
        failure: 'The creature takes full damage and persistent damage.',
        critFailure: 'The creature takes double damage and double the persistent damage.',
      },
      heightening:
        'Heightened (+2) The initial negative damage increases by 1d6, and the persistent damage increases by 1.',
      isLegacy: true,
    });

    expect(spell).toEqual({
      id: 'ancient_dust',
      version: 1,
      name: 'Ancient Dust',
      ownerKind: 'official',
      source: { title: "Pathfinder #186: Ghost King's Rage", page: 75 },
      rarity: 'uncommon',
      traits: ['Cantrip', 'Necromancy', 'Negative'],
      isLegacy: true,
      spellType: 'cantrip',
      rank: 1,
      traditions: ['arcane', 'divine'],
      actionCost: { kind: 'actions', min: 2, max: 2 },
      castComponents: ['somatic', 'verbal'],
      area: '15-foot cone',
      defenses: [{ kind: 'save', save: 'fortitude', basic: false }],
      degreeOfSuccess: {
        critSuccess: 'The creature is unaffected.',
        success: 'The creature takes half damage and no persistent damage.',
        failure: 'The creature takes full damage and persistent damage.',
        critFailure: 'The creature takes double damage and double the persistent damage.',
      },
      heightening: [
        {
          kind: 'interval',
          step: 2,
          effect:
            'The initial negative damage increases by 1d6, and the persistent damage increases by 1.',
        },
      ],
      associations: [],
      description: 'You cough up a cloud of gray soil.',
    });
  });

  it('Electric Arc: no rarity → common, mystery association, basic Reflex, free-text targets', () => {
    const spell = coerced({
      name: 'Electric Arc',
      rank: 1,
      actionCost: '[two-actions]',
      traits: 'Cantrip Concentrate Electricity Manipulate',
      traditions: 'arcane, primal',
      mystery: 'tempest',
      source: 'Player Core pg. 328',
      range: '30 feet',
      targets: '1 or 2 creatures',
      defense: 'basic Reflex',
      description: 'An arc of lightning leaps from one target to another.',
      heightening: 'Heightened (+1) The damage increases by 1d4.',
    });

    expect(spell.rarity).toBe('common');
    expect(spell.traits).toEqual(['Cantrip', 'Concentrate', 'Electricity', 'Manipulate']);
    expect(spell.spellType).toBe('cantrip');
    expect(spell.actionCost).toEqual({ kind: 'actions', min: 2, max: 2 });
    expect(spell.castComponents).toEqual([]);
    expect(spell.defenses).toEqual([{ kind: 'save', save: 'reflex', basic: true }]);
    expect(spell.targets).toBe('1 or 2 creatures');
    expect(spell.associations).toEqual([{ kind: 'mystery', values: ['tempest'] }]);
    expect(spell.heightening).toEqual([
      { kind: 'interval', step: 1, effect: 'The damage increases by 1d4.' },
    ]);
    expect(spell.degreeOfSuccess).toBeUndefined();
  });

  it('Gouging Claw: attack (Defense AC) → ac defense, no save', () => {
    const spell = coerced({
      name: 'Gouging Claw',
      rank: 1,
      actionCost: '[two-actions]',
      traits: 'Attack Cantrip Concentrate Manipulate Morph',
      traditions: 'arcane, primal',
      source: 'Player Core pg. 333',
      range: 'touch',
      targets: '1 creature',
      defense: 'AC',
      description: 'You temporarily morph your limb into a clawed appendage.',
      heightening:
        'Heightened (+1) The damage increases by 1d6 and the persistent bleed damage increases by 1.',
    });

    expect(spell.defenses).toEqual([{ kind: 'ac' }]);
    expect(spell.range).toBe('touch');
    expect(spell.traits).toEqual(['Attack', 'Cantrip', 'Concentrate', 'Manipulate', 'Morph']);
    expect(spell.spellType).toBe('cantrip');
  });

  it('Bless: pure utility — no defense, no damage, area emanation, duration, no targets', () => {
    const spell = coerced({
      name: 'Bless',
      rank: 1,
      actionCost: '[two-actions]',
      traits: 'Aura Concentrate Manipulate Mental',
      traditions: 'divine, occult',
      source: 'Player Core pg. 318',
      area: '15-foot emanation',
      duration: '1 minute',
      description: 'Blessings from beyond help your companions strike true.',
    });

    expect(spell.spellType).toBe('spell');
    expect(spell.defenses).toEqual([]);
    expect(spell.degreeOfSuccess).toBeUndefined();
    expect(spell.heightening).toEqual([]);
    expect(spell.associations).toEqual([]);
    expect(spell.targets).toBeUndefined();
    expect(spell.range).toBeUndefined();
    expect(spell.area).toBe('15-foot emanation');
    expect(spell.duration).toBe('1 minute');
  });

  it('Enthrall: bloodline + deity associations (ordered), non-basic Will, 4-tier DoS, no damage', () => {
    const spell = coerced({
      name: 'Enthrall',
      rank: 3,
      actionCost: '[two-actions]',
      traits: 'Auditory Concentrate Emotion Manipulate',
      traditions: 'arcane, occult',
      source: 'Player Core pg. 329',
      bloodlines: 'diabolic, fey',
      deities: 'Ardad Lili, Belial, Bes',
      range: '120 feet',
      targets: 'all creatures in range',
      defense: 'Will',
      duration: 'sustained',
      description: 'Your words fascinate your targets.',
      degreeOfSuccess: {
        critSuccess: 'The target is unaffected and notices that you tried to use magic.',
        success: "The target needn't pay attention.",
        failure: 'The target is fascinated with you.',
        critFailure: "As failure, but the target can't attempt a save.",
      },
    });

    expect(spell.rank).toBe(3);
    expect(spell.defenses).toEqual([{ kind: 'save', save: 'will', basic: false }]);
    expect(spell.associations).toEqual([
      { kind: 'bloodline', values: ['diabolic', 'fey'] },
      { kind: 'deity', values: ['Ardad Lili', 'Belial', 'Bes'] },
    ]);
    expect(spell.duration).toBe('sustained');
    expect(spell.degreeOfSuccess?.failure).toBe('The target is fascinated with you.');
  });

  it('Agile Feet: focus spell — no traditions, domain association, one-action, Uncommon', () => {
    const spell = coerced({
      name: 'Agile Feet',
      rank: 1,
      actionCost: '[one-action]',
      traits: 'Uncommon Cleric Focus Manipulate',
      source: 'Player Core pg. 379',
      domain: 'travel',
      duration: 'until the end of the current turn',
      description: 'The blessings of your god make your feet faster.',
    });

    expect(spell.spellType).toBe('focus');
    expect(spell.rarity).toBe('uncommon');
    expect(spell.traits).toEqual(['Cleric', 'Focus', 'Manipulate']);
    expect(spell.traditions).toEqual([]);
    expect(spell.actionCost).toEqual({ kind: 'actions', min: 1, max: 1 });
    expect(spell.associations).toEqual([{ kind: 'domain', values: ['travel'] }]);
    expect(spell.duration).toBe('until the end of the current turn');
    expect(spell.defenses).toEqual([]);
  });

  it('Illusory Disguise: three at-rank heighten entries, singular Bloodline normalized', () => {
    const spell = coerced({
      name: 'Illusory Disguise',
      rank: 1,
      actionCost: '[two-actions]',
      traits: 'Concentrate Illusion Manipulate Visual',
      traditions: 'arcane, occult',
      source: 'Player Core pg. 337',
      bloodline: 'hag', // singular label → normalized to 'bloodline'
      deities: 'Cormion, Hastur',
      range: '30 feet',
      targets: '1 willing creature',
      duration: '1 hour',
      description: 'You create an illusion that causes the target to appear as another creature.',
      heightening:
        'Heightened (3rd) The target can appear as any creature of the same size.\n' +
        'Heightened (4th) You can target up to 10 willing creatures.\n' +
        'Heightened (7th) As 4th, but you can choose disguises that impersonate specific individuals.',
    });

    expect(spell.heightening).toEqual([
      { kind: 'at-rank', rank: 3, effect: 'The target can appear as any creature of the same size.' },
      { kind: 'at-rank', rank: 4, effect: 'You can target up to 10 willing creatures.' },
      {
        kind: 'at-rank',
        rank: 7,
        effect: 'As 4th, but you can choose disguises that impersonate specific individuals.',
      },
    ]);
    expect(spell.associations).toEqual([
      { kind: 'bloodline', values: ['hag'] },
      { kind: 'deity', values: ['Cormion', 'Hastur'] },
    ]);
  });
});

describe('coerceSpell — variable action cost & column-spelling tolerance', () => {
  it('Heal-style variable cost from the bracketed AoN form', () => {
    const spell = coerced({
      name: 'Heal',
      rank: 1,
      actionCost: '[one-action] to [three-actions]',
      traits: 'Healing Manipulate Vitality',
      traditions: 'divine, primal',
      source: 'Player Core pg. 334',
      defense: 'basic Fortitude',
      description: 'You channel positive energy to heal the living or damage the undead.',
    });
    expect(spell.actionCost).toEqual({ kind: 'actions', min: 1, max: 3 });
  });

  it('reads rank from `level`/`spell_level` and save from `saving_throw` (DB-row spellings)', () => {
    const spell = coerced({
      name: 'Old Row Spell',
      level: '2', // string level, not `rank`
      actions: 'two actions',
      traits: ['Concentrate', 'Manipulate'], // array form
      traditions: ['occult'],
      source: 'Some Book pg. 10',
      saving_throw: 'basic reflex',
      description: 'A spell stored under legacy column names.',
    });
    expect(spell.rank).toBe(2);
    expect(spell.defenses).toEqual([{ kind: 'save', save: 'reflex', basic: true }]);
    expect(spell.traditions).toEqual(['occult']);
  });
});

describe('coerceSpell — rejections (write-side validation)', () => {
  it('rejects a spell with no name', () => {
    const r = coerceSpell({ rank: 1, actionCost: '[two-actions]', description: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/name/);
  });

  it('rejects a spell whose rank cannot be determined', () => {
    const r = coerceSpell({ name: 'No Rank', actionCost: '[two-actions]', description: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/rank/);
  });

  it('rejects an out-of-range rank', () => {
    const r = coerceSpell({ name: 'Too High', rank: 11, actionCost: '[two-actions]', description: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/rank/);
  });

  it('rejects a missing description', () => {
    const r = coerceSpell({ name: 'No Desc', rank: 1, actionCost: '[two-actions]' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/description/);
  });
});

describe('schema-level constraints', () => {
  it('rejects an actions cost with min > max', () => {
    const base = coerced({
      name: 'Base',
      rank: 1,
      actionCost: '[two-actions]',
      traits: 'Manipulate',
      source: 'Book pg. 1',
      description: 'ok',
    });
    const bad = { ...base, actionCost: { kind: 'actions', min: 3, max: 1 } };
    expect(spellSchema.safeParse(bad).success).toBe(false);
  });

  it('each defense entry is a well-formed save or ac (a save requires its fields)', () => {
    expect(spellSchema.shape.defenses.safeParse([{ kind: 'ac' }]).success).toBe(true);
    expect(
      spellSchema.shape.defenses.safeParse([{ kind: 'save', save: 'reflex', basic: false }]).success,
    ).toBe(true);
    // A "save" entry missing its required fields is rejected.
    expect(spellSchema.shape.defenses.safeParse([{ kind: 'save', save: 'reflex' }]).success).toBe(false);
  });
});

describe('defenses & optional actionCost (gap fixes from the AoN audit)', () => {
  it('parseDefenses handles single, dual attack+save, choice-of-save, and see-text', () => {
    expect(parseDefenses('basic  Reflex')).toEqual([{ kind: 'save', save: 'reflex', basic: true }]);
    expect(parseDefenses('AC')).toEqual([{ kind: 'ac' }]);
    // Disintegrate-style: attack roll AND a basic Fortitude save — both kept.
    expect(parseDefenses('AC and  basic  Fortitude')).toEqual([
      { kind: 'ac' },
      { kind: 'save', save: 'fortitude', basic: true },
    ]);
    // Target's-choice: both saves kept; the "or" nuance lives in the description.
    expect(parseDefenses("basic  Reflex or Will (target's choice)")).toEqual([
      { kind: 'save', save: 'reflex', basic: true },
      { kind: 'save', save: 'will', basic: false },
    ]);
    // "see text" carries no structured defense.
    expect(parseDefenses('see text')).toEqual([]);
    // The Attack trait contributes an ac even with no save string.
    expect(parseDefenses(undefined, true)).toEqual([{ kind: 'ac' }]);
  });

  it('coerces a spell with no action cost (actionCost is optional)', () => {
    const r = coerceSpell({
      name: 'Constant Effect',
      rank: 1,
      traits: 'Aura',
      source: 'Book pg. 1',
      description: 'A spell with no discrete cast action.',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spell.actionCost).toBeUndefined();
  });

  it('coerces a cantrip stored at rank 0 and keeps its associations', () => {
    // Some data sources (incl. the live DB) store cantrips at level 0 rather than
    // 1. Rejecting rank 0 was dropping every cantrip to the raw fallback, hiding
    // its associations on the web.
    const r = coerceSpell({
      name: 'Caustic Blast',
      level: 0,
      type: 'Cantrip',
      traits: 'Acid, Cantrip, Concentrate, Manipulate',
      traditions: 'arcane, primal',
      source: 'Player Core pg. 319',
      defense: 'basic Reflex',
      description: 'Fling a glob of acid that splashes a small area.',
      associations: [
        { kind: 'bloodline', values: ['Demonic'] },
        { kind: 'mystery', values: ['Blight'] },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spell.rank).toBe(0);
      expect(r.spell.spellType).toBe('cantrip');
      expect(r.spell.associations).toEqual([
        { kind: 'mystery', values: ['Blight'] },
        { kind: 'bloodline', values: ['Demonic'] },
      ]);
    }
  });
});

describe('pure helpers', () => {
  it('parseActionCostText handles every casting form', () => {
    expect(parseActionCostText('[two-actions]')).toEqual({ kind: 'actions', min: 2, max: 2 });
    expect(parseActionCostText('[one-action]')).toEqual({ kind: 'actions', min: 1, max: 1 });
    expect(parseActionCostText('one to three actions')).toEqual({ kind: 'actions', min: 1, max: 3 });
    expect(parseActionCostText('reaction')).toEqual({ kind: 'reaction' });
    expect(parseActionCostText('free action')).toEqual({ kind: 'free' });
    expect(parseActionCostText('10 minutes')).toEqual({ kind: 'time', text: '10 minutes' });
    expect(parseActionCostText('1 minute')).toEqual({ kind: 'time', text: '1 minute' });
    expect(parseActionCostText('nonsense')).toBeUndefined();
  });

  it('parseDefenseText distinguishes ac, basic saves, and plain saves', () => {
    expect(parseDefenseText('AC')).toEqual({ kind: 'ac' });
    expect(parseDefenseText('basic Reflex')).toEqual({ kind: 'save', save: 'reflex', basic: true });
    expect(parseDefenseText('Fortitude')).toEqual({ kind: 'save', save: 'fortitude', basic: false });
    expect(parseDefenseText('')).toBeUndefined();
  });

  it('parseSource splits title and page', () => {
    expect(parseSource('Player Core pg. 328')).toEqual({ title: 'Player Core', page: 328 });
    expect(parseSource("Pathfinder #186: Ghost King's Rage pg. 75")).toEqual({
      title: "Pathfinder #186: Ghost King's Rage",
      page: 75,
    });
    expect(parseSource('No Page Book')).toEqual({ title: 'No Page Book' });
  });

  it('extractRarity pulls a rarity token and leaves the rest verbatim', () => {
    expect(extractRarity(['Uncommon', 'Cantrip', 'Necromancy'])).toEqual({
      rarity: 'uncommon',
      rest: ['Cantrip', 'Necromancy'],
    });
    expect(extractRarity(['Cantrip', 'Manipulate'])).toEqual({
      rarity: 'common',
      rest: ['Cantrip', 'Manipulate'],
    });
  });

  it('splitTraits handles space-separated, comma-separated, and array inputs', () => {
    expect(splitTraits('Uncommon Cantrip Necromancy')).toEqual(['Uncommon', 'Cantrip', 'Necromancy']);
    expect(splitTraits('Uncommon, Cantrip')).toEqual(['Uncommon', 'Cantrip']);
    expect(splitTraits(['Uncommon', 'Cantrip'])).toEqual(['Uncommon', 'Cantrip']);
  });

  it('parseHeightening parses both interval and at-rank without newlines', () => {
    expect(parseHeightening('Heightened (+1) More damage.')).toEqual([
      { kind: 'interval', step: 1, effect: 'More damage.' },
    ]);
    expect(parseHeightening('Heightened (3rd) A. Heightened (5th) B.')).toEqual([
      { kind: 'at-rank', rank: 3, effect: 'A.' },
      { kind: 'at-rank', rank: 5, effect: 'B.' },
    ]);
  });

  it('parseAssociations normalizes plural/singular and orders kinds', () => {
    expect(parseAssociations({ deities: 'A, B', bloodline: 'hag' })).toEqual([
      { kind: 'bloodline', values: ['hag'] },
      { kind: 'deity', values: ['A', 'B'] },
    ]);
  });
});
