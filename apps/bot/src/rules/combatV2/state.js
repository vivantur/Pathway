// systems/combatV2/state.js
// Combat v2 encounter store: owns the in-memory Map and every Supabase write.
//
// The PURE combat rules now live in ./model.js. This file is the stateful shell
// around them: it resolves a channelId to an encounter, delegates the rules work
// to the model, and persists the result. Anything here that does not touch the
// Map or Supabase belongs in the model instead.

const { syncEncounterToSupabase, endEncounterInSupabase, getSupabase } = require('../../lib/storage');
const model = require('./model');

// Only what this file still references directly — for its own logic (nowIso,
// makeCombatant, isCombatV2Snapshot in the restore path) or to re-export
// verbatim (slug, findCombatant, currentCombatant), so the 13 consumers keep
// their existing import surface.
const {
  slug,
  nowIso,
  isCombatV2Snapshot,
  makeCombatant, // used bare as `.map(makeCombatant)` in the restore path
  findCombatant,
  currentCombatant,
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

// ── Persistent damage & the turn pipeline ────────────────────────────────────

/** `[]` (and no write) when there is nothing to tick. */
function tickPersistentDamage(channelId, query) {
  const encounter = getEncounter(channelId);
  if (!encounter) return [];
  const results = model.tickPersistentDamage(encounter, query);
  if (results.length) touchEncounter(encounter);
  return results;
}

/** null (and no write) when the encounter is empty. */
function processTurnTransition(channelId, direction = 1) {
  const encounter = getEncounter(channelId);
  if (!encounter) return null;
  const result = model.processTurnTransition(encounter, direction);
  if (result) touchEncounter(encounter);
  return result;
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
