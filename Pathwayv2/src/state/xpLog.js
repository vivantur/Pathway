// state/xpLog.js
// Durable per-character XP audit log. The current XP total lives on the
// characters table; this table keeps the award/set/reset history so imports
// and character overlay rewrites cannot erase it.

const { getSupabase } = require('../lib/supabase');

let _cache = null;
let _ready = false;
const _pendingEvents = [];
let _userIdToDiscordId = {};
const _disabled = { restore: false, write: false };

function _ensureCache() {
  if (_cache === null) _cache = {};
  return _cache;
}

function flatKey(discordId, charKey) {
  return `${discordId}:${charKey}`;
}

function _normalizeEntry(row) {
  if (!row) return null;
  return {
    id: row.id ?? null,
    amount: Number(row.amount ?? 0),
    reason: row.reason ?? null,
    at: row.created_at ?? row.at ?? new Date().toISOString(),
    awardedBy: row.awarded_by_discord_id ?? row.awardedBy ?? null,
    oldXp: Number(row.old_xp ?? row.oldXp ?? 0),
    newXp: Number(row.new_xp ?? row.newXp ?? 0),
    type: row.entry_type ?? row.type ?? 'award',
  };
}

function _sortAndCap(entries, limit = 100) {
  return entries
    .filter(Boolean)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-limit);
}

function get(discordId, charKey) {
  return _ensureCache()[flatKey(discordId, charKey)] ?? [];
}

function setLocal(discordId, charKey, entries) {
  _ensureCache()[flatKey(discordId, charKey)] = _sortAndCap(entries ?? []);
  return _ensureCache()[flatKey(discordId, charKey)];
}

async function record(discordId, charKey, entry) {
  const normalized = _normalizeEntry(entry);
  if (!normalized) return get(discordId, charKey);

  const cache = _ensureCache();
  const key = flatKey(discordId, charKey);
  cache[key] = _sortAndCap([...(cache[key] ?? []), normalized]);
  await syncEntryToSupabase(discordId, charKey, normalized);
  return cache[key];
}

async function clear(discordId, charKey) {
  const cache = _ensureCache();
  const key = flatKey(discordId, charKey);
  const deletedCount = cache[key]?.length ?? 0;
  cache[key] = [];
  await deleteCharacterLogFromSupabase(discordId, charKey);
  return deletedCount;
}

function subscribe(sb) {
  if (!sb) {
    console.warn('[state/xpLog:realtime] Supabase not available - live sync disabled');
    return;
  }
  sb.channel('state-xp-log')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'character_xp_log',
    }, (payload) => {
      const apply = () => _applyEvent(payload);
      if (_ready) apply();
      else _pendingEvents.push(apply);
    })
    .subscribe((status, err) => {
      if (err) console.error('[state/xpLog:realtime] subscription error:', err.message);
      else console.log(`[state/xpLog:realtime] ${status}`);
    });
}

function _applyEvent(payload) {
  try {
    const event = payload.eventType ?? payload.type;
    const row = event === 'DELETE' ? payload.old : payload.new;
    const discordId = _userIdToDiscordId[row.user_id];
    if (!discordId || !row.char_key) return;

    const key = flatKey(discordId, row.char_key);
    const cache = _ensureCache();
    if (!cache[key]) cache[key] = [];

    if (event === 'DELETE') {
      cache[key] = cache[key].filter(entry => entry.id !== row.id);
      console.log(`[state/xpLog:realtime] - ${discordId}:${row.char_key}`);
      return;
    }

    const entry = _normalizeEntry(row);
    if (!entry) return;
    cache[key] = _sortAndCap([
      ...cache[key].filter(existing => !entry.id || existing.id !== entry.id),
      entry,
    ]);
    console.log(`[state/xpLog:realtime] ${event === 'INSERT' ? '+' : '~'} ${discordId}:${row.char_key}`);
  } catch (err) {
    console.error('[state/xpLog:realtime] handler error:', err.message);
  }
}

async function restore(sb, { bySupabaseId }) {
  if (!sb || _disabled.restore) {
    _ready = true;
    _drainPending();
    return _ensureCache();
  }

  const { data: rows, error } = await sb
    .from('character_xp_log')
    .select('id, user_id, char_key, amount, reason, old_xp, new_xp, awarded_by_discord_id, entry_type, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    _disabled.restore = true;
    _disabled.write = true;
    console.warn(`[Supabase] XP log restore skipped: ${error.message}`);
    _ready = true;
    _drainPending();
    return _ensureCache();
  }

  _userIdToDiscordId = { ...bySupabaseId };
  const grouped = {};
  for (const row of rows ?? []) {
    const discordId = bySupabaseId[row.user_id];
    if (!discordId || !row.char_key) continue;
    const key = flatKey(discordId, row.char_key);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(_normalizeEntry(row));
  }

  const cache = _ensureCache();
  for (const [key, entries] of Object.entries(grouped)) {
    cache[key] = _sortAndCap(entries);
  }

  _ready = true;
  _drainPending();
  console.log(`[Supabase] restore: loaded ${rows?.length ?? 0} XP log entries`);
  return cache;
}

function _drainPending() {
  if (_pendingEvents.length === 0) return;
  console.log(`[state/xpLog:realtime] draining ${_pendingEvents.length} queued event(s) after restore`);
  for (const apply of _pendingEvents) apply();
  _pendingEvents.length = 0;
}

async function syncEntryToSupabase(discordId, charKey, entry) {
  try {
    if (_disabled.write) return;
    const sb = getSupabase();
    if (!sb) return;

    const { data: userRow, error: userErr } = await sb
      .from('users')
      .select('id')
      .eq('discord_id', String(discordId))
      .single();
    if (userErr || !userRow?.id) return;

    const { error } = await sb.from('character_xp_log').insert({
      user_id: userRow.id,
      char_key: charKey,
      amount: entry.amount,
      reason: entry.reason,
      old_xp: entry.oldXp,
      new_xp: entry.newXp,
      awarded_by_discord_id: entry.awardedBy ? String(entry.awardedBy) : null,
      entry_type: entry.type ?? 'award',
      created_at: entry.at,
    });
    if (error) throw error;
  } catch (err) {
    if (/character_xp_log|does not exist|schema cache/i.test(err.message)) {
      _disabled.write = true;
    }
    console.error('[Supabase] XP log sync failed:', err.message);
  }
}

async function deleteCharacterLogFromSupabase(discordId, charKey) {
  try {
    if (_disabled.write) return;
    const sb = getSupabase();
    if (!sb) return;

    const { data: userRow, error: userErr } = await sb
      .from('users')
      .select('id')
      .eq('discord_id', String(discordId))
      .single();
    if (userErr || !userRow?.id) return;

    const { error } = await sb
      .from('character_xp_log')
      .delete()
      .eq('user_id', userRow.id)
      .eq('char_key', charKey);
    if (error) throw error;
  } catch (err) {
    if (/character_xp_log|does not exist|schema cache/i.test(err.message)) {
      _disabled.write = true;
    }
    console.error('[Supabase] XP log delete failed:', err.message);
  }
}

module.exports = {
  get,
  setLocal,
  record,
  clear,
  restore,
  subscribe,
  syncEntryToSupabase,
  deleteCharacterLogFromSupabase,
};
