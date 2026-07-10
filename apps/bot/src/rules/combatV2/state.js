// systems/combatV2/state.js
// Combat v2 encounter store: owns the in-memory Map and every Supabase write.
//
// The PURE combat rules now live in ./model.js. This file is the stateful shell
// around them: it resolves a channelId to an encounter, delegates the rules work
// to the model, and persists the result. Anything here that does not touch the
// Map or Supabase belongs in the model instead.

const { syncEncounterToSupabase, endEncounterInSupabase, getSupabase } = require('../../lib/storage');
const { rollDamage, applyDefenses } = require('./rolls');
const model = require('./model');

// Only what this file still calls directly. The rest of the model is re-exported
// verbatim at the bottom so the 13 consumers keep their existing import surface.
const {
  slug,
  nowIso,
  isCombatV2Snapshot,
  makeCombatant, // used bare as `.map(makeCombatant)` in the restore path
  findCombatant,
  currentCombatant,
  resetTurnState,
  tickEffectDurations,
  getPersistentDamageEffects,
  persistentDamageConfig,
  processActionEconomy,
} = model;

const encounters = new Map();

function touchEncounter(encounter) {
  if (!encounter) return encounter;
  encounter.updatedAt = nowIso();
  syncEncounterToSupabase(encounter.channelId, encounter);
  return encounter;
}

function createEncounter(channelId, { guildId = null, gmId, name = 'Encounter' } = {}) {
  const encounter = {
    version: 2,
    id: channelId,
    channelId,
    guildId,
    gmId,
    name,
    round: 1,
    turnIndex: 0,
    summaryMessageId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    combatants: [],
    log: [],
  };
  encounters.set(channelId, encounter);
  return touchEncounter(encounter);
}

function getEncounter(channelId) {
  return encounters.get(channelId) ?? null;
}

function endEncounter(channelId) {
  const encounter = encounters.get(channelId);
  if (encounter) endEncounterInSupabase(encounter);
  return encounters.delete(channelId);
}

/** Sort (model) then persist. Kept channel-free: callers already hold the encounter. */
function sortCombatants(encounter) {
  model.sortCombatants(encounter);
  return touchEncounter(encounter);
}

/** Resolve a channel to its live encounter, or throw the caller-facing error. */
function requireEncounter(channelId) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  return encounter;
}

/**
 * The adapter shape: resolve the encounter, let the pure model do the rules
 * work, then persist exactly once. If `fn` throws, nothing is written.
 */
function mutate(channelId, fn) {
  const encounter = requireEncounter(channelId);
  const result = fn(encounter);
  touchEncounter(encounter);
  return result;
}

function addCombatant(channelId, input) {
  return mutate(channelId, enc => model.addCombatant(enc, input));
}

function removeCombatant(channelId, query) {
  return mutate(channelId, enc => model.removeCombatant(enc, query));
}

function rollRecoveryCheck(channelId, query) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  if ((combatant.dying ?? 0) <= 0) return null;

  if (typeof combatant.dying !== 'number') combatant.dying = 0;
  if (typeof combatant.wounded !== 'number') combatant.wounded = 0;
  if (typeof combatant.doomed !== 'number') combatant.doomed = 0;

  const dyingBefore = combatant.dying;
  const wounded = combatant.wounded ?? 0;
  const doomed = combatant.doomed ?? 0;
  const maxDying = Math.max(1, 4 - doomed);
  const dc = 10 + dyingBefore;
  const roll = Math.floor(Math.random() * 20) + 1;

  let outcome;
  let baseDelta;
  if (roll === 20) {
    outcome = 'crit-success';
    baseDelta = -2;
  } else if (roll === 1) {
    outcome = 'crit-failure';
    baseDelta = 2;
  } else if (roll >= dc + 10) {
    outcome = 'crit-success';
    baseDelta = -2;
  } else if (roll >= dc) {
    outcome = 'success';
    baseDelta = -1;
  } else if (roll <= dc - 10) {
    outcome = 'crit-failure';
    baseDelta = 2;
  } else {
    outcome = 'failure';
    baseDelta = 1;
  }

  const woundedAdded = baseDelta > 0 ? wounded : 0;
  const delta = baseDelta + woundedAdded;
  let dyingAfter = dyingBefore + delta;
  let died = false;
  let awoke = false;
  let removed = null;

  if (dyingAfter >= maxDying) {
    died = true;
    dyingAfter = maxDying;
    combatant.dying = maxDying;
    removed = { ...combatant };
    removeCombatant(channelId, combatant.name);
  } else if (dyingAfter <= 0) {
    awoke = true;
    dyingAfter = 0;
    combatant.dying = 0;
    combatant.wounded = (combatant.wounded ?? 0) + 1;
    combatant.unconscious = (combatant.hp ?? 0) <= 0;
  } else {
    combatant.dying = dyingAfter;
    combatant.unconscious = true;
  }

  encounter.log.push({
    at: nowIso(),
    kind: died ? 'recovery-death' : 'recovery',
    name: removed?.name ?? combatant.name,
    roll,
    dc,
    outcome,
    dyingBefore,
    dyingAfter,
  });
  touchEncounter(encounter);

  const name = removed?.name ?? combatant.name;
  let narration;
  if (died) {
    narration = doomed > 0
      ? `${name} has died. (Doomed ${doomed} means death at Dying ${maxDying}.)`
      : `${name} has died.`;
  } else if (awoke) {
    narration = `${name} stabilizes at 0 HP. (Now Wounded ${combatant.wounded}, still unconscious until healed.)`;
  } else if (delta < 0) {
    narration = `Dying reduced: ${dyingBefore} -> ${dyingAfter}`;
  } else if (delta > 0) {
    const woundedNote = woundedAdded > 0 ? ` (+${baseDelta} base, +${woundedAdded} from Wounded ${wounded})` : '';
    narration = `Dying increased: ${dyingBefore} -> ${dyingAfter}${woundedNote}`;
  } else {
    narration = `Dying unchanged at ${dyingAfter}`;
  }

  return {
    encounter,
    combatant,
    removed,
    name,
    roll,
    dc,
    outcome,
    delta,
    baseDelta,
    dyingBefore,
    dyingAfter,
    dying: dyingAfter,
    wounded: combatant.wounded ?? wounded,
    woundedAdded,
    doomed,
    maxDying,
    died,
    awoke,
    narration,
  };
}

// Hero-point reroll of a recovery check (the re-resolve step; the caller is
// responsible for having already spent the hero point). Undoes the original
// result, rolls again, keeps whichever leaves the combatant better off.
function rerollRecoveryCheck(channelId, query, originalResult) {
  const encounter = getEncounter(channelId);
  if (!encounter) return null;
  const combatant = findCombatant(encounter, query);
  if (!combatant || !originalResult) return null;

  // Undo the original result
  combatant.dying = originalResult.dyingBefore;
  if (originalResult.awoke) {
    combatant.wounded = Math.max(0, (combatant.wounded ?? 0) - 1);
    // HP stays at 0 — recovery never restores HP (PF2e RAW).
  }

  const second = rollRecoveryCheck(channelId, combatant.id);
  if (!second) return null;

  const firstIsBetter = originalResult.dyingAfter < second.dyingAfter
    || (originalResult.awoke && !second.awoke);

  if (firstIsBetter && !second.died) {
    // Undo the second roll, reapply the first.
    combatant.dying = originalResult.dyingAfter;
    if (originalResult.awoke) {
      combatant.wounded = (combatant.wounded ?? 0) + 1;
      combatant.unconscious = (combatant.hp ?? 0) <= 0;
    }
    touchEncounter(encounter);
    return {
      ...originalResult,
      originalRoll: originalResult.roll,
      rerollRoll: second.roll,
      keptOriginal: true,
      narration: `Hero Point reroll: ${second.roll} vs original ${originalResult.roll} — kept original.\n${originalResult.narration}`,
    };
  }
  return {
    ...second,
    originalRoll: originalResult.roll,
    rerollRoll: second.roll,
    keptOriginal: false,
    narration: `Hero Point reroll: ${second.roll} vs original ${originalResult.roll} — kept reroll.\n${second.narration}`,
  };
}

// Spend ALL remaining hero points to escape death (PF2e Player Core p. 411):
// lose the dying condition entirely, stabilize at 0 HP, wounded unchanged.
// The caller validates and zeroes the player's hero points.
function stabilizeWithHeroPoints(channelId, query) {
  const encounter = getEncounter(channelId);
  if (!encounter) return null;
  const combatant = findCombatant(encounter, query);
  if (!combatant) return null;
  const dyingBefore = combatant.dying ?? 0;
  if (dyingBefore <= 0) return { ok: false, reason: 'not-dying' };

  combatant.dying = 0;
  combatant.unconscious = (combatant.hp ?? 0) <= 0;
  encounter.log.push({ at: nowIso(), kind: 'hero-stabilize', name: combatant.name, dyingBefore });
  touchEncounter(encounter);

  return {
    ok: true,
    combatant,
    dyingBefore,
    woundedKept: combatant.wounded ?? 0,
    narration: `**${combatant.name}** spends all remaining Hero Points to escape death — stabilized at 0 HP, dying cleared. Wounded ${combatant.wounded ?? 0} unchanged.`,
  };
}

// GM override of a combatant's dying value (0–4). PF2e RAW semantics match
// the automated paths: manually clearing dying grants Wounded +1 and does NOT
// restore HP (unconscious at 0 HP until healed); reaching the max dying value
// (4, lowered by doomed) is death and removes the combatant.
function setDying(channelId, query, value) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const before = combatant.dying ?? 0;
  const maxDying = Math.max(1, 4 - (combatant.doomed ?? 0));
  let died = false;
  let recovered = false;
  let removed = null;

  encounter.log.push({ at: nowIso(), kind: 'set-dying', name: combatant.name, before, value });

  if (value >= maxDying) {
    combatant.dying = maxDying;
    died = true;
    removed = removeCombatant(channelId, combatant.name).combatant;
  } else if (value === 0 && before > 0) {
    combatant.dying = 0;
    combatant.wounded = (combatant.wounded ?? 0) + 1;
    combatant.unconscious = (combatant.hp ?? 0) <= 0;
    recovered = true;
    touchEncounter(encounter);
  } else {
    combatant.dying = Math.max(0, value);
    if (combatant.dying > 0) combatant.unconscious = true;
    touchEncounter(encounter);
  }

  return {
    encounter,
    combatant,
    before,
    value: died ? maxDying : Math.max(0, value),
    maxDying,
    died,
    recovered,
    removed,
    wounded: combatant.wounded ?? 0,
    doomed: combatant.doomed ?? 0,
  };
}

// Unlike the other mutators this returns null instead of throwing when the
// channel has no encounter, and persists nothing when the encounter is empty.
function advanceTurn(channelId, direction = 1) {
  const encounter = getEncounter(channelId);
  if (!encounter) return null;
  const result = model.advanceTurn(encounter, direction);
  if (!result) return null;
  touchEncounter(encounter);
  return result;
}

function delayCombatant(channelId, query) {
  return mutate(channelId, enc => model.delayCombatant(enc, query));
}

function rejoinCombatant(channelId, query, targetQuery = null) {
  return mutate(channelId, enc => model.rejoinCombatant(enc, query, targetQuery));
}

function applyHp(channelId, query, amount, { mode = 'delta', isCrit = false } = {}) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const before = {
    hp: combatant.hp,
    tempHp: combatant.tempHp,
    dying: combatant.dying ?? 0,
    wounded: combatant.wounded ?? 0,
  };
  if (typeof combatant.dying !== 'number') combatant.dying = 0;
  if (typeof combatant.wounded !== 'number') combatant.wounded = 0;
  if (typeof combatant.doomed !== 'number') combatant.doomed = 0;

  const hpBefore = combatant.hp;
  const wasDying = combatant.dying > 0;
  let effectiveDamage = 0;
  if (mode === 'set') {
    combatant.hp = Math.max(0, Math.min(combatant.maxHp, amount));
    if (combatant.hp < hpBefore) effectiveDamage = hpBefore - combatant.hp;
  } else if (amount < 0) {
    let damage = Math.abs(amount);
    const absorbed = Math.min(combatant.tempHp ?? 0, damage);
    combatant.tempHp = Math.max(0, (combatant.tempHp ?? 0) - absorbed);
    damage -= absorbed;
    effectiveDamage = damage;
    combatant.hp = Math.max(0, combatant.hp - damage);
  } else {
    combatant.hp = Math.min(combatant.maxHp, combatant.hp + amount);
  }

  const maxDying = Math.max(1, 4 - (combatant.doomed ?? 0));
  let wentDown = false;
  let dyingIncreased = false;
  let wokeUp = false;
  let died = false;

  if (amount > 0 && wasDying && combatant.hp > 0) {
    combatant.dying = 0;
    combatant.wounded = (combatant.wounded ?? 0) + 1;
    combatant.unconscious = false;
    wokeUp = true;
  } else if (amount > 0 && combatant.unconscious && combatant.hp > 0) {
    combatant.unconscious = false;
    wokeUp = true;
  }

  if ((mode === 'set' || amount < 0) && effectiveDamage > 0 && combatant.hp === 0) {
    // PF2e Player Core p. 411: knocked to 0 by a critical hit (or crit-failed
    // save) → Dying 2 instead of 1; damaged while already dying → dying +2 on
    // a crit instead of +1. Wounded always adds to the initial value.
    if (hpBefore > 0) {
      wentDown = true;
      combatant.dying = 1 + (combatant.wounded ?? 0) + (isCrit ? 1 : 0);
    } else if (wasDying) {
      dyingIncreased = true;
      combatant.dying += isCrit ? 2 : 1;
    }
    combatant.unconscious = true;
    if (combatant.dying >= maxDying) {
      combatant.dying = maxDying;
      died = true;
    }
  }

  encounter.log.push({
    at: nowIso(),
    kind: died ? 'death' : 'hp',
    name: combatant.name,
    amount,
    mode,
    before,
    after: { hp: combatant.hp, tempHp: combatant.tempHp, dying: combatant.dying, wounded: combatant.wounded },
  });

  let removed = null;
  if (died) {
    removed = removeCombatant(channelId, combatant.name).combatant;
  } else {
    touchEncounter(encounter);
  }

  return {
    encounter,
    combatant,
    before,
    wentDown,
    dyingIncreased,
    wokeUp,
    died,
    removed,
    dying: combatant.dying,
    wounded: combatant.wounded,
    maxDying,
  };
}

function setTempHp(channelId, query, amount) {
  return mutate(channelId, enc => model.setTempHp(enc, query, amount));
}

function addEffect(channelId, query, effect) {
  return mutate(channelId, enc => model.addEffect(enc, query, effect));
}

function removeEffect(channelId, query, effectName) {
  return mutate(channelId, enc => model.removeEffect(enc, query, effectName));
}

function modifyCombatant(channelId, query, patch) {
  return mutate(channelId, enc => model.modifyCombatant(enc, query, patch));
}

function tickPersistentDamage(channelId, query) {
  const encounter = getEncounter(channelId);
  if (!encounter) return [];
  const combatant = findCombatant(encounter, query);
  if (!combatant) return [];
  const effects = getPersistentDamageEffects(combatant);
  if (!effects.length) return [];

  const results = [];
  for (const effect of [...effects]) {
    const { damageDice, damageType, flatDc } = persistentDamageConfig(effect);
    const damageRoll = rollDamage(damageDice);
    if (!damageRoll) continue;
    const hpBefore = combatant.hp;
    const defended = applyDefenses(damageRoll.total, damageType, combatant);
    const hpResult = defended.finalDamage > 0
      ? applyHp(channelId, combatant.id, -defended.finalDamage)
      : null;
    const flatRoll = Math.floor(Math.random() * 20) + 1;
    const ended = flatRoll >= flatDc;
    const stillPresent = findCombatant(getEncounter(channelId), combatant.id);

    if (ended && stillPresent?.effects?.length) {
      stillPresent.effects = stillPresent.effects.filter(e => e !== effect);
      touchEncounter(encounter);
    }

    results.push({
      name: combatant.name,
      effectName: effect.name,
      damageType,
      damageDice,
      damageRolls: damageRoll.rolls,
      damage: damageRoll.total,
      finalDamage: defended.finalDamage,
      defenseNotes: defended.notes,
      flatRoll,
      flatDc,
      ended,
      hpBefore,
      hpAfter: stillPresent?.hp ?? hpResult?.combatant?.hp ?? 0,
      wentDown: hpResult?.wentDown ?? false,
      died: hpResult?.died ?? false,
      dying: hpResult?.dying ?? combatant.dying ?? 0,
      removed: hpResult?.removed ?? null,
    });

    if (hpResult?.died) break;
  }
  touchEncounter(encounter);
  return results;
}

function processTurnTransition(channelId, direction = 1) {
  const encounter = getEncounter(channelId);
  if (!encounter || encounter.combatants.length === 0) return null;

  const outgoing = currentCombatant(encounter);
  const outgoingIndex = encounter.turnIndex;
  const persistentResults = direction > 0 && outgoing
    ? tickPersistentDamage(channelId, outgoing.id)
    : [];
  const encounterAfterPersistent = getEncounter(channelId);
  if (!encounterAfterPersistent || encounterAfterPersistent.combatants.length === 0) {
    return {
      encounter: encounterAfterPersistent ?? encounter,
      current: null,
      expiredEffects: [],
      persistentResults,
      recoveryCheck: null,
      newRound: false,
      actionEconomy: null,
    };
  }
  if (direction > 0 && persistentResults.some(result => result.died)) {
    encounterAfterPersistent.turnIndex = outgoingIndex - 1;
  }

  const roundBefore = encounter.round;
  const advanceResult = advanceTurn(channelId, direction);
  if (!advanceResult) return null;

  let { current } = advanceResult;
  const newRound = encounter.round > roundBefore;
  const expiredEffects = direction > 0 && current ? tickEffectDurations(current) : [];
  const actionEconomy = direction > 0 && current ? processActionEconomy(current) : null;
  const currentIndexBeforeRecovery = encounter.turnIndex;
  const recoveryCheck = direction > 0 && (current?.dying ?? 0) > 0
    ? rollRecoveryCheck(channelId, current.id)
    : null;
  if (recoveryCheck?.died && encounter.combatants.length > 0) {
    encounter.turnIndex = currentIndexBeforeRecovery - 1;
    current = advanceTurn(channelId, 1)?.current ?? null;
  }

  encounter.log.push({
    at: nowIso(),
    kind: 'turn-transition',
    current: current?.name ?? null,
    round: encounter.round,
    persistentCount: persistentResults.length,
    expiredCount: expiredEffects.length,
    recovery: recoveryCheck?.outcome ?? null,
  });
  touchEncounter(encounter);

  return {
    encounter,
    current,
    expiredEffects,
    persistentResults,
    recoveryCheck,
    newRound,
    actionEconomy,
  };
}

async function restoreEncountersFromSupabase() {
  try {
    const sb = getSupabase();
    if (!sb) return 0;
    const { data: rows, error } = await sb
      .from('encounters')
      .select('*')
      .eq('status', 'active');
    if (error) throw error;
    let count = 0;
    for (const row of rows ?? []) {
      if (!isCombatV2Snapshot(row.combatants)) continue;
      if (encounters.has(row.channel_id)) continue;
      const combatants = Array.isArray(row.combatants) ? row.combatants.map(makeCombatant) : [];
      encounters.set(row.channel_id, {
        version: 2,
        id: row.channel_id,
        channelId: row.channel_id,
        guildId: row.discord_guild_id,
        gmId: row.gm_discord_id ?? null,
        name: `Combat in #${row.channel_id}`,
        round: row.round ?? 1,
        turnIndex: Math.max(0, Math.min(row.turn_index ?? 0, Math.max(0, combatants.length - 1))),
        summaryMessageId: null,
        supabaseId: row.id,
        createdAt: row.created_at ?? nowIso(),
        updatedAt: row.updated_at ?? nowIso(),
        combatants,
        log: [],
      });
      count++;
    }
    if (count > 0) console.log(`[Supabase] Restored ${count} active combat v2 encounter(s) from Supabase`);
    return count;
  } catch (err) {
    console.error('[Supabase] combat v2 encounter restore failed:', err.message);
    return 0;
  }
}

module.exports = {
  slug,
  isCombatV2Snapshot,
  createEncounter,
  getEncounter,
  endEncounter,
  addCombatant,
  removeCombatant,
  findCombatant,
  currentCombatant,
  advanceTurn,
  rollRecoveryCheck,
  rerollRecoveryCheck,
  stabilizeWithHeroPoints,
  setDying,
  delayCombatant,
  rejoinCombatant,
  applyHp,
  setTempHp,
  addEffect,
  removeEffect,
  modifyCombatant,
  sortCombatants,
  tickPersistentDamage,
  processTurnTransition,
  restoreEncountersFromSupabase,
};
