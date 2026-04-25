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
// Handles dying/wounded state transitions per PF2e rules (Player Core p. 411):
//   - Going from alive → 0 HP: gain Dying 1 (+1 per existing wounded value)
//   - Already dying when hit: dying +1 (or +2 if from a crit hit / crit-failed save)
//   - Reaching maxDying (4 by default; lower if doomed) means death.
//
// Pass { isCrit: true } in opts when the damage is from a critical hit or a
// critical failure on a save (per RAW). Defaults to false.
//
// Returns an object describing what happened:
//   {
//     newHp: number, maxHp: number,
//     wentDown: boolean,        // transitioned from alive → 0 HP this call
//     dyingIncreased: boolean,  // was dying, dying value went up
//     wokeUp: boolean,          // was dying, now above 0 HP
//     died: boolean,            // dying reached maxDying (dead)
//     dying: number,            // current dying value (0 if not dying)
//     wounded: number,          // current wounded value
//     displaySuffix: string,    // short text to append to damage line
//   }
function applyDamage(channelId, combatantName, damage, opts = {}) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return null;
  const c = enc.findCombatant(encounter, combatantName);
  if (!c) return null;

  const isCrit = opts.isCrit === true;

  const hpBefore = c.hp;
  const wasAlive = hpBefore > 0;
  const wasDying = (c.dying ?? 0) > 0;
  const newHp = Math.max(0, Math.min(c.maxHp, hpBefore - damage));
  c.hp = newHp;

  // Ensure dying/wounded/doomed fields exist (legacy combatants may lack them)
  if (typeof c.dying !== 'number') c.dying = 0;
  if (typeof c.wounded !== 'number') c.wounded = 0;
  if (typeof c.doomed !== 'number') c.doomed = 0;

  const maxDying = Math.max(1, 4 - c.doomed);
  let wentDown = false;
  let dyingIncreased = false;
  let died = false;

  if (wasAlive && newHp === 0 && damage > 0) {
    // First time hitting 0 HP this fight: gain Dying 1 + wounded value
    wentDown = true;
    c.dying = 1 + (c.wounded ?? 0);
    if (c.dying >= maxDying) {
      died = true;
      c.dying = maxDying;
    }
  } else if (wasDying && damage > 0) {
    // Already dying and took more damage: dying +1 (or +2 if crit)
    dyingIncreased = true;
    c.dying += isCrit ? 2 : 1;
    if (c.dying >= maxDying) {
      died = true;
      c.dying = maxDying;
    }
  }

  const suffix = buildDamageSuffix({ wentDown, dyingIncreased, died, dying: c.dying, newHp, isCrit });
  return {
    newHp,
    maxHp: c.maxHp,
    wentDown,
    dyingIncreased,
    wokeUp: false,
    died,
    dying: c.dying,
    wounded: c.wounded,
    doomed: c.doomed,
    displaySuffix: suffix,
  };
}

// Healing wrapper. Call INSTEAD of enc.modifyHp for healing.
// Handles waking up from dying per PF2e rules: any HP restoration removes the
// dying condition and increments wounded by 1. If you were Unconscious because
// of dying and now have 1+ HP, you also wake up.
function applyHealing(channelId, combatantName, amount) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return null;
  const c = enc.findCombatant(encounter, combatantName);
  if (!c) return null;

  const hpBefore = c.hp;
  const wasDying = (c.dying ?? 0) > 0;
  const wasUnconscious = c.unconscious === true;
  const newHp = Math.max(0, Math.min(c.maxHp, hpBefore + amount));
  c.hp = newHp;

  if (typeof c.dying !== 'number') c.dying = 0;
  if (typeof c.wounded !== 'number') c.wounded = 0;

  let wokeUp = false;
  if (wasDying && newHp > 0) {
    wokeUp = true;
    c.dying = 0;
    c.wounded = (c.wounded ?? 0) + 1;
    c.unconscious = false;
  } else if (wasUnconscious && newHp > 0) {
    // Was stable-but-unconscious from a previous recovery; healing wakes them.
    c.unconscious = false;
    wokeUp = true;
  }

  let suffix = '';
  if (wokeUp) {
    suffix = wasDying
      ? `\n✨ **Recovered from dying!** (now Wounded ${c.wounded})`
      : `\n✨ **${combatantName} wakes up!**`;
  }

  return {
    newHp,
    maxHp: c.maxHp,
    wokeUp,
    wentDown: false,
    dyingIncreased: false,
    died: false,
    dying: c.dying,
    wounded: c.wounded,
    doomed: c.doomed ?? 0,
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

function buildDamageSuffix({ wentDown, dyingIncreased, died, dying, newHp, isCrit }) {
  const critTag = isCrit ? ' (crit)' : '';
  if (died) return `\n☠️ **Dead!** (Dying ${dying})${critTag}`;
  if (wentDown && dying > 0) return `\n💀 **Down!** (Dying ${dying})${critTag}`;
  if (dyingIncreased) return `\n💀 **Dying increased to ${dying}**${critTag}`;
  if (newHp === 0 && dying > 0) return ` 💀 (Dying ${dying})`;
  return '';
}

// Roll the recovery flat check for a dying combatant.
// PF2e Remaster (Player Core, p. 411):
//   Flat check DC = 10 + current dying value (was 11 + in CRB, now 10 + in Remaster)
//   Crit Success: dying -2
//   Success:      dying -1
//   Failure:      dying +1 (plus wounded value, if any)
//   Crit Failure: dying +2 (plus wounded value, if any)
// You die when dying reaches your maximum dying value (default 4, lower if doomed).
// Returns { roll, dc, outcome, dyingBefore, dyingAfter, died, awoke, narration, woundedAdded, maxDying }.
function rollRecoveryCheck(channelId, combatantName) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return null;
  const c = enc.findCombatant(encounter, combatantName);
  if (!c || (c.dying ?? 0) <= 0) return null;

  const dyingBefore = c.dying;
  const wounded = c.wounded ?? 0;
  const doomed = c.doomed ?? 0;
  const maxDying = Math.max(1, 4 - doomed); // doomed lowers your death threshold
  const dc = 10 + dyingBefore; // Remaster uses 10 + dying (was 11 + in CRB)
  const roll = Math.floor(Math.random() * 20) + 1;

  // Determine outcome (nat 20 / nat 1 shift one step)
  let outcome, baseDelta;
  if (roll === 20)                  { outcome = 'crit-success'; baseDelta = -2; }
  else if (roll === 1)              { outcome = 'crit-failure'; baseDelta = +2; }
  else if (roll >= dc + 10)         { outcome = 'crit-success'; baseDelta = -2; }
  else if (roll >= dc)              { outcome = 'success';      baseDelta = -1; }
  else if (roll <= dc - 10)         { outcome = 'crit-failure'; baseDelta = +2; }
  else                              { outcome = 'failure';      baseDelta = +1; }

  // Nat 20 ALSO shifts result up one step (PF2e general rule: nat 20 on a check
  // is one degree better). Same for nat 1. Apply that shift.
  if (roll === 20) {
    if (outcome === 'failure')      { outcome = 'success';      baseDelta = -1; }
    else if (outcome === 'crit-failure') { outcome = 'failure'; baseDelta = +1; }
    // crit-success and success on nat 20 → still crit-success
  } else if (roll === 1) {
    if (outcome === 'success')      { outcome = 'failure';      baseDelta = +1; }
    else if (outcome === 'crit-success') { outcome = 'success'; baseDelta = -1; }
    // crit-failure and failure on nat 1 → still crit-failure
  }

  // Remaster: failure and crit-failure ALSO add wounded value.
  let delta = baseDelta;
  let woundedAdded = 0;
  if (baseDelta > 0 && wounded > 0) {
    delta = baseDelta + wounded;
    woundedAdded = wounded;
  }

  const dyingAfterRaw = dyingBefore + delta;
  let died = false;
  let awoke = false;
  let dyingAfter = dyingAfterRaw;

  if (dyingAfter >= maxDying) {
    died = true;
    dyingAfter = maxDying;
    c.dying = maxDying;
    // Dead means HP stays 0 and dying is locked; let the GM decide to remove
  } else if (dyingAfter <= 0) {
    // Crit success that takes dying to 0 (or below) clears the dying condition.
    // PF2e RAW: "If you lose the dying condition by succeeding at a recovery
    // check and are still at 0 Hit Points, you remain unconscious."
    // We keep them at 0 HP with the unconscious flag set instead of auto-1HP.
    awoke = true;
    c.dying = 0;
    c.wounded = (c.wounded ?? 0) + 1;
    // PF2e RAW: stays unconscious at 0 HP. The unconscious flag is purely
    // informational here — actual HP-restoration must come from healing.
    c.unconscious = (c.hp ?? 0) <= 0;
    dyingAfter = 0;
  } else {
    c.dying = dyingAfter;
  }

  // Compose narration
  let narration;
  if (died) {
    narration = doomed > 0
      ? `☠️ **${combatantName} has died.** (Doomed ${doomed} → death at Dying ${maxDying})`
      : `☠️ **${combatantName} has died.**`;
  } else if (awoke) {
    narration = c.hp > 0
      ? `✨ **${combatantName} recovers consciousness!** (now Wounded ${c.wounded})`
      : `✨ **${combatantName} stabilizes** at 0 HP. (now Wounded ${c.wounded}, still unconscious — needs healing to wake)`;
  } else if (delta < 0) {
    narration = `⬆️ Dying reduced: ${dyingBefore} → ${dyingAfter}`;
  } else if (delta > 0) {
    const woundedNote = woundedAdded > 0 ? ` (+${baseDelta} base, +${woundedAdded} from Wounded ${wounded})` : '';
    narration = `⬇️ Dying increased: ${dyingBefore} → ${dyingAfter}${woundedNote}`;
  } else {
    narration = `Dying unchanged at ${dyingAfter}`;
  }

  return {
    roll, dc, outcome, delta, baseDelta,
    dyingBefore, dyingAfter,
    died, awoke,
    woundedAdded, wounded, doomed, maxDying,
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

// Spend all remaining hero points to escape death (PF2e Player Core p. 411).
// "If you have at least 1 Hero Point, you can spend all of your remaining Hero
// Points at the start of your turn or when your dying value would increase. You
// lose the dying condition entirely and stabilize with 0 Hit Points. You don't
// gain the wounded condition or increase its value from losing the dying
// condition in this way."
//
// This is the bot-side mechanical effect. The caller is responsible for
// validating the player has hero points and zeroing them out.
//
// Returns { ok, dyingBefore, woundedKept, narration } or null if not dying.
function stabilizeWithHeroPoints(channelId, combatantName) {
  const encounter = enc.getEncounter(channelId);
  if (!encounter) return null;
  const c = enc.findCombatant(encounter, combatantName);
  if (!c) return null;
  const dyingBefore = c.dying ?? 0;
  if (dyingBefore <= 0) return { ok: false, reason: 'not-dying' };

  c.dying = 0;
  // Wounded does NOT increase or decrease — keep current value.
  // HP stays at 0 (stabilized). Mark unconscious so display reflects that they
  // aren't actively fighting yet.
  c.unconscious = (c.hp ?? 0) <= 0;

  return {
    ok: true,
    dyingBefore,
    woundedKept: c.wounded ?? 0,
    narration: `🎭 **${combatantName}** spends all remaining Hero Points to escape death — stabilized at 0 HP, dying cleared. Wounded ${c.wounded ?? 0} unchanged.`,
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
  stabilizeWithHeroPoints,
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