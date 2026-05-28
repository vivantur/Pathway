// ── state/snippets.js ────────────────────────────────────────────────────────
// Two related tables — user snippets and guild snippets — managed together
// because they share semantics (a name → string map keyed by either a user
// or a guild) and the index.js call sites usually touch both.
//
// Phase 2: this module owns both caches + Realtime subscriptions.
//
// User cache shape:  { [discordId]: { [name]: snippetContent } }
// Guild cache shape: { [guildId]:   { [name]: snippetContent } }

const { getSupabase } = require('../lib/supabase');
const { _recordSyncSuccess, _recordSyncFailure } = require('../lib/syncTracker');
const { buildDiscordToUserMap } = require('../lib/userMap');

// ── User snippet cache ─────────────────────────────────────────────────────
let _userCache = null;
let _userReady = false;
const _userPending = [];
let _userIdToDiscordId = {};
const _userRowUpdatedAt = Object.create(null); // keyed by discordId

function _ensureUserCache() {
  if (_userCache === null) _userCache = {};
  return _userCache;
}

// ── Guild snippet cache ────────────────────────────────────────────────────
let _guildCache = null;
let _guildReady = false;
const _guildPending = [];
const _guildRowUpdatedAt = Object.create(null); // keyed by guildId

function _ensureGuildCache() {
  if (_guildCache === null) _guildCache = {};
  return _guildCache;
}

// ── Accessors ──────────────────────────────────────────────────────────────

function getAllUser()  { return _ensureUserCache(); }
function getAllGuild() { return _ensureGuildCache(); }

function getUser(discordId)  { return _ensureUserCache()[discordId]  ?? null; }
function getGuild(guildId)   { return _ensureGuildCache()[guildId]   ?? null; }

// ── Writes ─────────────────────────────────────────────────────────────────

async function saveUser(discordId, snippets) {
  _ensureUserCache()[discordId] = snippets ?? {};
  await syncUserSnippetsToSupabase(discordId, snippets);
}

async function saveGuild(guildId, snippets) {
  _ensureGuildCache()[guildId] = snippets ?? {};
  await syncGuildSnippetsToSupabase(guildId, snippets);
}

// Bulk wrappers — mirror the legacy saveSnippets(map) / saveServerSnippets(map)
// shape so index.js delegation stays trivial.
async function saveAllUser(map) {
  _userCache = map || {};
  await syncAllUserSnippetsToSupabase(_userCache);
}

async function saveAllGuild(map) {
  _guildCache = map || {};
  await syncAllGuildSnippetsToSupabase(_guildCache);
}

// ── Subscribe (Realtime — call BEFORE restore) ─────────────────────────────

function subscribe(sb) {
  if (!sb) {
    console.warn('[state/snippets:realtime] Supabase not available — live sync disabled');
    return;
  }

  sb.channel('state-user-snippets')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'user_snippets',
    }, (payload) => {
      const apply = () => _applyUserEvent(payload);
      if (_userReady) apply();
      else _userPending.push(apply);
    })
    .subscribe((status, err) => {
      if (err) console.error('[state/snippets:realtime user] subscription error:', err.message);
      else console.log(`[state/snippets:realtime user] ${status}`);
    });

  sb.channel('state-guild-snippets')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'guild_snippets',
    }, (payload) => {
      const apply = () => _applyGuildEvent(payload);
      if (_guildReady) apply();
      else _guildPending.push(apply);
    })
    .subscribe((status, err) => {
      if (err) console.error('[state/snippets:realtime guild] subscription error:', err.message);
      else console.log(`[state/snippets:realtime guild] ${status}`);
    });
}

function _applyUserEvent(payload) {
  try {
    const event = payload.eventType ?? payload.type;
    const cache = _ensureUserCache();

    if (event === 'DELETE') {
      const row = payload.old;
      const discordId = _userIdToDiscordId[row.user_id];
      if (!discordId) return;
      delete cache[discordId];
      delete _userRowUpdatedAt[discordId];
      console.log(`[state/snippets:realtime user] - ${discordId}`);
      return;
    }

    const row = payload.new;
    const discordId = _userIdToDiscordId[row.user_id];
    if (!discordId) return;
    if (_userRowUpdatedAt[discordId] && row.updated_at && row.updated_at <= _userRowUpdatedAt[discordId]) return;
    cache[discordId] = row.snippets ?? {};
    _userRowUpdatedAt[discordId] = row.updated_at ?? null;
    console.log(`[state/snippets:realtime user] ${event === 'INSERT' ? '+' : '~'} ${discordId}`);
  } catch (e) {
    console.error('[state/snippets:realtime user] handler error:', e.message);
  }
}

function _applyGuildEvent(payload) {
  try {
    const event = payload.eventType ?? payload.type;
    const cache = _ensureGuildCache();

    if (event === 'DELETE') {
      const row = payload.old;
      if (!row.discord_guild_id) return;
      delete cache[row.discord_guild_id];
      delete _guildRowUpdatedAt[row.discord_guild_id];
      console.log(`[state/snippets:realtime guild] - ${row.discord_guild_id}`);
      return;
    }

    const row = payload.new;
    if (!row.discord_guild_id) return;
    if (_guildRowUpdatedAt[row.discord_guild_id] && row.updated_at && row.updated_at <= _guildRowUpdatedAt[row.discord_guild_id]) return;
    cache[row.discord_guild_id] = row.snippets ?? {};
    _guildRowUpdatedAt[row.discord_guild_id] = row.updated_at ?? null;
    console.log(`[state/snippets:realtime guild] ${event === 'INSERT' ? '+' : '~'} ${row.discord_guild_id}`);
  } catch (e) {
    console.error('[state/snippets:realtime guild] handler error:', e.message);
  }
}

// ── Restore ────────────────────────────────────────────────────────────────

async function restore(sb, { bySupabaseId, byDiscordId }, { diskUserSnippets = {}, diskGuildSnippets = {} } = {}) {
  const userMap = await _restoreUser(sb, bySupabaseId, byDiscordId, diskUserSnippets);
  const guildMap = await _restoreGuild(sb, diskGuildSnippets);
  return { user: userMap, guild: guildMap };
}

async function _restoreUser(sb, bySupabaseId, byDiscordId, diskUserSnippets) {
  if (!sb) {
    _userReady = true;
    _drainUserPending();
    return _ensureUserCache();
  }

  const { data: rows, error } = await sb
    .from('user_snippets')
    .select('user_id, snippets, updated_at');
  if (error) throw error;

  _userIdToDiscordId = { ...bySupabaseId };

  const cache = _ensureUserCache();
  Object.assign(cache, diskUserSnippets);

  const inSupabase = new Set();
  for (const row of rows ?? []) {
    const discordId = bySupabaseId[row.user_id];
    if (!discordId || !row.snippets) continue;
    inSupabase.add(discordId);
    cache[discordId] = row.snippets;
    _userRowUpdatedAt[discordId] = row.updated_at ?? null;
  }

  // Backfill disk-only entries.
  let backfilled = 0;
  for (const [discordId, snips] of Object.entries(diskUserSnippets)) {
    if (inSupabase.has(discordId) || !snips || Object.keys(snips).length === 0) continue;
    const userId = byDiscordId[discordId];
    if (!userId) continue;
    const { error: uErr } = await sb.from('user_snippets').upsert({
      user_id:  userId,
      snippets: snips,
    }, { onConflict: 'user_id' });
    if (uErr) console.error(`[Supabase] snippet backfill failed for ${discordId}:`, uErr.message);
    else backfilled++;
  }

  _userReady = true;
  _drainUserPending();
  console.log(`[Supabase] restore: loaded ${rows?.length ?? 0} user snippet sets (backfilled ${backfilled} new)`);
  return cache;
}

async function _restoreGuild(sb, diskGuildSnippets) {
  if (!sb) {
    _guildReady = true;
    _drainGuildPending();
    return _ensureGuildCache();
  }

  const { data: rows, error } = await sb
    .from('guild_snippets')
    .select('discord_guild_id, snippets, updated_at');
  if (error) throw error;

  const cache = _ensureGuildCache();
  Object.assign(cache, diskGuildSnippets);

  for (const row of rows ?? []) {
    if (!row.discord_guild_id || !row.snippets) continue;
    cache[row.discord_guild_id] = row.snippets;
    _guildRowUpdatedAt[row.discord_guild_id] = row.updated_at ?? null;
  }

  _guildReady = true;
  _drainGuildPending();
  console.log(`[Supabase] restore: loaded ${rows?.length ?? 0} guild snippet sets`);
  return cache;
}

function _drainUserPending() {
  if (_userPending.length === 0) return;
  console.log(`[state/snippets:realtime user] draining ${_userPending.length} queued event(s) after restore`);
  for (const apply of _userPending) apply();
  _userPending.length = 0;
}

function _drainGuildPending() {
  if (_guildPending.length === 0) return;
  console.log(`[state/snippets:realtime guild] draining ${_guildPending.length} queued event(s) after restore`);
  for (const apply of _guildPending) apply();
  _guildPending.length = 0;
}

// ── Phase 1 sync helpers (kept for legacy callers + storage barrel) ────────

async function syncUserSnippetsToSupabase(discordId, snippets) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { data: userRow } = await sb.from('users').select('id').eq('discord_id', discordId).single();
    if (!userRow) return;
    const { error } = await sb.from('user_snippets').upsert({
      user_id:  userRow.id,
      snippets: snippets ?? {},
    }, { onConflict: 'user_id' });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] user snippets sync failed:', err.message);
  }
}

async function syncAllUserSnippetsToSupabase(snippets) {
  try {
    const sb = getSupabase();
    if (!sb || !snippets) return;
    const discordIds = Object.keys(snippets).filter(k => /^\d+$/.test(k));
    if (discordIds.length === 0) return;
    const userMap = await buildDiscordToUserMap(sb, discordIds);

    const upserts = [];
    for (const [discordId, userSnips] of Object.entries(snippets)) {
      const userId = userMap[discordId];
      if (!userId || !userSnips) continue;
      upserts.push({ user_id: userId, snippets: userSnips });
    }
    if (upserts.length === 0) return;
    const { error } = await sb.from('user_snippets').upsert(upserts, { onConflict: 'user_id' });
    if (error) throw error;
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] user snippets full sync failed:', err.message);
  }
}

async function syncGuildSnippetsToSupabase(guildId, snippets) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from('guild_snippets').upsert({
      discord_guild_id: String(guildId),
      snippets:         snippets ?? {},
    }, { onConflict: 'discord_guild_id' });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] guild snippets sync failed:', err.message);
  }
}

async function syncAllGuildSnippetsToSupabase(serverSnippets) {
  try {
    const sb = getSupabase();
    if (!sb || !serverSnippets) return;
    const upserts = Object.entries(serverSnippets)
      .filter(([guildId, snips]) => guildId && snips)
      .map(([guildId, snips]) => ({ discord_guild_id: String(guildId), snippets: snips }));
    if (upserts.length === 0) return;
    const { error } = await sb.from('guild_snippets').upsert(upserts, { onConflict: 'discord_guild_id' });
    if (error) throw error;
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] guild snippets full sync failed:', err.message);
  }
}

module.exports = {
  // Phase 2 surface
  getAllUser,
  getAllGuild,
  getUser,
  getGuild,
  saveUser,
  saveGuild,
  saveAllUser,
  saveAllGuild,
  restore,
  subscribe,

  // Phase 1 compat
  syncUserSnippetsToSupabase,
  syncAllUserSnippetsToSupabase,
  syncGuildSnippetsToSupabase,
  syncAllGuildSnippetsToSupabase,
};
