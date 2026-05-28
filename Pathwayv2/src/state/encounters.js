// ── state/encounters.js ──────────────────────────────────────────────────────
// Combat encounter snapshots + per-event log (the /encounter command suite).
//
// An encounter has a Supabase UUID stored on `enc.supabaseId` after first
// sync; subsequent writes update in place. Events are append-only inserts
// into encounter_events keyed by encounter_id.
//
// Note: there is already a commands/encounters.js (currently in src/commands/)
// that holds the in-memory encounter map and command handlers. That module
// is the in-memory state owner; THIS module is the persistence layer.
// They are separate by design until Phase 2 unifies them.

const { getSupabase } = require('../lib/supabase');
const { _recordSyncSuccess, _recordSyncFailure } = require('../lib/syncTracker');

// Upsert the full encounter snapshot. Called after every state mutation so
// the web combat tracker stays current. Stores the encounter's Supabase UUID
// on enc.supabaseId so event logging can reference it without another lookup.
async function syncEncounterToSupabase(channelId, enc) {
  try {
    const sb = getSupabase();
    if (!sb || !enc || !enc.guildId) return;

    const payload = {
      discord_guild_id: enc.guildId,
      channel_id:       channelId,
      gm_discord_id:    enc.gmId ?? null,
      status:           'active',
      round:            enc.round,
      turn_index:       enc.turnIndex,
      combatants:       enc.combatants,
    };

    if (enc.supabaseId) {
      // Already created — update in place.
      const { error } = await sb
        .from('encounters')
        .update(payload)
        .eq('id', enc.supabaseId);
      if (error) throw error;
    } else {
      // First sync for this encounter — insert and store the UUID.
      const { data, error } = await sb
        .from('encounters')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      enc.supabaseId = data.id;
    }
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] encounter sync failed:', err.message);
  }
}

// Mark an active encounter as ended.
async function endEncounterInSupabase(enc) {
  try {
    const sb = getSupabase();
    if (!sb || !enc?.supabaseId) return;
    const { error } = await sb
      .from('encounters')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', enc.supabaseId);
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] encounter end failed:', err.message);
  }
}

// Insert one event row for the session history log.
// eventType: 'initiative_start' | 'initiative_end' | 'attack' | 'damage' |
//            'heal' | 'death' | 'recovery' | 'effect_add' | 'effect_expire' | 'xp_award'
// actor / target: combatant names (strings or null)
// data: any extra payload (plain object)
async function logEncounterEvent(enc, eventType, { actor = null, target = null, round = null, data = {} } = {}) {
  try {
    const sb = getSupabase();
    if (!sb || !enc?.supabaseId) return;
    const { error } = await sb.from('encounter_events').insert({
      encounter_id: enc.supabaseId,
      event_type:   eventType,
      actor,
      target,
      round:        round ?? enc.round ?? null,
      data,
    });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] event log failed:', err.message);
  }
}

module.exports = {
  syncEncounterToSupabase,
  endEncounterInSupabase,
  logEncounterEvent,
};
