// Tests for the combat v2 engine — rules/combatV2/{state,rolls}.js.
//
// This mirrors test/combatAutomation.test.js (which locks the LEGACY engine)
// so both engines are pinned before consolidation. Everything runs in memory:
// with no Supabase env vars, every persistence call no-ops.
//
// KNOWN GAP (deliberate): v2's applyHp does NOT implement the "reduced to 0 by
// a critical hit → Dying 2" rule that legacy applyDamage({isCrit}) has. The
// tests below lock v2's CURRENT behavior; when the isCrit port lands, update
// the marked test.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { stubRandomSequence, die } from './helpers.js';

const require = createRequire(import.meta.url);
const state = require('../src/rules/combatV2/state');
const rolls = require('../src/rules/combatV2/rolls');

let channelCounter = 0;
const openChannels = [];

function makeEncounter(combatants) {
  const channelId = `v2-test-${++channelCounter}`;
  openChannels.push(channelId);
  state.createEncounter(channelId, { gmId: 'gm-1' });
  for (const c of combatants) {
    state.addCombatant(channelId, {
      initiative: 10, hp: 20, maxHp: 20, ac: 15, type: 'pc', ...c,
    });
  }
  return channelId;
}

const get = (ch, name) => state.findCombatant(state.getEncounter(ch), name);

afterEach(() => {
  vi.restoreAllMocks();
  while (openChannels.length) state.endEncounter(openChannels.pop());
});

// ─── rolls.js — pure helpers ─────────────────────────────────────────────────

describe('degreeOfSuccess (v2)', () => {
  it('matches the PF2e ±10 bands and nat 20/1 shifts', () => {
    expect(rolls.degreeOfSuccess(25, 10, 15)).toBe('criticalSuccess');
    expect(rolls.degreeOfSuccess(15, 10, 15)).toBe('success');
    expect(rolls.degreeOfSuccess(14, 10, 15)).toBe('failure');
    expect(rolls.degreeOfSuccess(5, 10, 15)).toBe('criticalFailure');
    expect(rolls.degreeOfSuccess(14, 20, 15)).toBe('success');       // nat 20 up
    expect(rolls.degreeOfSuccess(16, 1, 15)).toBe('failure');        // nat 1 down
    expect(rolls.degreeOfSuccess(15, 10, null)).toBeNull();
  });
});

describe('mapPenalty (v2)', () => {
  it('0 / -5 / -10, agile -4 / -8, capped', () => {
    expect(rolls.mapPenalty(0, false)).toBe(0);
    expect(rolls.mapPenalty(1, false)).toBe(-5);
    expect(rolls.mapPenalty(2, false)).toBe(-10);
    expect(rolls.mapPenalty(9, false)).toBe(-10);
    expect(rolls.mapPenalty(1, true)).toBe(-4);
    expect(rolls.mapPenalty(2, true)).toBe(-8);
  });
});

describe('applyDefenses', () => {
  it('resistance subtracts, floored at 0', () => {
    expect(rolls.applyDefenses(7, 'fire', { resistances: { fire: 3 } }).finalDamage).toBe(4);
    expect(rolls.applyDefenses(2, 'fire', { resistances: { fire: 5 } }).finalDamage).toBe(0);
  });
  it('resistance to "all" applies to any type', () => {
    expect(rolls.applyDefenses(7, 'slashing', { resistances: { all: 2 } }).finalDamage).toBe(5);
  });
  it('weakness adds — but only if damage got through', () => {
    expect(rolls.applyDefenses(5, 'fire', { weaknesses: { fire: 3 } }).finalDamage).toBe(8);
    const resisted = rolls.applyDefenses(2, 'fire', { resistances: { fire: 5 }, weaknesses: { fire: 3 } });
    expect(resisted.finalDamage).toBe(0); // reduced to 0 → weakness does not trigger
  });
  it('immunity zeroes damage regardless', () => {
    const r = rolls.applyDefenses(50, 'poison', { immunities: ['Poison'] });
    expect(r.finalDamage).toBe(0);
    expect(r.notes[0]).toMatch(/Immune/);
  });
  it('type matching is case-insensitive', () => {
    expect(rolls.applyDefenses(7, 'Fire', { resistances: { fire: 3 } }).finalDamage).toBe(4);
  });
});

describe('effectTotals', () => {
  it('maps modifier keys onto roll categories and lists active effects', () => {
    const t = rolls.effectTotals({
      effects: [
        { name: 'Frightened 2', modifiers: { attackBonus: -2, acBonus: -2, saveBonus: -2 } },
        { name: 'Heroism', modifiers: { attackBonus: 1, skillBonus: 1 } },
      ],
    });
    expect(t.attack).toBe(-1);
    expect(t.ac).toBe(-2);
    expect(t.save).toBe(-2);
    expect(t.skill).toBe(1);
    expect(t.active.length).toBeGreaterThan(0);
  });
});

describe('rollCheck / rollAttack', () => {
  it('rollCheck totals die + stat + bonus + effect bonus', () => {
    stubRandomSequence([die(10, 20)]);
    const r = rolls.rollCheck({
      actor: { effects: [{ name: 'Bless', modifiers: { skillBonus: 1 } }] },
      stat: 7, bonus: 2, dc: 20, effectKind: 'skill',
    });
    expect(r.total).toBe(20); // 10 + 7 + 2 + 1
    expect(r.degree).toBe('success');
  });
  it('rollAttack applies MAP from attacksThisTurn, detects agile, doubles crit damage, applies defenses', () => {
    const attacker = { attacksThisTurn: 1, effects: [] };
    const target = { ac: 10, effects: [], resistances: { slashing: 2 } };
    // Agile weapon, second attack → -4. Die 20 (nat) + bonus 5 - 4 = 21 vs AC 10 → crit.
    stubRandomSequence([die(20, 20), die(4, 6)]);
    const [r] = rolls.rollAttack({
      attacker, target,
      attack: { name: 'Dagger', bonus: 5, damage: '1d6', damageType: 'slashing', traits: ['Agile'] },
    });
    expect(r.mapPenalty).toBe(-4);
    expect(r.degree).toBe('criticalSuccess');
    expect(r.baseDamage).toBe(4);
    expect(r.finalDamage).toBe(6); // (4 × 2 crit) - 2 resistance
  });
});

// ─── state.js — encounter lifecycle ──────────────────────────────────────────

describe('addCombatant / initiative order', () => {
  it('sorts by initiative, NPC first on ties, delayed last', () => {
    const ch = makeEncounter([
      { name: 'Slow', initiative: 5 },
      { name: 'Lurker', initiative: 12, delayed: true },
      { name: 'Goblin', initiative: 15, type: 'monster', isNpc: true },
      { name: 'Tied', initiative: 15 },
    ]);
    expect(state.getEncounter(ch).combatants.map(c => c.name))
      .toEqual(['Goblin', 'Tied', 'Slow', 'Lurker']);
  });
  it('rejects duplicate names', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    expect(() => state.addCombatant(ch, { name: 'fighter' })).toThrow(/already exists/);
  });
  it('findCombatant matches exact, id, or unique partial', () => {
    const ch = makeEncounter([{ name: 'Goblin Warrior' }, { name: 'Goblin Shaman' }]);
    const encounter = state.getEncounter(ch);
    expect(state.findCombatant(encounter, 'goblin warrior').name).toBe('Goblin Warrior');
    expect(state.findCombatant(encounter, 'shaman').name).toBe('Goblin Shaman');
    expect(state.findCombatant(encounter, 'goblin')).toBeNull(); // ambiguous
  });
});

describe('applyHp — damage, temp HP, dying', () => {
  it('plain damage reduces HP', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    expect(state.applyHp(ch, 'Fighter', -5).combatant.hp).toBe(15);
  });
  it('temp HP absorbs damage first', () => {
    const ch = makeEncounter([{ name: 'Fighter', tempHp: 4 }]);
    const r = state.applyHp(ch, 'Fighter', -6);
    expect(r.combatant.tempHp).toBe(0);
    expect(r.combatant.hp).toBe(18); // only 2 got through
  });
  it('temp HP fully absorbing damage prevents going down', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 1, tempHp: 10 }]);
    const r = state.applyHp(ch, 'Fighter', -8);
    expect(r.combatant.hp).toBe(1);
    expect(r.wentDown).toBe(false);
  });
  it('dropping to 0 → Dying 1 + wounded value, unconscious', () => {
    const ch = makeEncounter([{ name: 'Fighter', wounded: 1 }]);
    const r = state.applyHp(ch, 'Fighter', -20);
    expect(r.wentDown).toBe(true);
    expect(r.dying).toBe(2); // 1 + wounded 1
    expect(r.combatant.unconscious).toBe(true);
  });
  // KNOWN GAP: no isCrit option exists yet — a crit knockout is Dying 1 like
  // any other hit. Legacy applies Dying 2. Update when step 5 ports isCrit.
  it('[gap] applyHp has no crit-dying bump (options object ignores isCrit)', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    const r = state.applyHp(ch, 'Fighter', -20, { isCrit: true });
    expect(r.dying).toBe(1);
  });
  it('damage while at 0 and dying → dying +1', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 1 }]);
    const r = state.applyHp(ch, 'Fighter', -3);
    expect(r.dyingIncreased).toBe(true);
    expect(r.dying).toBe(2);
  });
  it('dying at max (4, less doomed) → dead and removed', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 3 }, { name: 'Ally' }]);
    const r = state.applyHp(ch, 'Fighter', -3);
    expect(r.died).toBe(true);
    expect(state.getEncounter(ch).combatants.map(c => c.name)).toEqual(['Ally']);
  });
  it('doomed lowers the death threshold', () => {
    const ch = makeEncounter([{ name: 'Fighter', wounded: 1, doomed: 2 }]);
    const r = state.applyHp(ch, 'Fighter', -20); // dying 2 ≥ maxDying 2
    expect(r.died).toBe(true);
  });
  it('healing a dying combatant wakes them: dying 0, Wounded +1', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 2, wounded: 0 }]);
    const r = state.applyHp(ch, 'Fighter', 5);
    expect(r.wokeUp).toBe(true);
    expect(r.combatant.dying).toBe(0);
    expect(r.combatant.wounded).toBe(1);
  });
  it('healing caps at maxHp; set mode clamps and can knock down', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 18 }]);
    expect(state.applyHp(ch, 'Fighter', 50).combatant.hp).toBe(20);
    const r = state.applyHp(ch, 'Fighter', 0, { mode: 'set' });
    expect(r.combatant.hp).toBe(0);
    expect(r.wentDown).toBe(true);
  });
});

describe('setTempHp', () => {
  it('keeps the higher of old and new (temp HP does not stack)', () => {
    const ch = makeEncounter([{ name: 'Fighter', tempHp: 6 }]);
    expect(state.setTempHp(ch, 'Fighter', 4).combatant.tempHp).toBe(6);
    expect(state.setTempHp(ch, 'Fighter', 9).combatant.tempHp).toBe(9);
  });
});

describe('rollRecoveryCheck (v2)', () => {
  it('DC is 10 + dying; success reduces dying by 1', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 2 }]);
    stubRandomSequence([die(12, 20)]);
    const r = state.rollRecoveryCheck(ch, 'Fighter');
    expect(r.dc).toBe(12);
    expect(r.outcome).toBe('success');
    expect(r.dyingAfter).toBe(1);
  });
  it('reaching 0 stabilizes: unconscious at 0 HP, Wounded +1', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 1 }]);
    stubRandomSequence([die(11, 20)]);
    const r = state.rollRecoveryCheck(ch, 'Fighter');
    expect(r.awoke).toBe(true);
    expect(get(ch, 'Fighter').unconscious).toBe(true);
    expect(get(ch, 'Fighter').wounded).toBe(1);
  });
  it('failure adds 1 + wounded; death removes the combatant', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 2, wounded: 1 }, { name: 'Ally' }]);
    stubRandomSequence([die(5, 20)]); // fail DC 12 → +1+1 → 4
    const r = state.rollRecoveryCheck(ch, 'Fighter');
    expect(r.died).toBe(true);
    expect(state.getEncounter(ch).combatants.map(c => c.name)).toEqual(['Ally']);
  });
  it('nat 20 crit success (-2), nat 1 crit failure (+2)', () => {
    const ch = makeEncounter([{ name: 'A', hp: 0, dying: 3 }, { name: 'B', hp: 0, dying: 1 }]);
    stubRandomSequence([die(20, 20)]);
    expect(state.rollRecoveryCheck(ch, 'A').dyingAfter).toBe(1);
    stubRandomSequence([die(1, 20)]);
    expect(state.rollRecoveryCheck(ch, 'B').dyingAfter).toBe(3);
  });
  it('returns null when not dying', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    expect(state.rollRecoveryCheck(ch, 'Fighter')).toBeNull();
  });
});

describe('setDying (GM override)', () => {
  it('sets the value and marks the combatant unconscious', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0 }]);
    const r = state.setDying(ch, 'Fighter', 2);
    expect(r.combatant.dying).toBe(2);
    expect(r.combatant.unconscious).toBe(true);
  });
  it('clearing dying grants Wounded +1 and keeps them unconscious at 0 HP (RAW)', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 2, wounded: 1 }]);
    const r = state.setDying(ch, 'Fighter', 0);
    expect(r.recovered).toBe(true);
    expect(r.combatant.dying).toBe(0);
    expect(r.combatant.wounded).toBe(2);
    expect(r.combatant.unconscious).toBe(true); // 0 HP → still out until healed
  });
  it('setting at/above the doomed-lowered max is death and removes them', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, doomed: 2 }, { name: 'Ally' }]);
    const r = state.setDying(ch, 'Fighter', 2); // maxDying = 2
    expect(r.died).toBe(true);
    expect(state.getEncounter(ch).combatants.map(c => c.name)).toEqual(['Ally']);
  });
});

describe('effects', () => {
  it('addEffect replaces an effect with the same name instead of stacking', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    state.addEffect(ch, 'Fighter', { name: 'Frightened', value: 2, modifiers: { attackBonus: -2 } });
    const r = state.addEffect(ch, 'Fighter', { name: 'Frightened', value: 1, modifiers: { attackBonus: -1 } });
    expect(r.replaced).toBe(true);
    expect(get(ch, 'Fighter').effects).toHaveLength(1);
    expect(get(ch, 'Fighter').effects[0].value).toBe(1);
  });
  it('removeEffect removes by name and throws when absent', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    state.addEffect(ch, 'Fighter', { name: 'Blinded' });
    state.removeEffect(ch, 'Fighter', 'blinded');
    expect(get(ch, 'Fighter').effects).toHaveLength(0);
    expect(() => state.removeEffect(ch, 'Fighter', 'blinded')).toThrow(/No effect/);
  });
});

describe('persistent damage (v2) — with defenses', () => {
  const burning = {
    name: 'Persistent fire', modifiers: { kind: 'persistent-damage', dice: '2d6', damageType: 'fire', dc: 15 },
  };
  it('rolls, applies through resistances, and ends on the flat check', () => {
    const ch = makeEncounter([{ name: 'Fighter', resistances: { fire: 3 } }]);
    state.addEffect(ch, 'Fighter', burning);
    stubRandomSequence([die(4, 6), die(3, 6), die(15, 20)]); // 7 dmg → 4 after resistance; flat 15 ends
    const [r] = state.tickPersistentDamage(ch, 'Fighter');
    expect(r.damage).toBe(7);
    expect(r.finalDamage).toBe(4);
    expect(get(ch, 'Fighter').hp).toBe(16);
    expect(r.ended).toBe(true);
    expect(get(ch, 'Fighter').effects).toHaveLength(0);
  });
  it('keeps burning on a failed flat check', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    state.addEffect(ch, 'Fighter', burning);
    stubRandomSequence([die(1, 6), die(1, 6), die(14, 20)]);
    const [r] = state.tickPersistentDamage(ch, 'Fighter');
    expect(r.ended).toBe(false);
    expect(get(ch, 'Fighter').effects).toHaveLength(1);
  });
  it('a bare "persistent-bleed" style effect defaults dice from its value', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    state.addEffect(ch, 'Fighter', { id: 'persistent-bleed', name: 'Persistent bleed', value: 2 });
    stubRandomSequence([die(3, 6), die(2, 6), die(1, 20)]); // 2d6 from value
    const [r] = state.tickPersistentDamage(ch, 'Fighter');
    expect(r.damageDice).toBe('2d6');
    expect(r.damageType).toBe('bleed');
  });
});

describe('action economy from conditions', () => {
  it('slowed reduces actions; quickened adds one (3 - 1 + 1 = 3)', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20 },
      { name: 'Bob', initiative: 10, effects: [
        { id: 'slowed', name: 'Slowed', value: 1, modifiers: {} },
        { id: 'quickened', name: 'Quickened', modifiers: {} },
      ] },
    ]);
    const r = state.processTurnTransition(ch); // Bob's turn begins
    expect(r.actionEconomy.netActions).toBe(3);
    expect(r.actionEconomy.notes).toContain('Slowed 1');
    expect(r.actionEconomy.notes).toContain('Quickened (+1 action)');
  });
  it('stunned consumes actions and clears when spent', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20 },
      { name: 'Bob', initiative: 10, effects: [{ id: 'stunned', name: 'Stunned', value: 2, modifiers: {} }] },
    ]);
    const r = state.processTurnTransition(ch); // Bob's turn begins
    expect(r.actionEconomy.netActions).toBe(1); // 3 - 2 stunned
    expect(get(ch, 'Bob').effects).toHaveLength(0); // stunned fully spent → cleared
  });
});

describe('processTurnTransition (v2)', () => {
  it('ticks outgoing persistent damage, resets turn state, rolls recovery for dying incomer', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20, attacksThisTurn: 2, reactionUsed: true,
        effects: [{ name: 'Persistent fire', modifiers: { kind: 'persistent-damage', dice: '2d6', damageType: 'fire', dc: 15 } }] },
      { name: 'Bob', initiative: 10, hp: 0, dying: 1 },
    ]);
    stubRandomSequence([die(2, 6), die(2, 6), die(15, 20), die(11, 20)]);
    const r = state.processTurnTransition(ch);
    expect(r.persistentResults).toHaveLength(1);
    expect(r.current.name).toBe('Bob');
    expect(r.current.attacksThisTurn).toBe(0);
    expect(r.recoveryCheck.outcome).toBe('success');
    expect(r.newRound).toBe(false);
  });
  it('reactions and MAP refresh at the START of each combatant turn (v2 RAW behavior)', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20 },
      { name: 'Bob', initiative: 10, reactionUsed: true, attacksThisTurn: 3 },
    ]);
    state.processTurnTransition(ch); // Bob's turn starts
    expect(get(ch, 'Bob').reactionUsed).toBe(false);
    expect(get(ch, 'Bob').attacksThisTurn).toBe(0);
  });
  it('wrapping the order increments the round', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20 },
      { name: 'Bob', initiative: 10 },
    ]);
    state.processTurnTransition(ch); // → Bob
    const r = state.processTurnTransition(ch); // → wraps to Alice
    expect(r.newRound).toBe(true);
    expect(state.getEncounter(ch).round).toBe(2);
  });
  it('skips delayed combatants', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20 },
      { name: 'Middle', initiative: 15, delayed: true },
      { name: 'Bob', initiative: 10 },
    ]);
    const r = state.processTurnTransition(ch);
    expect(r.current.name).toBe('Bob');
  });
  it('effect durations tick at the start of the affected turn and expire', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20 },
      { name: 'Bob', initiative: 10, effects: [{ name: 'Blinded', duration: 1, modifiers: {} }] },
    ]);
    const r = state.processTurnTransition(ch);
    expect(r.expiredEffects).toHaveLength(1);
    expect(r.expiredEffects[0].effect.name).toBe('Blinded');
  });
});

describe('delay and rejoin', () => {
  it('delayed combatants sort last and can rejoin before a target', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20 },
      { name: 'Bob', initiative: 15 },
      { name: 'Cara', initiative: 10 },
    ]);
    state.delayCombatant(ch, 'Bob');
    expect(state.getEncounter(ch).combatants.map(c => c.name)).toEqual(['Alice', 'Cara', 'Bob']);
    state.rejoinCombatant(ch, 'Bob', 'Cara');
    const order = state.getEncounter(ch).combatants.map(c => c.name);
    expect(order.indexOf('Bob')).toBeLessThan(order.indexOf('Cara'));
    expect(get(ch, 'Bob').delayed).toBe(false);
  });
});
