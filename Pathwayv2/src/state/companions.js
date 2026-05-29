// ── state/companions.js ──────────────────────────────────────────────────────
// Animal companions, eidolons, familiars (the /companion command suite).
//
// Companions live in the dedicated `companions` table, keyed by
// (user_id, char_key, comp_key). In the bot's in-memory cache however
// they are NESTED inside each character entry:
//
//   characters[discordId][charKey].companions[compKey] = { ... }
//   characters[discordId][charKey].activeCompanion     = compKey
//
// Phase 2: this module adds Realtime — but unlike the other state modules,
// it does NOT own its own cache. Instead, subscribe() takes a getter for
// the shared characters cache (still owned by index.js as of this phase)
// and patches the nested companions in-place when events arrive.
//
// This pragmatic choice avoids forcing every /companion handler in
// index.js to switch from `charEntry.companions` reads to a separate cache
// lookup. The wins are still real: web-app additions/removals propagate
// to the bot's in-memory state without a restart.
//
// Phase 2-characters will absorb this module's Realtime concern, since
// at that point the characters cache will be inside state/characters.

const { getSupabase } = require('../lib/supabase');

// ── Realtime plumbing ──────────────────────────────────────────────────────
let _userIdToDiscordId = null;
let _ready = false;
const _pendingEvents = [];

// Called by the bootstrap (lib/storage.js's restoreAllFromSupabase) right
// after the user map is built. Drains any events that arrived between
// subscribe() and the attach.
function attachUserMap(bySupabaseId) {
  _userIdToDiscordId = bySupabaseId ?? {};
  _ready = true;
  if (_pendingEvents.length) {
    console.log(`[state/companions:realtime] draining ${_pendingEvents.length} queued event(s) after attach`);
    for (const apply of _pendingEvents) apply();
    _pendingEvents.length = 0;
  }
}

// Subscribe to Supabase Realtime postgres_changes on `companions`.
// `getCharactersCache` is a getter that returns the live charactersCache
// reference (since the cache is reassigned at clientReady, we can't capture
// a stable reference — must look it up each event).
function subscribe(sb, getCharactersCache) {
  if (!sb) {
    console.warn('[state/companions:realtime] Supabase not available — live sync disabled');
    return;
  }
  if (typeof getCharactersCache !== 'function') {
    console.warn('[state/companions:realtime] getCharactersCache must be a function — live sync disabled');
    return;
  }

  sb.channel('state-companions')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'companions',
    }, (payload) => {
      const apply = () => _applyEvent(payload, getCharactersCache());
      if (_ready) apply();
      else _pendingEvents.push(apply);
    })
    .subscribe((status, err) => {
      if (err) console.error('[state/companions:realtime] subscription error:', err.message);
      else console.log(`[state/companions:realtime] ${status}`);
    });
}

function _applyEvent(payload, charactersCache) {
  try {
    if (!charactersCache) return;

    const event = payload.eventType ?? payload.type;
    const row = event === 'DELETE' ? payload.old : payload.new;
    if (!row) return;

    const discordId = _userIdToDiscordId?.[row.user_id];
    if (!discordId || !row.char_key || !row.comp_key) return;

    const charEntry = charactersCache[discordId]?.[row.char_key];
    if (!charEntry) {
      // Character not loaded — likely a companion for a character the bot
      // hasn't seen yet. The next restore (or `/sync`) will pick it up.
      return;
    }

    if (event === 'DELETE') {
      if (charEntry.companions) {
        delete charEntry.companions[row.comp_key];
        if (Object.keys(charEntry.companions).length === 0) delete charEntry.companions;
      }
      if (charEntry.activeCompanion === row.comp_key) delete charEntry.activeCompanion;
      console.log(`[state/companions:realtime] - ${discordId}:${row.char_key}:${row.comp_key}`);
      return;
    }

    // INSERT or UPDATE — splice in/replace.
    if (!charEntry.companions) charEntry.companions = {};
    const cs = row.custom_stats ?? {};
    charEntry.companions[row.comp_key] = {
      displayName:     row.display_name,
      baseType:        row.base_type,
      form:            row.form ?? 'young',
      notes:           row.notes ?? '',
      currentHp:       row.current_hp ?? null,
      customStats:     cs.customStats     ?? null,
      art:             cs.art             ?? null,
      skills:          cs.skills          ?? null,
      customAbilities: cs.customAbilities ?? null,
      customAttacks:   cs.customAttacks   ?? null,
      overrides:       cs.overrides       ?? null,
    };
    if (row.is_active) charEntry.activeCompanion = row.comp_key;
    else if (charEntry.activeCompanion === row.comp_key) delete charEntry.activeCompanion;
    console.log(`[state/companions:realtime] ${event === 'INSERT' ? '+' : '~'} ${discordId}:${row.char_key}:${row.comp_key}`);
  } catch (e) {
    console.error('[state/companions:realtime] handler error:', e.message);
  }
}

// ── Phase 1 sync helpers (unchanged from Phase 1) ──────────────────────────

async function syncCompanionToSupabase(discordId, charKey, compKey, comp, isActive) {
  try {
    const sb = getSupabase();
    if (!sb) return;

    const { data: userRow } = await sb
      .from('users')
      .select('id')
      .eq('discord_id', discordId)
      .maybeSingle();
    if (!userRow) return;

    const { error } = await sb.from('companions').upsert({
      user_id:      userRow.id,
      char_key:     charKey,
      comp_key:     compKey,
      display_name: comp.displayName ?? compKey,
      base_type:    comp.baseType ?? comp.type ?? 'unknown',
      form:         comp.form ?? 'young',
      notes:        comp.notes ?? '',
      current_hp:   comp.currentHp ?? comp.hp ?? null,
      is_active:    !!isActive,
      custom_stats: {
        customStats:     comp.customStats     ?? null,
        art:             comp.art             ?? null,
        skills:          comp.skills          ?? null,
        customAbilities: comp.customAbilities ?? null,
        customAttacks:   comp.customAttacks   ?? null,
        overrides:       comp.overrides       ?? null,
      },
    }, { onConflict: 'user_id,char_key,comp_key' });

    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] companion sync failed:', err.message);
  }
}

async function deleteCompanionFromSupabase(discordId, charKey, compKey) {
  try {
    const sb = getSupabase();
    if (!sb) return;

    const { data: userRow } = await sb
      .from('users')
      .select('id')
      .eq('discord_id', discordId)
      .maybeSingle();
    if (!userRow) return;

    const { error } = await sb.from('companions')
      .delete()
      .eq('user_id', userRow.id)
      .eq('char_key', charKey)
      .eq('comp_key', compKey);

    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] companion delete failed:', err.message);
  }
}

async function syncAllCompanionsToSupabase(characters) {
  try {
    const sb = getSupabase();
    if (!sb) return;

    const discordIds = Object.keys(characters).filter(k => /^\d+$/.test(k));
    if (discordIds.length === 0) return;

    const { data: userRows } = await sb
      .from('users')
      .select('id, discord_id')
      .in('discord_id', discordIds);
    if (!userRows || userRows.length === 0) return;

    const userMap = Object.fromEntries(userRows.map(u => [u.discord_id, u.id]));

    const upserts = [];
    for (const [discordId, userChars] of Object.entries(characters)) {
      const userId = userMap[discordId];
      if (!userId) continue;
      for (const [charKey, charEntry] of Object.entries(userChars)) {
        if (charKey.startsWith('_') || !charEntry?.companions) continue;
        for (const [compKey, comp] of Object.entries(charEntry.companions)) {
          if (!comp?.displayName) continue;
          upserts.push({
            user_id:      userId,
            char_key:     charKey,
            comp_key:     compKey,
            display_name: comp.displayName,
            base_type:    comp.baseType ?? comp.type ?? 'unknown',
            form:         comp.form ?? 'young',
            notes:        comp.notes ?? '',
            current_hp:   comp.currentHp ?? comp.hp ?? null,
            is_active:    charEntry.activeCompanion === compKey,
            custom_stats: {
              customStats:     comp.customStats     ?? null,
              art:             comp.art             ?? null,
              skills:          comp.skills          ?? null,
              customAbilities: comp.customAbilities ?? null,
              customAttacks:   comp.customAttacks   ?? null,
              overrides:       comp.overrides       ?? null,
            },
          });
        }
      }
    }

    if (upserts.length === 0) return;
    const { error } = await sb.from('companions')
      .upsert(upserts, { onConflict: 'user_id,char_key,comp_key' });
    if (error) throw error;
    console.log(`[Supabase] companion backfill: upserted ${upserts.length} companions`);
  } catch (err) {
    console.error('[Supabase] companion backfill failed:', err.message);
  }
}

module.exports = {
  // Phase 2 surface
  subscribe,
  attachUserMap,

  // Phase 1 surface (unchanged)
  syncCompanionToSupabase,
  deleteCompanionFromSupabase,
  syncAllCompanionsToSupabase,
};
