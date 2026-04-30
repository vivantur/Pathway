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

// Atomic write to gamedata/. Used by /spelladd /itemadd /monsteradd to
// persist homebrew additions. Note: in production on Railway, gamedata/
// is part of the deployed image — writes here will be lost on redeploy
// unless committed to git. The user accepted this trade-off for simplicity
// (homebrew is rare; you can re-run `/spelladd` after a redeploy if needed).
function atomicWriteGamedata(filename, payload) {
  const target = gamedataPath(filename);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, target);
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

const GITHUB_BACKUP_FILES = new Set(
  String(process.env.GITHUB_BACKUP_FILES || 'characters.json')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

function githubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repo) return null;
  return { token, repo, branch };
}

async function backupJsonToGitHub(filename, data) {
  if (!GITHUB_BACKUP_FILES.has(filename)) return { skipped: true };
  const cfg = githubConfig();
  if (!cfg) return { skipped: true };

  const apiUrl = `https://api.github.com/repos/${cfg.repo}/contents/${encodeURIComponent(filename)}`;
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Pathway-Bot',
  };

  let sha = null;
  const current = await fetch(`${apiUrl}?ref=${encodeURIComponent(cfg.branch)}`, { headers });
  if (current.ok) {
    const body = await current.json();
    sha = body.sha;
  } else if (current.status !== 404) {
    throw new Error(`GitHub read failed for ${filename}: ${current.status} ${await current.text()}`);
  }

  const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64');
  const update = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `Backup ${filename} from Pathway`,
      content,
      branch: cfg.branch,
      sha,
    }),
  });

  if (!update.ok) {
    throw new Error(`GitHub write failed for ${filename}: ${update.status} ${await update.text()}`);
  }
  return { ok: true };
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

// Save a JSON file safely. This is the ONE function index.js (and any
// command handler) should call to persist user data. It guarantees:
//
//   1. ATOMIC WRITES — temp file + rename, so a crash mid-write can't
//      leave a corrupt or half-written file on the volume.
//   2. SERIALIZED WRITES — concurrent calls for the same filename queue
//      up instead of racing at the filesystem level.
//   3. GITHUB BACKUP — fire-and-forget commit of files listed in
//      GITHUB_BACKUP_FILES (default: characters.json) to your repo,
//      giving you a recoverable history of every save.
//
// IMPORTANT: saveJson alone does NOT fix the read-modify-write race that
// happens when two handlers do `load → modify → save` concurrently — both
// load the same starting state, both modify their copy, the second save
// overwrites the first. For files where multiple users may write at once
// (especially characters.json), use mutateJson() instead, which serializes
// the entire load-modify-save cycle.
//
// Returns a Promise. Most callers don't need to await it (the in-memory
// state is already correct), but you can await if you want to confirm
// the durable write succeeded before proceeding.
function saveJson(filename, data) {
  return queueWrite(filename, async () => {
    atomicWriteJson(filename, data);
    try {
      await backupJsonToGitHub(filename, data);
    } catch (err) {
      console.error(`GitHub backup failed for ${filename}:`, err.message);
    }
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
      try { await backupJsonToGitHub(filename, current); }
      catch (err) { console.error(`GitHub backup failed for ${filename}:`, err.message); }
      return current;
    }
    atomicWriteJson(filename, next);
    try { await backupJsonToGitHub(filename, next); }
    catch (err) { console.error(`GitHub backup failed for ${filename}:`, err.message); }
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

function _recordSyncSuccess() { _syncConsecutiveFailures = 0; }
function _recordSyncFailure() { _syncConsecutiveFailures++; }

// Returns true if Supabase syncs have been failing repeatedly.
// Call this at the start/end of an encounter to warn the GM.
function isSyncDegraded() { return _syncConsecutiveFailures >= SYNC_DEGRADED_THRESHOLD; }

// Sync all characters from the in-memory map to Supabase.
// Called after saveCharacters so the web app sees current data.
// Only syncs users who have already signed into the web app (have a users row).
async function syncAllCharactersToSupabase(characters) {
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
    if (!userRows || userRows.length === 0) return;

    const userMap = Object.fromEntries(userRows.map(u => [u.discord_id, u.id]));

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

async function syncBagToSupabase(discordId, userBag) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { data: userRow } = await sb.from('users').select('id').eq('discord_id', discordId).single();
    if (!userRow) return;
    const { error } = await sb.from('bags').upsert({
      user_id:    userRow.id,
      bag_name:   userBag.bagName ?? 'Bag 1',
      categories: userBag.categories ?? {},
    }, { onConflict: 'user_id' });
    if (error) throw error;
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

// ── Startup restore from Supabase ─────────────────────────────────────────────
// Called once in clientReady BEFORE any user interaction is possible.
// Pulls every synced table back into local JSON so the bot always boots from
// Supabase truth rather than stale (or missing) volume files.
//
// Safe to run on a healthy restart — it only OVERWRITES fields that exist in
// Supabase; it never deletes local-only data.
async function restoreAllFromSupabase() {
  try {
    const sb = getSupabase();
    if (!sb) {
      console.log('[Supabase] restore skipped — no client (env vars not set)');
      return;
    }
    console.log('[Supabase] starting startup restore…');

    // ── 1. Fetch user map: discord_id → supabase user_id ────────────────────
    const { data: userRows, error: userErr } = await sb
      .from('users')
      .select('id, discord_id');
    if (userErr) throw userErr;
    if (!userRows || userRows.length === 0) {
      console.log('[Supabase] restore: no users found, skipping');
      return;
    }
    const bySupabaseId = Object.fromEntries(userRows.map(u => [u.id,    u.discord_id]));
    const byDiscordId  = Object.fromEntries(userRows.map(u => [u.discord_id, u.id]));

    // ── 2. Characters ────────────────────────────────────────────────────────
    const { data: charRows, error: charErr } = await sb
      .from('characters')
      .select('user_id, char_key, name, pathbuilder_data, current_hp, overlay, dying, wounded, hero_points, discord_guild_id')
      .eq('status', 'active');
    if (charErr) throw charErr;

    const characters = loadJson('characters.json', { default: {}, quiet: true }) || {};
    for (const row of charRows ?? []) {
      const discordId = bySupabaseId[row.user_id];
      if (!discordId || !row.char_key) continue;
      const build = row.pathbuilder_data?.build ?? row.pathbuilder_data;
      if (!build?.name) continue;
      if (!characters[discordId]) characters[discordId] = {};
      // Always overwrite from Supabase — it is the source of truth.
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
    atomicWriteJson(dataPath('characters.json'), characters);
    console.log(`[Supabase] restore: wrote ${charRows?.length ?? 0} characters`);

    // ── 3. Bags ──────────────────────────────────────────────────────────────
    const { data: bagRows, error: bagErr } = await sb
      .from('bags')
      .select('user_id, bag_name, categories');
    if (bagErr) throw bagErr;

    const bags = loadJson('bags.json', { default: {}, quiet: true }) || {};
    for (const row of bagRows ?? []) {
      const discordId = bySupabaseId[row.user_id];
      if (!discordId) continue;
      bags[discordId] = { bagName: row.bag_name ?? 'Bag 1', categories: row.categories ?? {} };
    }
    atomicWriteJson(dataPath('bags.json'), bags);
    console.log(`[Supabase] restore: wrote ${bagRows?.length ?? 0} bags`);

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
    atomicWriteJson(dataPath('downtime.json'), downtime);
    console.log(`[Supabase] restore: wrote ${dtRows?.length ?? 0} downtime records`);

    // ── 5. User snippets ─────────────────────────────────────────────────────
    const { data: userSnipRows, error: usErr } = await sb
      .from('user_snippets')
      .select('user_id, snippets');
    if (usErr) throw usErr;

    const snippets = loadJson('snippets.json', { default: {}, quiet: true }) || {};
    for (const row of userSnipRows ?? []) {
      const discordId = bySupabaseId[row.user_id];
      if (!discordId || !row.snippets) continue;
      snippets[discordId] = row.snippets;
    }
    atomicWriteJson(dataPath('snippets.json'), snippets);
    console.log(`[Supabase] restore: wrote ${userSnipRows?.length ?? 0} user snippet sets`);

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
    atomicWriteJson(dataPath('server_snippets.json'), serverSnippets);
    console.log(`[Supabase] restore: wrote ${guildSnipRows?.length ?? 0} guild snippet sets`);

    // ── 7. Guild state: calendar + weather ──────────────────────────────────
    const { data: guildStateRows, error: gsStateErr } = await sb
      .from('guild_state')
      .select('discord_guild_id, calendar, weather');
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
        // Also restore campaign setting (golarion / eberron)
        if (cal.setting) {
          if (!botSettings[gid]) botSettings[gid] = {};
          botSettings[gid].campaignSetting = cal.setting;
        }
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

    atomicWriteJson(dataPath('calendar-state.json'), calState);
    atomicWriteJson(dataPath('weather-state.json'),  wxState);
    atomicWriteJson(dataPath('bot-settings.json'),   botSettings);
    console.log(`[Supabase] restore: wrote guild state for ${guildStateRows?.length ?? 0} guilds`);

    // ── 8. Homebrew entries (monsters, spells, items) ────────────────────────
    // These are written into gamedata/ (which resets on every Railway deploy).
    // By restoring from Supabase at startup, /spelladd and /monsteradd content
    // survives redeploys without manual re-entry.
    const { data: homebrewRows, error: hbErr } = await sb
      .from('homebrew_entries')
      .select('type, entry_key, data');
    if (hbErr) throw hbErr;

    const homebrewByType = { monster: {}, spell: [], item: [] };
    for (const row of homebrewRows ?? []) {
      if (!row.type || !row.data) continue;
      if (row.type === 'monster' && row.entry_key) {
        homebrewByType.monster[row.entry_key] = { ...row.data, _homebrew: true };
      } else if (row.type === 'spell') {
        homebrewByType.spell.push({ ...row.data, _homebrew: true });
      } else if (row.type === 'item') {
        homebrewByType.item.push({ ...row.data, _homebrew: true });
      }
    }

    // Monsters — bestiary.json shape: { metadata?, creatures: { slug: entry } }
    if (Object.keys(homebrewByType.monster).length > 0) {
      try {
        const existing = JSON.parse(fs.readFileSync(gamedataPath('bestiary.json'), 'utf8'));
        const metadata = existing.metadata ?? null;
        const creatures = existing.creatures ?? existing;
        const merged = { ...creatures, ...homebrewByType.monster };
        const payload = metadata ? { metadata, creatures: merged } : { creatures: merged };
        atomicWriteGamedata('bestiary.json', payload);
      } catch (e) {
        console.error('[Supabase] restore: bestiary patch failed:', e.message);
      }
    }

    // Spells — spells.json shape: flat array
    if (homebrewByType.spell.length > 0) {
      try {
        const existing = JSON.parse(fs.readFileSync(gamedataPath('spells.json'), 'utf8'));
        const canonical = Array.isArray(existing) ? existing : [];
        const homebrewNames = new Set(homebrewByType.spell.map(s => String(s.name).toLowerCase()));
        // Remove any stale homebrew entries with the same name, then append fresh
        const merged = canonical.filter(s => !s._homebrew || !homebrewNames.has(String(s.name).toLowerCase()))
          .concat(homebrewByType.spell);
        atomicWriteGamedata('spells.json', merged);
      } catch (e) {
        console.error('[Supabase] restore: spells patch failed:', e.message);
      }
    }

    // Items — items.json shape: { meta?, items: { slug: entry } }
    if (homebrewByType.item.length > 0) {
      try {
        const existing = JSON.parse(fs.readFileSync(gamedataPath('items.json'), 'utf8'));
        const meta = existing.meta ?? null;
        const itemsMap = existing.items ?? existing;
        for (const item of homebrewByType.item) {
          const key = item.id || String(item.name).toLowerCase().replace(/\s+/g, '-');
          itemsMap[key] = { ...item, _homebrew: true };
        }
        const payload = meta ? { meta, items: itemsMap } : { items: itemsMap };
        atomicWriteGamedata('items.json', payload);
      } catch (e) {
        console.error('[Supabase] restore: items patch failed:', e.message);
      }
    }

    const hbCount = Object.keys(homebrewByType.monster).length + homebrewByType.spell.length + homebrewByType.item.length;
    console.log(`[Supabase] restore: spliced ${hbCount} homebrew entries into gamedata`);

    console.log('[Supabase] startup restore complete ✓');
  } catch (err) {
    // Never crash the bot on a restore failure — log and continue.
    // The bot will run from whatever JSON files are on disk.
    console.error('[Supabase] startup restore failed:', err.message);
  }
}

module.exports = {
  DATA_DIR,
  GAMEDATA_DIR,
  dataPath,
  gamedataPath,
  atomicWriteJson,
  atomicWriteGamedata,
  loadJson,
  loadGamedata,
  saveJson,
  mutateJson,
  backupJsonToGitHub,
  shouldForceReseed,
  preserveHomebrewDuringReseed,
  getSupabase,
  isSyncDegraded,
  restoreAllFromSupabase,
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
};