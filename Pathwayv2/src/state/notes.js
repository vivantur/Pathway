// ── state/notes.js ───────────────────────────────────────────────────────────
// Per-character notes (the /note* commands).
//
// Phase 2: this module now owns the in-memory cache, Realtime subscription,
// and accessor surface. The bot reads from the cache (sync), writes go to
// the cache + Supabase atomically, and Realtime patches the cache when the
// web app writes from the other side.
//
// THIS IS THE FIX FOR LIV'S BUG (for notes). Web-app writes to
// `character_notes` now propagate to the bot's cache via Realtime, so reads
// stay fresh and writes can't clobber stale data.
//
// Cache shape: { "discordId:charKey": { nextId, notes: [...] } }
// (Flat composite keys, NOT nested { discordId: { charKey: book } }.)

const { getSupabase } = require('../lib/supabase');
const { _recordSyncSuccess, _recordSyncFailure } = require('../lib/syncTracker');
const { buildDiscordToUserMap } = require('../lib/userMap');

// ── In-memory cache ────────────────────────────────────────────────────────
let _cache = null;
// True once restore() has finished hydrating the cache. Until then, any
// Realtime events that arrive are queued and replayed at the end of restore.
let _ready = false;
const _pendingEvents = [];
// Maps Supabase user_id (UUID) → discord_id (snowflake). Populated by
// restore() since Realtime payloads only contain user_id, but cache keys
// use discord_id. Mutated when restore re-runs (e.g. on reconnect).
let _userIdToDiscordId = {};

function _ensureCache() {
  if (_cache === null) _cache = {};
  return _cache;
}

function flatKey(discordId, charKey) {
  return `${discordId}:${charKey}`;
}

// ── Accessors (sync — bot reads from cache, never hits Supabase) ───────────

// Whole-map read. Preserves the legacy "loadNotes()" API shape so existing
// index.js helpers (getNotebook, noteKey) keep working with minimal changes.
function getAll() { return _ensureCache(); }

// Single-book read. Returns null if absent. Caller initializes via getOrInit.
function get(discordId, charKey) {
  return _ensureCache()[flatKey(discordId, charKey)] ?? null;
}

// Get-or-initialize the notebook for a character. Mirrors the index.js
// getNotebook() helper.
function getOrInit(discordId, charKey) {
  const cache = _ensureCache();
  const k = flatKey(discordId, charKey);
  if (!cache[k]) cache[k] = { nextId: 1, notes: [] };
  return cache[k];
}

// ── Write (single book — cache + Supabase together) ────────────────────────
//
// All /note* command handlers go through here. The write order is:
//   1. Update the in-memory cache (so subsequent reads in the same handler
//      see the change).
//   2. Await the Supabase upsert (so the change is durable before we reply).
async function save(discordId, charKey, book) {
  _ensureCache()[flatKey(discordId, charKey)] = book;
  await syncNotesToSupabase(discordId, charKey, book);
}

// ── Subscribe (Realtime — call BEFORE restore) ─────────────────────────────
//
// Subscribe-then-restore ordering: by subscribing first, we guarantee no
// gap where a web write could land between restore's snapshot and the
// subscription going live. Events received during restore are queued and
// drained at the end of restore() (after the cache is populated).
function subscribe(sb) {
  if (!sb) {
    console.warn('[state/notes:realtime] Supabase not available — live sync disabled');
    return;
  }
  sb.channel('state-notes')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'character_notes',
    }, (payload) => {
      const apply = () => _applyEvent(payload);
      if (_ready) apply();
      else _pendingEvents.push(apply);
    })
    .subscribe((status, err) => {
      if (err) console.error('[state/notes:realtime] subscription error:', err.message);
      else console.log(`[state/notes:realtime] ${status}`);
    });
}

function _applyEvent(payload) {
  try {
    const event = payload.eventType ?? payload.type;
    if (event === 'DELETE') {
      const row = payload.old;
      const discordId = _userIdToDiscordId[row.user_id];
      if (!discordId || !row.char_key) return;
      const cache = _ensureCache();
      delete cache[flatKey(discordId, row.char_key)];
      console.log(`[state/notes:realtime] - ${discordId}:${row.char_key}`);
      return;
    }

    // INSERT or UPDATE
    const row = payload.new;
    const discordId = _userIdToDiscordId[row.user_id];
    if (!discordId || !row.char_key) return;

    // Per-row freshness check: if the event's updated_at is older than what
    // we already have, skip. Belt-and-suspenders for events that arrived
    // during the restore-snapshot window.
    const cache = _ensureCache();
    const k = flatKey(discordId, row.char_key);
    const existing = cache[k];
    if (existing?._updatedAt && row.updated_at && row.updated_at <= existing._updatedAt) {
      return;
    }
    cache[k] = {
      nextId: row.next_id ?? 1,
      notes:  row.notes ?? [],
      _updatedAt: row.updated_at ?? null,
    };
    console.log(`[state/notes:realtime] ${event === 'INSERT' ? '+' : '~'} ${discordId}:${row.char_key}`);
  } catch (e) {
    console.error('[state/notes:realtime] handler error:', e.message);
  }
}

// ── Restore (called once at startup, AFTER subscribe) ──────────────────────
//
// Hydrates the cache from Supabase. Accepts the userId↔discordId lookup
// maps (already built by the bootstrap layer) and any existing disk-side
// notes (legacy notes.json, to be backfilled into Supabase on first run).
//
// Returns the populated cache so the bootstrap can also pass it back to the
// rest of the system for legacy code paths.
async function restore(sb, { bySupabaseId, byDiscordId }, diskNotes = {}) {
  if (!sb) {
    _ready = true;
    _drainPending();
    return _ensureCache();
  }

  const { data: noteRows, error } = await sb
    .from('character_notes')
    .select('user_id, char_key, next_id, notes, updated_at');
  if (error) throw error;

  // Make the userId lookup live so Realtime events can resolve discord_ids.
  _userIdToDiscordId = { ...bySupabaseId };

  // Build the cache: start with whatever disk had, then overlay Supabase
  // rows (Supabase wins on conflict), then backfill disk-only books up
  // to Supabase so the next restart sees them there.
  const cache = _ensureCache();
  Object.assign(cache, diskNotes);

  const notesInSupabase = new Set();
  for (const row of noteRows ?? []) {
    const discordId = bySupabaseId[row.user_id];
    if (!discordId || !row.char_key) continue;
    const k = flatKey(discordId, row.char_key);
    notesInSupabase.add(k);
    cache[k] = {
      nextId:     row.next_id ?? 1,
      notes:      row.notes ?? [],
      _updatedAt: row.updated_at ?? null,
    };
  }

  // One-time disk → Supabase backfill for books that never made it across.
  let backfilled = 0;
  for (const [k, book] of Object.entries(diskNotes)) {
    if (notesInSupabase.has(k) || !book) continue;
    const colonIdx = k.indexOf(':');
    if (colonIdx < 0) continue;
    const discordId = k.slice(0, colonIdx);
    const charKey   = k.slice(colonIdx + 1);
    const userId    = byDiscordId[discordId];
    if (!userId) continue;
    const { error: err } = await sb.from('character_notes').upsert({
      user_id:  userId,
      char_key: charKey,
      next_id:  book.nextId ?? 1,
      notes:    book.notes ?? [],
    }, { onConflict: 'user_id,char_key' });
    if (err) console.error(`[Supabase] notes backfill failed for ${k}:`, err.message);
    else backfilled++;
  }

  _ready = true;
  _drainPending();

  console.log(`[Supabase] restore: loaded ${noteRows?.length ?? 0} note books (backfilled ${backfilled} new)`);
  return cache;
}

function _drainPending() {
  if (_pendingEvents.length === 0) return;
  console.log(`[state/notes:realtime] draining ${_pendingEvents.length} queued event(s) after restore`);
  for (const apply of _pendingEvents) apply();
  _pendingEvents.length = 0;
}

// ── Phase 1 sync helpers (kept for the storage.js dispatcher / legacy) ─────
//
// `save(discordId, charKey, book)` is the new public API. The two helpers
// below remain exported so that:
//   1. The lib/storage.js _syncFileToSupabase dispatcher (still used by
//      other tables in Phase 1) can call syncAllNotesToSupabase if any
//      legacy code path writes to notes.json.
//   2. External callers (web app scripts, migration tooling) that still
//      use the per-table sync functions keep working.

async function syncNotesToSupabase(discordId, charKey, book) {
  try {
    const sb = getSupabase();
    if (!sb) return;

    const { data: userRow } = await sb
      .from('users')
      .select('id')
      .eq('discord_id', discordId)
      .single();
    if (!userRow) return;

    const { error } = await sb.from('character_notes').upsert({
      user_id:  userRow.id,
      char_key: charKey,
      next_id:  book.nextId,
      notes:    book.notes,
    }, { onConflict: 'user_id,char_key' });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] notes sync failed:', err.message);
  }
}

async function syncAllNotesToSupabase(notes) {
  try {
    const sb = getSupabase();
    if (!sb || !notes) return;

    const entries = [];
    for (const [key, book] of Object.entries(notes)) {
      if (key.startsWith('_') || !book) continue;
      const colonIdx = key.indexOf(':');
      if (colonIdx < 0) continue;
      const discordId = key.slice(0, colonIdx);
      const charKey = key.slice(colonIdx + 1);
      if (!/^\d+$/.test(discordId)) continue;
      entries.push({ discordId, charKey, book });
    }
    if (entries.length === 0) return;

    const discordIds = [...new Set(entries.map(e => e.discordId))];
    const userMap = await buildDiscordToUserMap(sb, discordIds);

    const upserts = entries
      .filter(e => userMap[e.discordId])
      .map(e => ({
        user_id:  userMap[e.discordId],
        char_key: e.charKey,
        next_id:  e.book.nextId ?? 1,
        notes:    e.book.notes ?? [],
      }));

    if (upserts.length === 0) return;
    const { error } = await sb.from('character_notes').upsert(upserts, { onConflict: 'user_id,char_key' });
    if (error) throw error;
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] notes full sync failed:', err.message);
  }
}

module.exports = {
  // Phase 2 surface
  getAll,
  get,
  getOrInit,
  save,
  restore,
  subscribe,
  flatKey,

  // Phase 1 compat — kept exported for the legacy storage barrel
  syncNotesToSupabase,
  syncAllNotesToSupabase,
};
