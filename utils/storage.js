// utils/storage.js
// Persistent-data directory handling and generic JSON load/save helpers.
// This consolidates the ~10 copy-pasted try/catch JSON loaders from index.js
// and the dataPath() / force-reseed / homebrew-preservation logic from the
// top of index.js.

'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// ── Persistent-data directory ────────────────────────────────────────────────
// On Railway, mount a volume at /app/data (or wherever DATA_DIR points) so
// user state (characters, bags, monster art/edits, notes, homebrew DB adds)
// survives redeploys. When DATA_DIR is unset (local dev), falls back to the
// project root so behavior matches the old layout.
const DATA_DIR = process.env.DATA_DIR || process.cwd();
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (_) { /* ignore — e.g. volume not writable yet */ }

// Force-reseed mechanism:
// The seeded content (bestiary/spells/items) normally stays forever on the
// volume — a content update you push to git WON'T reach the running bot,
// because the seeder only copies when the volume file is absent. To push
// fresh content from the repo to the volume, set one of these env vars
// before redeploying, then unset after the first successful boot:
//
//   FORCE_RESEED=all             → overwrite all seed-from-repo files
//   FORCE_RESEED_SPELLS=1        → overwrite just spells.json
//   FORCE_RESEED_BESTIARY=1      → overwrite just bestiary.json
//   FORCE_RESEED_ITEMS=1         → overwrite just items.json
//
// Homebrew additions (flagged _homebrew: true) are preserved across reseeds.
const FORCE_RESEED_KEYS = {
  'spells.json': 'FORCE_RESEED_SPELLS',
  'bestiary.json': 'FORCE_RESEED_BESTIARY',
  'items.json': 'FORCE_RESEED_ITEMS',
};

function shouldForceReseed(filename) {
  if (process.env.FORCE_RESEED === 'all' || process.env.FORCE_RESEED === '1') return true;
  const key = FORCE_RESEED_KEYS[filename];
  return key && (process.env[key] === '1' || process.env[key] === 'true');
}

// Splice homebrew entries from the volume copy back into the repo copy
// before overwriting. Different file shapes need different logic.
function preserveHomebrewDuringReseed(filename, volumeCopy, repoCopy) {
  try {
    if (filename === 'spells.json') {
      const old = JSON.parse(fs.readFileSync(volumeCopy, 'utf8'));
      const fresh = JSON.parse(fs.readFileSync(repoCopy, 'utf8'));
      if (!Array.isArray(old) || !Array.isArray(fresh)) return null;
      const homebrew = old.filter(s => s?._homebrew);
      if (homebrew.length === 0) return null;
      const homebrewNames = new Set(homebrew.map(s => String(s.name).toLowerCase()));
      const merged = fresh.filter(s => !homebrewNames.has(String(s.name).toLowerCase())).concat(homebrew);
      return JSON.stringify(merged, null, 2);
    }
    if (filename === 'bestiary.json') {
      const old = JSON.parse(fs.readFileSync(volumeCopy, 'utf8'));
      const fresh = JSON.parse(fs.readFileSync(repoCopy, 'utf8'));
      const oldCreatures = old.creatures ?? old;
      const freshCreatures = fresh.creatures ?? fresh;
      const homebrewEntries = {};
      for (const [slug, entry] of Object.entries(oldCreatures)) {
        if (entry?._homebrew) homebrewEntries[slug] = entry;
      }
      if (Object.keys(homebrewEntries).length === 0) return null;
      const merged = { ...freshCreatures, ...homebrewEntries };
      const payload = fresh.metadata ? { metadata: fresh.metadata, creatures: merged } : { creatures: merged };
      return JSON.stringify(payload, null, 2);
    }
    if (filename === 'items.json') {
      const old = JSON.parse(fs.readFileSync(volumeCopy, 'utf8'));
      const fresh = JSON.parse(fs.readFileSync(repoCopy, 'utf8'));
      const oldItems = old.items ?? old;
      const freshItems = fresh.items ?? fresh;
      const homebrewEntries = {};
      for (const [slug, entry] of Object.entries(oldItems)) {
        if (entry?._homebrew) homebrewEntries[slug] = entry;
      }
      if (Object.keys(homebrewEntries).length === 0) return null;
      const merged = { ...freshItems, ...homebrewEntries };
      const payload = fresh.meta ? { meta: fresh.meta, items: merged } : { items: merged };
      return JSON.stringify(payload, null, 2);
    }
  } catch (err) {
    console.error(`Homebrew-preserve step failed for ${filename}:`, err.message);
  }
  return null;
}

// Returns an absolute path inside DATA_DIR for a given filename. For files
// that ship with the repo as base content (bestiary, spells, items), pass
// `seedFromRepo: true` to auto-copy from the repo on first boot.
//
// The second arg `repoRoot` lets callers override where the repo copy lives.
// Defaults to process.cwd() which matches the old behavior when utils/ is
// required from the project root.
function dataPath(filename, { seedFromRepo = false, repoRoot = process.cwd() } = {}) {
  const target = path.join(DATA_DIR, filename);
  const repoCopy = path.join(repoRoot, filename);

  if (seedFromRepo) {
    const volumeExists = fs.existsSync(target);
    const forceReseed = volumeExists && shouldForceReseed(filename);

    if (!volumeExists && fs.existsSync(repoCopy)) {
      try {
        fs.copyFileSync(repoCopy, target);
        console.log(`Seeded ${filename} from repo into DATA_DIR.`);
      } catch (err) {
        console.error(`Failed to seed ${filename} into DATA_DIR:`, err.message);
      }
    } else if (forceReseed && fs.existsSync(repoCopy)) {
      try {
        const merged = preserveHomebrewDuringReseed(filename, target, repoCopy);
        if (merged !== null) {
          fs.writeFileSync(target, merged, 'utf8');
          console.log(`🔄 Force-reseeded ${filename} from repo (homebrew entries preserved).`);
        } else {
          fs.copyFileSync(repoCopy, target);
          console.log(`🔄 Force-reseeded ${filename} from repo.`);
        }
      } catch (err) {
        console.error(`Failed to force-reseed ${filename}:`, err.message);
      }
    }
  }
  return target;
}

// ── Reference-data path (gamedata/) ─────────────────────────────────────────
// PF2e content bundled with the repo (spells, feats, items, bestiary, etc.)
// lives in gamedata/ inside the bot's source tree. These files are READ-ONLY
// at runtime — they're updated by the AoN sync transformers (tools/aon-*.js)
// and pushed via git, never written to from inside the bot.
//
// IMPORTANT: This is different from `dataPath`. dataPath() points to DATA_DIR
// (Railway volume) which holds USER state (characters, bags, snippets, etc.)
// that needs to survive redeploys. Reference data ships with the repo and
// just needs to be readable.
//
// Resolves filenames relative to the bot's project root, regardless of where
// the bot was started from. Falls back to process.cwd() if path detection
// fails (which it shouldn't, since this file lives at utils/storage.js).
const GAMEDATA_DIR = (() => {
  // utils/storage.js → ../gamedata
  try {
    return path.join(__dirname, '..', 'gamedata');
  } catch {
    return path.join(process.cwd(), 'gamedata');
  }
})();

function gamedataPath(filename) {
  return path.join(GAMEDATA_DIR, filename);
}

// Read a reference-data file from gamedata/. Mirrors loadJson's signature
// for drop-in compatibility, minus the seedFromRepo / fromRepo flags
// (always reads from gamedata/).
function loadGamedata(filename, opts = {}) {
  const {
    default: defaultValue = null,
    label,
    count,
    transform,
    quiet = false,
  } = opts;

  const target = gamedataPath(filename);
  try {
    const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    const data = transform ? transform(raw) : raw;
    if (!quiet) {
      const noun = label || filename.replace(/\.json$/, '');
      if (typeof count === 'function') {
        try {
          console.log(`Loaded ${count(data)} ${noun}.`);
        } catch {
          console.log(`Loaded ${noun}.`);
        }
      } else {
        console.log(`Loaded ${noun}.`);
      }
    }
    return data;
  } catch (err) {
    console.error(`Could not load gamedata/${filename}:`, err.message);
    return defaultValue;
  }
}


// ── Persistent-data path (DATA_DIR) ─────────────────────────────────────────

// Two users running commands at nearly the same instant could each call
//   1. loadJson('characters.json')   ← both read same content
//   2. modify their slot in memory
//   3. saveJson('characters.json', data)  ← second write CLOBBERS first
// The second writer's in-memory copy doesn't have the first writer's change,
// so the first user's change vanishes. Across many saves this corrupts data
// in ways that look like "characters got swapped" or "my changes disappeared."
//
// The fix: queue writes per-filename. Each file has its own promise chain;
// the next save waits for the previous one to complete (including its
// GitHub backup) before starting. Different files don't block each other.
//
// Note: this only protects writes happening within a single Node process.
// If two processes are running (e.g. local + Railway), they can still race.
// That's a separate concern, but the bot only runs in one place at a time.
const writeQueues = new Map();

function queueWrite(filename, task) {
  const prev = writeQueues.get(filename) ?? Promise.resolve();
  // Always continue the chain even if the previous task threw, so one bad
  // write doesn't permanently jam the queue for that file.
  const next = prev.catch(() => {}).then(task);
  writeQueues.set(filename, next);
  // Clean up the map entry when this task finishes, but only if no newer
  // task has chained on top (i.e. the entry still points at our promise).
  next.finally(() => {
    if (writeQueues.get(filename) === next) writeQueues.delete(filename);
  });
  return next;
}

// Atomic write: dump to a temp file, then rename. If anything goes wrong
// mid-write, the real file is either the old version or the new version —
// never a half-written file.
function atomicWriteJson(filename, payload) {
  const target = dataPath(filename);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}


// ── Generic JSON loader ──────────────────────────────────────────────────────
// Replaces the ~10 copy-pasted try/catch blocks at the top of index.js.
//
// Three common cases:
//
//   1. BUNDLED STATIC DATA — ships with the repo, read-only at runtime.
//      (ancestries, archetypes, feats, rules, classes, companions, etc.)
//      Load from the repo root. Pass { fromRepo: true }.
//
//   2. SEEDED CONTENT — ships with the repo but can be mutated at runtime
//      (via /monsteradd, /spelladd, /itemadd).
//      Load from DATA_DIR, seeding from repo on first boot.
//      Pass { seedFromRepo: true }.
//
//   3. USER STATE — never shipped with the repo; created at runtime.
//      (characters, bags, notes, snippets, monster_art, etc.)
//      Load from DATA_DIR. Default behavior (no flags needed).
//
// Options:
//   default:       what to return on error or missing file (default: null)
//   fromRepo:      load from the repo directory instead of DATA_DIR (default: false)
//   seedFromRepo:  seed into DATA_DIR from the repo on first boot (default: false)
//   repoRoot:      override where "the repo" lives (default: process.cwd())
//   label:         noun for the success log message (default: filename without .json)
//   count:         fn that takes the loaded data and returns a human-readable count
//                  for the success log (default: omit count from the log)
//   transform:     fn that takes the raw parsed JSON and returns the final shape
//                  (useful for files like feats.json that wrap their array in
//                  { metadata, feats: [...] }). Default: identity.
//   quiet:         suppress the success log (default: false)
// ── In-memory JSON cache (Phase 2d) ─────────────────────────────────────────
// Allows guild-state files (calendar-state.json, weather-state.json,
// bot-settings.json) to live purely in memory after startup restore.
// Call seedJsonCache(filename, data) once during clientReady to enable;
// after that, loadJson() returns from memory and mutateJson() operates
// on memory (no disk read/write) while still firing Supabase sync.
const _jsonCaches = new Map();

function seedJsonCache(filename, data) {
  _jsonCaches.set(filename, data ?? {});
}

function loadJson(filename, opts = {}) {
  const {
    default: defaultValue = null,
    fromRepo = false,
    seedFromRepo = false,
    repoRoot = process.cwd(),
    label,
    count,
    transform,
    quiet = false,
  } = opts;

  // In-memory override: return cached data for guild-state files.
  // fromRepo files always read from disk (they're reference data, not state).
  if (!fromRepo && _jsonCaches.has(filename)) {
    const raw = _jsonCaches.get(filename);
    return transform ? transform(raw) : raw;
  }

  // Pick the right file to read. Bundled static data loads straight from the
  // repo (read-only). Seeded/user files go through dataPath (writable volume).
  const target = fromRepo
    ? path.join(repoRoot, filename)
    : dataPath(filename, { seedFromRepo, repoRoot });

  try {
    const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    const data = transform ? transform(raw) : raw;
    if (!quiet) {
      const noun = label || filename.replace(/\.json$/, '');
      if (typeof count === 'function') {
        try {
          console.log(`Loaded ${count(data)} ${noun}.`);
        } catch {
          console.log(`Loaded ${noun}.`);
        }
      } else {
        console.log(`Loaded ${noun}.`);
      }
    }
    return data;
  } catch (err) {
    console.error(`Could not load ${filename}:`, err.message);
    return defaultValue;
  }
}

// Kept for the disk-fallback path in mutateJson; no longer called directly.
function saveJson(filename, data) {
  return queueWrite(filename, async () => {
    atomicWriteJson(filename, data);
    _syncFileToSupabase(filename, data);
  });
}

// Atomically read-modify-write a JSON file. The mutator function receives
// the current on-disk state (or `defaultValue` if the file doesn't exist
// or can't be parsed) and should return the new state to write. The entire
// load-modify-save cycle runs inside the file's write queue, so two
// handlers calling mutateJson on the same file at the same time will
// serialize: the second one sees the first one's changes when it reads.
//
// This is the fix for the "swapped sheets" / "lost changes" bug. Use this
// instead of saveJson for any file where two users could modify at once.
//
// The mutator may be sync or async. Throwing from it aborts the write
// (the file is left untouched) and the error propagates to the caller.
//
// Example (replacing load → modify → save):
//
//   // OLD (race condition):
//   const characters = loadCharacters();
//   characters[userId][key].hp = 30;
//   saveCharacters(characters);
//
//   // NEW (race-free):
//   await mutateJson('characters.json', { default: {} }, (characters) => {
//     characters[userId][key].hp = 30;
//     return characters;
//   });
function mutateJson(filename, opts, mutator) {
  // Allow calling as mutateJson(filename, mutator) with no opts.
  if (typeof opts === 'function') { mutator = opts; opts = {}; }
  const { default: defaultValue = null } = opts || {};
  return queueWrite(filename, async () => {
    // In-memory path: operate on the cache without touching disk.
    if (_jsonCaches.has(filename)) {
      const current = _jsonCaches.get(filename)
        ?? (typeof defaultValue === 'function' ? defaultValue() : defaultValue);
      const next = await mutator(current);
      const result = next !== undefined ? next : current;
      _jsonCaches.set(filename, result);
      _syncFileToSupabase(filename, result);
      return result;
    }

    let current;
    try {
      current = JSON.parse(fs.readFileSync(dataPath(filename), 'utf8'));
    } catch {
      current = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
    }
    const next = await mutator(current);
    if (next === undefined) {
      // Mutator didn't return — assume they mutated in place.
      atomicWriteJson(filename, current);
      _syncFileToSupabase(filename, current);
      return current;
    }
    atomicWriteJson(filename, next);
    _syncFileToSupabase(filename, next);
    return next;
  });
}

// ── Supabase sync helpers ────────────────────────────────────────────────────
// All three functions are fire-and-forget: they never throw and never block
// a Discord command. A Supabase outage is silent to users — the bot keeps
// working from JSON files as normal.

const { getSupabase } = require('./supabase');

// Track consecutive sync failures so the GM can be warned in-Discord.
let _syncConsecutiveFailures = 0;
const SYNC_DEGRADED_THRESHOLD = 3;

// In-flight Supabase sync promises — drained on SIGTERM so Railway rolling
// deploys don't kill the process before companion/character state is flushed.
const _inflightSyncs = new Set();

function _trackSync(p) {
  const tracked = Promise.resolve(p).finally(() => _inflightSyncs.delete(tracked));
  _inflightSyncs.add(tracked);
  return tracked;
}

async function drainSupabaseSyncs() {
  if (_inflightSyncs.size === 0) return;
  console.log(`[Supabase] draining ${_inflightSyncs.size} in-flight sync(s) before shutdown…`);
  await Promise.allSettled([..._inflightSyncs]);
}

function _recordSyncSuccess() { _syncConsecutiveFailures = 0; }
function _recordSyncFailure() { _syncConsecutiveFailures++; }

// Returns true if Supabase syncs have been failing repeatedly.
// Call this at the start/end of an encounter to warn the GM.
function isSyncDegraded() { return _syncConsecutiveFailures >= SYNC_DEGRADED_THRESHOLD; }

// Sync all characters from the in-memory map to Supabase.
// Called after saveCharacters to write character state to Supabase.
// Accepts an optional usernamesByDiscordId Map so bot-only users (who have
// never logged into the web app) get a users row auto-created on first save.
async function syncAllCharactersToSupabase(characters, usernamesByDiscordId) {
  try {
    const sb = getSupabase();
    if (!sb) return;

    const discordIds = Object.keys(characters).filter(k => k !== '_activeChar' && /^\d+$/.test(k));
    if (discordIds.length === 0) return;

    const { data: userRows, error: userErr } = await sb
      .from('users')
      .select('id, discord_id')
      .in('discord_id', discordIds);
    if (userErr) throw userErr;

    const userMap = Object.fromEntries((userRows ?? []).map(u => [u.discord_id, u.id]));

    // Auto-create users rows for bot-only users whose username we know.
    // Discord usernames are captured from interaction.user.username and passed
    // in via the usernamesByDiscordId cache in index.js.
    const missingIds = discordIds.filter(id => !userMap[id]);
    if (missingIds.length > 0 && usernamesByDiscordId?.size > 0) {
      const toCreate = missingIds
        .filter(id => usernamesByDiscordId.has(id))
        .map(id => ({ discord_id: id, discord_username: usernamesByDiscordId.get(id) }));
      if (toCreate.length > 0) {
        const { data: created } = await sb
          .from('users')
          .upsert(toCreate, { onConflict: 'discord_id' })
          .select('id, discord_id');
        for (const row of created ?? []) userMap[row.discord_id] = row.id;
      }
    }

    const upserts = [];
    for (const [discordId, userChars] of Object.entries(characters)) {
      const userId = userMap[discordId];
      if (!userId) continue;

      for (const [charKey, charEntry] of Object.entries(userChars)) {
        if (charKey.startsWith('_') || !charEntry || !charEntry.name) continue;
        const d = charEntry.data || {};
        upserts.push({
          user_id:          userId,
          char_key:         charKey,
          discord_guild_id: charEntry.guildId ?? null,
          name:             charEntry.name,
          class_name:       d.class ?? null,
          ancestry_name:    d.ancestry ?? null,
          background_name:  d.background ?? null,
          level:            d.level ?? 1,
          experience:       d.xp ?? 0,
          pathbuilder_data: d,
          current_hp:       charEntry.hp ?? null,
          overlay:          {
            ...(charEntry.overlay ?? {}),
            ...(charEntry.companions && Object.keys(charEntry.companions).length > 0
              ? { companions: charEntry.companions }
              : {}),
          },
          hero_points:      charEntry.heroPoints ?? charEntry.overlay?.daily?.hero_points ?? 1,
          dying:            charEntry.dying ?? 0,
          wounded:          charEntry.wounded ?? 0,
          status:           'active',
        });
      }
    }
    if (upserts.length === 0) return;

    const { error } = await sb
      .from('characters')
      .upsert(upserts, { onConflict: 'user_id,char_key' });
    if (error) throw error;
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] character sync failed:', err.message);
  }
}

// ── Companion sync helpers ─────────────────────────────────────────────────────
// Upsert a single companion row. Called (awaited) by every /companion subcommand
// that mutates state so data is durable before the bot replies.
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

// Delete a single companion row. Called (awaited) by /companion remove.
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

// Bulk backfill: upsert all companions for all characters from the in-memory map.
// One-time migration helper — call from a bot admin command or startup if needed.
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

// Upsert a single character's downtime record to Supabase.
// Called fire-and-forget after every spend/grant/accrue/reset.
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

// ── Shared bag helper: flatten a userBag into a list of plain entries ─────────
function _flattenBagEntries(userBag) {
  const entries = [];
  let sortOrder = 0;
  for (const [category, items] of Object.entries(userBag.categories ?? {})) {
    for (const raw of (Array.isArray(items) ? items : [])) {
      const entry = typeof raw === 'string' ? { name: raw, qty: 1 } : raw;
      if (!entry?.name) continue;
      entries.push({
        category,
        name:      String(entry.name).trim(),
        qty:       Math.max(1, Number(entry.qty) || 1),
        sortOrder: sortOrder++,
      });
    }
  }
  return entries;
}

// ── Shared bag helper: resolve item names → Supabase UUIDs (batch) ────────────
// Returns { itemIdByNameLower, homebrewIdByNameLower }
async function _resolveItemNames(sb, names) {
  const uniqueNames = [...new Set(names)];
  const itemIdByNameLower     = {};
  const homebrewIdByNameLower = {};
  if (uniqueNames.length === 0) return { itemIdByNameLower, homebrewIdByNameLower };

  const { data: officialMatches } = await sb
    .from('items')
    .select('id, name')
    .in('name', uniqueNames);
  for (const row of officialMatches ?? []) {
    itemIdByNameLower[row.name.toLowerCase()] = row.id;
  }

  const unresolved = uniqueNames.filter(n => !itemIdByNameLower[n.toLowerCase()]);
  if (unresolved.length > 0) {
    const { data: homebrewMatches } = await sb
      .from('homebrew_entries')
      .select('id, name')
      .eq('type', 'item')
      .in('name', unresolved);
    for (const row of homebrewMatches ?? []) {
      homebrewIdByNameLower[row.name.toLowerCase()] = row.id;
    }
  }

  return { itemIdByNameLower, homebrewIdByNameLower };
}

// ── Shared bag helper: build bag_items insert rows from entries + id maps ─────
function _buildBagItemRows(userId, entries, itemIdByNameLower, homebrewIdByNameLower) {
  return entries.map(e => {
    const nl        = e.name.toLowerCase();
    const itemId    = itemIdByNameLower[nl]     ?? null;
    const homebrewId = homebrewIdByNameLower[nl] ?? null;
    return {
      user_id:      userId,
      category:     e.category,
      item_id:      itemId,
      homebrew_id:  homebrewId,
      custom_name:  (!itemId && !homebrewId) ? e.name : null,
      display_name: e.name,
      quantity:     e.qty,
      sort_order:   e.sortOrder,
    };
  });
}

async function syncBagToSupabase(discordId, userBag) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { data: userRow } = await sb.from('users').select('id').eq('discord_id', discordId).single();
    if (!userRow) return;
    const userId = userRow.id;

    // Keep bag metadata (name) in bags table
    await sb.from('bags').upsert({
      user_id:    userId,
      bag_name:   userBag.bagName ?? 'Bag 1',
      categories: {},   // deprecated; kept empty for schema compat during cutover
    }, { onConflict: 'user_id' });

    // Flatten, resolve, delete-and-reinsert bag_items
    const entries = _flattenBagEntries(userBag);
    await sb.from('bag_items').delete().eq('user_id', userId);

    if (entries.length > 0) {
      const { itemIdByNameLower, homebrewIdByNameLower } =
        await _resolveItemNames(sb, entries.map(e => e.name));
      const rows = _buildBagItemRows(userId, entries, itemIdByNameLower, homebrewIdByNameLower);
      const { error } = await sb.from('bag_items').insert(rows);
      if (error) throw error;
    }
  } catch (err) {
    console.error('[Supabase] bag sync failed:', err.message);
  }
}

async function syncHomebrewEntryToSupabase(type, entryKey, entry) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from('homebrew_entries').upsert({
      type,
      entry_key: entryKey,
      name:      entry.name,
      data:      entry,
      added_by:  entry._addedBy ?? null,
    }, { onConflict: 'type,entry_key' });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] homebrew sync failed:', err.message);
  }
}

async function deleteHomebrewEntryFromSupabase(type, entryKey) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from('homebrew_entries').delete()
      .eq('type', type).eq('entry_key', entryKey);
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] homebrew delete failed:', err.message);
  }
}

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

async function syncMonsterArtToSupabase(guildId, guildArt) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from('monster_art').upsert({
      discord_guild_id: String(guildId),
      art:              guildArt ?? {},
    }, { onConflict: 'discord_guild_id' });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] monster art sync failed:', err.message);
  }
}

async function syncMonsterEditsToSupabase(guildId, guildEdits) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from('monster_edits').upsert({
      discord_guild_id: String(guildId),
      edits:            guildEdits ?? {},
    }, { onConflict: 'discord_guild_id' });
    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] monster edits sync failed:', err.message);
  }
}

// ── Batch "sync whole file" helpers ──────────────────────────────────────────
// These are called from _syncFileToSupabase() after every saveJson/mutateJson
// write so that Supabase always reflects the current on-disk state.
// All functions are fire-and-forget: they never throw to callers.

// Shared helper: fetch discord_id → supabase user_id for a set of discord IDs.
async function _buildDiscordToUserMap(sb, discordIds) {
  if (!discordIds || discordIds.length === 0) return {};
  const { data: rows, error } = await sb
    .from('users')
    .select('id, discord_id')
    .in('discord_id', discordIds);
  if (error) throw error;
  return Object.fromEntries((rows ?? []).map(u => [u.discord_id, u.id]));
}

// Sync entire downtime.json → Supabase downtime table.
async function syncAllDowntimeToSupabase(downtime) {
  try {
    const sb = getSupabase();
    if (!sb || !downtime) return;
    const discordIds = Object.keys(downtime).filter(k => /^\d+$/.test(k));
    if (discordIds.length === 0) return;
    const userMap = await _buildDiscordToUserMap(sb, discordIds);

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

// Sync entire notes map → Supabase character_notes table.
// Notes are stored as flat "discordId:charKey" composite keys (e.g.
// "123456789012345:warrior-mage"), NOT as nested { discordId: { charKey: book } }.
async function syncAllNotesToSupabase(notes) {
  try {
    const sb = getSupabase();
    if (!sb || !notes) return;

    // Parse "discordId:charKey" flat keys
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
    const userMap = await _buildDiscordToUserMap(sb, discordIds);

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

// Sync entire bags.json → Supabase bags + bag_items tables.
async function syncAllBagsToSupabase(bags) {
  try {
    const sb = getSupabase();
    if (!sb || !bags) return;
    const discordIds = Object.keys(bags).filter(k => /^\d+$/.test(k));
    if (discordIds.length === 0) return;
    const userMap = await _buildDiscordToUserMap(sb, discordIds);

    // 1. Upsert bag metadata rows (name only; categories column is legacy)
    const bagUpserts = [];
    for (const [discordId, userBag] of Object.entries(bags)) {
      const userId = userMap[discordId];
      if (!userId || !userBag) continue;
      bagUpserts.push({ user_id: userId, bag_name: userBag.bagName ?? 'Bag 1', categories: {} });
    }
    if (bagUpserts.length === 0) return;
    const { error: bagErr } = await sb.from('bags').upsert(bagUpserts, { onConflict: 'user_id' });
    if (bagErr) throw bagErr;

    // 2. Collect ALL entries across all users
    const allEntries = []; // { userId, category, name, qty, sortOrder }
    const affectedUserIds = [];
    for (const [discordId, userBag] of Object.entries(bags)) {
      const userId = userMap[discordId];
      if (!userId || !userBag) continue;
      affectedUserIds.push(userId);
      const flat = _flattenBagEntries(userBag);
      for (const e of flat) allEntries.push({ ...e, userId });
    }

    // 3. Delete all bag_items for these users in one shot
    if (affectedUserIds.length > 0) {
      const { error: delErr } = await sb.from('bag_items').delete().in('user_id', affectedUserIds);
      if (delErr) throw delErr;
    }

    // 4. Resolve all item names in two queries, then insert all rows
    if (allEntries.length > 0) {
      const allNames = [...new Set(allEntries.map(e => e.name))];
      const { itemIdByNameLower, homebrewIdByNameLower } = await _resolveItemNames(sb, allNames);

      const rows = [];
      for (const e of allEntries) {
        const nameLower = e.name.toLowerCase();
        rows.push({
          user_id:      e.userId,
          category:     e.category,
          display_name: e.name,
          quantity:     e.qty,
          sort_order:   e.sortOrder,
          item_id:      itemIdByNameLower[nameLower] ?? null,
          homebrew_id:  homebrewIdByNameLower[nameLower] ?? null,
          custom_name:  (!itemIdByNameLower[nameLower] && !homebrewIdByNameLower[nameLower]) ? e.name : null,
        });
      }
      const { error: insErr } = await sb.from('bag_items').insert(rows);
      if (insErr) throw insErr;
    }

    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] bags full sync failed:', err.message);
  }
}

// Sync entire snippets.json → Supabase user_snippets table.
async function syncAllUserSnippetsToSupabase(snippets) {
  try {
    const sb = getSupabase();
    if (!sb || !snippets) return;
    const discordIds = Object.keys(snippets).filter(k => /^\d+$/.test(k));
    if (discordIds.length === 0) return;
    const userMap = await _buildDiscordToUserMap(sb, discordIds);

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

// Sync entire server_snippets.json → Supabase guild_snippets table.
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

// Sync entire monster_art.json → Supabase monster_art table.
async function syncAllMonsterArtToSupabase(monsterArt) {
  try {
    const sb = getSupabase();
    if (!sb || !monsterArt) return;
    const upserts = Object.entries(monsterArt)
      .filter(([guildId, art]) => guildId && art)
      .map(([guildId, art]) => ({ discord_guild_id: String(guildId), art }));
    if (upserts.length === 0) return;
    const { error } = await sb.from('monster_art').upsert(upserts, { onConflict: 'discord_guild_id' });
    if (error) throw error;
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] monster art full sync failed:', err.message);
  }
}

// Sync entire monster_edits.json → Supabase monster_edits table.
async function syncAllMonsterEditsToSupabase(monsterEdits) {
  try {
    const sb = getSupabase();
    if (!sb || !monsterEdits) return;
    const upserts = Object.entries(monsterEdits)
      .filter(([guildId, edits]) => guildId && edits)
      .map(([guildId, edits]) => ({ discord_guild_id: String(guildId), edits }));
    if (upserts.length === 0) return;
    const { error } = await sb.from('monster_edits').upsert(upserts, { onConflict: 'discord_guild_id' });
    if (error) throw error;
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] monster edits full sync failed:', err.message);
  }
}

// Sync entire monster_attacks.json → Supabase monster_attacks table.
async function syncAllMonsterAttacksToSupabase(monsterAttacks) {
  try {
    const sb = getSupabase();
    if (!sb || !monsterAttacks) return;
    const upserts = Object.entries(monsterAttacks)
      .filter(([guildId, attacks]) => guildId && attacks)
      .map(([guildId, attacks]) => ({ discord_guild_id: String(guildId), attacks }));
    if (upserts.length === 0) return;
    const { error } = await sb.from('monster_attacks').upsert(upserts, { onConflict: 'discord_guild_id' });
    if (error) throw error;
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] monster attacks full sync failed:', err.message);
  }
}

// Sync bot-settings.json → Supabase guild_state.settings column.
async function syncAllBotSettingsToSupabase(botSettings) {
  try {
    const sb = getSupabase();
    if (!sb || !botSettings) return;
    for (const [guildId, settings] of Object.entries(botSettings)) {
      if (!guildId || !settings) continue;
      // Re-use the existing patch helper — just update the settings column.
      await syncGuildStateToSupabase(guildId, { settings });
    }
    _recordSyncSuccess();
  } catch (err) {
    _recordSyncFailure();
    console.error('[Supabase] bot settings full sync failed:', err.message);
  }
}

// ── Per-file sync dispatcher ──────────────────────────────────────────────────
// Called fire-and-forget from saveJson/mutateJson after every successful write.
// Maps filenames to their Supabase sync function. Unknown filenames are ignored.
function _syncFileToSupabase(filename, data) {
  if (!data) return;
  switch (filename) {
    case 'characters.json':
      _trackSync(syncAllCharactersToSupabase(data).catch(() => {}));
      break;
    case 'downtime.json':
      _trackSync(syncAllDowntimeToSupabase(data).catch(() => {}));
      break;
    case 'notes.json':
      _trackSync(syncAllNotesToSupabase(data).catch(() => {}));
      break;
    case 'bags.json':
      _trackSync(syncAllBagsToSupabase(data).catch(() => {}));
      break;
    case 'snippets.json':
      _trackSync(syncAllUserSnippetsToSupabase(data).catch(() => {}));
      break;
    case 'server_snippets.json':
      _trackSync(syncAllGuildSnippetsToSupabase(data).catch(() => {}));
      break;
    case 'monster_art.json':
      _trackSync(syncAllMonsterArtToSupabase(data).catch(() => {}));
      break;
    case 'monster_edits.json':
      _trackSync(syncAllMonsterEditsToSupabase(data).catch(() => {}));
      break;
    case 'monster_attacks.json':
      _trackSync(syncAllMonsterAttacksToSupabase(data).catch(() => {}));
      break;
    case 'bot-settings.json':
      _trackSync(syncAllBotSettingsToSupabase(data).catch(() => {}));
      break;
    // calendar-state.json and weather-state.json are synced per-mutation
    // by the calendar/weather command handlers via syncGuildStateToSupabase.
    // No bulk sync needed here.
    default:
      break;
  }
}

// patch: { calendar?: {...}|null, weather?: {...}|null }
// Uses patch semantics: only the provided keys are written, preserving
// the other column. First write does an insert; subsequent writes use
// column-level update so /calendar set doesn't wipe the weather column.
async function syncGuildStateToSupabase(guildId, patch) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const gid = String(guildId);

    // Try update first (row probably already exists after first bot use)
    const { data: existing, error: selectErr } = await sb
      .from('guild_state')
      .select('id')
      .eq('discord_guild_id', gid)
      .maybeSingle();
    if (selectErr) throw selectErr;

    if (existing) {
      const { error } = await sb
        .from('guild_state')
        .update(patch)
        .eq('discord_guild_id', gid);
      if (error) throw error;
    } else {
      const { error } = await sb
        .from('guild_state')
        .insert({ discord_guild_id: gid, ...patch });
      if (error) throw error;
    }
  } catch (err) {
    console.error('[Supabase] guild state sync failed:', err.message);
  }
}

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

// Pull all active characters for a Discord user from Supabase and merge any
// that aren't already in the local in-memory characters map. Returns the number
// of new entries added. Never throws — Supabase failures are silent.
async function mergeCharactersFromSupabase(discordId, charactersMap) {
  try {
    const sb = getSupabase();
    if (!sb) return 0;

    const { data: userRow } = await sb
      .from('users')
      .select('id')
      .eq('discord_id', discordId)
      .single();
    if (!userRow) return 0;

    const { data: rows } = await sb
      .from('characters')
      .select('char_key, pathbuilder_data, current_hp, overlay, dying, wounded, hero_points, discord_guild_id, updated_at')
      .eq('user_id', userRow.id)
      .eq('status', 'active');
    if (!rows || rows.length === 0) return 0;

    if (!charactersMap[discordId]) charactersMap[discordId] = {};
    let added = 0;
    for (const row of rows) {
      const key = row.char_key;
      if (!key) continue;
      // Only skip if the character exists locally AND was saved after the Supabase row.
      // This lets manual edits survive without being overwritten by stale Supabase data
      // mid-session, while still pulling new characters created on the web app.
      const local = charactersMap[discordId][key];
      if (local?.saved && row.updated_at && local.saved >= row.updated_at) continue;
      const build = row.pathbuilder_data?.build ?? row.pathbuilder_data;
      if (!build?.name) continue;
      charactersMap[discordId][key] = {
        name:       build.name,
        data:       build,
        hp:         row.current_hp ?? null,
        overlay:    row.overlay ?? {},
        dying:      row.dying ?? 0,
        wounded:    row.wounded ?? 0,
        heroPoints: row.hero_points ?? 1,
        guildId:    row.discord_guild_id ?? null,
        saved:      new Date().toISOString(),
      };
      added++;
    }
    return added;
  } catch (err) {
    console.error('[Supabase] character merge failed:', err.message);
    return 0;
  }
}

// ── Gamedata restore catalogue ────────────────────────────────────────────────
// Maps Supabase gamedata categories → the file/topKey shape the bot expects.
// 'array' strategy reconstructs an array (e.g. deities); all others rebuild
// a { [topKey]: { slug: entry } } object.
const GAMEDATA_RESTORE_MAP = [
  { category: 'actions',         file: 'actions.json',         topKey: 'actions',         strategy: 'slug_map' },
  { category: 'afflictions',     file: 'afflictions.json',     topKey: 'afflictions',     strategy: 'slug_map' },
  { category: 'backgrounds',     file: 'background.json',      topKey: 'backgrounds',     strategy: 'slug_map' },
  { category: 'class_features',  file: 'class-features.json',  topKey: 'class_features',  strategy: 'slug_map' },
  { category: 'classes',         file: 'classes.json',         topKey: 'classes',         strategy: 'slug_map' },
  { category: 'companions',      file: 'companions.json',      topKey: 'companions',      strategy: 'slug_map' },
  { category: 'conditions',      file: 'conditions.json',      topKey: 'Conditions',      strategy: 'slug_map' },
  { category: 'creature_extras', file: 'creature-extras.json', topKey: 'creature_extras', strategy: 'slug_map' },
  { category: 'deities',         file: 'deities.json',         topKey: 'deities',         strategy: 'array'    },
  { category: 'domains',         file: 'domains.json',         topKey: 'domains',         strategy: 'slug_map' },
  { category: 'familiars',       file: 'familiars.json',       topKey: 'familiars',       strategy: 'slug_map' },
  { category: 'hazards',         file: 'hazards.json',         topKey: 'hazards',         strategy: 'slug_map' },
  { category: 'heritages',       file: 'heritages.json',       topKey: 'by_slug',         strategy: 'slug_map' },
  { category: 'kingdom',         file: 'kingdom.json',         topKey: 'kingdom',         strategy: 'slug_map' },
  { category: 'languages',       file: 'languages.json',       topKey: 'languages',       strategy: 'slug_map' },
  { category: 'planes',          file: 'planes.json',          topKey: 'planes',          strategy: 'slug_map' },
  { category: 'relics',          file: 'relics.json',          topKey: 'relics',          strategy: 'slug_map' },
  { category: 'rituals',         file: 'rituals.json',         topKey: 'rituals',         strategy: 'slug_map' },
  { category: 'rules',           file: 'rules.json',           topKey: 'Rulebook',        strategy: 'slug_map' },
  { category: 'siege_weapons',   file: 'siege-weapons.json',   topKey: 'siege_weapons',   strategy: 'slug_map' },
  { category: 'skills',          file: 'skills.json',          topKey: 'skills',          strategy: 'slug_map' },
  { category: 'sources',         file: 'sources.json',         topKey: 'sources',         strategy: 'slug_map' },
  { category: 'traits',          file: 'traits.json',          topKey: 'traits',          strategy: 'slug_map' },
  { category: 'vehicles',        file: 'vehicles.json',        topKey: 'vehicles',        strategy: 'slug_map' },
];

// Maps REFERENCE_DATABASE_CONFIG command names → gamedata table category values.
// Used by loadReferenceDatabasesFromSupabase() to know which byCategory bucket
// to read for each slash-command reference database.
const REF_CMD_TO_CATEGORY = {
  action:        'actions',
  hazard:        'hazards',
  ritual:        'rituals',
  trait:         'traits',
  affliction:    'afflictions',
  language:      'languages',
  domain:        'domains',
  plane:         'planes',
  relic:         'relics',
  familiar:      'familiars',
  vehicle:       'vehicles',
  siege:         'siege_weapons',
  kingdom:       'kingdom',
  classfeature:  'class_features',
  creatureextra: 'creature_extras',
  sourcebook:    'sources',
};

// Kept for manual/migration use only. No longer called at startup —
// loadReferenceDatabasesFromSupabase() populates memory directly.
async function restoreGamedataFromSupabase(sb) {
  const { data: rows, error } = await sb
    .from('gamedata')
    .select('category, slug, data');
  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log('[Supabase] restore: gamedata table empty — using bundled files');
    return;
  }

  // Group rows by category
  const byCategory = {};
  for (const row of rows) {
    if (!row.category || !row.slug || !row.data) continue;
    if (!byCategory[row.category]) byCategory[row.category] = {};
    byCategory[row.category][row.slug] = row.data;
  }

  // Ensure gamedata/ directory exists (it may not on a fresh Railway container
  // if we've removed the files from git)
  try { fs.mkdirSync(GAMEDATA_DIR, { recursive: true }); } catch (_) {}

  let filesWritten = 0;
  for (const { category, file, topKey, strategy } of GAMEDATA_RESTORE_MAP) {
    const entries = byCategory[category];
    if (!entries || Object.keys(entries).length === 0) continue;
    const target = gamedataPath(file);
    const incomingCount = Object.keys(entries).length;
    const bundledCount = countGamedataEntriesOnDisk(target, topKey, strategy, category);
    if (bundledCount > incomingCount) {
      console.warn(
        `[Supabase] restore: skipped stale ${file} for category "${category}" ` +
        `(${incomingCount} Supabase entries < ${bundledCount} bundled entries)`
      );
      continue;
    }

    let payload;
    if (strategy === 'array') {
      payload = { [topKey]: Object.values(entries) };
    } else if (category === 'heritages') {
      // heritages.json needs both by_slug AND by_ancestry indexes.
      // by_ancestry was not stored in Supabase — rebuild it from by_slug.
      const byAncestry = {};
      for (const [slug, h] of Object.entries(entries)) {
        if (!h) continue;
        const ancestry = h.ancestry ?? null;
        if (!ancestry) {
          if (!byAncestry._versatile) byAncestry._versatile = [];
          byAncestry._versatile.push(slug);
        } else {
          const key = String(ancestry).toLowerCase();
          if (!byAncestry[key]) byAncestry[key] = [];
          byAncestry[key].push(slug);
        }
      }
      payload = { by_slug: entries, by_ancestry: byAncestry };
    } else {
      payload = { [topKey]: entries };
    }

    const tmp = `${target}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, target);
      filesWritten++;
    } catch (e) {
      console.error(`[Supabase] restore: failed to write ${file}:`, e.message);
    }
  }

  console.log(`[Supabase] restore: wrote ${filesWritten} gamedata files (${rows.length} total entries)`);
}

function countGamedataEntriesOnDisk(target, topKey, strategy, category) {
  try {
    if (!fs.existsSync(target)) return 0;
    const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (strategy === 'array') {
      const arr = raw?.[topKey];
      return Array.isArray(arr) ? arr.length : 0;
    }
    if (category === 'heritages') {
      return Object.keys(raw?.by_slug ?? {}).length;
    }
    const map = raw?.[topKey] ?? raw;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return 0;
    return Object.entries(map)
      .filter(([key]) => !['_meta', 'meta', 'metadata'].includes(key))
      .length;
  } catch {
    return 0;
  }
}

// ── Phase 3: load reference databases directly from Supabase (no disk writes) ──
//
// Replaces the restoreGamedataFromSupabase (disk write) +
// reloadDatabasesAfterRestore (disk read) two-step. Caller passes references
// to every in-place database object/array; this function mutates them directly.
//
// Databases NOT covered here (kept at their initial loadGamedata() values from
// bundled files): featDatabase, ancestryDatabase, archetypeDatabase,
// harvestRewardsDatabase, eberronDeityDatabase, eberronHouseDatabase.
//
// dbs must include:
//   bestiaryDatabase, spellDatabase, itemDatabase,
//   backgroundDatabase, rulesDatabase, heritageDatabase, heritagesByAncestry,
//   deityDatabase, eberronDeityDatabase, eberronHouseDatabase,
//   skillDatabase, classDatabase, companionDatabase, referenceDatabases,
//   ancestryDatabase, archetypeDatabase, featDatabase, harvestRewardsDatabase
async function loadReferenceDatabasesFromSupabase(dbs) {
  const sb = getSupabase();
  if (!sb) {
    console.warn('[startup] Supabase unavailable — reference databases use bundled files only');
    return;
  }

  // ── Typed table: monsters ────────────────────────────────────────────────────
  try {
    const { data: monsterRows, error } = await sb.from('monsters').select('monster_metadata');
    if (!error && monsterRows?.length > 0) {
      const freshCreatures = Object.fromEntries(
        monsterRows.map(r => [r.monster_metadata?.key, r.monster_metadata]).filter(([k, v]) => k && v)
      );
      // Clear non-homebrew entries then merge fresh canonical set
      for (const k of Object.keys(dbs.bestiaryDatabase)) {
        if (!dbs.bestiaryDatabase[k]?._homebrew) delete dbs.bestiaryDatabase[k];
      }
      Object.assign(dbs.bestiaryDatabase, freshCreatures);
      console.log(`[startup] bestiary: ${Object.keys(dbs.bestiaryDatabase).length} creatures`);
    }
  } catch (e) { console.error('[startup] bestiary load failed:', e.message); }

  // ── Typed table: spells ──────────────────────────────────────────────────────
  try {
    const { data: spellRows, error } = await sb.from('spells').select('spell_metadata');
    if (!error && spellRows?.length > 0) {
      const homebrew = dbs.spellDatabase.filter(s => s._homebrew);
      const fresh = spellRows.map(r => r.spell_metadata).filter(Boolean);
      dbs.spellDatabase.splice(0, dbs.spellDatabase.length, ...fresh, ...homebrew);
      console.log(`[startup] spells: ${dbs.spellDatabase.length}`);
    }
  } catch (e) { console.error('[startup] spells load failed:', e.message); }

  // ── Typed table: items ───────────────────────────────────────────────────────
  try {
    const { data: itemRows, error } = await sb.from('items').select('item_metadata');
    if (!error && itemRows?.length > 0) {
      const homebrew = dbs.itemDatabase.filter(i => i._homebrew);
      const fresh = itemRows.map(r => r.item_metadata).filter(i => i && typeof i.name === 'string' && i.name.length > 0);
      dbs.itemDatabase.splice(0, dbs.itemDatabase.length, ...fresh, ...homebrew);
      console.log(`[startup] items: ${dbs.itemDatabase.length}`);
    }
  } catch (e) { console.error('[startup] items load failed:', e.message); }

  // ── homebrew_entries → splice into typed databases ───────────────────────────
  try {
    const { data: homebrewRows, error } = await sb.from('homebrew_entries').select('type, entry_key, data');
    if (!error && homebrewRows?.length > 0) {
      let hbCount = 0;
      const norm = s => String(s ?? '').toLowerCase();
      for (const row of homebrewRows) {
        if (!row.type || !row.data) continue;
        if (row.type === 'monster' && row.entry_key) {
          dbs.bestiaryDatabase[row.entry_key] = { ...row.data, _homebrew: true };
          hbCount++;
        } else if (row.type === 'spell') {
          const name = norm(row.data.name);
          const idx = dbs.spellDatabase.findIndex(s => s._homebrew && norm(s.name) === name);
          if (idx >= 0) dbs.spellDatabase.splice(idx, 1, { ...row.data, _homebrew: true });
          else dbs.spellDatabase.push({ ...row.data, _homebrew: true });
          hbCount++;
        } else if (row.type === 'item') {
          const key = row.data.id || norm(row.data.name).replace(/\s+/g, '-');
          const idx = dbs.itemDatabase.findIndex(i =>
            i._homebrew && (i.id === key || norm(i.name) === norm(row.data.name))
          );
          if (idx >= 0) dbs.itemDatabase.splice(idx, 1, { ...row.data, _homebrew: true });
          else dbs.itemDatabase.push({ ...row.data, _homebrew: true });
          hbCount++;
        }
      }
      if (hbCount > 0) console.log(`[startup] homebrew: spliced ${hbCount} entries`);
    }
  } catch (e) { console.error('[startup] homebrew entries load failed:', e.message); }

  // ── gamedata table → backgrounds, rules, conditions, heritages, etc. ─────────
  try {
    const { data: gdRows, error } = await sb.from('gamedata').select('category, slug, data');
    if (error) throw error;
    if (!gdRows || gdRows.length === 0) {
      console.log('[startup] gamedata table empty — reference databases use bundled files');
      return;
    }

    const byCategory = {};
    for (const row of gdRows) {
      if (!row.category || !row.slug || !row.data) continue;
      if (!byCategory[row.category]) byCategory[row.category] = {};
      byCategory[row.category][row.slug] = row.data;
    }

    _mergeIntoObject(dbs.backgroundDatabase, byCategory.backgrounds, 'backgrounds');

    if (byCategory.rules) _mergeIntoObject(dbs.rulesDatabase, byCategory.rules, 'rules');
    if (byCategory.conditions) {
      dbs.rulesDatabase.Conditions = { ...(dbs.rulesDatabase.Conditions ?? {}), ...byCategory.conditions };
      console.log(`[startup] conditions: ${Object.keys(byCategory.conditions).length}`);
    }

    if (byCategory.heritages) {
      _mergeIntoObject(dbs.heritageDatabase, byCategory.heritages, 'heritages');
      const freshByAncestry = {};
      for (const [slug, h] of Object.entries(byCategory.heritages)) {
        if (!h) continue;
        const ancestry = h.ancestry ?? null;
        if (!ancestry) {
          (freshByAncestry._versatile = freshByAncestry._versatile ?? []).push(slug);
        } else {
          const ak = String(ancestry).toLowerCase();
          (freshByAncestry[ak] = freshByAncestry[ak] ?? []).push(slug);
        }
      }
      for (const k of Object.keys(dbs.heritagesByAncestry)) delete dbs.heritagesByAncestry[k];
      Object.assign(dbs.heritagesByAncestry, freshByAncestry);
    }

    // Eberron deities — processed before the main deities merge so deityDatabase
    // gets the Supabase version of both canonical and Eberron entries.
    if (byCategory.eberron_deities) {
      const fresh = Object.values(byCategory.eberron_deities).filter(d => d && typeof d.name === 'string' && d.name.length > 0);
      dbs.eberronDeityDatabase.splice(0, dbs.eberronDeityDatabase.length, ...fresh);
      console.log(`[startup] eberron_deities: ${dbs.eberronDeityDatabase.length}`);
    }
    if (byCategory.eberron_houses) {
      const fresh = Object.values(byCategory.eberron_houses).filter(h => h && typeof h.name === 'string' && h.name.length > 0);
      dbs.eberronHouseDatabase.splice(0, dbs.eberronHouseDatabase.length, ...fresh);
      console.log(`[startup] eberron_houses: ${dbs.eberronHouseDatabase.length}`);
    }

    if (byCategory.deities) {
      const fresh = Object.values(byCategory.deities).filter(d => d && typeof d.name === 'string' && d.name.length > 0);
      dbs.deityDatabase.splice(0, dbs.deityDatabase.length, ...fresh, ...dbs.eberronDeityDatabase);
      console.log(`[startup] deities: ${dbs.deityDatabase.length} (${dbs.eberronDeityDatabase.length} Eberron)`);
    }

    _mergeIntoObject(dbs.skillDatabase,  byCategory.skills,   'skills');
    _mergeIntoObject(dbs.classDatabase,  byCategory.classes,  'classes');

    if (byCategory.companions) {
      const fresh = Object.entries(byCategory.companions)
        .map(([slug, comp]) => ({ slug, ...comp }))
        .filter(c => c && typeof c.name === 'string' && c.name.length > 0);
      dbs.companionDatabase.splice(0, dbs.companionDatabase.length, ...fresh);
      console.log(`[startup] companion types: ${dbs.companionDatabase.length}`);
    }

    // Ancestries and archetypes (top-level slug maps, no wrapper key)
    _mergeIntoObject(dbs.ancestryDatabase,  byCategory.ancestries, 'ancestries');
    _mergeIntoObject(dbs.archetypeDatabase, byCategory.archetypes, 'archetypes');

    // Feats (stored as aon_id-keyed slug map; convert to array for the database)
    if (byCategory.feats) {
      const fresh = Object.values(byCategory.feats)
        .filter(f => f && typeof f.name === 'string' && f.name.length > 1);
      dbs.featDatabase.splice(0, dbs.featDatabase.length, ...fresh);
      console.log(`[startup] feats: ${dbs.featDatabase.length}`);
    }

    // Harvest rewards (one row per creature type; reconstruct { creature_types } shape)
    if (byCategory.harvest_rewards) {
      const types = {};
      for (const entry of Object.values(byCategory.harvest_rewards)) {
        if (!entry) continue;
        const typeName = entry.type_name;
        if (!typeName) continue;
        const { type_name: _, ...rest } = entry;
        types[typeName] = rest;
      }
      if (Object.keys(types).length > 0) {
        for (const k of Object.keys(dbs.harvestRewardsDatabase)) delete dbs.harvestRewardsDatabase[k];
        Object.assign(dbs.harvestRewardsDatabase, { creature_types: types });
        console.log(`[startup] harvest_rewards: ${Object.keys(types).length} types`);
      }
    }

    // REFERENCE_DATABASE_CONFIG entries (actions, hazards, rituals, traits, etc.)
    for (const [cmd, categoryKey] of Object.entries(REF_CMD_TO_CATEGORY)) {
      const entries = byCategory[categoryKey];
      if (!entries) continue;
      const arr = Object.values(entries).filter(e => e && typeof e.name === 'string' && e.name.length > 0);
      const db = dbs.referenceDatabases[cmd];
      if (db) {
        db.splice(0, db.length, ...arr.map(e => ({ ...e, _referenceCommand: cmd })));
        console.log(`[startup] ${cmd}: ${arr.length}`);
      }
    }

    // ── spell_effects → spellEffectsData ─────────────────────────────────────
    if (dbs.spellEffectsData && byCategory.spell_effects) {
      for (const [slug, entry] of Object.entries(byCategory.spell_effects)) {
        if (entry) dbs.spellEffectsData[slug] = entry;
      }
      console.log(`[startup] spell_effects: ${Object.keys(dbs.spellEffectsData).length} entries`);
    }

    // ── calendar_rules → calendarData ────────────────────────────────────────
    if (dbs.calendarData && byCategory.calendar_rules) {
      for (const [slug, entry] of Object.entries(byCategory.calendar_rules)) {
        if (entry) dbs.calendarData[slug] = entry;
      }
      console.log(`[startup] calendar_rules: ${Object.keys(dbs.calendarData).length} variants (${Object.keys(dbs.calendarData).join(', ')})`);
    }

    // ── weather_rules → weatherData ──────────────────────────────────────────
    if (dbs.weatherData && byCategory.weather_rules) {
      for (const [slug, entry] of Object.entries(byCategory.weather_rules)) {
        if (entry) dbs.weatherData[slug] = entry;
      }
      console.log(`[startup] weather_rules: ${Object.keys(dbs.weatherData).length} variants (${Object.keys(dbs.weatherData).join(', ')})`);
    }

    console.log(`[startup] gamedata: ${gdRows.length} entries → reference databases populated ✓`);
  } catch (e) { console.error('[startup] gamedata load failed:', e.message); }
}

function _mergeIntoObject(target, entries, label) {
  if (!entries || Object.keys(entries).length === 0) return;
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, entries);
  console.log(`[startup] ${label}: ${Object.keys(target).length}`);
}

// ── Startup restore from Supabase ─────────────────────────────────────────────
// Called once in clientReady BEFORE any user interaction is possible.
// Pulls every synced table back from Supabase at startup.
// Characters are returned directly (no JSON file write) so index.js can
// populate its in-memory cache without touching disk. All other data
// (bags, downtime, notes, guild state, etc.) is still written to local
// JSON files for now — those will migrate in Phase 2c-e.
//
// Returns { characters } on success, or undefined on failure.
async function restoreAllFromSupabase() {
  try {
    const sb = getSupabase();
    if (!sb) {
      console.log('[Supabase] restore skipped — no client (env vars not set)');
      return { characters: {}, bags: {}, downtime: {}, notes: {}, snippets: {}, serverSnippets: {}, monsterArt: {}, monsterEdits: {}, monsterAttacks: {}, calendarState: {}, weatherState: {}, botSettings: {} };
    }
    console.log('[Supabase] starting startup restore…');

    // ── 1. Fetch user map: discord_id → supabase user_id ────────────────────
    const { data: userRows, error: userErr } = await sb
      .from('users')
      .select('id, discord_id');
    if (userErr) throw userErr;
    if (!userRows || userRows.length === 0) {
      console.log('[Supabase] restore: no users found, skipping');
      return { characters: {}, bags: {}, downtime: {}, notes: {}, snippets: {}, serverSnippets: {}, monsterArt: {}, monsterEdits: {}, monsterAttacks: {}, calendarState: {}, weatherState: {}, botSettings: {} };
    }
    const bySupabaseId = Object.fromEntries(userRows.map(u => [u.id,    u.discord_id]));
    const byDiscordId  = Object.fromEntries(userRows.map(u => [u.discord_id, u.id]));

    // ── 2. Characters ────────────────────────────────────────────────────────
    // Build the characters map directly from Supabase — no JSON file read or
    // write. index.js uses the returned map to seed its charactersCache so
    // loadCharacters() returns Supabase data without touching disk.
    const { data: charRows, error: charErr } = await sb
      .from('characters')
      .select('user_id, char_key, name, pathbuilder_data, current_hp, overlay, dying, wounded, hero_points, discord_guild_id')
      .eq('status', 'active');
    if (charErr) throw charErr;

    const characters = {};
    for (const row of charRows ?? []) {
      const discordId = bySupabaseId[row.user_id];
      if (!discordId || !row.char_key) continue;
      const build = row.pathbuilder_data?.build ?? row.pathbuilder_data;
      if (!build?.name) continue;
      if (!characters[discordId]) characters[discordId] = {};
      characters[discordId][row.char_key] = {
        name:       build.name,
        data:       build,
        hp:         row.current_hp ?? null,
        overlay:    row.overlay ?? {},
        dying:      row.dying   ?? 0,
        wounded:    row.wounded ?? 0,
        heroPoints: row.hero_points ?? 1,
        guildId:    row.discord_guild_id ?? null,
        saved:      new Date().toISOString(),
      };
    }
    console.log(`[Supabase] restore: loaded ${charRows?.length ?? 0} characters`);

    // ── 2b. Companions from dedicated table ─────────────────────────────────
    const { data: compRows, error: compErr } = await sb
      .from('companions')
      .select('user_id, char_key, comp_key, display_name, base_type, form, notes, current_hp, custom_stats, is_active');
    if (compErr) throw compErr;

    for (const row of compRows ?? []) {
      const discordId = bySupabaseId[row.user_id];
      if (!discordId || !row.char_key || !row.comp_key) continue;
      const charEntry = characters[discordId]?.[row.char_key];
      if (!charEntry) continue;
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
    }
    console.log(`[Supabase] restore: loaded ${compRows?.length ?? 0} companions`);

    // ── 3. Bags ──────────────────────────────────────────────────────────────
    // Fetch bag metadata and normalized bag_items separately, then reconstruct
    // the local bags.json shape: { [discordId]: { bagName, categories: { Cat: [{name,qty}] } } }
    const { data: bagRows, error: bagErr } = await sb
      .from('bags')
      .select('user_id, bag_name');
    if (bagErr) throw bagErr;

    const { data: bagItemRows, error: biErr } = await sb
      .from('bag_items')
      .select('user_id, category, display_name, quantity, sort_order')
      .order('sort_order', { ascending: true });
    if (biErr) throw biErr;

    const bags = loadJson('bags.json', { default: {}, quiet: true }) || {};

    // Index bag_items by supabase user_id for fast lookup
    const itemsByUserId = {};
    for (const item of bagItemRows ?? []) {
      if (!itemsByUserId[item.user_id]) itemsByUserId[item.user_id] = [];
      itemsByUserId[item.user_id].push(item);
    }

    // Pull Supabase rows into local JSON (Supabase wins on conflict)
    const bagsInSupabase = new Set();
    for (const row of bagRows ?? []) {
      const discordId = bySupabaseId[row.user_id];
      if (!discordId) continue;
      bagsInSupabase.add(discordId);

      // Reconstruct categories from bag_items
      const categories = {};
      for (const item of itemsByUserId[row.user_id] ?? []) {
        const cat = item.category ?? 'General';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push({ name: item.display_name, qty: item.quantity ?? 1 });
      }

      bags[discordId] = { bagName: row.bag_name ?? 'Bag 1', categories };
    }

    // Backfill: push any local bags that Supabase doesn't know about yet
    let bagsUpserted = 0;
    for (const [discordId, userBag] of Object.entries(bags)) {
      if (bagsInSupabase.has(discordId)) continue;
      const supabaseUserId = byDiscordId[discordId];
      if (!supabaseUserId) continue;

      // Upsert bag metadata
      const { error: uErr } = await sb.from('bags').upsert({
        user_id:    supabaseUserId,
        bag_name:   userBag.bagName ?? 'Bag 1',
        categories: {},
      }, { onConflict: 'user_id' });
      if (uErr) { console.error(`[Supabase] bag backfill failed for ${discordId}:`, uErr.message); continue; }

      // Insert bag_items for backfilled user
      const entries = _flattenBagEntries(userBag);
      if (entries.length > 0) {
        const { itemIdByNameLower, homebrewIdByNameLower } =
          await _resolveItemNames(sb, entries.map(e => e.name));
        const rows = _buildBagItemRows(supabaseUserId, entries, itemIdByNameLower, homebrewIdByNameLower);
        const { error: biUErr } = await sb.from('bag_items').insert(rows);
        if (biUErr) console.error(`[Supabase] bag_items backfill failed for ${discordId}:`, biUErr.message);
      }
      bagsUpserted++;
    }

    // bags is collected for return — no atomicWriteJson
    console.log(`[Supabase] restore: loaded ${bagRows?.length ?? 0} bags (backfilled ${bagsUpserted} new)`);

    // ── 4. Downtime ──────────────────────────────────────────────────────────
    const { data: dtRows, error: dtErr } = await sb
      .from('downtime')
      .select('user_id, char_key, bank, last_accrual_date, log');
    if (dtErr) throw dtErr;

    const downtime = loadJson('downtime.json', { default: {}, quiet: true }) || {};
    for (const row of dtRows ?? []) {
      const discordId = bySupabaseId[row.user_id];
      if (!discordId || !row.char_key) continue;
      if (!downtime[discordId]) downtime[discordId] = {};
      downtime[discordId][row.char_key] = {
        bank:             row.bank ?? 0,
        lastAccrualDate:  row.last_accrual_date ?? null,
        log:              row.log ?? [],
      };
    }
    // downtime is collected for return — no atomicWriteJson
    console.log(`[Supabase] restore: loaded ${dtRows?.length ?? 0} downtime records`);

    // ── 5. User snippets ─────────────────────────────────────────────────────
    const { data: userSnipRows, error: usErr } = await sb
      .from('user_snippets')
      .select('user_id, snippets');
    if (usErr) throw usErr;

    const snippets = loadJson('snippets.json', { default: {}, quiet: true }) || {};

    // Pull Supabase rows into local JSON
    const snipsInSupabase = new Set();
    for (const row of userSnipRows ?? []) {
      const discordId = bySupabaseId[row.user_id];
      if (!discordId || !row.snippets) continue;
      snipsInSupabase.add(discordId);
      snippets[discordId] = row.snippets;
    }

    // Backfill: push any local snippet maps that Supabase doesn't know about yet
    let snipsUpserted = 0;
    for (const [discordId, userSnips] of Object.entries(snippets)) {
      if (snipsInSupabase.has(discordId) || !userSnips || Object.keys(userSnips).length === 0) continue;
      const supabaseUserId = byDiscordId[discordId];
      if (!supabaseUserId) continue;
      const { error: uErr } = await sb.from('user_snippets').upsert({
        user_id:  supabaseUserId,
        snippets: userSnips,
      }, { onConflict: 'user_id' });
      if (uErr) console.error(`[Supabase] snippet backfill failed for ${discordId}:`, uErr.message);
      else snipsUpserted++;
    }

    // snippets is collected for return — no atomicWriteJson
    console.log(`[Supabase] restore: loaded ${userSnipRows?.length ?? 0} user snippet sets (backfilled ${snipsUpserted} new)`);

    // ── 6. Guild snippets ────────────────────────────────────────────────────
    const { data: guildSnipRows, error: gsErr } = await sb
      .from('guild_snippets')
      .select('discord_guild_id, snippets');
    if (gsErr) throw gsErr;

    const serverSnippets = loadJson('server_snippets.json', { default: {}, quiet: true }) || {};
    for (const row of guildSnipRows ?? []) {
      if (!row.discord_guild_id || !row.snippets) continue;
      serverSnippets[row.discord_guild_id] = row.snippets;
    }
    // serverSnippets is collected for return — no atomicWriteJson
    console.log(`[Supabase] restore: loaded ${guildSnipRows?.length ?? 0} guild snippet sets`);

    // ── 7. Guild state: calendar + weather + settings ───────────────────────
    const { data: guildStateRows, error: gsStateErr } = await sb
      .from('guild_state')
      .select('discord_guild_id, calendar, weather, settings');
    if (gsStateErr) throw gsStateErr;

    const calState  = loadJson('calendar-state.json', { default: {}, quiet: true }) || {};
    const wxState   = loadJson('weather-state.json',  { default: {}, quiet: true }) || {};
    const botSettings = loadJson('bot-settings.json', { default: {}, quiet: true }) || {};

    for (const row of guildStateRows ?? []) {
      const gid = row.discord_guild_id;
      if (!gid) continue;

      const cal = row.calendar;
      if (cal?.year && cal?.month && cal?.day) {
        calState[gid] = { year: cal.year, month: cal.month, day: cal.day };
        // Also restore campaign setting from calendar (legacy path)
        if (cal.setting) {
          if (!botSettings[gid]) botSettings[gid] = {};
          botSettings[gid].campaignSetting = cal.setting;
        }
      }

      // Restore settings column (authoritative — overrides calendar.setting)
      if (row.settings && typeof row.settings === 'object') {
        botSettings[gid] = { ...(botSettings[gid] ?? {}), ...row.settings };
      }

      const wx = row.weather;
      if (wx?.climate && wx?.current) {
        // Restore current weather. yesterday = current (best approximation);
        // history is ephemeral and is dropped — bot regenerates it as play resumes.
        wxState[gid] = {
          climate:   wx.climate,
          season:    wx.season   ?? 'spring',
          day:       wx.day      ?? 1,
          current:   {
            temperatureF:                wx.temperatureF,
            temperatureCategory:         wx.temperatureCategory,
            effectiveTemperatureCategory: wx.effectiveTemperatureCategory ?? wx.temperatureCategory,
            precipitation:               wx.precipitation ?? 'none',
            wind:                        wx.wind          ?? 'calm',
            fog:                         wx.fog           ?? 'none',
            soaked:                      wx.soaked        ?? false,
          },
          yesterday: {
            temperatureF:                wx.temperatureF,
            temperatureCategory:         wx.temperatureCategory,
            effectiveTemperatureCategory: wx.effectiveTemperatureCategory ?? wx.temperatureCategory,
            precipitation:               wx.precipitation ?? 'none',
            wind:                        wx.wind          ?? 'calm',
            fog:                         wx.fog           ?? 'none',
            soaked:                      wx.soaked        ?? false,
          },
          history: [],
        };
      }
    }

    // calState, wxState, botSettings are collected for return — index.js seeds
    // the _jsonCaches map so loadJson/mutateJson use memory instead of disk.
    console.log(`[Supabase] restore: loaded guild state for ${guildStateRows?.length ?? 0} guilds`);

    // ── 7b. Monster attacks ──────────────────────────────────────────────────
    const monsterAttacks = loadJson('monster_attacks.json', { default: {}, quiet: true }) || {};
    const { data: attackRows, error: attackErr } = await sb
      .from('monster_attacks')
      .select('discord_guild_id, attacks');
    if (attackErr) {
      // Table may not exist yet (migration pending) — skip gracefully
      if (attackErr.code !== '42P01') throw attackErr;
      console.log('[Supabase] restore: monster_attacks table not yet migrated — skipping');
    } else {
      for (const row of attackRows ?? []) {
        if (!row.discord_guild_id) continue;
        monsterAttacks[row.discord_guild_id] = row.attacks ?? {};
      }
      // monsterAttacks is collected for return — no atomicWriteJson
      console.log(`[Supabase] restore: loaded monster attacks for ${attackRows?.length ?? 0} guilds`);
    }

    // ── 7c. Notes ────────────────────────────────────────────────────────────
    const { data: noteRows, error: noteErr } = await sb
      .from('character_notes')
      .select('user_id, char_key, next_id, notes');
    if (noteErr) throw noteErr;

    // Load disk notes (may be flat "discordId:charKey" keys, or nested from a prior buggy restore)
    const rawDiskNotes = loadJson('notes.json', { default: {}, quiet: true }) || {};

    // Normalize to flat key format: "discordId:charKey"
    const diskNotes = {};
    for (const [key, val] of Object.entries(rawDiskNotes)) {
      if (key.startsWith('_') || !val) continue;
      if (/^\d+$/.test(key) && typeof val === 'object') {
        // Nested format from a buggy previous restore — convert to flat
        for (const [charKey, book] of Object.entries(val)) {
          if (book && charKey && !charKey.startsWith('_')) diskNotes[`${key}:${charKey}`] = book;
        }
      } else if (key.includes(':')) {
        diskNotes[key] = val;  // already flat
      }
    }

    // Build final notes map: Supabase wins on conflict, backfill disk-only entries
    const notesInSupabase = new Set();
    const notes = { ...diskNotes };
    for (const row of noteRows ?? []) {
      const discordId = bySupabaseId[row.user_id];
      if (!discordId || !row.char_key) continue;
      const flatKey = `${discordId}:${row.char_key}`;
      notesInSupabase.add(flatKey);
      notes[flatKey] = { nextId: row.next_id ?? 1, notes: row.notes ?? [] };
    }

    // Backfill disk-only note books to Supabase (fixes the broken sync that never ran)
    let notesUpserted = 0;
    for (const [flatKey, book] of Object.entries(diskNotes)) {
      if (notesInSupabase.has(flatKey) || !book) continue;
      const colonIdx = flatKey.indexOf(':');
      if (colonIdx < 0) continue;
      const discordId = flatKey.slice(0, colonIdx);
      const charKey = flatKey.slice(colonIdx + 1);
      const userId = byDiscordId[discordId];
      if (!userId) continue;
      const { error: nbErr } = await sb.from('character_notes').upsert({
        user_id: userId, char_key: charKey, next_id: book.nextId ?? 1, notes: book.notes ?? [],
      }, { onConflict: 'user_id,char_key' });
      if (nbErr) console.error(`[Supabase] notes backfill failed for ${flatKey}:`, nbErr.message);
      else notesUpserted++;
    }
    console.log(`[Supabase] restore: loaded ${noteRows?.length ?? 0} note books (backfilled ${notesUpserted} new)`);
    // notes is collected for return — no atomicWriteJson

    // ── 7d. Monster art ──────────────────────────────────────────────────────
    const { data: artRows, error: artErr } = await sb
      .from('monster_art')
      .select('discord_guild_id, art');
    if (artErr) throw artErr;

    const monsterArt = loadJson('monster_art.json', { default: {}, quiet: true }) || {};
    for (const row of artRows ?? []) {
      if (!row.discord_guild_id) continue;
      monsterArt[row.discord_guild_id] = row.art ?? {};
    }
    // monsterArt is collected for return — no atomicWriteJson
    console.log(`[Supabase] restore: loaded monster art for ${artRows?.length ?? 0} guilds`);

    // ── 7e. Monster edits ────────────────────────────────────────────────────
    const { data: editRows, error: editErr } = await sb
      .from('monster_edits')
      .select('discord_guild_id, edits');
    if (editErr) throw editErr;

    const monsterEdits = loadJson('monster_edits.json', { default: {}, quiet: true }) || {};
    for (const row of editRows ?? []) {
      if (!row.discord_guild_id) continue;
      monsterEdits[row.discord_guild_id] = row.edits ?? {};
    }
    // monsterEdits is collected for return — no atomicWriteJson
    console.log(`[Supabase] restore: loaded monster edits for ${editRows?.length ?? 0} guilds`);

    // Steps 8 and 9 (homebrew + gamedata) are handled by
    // loadReferenceDatabasesFromSupabase() called separately in clientReady
    // after this function returns. They no longer write to disk.

    console.log('[Supabase] startup restore complete ✓');
    return { characters, bags, downtime, notes, snippets, serverSnippets, monsterArt, monsterEdits, monsterAttacks, calendarState: calState, weatherState: wxState, botSettings };
  } catch (err) {
    // Never crash the bot on a restore failure — log and continue.
    // Without a return value, index.js falls back to an empty caches.
    console.error('[Supabase] startup restore failed:', err.message);
  }
}

// ── Homebrew realtime sync ────────────────────────────────────────────────────
//
// Subscribes to Supabase Realtime postgres_changes on homebrew_entries.
// INSERT events immediately splice the entry into the relevant in-memory
// database; DELETE events remove it. Both mutations happen in-place so
// existing closures throughout index.js see the change immediately.
//
// Requires REPLICA IDENTITY FULL on homebrew_entries (migration applied)
// so DELETE payloads include all columns, not just the primary key.
//
// Call once after restoreAllFromSupabase() + reloadDatabasesAfterRestore().

function setupHomebrewRealtimeSync({ bestiaryDatabase, spellDatabase, itemDatabase }) {
  const sb = getSupabase();
  if (!sb) {
    console.warn('[homebrew:realtime] Supabase not available — live sync disabled');
    return;
  }

  function normalize(s) {
    return (s ?? '').toLowerCase().trim();
  }

  sb.channel('homebrew-live')
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'homebrew_entries',
    }, (payload) => {
      const { type, entry_key, name, data } = payload.new;
      try {
        if (type === 'monster') {
          bestiaryDatabase[entry_key] = { name, ...data };
          console.log(`[homebrew:realtime] + monster "${name}" (${entry_key})`);

        } else if (type === 'spell') {
          const entry = { name, ...data };
          const idx = spellDatabase.findIndex(
            s => normalize(s.name) === normalize(name) && s._homebrew
          );
          if (idx >= 0) spellDatabase.splice(idx, 1, entry);
          else spellDatabase.push(entry);
          console.log(`[homebrew:realtime] + spell "${name}"`);

        } else if (type === 'item') {
          const entry = { id: entry_key, name, ...data };
          const idx = itemDatabase.findIndex(i => i.id === entry_key);
          if (idx >= 0) itemDatabase.splice(idx, 1, entry);
          else itemDatabase.push(entry);
          console.log(`[homebrew:realtime] + item "${name}" (${entry_key})`);
        }
      } catch (err) {
        console.error(`[homebrew:realtime] INSERT handler error:`, err.message);
      }
    })
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'homebrew_entries',
    }, (payload) => {
      const { type, entry_key, name, data } = payload.new;
      // For spells the in-memory lookup is by name, not entry_key — use
      // payload.old.name so a rename still finds and replaces the right entry.
      const oldName = payload.old?.name ?? name;
      try {
        if (type === 'monster') {
          // entry_key never changes on PATCH; replace in-place by key
          bestiaryDatabase[entry_key] = { name, ...data };
          console.log(`[homebrew:realtime] ~ monster "${name}" (${entry_key})`);

        } else if (type === 'spell') {
          const entry = { name, ...data };
          // First try to find by old name (handles renames)
          const byOldName = spellDatabase.findIndex(
            s => normalize(s.name) === normalize(oldName) && s._homebrew
          );
          if (byOldName >= 0) {
            spellDatabase.splice(byOldName, 1, entry);
          } else {
            // Fall back to new name in case of partial state
            const byNewName = spellDatabase.findIndex(
              s => normalize(s.name) === normalize(name) && s._homebrew
            );
            if (byNewName >= 0) spellDatabase.splice(byNewName, 1, entry);
            else spellDatabase.push(entry);
          }
          console.log(`[homebrew:realtime] ~ spell "${name}"`);

        } else if (type === 'item') {
          const entry = { id: entry_key, name, ...data };
          const idx = itemDatabase.findIndex(i => i.id === entry_key);
          if (idx >= 0) itemDatabase.splice(idx, 1, entry);
          else itemDatabase.push(entry);
          console.log(`[homebrew:realtime] ~ item "${name}" (${entry_key})`);
        }
      } catch (err) {
        console.error(`[homebrew:realtime] UPDATE handler error:`, err.message);
      }
    })
    .on('postgres_changes', {
      event:  'DELETE',
      schema: 'public',
      table:  'homebrew_entries',
    }, (payload) => {
      const { type, entry_key, name } = payload.old;
      try {
        if (type === 'monster') {
          delete bestiaryDatabase[entry_key];
          console.log(`[homebrew:realtime] - monster "${name}" (${entry_key})`);

        } else if (type === 'spell') {
          const idx = spellDatabase.findIndex(
            s => normalize(s.name) === normalize(name) && s._homebrew
          );
          if (idx >= 0) {
            spellDatabase.splice(idx, 1);
            console.log(`[homebrew:realtime] - spell "${name}"`);
          }

        } else if (type === 'item') {
          const idx = itemDatabase.findIndex(i => i.id === entry_key);
          if (idx >= 0) {
            itemDatabase.splice(idx, 1);
            console.log(`[homebrew:realtime] - item "${name}" (${entry_key})`);
          }
        }
      } catch (err) {
        console.error(`[homebrew:realtime] DELETE handler error:`, err.message);
      }
    })
    .subscribe((status, err) => {
      if (err) {
        console.error('[homebrew:realtime] subscription error:', err.message);
      } else {
        console.log(`[homebrew:realtime] ${status}`);
      }
    });
}

module.exports = {
  DATA_DIR,
  dataPath,
  gamedataPath,
  loadJson,
  loadGamedata,
  mutateJson,
  seedJsonCache,
  getSupabase,
  isSyncDegraded,
  restoreAllFromSupabase,
  loadReferenceDatabasesFromSupabase,
  // Companion sync (Phase 1 — dedicated companions table)
  syncCompanionToSupabase,
  deleteCompanionFromSupabase,
  syncAllCompanionsToSupabase,
  // Single-record sync (used by command handlers that know which record changed)
  syncAllCharactersToSupabase,
  syncDowntimeToSupabase,
  syncEncounterToSupabase,
  endEncounterInSupabase,
  logEncounterEvent,
  mergeCharactersFromSupabase,
  syncNotesToSupabase,
  syncGuildStateToSupabase,
  syncBagToSupabase,
  syncHomebrewEntryToSupabase,
  deleteHomebrewEntryFromSupabase,
  syncUserSnippetsToSupabase,
  syncGuildSnippetsToSupabase,
  syncMonsterArtToSupabase,
  syncMonsterEditsToSupabase,
  // Batch "whole file" sync (called automatically from saveJson/mutateJson)
  syncAllDowntimeToSupabase,
  syncAllNotesToSupabase,
  syncAllBagsToSupabase,
  syncAllUserSnippetsToSupabase,
  syncAllGuildSnippetsToSupabase,
  syncAllMonsterArtToSupabase,
  syncAllMonsterEditsToSupabase,
  syncAllMonsterAttacksToSupabase,
  syncAllBotSettingsToSupabase,
  setupHomebrewRealtimeSync,
  drainSupabaseSyncs,
};
