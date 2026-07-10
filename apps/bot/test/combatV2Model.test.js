// Tests for rules/combatV2/model.js — the PURE combat v2 rules.
//
// The point of this file is what it does NOT do: there is no channel id, no
// encounter Map, no Supabase, no bot. Every test builds a plain object and calls
// a function on it. That is the whole reason the model was split out of the
// store, and it is the precondition for these rules ever moving to packages/core.
//
// test/combatV2.test.js still drives the same rules through state/combat.js
// (channel ids, persistence). Between them: same rules, both entry points.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { stubRandomSequence, die } from './helpers.js';

const require = createRequire(import.meta.url);
const model = require('../src/rules/combatV2/model');

afterEach(() => vi.restoreAllMocks());

/** A bare encounter object — exactly what the model expects, nothing more. */
function encounter(combatants = []) {
  return {
    version: 2,
    id: 'enc',
    channelId: 'enc',
    guildId: null,
    gmId: 'gm',
    name: 'Test',
    round: 1,
    turnIndex: 0,
    combatants: combatants.map(c =>
      model.makeCombatant({ initiative: 10, hp: 20, maxHp: 20, ac: 15, type: 'pc', ...c }),
    ),
    log: [],
  };
}

const get = (enc, name) => model.findCombatant(enc, name);

// ─── The layering guard ──────────────────────────────────────────────────────

describe('model purity', () => {
  it('requires nothing but ./rolls — no storage, no supabase, no discord', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(
      require.resolve('../src/rules/combatV2/model.js'),
      'utf8',
    );
    const requires = [...src.matchAll(/require\((['"])(.+?)\1\)/g)].map(m => m[2]);
    expect(requires).toEqual(['./rolls']);
  });

  it('mutates only the encounter it is handed', () => {
    const a = encounter([{ name: 'Fighter' }]);
    const b = encounter([{ name: 'Fighter' }]);
    model.applyHp(a, 'Fighter', -5);
    expect(get(a, 'Fighter').hp).toBe(15);
    expect(get(b, 'Fighter').hp).toBe(20); // untouched
  });
});

// ─── Damage, temp HP, dying ──────────────────────────────────────────────────

describe('applyHp', () => {
  it('temporary HP absorbs damage before real HP', () => {
    const enc = encounter([{ name: 'Fighter', tempHp: 5 }]);
    model.applyHp(enc, 'Fighter', -8);
    const c = get(enc, 'Fighter');
    expect(c.tempHp).toBe(0);
    expect(c.hp).toBe(17); // 8 damage - 5 temp = 3 real
  });

  it('dropping to 0 HP sets Dying 1 (plus Wounded)', () => {
    const enc = encounter([{ name: 'Fighter', hp: 4 }]);
    const r = model.applyHp(enc, 'Fighter', -4);
    expect(r.wentDown).toBe(true);
    expect(r.dying).toBe(1);
    expect(get(enc, 'Fighter').unconscious).toBe(true);
  });

  it('a critical hit that drops you starts at Dying 2', () => {
    const enc = encounter([{ name: 'Fighter', hp: 4 }]);
    const r = model.applyHp(enc, 'Fighter', -4, { isCrit: true });
    expect(r.dying).toBe(2);
  });

  it('Wounded adds to the initial dying value', () => {
    const enc = encounter([{ name: 'Fighter', hp: 4, wounded: 1 }]);
    const r = model.applyHp(enc, 'Fighter', -4);
    expect(r.dying).toBe(2); // 1 base + 1 wounded
  });

  it('doomed lowers the dying value that kills you', () => {
    const enc = encounter([{ name: 'Fighter', hp: 4, doomed: 2 }]);
    const r = model.applyHp(enc, 'Fighter', -4, { isCrit: true });
    // maxDying = 4 - 2 = 2, and a crit knockdown is Dying 2 -> death
    expect(r.maxDying).toBe(2);
    expect(r.died).toBe(true);
    expect(get(enc, 'Fighter')).toBeNull(); // removed from the encounter
  });

  it('healing a dying combatant wakes them and adds Wounded', () => {
    const enc = encounter([{ name: 'Fighter', hp: 0, dying: 2 }]);
    const r = model.applyHp(enc, 'Fighter', 5);
    expect(r.wokeUp).toBe(true);
    const c = get(enc, 'Fighter');
    expect(c.dying).toBe(0);
    expect(c.wounded).toBe(1);
    expect(c.unconscious).toBe(false);
  });

  it('healing never exceeds max HP', () => {
    const enc = encounter([{ name: 'Fighter', hp: 18, maxHp: 20 }]);
    model.applyHp(enc, 'Fighter', 999);
    expect(get(enc, 'Fighter').hp).toBe(20);
  });

  it('throws for an unknown combatant, leaving the encounter untouched', () => {
    const enc = encounter([{ name: 'Fighter' }]);
    expect(() => model.applyHp(enc, 'Nobody', -5)).toThrow(/No combatant matching/);
    expect(get(enc, 'Fighter').hp).toBe(20);
    expect(enc.log).toHaveLength(0);
  });
});

// ─── Recovery checks ─────────────────────────────────────────────────────────

describe('rollRecoveryCheck', () => {
  it('returns null (and does nothing) when not dying', () => {
    const enc = encounter([{ name: 'Fighter' }]);
    expect(model.rollRecoveryCheck(enc, 'Fighter')).toBeNull();
    expect(enc.log).toHaveLength(0);
  });

  it('DC is 10 + dying value', () => {
    const enc = encounter([{ name: 'Fighter', hp: 0, dying: 2 }]);
    stubRandomSequence([die(12, 20)]);
    const r = model.rollRecoveryCheck(enc, 'Fighter');
    expect(r.dc).toBe(12);
  });

  it('success reduces dying by 1', () => {
    const enc = encounter([{ name: 'Fighter', hp: 0, dying: 2 }]);
    stubRandomSequence([die(12, 20)]); // DC 12, exact success
    const r = model.rollRecoveryCheck(enc, 'Fighter');
    expect(r.outcome).toBe('success');
    expect(r.dyingAfter).toBe(1);
  });

  it('a natural 20 is a critical success: dying drops by 2', () => {
    const enc = encounter([{ name: 'Fighter', hp: 0, dying: 3 }]);
    stubRandomSequence([die(20, 20)]);
    const r = model.rollRecoveryCheck(enc, 'Fighter');
    expect(r.outcome).toBe('crit-success');
    expect(r.dyingAfter).toBe(1);
  });

  it('a natural 1 is a critical failure: dying rises by 2', () => {
    const enc = encounter([{ name: 'Fighter', hp: 0, dying: 1 }]);
    stubRandomSequence([die(1, 20)]);
    const r = model.rollRecoveryCheck(enc, 'Fighter');
    expect(r.outcome).toBe('crit-failure');
    expect(r.dyingAfter).toBe(3);
  });

  it('Wounded is added on any increase, and can kill', () => {
    const enc = encounter([{ name: 'Fighter', hp: 0, dying: 1, wounded: 2 }]);
    stubRandomSequence([die(1, 20)]); // crit failure: +2 base, +2 wounded
    const r = model.rollRecoveryCheck(enc, 'Fighter');
    expect(r.woundedAdded).toBe(2);
    expect(r.died).toBe(true);
    expect(get(enc, 'Fighter')).toBeNull();
  });

  it('dropping to dying 0 stabilizes at 0 HP and adds Wounded', () => {
    const enc = encounter([{ name: 'Fighter', hp: 0, dying: 1 }]);
    stubRandomSequence([die(20, 20)]); // crit success: -2 -> clamps to 0
    const r = model.rollRecoveryCheck(enc, 'Fighter');
    expect(r.awoke).toBe(true);
    const c = get(enc, 'Fighter');
    expect(c.dying).toBe(0);
    expect(c.wounded).toBe(1);
    expect(c.hp).toBe(0); // recovery never restores HP
    expect(c.unconscious).toBe(true);
  });
});

// ─── Hero points ─────────────────────────────────────────────────────────────

describe('stabilizeWithHeroPoints', () => {
  it('clears dying, stabilizes at 0 HP, leaves Wounded alone', () => {
    const enc = encounter([{ name: 'Fighter', hp: 0, dying: 3, wounded: 1 }]);
    const r = model.stabilizeWithHeroPoints(enc, 'Fighter');
    expect(r.ok).toBe(true);
    const c = get(enc, 'Fighter');
    expect(c.dying).toBe(0);
    expect(c.wounded).toBe(1); // unchanged
    expect(c.unconscious).toBe(true);
  });

  it('declines when the combatant is not dying', () => {
    const enc = encounter([{ name: 'Fighter' }]);
    expect(model.stabilizeWithHeroPoints(enc, 'Fighter')).toEqual({
      ok: false,
      reason: 'not-dying',
    });
    expect(enc.log).toHaveLength(0);
  });
});

// ─── Turn order ──────────────────────────────────────────────────────────────

describe('turn order', () => {
  it('sorts by initiative, delayed combatants last', () => {
    const enc = encounter([
      { name: 'Slow', initiative: 5 },
      { name: 'Fast', initiative: 20 },
      { name: 'Waiting', initiative: 25, delayed: true },
    ]);
    model.sortCombatants(enc);
    expect(enc.combatants.map(c => c.name)).toEqual(['Fast', 'Slow', 'Waiting']);
  });

  it('advancing past the last combatant increments the round', () => {
    const enc = encounter([
      { name: 'A', initiative: 20 },
      { name: 'B', initiative: 10 },
    ]);
    model.advanceTurn(enc, 1);
    expect(model.currentCombatant(enc).name).toBe('B');
    expect(enc.round).toBe(1);
    model.advanceTurn(enc, 1);
    expect(model.currentCombatant(enc).name).toBe('A');
    expect(enc.round).toBe(2);
  });

  it('advanceTurn on an empty encounter returns null', () => {
    expect(model.advanceTurn(encounter([]), 1)).toBeNull();
  });

  it('removing a combatant before the cursor keeps the cursor on the same actor', () => {
    const enc = encounter([
      { name: 'A', initiative: 30 },
      { name: 'B', initiative: 20 },
      { name: 'C', initiative: 10 },
    ]);
    enc.turnIndex = 2; // on C
    model.removeCombatant(enc, 'A');
    expect(model.currentCombatant(enc).name).toBe('C');
  });
});

// ─── Effects and action economy ──────────────────────────────────────────────

describe('effects', () => {
  it('adding an effect with an existing name replaces it', () => {
    const enc = encounter([{ name: 'Fighter' }]);
    model.addEffect(enc, 'Fighter', { name: 'Frightened', value: 2 });
    const r = model.addEffect(enc, 'Fighter', { name: 'Frightened', value: 1 });
    expect(r.replaced).toBe(true);
    expect(get(enc, 'Fighter').effects).toHaveLength(1);
    expect(get(enc, 'Fighter').effects[0].value).toBe(1);
  });

  it('durations tick down and expire', () => {
    const enc = encounter([{ name: 'Fighter' }]);
    model.addEffect(enc, 'Fighter', { name: 'Haste', duration: 1 });
    const expired = model.tickEffectDurations(get(enc, 'Fighter'));
    expect(expired).toHaveLength(1);
    expect(get(enc, 'Fighter').effects).toHaveLength(0);
  });

  it('an effect with no duration never expires', () => {
    const enc = encounter([{ name: 'Fighter' }]);
    model.addEffect(enc, 'Fighter', { name: 'Blessed' });
    expect(model.tickEffectDurations(get(enc, 'Fighter'))).toHaveLength(0);
    expect(get(enc, 'Fighter').effects).toHaveLength(1);
  });

  it('slowed subtracts actions; quickened adds one', () => {
    const enc = encounter([{ name: 'Fighter' }]);
    model.addEffect(enc, 'Fighter', { name: 'Slowed', value: 1 });
    expect(model.processActionEconomy(get(enc, 'Fighter')).netActions).toBe(2);
    model.addEffect(enc, 'Fighter', { name: 'Quickened' });
    expect(model.processActionEconomy(get(enc, 'Fighter')).netActions).toBe(3);
  });

  it('stunned is consumed by the actions it removes', () => {
    const enc = encounter([{ name: 'Fighter' }]);
    model.addEffect(enc, 'Fighter', { name: 'Stunned', value: 1 });
    const r = model.processActionEconomy(get(enc, 'Fighter'));
    expect(r.netActions).toBe(2);
    expect(get(enc, 'Fighter').effects).toHaveLength(0); // cleared
  });
});

// ─── Restore mapping ─────────────────────────────────────────────────────────

describe('encounterFromRow', () => {
  const row = {
    id: 'uuid-1',
    channel_id: 'chan-1',
    discord_guild_id: 'guild-1',
    gm_discord_id: 'gm-1',
    round: 3,
    turn_index: 5,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    combatants: [{ name: 'Fighter', hp: 12, maxHp: 20 }, { name: 'Goblin', hp: 6, maxHp: 6 }],
  };

  it('hydrates stored combatants into full model objects', () => {
    const enc = model.encounterFromRow(row);
    expect(enc.combatants).toHaveLength(2);
    for (const c of enc.combatants) {
      expect(typeof c.id).toBe('string');
      expect(Array.isArray(c.effects)).toBe(true);
      expect(c.saves).toEqual({ fort: null, ref: null, will: null });
    }
  });

  it('clamps an out-of-range stored turn_index', () => {
    expect(model.encounterFromRow(row).turnIndex).toBe(1); // 5 -> last valid index
  });

  it('carries channel, guild, gm, round, supabaseId and timestamps across', () => {
    const enc = model.encounterFromRow(row);
    expect(enc.channelId).toBe('chan-1');
    expect(enc.guildId).toBe('guild-1');
    expect(enc.gmId).toBe('gm-1');
    expect(enc.round).toBe(3);
    expect(enc.supabaseId).toBe('uuid-1');
    expect(enc.createdAt).toBe(row.created_at);
    expect(enc.updatedAt).toBe(row.updated_at);
  });

  it('tolerates a row with no combatants', () => {
    const enc = model.encounterFromRow({ channel_id: 'c', combatants: null });
    expect(enc.combatants).toEqual([]);
    expect(enc.turnIndex).toBe(0);
  });
});
