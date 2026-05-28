// ── state/downtime.js ────────────────────────────────────────────────────────
// Per-character downtime bank: accumulated days, last accrual date, log of
// grants/spends. The /downtime command suite + the auto-accrual job both
// write here.
//
// Phase 2: this module owns the cache + Realtime. Fixes Liv's bug for
// downtime — web-app changes to a character's bank now propagate to the
// bot via Realtime, and bot writes go through the cache atomically.
//
// Cache shape: { [discordId]: { [charKey]: { bank, lastAccrualDate, log } } }
// (Nested, NOT flat — mirrors the legacy in-memory shape so all existing
// call sites in index.js + the downtime command helpers keep working.)

const { getSupabase } = require('../lib/supabase');
const { _recordSyncSuccess, _recordSyncFailure } = require('../lib/syncTracker');
const { buildDiscordToUserMap } = require('../lib/userMap');

// ── In-memory cache ────────────────────────────────────────────────────────
let _cache = null;
let _ready = false;
const _pendingEvents = [];
// Supabase user_id (UUID) → discord_id (snowflake) lookup, populated by restore.
let _userIdToDiscordId = {};
// Per-row updated_at, for Realtime freshness check. Key: "discordId:charKey".
const _rowUpdatedAt = Object.create(null);

function _ensureCache() {
  if (_cache === null) _cache = {};
  return _cache;
}

function _freshnessKey(discordId, charKey) {
  return `${discordId}:${charKey}`;
}

// ── Accessors (sync — bot reads from cache) ────────────────────────────────

// Whole-map read. Preserves the legacy loadDowntime() API shape.
function getAll() { return _ensureCache(); }

// Single-character read. Returns null if absent.
function get(discordId, charKey) {
  return _ensureCache()[discordId]?.[charKey] ?? null;
}

// ── Write helpers ──────────────────────────────────────────────────────────

// Per-record save: writes a single character's downtime row.
async function save(discordId, charKey, record) {
  const cache = _ensureCache();
  if (!cache[discordId]) cache[discordId] = {};
  cache[discordId][charKey] = record;
  await syncDowntimeToSupabase(discordId, charKey, record);
}

// Bulk save: replaces the entire cache (called from the auto-accrual job and
// from the legacy saveDowntime() wrapper in index.js).
async function saveAll(data) {
  _cache = data || {};
  await syncAllDowntimeToSupabase(_cache);
}

// ── Subscribe (Realtime — call BEFORE restore) ─────────────────────────────
function subscribe(sb) {
  if (!sb) {
    console.warn('[state/downtime:realtime] Supabase not available — live sync disabled');
    return;
  }
  sb.channel('state-downtime')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'downtime',
    }, (payload) => {
      const apply = () => _applyEvent(payload);
      if (_ready) apply();
      else _pendingEvents.push(apply);
    })
    .subscribe((status, err) => {
      if (err) console.error('[state/downtime:realtime] subscription error:', err.message);
      else console.log(`[state/downtime:realtime] ${status}`);
    });
}

function _applyEvent(payload) {
  try {
    const event = payload.eventType ?? payload.type;
    const cache = _ensureCache();

    if (event === 'DELETE') {
      const row = payload.old;
      const discordId = _userIdToDiscordId[row.user_id];
      if (!discordId || !row.char_key) return;
      if (cache[discordId]) {
        delete cache[discordId][row.char_key];
        if (Object.keys(cache[discordId]).length === 0) delete cache[discordId];
      }
      delete _rowUpdatedAt[_freshnessKey(discordId, row.char_key)];
      console.log(`[state/downtime:realtime] - ${discordId}:${row.char_key}`);
      return;
    }

    // INSERT or UPDATE
    const row = payload.new;
    const discordId = _userIdToDiscordId[row.user_id];
    if (!discordId || !row.char_key) return;

    const fk = _freshnessKey(discordId, row.char_key);
    if (_rowUpdatedAt[fk] && row.updated_at && row.updated_at <= _rowUpdatedAt[fk]) {
      return; // skip stale event
    }
    if (!cache[discordId]) cache[discordId] = {};
    cache[discordId][row.char_key] = {
      bank:            row.bank ?? 0,
      lastAccrualDate: row.last_accrual_date ?? null,
      log:             row.log ?? [],
    };
    _rowUpdatedAt[fk] = row.updated_at ?? null;
    console.log(`[state/downtime:realtime] ${event === 'INSERT' ? '+' : '~'} ${discordId}:${row.char_key}`);
  } catch (e) {
    console.error('[state/downtime:realtime] handler error:', e.message);
  }
}

// ── Restore (called once at startup, AFTER subscribe) ──────────────────────
async function restore(sb, { bySupabaseId }, diskDowntime = {}) {
  if (!sb) {
    _ready = true;
    _drainPending();
    return _ensureCache();
  }

  const { data: dtRows, error } = await sb
    .from('downtime')
    .select('user_id, char_key, bank, last_accrual_date, log, updated_at');
  if (error) throw error;

  _userIdToDiscordId = { ...bySupabaseId };

  // Start with whatever disk had (the legacy disk-side downtime.json), then
  // overlay Supabase rows. Supabase wins on conflict.
  const cache = _ensureCache();
  Object.assign(cache, diskDowntime);

  for (const row of dtRows ?? []) {
    const discordId = bySupabaseId[row.user_id];
    if (!discordId || !row.char_key) continue;
    if (!cache[discordId]) cache[discordId] = {};
    cache[discordId][row.char_key] = {
      bank:            row.bank ?? 0,
      lastAccrualDate: row.last_accrual_date ?? null,
      log:             row.log ?? [],
    };
    _rowUpdatedAt[_freshnessKey(discordId, row.char_key)] = row.updated_at ?? null;
  }

  _ready = true;
  _drainPending();

  console.log(`[Supabase] restore: loaded ${dtRows?.length ?? 0} downtime records`);
  return cache;
}

function _drainPending() {
  if (_pendingEvents.length === 0) return;
  console.log(`[state/downtime:realtime] draining ${_pendingEvents.length} queued event(s) after restore`);
  for (const apply of _pendingEvents) apply();
  _pendingEvents.length = 0;
}

// ── Phase 1 sync helpers (still public for backward compat) ────────────────

async function syncDowntimeToSupabase(discordId, charKey, record) {
  try {
    const sb = getSupabase();
    if (!sb) return;

    const { data: userRow } = await sb
      .from('users')
      .select('id')
      .eq('discord_id', discordId)
      .single();
    if (!userRow) return;

    const { error } = await sb.from('downtime').upsert({
      user_id:           userRow.id,
      char_key:          charKey,
      bank:              record.bank,
      last_accrual_date: record.lastAccrualDate,
      log:               record.log,
    }, { onConflict: 'user_id,char_key' });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] downtime sync failed:', err.message);
  }
}

async function syncAllDowntimeToSupabase(downtime) {
  try {
    const sb = getSupabase();
    if (!sb || !downtime) return;
    const discordIds = Object.keys(downtime).filter(k => /^\d+$/.test(k));
    if (discordIds.length === 0) return;
    const userMap = await buildDiscordToUserMap(sb, discordIds);

    const upserts = [];
    for (const [discordId, userDt] of Object.entries(downtime)) {
      const userId = userMap[discordId];
      if (!userId || typeof userDt !== 'object') continue;
      for (const [charKey, record] of Object.entries(userDt)) {
        if (!record || charKey.startsWith('_')) continue;
        upserts.push({
          user_id:           userId,
          char_key:          charKey,
          bank:              record.bank ?? 0,
          last_accrual_date: record.lastAccrualDate ?? null,
          log:               record.log ?? [],
        });
      }
    }
    if (upserts.length === 0) return;
    const { error } = await sb.from('downtime').upsert(upserts, { onConflict: 'user_id,char_key' });
    if (error) throw error;
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] downtime full sync failed:', err.message);
  }
}

module.exports = {
  // Phase 2 surface
  getAll,
  get,
  save,
  saveAll,
  restore,
  subscribe,

  // Phase 1 compat — still re-exported by the storage barrel
  syncDowntimeToSupabase,
  syncAllDowntimeToSupabase,
};
