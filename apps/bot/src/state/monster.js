// ── state/monster.js ─────────────────────────────────────────────────────────
// Per-guild monster customizations: art links, stat edits, and homebrewed
// attacks. All three are keyed by discord_guild_id and store a single JSONB
// column ({ [monsterKey]: <payload> }).
//
// Phase 2: this module owns three caches + three Realtime subscriptions.
// Because all three tables share an identical shape (guild_id PK + JSONB
// payload), the per-table machinery is built once via a small internal
// factory and instantiated three times.
//
// Cache shapes:
//   art:     { [guildId]: { [monsterKey]: imageUrl } }
//   edits:   { [guildId]: { [monsterKey]: { ...statOverrides } } }
//   attacks: { [guildId]: { [monsterKey]: { ...attacks } } }

const { getSupabase } = require('../lib/supabase');
const { _recordSyncSuccess, _recordSyncFailure } = require('../lib/syncTracker');

// ── Per-table cache + Realtime factory ─────────────────────────────────────
//
// Each invocation gives us a self-contained mini-state-module for one of
// the three monster_* tables. Returns the public surface (subscribe,
// restore, getAll, saveAll) plus the legacy per-record sync helper.
//
// `payloadColumn` is the name of the JSONB column on the row (e.g. 'art',
// 'edits', 'attacks'). `tableName` is the Supabase table; `channelName`
// is unique-per-channel so multiple subscriptions don't collide.
function makeGuildKeyed({ tableName, payloadColumn, channelName, label }) {
  let cache = null;
  let ready = false;
  const pending = [];
  const rowUpdatedAt = Object.create(null); // keyed by guildId

  function ensure() {
    if (cache === null) cache = {};
    return cache;
  }

  function getAll() { return ensure(); }
  function get(guildId) { return ensure()[guildId] ?? null; }

  async function saveOne(guildId, payload) {
    ensure()[guildId] = payload ?? {};
    await syncOne(guildId, payload);
  }

  async function saveAll(map) {
    cache = map || {};
    await syncAll(cache);
  }

  async function syncOne(guildId, payload) {
    try {
      const sb = getSupabase();
      if (!sb) return;
      const { error } = await sb.from(tableName).upsert({
        discord_guild_id: String(guildId),
        [payloadColumn]: payload ?? {},
      }, { onConflict: 'discord_guild_id' });
      if (error) throw error;
    } catch (err) {
      console.error(`[Supabase] ${label} sync failed:`, err.message);
    }
  }

  async function syncAll(map) {
    try {
      const sb = getSupabase();
      if (!sb || !map) return;
      const upserts = Object.entries(map)
        .filter(([gid, p]) => gid && p)
        .map(([gid, p]) => ({ discord_guild_id: String(gid), [payloadColumn]: p }));
      if (upserts.length === 0) return;
      const { error } = await sb.from(tableName).upsert(upserts, { onConflict: 'discord_guild_id' });
      if (error) throw error;
      _recordSyncSuccess();
    } catch (err) {
      _recordSyncFailure();
      console.error(`[Supabase] ${label} full sync failed:`, err.message);
    }
  }

  function subscribe(sb) {
    if (!sb) {
      console.warn(`[state/monster:realtime ${label}] Supabase not available — live sync disabled`);
      return;
    }
    sb.channel(channelName)
      .on('postgres_changes', {
        event:  '*',
        schema: 'public',
        table:  tableName,
      }, (payload) => {
        const apply = () => applyEvent(payload);
        if (ready) apply();
        else pending.push(apply);
      })
      .subscribe((status, err) => {
        if (err) console.error(`[state/monster:realtime ${label}] subscription error:`, err.message);
        else console.log(`[state/monster:realtime ${label}] ${status}`);
      });
  }

  function applyEvent(payload) {
    try {
      const event = payload.eventType ?? payload.type;
      const c = ensure();

      if (event === 'DELETE') {
        const row = payload.old;
        if (!row.discord_guild_id) return;
        delete c[row.discord_guild_id];
        delete rowUpdatedAt[row.discord_guild_id];
        console.log(`[state/monster:realtime ${label}] - ${row.discord_guild_id}`);
        return;
      }

      const row = payload.new;
      if (!row.discord_guild_id) return;
      if (rowUpdatedAt[row.discord_guild_id] && row.updated_at && row.updated_at <= rowUpdatedAt[row.discord_guild_id]) return;
      c[row.discord_guild_id] = row[payloadColumn] ?? {};
      rowUpdatedAt[row.discord_guild_id] = row.updated_at ?? null;
      console.log(`[state/monster:realtime ${label}] ${event === 'INSERT' ? '+' : '~'} ${row.discord_guild_id}`);
    } catch (e) {
      console.error(`[state/monster:realtime ${label}] handler error:`, e.message);
    }
  }

  async function restore(sb, diskMap = {}) {
    if (!sb) {
      ready = true;
      drainPending();
      return ensure();
    }

    const select = `discord_guild_id, ${payloadColumn}, updated_at`;
    let rows;
    try {
      const { data, error } = await sb.from(tableName).select(select);
      if (error) {
        // Some tables may not exist yet on environments mid-migration.
        if (error.code === '42P01') {
          console.log(`[Supabase] restore: ${tableName} table not yet migrated — skipping`);
          ready = true;
          drainPending();
          return ensure();
        }
        throw error;
      }
      rows = data;
    } catch (err) {
      console.error(`[Supabase] restore: ${tableName} load failed:`, err.message);
      ready = true;
      drainPending();
      return ensure();
    }

    const c = ensure();
    Object.assign(c, diskMap);

    for (const row of rows ?? []) {
      if (!row.discord_guild_id) continue;
      c[row.discord_guild_id] = row[payloadColumn] ?? {};
      rowUpdatedAt[row.discord_guild_id] = row.updated_at ?? null;
    }

    ready = true;
    drainPending();
    console.log(`[Supabase] restore: loaded ${label} for ${rows?.length ?? 0} guilds`);
    return c;
  }

  function drainPending() {
    if (pending.length === 0) return;
    console.log(`[state/monster:realtime ${label}] draining ${pending.length} queued event(s) after restore`);
    for (const apply of pending) apply();
    pending.length = 0;
  }

  return { getAll, get, saveOne, saveAll, restore, subscribe, syncOne, syncAll };
}

// Three instances, one per table.
const _art     = makeGuildKeyed({ tableName: 'monster_art',     payloadColumn: 'art',     channelName: 'state-monster-art',     label: 'monster art' });
const _edits   = makeGuildKeyed({ tableName: 'monster_edits',   payloadColumn: 'edits',   channelName: 'state-monster-edits',   label: 'monster edits' });
const _attacks = makeGuildKeyed({ tableName: 'monster_attacks', payloadColumn: 'attacks', channelName: 'state-monster-attacks', label: 'monster attacks' });

// ── Public surface ─────────────────────────────────────────────────────────

// Art
const getAllArt     = ()       => _art.getAll();
const getArt        = (guild)  => _art.get(guild);
const saveArt       = (guild, payload) => _art.saveOne(guild, payload);
const saveAllArt    = (map)    => _art.saveAll(map);

// Edits
const getAllEdits   = ()       => _edits.getAll();
const getEdits      = (guild)  => _edits.get(guild);
const saveEdits     = (guild, payload) => _edits.saveOne(guild, payload);
const saveAllEdits  = (map)    => _edits.saveAll(map);

// Attacks
const getAllAttacks = ()       => _attacks.getAll();
const getAttacks    = (guild)  => _attacks.get(guild);
const saveAttacks   = (guild, payload) => _attacks.saveOne(guild, payload);
const saveAllAttacks= (map)    => _attacks.saveAll(map);

// One-call subscribe — sets up all three Realtime channels.
function subscribe(sb) {
  _art.subscribe(sb);
  _edits.subscribe(sb);
  _attacks.subscribe(sb);
}

// One-call restore — accepts the three disk-side maps so the legacy
// notebook fallback still seeds the caches if Supabase happens to be empty.
async function restore(sb, { diskArt = {}, diskEdits = {}, diskAttacks = {} } = {}) {
  const [art, edits, attacks] = await Promise.all([
    _art.restore(sb, diskArt),
    _edits.restore(sb, diskEdits),
    _attacks.restore(sb, diskAttacks),
  ]);
  return { art, edits, attacks };
}

// ── Phase 1 sync helper compatibility ──────────────────────────────────────
// The lib/storage.js barrel still re-exports these names. Map them to the
// per-table factories so external callers keep working.
const syncMonsterArtToSupabase        = (guildId, art)   => _art.syncOne(guildId, art);
const syncAllMonsterArtToSupabase     = (map)            => _art.syncAll(map);
const syncMonsterEditsToSupabase      = (guildId, edits) => _edits.syncOne(guildId, edits);
const syncAllMonsterEditsToSupabase   = (map)            => _edits.syncAll(map);
const syncAllMonsterAttacksToSupabase = (map)            => _attacks.syncAll(map);

module.exports = {
  // Phase 2 surface
  getAllArt, getArt, saveArt, saveAllArt,
  getAllEdits, getEdits, saveEdits, saveAllEdits,
  getAllAttacks, getAttacks, saveAttacks, saveAllAttacks,
  subscribe,
  restore,

  // Phase 1 compat
  syncMonsterArtToSupabase,
  syncAllMonsterArtToSupabase,
  syncMonsterEditsToSupabase,
  syncAllMonsterEditsToSupabase,
  syncAllMonsterAttacksToSupabase,
};
