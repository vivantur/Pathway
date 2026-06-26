// utils/dice.js
// Pure dice-rolling helpers. No state; every call is independent.
// The advanced expression parser (with reroll/keep/drop mechanics) lives in
// index.js as rollAdvanced(); this file has the common simple cases that
// most commands actually need.

'use strict';

const { rollAdvanced } = require('../rules/advancedRoll');

// Roll 1d20 plus a modifier. Returns { total, roll, mod } so callers can
// display the raw die result as well as the modified total.
function rollD20Plus(modifier) {
  const roll = Math.floor(Math.random() * 20) + 1;
  return { total: roll + modifier, roll, mod: modifier };
}

// Roll a simple damage expression like "2d6+3", "1d4", "3d8-1". Tolerant of
// whitespace and case. Returns null for invalid input so the caller can decide
// how to warn the user. Returns:
//   { rolls, bonus, numDice, numSides, sum, total, display }
// where `display` is formatted like "2d6[4, 3]+3".
function rollDamageExpression(expr) {
  if (!expr) return null;
  const cleaned = expr.toLowerCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!match) {
    const advanced = rollAdvanced(expr, {}, null);
    const first = advanced.iterations?.[0];
    if (advanced.error || !first) return null;
    return {
      rolls: [],
      bonus: 0,
      numDice: null,
      numSides: null,
      sum: first.total,
      total: first.total,
      display: first.breakdown,
    };
  }
  const numDice = parseInt(match[1]) || 1;
  const numSides = parseInt(match[2]);
  const bonus = match[3] ? parseInt(match[3]) : 0;
  if (numDice < 1 || numDice > 100 || numSides < 1 || numSides > 10000) return null;
  const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * numSides) + 1);
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + bonus;
  const bonusText = bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : '';
  const display = `${numDice}d${numSides}[${rolls.join(', ')}]${bonusText}`;
  return { rolls, bonus, numDice, numSides, sum, total, display };
}

// PF2e degree-of-success resolution.
//   attackTotal: the rolled d20 + modifiers
//   dieRoll:     the raw d20 value (needed for nat 20 / nat 1 shifts)
//   targetAc:    the defender's AC (or save DC for save-based checks)
// Returns one of: 'crit-success', 'success', 'failure', 'crit-failure',
// or null if targetAc is unknown.
//
// Rules:
//   - Beat DC by 10+  → crit success
//   - Meet or beat DC → success
//   - Miss DC by 10+  → crit failure
//   - Otherwise       → failure
//   - Nat 20 shifts the result UP one step (failure → success, etc.)
//   - Nat 1  shifts the result DOWN one step
function determineDegreeOfSuccess(attackTotal, dieRoll, targetAc) {
  if (targetAc === null || targetAc === undefined) return null;
  let degree;
  if (attackTotal >= targetAc + 10) degree = 'crit-success';
  else if (attackTotal >= targetAc) degree = 'success';
  else if (attackTotal <= targetAc - 10) degree = 'crit-failure';
  else degree = 'failure';
  if (dieRoll === 20) {
    degree = degree === 'crit-failure' ? 'failure' : degree === 'failure' ? 'success' : 'crit-success';
  } else if (dieRoll === 1) {
    degree = degree === 'crit-success' ? 'success' : degree === 'success' ? 'failure' : 'crit-failure';
  }
  return degree;
}

// PF2e Multiple Attack Penalty. First strike = 0, second = -5 (or -4 agile),
// third+ = -10 (or -8 agile). Anything past the third strike caps at the
// third-attack penalty.
function calculateMap(mapLevel, agile) {
  if (!mapLevel || mapLevel <= 0) return 0;
  if (mapLevel === 1) return agile ? -4 : -5;
  return agile ? -8 : -10;
}

// Basic save damage: crit success = 0, success = half, failure = full, crit failure = double.
function basicSaveDamage(fullDamage, degree) {
  if (degree === 'crit-success') return 0;
  if (degree === 'success')      return Math.floor(fullDamage / 2);
  if (degree === 'failure')      return fullDamage;
  if (degree === 'crit-failure') return fullDamage * 2;
  return fullDamage;
}

module.exports = {
  rollD20Plus,
  rollDamageExpression,
  determineDegreeOfSuccess,
  calculateMap,
  basicSaveDamage,
};
