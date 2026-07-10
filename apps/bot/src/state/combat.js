// ── state/combat.js ──────────────────────────────────────────────────────────
// The combat v2 encounter store: owns the in-memory Map and every Supabase write.
//
// It lives in state/ per the decision tree in this app's CLAUDE.md — "does it
// mutate cached state? → state/". The PF2e combat RULES are in
// rules/combatV2/model.js, which is pure and knows nothing about storage. This
// file resolves a channelId to an encounter, hands it to the model, and persists
// the result exactly once.
//
// If you are adding combat logic: it belongs in the model unless it touches the
// Map or Supabase.
//
// Persistence helpers come straight from state/encounters.js. They used to be
// reached through a re-export in lib/storage.js; nothing else consumed that
// re-export, so the indirection is gone.

const model = require('../rules/combatV2/model');
const { syncEncounterToSupabase, endEncounterInSupabase } = require('./encounters');
const { getSupabase } = require('../lib/supabase');

// Re-exported verbatim so consumers keep one import surface for combat.
const {
  slug,
  nowIso,
  isCombatV2Snapshot,
  encounterFromRow,
  findCombatant,
  currentCombatant,
} = model;

const encounters = new Map();

// ── The store ────────────────────────────────────────────────────────────────

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

/** Sort (model) then persist. Channel-free: callers already hold the encounter. */
function sortCombatants(encounter) {
  model.sortCombatants(encounter);
  return touchEncounter(encounter);
}

// ── Combatants ───────────────────────────────────────────────────────────────

function addCombatant(channelId, input) {
  return mutate(channelId, enc => model.addCombatant(enc, input));
}

function removeCombatant(channelId, query) {
  return mutate(channelId, enc => model.removeCombatant(enc, query));
}

function setTempHp(channelId, query, amount) {
  return mutate(channelId, enc => model.setTempHp(enc, query, amount));
}

function modifyCombatant(channelId, query, patch) {
  return mutate(channelId, enc => model.modifyCombatant(enc, query, patch));
}

// ── HP, dying, recovery ──────────────────────────────────────────────────────
// These wrappers differ only in WHEN they persist, which is not uniform.

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

// Returns null instead of throwing when the channel has no encounter, and
// persists nothing when the encounter is empty.
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

// ── Effects ──────────────────────────────────────────────────────────────────

function addEffect(channelId, query, effect) {
  return mutate(channelId, enc => model.addEffect(enc, query, effect));
}

function removeEffect(channelId, query, effectName) {
  return mutate(channelId, enc => model.removeEffect(enc, query, effectName));
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

// ── Restore ──────────────────────────────────────────────────────────────────

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
      encounters.set(row.channel_id, encounterFromRow(row));
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
