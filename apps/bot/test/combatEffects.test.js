// Tests for typed modifier stacking on a combatant — rules/bonusTypes.js and
// rules/combatEffects.js.
//
// The bug these lock: the tracker added every modifier together, so two −2 STATUS
// penalties to AC came out as −4 when the rules say only the worst same-typed
// penalty applies. Frightened + Sickened is an ordinary pairing, and Prone
// already implies Off-Guard, so this was wrong in common play, not in a corner.
//
// The stacking arithmetic itself is core's (`stackModifiers`, built from rules
// text and tested there). What is tested here is the ADAPTATION: that each slot
// gets the right TYPE, that types come from core rather than from the bot's own
// preset descriptions, and that effects predating types keep their old behavior.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getPreset } = require('../src/rules/effects');
const { sumEffectModifiers } = require('../src/rules/combatEffects');
const { slotBonusTypes, typeForSlot } = require('../src/rules/bonusTypes');
const model = require('../src/rules/combatV2/model');
const { translateEffect } = require('../src/rules/effectTranslation');

/** An effect exactly as /init addeffect builds one from a preset. */
function preset(name, value) {
  const p = getPreset(name);
  return {
    name: p.name,
    value: p.scaling ? (value ?? 1) : null,
    modifiers: p.build(value ?? 1),
    bonusTypes: p.bonusTypes,
  };
}

const ac = (...effects) => sumEffectModifiers({ effects }).acBonus;

describe('bonus types are derived from core, not from the bot', () => {
  it('types the status conditions as status', () => {
    expect(slotBonusTypes('frightened')).toMatchObject({
      acBonus: 'status', saveBonus: 'status', skillBonus: 'status', attackBonus: 'status',
    });
    expect(slotBonusTypes('sickened').acBonus).toBe('status');
  });

  it('types the circumstance conditions as circumstance', () => {
    expect(slotBonusTypes('off-guard').acBonus).toBe('circumstance');
    expect(slotBonusTypes('grabbed').acBonus).toBe('circumstance');
    expect(slotBonusTypes('restrained').acBonus).toBe('circumstance');
    expect(slotBonusTypes('prone')).toMatchObject({ acBonus: 'circumstance', attackBonus: 'circumstance' });
  });

  it('disagrees with the preset\'s own description, and core wins', () => {
    // effects.js says prone is "-2 status penalty to attack rolls". That string
    // was written from memory; core has prone as circumstance. The whole reason
    // types are derived rather than hand-written is to not inherit that.
    expect(getPreset('prone').bonusTypes.attackBonus).toBe('circumstance');
  });

  it('declines to type a slot core models no modifier for', () => {
    // Core's Enfeebled penalizes athletics (Strength-based attacks are not yet
    // expressible); the tracker's blanket attack penalty is an approximation core
    // does not make, so typing it would assert something core never said.
    expect(slotBonusTypes('enfeebled').attackBonus).toBeUndefined();
    expect(slotBonusTypes('enfeebled').damageBonus).toBeUndefined();
    expect(slotBonusTypes('stupefied').attackBonus).toBeUndefined();
  });

  it('declines to type a slot core is ambiguous about', () => {
    // Unconscious contributes BOTH a status and a circumstance penalty to AC.
    // One flat slot cannot hold two types, so it stays untyped.
    expect(slotBonusTypes('unconscious').acBonus).toBeUndefined();
    expect(slotBonusTypes('unconscious').saveBonus).toBe('status');
  });

  it('uses the owner-supplied table for spells core has no condition for', () => {
    // Bless and Heroism are spells, not conditions, so nothing is derivable.
    // These types were supplied by the owner (2026-07-18), not written from memory.
    expect(slotBonusTypes('bless')).toEqual({ attackBonus: 'status' });
    expect(slotBonusTypes('heroism')).toEqual({
      attackBonus: 'status', saveBonus: 'status', skillBonus: 'status',
    });
  });

  it('returns nothing for anything neither derivable nor supplied', () => {
    expect(slotBonusTypes('persistent-fire')).toEqual({});
    expect(slotBonusTypes('not-a-condition')).toEqual({});
    expect(slotBonusTypes(undefined)).toEqual({});
  });

  it('stops Bless and Heroism doubling, now that both are typed', () => {
    // Both grant a STATUS bonus to attack, so only the better one applies.
    const t = sumEffectModifiers({ effects: [preset('bless'), preset('heroism', 2)] });
    expect(t.attackBonus).toBe(2);
    expect(t.superseded).toBe(true);
  });

  it('defaults an absent type to untyped', () => {
    expect(typeForSlot(undefined, 'acBonus')).toBe('untyped');
    expect(typeForSlot({}, 'acBonus')).toBe('untyped');
    expect(typeForSlot({ acBonus: 'status' }, 'acBonus')).toBe('status');
  });
});

describe('same-typed penalties: only the worst applies', () => {
  it('does not double two status penalties', () => {
    expect(ac(preset('frightened', 2), preset('sickened', 2))).toBe(-2);
  });

  it('does not double two circumstance penalties', () => {
    expect(ac(preset('prone'), preset('off-guard'))).toBe(-2);
  });

  it('takes the worst across three circumstance penalties', () => {
    expect(ac(preset('off-guard'), preset('grabbed'), preset('restrained'))).toBe(-2);
  });

  it('takes the worse of two different values of the same type', () => {
    expect(ac(preset('frightened', 1), preset('frightened', 3))).toBe(-3);
    expect(ac(preset('frightened', 3), preset('sickened', 1))).toBe(-3);
  });

  it('applies to every slot, not just AC', () => {
    const t = sumEffectModifiers({ effects: [preset('frightened', 2), preset('sickened', 2)] });
    expect(t).toMatchObject({ attackBonus: -2, acBonus: -2, saveBonus: -2, skillBonus: -2 });
  });
});

describe('different types still add', () => {
  it('adds a status penalty and a circumstance penalty', () => {
    expect(ac(preset('frightened', 2), preset('prone'))).toBe(-4);
    expect(ac(preset('off-guard'), preset('clumsy', 2))).toBe(-4);
  });
});

describe('effects that predate types are unchanged', () => {
  it('adds untyped modifiers, exactly as the tracker always did', () => {
    // Every effect already stored in a live encounter has no bonusTypes. The
    // fix must not silently change numbers a GM is mid-fight with.
    expect(ac(
      { name: 'Custom A', modifiers: { acBonus: -2 } },
      { name: 'Custom B', modifiers: { acBonus: -2 } },
    )).toBe(-4);
  });

  it('adds an untyped one alongside a typed one', () => {
    expect(ac(preset('frightened', 2), { name: 'Custom', modifiers: { acBonus: -2 } })).toBe(-4);
  });

  it('handles a combatant with no effects at all', () => {
    expect(sumEffectModifiers({ effects: [] }).acBonus).toBe(0);
    expect(sumEffectModifiers({}).acBonus).toBe(0);
    expect(sumEffectModifiers(undefined).acBonus).toBe(0);
  });
});

describe('bonuses stack by the same rule', () => {
  it('keeps only the best same-typed bonus', () => {
    expect(ac(
      { name: 'A', modifiers: { acBonus: 2 }, bonusTypes: { acBonus: 'status' } },
      { name: 'B', modifiers: { acBonus: 1 }, bonusTypes: { acBonus: 'status' } },
    )).toBe(2);
  });

  it('lets a same-typed bonus and penalty coexist rather than cancelling by type', () => {
    expect(ac(
      { name: 'Up', modifiers: { acBonus: 2 }, bonusTypes: { acBonus: 'status' } },
      { name: 'Down', modifiers: { acBonus: -3 }, bonusTypes: { acBonus: 'status' } },
    )).toBe(-1);
  });
});

describe('reporting', () => {
  it('still lists what each effect contributes, even when one is superseded', () => {
    // A GM should see both penalties; hiding the discarded one would make the
    // total unexplainable.
    const t = sumEffectModifiers({ effects: [preset('frightened', 2), preset('sickened', 2)] });
    expect(t.activeEffects.map(e => e.name)).toEqual(['Frightened 2', 'Sickened 2']);
    expect(t.activeEffects.every(e => e.acBonus === -2)).toBe(true);
  });

  it('flags when stacking discarded something, so the total is explainable', () => {
    expect(sumEffectModifiers({ effects: [preset('frightened', 2), preset('sickened', 2)] }).superseded).toBe(true);
    expect(sumEffectModifiers({ effects: [preset('frightened', 2), preset('prone')] }).superseded).toBe(false);
    expect(sumEffectModifiers({ effects: [preset('frightened', 2)] }).superseded).toBe(false);
  });

  it('omits an effect that contributes no numbers', () => {
    const t = sumEffectModifiers({ effects: [preset('dying', 2)] });
    expect(t.activeEffects).toEqual([]);
  });

  it('names which effect lost, so a renderer can strike it through', () => {
    const t = sumEffectModifiers({ effects: [preset('frightened', 3), preset('sickened', 1)] });
    const [frightened, sickened] = t.activeEffects;
    expect(frightened.supersededSlots).toEqual([]);       // -3 is the worst, it applies
    expect(sickened.supersededSlots).toContain('acBonus'); // -1 loses to it
  });

  it('marks the later one on a tie, keeping exactly one winner', () => {
    const t = sumEffectModifiers({ effects: [preset('frightened', 2), preset('sickened', 2)] });
    expect(t.activeEffects[0].supersededSlots).toEqual([]);
    expect(t.activeEffects[1].supersededSlots).toContain('acBonus');
  });

  it('supersedes nothing when the types differ', () => {
    const t = sumEffectModifiers({ effects: [preset('frightened', 2), preset('prone')] });
    expect(t.activeEffects.every(e => e.supersededSlots.length === 0)).toBe(true);
  });

  it('supersedes nothing among untyped effects, which all stack', () => {
    const t = sumEffectModifiers({ effects: [
      { name: 'A', modifiers: { acBonus: -2 } },
      { name: 'B', modifiers: { acBonus: -2 } },
    ] });
    expect(t.activeEffects.every(e => e.supersededSlots.length === 0)).toBe(true);
  });

  it('marks per slot, not per effect', () => {
    // Frightened loses on AC to a worse status penalty, but is alone on attack.
    const t = sumEffectModifiers({ effects: [
      preset('frightened', 1),
      { name: 'Worse', modifiers: { acBonus: -3 }, bonusTypes: { acBonus: 'status' } },
    ] });
    expect(t.activeEffects[0].supersededSlots).toEqual(['acBonus']);
  });
});

describe('types survive the round trip into an encounter', () => {
  it('addEffect preserves bonusTypes', () => {
    const enc = { combatants: [{ name: 'Goblin', effects: [] }] };
    model.addEffect(enc, 'Goblin', preset('off-guard'));
    expect(enc.combatants[0].effects[0].bonusTypes.acBonus).toBe('circumstance');
  });

  it('defaults to an empty map for an effect added without types', () => {
    const enc = { combatants: [{ name: 'Goblin', effects: [] }] };
    model.addEffect(enc, 'Goblin', { name: 'Custom', modifiers: { acBonus: -1 } });
    expect(enc.combatants[0].effects[0].bonusTypes).toEqual({});
  });

  it('a stacked pair added through the encounter resolves correctly', () => {
    const enc = { combatants: [{ name: 'Goblin', effects: [] }] };
    model.addEffect(enc, 'Goblin', preset('off-guard'));
    model.addEffect(enc, 'Goblin', preset('grabbed'));
    expect(sumEffectModifiers(enc.combatants[0]).acBonus).toBe(-2);
  });
});

describe('automation-applied effects carry their types too', () => {
  it('translates a core bonus type onto the slot', () => {
    const { effect } = translateEffect({
      name: 'Rattled',
      duration: { kind: 'rounds', count: 2 },
      passives: [{ kind: 'modifier', target: 'ac', bonusType: 'circumstance', value: { kind: 'lit', value: -1 } }],
    });
    expect(effect.bonusTypes.acBonus).toBe('circumstance');
  });

  it('falls back to untyped when two modifiers on one slot disagree', () => {
    const { effect } = translateEffect({
      name: 'Mixed',
      duration: { kind: 'rounds', count: 1 },
      passives: [
        { kind: 'modifier', target: 'ac', bonusType: 'status', value: { kind: 'lit', value: -1 } },
        { kind: 'modifier', target: 'ac', bonusType: 'circumstance', value: { kind: 'lit', value: -1 } },
      ],
    });
    expect(effect.modifiers.acBonus).toBe(-2);
    expect(effect.bonusTypes.acBonus).toBe('untyped');
  });

  it('does not double an automation effect against a same-typed condition', () => {
    // The end of the chain: core says circumstance, the translation keeps it, the
    // tracker stacks it against Off-Guard instead of adding.
    const { effect } = translateEffect({
      name: 'Rattled',
      duration: { kind: 'rounds', count: 2 },
      passives: [{ kind: 'modifier', target: 'ac', bonusType: 'circumstance', value: { kind: 'lit', value: -2 } }],
    });
    expect(ac(preset('off-guard'), effect)).toBe(-2);
  });
});
