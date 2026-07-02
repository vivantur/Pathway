// ── reference/databases.js ──────────────────────────────────────────────────
// In-memory PF2e reference databases.
//
// Populated once at clientReady by lib/storage.js's
// `loadReferenceDatabasesFromSupabase(dbs)`, which writes into these
// objects/arrays by mutation (never reassignment). After load, every
// command and embed reads from them as fixed references.
//
// Why this file exists (Phase 3.13): commands extracted into
// src/commands/<name>/ need to read these databases to render embeds and
// resolve user input. Before this extraction, the databases lived as
// module-level vars in index.js and were not importable. Moving them here
// is a pure relocation — index.js imports them and continues to pass them
// to `loadReferenceDatabasesFromSupabase` exactly as before.
//
// The databases are mutated in place at startup; consumers should treat
// them as read-only after load.

// PF2e typed reference tables
const spellDatabase = [];
const bestiaryDatabase = {};
const itemDatabase = [];

// Pathbuilder / gamedata-derived reference
const ancestryDatabase = {};
const harvestRewardsDatabase = { creature_types: {} };
const archetypeDatabase = {};
const backgroundDatabase = {};
const featDatabase = [];
const rulesDatabase = {};

// Heritages — primary table + an ancestry-keyed index for /heritage filtering.
const heritageDatabase = {};
const heritagesByAncestry = {};

// Deities (canonical + Eberron variant), Eberron houses.
const deityDatabase = [];
const eberronDeityDatabase = [];
const eberronHouseDatabase = [];

const skillDatabase = {};
const classDatabase = {};
const companionDatabase = [];

// Generic reference tables registered by REFERENCE_DATABASE_CONFIG below.
// One array per command name; populated alongside the others at startup.
const REFERENCE_DATABASE_CONFIG = {
  action:        { file: 'actions.json',         key: 'actions',          label: 'actions and activities', icon: '⚡', color: 0x2ecc71 },
  hazard:        { file: 'hazards.json',         key: 'hazards',          label: 'hazards', icon: '⚠️', color: 0xe67e22 },
  ritual:        { file: 'rituals.json',         key: 'rituals',          label: 'rituals', icon: '🕯️', color: 0x8e44ad },
  trait:         { file: 'traits.json',          key: 'traits',           label: 'traits', icon: '🏷️', color: 0xf39c12 },
  affliction:    { file: 'afflictions.json',     key: 'afflictions',      label: 'afflictions', icon: '☣️', color: 0x8b0000 },
  language:      { file: 'languages.json',       key: 'languages',        label: 'languages', icon: '🗣️', color: 0x3498db },
  domain:        { file: 'domains.json',         key: 'domains',          label: 'domains', icon: '⛩️', color: 0x9b59b6 },
  plane:         { file: 'planes.json',          key: 'planes',           label: 'planes', icon: '🌌', color: 0x34495e },
  relic:         { file: 'relics.json',          key: 'relics',           label: 'relics', icon: '💎', color: 0x16a085 },
  familiar:      { file: 'familiars.json',       key: 'familiars',        label: 'familiars', icon: '🐾', color: 0x27ae60 },
  vehicle:       { file: 'vehicles.json',        key: 'vehicles',         label: 'vehicles', icon: '🛞', color: 0x95a5a6 },
  siege:         { file: 'siege-weapons.json',   key: 'siege_weapons',    label: 'siege weapons', icon: '🏹', color: 0x7f8c8d },
  kingdom:       { file: 'kingdom.json',         key: 'kingdom',          label: 'kingdom entries', icon: '🏰', color: 0xd4ac0d },
  classfeature:  { file: 'class-features.json',  key: 'class_features',   label: 'class features', icon: '🎓', color: 0x4a90d9 },
  creatureextra: { file: 'creature-extras.json', key: 'creature_extras',  label: 'creature extras', icon: '🧬', color: 0x1abc9c },
  sourcebook:    { file: 'sources.json',         key: 'sources',          label: 'sources', icon: '📚', color: 0x7289da },
};

const referenceDatabases = Object.fromEntries(
  Object.keys(REFERENCE_DATABASE_CONFIG).map(k => [k, []])
);

module.exports = {
  // Typed PF2e tables
  spellDatabase,
  bestiaryDatabase,
  itemDatabase,

  // Pathbuilder / gamedata
  ancestryDatabase,
  harvestRewardsDatabase,
  archetypeDatabase,
  backgroundDatabase,
  featDatabase,
  rulesDatabase,
  heritageDatabase,
  heritagesByAncestry,

  // Deities + houses
  deityDatabase,
  eberronDeityDatabase,
  eberronHouseDatabase,

  // Skills, classes, companions
  skillDatabase,
  classDatabase,
  companionDatabase,

  // Generic reference lookups (action/hazard/ritual/...)
  REFERENCE_DATABASE_CONFIG,
  referenceDatabases,
};
