// encounters.js
// In-memory encounter store, keyed by channelId.
// Each encounter = { combatants: [], turnIndex: 0, round: 1, gmId, guildId, summaryMessageId,
//                    supabaseId (set after first Supabase sync) }
// Each combatant = { name, initiative, hp, maxHp, ac, ownerId, isNpc, effects: [] }
// Each effect = { name, value, duration, modifiers: {...}, isPreset, presetKey, appliedBy }

const { syncEncounterToSupabase, endEncounterInSupabase, getSupabase } = require('../utils/storage');

const encounters = new Map();

function isCombatV2Snapshot(combatants) {
  if (!Array.isArray(combatants) || combatants.length === 0) return true;
  return combatants.some(c => c && (
    c.type != null
    || c.sourceKey != null
    || c.attacksThisTurn != null
    || c.reactionUsed != null
    || Array.isArray(c.attacks)
    || Array.isArray(c.spells)
    || c.resistances != null
    || c.weaknesses != null
  ));
}

function getEncounter(channelId) {
  return encounters.get(channelId) || null;
}

function createEncounter(channelId, gmId, guildId = null) {
  const encounter = {
    combatants: [],
    turnIndex: 0,
    round: 1,
    gmId,
    guildId,
    summaryMessageId: null,
    supabaseId: null,
  };
  encounters.set(channelId, encounter);
  syncEncounterToSupabase(channelId, encounter);
  return encounter;
}

function deleteEncounter(channelId) {
  const enc = encounters.get(channelId);
  if (enc) endEncounterInSupabase(enc);
  encounters.delete(channelId);
}

function addCombatant(channelId, combatant) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  // Ensure every combatant has an effects array
  if (!combatant.effects) combatant.effects = [];
  enc.combatants.push(combatant);
  enc.combatants.sort((a, b) => {
    // Primary: higher initiative first
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    // PF2e RAW (Player Core p. 469): "When PCs and NPCs end up with the same
    // initiative, the NPCs go first." NPCs sort before PCs on ties.
    if (a.isNpc !== b.isNpc) return a.isNpc ? -1 : 1;
    // Stable secondary tiebreakers when both are PCs or both are NPCs:
    // higher max HP, then alphabetical. Players (or GM) can manually reorder
    // in play; this is just a deterministic default.
    if (b.maxHp !== a.maxHp) return b.maxHp - a.maxHp;
    return a.name.localeCompare(b.name);
  });
  syncEncounterToSupabase(channelId, enc);
  return enc;
}

function removeCombatant(channelId, name) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  const idx = enc.combatants.findIndex(
    c => c.name.toLowerCase() === name.toLowerCase()
  );
  if (idx === -1) return null;
  if (idx < enc.turnIndex) enc.turnIndex--;
  enc.combatants.splice(idx, 1);
  if (enc.turnIndex >= enc.combatants.length) enc.turnIndex = 0;
  syncEncounterToSupabase(channelId, enc);
  return enc;
}

// Advance the turn. Tick down effects on the NEW current combatant (start-of-turn timing).
// Skips combatants who have set themselves aside via Delay (delayed: true).
// Returns { enc, current, expiredEffects } where expiredEffects is an array of effects that just ended.
function advanceTurn(channelId) {
  const enc = encounters.get(channelId);
  if (!enc || enc.combatants.length === 0) return null;

  const expiredEffects = [];
  // Loop until we land on a non-delayed combatant. Safety cap: try once per
  // combatant; if everyone's delayed (shouldn't happen), just return current.
  let safety = enc.combatants.length + 1;
  while (safety-- > 0) {
    enc.turnIndex++;
    if (enc.turnIndex >= enc.combatants.length) {
      enc.turnIndex = 0;
      enc.round++;
    }
    const current = enc.combatants[enc.turnIndex];
    if (!current) break;

    if (current.delayed) {
      // Skip this combatant — they've set themselves aside.
      continue;
    }

    // Tick down effects on the current combatant (their turn is starting)
    if (current.effects && current.effects.length > 0) {
      current.effects = current.effects.filter(effect => {
        if (effect.duration === null || effect.duration === undefined) return true;
        effect.duration -= 1;
        if (effect.duration <= 0) {
          expiredEffects.push({ combatantName: current.name, effect });
          return false;
        }
        return true;
      });
    }

    syncEncounterToSupabase(channelId, enc);
    return { enc, current, expiredEffects };
  }
  // All combatants delayed; return current with no advance (defensive)
  syncEncounterToSupabase(channelId, enc);
  return { enc, current: enc.combatants[enc.turnIndex], expiredEffects };
}

function modifyHp(channelId, name, delta) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  const c = enc.combatants.find(
    c => c.name.toLowerCase() === name.toLowerCase()
  );
  if (!c) return null;
  c.hp = Math.max(0, Math.min(c.maxHp, c.hp + delta));
  syncEncounterToSupabase(channelId, enc);
  return c;
}

function setSummaryMessageId(channelId, messageId) {
  const enc = encounters.get(channelId);
  if (!enc) return;
  enc.summaryMessageId = messageId;
}

// ── Effect helpers ────────────────────────────────────────────────────────

// Find a combatant in an encounter (case-insensitive match)
function findCombatant(enc, name) {
  if (!enc || !name) return null;
  return enc.combatants.find(c => c.name.toLowerCase() === name.toLowerCase()) || null;
}

// Add an effect to a combatant. If an effect with the same name already exists,
// replaces it (new version overrides old). Returns { combatant, effect, replaced }.
function addEffect(channelId, combatantName, effect) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  const combatant = findCombatant(enc, combatantName);
  if (!combatant) return null;
  if (!combatant.effects) combatant.effects = [];

  // Check for existing effect with same name
  const existingIdx = combatant.effects.findIndex(
    e => e.name.toLowerCase() === effect.name.toLowerCase()
  );
  let replaced = false;
  if (existingIdx >= 0) {
    combatant.effects.splice(existingIdx, 1);
    replaced = true;
  }
  combatant.effects.push(effect);
  syncEncounterToSupabase(channelId, enc);
  return { combatant, effect, replaced };
}

// Remove an effect from a combatant by effect name. Returns the removed effect or null.
function removeEffect(channelId, combatantName, effectName) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  const combatant = findCombatant(enc, combatantName);
  if (!combatant || !combatant.effects) return null;
  const idx = combatant.effects.findIndex(
    e => e.name.toLowerCase() === effectName.toLowerCase()
  );
  if (idx === -1) return null;
  const [removed] = combatant.effects.splice(idx, 1);
  syncEncounterToSupabase(channelId, enc);
  return { combatant, effect: removed };
}

// Remove ALL effects from a combatant. Returns count removed.
function clearEffects(channelId, combatantName) {
  const enc = encounters.get(channelId);
  if (!enc) return 0;
  const combatant = findCombatant(enc, combatantName);
  if (!combatant || !combatant.effects) return 0;
  const count = combatant.effects.length;
  combatant.effects = [];
  return count;
}

// ── Delay / Rejoin (PF2e action: Delay) ──────────────────────────────────
// Per Player Core p. 469: when it's your turn, you may take the Delay action.
// Your turn ends, you're set aside, and you can choose to take your turn at
// any point before the start of your next normal turn. When you do, your new
// initiative is whatever you choose (usually right before or right after some
// other combatant's turn).
//
// Implementation:
//   delayCombatant(channelId): the current combatant declares Delay.
//     Sets `delayed: true`, advances turn (skipping them in normal rotation).
//   rejoinFromDelay(channelId, name, beforeName): combatant re-enters before
//     the named target (or at the bottom of the round if no target).

function delayCombatant(channelId) {
  const enc = encounters.get(channelId);
  if (!enc || enc.combatants.length === 0) return null;
  const current = enc.combatants[enc.turnIndex];
  if (!current) return null;
  current.delayed = true;
  // Stash original initiative so we can restore it if needed
  current.initiativeBeforeDelay = current.initiative;
  // Advance to next combatant. advanceTurn now skips delayed combatants
  // automatically, so we can just delegate to it.
  return advanceTurn(channelId);
}

function rejoinFromDelay(channelId, combatantName, beforeName = null) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  const c = findCombatant(enc, combatantName);
  if (!c || !c.delayed) return { ok: false, reason: 'not-delayed' };

  // Compute the new initiative value. If beforeName is given, we set this
  // combatant's initiative to (before's initiative + 0.001) so they go just
  // before the named combatant. If not given, we put them at the start of the
  // CURRENT combatant's slot (i.e., they act now, before the current turn
  // continues).
  let newInit;
  if (beforeName) {
    const before = findCombatant(enc, beforeName);
    if (!before) return { ok: false, reason: 'before-not-found' };
    newInit = before.initiative + 0.001;
  } else {
    const cur = enc.combatants[enc.turnIndex];
    newInit = cur ? cur.initiative + 0.001 : 0;
  }

  c.delayed = false;
  c.initiative = newInit;
  delete c.initiativeBeforeDelay;

  // Re-sort the combatants array. We need to find the rejoiner's new index
  // and set turnIndex to it (since they're acting NOW).
  const sortedNames = enc.combatants.map(x => x.name);
  enc.combatants.sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    if (a.isNpc !== b.isNpc) return a.isNpc ? -1 : 1;
    if (b.maxHp !== a.maxHp) return b.maxHp - a.maxHp;
    return a.name.localeCompare(b.name);
  });
  // Update turnIndex to point at the rejoiner
  enc.turnIndex = enc.combatants.findIndex(x => x.name === combatantName);
  return { ok: true, combatant: c, newInit };
}

// Helper: advance turn while skipping any delayed combatants.
// (Currently unused — advanceTurn() handles this directly. Kept here as a
// reference and in case we want to expose it separately later.)
function _advancePastDelayed(enc) {
  // Delegates to advanceTurn via channelId lookup
  let channelId = null;
  for (const [k, v] of encounters.entries()) {
    if (v === enc) { channelId = k; break; }
  }
  return channelId ? advanceTurn(channelId) : null;
}

// On bot startup, reload any encounters that were active when the process last
// stopped. This prevents combat from evaporating on Railway redeploys.
// summaryMessageId can't be recovered (Discord messages aren't stored in
// Supabase), so the pinned summary won't auto-update after recovery — but
// all HP, turn order, and effects are fully restored.
async function restoreEncountersFromSupabase() {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { data: rows, error } = await sb
      .from('encounters')
      .select('*')
      .eq('status', 'active');
    if (error) throw error;
    if (!rows || rows.length === 0) return;
    let count = 0;
    for (const row of rows) {
      if (isCombatV2Snapshot(row.combatants)) continue;
      if (encounters.has(row.channel_id)) continue; // already in memory
      encounters.set(row.channel_id, {
        combatants:       row.combatants ?? [],
        turnIndex:        row.turn_index ?? 0,
        round:            row.round ?? 1,
        gmId:             row.gm_discord_id ?? null,
        guildId:          row.discord_guild_id,
        summaryMessageId: null,
        supabaseId:       row.id,
      });
      count++;
    }
    if (count > 0) console.log(`[Supabase] Restored ${count} active encounter(s) from Supabase`);
  } catch (err) {
    console.error('[Supabase] encounter restore failed:', err.message);
  }
}

module.exports = {
  getEncounter,
  createEncounter,
  deleteEncounter,
  addCombatant,
  removeCombatant,
  advanceTurn,
  modifyHp,
  setSummaryMessageId,
  findCombatant,
  addEffect,
  removeEffect,
  clearEffects,
  delayCombatant,
  rejoinFromDelay,
  restoreEncountersFromSupabase,
};
