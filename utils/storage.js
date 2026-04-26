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

// ── Per-file write serialization ────────────────────────────────────────────
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
    // ENOENT (file-not-found) is the expected case for state files on first
    // use — there's no data to load yet, so the default is correct. Honor
    // the quiet flag so callers can suppress these expected-first-use logs
    // (calendar-state.json, weather-state.json, etc.). Other errors (corrupt
    // JSON, permission denied, etc.) always log so we don't lose visibility
    // into real problems.
    if (!(quiet && err.code === 'ENOENT')) {
      console.error(`Could not load ${filename}:`, err.message);
    }
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

module.exports = {
  DATA_DIR,
  dataPath,
  atomicWriteJson,
  loadJson,
  saveJson,
  mutateJson,
  backupJsonToGitHub,
  shouldForceReseed,
  preserveHomebrewDuringReseed,
};