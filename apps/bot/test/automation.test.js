// Tests for the bot's automation host — rules/automation.js (pure) and
// state/automation.js (the applier).
//
// The point of the split these tests enforce: the pure half computes nothing and
// decides nothing about rules, it only assembles a context and hands it to core;
// the impure half only writes results down. So the assertions here are about
// ADAPTATION and HONESTY — is the actor built from what the bot actually stores,
// is the run replayable, and does everything that cannot land say so — not about
// PF2e math, which is core's and is tested there.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const automation = require('../src/rules/automation');
const applier = require('../src/state/automation');
const core = require('@pathway/core');

const SEED = 12345;

/** A character entry shaped exactly as state/characters.js hands one out. */
function charEntry(overrides = {}) {
  return {
    name: 'Kalindra',
    data: {
      name: 'Kalindra',
      class: 'Cleric',
      level: 7,
      keyability: 'wis',
      attributes: { ancestryhp: 6, classhp: 8, speed: 25 },
      abilities: { str: 10, dex: 14, con: 14, int: 12, wis: 20, cha: 16 },
      proficiencies: { fortitude: 4, reflex: 2, will: 6, perception: 4, classDC: 4, medicine: 4 },
      focusPoints: 2,
      acTotal: { acTotal: 24 },
    },
    ...overrides,
  };
}

describe('buildContext', () => {
  it('builds the actor from the stored Pathbuilder data', () => {
    const ctx = automation.buildContext(charEntry(), { seed: SEED });
    // Sanity: the actor is core's resolved shape, not the raw blob.
    expect(ctx.actor.level).toBe(7);
    expect(ctx.actor.mods.wis).toBe(5);
    expect(ctx.actor.saves.will.modifier).toBe(core.resolvedFromPathbuilder(charEntry().data).saves.will.modifier);
  });

  it('refuses to run without a seed, so no run is unreplayable', () => {
    expect(() => automation.buildContext(charEntry(), {})).toThrow(/seed/);
    expect(() => automation.buildContext(charEntry(), { seed: 'abc' })).toThrow(/seed/);
  });

  it('is replayable: the same seed reproduces the run exactly', () => {
    const tree = [{ kind: 'roll', notation: '4d6+3', name: 'Test' }];
    const a = automation.run(charEntry(), tree, { seed: SEED });
    const b = automation.run(charEntry(), tree, { seed: SEED });
    const c = automation.run(charEntry(), tree, { seed: SEED + 1 });
    expect(a.log).toEqual(b.log);
    // Different seed, different dice — otherwise the seed is not being threaded.
    expect(c.log).not.toEqual(a.log);
  });

  it('resolves targets the same way it resolves the actor', () => {
    const ally = charEntry({ data: { ...charEntry().data, level: 3 } });
    const ctx = automation.buildContext(charEntry(), { seed: SEED, targets: [ally] });
    expect(ctx.targets).toHaveLength(1);
    expect(ctx.targets[0].level).toBe(3);
  });

  it('omits targets entirely when there are none', () => {
    expect(automation.buildContext(charEntry(), { seed: SEED }).targets).toBeUndefined();
  });

  it('passes spell ranks, vars, and the error policy through untouched', () => {
    const ctx = automation.buildContext(charEntry(), {
      seed: SEED,
      spell: { baseRank: 1, castRank: 4 },
      vars: { bonus: 2 },
      onError: { on: 'raise' },
    });
    expect(ctx.spell).toEqual({ baseRank: 1, castRank: 4 });
    expect(ctx.vars).toEqual({ bonus: 2 });
    expect(ctx.onError).toEqual({ on: 'raise' });
  });

  it('survives a sparse entry rather than throwing before the run starts', () => {
    const ctx = automation.buildContext({}, { seed: SEED });
    expect(ctx.actor.level).toBe(1);
    expect(ctx.counters).toEqual({});
  });
});

describe('readCounters', () => {
  it('snapshots /cc counters in core\'s shape', () => {
    const entry = charEntry({
      overlay: { counters: { reagents: { current: 5, max: 8, reset: 'daily', label: 'Infused Reagents' } } },
    });
    expect(automation.readCounters(entry).reagents).toEqual({ current: 5, max: 8 });
  });

  it('exposes focus points under a reserved counter name', () => {
    const entry = charEntry({ overlay: { daily: { focus_spent: 1 } } });
    expect(automation.readCounters(entry).focus).toEqual({ current: 1, max: 2 });
  });

  it('lets a real /cc counter named "focus" win over the reserved pool', () => {
    // The one the player can see and edit is the one that should be spent.
    const entry = charEntry({ overlay: { counters: { focus: { current: 9, max: 9 } } } });
    expect(automation.readCounters(entry).focus).toEqual({ current: 9, max: 9 });
  });

  it('omits focus for a character with no focus pool', () => {
    const entry = charEntry({ data: { ...charEntry().data, focusPoints: 0 } });
    expect(automation.readCounters(entry).focus).toBeUndefined();
  });

  it('skips a malformed counter instead of feeding NaN to the interpreter', () => {
    const entry = charEntry({ overlay: { counters: { broken: { current: 'lots' } } } });
    expect(automation.readCounters(entry).broken).toBeUndefined();
  });

  it('does not mutate the entry it reads', () => {
    // ensureOverlay would initialize slots; a read must not.
    const entry = charEntry();
    automation.readCounters(entry);
    expect(entry.overlay).toBeUndefined();
  });
});

describe('run', () => {
  it('executes a tree and returns core\'s outcome untouched', () => {
    const out = automation.run(charEntry(), [{ kind: 'text', title: 'Bless', body: 'A holy light.' }], { seed: SEED });
    expect(out.log).toEqual([{ kind: 'text', title: 'Bless', body: 'A holy light.' }]);
    expect(out.mutations).toEqual([]);
    expect(out.aborted).toBe(false);
  });

  it('reads the actor\'s own stats inside an expression', () => {
    const out = automation.run(
      charEntry(),
      [
        { kind: 'variable', name: 'v', value: { kind: 'var', name: 'wisdomMod' } },
        { kind: 'roll', notation: 'v', name: 'Wis' },
      ],
      { seed: SEED },
    );
    const roll = out.log.find(l => l.kind === 'roll');
    expect(roll.total).toBe(5);
  });

  it('spends from the counter snapshot the entry supplied', () => {
    const entry = charEntry({ overlay: { counters: { reagents: { current: 5, max: 8 } } } });
    const out = automation.run(entry, [{ kind: 'counter', counter: 'reagents', amount: { kind: 'lit', value: 2 } }], { seed: SEED });
    expect(out.mutations).toContainEqual({ kind: 'counter', counter: 'reagents', spent: 2, remaining: 3 });
  });

  it('treats an empty or missing tree as a no-op', () => {
    expect(automation.run(charEntry(), [], { seed: SEED }).log).toEqual([]);
    expect(automation.run(charEntry(), undefined, { seed: SEED }).log).toEqual([]);
  });
});

describe('describeOutcome', () => {
  it('renders each log kind, showing the dice behind a roll', () => {
    const { lines } = automation.describeOutcome({
      log: [
        { kind: 'text', title: 'Fireball', body: 'It explodes.' },
        { kind: 'text', body: 'No title here.' },
        { kind: 'roll', notation: '2d6', total: 7, dice: [{ sides: 6, result: 4 }, { sides: 6, result: 3 }], name: 'Damage' },
        { kind: 'check', checkType: 'save', die: 14, total: 19, dc: 20, degree: 'failure', name: 'Reflex' },
      ],
    });
    expect(lines[0]).toBe('**Fireball**\nIt explodes.');
    expect(lines[1]).toBe('No title here.');
    expect(lines[2]).toContain('(4, 3)');
    expect(lines[2]).toContain('**7**');
    expect(lines[3]).toContain('DC 20');
    expect(lines[3]).toContain('**Failure**');
  });

  it('keeps warnings out of the narration so a partial run cannot read as complete', () => {
    const d = automation.describeOutcome({ log: [], warnings: ['no target'], aborted: true });
    expect(d.lines).toEqual([]);
    expect(d.warnings).toEqual(['no target']);
    expect(d.aborted).toBe(true);
  });

  it('says so when core grows a log kind this renderer has not caught up with', () => {
    const { lines } = automation.describeOutcome({ log: [{ kind: 'someFutureKind' }] });
    expect(lines[0]).toContain('unrenderable');
  });

  it('handles an empty outcome', () => {
    expect(automation.describeOutcome({})).toEqual({ lines: [], warnings: [], aborted: false });
  });
});

describe('applyOutcome', () => {
  const damage = (amount, extra = {}) => ({
    kind: 'damage', target: { kind: 'self' }, healing: false, amount, instances: [], ...extra,
  });

  it('applies self damage to the character\'s HP', () => {
    const entry = charEntry({ hp: 76 });
    const report = applier.applyOutcome(entry, { mutations: [damage(10)] });
    expect(entry.hp).toBe(66);
    expect(report.applied[0]).toMatchObject({ kind: 'damage', amount: 10, before: 76, after: 66 });
  });

  it('applies healing upward, clamped at max HP', () => {
    const entry = charEntry({ hp: 70 });
    applier.applyOutcome(entry, { mutations: [damage(20, { healing: true })] });
    expect(entry.hp).toBe(76); // max, not 90
  });

  it('clamps damage at 0 and flags it, without inventing dying rules', () => {
    const entry = charEntry({ hp: 5 });
    const report = applier.applyOutcome(entry, { mutations: [damage(99)] });
    expect(entry.hp).toBe(0);
    expect(report.applied[0].atZero).toBe(true);
    // Dying/wounded belong to /hp and the combat tracker; this must not touch them.
    expect(entry.dying).toBeUndefined();
    expect(entry.wounded).toBeUndefined();
  });

  it('skips damage aimed at another creature, with a reason', () => {
    const entry = charEntry({ hp: 76 });
    const report = applier.applyOutcome(entry, {
      mutations: [{ kind: 'damage', target: { kind: 'target', index: 0 }, healing: false, amount: 10, instances: [] }],
    });
    expect(entry.hp).toBe(76);
    expect(report.applied).toEqual([]);
    expect(report.skipped[0].reason).toMatch(/another creature/);
  });

  it('writes the interpreter\'s counter result in rather than re-clamping it', () => {
    const entry = charEntry({ overlay: { counters: { reagents: { current: 5, max: 8 } } } });
    applier.applyOutcome(entry, { mutations: [{ kind: 'counter', counter: 'reagents', spent: 2, remaining: 3 }] });
    expect(entry.overlay.counters.reagents.current).toBe(3);
  });

  it('spends focus into the overlay slot focus actually lives in', () => {
    const entry = charEntry({ overlay: { daily: { focus_spent: 0 } } });
    applier.applyOutcome(entry, { mutations: [{ kind: 'counter', counter: 'focus', spent: 1, remaining: 1 }] });
    expect(entry.overlay.daily.focus_spent).toBe(1);
  });

  it('skips a counter the character does not have', () => {
    const entry = charEntry();
    const report = applier.applyOutcome(entry, { mutations: [{ kind: 'counter', counter: 'nope', spent: 1, remaining: 0 }] });
    expect(report.skipped[0].reason).toMatch(/no counter named/);
  });

  it('reports temp HP and effects as skipped, never silently drops them', () => {
    const entry = charEntry({ hp: 76 });
    const report = applier.applyOutcome(entry, {
      mutations: [
        { kind: 'temphp', target: { kind: 'self' }, amount: 5 },
        { kind: 'applyEffect', target: { kind: 'self' }, effect: { name: 'Frightened' } },
        { kind: 'removeEffect', target: { kind: 'self' }, name: 'Frightened', cascade: false },
      ],
    });
    expect(report.applied).toEqual([]);
    expect(report.skipped).toHaveLength(3);
    for (const s of report.skipped) expect(s.reason).toMatch(/combatant/);
  });

  it('reports an unrecognized mutation kind instead of ignoring it', () => {
    const report = applier.applyOutcome(charEntry(), { mutations: [{ kind: 'somethingNew' }] });
    expect(report.skipped[0].reason).toMatch(/unrecognized/);
  });

  it('applies mutations in order and handles an empty outcome', () => {
    const entry = charEntry({ hp: 76 });
    const report = applier.applyOutcome(entry, { mutations: [damage(10), damage(6, { healing: true })] });
    expect(entry.hp).toBe(72);
    expect(report.applied.map(a => a.kind)).toEqual(['damage', 'healing']);
    expect(applier.applyOutcome(entry, {})).toEqual({ applied: [], skipped: [] });
  });
});

describe('randomSeed', () => {
  it('produces a 32-bit unsigned integer', () => {
    for (let i = 0; i < 50; i++) {
      const s = applier.randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
