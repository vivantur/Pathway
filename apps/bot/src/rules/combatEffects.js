// ── rules/combatEffects.js ──────────────────────────────────────────────────
//
// The net modifier a combatant takes from its active effects.
//
// This used to ADD every modifier together, which gets PF2e's stacking rules
// wrong for every same-typed pair. Frightened 2 and Sickened 2 each impose a −2
// STATUS penalty to AC; only the worst same-typed penalty applies, so the answer
// is −2 and this returned −4. Prone + Off-Guard + Grabbed are all CIRCUMSTANCE
// penalties to AC — that was −6 instead of −2.
//
// The arithmetic now comes from `@pathway/core`'s `stackModifiers`, which was
// built from the rules text and is what the sheet already uses. No stacking rule
// is implemented here: this module only groups the tracker's flat slots into
// typed modifiers and asks core for the total.
//
// BACKWARD COMPATIBLE BY CONSTRUCTION: an effect with no `bonusTypes` is treated
// as untyped, and core stacks untyped modifiers by adding them — exactly the old
// behavior. Every effect already stored in a live encounter keeps the number it
// had; only effects carrying real types get the corrected math.

'use strict';

const { stackModifiers } = require('@pathway/core');
const { typeForSlot } = require('./bonusTypes');

const SLOTS = ['attackBonus', 'damageBonus', 'acBonus', 'saveBonus', 'skillBonus'];

/**
 * Sum up all attack/damage/AC/save/skill modifiers from a combatant's effects,
 * resolving same-typed bonuses and penalties per the stacking rules.
 *
 * `activeEffects` still lists what each effect CONTRIBUTES — a GM should see both
 * penalties even when only the worst lands. Because that means the visible parts
 * may no longer add up to the total, `superseded` flags when stacking discarded
 * something, so a caller can explain the difference instead of it looking like a
 * bug.
 */
function sumEffectModifiers(combatant) {
  const totals = {
    attackBonus: 0,
    damageBonus: 0,
    acBonus: 0,
    saveBonus: 0,
    skillBonus: 0,
    activeEffects: [],
    superseded: false,
  };
  if (!combatant?.effects || combatant.effects.length === 0) return totals;

  const bySlot = { attackBonus: [], damageBonus: [], acBonus: [], saveBonus: [], skillBonus: [] };
  let naiveSum = 0;

  for (const effect of combatant.effects) {
    const m = effect.modifiers || {};
    let contributes = false;

    for (const slot of SLOTS) {
      const value = m[slot] ?? 0;
      if (!value) continue;
      bySlot[slot].push({ type: typeForSlot(effect.bonusTypes, slot), value, entry: totals.activeEffects.length });
      naiveSum += value;
      contributes = true;
    }

    if (contributes) {
      const displayValue = effect.value !== null && effect.value !== undefined ? ` ${effect.value}` : '';
      totals.activeEffects.push({
        name: `${effect.name}${displayValue}`,
        attackBonus: m.attackBonus ?? 0,
        damageBonus: m.damageBonus ?? 0,
        acBonus: m.acBonus ?? 0,
        // Slots where this effect's modifier lost to a better same-typed one, so
        // a renderer can say "superseded" rather than showing a contribution the
        // total does not include.
        supersededSlots: [],
      });
    }
  }

  let stackedSum = 0;
  for (const slot of SLOTS) {
    totals[slot] = stackModifiers(bySlot[slot]);
    stackedSum += totals[slot];
    for (const i of dominatedIn(bySlot[slot])) {
      totals.activeEffects[i].supersededSlots.push(slot);
    }
  }
  totals.superseded = stackedSum !== naiveSum;

  return totals;
}

/**
 * Which entries in one slot's modifier list did NOT reach the total.
 *
 * Mirrors what `stackModifiers` does rather than re-deciding it: untyped
 * modifiers all stack (nothing is dominated), and within each typed group of the
 * same sign only the best bonus / worst penalty survives. Ties go to the first,
 * so exactly one winner is reported per group.
 */
function dominatedIn(mods) {
  const winner = new Map(); // `${type}:${sign}` → index of the surviving modifier
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    if (m.type === 'untyped') continue;
    const key = `${m.type}:${m.value > 0 ? '+' : '-'}`;
    const best = winner.get(key);
    if (best === undefined) { winner.set(key, i); continue; }
    const better = m.value > 0 ? m.value > mods[best].value : m.value < mods[best].value;
    if (better) winner.set(key, i);
  }

  const survivors = new Set(winner.values());
  const out = [];
  for (let i = 0; i < mods.length; i++) {
    if (mods[i].type === 'untyped') continue;
    if (!survivors.has(i)) out.push(mods[i].entry);
  }
  return out;
}

module.exports = {
  sumEffectModifiers,
};
