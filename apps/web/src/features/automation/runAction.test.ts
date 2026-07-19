// Tests for the web's automation host.
//
// The trees here are SHAPE-ONLY demonstrations of the interpreter (a text node, a
// flat roll, a counter spend, damage), never a rules claim about a real activity:
// no rules text backs them, and authoring a real action from memory is exactly the
// failure rules-from-source exists to prevent. What is under test is the HOST —
// that it builds a context correctly, refuses a missing seed, stays deterministic
// under a fixed seed, and narrates honestly. Every NUMBER below came out of core.

import { describe, it, expect } from 'vitest';
import type { GrantedAction, ResolvedCharacter } from '@pathway/core';
import {
  buildContextFor,
  describeMutations,
  describeOutcome,
  hasAutomation,
  runAction,
} from './runAction';

/** A minimal resolved actor. Zeros mean "unknown", per core's own convention. */
function actor(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    level: 5,
    scores: { str: 18, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    mods: { str: 4, dex: 2, con: 1, int: 0, wis: 0, cha: 0 },
    keyAbility: 'str',
    hp: { max: 70 },
    ac: { value: 22, shieldBonus: 0 },
    perception: { modifier: 9, rank: 1 },
    saves: {
      fortitude: { modifier: 12, rank: 2 },
      reflex: { modifier: 9, rank: 1 },
      will: { modifier: 9, rank: 1 },
    },
    classDc: { modifier: 20, rank: 1 },
    speeds: { land: 25 },
    skills: {},
    focusPoints: { max: 2 },
    ...overrides,
  };
}

function action(automation: GrantedAction['automation']): GrantedAction {
  return { id: 'demo', name: 'Demo Action', automation };
}

describe('buildContextFor', () => {
  it('refuses to run without a seed, so every run is replayable', () => {
    // A silently-random seed would make runs unreproducible, which defeats the
    // point of core threading a seeded RNG through every roll.
    expect(() => buildContextFor(actor(), { seed: NaN })).toThrow(/seed/);
    // @ts-expect-error — a caller omitting the seed entirely must fail too.
    expect(() => buildContextFor(actor(), {})).toThrow(/seed/);
  });

  it('defaults onError to `warn`, not core\'s library default of `ignore`', () => {
    // A host narrating to a person must surface a failed node; ignoring one means
    // an action whose cost failed still hands out its effect and nobody is told.
    const ctx = buildContextFor(actor(), { seed: 1 });
    expect(ctx.onError).toEqual({ on: 'warn' });
  });

  it('lets a caller override the error policy', () => {
    const ctx = buildContextFor(actor(), { seed: 1, onError: { on: 'raise' } });
    expect(ctx.onError).toEqual({ on: 'raise' });
  });

  it('supplies NO counters by default — the web holds no play state', () => {
    // Seeding `focus: { current: max }` would assert a fully rested character.
    // The builder knows only `focusPoints.max`, so the honest default is empty.
    const ctx = buildContextFor(actor(), { seed: 1 });
    expect(ctx.counters).toEqual({});
  });

  it('accepts counters a caller can legitimately vouch for', () => {
    const ctx = buildContextFor(actor(), { seed: 1, counters: { focus: { current: 1, max: 2 } } });
    expect(ctx.counters).toEqual({ focus: { current: 1, max: 2 } });
  });

  it('omits `targets` entirely when there are none', () => {
    const ctx = buildContextFor(actor(), { seed: 1 });
    expect(ctx.targets).toBeUndefined();
  });
});

describe('runAction', () => {
  it('runs a text node and narrates it', () => {
    const out = runAction(
      action([{ kind: 'text', body: 'Shape-only demonstration, not a Pathfinder rule.' }]),
      buildContextFor(actor(), { seed: 42 }),
    );
    expect(describeOutcome(out).lines).toEqual([
      'Shape-only demonstration, not a Pathfinder rule.',
    ]);
    expect(out.aborted).toBe(false);
  });

  it('is deterministic: the same seed reproduces the same roll exactly', () => {
    const tree = action([{ kind: 'roll', notation: '2d6+3', name: 'Demo Roll' }]);
    const first = runAction(tree, buildContextFor(actor(), { seed: 7 }));
    const second = runAction(tree, buildContextFor(actor(), { seed: 7 }));
    expect(second).toEqual(first);

    const entry = first.log[0];
    expect(entry?.kind).toBe('roll');
    if (entry?.kind === 'roll') {
      // Core rolled this; the host asserts only that it is in range and that the
      // dice behind the total are reported for transparency.
      expect(entry.dice).toHaveLength(2);
      expect(entry.total).toBeGreaterThanOrEqual(5);
      expect(entry.total).toBeLessThanOrEqual(15);
    }
  });

  it('a different seed can produce a different roll', () => {
    const tree = action([{ kind: 'roll', notation: '1d20' }]);
    const totals = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
        const out = runAction(tree, buildContextFor(actor(), { seed }));
        const e = out.log[0];
        return e?.kind === 'roll' ? e.total : -1;
      }),
    );
    // Not asserting a specific distribution — only that the seed is actually
    // threaded through, rather than every run returning one frozen value.
    expect(totals.size).toBeGreaterThan(1);
  });

  it('an action with no authored tree yet produces an empty outcome', () => {
    const bare: GrantedAction = { id: 'ph', name: 'Placeholder Activity' };
    const out = runAction(bare, buildContextFor(actor(), { seed: 1 }));
    expect(out.log).toEqual([]);
    expect(out.mutations).toEqual([]);
    expect(out.aborted).toBe(false);
    // The caller can still distinguish "nothing authored" from "nothing happened".
    expect(hasAutomation(bare)).toBe(false);
    expect(hasAutomation(action([{ kind: 'text', body: 'x' }]))).toBe(true);
  });
});

describe('describeMutations — the half the log does not tell', () => {
  it('reports damage, which core emits with NO log entry', () => {
    // This is the bug the bot's renderer documents: a damage/heal tree rendered
    // from the log alone narrates the title and never says the number.
    // `target: 'self'` because a damage node DEFAULTS to the current target (see
    // the next test) and a preview from the sheet has none.
    const out = runAction(
      action([{ kind: 'damage', target: 'self', components: [{ formula: '6', type: 'fire' }] }]),
      buildContextFor(actor(), { seed: 3 }),
    );
    expect(out.log).toEqual([]);
    expect(describeMutations(out)).toEqual(['Damage 6 fire']);
  });

  it('a damage node with no target supplied warns instead of hitting the actor', () => {
    // Core defaults `damage` to the CURRENT TARGET, so a targetless run resolves
    // nothing and falls through the host's `warn` policy. Locked deliberately:
    // silently retargeting an unaimed attack onto the actor would be a wrong
    // sheet, and the sheet's preview surface (Step 4) runs without targets.
    const out = runAction(
      action([{ kind: 'damage', components: [{ formula: '6', type: 'fire' }] }]),
      buildContextFor(actor(), { seed: 3 }),
    );
    expect(out.mutations).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('reports a counter spend and what would remain', () => {
    const out = runAction(
      action([{ kind: 'counter', counter: 'focus', amount: { kind: 'lit', value: 1 } }]),
      buildContextFor(actor(), { seed: 3, counters: { focus: { current: 2, max: 2 } } }),
    );
    expect(describeMutations(out)).toEqual(['Spend 1 focus — 1 would remain']);
  });

  it('a focus cost with NO counters supplied warns instead of silently succeeding', () => {
    // The whole point of the empty-counters default: the run must not invent
    // resources. It fails through the host's `warn` policy and says so.
    const out = runAction(
      action([{ kind: 'counter', counter: 'focus', amount: { kind: 'lit', value: 1 }, requireAvailable: true }]),
      buildContextFor(actor(), { seed: 3 }),
    );
    expect(out.mutations).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });
});

describe('describeOutcome', () => {
  it('keeps warnings separate from narration, so a partial run cannot read as whole', () => {
    const out = runAction(
      action([
        { kind: 'text', body: 'Narration.' },
        { kind: 'counter', counter: 'missing', amount: { kind: 'lit', value: 1 }, requireAvailable: true },
      ]),
      buildContextFor(actor(), { seed: 3 }),
    );
    const described = describeOutcome(out);
    expect(described.lines).toEqual(['Narration.']);
    expect(described.warnings.length).toBeGreaterThan(0);
    expect(described.lines.join(' ')).not.toMatch(/missing/);
  });

  it('renders a titled text node with its title', () => {
    const out = runAction(
      action([{ kind: 'text', title: 'Demo', body: 'Body.' }]),
      buildContextFor(actor(), { seed: 1 }),
    );
    expect(describeOutcome(out).lines).toEqual(['Demo\nBody.']);
  });

  it('surfaces an unknown log kind rather than dropping it silently', () => {
    // If core grows its vocabulary, an un-updated renderer must say so — a
    // dropped entry is a missing piece of the story nobody can see.
    const described = describeOutcome({
      log: [{ kind: 'newKind' } as never],
      mutations: [],
      warnings: [],
      aborted: false,
    });
    expect(described.lines).toEqual(['(unrenderable log entry: newKind)']);
  });

  it('tolerates an undefined outcome', () => {
    expect(describeOutcome(undefined)).toEqual({
      lines: [],
      changes: [],
      warnings: [],
      aborted: false,
    });
  });
});
