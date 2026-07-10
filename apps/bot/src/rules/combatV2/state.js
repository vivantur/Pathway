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

// ── HP, dying, recovery ──────────────────────────────────────────────────────
// The rules live in model.js. These wrappers differ only in when they persist,
// which is not uniform: rollRecoveryCheck writes nothing when the combatant is
// not dying, and stabilizeWithHeroPoints writes nothing when it declines.

function applyHp(channelId, query, amount, options = {}) {
  return mutate(channelId, enc => model.applyHp(enc, query, amount, options));
}

function setDying(channelId, query, value) {
  return mutate(channelId, enc => model.setDying(enc, query, value));
}

/** null (and no write) when the combatant is not dying. */
function rollRecoveryCheck(channelId, query) {
  const encounter = requireEncounter(channelId);
  const result = model.rollRecoveryCheck(encounter, query);
  if (result) touchEncounter(encounter);
  return result;
}

/** null (and no write) when there's no encounter, combatant, or prior result. */
function rerollRecoveryCheck(channelId, query, originalResult) {
  const encounter = getEncounter(channelId);
  if (!encounter) return null;
  const result = model.rerollRecoveryCheck(encounter, query, originalResult);
  if (result) touchEncounter(encounter);
  return result;
}

/** null when absent; `{ ok: false }` (and no write) when not dying. */
function stabilizeWithHeroPoints(channelId, query) {
  const encounter = getEncounter(channelId);
  if (!encounter) return null;
  const result = model.stabilizeWithHeroPoints(encounter, query);
  if (result?.ok) touchEncounter(encounter);
  return result;
}

// ── Turn flow ────────────────────────────────────────────────────────────────

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
