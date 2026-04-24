// utils/storage.js
// Persistent-data directory handling and generic JSON load/save helpers.
// This consolidates the ~10 copy-pasted try/catch JSON loaders from index.js
// and the dataPath() / force-reseed / homebrew-preservation logic from the
// top of index.js.

'use strict';

const fs = require('fs');
const path = require('path');

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

// Simple save-JSON helper for user-data files (characters, bags, notes, etc.)
// Not atomic — use atomicWriteJson for critical shared files like bestiary.
function saveJson(filename, data) {
  fs.writeFileSync(dataPath(filename), JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  DATA_DIR,
  dataPath,
  atomicWriteJson,
  loadJson,
  saveJson,
  shouldForceReseed,
  preserveHomebrewDuringReseed,
};