// Tests for src/rules/combatAutomation.js — the dying/wounded/recovery engine.
//
// This is the most game-critical code in the bot: what happens when a PC hits
// 0 HP. The encounter store (commands/encounters.js) is purely in-memory when
// Supabase env vars are absent (as in tests), so we drive real encounters
// end-to-end with no database and no mocks except Math.random.
//
// PF2e rules being locked (Player Core p. 410-411):
//   - Drop to 0 HP → Dying 1 (Dying 2 if from a crit), +existing Wounded value
//   - Damaged while dying → dying +1 (+2 crit)
//   - Dying reaches max (4, reduced by Doomed) → dead
//   - Recovery flat check DC = 10 + dying; crit success -2, success -1,
//     failure +1+wounded, crit failure +2+wounded; nat 20/1 are auto crit
//   - Any healing while dying: dying ends, Wounded +1
//   - Hero-point stabilize: dying ends, Wounded unchanged

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { stubRandomSequence, die } from './helpers.js';

const require = createRequire(import.meta.url);
const enc = require('../src/commands/encounters');
const combat = require('../src/rules/combatAutomation');

let channelCounter = 0;
const openChannels = [];

// Fresh encounter per test so no state leaks between tests.
function makeEncounter(combatants) {
  const channelId = `test-channel-${++channelCounter}`;
  openChannels.push(channelId);
  enc.createEncounter(channelId, 'gm-1');
  for (const c of combatants) {
    enc.addCombatant(channelId, {
      initiative: 10, hp: 20, maxHp: 20, ac: 15, ownerId: 'p1',
      isNpc: false, effects: [], ...c,
    });
  }
  return channelId;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (openChannels.length) enc.deleteEncounter(openChannels.pop());
});

describe('computeMapForNextAttack', () => {
  it('escalates 0 / -5 / -10 across a turn (-4/-8 agile)', () => {
    expect(combat.computeMapForNextAttack({ attacksThisTurn: 0 }, false).penalty).toBe(0);
    expect(combat.computeMapForNextAttack({ attacksThisTurn: 1 }, false).penalty).toBe(-5);
    expect(combat.computeMapForNextAttack({ attacksThisTurn: 2 }, false).penalty).toBe(-10);
    expect(combat.computeMapForNextAttack({ attacksThisTurn: 7 }, false).penalty).toBe(-10);
    expect(combat.computeMapForNextAttack({ attacksThisTurn: 1 }, true).penalty).toBe(-4);
    expect(combat.computeMapForNextAttack({ attacksThisTurn: 2 }, true).penalty).toBe(-8);
  });
  it('first attack carries no MAP note; later ones do', () => {
    expect(combat.computeMapForNextAttack({ attacksThisTurn: 0 }, false).noteText).toBeNull();
    expect(combat.computeMapForNextAttack({ attacksThisTurn: 1 }, false).noteText).toContain('MAP -5');
  });
});

describe('applyDamage — dying and wounded transitions', () => {
  it('ordinary damage just reduces HP', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    const r = combat.applyDamage(ch, 'Fighter', 5);
    expect(r.newHp).toBe(15);
    expect(r.wentDown).toBe(false);
    expect(r.dying).toBe(0);
  });
  it('dropping to 0 HP → Dying 1', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    const r = combat.applyDamage(ch, 'Fighter', 20);
    expect(r.newHp).toBe(0);
    expect(r.wentDown).toBe(true);
    expect(r.dying).toBe(1);
  });
  it('dropping to 0 from a CRIT → Dying 2', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    const r = combat.applyDamage(ch, 'Fighter', 25, { isCrit: true });
    expect(r.dying).toBe(2);
  });
  it('existing Wounded adds to the initial dying value', () => {
    const ch = makeEncounter([{ name: 'Fighter', wounded: 1 }]);
    const r = combat.applyDamage(ch, 'Fighter', 20);
    expect(r.dying).toBe(2); // 1 + wounded 1
  });
  it('Wounded 1 + crit knockout → Dying 3', () => {
    const ch = makeEncounter([{ name: 'Fighter', wounded: 1 }]);
    const r = combat.applyDamage(ch, 'Fighter', 20, { isCrit: true });
    expect(r.dying).toBe(3);
  });
  it('damage while already dying → dying +1 (+2 crit)', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 1 }]);
    expect(combat.applyDamage(ch, 'Fighter', 3).dying).toBe(2);
    const ch2 = makeEncounter([{ name: 'Barb', hp: 0, dying: 1 }]);
    expect(combat.applyDamage(ch2, 'Barb', 3, { isCrit: true }).dying).toBe(3);
  });
  it('dying 4 means death, and the combatant is removed from the tracker', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 3 }, { name: 'Ally' }]);
    const r = combat.applyDamage(ch, 'Fighter', 3);
    expect(r.died).toBe(true);
    expect(r.removed).toBe(true);
    expect(enc.getEncounter(ch).combatants.map(c => c.name)).toEqual(['Ally']);
  });
  it('Doomed lowers the death threshold', () => {
    // Doomed 2 → dies at Dying 2. Wounded 1 knockout jumps straight to 2 → dead.
    const ch = makeEncounter([{ name: 'Fighter', wounded: 1, doomed: 2 }]);
    const r = combat.applyDamage(ch, 'Fighter', 20);
    expect(r.died).toBe(true);
  });
  it('overkill damage clamps HP at 0', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    expect(combat.applyDamage(ch, 'Fighter', 999).newHp).toBe(0);
  });
});

describe('applyHealing', () => {
  it('healing a dying combatant wakes them: dying 0, Wounded +1', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 2, wounded: 0 }]);
    const r = combat.applyHealing(ch, 'Fighter', 5);
    expect(r.newHp).toBe(5);
    expect(r.wokeUp).toBe(true);
    expect(r.dying).toBe(0);
    expect(r.wounded).toBe(1);
  });
  it('healing cannot exceed max HP', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 18 }]);
    expect(combat.applyHealing(ch, 'Fighter', 50).newHp).toBe(20);
  });
  it('healing a stabilized-but-unconscious combatant wakes them without adding Wounded', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 0, wounded: 2, unconscious: true }]);
    const r = combat.applyHealing(ch, 'Fighter', 3);
    expect(r.wokeUp).toBe(true);
    expect(r.wounded).toBe(2);
  });
});

describe('applyHpChange', () => {
  it('negative delta damages, positive heals, zero does nothing', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    expect(combat.applyHpChange(ch, 'Fighter', -5).newHp).toBe(15);
    expect(combat.applyHpChange(ch, 'Fighter', +3).newHp).toBe(18);
    expect(combat.applyHpChange(ch, 'Fighter', 0)).toBeNull();
  });
});

describe('rollRecoveryCheck', () => {
  it('flat check DC is 10 + dying (Remaster)', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 2 }]);
    stubRandomSequence([die(12, 20)]); // meets DC 12
    const r = combat.rollRecoveryCheck(ch, 'Fighter');
    expect(r.dc).toBe(12);
    expect(r.outcome).toBe('success');
    expect(r.dyingAfter).toBe(1);
  });
  it('success at dying 1 stabilizes: unconscious at 0 HP, Wounded +1', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 1, wounded: 0 }]);
    stubRandomSequence([die(11, 20)]);
    const r = combat.rollRecoveryCheck(ch, 'Fighter');
    expect(r.awoke).toBe(true);
    expect(r.dyingAfter).toBe(0);
    const c = enc.findCombatant(enc.getEncounter(ch), 'Fighter');
    expect(c.hp).toBe(0);            // stabilizing never restores HP
    expect(c.unconscious).toBe(true);
    expect(c.wounded).toBe(1);
  });
  it('failure adds 1 + the Wounded value', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 1, wounded: 1 }]);
    stubRandomSequence([die(5, 20)]); // fails DC 11
    const r = combat.rollRecoveryCheck(ch, 'Fighter');
    expect(r.baseDelta).toBe(1);
    expect(r.woundedAdded).toBe(1);
    expect(r.dyingAfter).toBe(3); // 1 + 1 base + 1 wounded
  });
  it('a failure that reaches dying 4 kills and removes the combatant', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 2, wounded: 1 }, { name: 'Ally' }]);
    stubRandomSequence([die(5, 20)]); // fail DC 12 → +1+1 → dying 4
    const r = combat.rollRecoveryCheck(ch, 'Fighter');
    expect(r.died).toBe(true);
    expect(enc.getEncounter(ch).combatants.map(c => c.name)).toEqual(['Ally']);
  });
  it('nat 20 is a crit success: dying -2', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 3 }]);
    stubRandomSequence([die(20, 20)]);
    const r = combat.rollRecoveryCheck(ch, 'Fighter');
    expect(r.outcome).toBe('crit-success');
    expect(r.dyingAfter).toBe(1);
  });
  it('nat 1 is a crit failure: dying +2 (+wounded)', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 1, wounded: 0 }]);
    stubRandomSequence([die(1, 20)]);
    const r = combat.rollRecoveryCheck(ch, 'Fighter');
    expect(r.outcome).toBe('crit-failure');
    expect(r.dyingAfter).toBe(3);
  });
  it('returns null for a combatant who is not dying', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    expect(combat.rollRecoveryCheck(ch, 'Fighter')).toBeNull();
  });
});

describe('stabilizeWithHeroPoints', () => {
  it('clears dying, keeps Wounded unchanged, stays unconscious at 0 HP', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 0, dying: 3, wounded: 2 }]);
    const r = combat.stabilizeWithHeroPoints(ch, 'Fighter');
    expect(r.ok).toBe(true);
    const c = enc.findCombatant(enc.getEncounter(ch), 'Fighter');
    expect(c.dying).toBe(0);
    expect(c.wounded).toBe(2);
    expect(c.unconscious).toBe(true);
  });
  it('refuses when the combatant is not dying', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    expect(combat.stabilizeWithHeroPoints(ch, 'Fighter').ok).toBe(false);
  });
});

describe('reactions', () => {
  it('one reaction per round: available, then consumed, then refused', () => {
    const ch = makeEncounter([{ name: 'Fighter' }]);
    const c = enc.findCombatant(enc.getEncounter(ch), 'Fighter');
    expect(combat.hasReactionAvailable(c)).toBe(true);
    expect(combat.consumeReaction(ch, 'Fighter')).toBe(true);
    expect(combat.hasReactionAvailable(c)).toBe(false);
    expect(combat.consumeReaction(ch, 'Fighter')).toBe(false);
  });
  it('dying combatants cannot react', () => {
    expect(combat.hasReactionAvailable({ dying: 1 })).toBe(false);
  });
  it('findPotentialReactors excludes the attacker and spent combatants', () => {
    const ch = makeEncounter([
      { name: 'Attacker' },
      { name: 'Ready' },
      { name: 'Spent', reactionUsed: true },
    ]);
    const names = combat.findPotentialReactors(ch, 'Attacker').map(c => c.name);
    expect(names).toEqual(['Ready']);
  });
});

describe('persistent damage', () => {
  const persistentFire = {
    name: 'Persistent fire', kind: 'persistent-damage',
    dice: '2d6', damageType: 'fire', dc: 15,
  };
  it('rolls damage, applies it, and ends on a successful DC 15 flat check', () => {
    const ch = makeEncounter([{ name: 'Fighter', effects: [{ ...persistentFire }] }]);
    stubRandomSequence([die(4, 6), die(3, 6), die(15, 20)]); // 7 damage, flat check 15
    const [r] = combat.tickPersistentDamage(ch, 'Fighter');
    expect(r.damage).toBe(7);
    expect(r.hpAfter).toBe(13);
    expect(r.ended).toBe(true);
    expect(enc.findCombatant(enc.getEncounter(ch), 'Fighter').effects).toHaveLength(0);
  });
  it('keeps burning when the flat check fails', () => {
    const ch = makeEncounter([{ name: 'Fighter', effects: [{ ...persistentFire }] }]);
    stubRandomSequence([die(1, 6), die(1, 6), die(14, 20)]);
    const [r] = combat.tickPersistentDamage(ch, 'Fighter');
    expect(r.ended).toBe(false);
    expect(enc.findCombatant(enc.getEncounter(ch), 'Fighter').effects).toHaveLength(1);
  });
  it('persistent damage can knock a combatant down', () => {
    const ch = makeEncounter([{ name: 'Fighter', hp: 5, effects: [{ ...persistentFire }] }]);
    stubRandomSequence([die(4, 6), die(3, 6), die(1, 20)]);
    const [r] = combat.tickPersistentDamage(ch, 'Fighter');
    expect(r.wentDown).toBe(true);
    expect(r.dying).toBe(1);
  });
});

describe('processTurnTransition', () => {
  it('ticks the outgoing combatant, resets MAP, and rolls recovery for a dying incomer', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20, attacksThisTurn: 2,
        effects: [{ name: 'Persistent fire', kind: 'persistent-damage', dice: '2d6', damageType: 'fire', dc: 15 }] },
      { name: 'Bob', initiative: 10, hp: 0, dying: 1 },
    ]);
    // Random order: Alice's persistent 2d6, its flat check, Bob's recovery d20.
    stubRandomSequence([die(2, 6), die(2, 6), die(15, 20), die(11, 20)]);
    const r = combat.processTurnTransition(ch);
    expect(r.persistentResults).toHaveLength(1);      // Alice burned as her turn ended
    expect(r.current.name).toBe('Bob');
    expect(r.current.attacksThisTurn).toBe(0);        // MAP resets for the new turn
    expect(r.recoveryCheck).not.toBeNull();           // Bob was dying → auto recovery roll
    expect(r.recoveryCheck.outcome).toBe('success');
    expect(r.newRound).toBe(false);
  });
  it('wrapping to the top of the order starts a new round and refreshes reactions', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20, reactionUsed: true },
      { name: 'Bob', initiative: 10, reactionUsed: true },
    ]);
    const encounter = enc.getEncounter(ch);
    encounter.turnIndex = 1; // Bob's turn — advancing wraps to Alice
    const r = combat.processTurnTransition(ch);
    expect(r.newRound).toBe(true);
    expect(encounter.round).toBe(2);
    expect(encounter.combatants.every(c => c.reactionUsed === false)).toBe(true);
  });
  it('start-of-turn effect durations tick down and expire', () => {
    const ch = makeEncounter([
      { name: 'Alice', initiative: 20 },
      { name: 'Bob', initiative: 10, effects: [{ name: 'Blinded', duration: 1, modifiers: {} }] },
    ]);
    const r = combat.processTurnTransition(ch); // Bob's turn starts, duration 1 → 0
    expect(r.expiredEffects).toHaveLength(1);
    expect(r.expiredEffects[0].effect.name).toBe('Blinded');
  });
});

describe('initiative order (encounters store)', () => {
  it('sorts by initiative, and NPCs win ties (PF2e rule)', () => {
    const ch = makeEncounter([
      { name: 'Slow PC', initiative: 5 },
      { name: 'Goblin', initiative: 15, isNpc: true },
      { name: 'Tied PC', initiative: 15 },
    ]);
    expect(enc.getEncounter(ch).combatants.map(c => c.name))
      .toEqual(['Goblin', 'Tied PC', 'Slow PC']);
  });
});
