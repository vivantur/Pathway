// Tests for /use — the authored-action catalog, the applied-report renderer, and
// the command's own decisions (which are few, on purpose).
//
// The command is deliberately thin: it resolves a character, picks an action, and
// renders. So these tests check the SEAMS — is every authored entry valid against
// core's schema, does the catalog find things, does the renderer tell the truth
// about what landed — rather than re-testing the interpreter.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';

afterEach(() => vi.restoreAllMocks());

const require = createRequire(import.meta.url);
const catalog = require('../src/rules/authoredActions');
const automation = require('../src/rules/automation');
const applier = require('../src/state/automation');
const { grantedActionSchema } = require('@pathway/core');

function charEntry(overrides = {}) {
  return {
    name: 'Kalindra',
    hp: 40,
    data: {
      name: 'Kalindra', class: 'Cleric', level: 7, keyability: 'wis',
      attributes: { ancestryhp: 6, classhp: 8, speed: 25 },
      abilities: { str: 10, dex: 14, con: 14, int: 12, wis: 20, cha: 16 },
      proficiencies: { fortitude: 4, reflex: 2, will: 6, perception: 4, classDC: 4 },
      focusPoints: 2, acTotal: { acTotal: 24 },
    },
    overlay: { daily: { focus_spent: 0 }, counters: {} },
    ...overrides,
  };
}

describe('the authored catalog', () => {
  it('validates every entry against core\'s GrantedAction schema', () => {
    // The catalog validates at load, so this is a second line of defence — and
    // the assertion that the format is core's, not a bespoke bot shape.
    for (const action of catalog.listActions()) {
      expect(grantedActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it('is not empty, and every entry has runnable automation', () => {
    const actions = catalog.listActions();
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) expect(a.automation.length).toBeGreaterThan(0);
  });

  it('gives every entry a unique id', () => {
    const ids = catalog.listActions().map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every authored tree actually runs, given what it needs', () => {
    // The point of the catalog is that it EXECUTES. An entry that validates but
    // throws, aborts, or warns at runtime is a broken entry. Target-requiring
    // actions get a target — running one without is a caller error, not a
    // broken tree, and the command refuses it up front.
    const dummy = { name: 'Training Dummy', maxHp: 20, ac: 15, saves: { fort: 5, ref: 2, will: 0 }, skills: {} };
    for (const action of catalog.listActions()) {
      const targets = catalog.requiresTarget(action) ? [dummy] : [];
      const outcome = automation.run(charEntry(), action.automation, { seed: 99, targets });
      expect(outcome.aborted, `${action.id} aborted`).toBe(false);
      expect(outcome.warnings, `${action.id} warned`).toEqual([]);
    }
  });

  it('knows which actions need a target by reading the tree', () => {
    expect(catalog.requiresTarget(catalog.findAction('demo-strike-target'))).toBe(true);
    expect(catalog.requiresTarget(catalog.findAction('demo-roll'))).toBe(false);
    expect(catalog.requiresTarget(catalog.findAction('demo-spend-focus'))).toBe(false);
    expect(catalog.requiresTarget(undefined)).toBe(false);
  });

  it('finds a target requirement nested inside a branch', () => {
    // Read off the tree, so it cannot drift from what the automation does.
    expect(catalog.requiresTarget({
      automation: [{
        kind: 'branch',
        condition: { kind: 'lit', value: true },
        onTrue: [{ kind: 'damage', target: 'target', components: [{ formula: '1' }] }],
        onFalse: [],
      }],
    })).toBe(true);
  });

  it('finds an action by id and by exact name, case-insensitively', () => {
    const first = catalog.listActions()[0];
    expect(catalog.findAction(first.id)).toEqual(first);
    expect(catalog.findAction(first.name)).toEqual(first);
    expect(catalog.findAction(first.name.toUpperCase())).toEqual(first);
  });

  it('returns null for an unknown or empty query rather than guessing', () => {
    expect(catalog.findAction('no-such-action')).toBeNull();
    expect(catalog.findAction('')).toBeNull();
    expect(catalog.findAction(undefined)).toBeNull();
  });

  it('searches by substring and caps the result count', () => {
    expect(catalog.searchActions('demo').length).toBeGreaterThan(0);
    expect(catalog.searchActions('zzzz')).toEqual([]);
    // An empty query lists everything — that is what an unfocused autocomplete shows.
    expect(catalog.searchActions('')).toHaveLength(catalog.listActions().length);
    expect(catalog.searchActions('', 1)).toHaveLength(1);
  });

  it('formats every action-cost shape', () => {
    expect(catalog.formatActionCost({ kind: 'actions', min: 1, max: 1 })).toBe('[1 action]');
    expect(catalog.formatActionCost({ kind: 'actions', min: 2, max: 2 })).toBe('[2 actions]');
    expect(catalog.formatActionCost({ kind: 'actions', min: 1, max: 3 })).toBe('[1–3 actions]');
    expect(catalog.formatActionCost({ kind: 'reaction' })).toBe('[reaction]');
    expect(catalog.formatActionCost({ kind: 'free' })).toBe('[free action]');
    expect(catalog.formatActionCost({ kind: 'time', text: '10 minutes' })).toBe('[10 minutes]');
    expect(catalog.formatActionCost(undefined)).toBe('');
  });
});

describe('describeApplied', () => {
  it('reports damage with the before/after the character actually has', () => {
    const { lines } = automation.describeApplied({
      applied: [{ kind: 'damage', amount: 10, before: 40, after: 30, atZero: false }],
    });
    expect(lines[0]).toContain('**10**');
    expect(lines[0]).toContain('40 → **30**');
  });

  it('flags reaching 0 HP', () => {
    const { lines } = automation.describeApplied({
      applied: [{ kind: 'damage', amount: 99, before: 5, after: 0, atZero: true }],
    });
    expect(lines[0]).toContain('at 0');
  });

  it('reports the REAL healing delta, not the rolled amount', () => {
    // Healing 20 into a character 6 below max heals 6. Saying 20 would be
    // reporting the player's own sheet back to them incorrectly.
    const { lines } = automation.describeApplied({
      applied: [{ kind: 'healing', amount: 20, before: 70, after: 76, atZero: false }],
    });
    expect(lines[0]).toContain('healed **6**');
    expect(lines[0]).toContain('capped at max HP');
  });

  it('does not cry "capped" when the full amount landed', () => {
    const { lines } = automation.describeApplied({
      applied: [{ kind: 'healing', amount: 6, before: 40, after: 46, atZero: false }],
    });
    expect(lines[0]).toContain('healed **6**');
    expect(lines[0]).not.toContain('capped');
  });

  it('reports a counter spend with what remains', () => {
    const { lines } = automation.describeApplied({
      applied: [{ kind: 'counter', counter: 'focus', spent: 1, remaining: 1 }],
    });
    expect(lines[0]).toContain('Spent **1** focus');
    expect(lines[0]).toContain('**1** remaining');
  });

  it('surfaces skipped mutations with their reason', () => {
    const { skipped } = automation.describeApplied({
      applied: [],
      skipped: [{ kind: 'applyEffect', reason: 'conditions live on a combatant' }],
    });
    expect(skipped[0]).toBe('applyEffect: conditions live on a combatant');
  });

  it('handles an empty report', () => {
    expect(automation.describeApplied({})).toEqual({ lines: [], skipped: [] });
  });
});

describe('/use end to end', () => {
  /** Drive the real command with a fake interaction, stubbing only persistence. */
  async function runUse(actionQuery, entry) {
    const characters = { u1: { kal: entry } };
    const characterState = require('../src/state/characters');
    vi.spyOn(characterState, 'getAll').mockReturnValue(characters);
    vi.spyOn(characterState, 'resolveChar').mockReturnValue({ charKey: 'kal', char: entry });
    const saveAll = vi.spyOn(characterState, 'saveAll').mockResolvedValue(undefined);

    const replies = [];
    const interaction = {
      user: { id: 'u1' },
      options: {
        getString: (n) => (n === 'action' ? actionQuery : null),
        getFocused: () => '',
      },
      reply: (payload) => { replies.push(payload); return payload; },
      respond: (choices) => { replies.push(choices); return choices; },
    };

    const useCmd = require('../src/commands/use/command');
    await useCmd.execute(interaction);
    return { reply: replies[0], saveAll, interaction, useCmd };
  }

  it('runs an action and reports what changed', async () => {
    const entry = charEntry({ hp: 40 });
    const { reply, saveAll } = await runUse('demo-spend-focus', entry);

    // The heal landed on the real entry, and focus was spent.
    expect(entry.hp).toBe(45);
    expect(entry.overlay.daily.focus_spent).toBe(1);
    expect(saveAll).toHaveBeenCalled();

    const embed = reply.embeds[0].data;
    expect(embed.title).toContain('Demo: Spend Focus');
    const changed = embed.fields.find(f => f.name === 'What changed');
    expect(changed.value).toContain('healed **5**');
    expect(changed.value).toContain('Spent **1** focus');
    // The seed is shown so the result can be reproduced.
    expect(embed.footer.text).toMatch(/seed \d+/);
  });

  it('does not write to the database for a narration-only action', async () => {
    const entry = charEntry();
    const { reply, saveAll } = await runUse('demo-roll', entry);
    expect(saveAll).not.toHaveBeenCalled();
    expect(reply.embeds[0].data.description).toContain('🎲');
  });

  it('reads the character\'s own stats inside a tree', async () => {
    const { reply } = await runUse('demo-stat-roll', charEntry());
    // wis 20 → +5, so a 1d20+5 roll can never come out below 6.
    const rolled = Number(reply.embeds[0].data.description.match(/\*\*(\d+)\*\*/)[1]);
    expect(rolled).toBeGreaterThanOrEqual(6);
    expect(rolled).toBeLessThanOrEqual(25);
  });

  it('refuses an unknown action and lists what exists', async () => {
    const { reply, saveAll } = await runUse('not-a-real-action', charEntry());
    expect(reply.content).toContain('No authored action matches');
    expect(reply.ephemeral).toBe(true);
    expect(saveAll).not.toHaveBeenCalled();
  });

  it('offers the catalog through autocomplete', async () => {
    const { interaction, useCmd } = await runUse('demo-roll', charEntry());
    const choices = await useCmd.autocomplete(interaction);
    expect(choices.length).toBe(catalog.listActions().length);
    expect(choices[0]).toHaveProperty('value');
    expect(choices[0].name).toMatch(/\[/); // carries the action cost
  });
});

describe('a failing cost aborts the action rather than granting it for free', () => {
  it('aborts, heals nothing, and says why when the focus pool is empty', () => {
    // The cost node carries `raise`: an unpayable cost must stop the action, not
    // warn and then hand out the effect anyway.
    const entry = charEntry({ hp: 40, overlay: { daily: { focus_spent: 2 }, counters: {} } });
    const action = catalog.findAction('demo-spend-focus');
    const outcome = automation.run(entry, action.automation, { seed: 7 });

    expect(outcome.aborted).toBe(true);
    expect(outcome.warnings.length).toBeGreaterThan(0);
    expect(outcome.mutations).toEqual([]);

    const report = applier.applyOutcome(entry, outcome);
    expect(report.applied).toEqual([]);
    expect(entry.hp).toBe(40);
  });

  it('surfaces a non-fatal failure as a warning instead of swallowing it', () => {
    // The host defaults to `warn`, so a node without its own policy still
    // reports. Core's own default (`ignore`) would have made this silent.
    const outcome = automation.run(charEntry(), [{ kind: 'counter', counter: 'nonexistent', amount: { kind: 'lit', value: 1 } }], { seed: 7 });
    expect(outcome.warnings.length).toBeGreaterThan(0);
  });
});
