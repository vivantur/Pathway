// combatAutomation.js
// Combat automation layer. Sits between encounters.js (pure state) and index.js
// (Discord-facing handlers). Knows about PF2e rules but not about Discord messages.
//
// Responsibilities:
//   - Dying/Wounded transitions on HP changes (PF2e CRB p. 459)
//   - Recovery checks at start of turn for dying combatants
//   - Multi-Attack Penalty (MAP) tracking per turn
//   - Persistent damage rolls at end of turn, with DC 15 flat check
//   - Reaction availability tracking (1 per round, reset on turn advance)
//
// All functions are pure where possible. State mutations go through encounters.js.
// This module returns structured data for the caller (index.js) to render as
// Discord embeds/messages. It never calls Discord APIs directly.

const enc = require('./encounters');

// ─── MAP (Multi-Attack Penalty) ──────────────────────────────────────────────

// Given a combatant and the agile flag of the weapon they're using, compute
// what MAP penalty should apply to their *next* attack this turn.
// Returns { mapLevel: 0|1|2, penalty: 0|-4|-5|-8|-10, noteText: string|null }.
function computeMapForNextAttack(combatant, agile) {
  const attacksSoFar = combatant?.attacksThisTurn ?? 0;
  let mapLevel;
  if (attacksSoFar === 0) mapLevel = 0;
  else if (attacksSoFar === 1) mapLevel = 1;
  else mapLevel = 2;

  const penalty = mapLevel === 0 ? 0
    : mapLevel === 1 ? (agile ? -4 : -5)
    : (agile ? -8 : -10);

  let noteText = null;
  if (mapLevel === 1) noteText = `Attack #2 this turn · MAP ${penalty}${agile ? ' (agile)' : ''}`;
  else if (mapLevel === 2) noteText = `Attack #3+ this turn · MAP ${penalty}${agile ? ' (agile)' : ''}`;

  return { mapLevel, penalty, noteText };
}

// Record that a combatant has taken an attack this turn. Call this AFTER the attack
// resolves. Only counts if this combatant is the current combatant in initiative
// (off-turn attacks like reactions don't consume MAP slots).
function recordAttack(channelId, combatantName) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return;
  const c = enc.findCombatant(encounter, combatantName);
  if (!c) return;
  // Only count attacks made on the combatant's own turn
  const current = encounter.combatants[encounter.turnIndex];
  if (!current || current.name.toLowerCase() !== combatantName.toLowerCase()) return;
  c.attacksThisTurn = (c.attacksThisTurn ?? 0) + 1;
}

// ─── Dying / Wounded ─────────────────────────────────────────────────────────

// Core damage application wrapper. Call this INSTEAD of enc.modifyHp for damage.
// Handles dying/wounded state transitions per PF2e rules.
// Returns an object describing what happened:
//   {
//     newHp: number, maxHp: number,
//     wentDown: boolean,        // transitioned from alive → 0 HP this call
//     wokeUp: boolean,          // was dying, now above 0 HP
//     died: boolean,            // dying reached 4 (dead) or equivalent
//     dying: number,            // current dying value (0 if not dying)
//     wounded: number,          // current wounded value
//     displaySuffix: string,    // short text to append to damage line
//   }
function applyDamage(channelId, combatantName, damage) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return null;
  const c = enc.findCombatant(encounter, combatantName);
  if (!c) return null;

  const hpBefore = c.hp;
  const wasAlive = hpBefore > 0;
  const newHp = Math.max(0, Math.min(c.maxHp, hpBefore - damage));
  c.hp = newHp;

  // Ensure dying/wounded fields exist (legacy combatants may lack them)
  if (typeof c.dying !== 'number') c.dying = 0;
  if (typeof c.wounded !== 'number') c.wounded = 0;

  let wentDown = false;
  let died = false;

  // Check for 0-HP transition while alive → apply dying
  if (wasAlive && newHp === 0 && damage > 0) {
    wentDown = true;
    // Dying starts at 1 + wounded value (PF2e rule: being wounded makes dying worse)
    const startingDying = 1 + (c.wounded ?? 0);
    c.dying = startingDying;
    console.log(`[applyDamage] ${combatantName} went down: hp ${hpBefore} → 0, dying set to ${c.dying} (wounded was ${c.wounded ?? 0})`);
    if (c.dying >= 4) {
      died = true;
    }
  }

  const suffix = buildDamageSuffix({ wentDown, died, dying: c.dying, newHp });
  return {
    newHp,
    maxHp: c.maxHp,
    wentDown,
    wokeUp: false,
    died,
    dying: c.dying,
    wounded: c.wounded,
    displaySuffix: suffix,
  };
}

// Healing wrapper. Call INSTEAD of enc.modifyHp for healing.
// Handles waking up from dying per PF2e rules: any HP restoration removes the
// dying condition and increments wounded by 1.
function applyHealing(channelId, combatantName, amount) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return null;
  const c = enc.findCombatant(encounter, combatantName);
  if (!c) return null;

  const hpBefore = c.hp;
  const wasDying = (c.dying ?? 0) > 0;
  const newHp = Math.max(0, Math.min(c.maxHp, hpBefore + amount));
  c.hp = newHp;

  if (typeof c.dying !== 'number') c.dying = 0;
  if (typeof c.wounded !== 'number') c.wounded = 0;

  let wokeUp = false;
  if (wasDying && newHp > 0) {
    wokeUp = true;
    c.dying = 0;
    c.wounded = (c.wounded ?? 0) + 1;
  }

  let suffix = '';
  if (wokeUp) {
    suffix = `\n✨ **Recovered from dying!** (now Wounded ${c.wounded})`;
  }

  return {
    newHp,
    maxHp: c.maxHp,
    wokeUp,
    wentDown: false,
    died: false,
    dying: c.dying,
    wounded: c.wounded,
    displaySuffix: suffix,
  };
}

// For use when /init hp is called with a positive or negative delta.
// Dispatches to applyDamage or applyHealing. Returns same shape.
function applyHpChange(channelId, combatantName, delta) {
  if (delta < 0) return applyDamage(channelId, combatantName, -delta);
  if (delta > 0) return applyHealing(channelId, combatantName, delta);
  return null;
}

function buildDamageSuffix({ wentDown, died, dying, newHp }) {
  if (died) return `\n☠️ **Dead!** (Dying ${dying})`;
  if (wentDown && dying > 0) return `\n💀 **Down!** (Dying ${dying})`;
  if (newHp === 0 && dying > 0) return ` 💀 (Dying ${dying})`;
  return '';
}

// Roll the recovery flat check for a dying combatant.
// PF2e rule: flat check DC (11 + dying value).
//   Crit success: dying -2
//   Success: dying -1
//   Failure: dying +1
//   Crit failure: dying +2
// Returns { roll, dc, outcome, dyingBefore, dyingAfter, died, awoke, narration }.
function rollRecoveryCheck(channelId, combatantName) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return null;
  const c = enc.findCombatant(encounter, combatantName);
  if (!c || (c.dying ?? 0) <= 0) return null;

  const dyingBefore = c.dying;
  const dc = 11 + dyingBefore;
  const roll = Math.floor(Math.random() * 20) + 1;

  let outcome, delta;
  if (roll === 20)                    { outcome = 'crit-success'; delta = -2; }
  else if (roll === 1)                { outcome = 'crit-failure'; delta = +2; }
  else if (roll >= dc + 10)           { outcome = 'crit-success'; delta = -2; }
  else if (roll >= dc)                { outcome = 'success';      delta = -1; }
  else if (roll <= dc - 10)           { outcome = 'crit-failure'; delta = +2; }
  else                                { outcome = 'failure';      delta = +1; }

  const dyingAfterRaw = dyingBefore + delta;
  let died = false;
  let awoke = false;
  let dyingAfter = dyingAfterRaw;

  if (dyingAfter >= 4) {
    died = true;
    dyingAfter = 4;
    c.dying = 4;
    // Dead means HP stays 0 and dying is locked; let the GM decide to remove
  } else if (dyingAfter <= 0) {
    // Crit success on 1-dying takes you out of dying entirely and you regain
    // consciousness at 1 HP (PF2e RAW: the check cap doesn't regain HP, but
    // the crit-success result *does* — it's the "you stabilize and recover"
    // end of the spectrum).
    awoke = true;
    c.dying = 0;
    c.wounded = (c.wounded ?? 0) + 1;
    if (c.hp <= 0) c.hp = 1;
    dyingAfter = 0;
  } else {
    c.dying = dyingAfter;
  }

  let narration;
  if (died)       narration = `☠️ **${combatantName} has died.**`;
  else if (awoke) narration = `✨ **${combatantName} recovers consciousness!** (now Wounded ${c.wounded}, HP 1)`;
  else if (delta < 0) narration = `⬆️ Dying reduced: ${dyingBefore} → ${dyingAfter}`;
  else if (delta > 0) narration = `⬇️ Dying increased: ${dyingBefore} → ${dyingAfter}`;
  else                narration = `Dying unchanged at ${dyingAfter}`;

  return {
    roll, dc, outcome, delta,
    dyingBefore, dyingAfter,
    died, awoke,
    narration,
  };
}

// Allow a hero-point reroll of the most recent recovery check. Rolls again,
// keeps the higher result, applies it. Caller is responsible for having already
// burned the hero point before calling this (this is just the re-resolve step).
// Returns same shape as rollRecoveryCheck, but with `originalRoll` and `rerollRoll`
// fields, and the outcome reflects the higher of the two.
function rerollRecoveryCheck(channelId, combatantName, originalResult) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return null;
  const c = enc.findCombatant(encounter, combatantName);
  if (!c) return null;

  // Undo the original result first
  c.dying = originalResult.dyingBefore;
  if (originalResult.awoke) {
    c.wounded = Math.max(0, (c.wounded ?? 0) - 1);
    if (c.hp === 1) c.hp = 0; // roll back the 1-HP regain
  }

  // Now roll again
  const second = rollRecoveryCheck(channelId, combatantName);
  if (!second) return null;

  // Keep the better of the two (lower dying value = better)
  const firstIsBetter = originalResult.dyingAfter < second.dyingAfter ||
    (originalResult.awoke && !second.awoke);

  if (firstIsBetter) {
    // Undo the second roll's effects, reapply the first
    c.dying = originalResult.dyingAfter;
    c.hp = originalResult.awoke ? 1 : c.hp;
    if (originalResult.awoke) c.wounded = (c.wounded ?? 0) + 1;
    return {
      ...originalResult,
      originalRoll: originalResult.roll,
      rerollRoll: second.roll,
      keptOriginal: true,
      narration: `🎭 Hero Point reroll: ${second.roll} vs original ${originalResult.roll} — kept original.\n${originalResult.narration}`,
    };
  }
  return {
    ...second,
    originalRoll: originalResult.roll,
    rerollRoll: second.roll,
    keptOriginal: false,
    narration: `🎭 Hero Point reroll: ${second.roll} vs original ${originalResult.roll} — kept reroll.\n${second.narration}`,
  };
}

// ─── Persistent Damage ────────────────────────────────────────────────────────

// Find all persistent-damage effects on a combatant. These have a specific
// shape: { name: 'Persistent damage', kind: 'persistent-damage', dice, damageType, dc }
function getPersistentDamageEffects(combatant) {
  if (!combatant?.effects) return [];
  return combatant.effects.filter(e => e.kind === 'persistent-damage');
}

// Roll persistent damage and the DC 15 flat check to end it. Applies damage
// to HP. Returns an array of result objects, one per persistent effect:
//   { name, damageType, damageRoll, damage, flatRoll, ended, dyingResult }
function tickPersistentDamage(channelId, combatantName) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return [];
  const c = enc.findCombatant(encounter, combatantName);
  if (!c) return [];
  const effects = getPersistentDamageEffects(c);
  if (effects.length === 0) return [];

  const results = [];
  for (const effect of [...effects]) { // copy array; we mutate during iteration
    const damage = rollDiceExpression(effect.dice ?? '1d6');
    const hpBeforeTick = c.hp;
    const damageResult = applyDamage(channelId, combatantName, damage.total);

    // Flat check to end (DC 15 by default; some effects override)
    const flatDc = effect.dc ?? 15;
    const flatRoll = Math.floor(Math.random() * 20) + 1;
    const ended = flatRoll >= flatDc;

    if (ended) {
      // Remove the effect
      const idx = c.effects.findIndex(e => e === effect);
      if (idx >= 0) c.effects.splice(idx, 1);
    }

    results.push({
      name: effect.name,
      damageType: effect.damageType ?? 'untyped',
      damageDice: effect.dice,
      damageRolls: damage.rolls,
      damage: damage.total,
      flatRoll,
      flatDc,
      ended,
      hpBefore: hpBeforeTick,
      hpAfter: c.hp,
      wentDown: damageResult?.wentDown ?? false,
      died: damageResult?.died ?? false,
      dying: damageResult?.dying ?? 0,
    });
  }
  return results;
}

// ─── Reactions ───────────────────────────────────────────────────────────────

// Check whether a combatant has a reaction available this round.
function hasReactionAvailable(combatant) {
  if (!combatant) return false;
  // Dying combatants cannot take reactions
  if ((combatant.dying ?? 0) > 0) return false;
  // Default to true if the field is missing (legacy combatants)
  if (combatant.reactionUsed === undefined) return true;
  return !combatant.reactionUsed;
}

// Mark a reaction as used. Returns true if successful, false if none available.
function consumeReaction(channelId, combatantName) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return false;
  const c = enc.findCombatant(encounter, combatantName);
  if (!c) return false;
  if (!hasReactionAvailable(c)) return false;
  c.reactionUsed = true;
  return true;
}

// Find combatants who have reactions available and could plausibly react to
// an attack/cast in this channel. We don't know positioning, so we return
// everyone with a reaction available except the attacker themselves.
// The caller (index.js) decides how to prompt.
function findPotentialReactors(channelId, attackerName) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return [];
  return encounter.combatants
    .filter(c => c.name.toLowerCase() !== (attackerName ?? '').toLowerCase())
    .filter(c => hasReactionAvailable(c))
    // Only combatants marked as having reactions (GMs can tag monsters)
    .filter(c => c.hasReaction !== false);
}

// ─── Turn Transition Orchestration ───────────────────────────────────────────

// Call this instead of enc.advanceTurn(). It:
//   1. Ticks persistent damage on the current (outgoing) combatant first
//   2. Advances the turn (calling enc.advanceTurn for effect duration ticks)
//   3. Resets the new current combatant's per-turn state (MAP, reactions)
//   4. Returns everything the caller needs to display
// Note: per PF2e RAW, persistent damage rolls at the *end* of the affected
// creature's turn, before their next turn begins. Doing it here (on advance)
// approximates that — it happens right as their turn ends.
function processTurnTransition(channelId) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter || encounter.combatants.length === 0) return null;

  // 1. Tick persistent damage on the combatant whose turn is ENDING
  const outgoing = encounter.combatants[encounter.turnIndex];
  const persistentResults = outgoing
    ? tickPersistentDamage(channelId, outgoing.name)
    : [];

  // 2. Advance the turn (handles effect duration ticking internally)
  const roundBefore = encounter.round;
  const advResult = enc.advanceTurn(channelId);
  if (!advResult) return null;

  const current = advResult.current;
  const newRound = encounter.round > roundBefore;

  // 3. Reset per-turn state on the new current combatant
  current.attacksThisTurn = 0;
  // Reset reactions at start of ROUND, not turn — but since the first combatant's
  // turn is also the start of a new round, we reset when round advances.
  if (newRound) {
    for (const c of encounter.combatants) {
      c.reactionUsed = false;
    }
  }

  // 4. Check if new current combatant needs a recovery check
  // Log diagnostics so we can trace why the check did or didn't fire
  const currentDying = current.dying ?? 0;
  console.log(`[processTurnTransition] ${current.name} — dying=${currentDying}, hp=${current.hp}/${current.maxHp}`);
  const recoveryCheck = currentDying > 0
    ? rollRecoveryCheck(channelId, current.name)
    : null;
  if (recoveryCheck) {
    console.log(`[processTurnTransition] Recovery rolled for ${current.name}: ${recoveryCheck.outcome} (roll ${recoveryCheck.roll} vs DC ${recoveryCheck.dc})`);
  }

  return {
    enc: encounter,
    current,
    expiredEffects: advResult.expiredEffects ?? [],
    persistentResults, // from the OUTGOING combatant
    recoveryCheck,     // for the INCOMING combatant, or null
    newRound,
  };
}

// ─── Utility: dice expression rolling (local copy to avoid circular import) ─

function rollDiceExpression(expr) {
  // Simple parser: "1d6", "2d4+3", "1d10+5". Returns { total, rolls, display }.
  const m = String(expr).match(/^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/i);
  if (!m) return { total: 0, rolls: [], display: expr };
  const num = parseInt(m[1]) || 1;
  const sides = parseInt(m[2]);
  const sign = m[3] === '-' ? -1 : 1;
  const bonus = m[4] ? sign * parseInt(m[4]) : 0;
  const rolls = [];
  let sum = 0;
  for (let i = 0; i < num; i++) {
    const r = Math.floor(Math.random() * sides) + 1;
    rolls.push(r);
    sum += r;
  }
  const total = Math.max(0, sum + bonus);
  const display = `${num}d${sides}[${rolls.join(',')}]${bonus !== 0 ? (bonus >= 0 ? `+${bonus}` : bonus) : ''}`;
  return { total, rolls, display, bonus };
}

module.exports = {
  // MAP
  computeMapForNextAttack,
  recordAttack,
  // Dying/Wounded
  applyDamage,
  applyHealing,
  applyHpChange,
  rollRecoveryCheck,
  rerollRecoveryCheck,
  // Persistent damage
  getPersistentDamageEffects,
  tickPersistentDamage,
  // Reactions
  hasReactionAvailable,
  consumeReaction,
  findPotentialReactors,
  // Orchestration
  processTurnTransition,
};