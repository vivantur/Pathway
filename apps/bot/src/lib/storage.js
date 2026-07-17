// lib/storage.js
//
// Storage infrastructure for the bot. After Phase 1 this module is no longer
// a kitchen sink — it owns:
//
//   • Persistent-data paths (DATA_DIR, dataPath, force-reseed logic)
//   • File write queue + atomic JSON write
//   • In-memory JSON cache (seedJsonCache / loadJson / saveJson / mutateJson)
//   • The filename → sync function dispatcher (_syncFileToSupabase)
//   • Startup restore from Supabase (restoreAllFromSupabase)
//   • Reference-database loader (loadReferenceDatabasesFromSupabase)
//
// The per-table sync functions themselves live in src/state/*.js. This file
// re-exports them at the bottom so existing call sites in index.js keep
// working unchanged.
//
// Phase 2 will move the restore orchestrator + per-table caches into the
// state modules and add Realtime subscriptions there.

'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const { getSupabase } = require('./supabase');
const {
  _trackSync,
  drainSupabaseSyncs,
  isSyncDegraded,
} = require('./syncTracker');

// State modules — imported here so:
//   1. _syncFileToSupabase can dispatch JSON-cache writes to the right table sync.
//   2. restoreAllFromSupabase can use character + bag helpers during startup.
//   3. The barrel re-export at the bottom preserves the legacy import surface.
const characterState = require('../state/characters');
const companionState = require('../state/companions');
const bagState       = require('../state/bags');
const downtimeState  = require('../state/downtime');
const noteState      = require('../state/notes');
const snippetState   = require('../state/snippets');
const monsterState   = require('../state/monster');
const homebrewState  = require('../state/homebrew');
const guildState     = require('../state/guild');
const xpLogState     = require('../state/xpLog');

// Phase 2: character + bag helpers are no longer used inline by restoreAll
// — characterState.restore() and bagState.restore() own those sections now.

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

// ── gamedata/ ARCHIVED ───────────────────────────────────────────────────────
// The gamedata/ JSON files are no longer read at runtime. All reference data
// (bestiary, spells, items, feats, conditions, etc.) is loaded from Supabase
// at startup by loadReferenceDatabasesFromSupabase().
// The archive is preserved in git tag: gamedata-archive-20260506
function gamedataPath(_filename) {
  throw new Error(
    '[gamedata] gamedataPath() is no longer available — gamedata/ has been archived. ' +
    'All reference data loads from Supabase at startup via loadReferenceDatabasesFromSupabase(). ' +
    'See git tag gamedata-archive-20260506 to recover the source files.'
  );
}

function loadGamedata(_filename, _opts) {
  throw new Error(
    '[gamedata] loadGamedata() is no longer available — gamedata/ has been archived. ' +
    'All reference data loads from Supabase at startup via loadReferenceDatabasesFromSupabase(). ' +
    'See git tag gamedata-archive-20260506 to recover the source files.'
  );
}

// ── Per-filename write queue + atomic write ─────────────────────────────────
// Two users running commands at nearly the same instant could each call
//   1. loadJson('characters.json')   ← both read same content
//   2. modify their slot in memory
//   3. saveJson('characters.json', data)  ← second write CLOBBERS first
// The fix: queue writes per-filename. Each file has its own promise chain;
// the next save waits for the previous one to complete before starting.
const writeQueues = new Map();

function queueWrite(filename, task) {
  const prev = writeQueues.get(filename) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  writeQueues.set(filename, next);
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

// ── In-memory JSON cache ────────────────────────────────────────────────────
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
  if (!fromRepo && _jsonCaches.has(filename)) {
    const raw = _jsonCaches.get(filename);
    return transform ? transform(raw) : raw;
  }

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
    if (!quiet) {
      console.error(`Could not load ${filename}:`, err.message);
    }
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
// The mutator may be sync or async. Throwing from it aborts the write
// (the file is left untouched) and the error propagates to the caller.
function mutateJson(filename, opts, mutator) {
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
      atomicWriteJson(filename, current);
      _syncFileToSupabase(filename, current);
      return current;
    }
    atomicWriteJson(filename, next);
    _syncFileToSupabase(filename, next);
    return next;
  });
}

// ── Per-file sync dispatcher ──────────────────────────────────────────────────
// Called fire-and-forget from saveJson/mutateJson after every successful write.
// Maps filenames to their Supabase sync function (now sourced from state/*).
// Unknown filenames are ignored.
function _syncFileToSupabase(filename, data) {
  if (!data) return;
  switch (filename) {
    case 'characters.json':
      _trackSync(characterState.syncAllCharactersToSupabase(data).catch(() => {}));
      break;
    case 'downtime.json':
      _trackSync(downtimeState.syncAllDowntimeToSupabase(data).catch(() => {}));
      break;
    case 'notes.json':
      _trackSync(noteState.syncAllNotesToSupabase(data).catch(() => {}));
      break;
    case 'bags.json':
      _trackSync(bagState.syncAllBagsToSupabase(data).catch(() => {}));
      break;
    case 'snippets.json':
      _trackSync(snippetState.syncAllUserSnippetsToSupabase(data).catch(() => {}));
      break;
    case 'server_snippets.json':
      _trackSync(snippetState.syncAllGuildSnippetsToSupabase(data).catch(() => {}));
      break;
    case 'monster_art.json':
      _trackSync(monsterState.syncAllMonsterArtToSupabase(data).catch(() => {}));
      break;
    case 'monster_edits.json':
      _trackSync(monsterState.syncAllMonsterEditsToSupabase(data).catch(() => {}));
      break;
    case 'monster_attacks.json':
      _trackSync(monsterState.syncAllMonsterAttacksToSupabase(data).catch(() => {}));
      break;
    case 'bot-settings.json':
      _trackSync(guildState.syncAllBotSettingsToSupabase(data).catch(() => {}));
      break;
    // calendar-state.json and weather-state.json are synced per-mutation
    // by the calendar/weather command handlers via syncGuildStateToSupabase.
    default:
      break;
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

// ARCHIVED — restoreGamedataFromSupabase() wrote Supabase data back to disk.
// That two-step (Supabase → disk → memory) has been replaced by
// loadReferenceDatabasesFromSupabase() which populates memory directly.
async function restoreGamedataFromSupabase(_sb) {
  throw new Error(
    '[gamedata] restoreGamedataFromSupabase() is no longer available — ' +
    'gamedata/ has been archived. Reference data loads directly into memory via ' +
    'loadReferenceDatabasesFromSupabase(). See git tag gamedata-archive-20260506.'
  );
}

// ── Load reference databases directly from Supabase (authoritative) ─────────
async function loadReferenceDatabasesFromSupabase(dbs) {
  const sb = getSupabase();
  if (!sb) {
    throw new Error(
      '[startup] FATAL: Supabase is unavailable — reference databases cannot be loaded. ' +
      'The bot requires a live Supabase connection at startup. ' +
      'Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.'
    );
  }

  async function fetchAllRows(table, columns) {
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from(table)
        .select(columns)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (data?.length) rows.push(...data);
      if (!data?.length || data.length < PAGE) break;
    }
    return rows;
  }

  // ── Typed table: monsters ────────────────────────────────────────────────
  try {
    const monsterRows = await fetchAllRows('monsters', 'monster_metadata');
    if (monsterRows.length > 0) {
      const freshCreatures = Object.fromEntries(
        monsterRows.map(r => [r.monster_metadata?.key, r.monster_metadata]).filter(([k, v]) => k && v)
      );
      for (const k of Object.keys(dbs.bestiaryDatabase)) {
        if (!dbs.bestiaryDatabase[k]?._homebrew) delete dbs.bestiaryDatabase[k];
      }
      Object.assign(dbs.bestiaryDatabase, freshCreatures);
      console.log(`[startup] bestiary: ${Object.keys(dbs.bestiaryDatabase).length} creatures`);
    }
  } catch (e) { console.error('[startup] bestiary load failed:', e.message); }

  // ── Typed table: spells ──────────────────────────────────────────────────
  try {
    // Also pull the top-level `associations` column (populated by the AoN import)
    // and merge it into each spell object so /spell can show mysteries/bloodlines/
    // deities/domains. Fall back to spell_metadata-only if the column isn't there
    // yet, so a missing migration can never break spell loading.
    let spellRows;
    try {
      spellRows = await fetchAllRows('spells', 'spell_metadata, associations');
    } catch {
      spellRows = await fetchAllRows('spells', 'spell_metadata');
    }
    if (spellRows.length > 0) {
      const homebrew = dbs.spellDatabase.filter(s => s._homebrew);
      const fresh = spellRows
        .map(r => (r.spell_metadata && r.associations
          ? { ...r.spell_metadata, associations: r.associations }
          : r.spell_metadata))
        .filter(s => s && typeof s.name === 'string' && s.name.length > 0);
      dbs.spellDatabase.splice(0, dbs.spellDatabase.length, ...fresh, ...homebrew);
      console.log(`[startup] spells: ${dbs.spellDatabase.length}`);
    }
  } catch (e) { console.error('[startup] spells load failed:', e.message); }

  // ── Typed table: items ───────────────────────────────────────────────────
  try {
    const itemRows = await fetchAllRows('items', 'item_metadata');
    if (itemRows.length > 0) {
      const homebrew = dbs.itemDatabase.filter(i => i._homebrew);
      const fresh = itemRows.map(r => r.item_metadata).filter(i => i && typeof i.name === 'string' && i.name.length > 0);
      dbs.itemDatabase.splice(0, dbs.itemDatabase.length, ...fresh, ...homebrew);
      console.log(`[startup] items: ${dbs.itemDatabase.length}`);
    }
  } catch (e) { console.error('[startup] items load failed:', e.message); }

  // ── homebrew_entries → splice into typed databases ───────────────────────
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

  // ── gamedata table → backgrounds, rules, conditions, heritages, etc. ─────
  try {
    const gdRows = await fetchAllRows('gamedata', 'category, slug, data');
    if (!gdRows || gdRows.length === 0) {
      throw new Error(
        '[startup] FATAL: gamedata table is empty — reference databases cannot be loaded. ' +
        'Run the seeder to populate it: ' +
        'cd web/frontend && npx tsx scripts/seed_gamedata_supabase.ts'
      );
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

    _mergeIntoObject(dbs.ancestryDatabase,  byCategory.ancestries, 'ancestries');
    _mergeIntoObject(dbs.archetypeDatabase, byCategory.archetypes, 'archetypes');

    if (byCategory.feats) {
      const fresh = Object.values(byCategory.feats)
        .filter(f => f && typeof f.name === 'string' && f.name.length > 1);
      dbs.featDatabase.splice(0, dbs.featDatabase.length, ...fresh);
      console.log(`[startup] feats: ${dbs.featDatabase.length}`);
    }

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

    if (dbs.spellEffectsData && byCategory.spell_effects) {
      for (const [slug, entry] of Object.entries(byCategory.spell_effects)) {
        if (entry) dbs.spellEffectsData[slug] = entry;
      }
      console.log(`[startup] spell_effects: ${Object.keys(dbs.spellEffectsData).length} entries`);
    }

    if (dbs.calendarData && byCategory.calendar_rules) {
      for (const [slug, entry] of Object.entries(byCategory.calendar_rules)) {
        if (entry) dbs.calendarData[slug] = entry;
      }
      console.log(`[startup] calendar_rules: ${Object.keys(dbs.calendarData).length} variants (${Object.keys(dbs.calendarData).join(', ')})`);
    }

    if (dbs.weatherData && byCategory.weather_rules) {
      for (const [slug, entry] of Object.entries(byCategory.weather_rules)) {
        if (entry) dbs.weatherData[slug] = entry;
      }
      console.log(`[startup] weather_rules: ${Object.keys(dbs.weatherData).length} variants (${Object.keys(dbs.weatherData).join(', ')})`);
    }

    console.log(`[startup] gamedata: ${gdRows.length} entries → reference databases populated ✓`);
    _fillRuleFallbacks(dbs.calendarData, 'calendar', ['golarion', 'eberron']);
    _fillRuleFallbacks(dbs.weatherData, 'weather', ['golarion', 'eberron']);
  } catch (e) { console.error('[startup] gamedata load failed:', e.message); }
}

function _mergeIntoObject(target, entries, label) {
  if (!entries || Object.keys(entries).length === 0) return;
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, entries);
  console.log(`[startup] ${label}: ${Object.keys(target).length}`);
}

function _loadSupabaseRuleFallback(kind, slug) {
  const file = path.join(__dirname, '..', '..', 'supabase', `${kind}-rules`, `${slug}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const { _meta: _ignored, ...runtimeRules } = parsed;
    return runtimeRules;
  } catch (e) {
    console.warn(`[startup] ${kind}_rules fallback ${slug} failed:`, e.message);
    return null;
  }
}

function _fillRuleFallbacks(target, kind, slugs) {
  if (!target) return;
  for (const slug of slugs) {
    if (target[slug]) continue;
    const fallback = _loadSupabaseRuleFallback(kind, slug);
    if (fallback) {
      target[slug] = fallback;
      console.warn(`[startup] ${kind}_rules.${slug}: using supabase directory fallback; seed Supabase to make it authoritative.`);
    }
  }
}

// ── Startup restore from Supabase ─────────────────────────────────────────────
// Called once in clientReady BEFORE any user interaction is possible.
// Pulls every synced table back from Supabase. Returns { characters, bags,
// downtime, notes, snippets, serverSnippets, monsterArt, monsterEdits,
// monsterAttacks, calendarState, weatherState, botSettings } so index.js can
// seed its in-memory caches without touching disk.
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
      .select('id, discord_id, active_char_key');
    if (userErr) throw userErr;
    if (!userRows || userRows.length === 0) {
      console.log('[Supabase] restore: no users found, skipping');
      return { characters: {}, bags: {}, downtime: {}, notes: {}, snippets: {}, serverSnippets: {}, monsterArt: {}, monsterEdits: {}, monsterAttacks: {}, calendarState: {}, weatherState: {}, botSettings: {} };
    }
    const bySupabaseId = Object.fromEntries(userRows.map(u => [u.id,    u.discord_id]));
    const byDiscordId  = Object.fromEntries(userRows.map(u => [u.discord_id, u.id]));

    // Phase 2: hand the user map to state modules that subscribe BEFORE
    // restoreAll. They use it to resolve Realtime user_id → discord_id and
    // to drain any events that queued up while they waited for the map.
    companionState.attachUserMap(bySupabaseId);

    // ── 2 + 2b + 2c. Characters + companions + _activeChar ──────────────────
    // Phase 2: state/characters owns the cache + Realtime. It also pulls
    // companions (initial hydration only — Realtime mutations for companions
    // flow through state/companions, which patches the same cache) and the
    // active_char_key sentinel from each user row.
    const characters = await characterState.restore(sb, { bySupabaseId, userRows });
    await xpLogState.restore(sb, { bySupabaseId });

    // ── 3. Bags (Phase 2: delegated to state/bags) ──────────────────────────
    const diskBags = loadJson('bags.json', { default: {}, quiet: true }) || {};
    const bags = await bagState.restore(sb, { bySupabaseId, byDiscordId }, diskBags);

    // ── 4. Downtime (Phase 2: delegated to state/downtime) ──────────────────
    const diskDowntime = loadJson('downtime.json', { default: {}, quiet: true }) || {};
    const downtime = await downtimeState.restore(sb, { bySupabaseId }, diskDowntime);

    // ── 5+6. Snippets (Phase 2: delegated to state/snippets) ────────────────
    const diskUserSnippets  = loadJson('snippets.json',         { default: {}, quiet: true }) || {};
    const diskGuildSnippets = loadJson('server_snippets.json',  { default: {}, quiet: true }) || {};
    const { user: snippets, guild: serverSnippets } = await snippetState.restore(
      sb,
      { bySupabaseId, byDiscordId },
      { diskUserSnippets, diskGuildSnippets },
    );

    // ── 7. Guild state (Phase 2: delegated to state/guild) ──────────────────
    const diskCalState    = loadJson('calendar-state.json', { default: {}, quiet: true }) || {};
    const diskWxState     = loadJson('weather-state.json',  { default: {}, quiet: true }) || {};
    const diskBotSettings = loadJson('bot-settings.json',   { default: {}, quiet: true }) || {};
    const { calState, wxState, botSettings } = await guildState.restore(sb, {
      diskCalState, diskWxState, diskBotSettings,
    });

    // ── 7b/7d/7e. Monster art/edits/attacks (Phase 2: delegated) ────────────
    const diskMonsterArt     = loadJson('monster_art.json',     { default: {}, quiet: true }) || {};
    const diskMonsterEdits   = loadJson('monster_edits.json',   { default: {}, quiet: true }) || {};
    const diskMonsterAttacks = loadJson('monster_attacks.json', { default: {}, quiet: true }) || {};
    const { art: monsterArt, edits: monsterEdits, attacks: monsterAttacks } =
      await monsterState.restore(sb, {
        diskArt:     diskMonsterArt,
        diskEdits:   diskMonsterEdits,
        diskAttacks: diskMonsterAttacks,
      });

    // ── 7c. Notes (Phase 2: delegated to state/notes) ───────────────────────
    // state/notes owns its cache + Realtime subscription. We still parse the
    // legacy disk notes.json here (since lib/storage owns disk I/O), then
    // hand them to notes.restore() which hydrates its cache from Supabase
    // and one-time-backfills any disk-only books.
    const rawDiskNotes = loadJson('notes.json', { default: {}, quiet: true }) || {};
    const diskNotes = {};
    for (const [key, val] of Object.entries(rawDiskNotes)) {
      if (key.startsWith('_') || !val) continue;
      if (/^\d+$/.test(key) && typeof val === 'object') {
        for (const [charKey, book] of Object.entries(val)) {
          if (book && charKey && !charKey.startsWith('_')) diskNotes[`${key}:${charKey}`] = book;
        }
      } else if (key.includes(':')) {
        diskNotes[key] = val;
      }
    }
    const notes = await noteState.restore(sb, { bySupabaseId, byDiscordId }, diskNotes);

    // Steps 8 and 9 (homebrew + gamedata) are handled by
    // loadReferenceDatabasesFromSupabase() called separately in clientReady.

    console.log('[Supabase] startup restore complete ✓');
    return { characters, bags, downtime, notes, snippets, serverSnippets, monsterArt, monsterEdits, monsterAttacks, calendarState: calState, weatherState: wxState, botSettings };
  } catch (err) {
    console.error('[Supabase] startup restore failed:', err.message);
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────
// Barrel: re-exports the per-table sync functions from state/* so existing
// imports in index.js continue to work unchanged. Phase 2 will gradually move
// index.js call sites to import directly from state/* and this barrel will
// shrink to just the infrastructure surface.
module.exports = {
  // Infrastructure
  DATA_DIR,
  dataPath,
  loadJson,
  mutateJson,
  seedJsonCache,
  getSupabase,
  isSyncDegraded,
  drainSupabaseSyncs,
  restoreAllFromSupabase,
  loadReferenceDatabasesFromSupabase,

  // Characters
  syncAllCharactersToSupabase: characterState.syncAllCharactersToSupabase,
  syncActiveCharacterToSupabase: characterState.syncActiveCharacterToSupabase,
  mergeCharactersFromSupabase: characterState.mergeCharactersFromSupabase,

  // Companions
  syncCompanionToSupabase: companionState.syncCompanionToSupabase,
  deleteCompanionFromSupabase: companionState.deleteCompanionFromSupabase,
  syncAllCompanionsToSupabase: companionState.syncAllCompanionsToSupabase,

  // Bags
  syncBagToSupabase: bagState.syncBagToSupabase,
  syncAllBagsToSupabase: bagState.syncAllBagsToSupabase,

  // Downtime
  syncDowntimeToSupabase: downtimeState.syncDowntimeToSupabase,
  syncAllDowntimeToSupabase: downtimeState.syncAllDowntimeToSupabase,

  // Notes
  syncNotesToSupabase: noteState.syncNotesToSupabase,
  syncAllNotesToSupabase: noteState.syncAllNotesToSupabase,

  // Snippets
  syncUserSnippetsToSupabase: snippetState.syncUserSnippetsToSupabase,
  syncAllUserSnippetsToSupabase: snippetState.syncAllUserSnippetsToSupabase,
  syncGuildSnippetsToSupabase: snippetState.syncGuildSnippetsToSupabase,
  syncAllGuildSnippetsToSupabase: snippetState.syncAllGuildSnippetsToSupabase,

  // Monster customization
  syncMonsterArtToSupabase: monsterState.syncMonsterArtToSupabase,
  syncAllMonsterArtToSupabase: monsterState.syncAllMonsterArtToSupabase,
  syncMonsterEditsToSupabase: monsterState.syncMonsterEditsToSupabase,
  syncAllMonsterEditsToSupabase: monsterState.syncAllMonsterEditsToSupabase,
  syncAllMonsterAttacksToSupabase: monsterState.syncAllMonsterAttacksToSupabase,

  // Encounters: none. state/combat.js imports state/encounters.js directly.
  // (`logEncounterEvent` was re-exported here and called by nobody.)

  // Homebrew
  syncHomebrewEntryToSupabase: homebrewState.syncHomebrewEntryToSupabase,
  deleteHomebrewEntryFromSupabase: homebrewState.deleteHomebrewEntryFromSupabase,
  setupHomebrewRealtimeSync: homebrewState.setupHomebrewRealtimeSync,

  // Guild state
  syncGuildStateToSupabase: guildState.syncGuildStateToSupabase,
  syncAllBotSettingsToSupabase: guildState.syncAllBotSettingsToSupabase,
};
