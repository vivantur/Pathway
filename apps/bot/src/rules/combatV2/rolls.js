// systems/combatV2/rolls.js
// Shared PF2e roll helpers for combat v2.

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function fmt(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

function degreeOfSuccess(total, die, dc) {
  if (dc == null) return null;
  let degree = total >= dc + 10 ? 'criticalSuccess'
    : total >= dc ? 'success'
    : total <= dc - 10 ? 'criticalFailure'
    : 'failure';
  if (die === 20) {
    if (degree === 'criticalFailure') degree = 'failure';
    else if (degree === 'failure') degree = 'success';
    else if (degree === 'success') degree = 'criticalSuccess';
  }
  if (die === 1) {
    if (degree === 'criticalSuccess') degree = 'success';
    else if (degree === 'success') degree = 'failure';
    else if (degree === 'failure') degree = 'criticalFailure';
  }
  return degree;
}

function degreeLabel(degree) {
  return {
    criticalSuccess: 'Critical Success',
    success: 'Success',
    failure: 'Failure',
    criticalFailure: 'Critical Failure',
  }[degree] ?? 'Result';
}

function parseDiceExpression(expr) {
  const match = String(expr ?? '').trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!match) return null;
  return {
    count: parseInt(match[1] || '1', 10),
    sides: parseInt(match[2], 10),
    bonus: match[3] ? parseInt(match[3], 10) : 0,
  };
}

function rollDamage(expr) {
  const parsed = parseDiceExpression(expr);
  if (!parsed) return null;
  const rolls = Array.from({ length: parsed.count }, () => rollDie(parsed.sides));
  const diceTotal = rolls.reduce((sum, n) => sum + n, 0);
  const total = diceTotal + parsed.bonus;
  return {
    ...parsed,
    rolls,
    total,
    display: `${parsed.count}d${parsed.sides}[${rolls.join(', ')}]${parsed.bonus ? ` ${fmt(parsed.bonus)}` : ''}`,
  };
}

function mapPenalty(attacksThisTurn = 0, agile = false) {
  if (attacksThisTurn <= 0) return 0;
  if (attacksThisTurn === 1) return agile ? -4 : -5;
  return agile ? -8 : -10;
}

function effectTotals(combatant) {
  const totals = { attack: 0, damage: 0, ac: 0, save: 0, skill: 0, dc: 0, active: [] };
  for (const effect of combatant?.effects ?? []) {
    const modifiers = effect.modifiers ?? {};
    for (const [from, to] of [
      ['attackBonus', 'attack'],
      ['damageBonus', 'damage'],
      ['acBonus', 'ac'],
      ['saveBonus', 'save'],
      ['skillBonus', 'skill'],
      ['dcBonus', 'dc'],
    ]) {
      const value = Number(modifiers[from] ?? 0);
      if (value) {
        totals[to] += value;
        totals.active.push({ name: effect.name, kind: to, value });
      }
    }
  }
  return totals;
}

function applyDefenses(damage, damageType, defender) {
  const type = String(damageType ?? '').toLowerCase();
  if (defender?.immunities?.some(i => String(i).toLowerCase() === type)) {
    return { finalDamage: 0, notes: [`Immune to ${type}`] };
  }
  let finalDamage = damage;
  const notes = [];
  const resistance = Number(defender?.resistances?.[type] ?? defender?.resistances?.all ?? 0);
  if (resistance) {
    finalDamage = Math.max(0, finalDamage - resistance);
    notes.push(`Resistance ${resistance}`);
  }
  const weakness = Number(defender?.weaknesses?.[type] ?? 0);
  if (weakness && finalDamage > 0) {
    finalDamage += weakness;
    notes.push(`Weakness ${weakness}`);
  }
  return { finalDamage, notes };
}

function rollCheck({ actor, stat = 0, dc = null, bonus = 0, label = 'Check', effectKind = 'skill' }) {
  const effects = effectTotals(actor);
  const die = rollDie(20);
  const effectBonus = effects[effectKind] ?? 0;
  const total = die + stat + bonus + effectBonus;
  return {
    kind: 'check',
    label,
    die,
    stat,
    bonus,
    effectBonus,
    total,
    dc,
    degree: degreeOfSuccess(total, die, dc),
    effects,
  };
}

function rollAttack({ attacker, target = null, attack, bonus = 0, map = null, count = 1 }) {
  const results = [];
  const agile = (attack.traits ?? []).some(t => String(t).toLowerCase() === 'agile');
  const attackerEffects = effectTotals(attacker);
  const targetEffects = effectTotals(target);
  const attacksSoFar = map == null ? (attacker?.attacksThisTurn ?? 0) : map;
  for (let i = 0; i < count; i += 1) {
    const penalty = mapPenalty(attacksSoFar + i, agile);
    const die = rollDie(20);
    const attackBonus = Number(attack.bonus ?? attack.to_hit ?? 0);
    const total = die + attackBonus + bonus + penalty + attackerEffects.attack;
    const ac = target?.ac != null ? target.ac + targetEffects.ac : null;
    const degree = degreeOfSuccess(total, die, ac);
    const damageRoll = rollDamage(attack.damage);
    const baseDamage = damageRoll ? Math.max(1, damageRoll.total + attackerEffects.damage) : 0;
    const critDamage = degree === 'criticalSuccess' ? baseDamage * 2 : baseDamage;
    const defended = target ? applyDefenses(critDamage, attack.damageType, target) : { finalDamage: critDamage, notes: [] };
    results.push({
      kind: 'attack',
      attack,
      die,
      attackBonus,
      bonus,
      mapPenalty: penalty,
      effectBonus: attackerEffects.attack,
      total,
      target,
      ac,
      degree,
      damageRoll,
      baseDamage,
      finalDamage: defended.finalDamage,
      defenseNotes: defended.notes,
      attackerEffects,
      targetEffects,
    });
  }
  return results;
}

module.exports = {
  fmt,
  rollDie,
  rollDamage,
  rollCheck,
  rollAttack,
  degreeOfSuccess,
  degreeLabel,
  mapPenalty,
  effectTotals,
  applyDefenses,
};
