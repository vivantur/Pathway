require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ── Persistent-data directory ────────────────────────────────────────────────
// On Railway, mount a volume at /app/data (or wherever DATA_DIR points) so
// user state (characters, bags, monster art/edits, notes, homebrew DB adds)
// survives redeploys. When DATA_DIR is unset (local dev), falls back to the
// project root so behavior matches the old layout.
const DATA_DIR = process.env.DATA_DIR || __dirname;
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (_) { /* ignore — e.g. volume not writable yet */ }

// Returns an absolute path inside DATA_DIR for a given filename. For files
// that ship with the repo as base content (bestiary, spells, items), we
// seed the data-dir copy on first boot by copying from the repo.
function dataPath(filename, { seedFromRepo = false } = {}) {
  const target = path.join(DATA_DIR, filename);
  if (seedFromRepo && !fs.existsSync(target)) {
    const repoCopy = path.join(__dirname, filename);
    if (fs.existsSync(repoCopy)) {
      try {
        fs.copyFileSync(repoCopy, target);
        console.log(`Seeded ${filename} from repo into DATA_DIR.`);
      } catch (err) {
        console.error(`Failed to seed ${filename} into DATA_DIR:`, err.message);
      }
    }
  }
  return target;
}

console.log(`DATA_DIR: ${DATA_DIR}`);

const {
  getEncounter,
  createEncounter,
  deleteEncounter,
  addCombatant,
  removeCombatant,
  advanceTurn,
  modifyHp,
  setSummaryMessageId,
  findCombatant,
  addEffect,
  removeEffect,
  clearEffects,
} = require('./encounters');
const { getPreset, listPresets } = require('./effects');
const { parseStatBlock: parseBestiaryStatBlock, toSlug: bestiarySlug } = require('./bestiaryParser');
const { parseSpellStatBlock, toSlug: spellSlug } = require('./spellParser');
const { parseItemStatBlock,  toSlug: itemSlug  } = require('./itemParser');
const charOverlay = require('./characterOverlay');
const ca = require('./combatAutomation');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});

process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

// Critical: discord.js emits 'error' events on the Client when something goes
// wrong (network blips, expired interactions, rate-limit issues). If nothing
// listens for that event, Node treats it as a fatal error and crashes the
// process. Logging it here keeps the bot alive across transient errors.
client.on('error', error => {
  console.error('Discord client error:', error);
});

// Same for shard errors (if running sharded, which we're not, but defensive).
client.on('shardError', error => {
  console.error('Discord shard error:', error);
});

// Catch uncaught exceptions to prevent crashes from synchronous errors too.
process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

let spellDatabase = [];
try {
  spellDatabase = JSON.parse(fs.readFileSync(dataPath('spells.json', { seedFromRepo: true }), 'utf8'));
  console.log(`Loaded ${spellDatabase.length} spells from database.`);
} catch (err) {
  console.error('Could not load spells.json:', err.message);
}

let ancestryDatabase = {};
try {
  ancestryDatabase = JSON.parse(fs.readFileSync('ancestries.json', 'utf8'));
  console.log(`Loaded ${Object.keys(ancestryDatabase).length} ancestries from database.`);
} catch (err) {
  console.error('Could not load ancestries.json:', err.message);
}

let archetypeDatabase = {};
try {
  archetypeDatabase = JSON.parse(fs.readFileSync('archetypes.json', 'utf8'));
  console.log(`Loaded ${Object.keys(archetypeDatabase).length} archetypes from database.`);
} catch (err) {
  console.error('Could not load archetypes.json:', err.message);
}

let backgroundDatabase = {};
try {
  const backgroundRaw = JSON.parse(fs.readFileSync('background.json', 'utf8'));
  // File shape: { _meta: {...}, backgrounds: { key: {...} } }
  backgroundDatabase = backgroundRaw.backgrounds ?? backgroundRaw;
  console.log(`Loaded ${Object.keys(backgroundDatabase).length} backgrounds from database.`);
} catch (err) {
  console.error('Could not load background.json:', err.message);
}

let featDatabase = [];
try {
  const featRaw = JSON.parse(fs.readFileSync('feats.json', 'utf8'));
  // File shape: { metadata: {...}, feats: [ {...} ] }
  const rawFeats = Array.isArray(featRaw) ? featRaw : (featRaw.feats ?? []);
  // Filter out parser garbage (feats with 1-character names like "U")
  featDatabase = rawFeats.filter(f => f && typeof f.name === 'string' && f.name.length > 1);
  console.log(`Loaded ${featDatabase.length} feats from database.`);
} catch (err) {
  console.error('Could not load feats.json:', err.message);
}

let rulesDatabase = {};
try {
  rulesDatabase = JSON.parse(fs.readFileSync('rules.json', 'utf8'));
  const total = Object.values(rulesDatabase).reduce((sum, cat) => sum + Object.keys(cat).length, 0);
  console.log(`Loaded ${total} rules entries from database.`);
} catch (err) {
  console.error('Could not load rules.json:', err.message);
}

let bestiaryDatabase = {};
try {
  const bestiaryRaw = JSON.parse(fs.readFileSync(dataPath('bestiary.json', { seedFromRepo: true }), 'utf8'));
  // File shape: { metadata: {...}, creatures: { key: {...} } }
  bestiaryDatabase = bestiaryRaw.creatures ?? bestiaryRaw;
  console.log(`Loaded ${Object.keys(bestiaryDatabase).length} creatures from bestiary.`);
} catch (err) {
  console.error('Could not load bestiary.json:', err.message);
}

// ── Bestiary mutation helpers ─────────────────────────────────────────────────
// /monsteradd writes to the global bestiary.json. Keep this locked to the bot
// owner via BOT_OWNER_ID env var, since this bot is public and any server could
// otherwise pollute the global dataset.
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || null;

function isBotOwner(userId) {
  return BOT_OWNER_ID && String(userId) === String(BOT_OWNER_ID);
}

// Atomic write: dump to a temp file, fsync, then rename. If anything goes wrong
// mid-write, bestiary.json is either the old version or the new version — never
// a half-written file.
function persistBestiary() {
  // Re-read metadata so we don't blow it away, and rewrite the whole file
  // with updated creatures.
  let metadata = null;
  try {
    const existing = JSON.parse(fs.readFileSync(dataPath('bestiary.json'), 'utf8'));
    metadata = existing.metadata ?? null;
  } catch (_) { /* ignore, we'll write without metadata */ }

  const payload = { creatures: bestiaryDatabase };
  if (metadata) payload.metadata = metadata;
  // Put metadata first for readability, but JSON key order is just cosmetic
  const ordered = metadata ? { metadata, creatures: bestiaryDatabase } : payload;

  const tmp = dataPath('bestiary.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(ordered, null, 2), 'utf8');
  fs.renameSync(tmp, dataPath('bestiary.json'));
}

function addMonsterToBestiary(entry, slug) {
  // If a key collision happens, append _2, _3, ... so we don't overwrite.
  let finalSlug = slug;
  let counter = 2;
  while (bestiaryDatabase[finalSlug]) {
    finalSlug = `${slug}_${counter}`;
    counter++;
  }
  bestiaryDatabase[finalSlug] = entry;
  persistBestiary();
  return finalSlug;
}

function removeMonsterFromBestiary(slugOrName) {
  // Accept either a slug or a display name. Return { removed, key } or { removed: false }.
  if (bestiaryDatabase[slugOrName]) {
    const removed = bestiaryDatabase[slugOrName];
    delete bestiaryDatabase[slugOrName];
    persistBestiary();
    return { removed: true, key: slugOrName, name: removed.name };
  }
  const normalize = s => String(s ?? '').toLowerCase().trim();
  const match = Object.entries(bestiaryDatabase).find(([, m]) => normalize(m.name) === normalize(slugOrName));
  if (match) {
    delete bestiaryDatabase[match[0]];
    persistBestiary();
    return { removed: true, key: match[0], name: match[1].name };
  }
  return { removed: false };
}

// ── Spell database mutation helpers ───────────────────────────────────────────
// spells.json is a flat array on disk. Atomic temp-file write, same as bestiary.
function persistSpells() {
  const tmp = dataPath('spells.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(spellDatabase, null, 2), 'utf8');
  fs.renameSync(tmp, dataPath('spells.json'));
}

function addSpellToDatabase(entry) {
  const normalize = s => String(s ?? '').toLowerCase().trim();
  let finalName = entry.name;
  let counter = 1;
  while (spellDatabase.some(s => normalize(s.name) === normalize(finalName))) {
    counter++;
    finalName = counter === 2 ? `${entry.name} (Homebrew)` : `${entry.name} (Homebrew ${counter})`;
  }
  entry.name = finalName;
  spellDatabase.push(entry);
  persistSpells();
  return finalName;
}

function removeSpellFromDatabase(nameOrSlug) {
  const normalize = s => String(s ?? '').toLowerCase().trim();
  const q = normalize(nameOrSlug);
  const idx = spellDatabase.findIndex(s => normalize(s.name) === q);
  if (idx < 0) return { removed: false };
  const removed = spellDatabase[idx];
  // Only allow removal of entries flagged as homebrew. Core spells are protected.
  if (!removed._homebrew) {
    return { removed: false, protected: true, name: removed.name };
  }
  spellDatabase.splice(idx, 1);
  persistSpells();
  return { removed: true, name: removed.name };
}

let itemDatabase = [];
try {
  const itemRaw = JSON.parse(fs.readFileSync(dataPath('items.json', { seedFromRepo: true }), 'utf8'));
  // File shape: { meta: {...}, items: { slug: {...} } }
  const itemsObj = itemRaw.items ?? itemRaw;
  // Flatten to array and filter out any malformed entries
  itemDatabase = Object.values(itemsObj).filter(i => i && typeof i.name === 'string' && i.name.length > 0);
  console.log(`Loaded ${itemDatabase.length} items from database.`);
} catch (err) {
  console.error('Could not load items.json:', err.message);
}

// ── Item database mutation helpers ────────────────────────────────────────────
// itemDatabase is a flat array in memory, but items.json on disk is
// { meta, items: { slug: {...} } }. Persist rebuilds the map from the array.
function persistItems() {
  let meta = null;
  try {
    const existing = JSON.parse(fs.readFileSync(dataPath('items.json'), 'utf8'));
    meta = existing.meta ?? null;
  } catch (_) { /* ignore */ }

  const itemsMap = {};
  for (const item of itemDatabase) {
    const key = item.id || itemSlug(item.name);
    itemsMap[key] = item;
  }
  const payload = meta ? { meta, items: itemsMap } : { items: itemsMap };

  const tmp = dataPath('items.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, dataPath('items.json'));
}

function addItemToDatabase(entry) {
  const normalize = s => String(s ?? '').toLowerCase().trim();
  let finalName = entry.name;
  let finalId = entry.id;
  let counter = 1;
  while (itemDatabase.some(i => normalize(i.name) === normalize(finalName) || i.id === finalId)) {
    counter++;
    finalName = counter === 2 ? `${entry.name} (Homebrew)` : `${entry.name} (Homebrew ${counter})`;
    finalId = `${entry.id}-homebrew${counter === 2 ? '' : '-' + counter}`;
  }
  entry.name = finalName;
  entry.id = finalId;
  entry.lookup_name = finalName.toLowerCase();
  itemDatabase.push(entry);
  persistItems();
  return finalName;
}

function removeItemFromDatabase(nameOrSlug) {
  const normalize = s => String(s ?? '').toLowerCase().trim();
  const q = normalize(nameOrSlug);
  const idx = itemDatabase.findIndex(i =>
    normalize(i.name) === q || i.id === nameOrSlug || normalize(i.lookup_name) === q
  );
  if (idx < 0) return { removed: false };
  const removed = itemDatabase[idx];
  if (!removed._homebrew) {
    return { removed: false, protected: true, name: removed.name };
  }
  itemDatabase.splice(idx, 1);
  persistItems();
  return { removed: true, name: removed.name };
}

let deityDatabase = [];
try {
  const deityRaw = JSON.parse(fs.readFileSync('deities.json', 'utf8'));
  // File shape: { metadata: {...}, deities: [ {...} ] }
  const rawDeities = Array.isArray(deityRaw) ? deityRaw : (deityRaw.deities ?? []);
  deityDatabase = rawDeities.filter(d => d && typeof d.name === 'string' && d.name.length > 0);
  console.log(`Loaded ${deityDatabase.length} deities from database.`);
} catch (err) {
  console.error('Could not load deities.json:', err.message);
}

let skillDatabase = {};
try {
  const skillRaw = JSON.parse(fs.readFileSync('skills.json', 'utf8'));
  // File shape: { _meta: {...}, skills: { key: {...} } }
  skillDatabase = skillRaw.skills ?? skillRaw;
  console.log(`Loaded ${Object.keys(skillDatabase).length} skills from database.`);
} catch (err) {
  console.error('Could not load skills.json:', err.message);
}

let classDatabase = {};
try {
  const classRaw = JSON.parse(fs.readFileSync('classes.json', 'utf8'));
  classDatabase = classRaw.classes ?? classRaw;
  console.log(`Loaded ${Object.keys(classDatabase).length} classes from database.`);
} catch (err) {
  console.error('Could not load classes.json:', err.message);
}

let companionDatabase = [];
try {
  const companionRaw = JSON.parse(fs.readFileSync('companions.json', 'utf8'));
  // File shape: { _meta: {...}, companions: [ {...} ] }
  companionDatabase = companionRaw.companions ?? (Array.isArray(companionRaw) ? companionRaw : []);
  console.log(`Loaded ${companionDatabase.length} companions from database.`);
} catch (err) {
  console.error('Could not load companions.json:', err.message);
}

function loadCharacters() {
  try { return JSON.parse(fs.readFileSync(dataPath('characters.json'), 'utf8')); }
  catch { return {}; }
}
function saveCharacters(data) {
  fs.writeFileSync(dataPath('characters.json'), JSON.stringify(data, null, 2));
}

// ── Bag helpers ───────────────────────────────────────────────────────────────
function loadBags() {
  try { return JSON.parse(fs.readFileSync(dataPath('bags.json'), 'utf8')); }
  catch { return {}; }
}
function saveBags(data) {
  fs.writeFileSync(dataPath('bags.json'), JSON.stringify(data, null, 2));
}

// ── Snippet helpers ──────────────────────────────────────────────────────────
// File shape: { [userId]: { [snippetName]: "expansion string" } }
// Snippets are per-user text substitutions applied to /roll expressions.
// Example: user creates `sneaky` => `+2d6[sneak]`, then /roll 1d20+5 sneaky
// expands to /roll 1d20+5 +2d6[sneak] before parsing.
function loadSnippets() {
  try { return JSON.parse(fs.readFileSync(dataPath('snippets.json'), 'utf8')); }
  catch { return {}; }
}
function saveSnippets(data) {
  fs.writeFileSync(dataPath('snippets.json'), JSON.stringify(data, null, 2));
}
// Validate a snippet name: letters/numbers/underscore only, 1-24 chars, not
// colliding with reserved roll modifiers.
const RESERVED_SNIPPET_NAMES = new Set([
  'adv', 'advantage', 'dis', 'disadvantage', 'disadv',
  'crit', 'critical', 'rr1', 'rr2', 'rr3', 'rr4', 'rr5',
  'kh1', 'kh2', 'kh3', 'kh4', 'kl1', 'kl2', 'kl3', 'd',
]);
function validateSnippetName(name) {
  if (!name || typeof name !== 'string') return 'Name is required.';
  if (name.length < 1 || name.length > 24) return 'Name must be 1-24 characters.';
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) return 'Name must start with a letter and contain only letters, numbers, and underscores.';
  if (RESERVED_SNIPPET_NAMES.has(name.toLowerCase())) return `\`${name}\` is a reserved roll modifier keyword.`;
  return null;
}
function validateSnippetExpansion(expansion) {
  if (!expansion || typeof expansion !== 'string') return 'Expansion is required.';
  if (expansion.length > 200) return 'Expansion must be 200 characters or fewer.';
  // Validate: strip brackets (labels), placeholders like %1 or %1:default, whitespace.
  // What's left must be dice-expression characters only.
  const stripped = expansion
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, '')              // strip [labels]
    .replace(/%\d+(?::[0-9.]+)?/g, '0')     // replace placeholders with 0
    .replace(/\s+/g, '');
  if (!/^[0-9dkhlb+\-*/().]*$/.test(stripped)) {
    return 'Expansion contains invalid characters. Use dice, numbers, +/-/*//, `%N` placeholders, and optional [labels].';
  }
  // Check: placeholder numbers must be sequential starting from 1.
  // (i.e. %1 must exist if %2 is used; no gaps.)
  const placeholders = [...expansion.matchAll(/%(\d+)(?::([0-9.]+))?/g)];
  if (placeholders.length > 0) {
    const nums = placeholders.map(m => parseInt(m[1]));
    const maxArg = Math.max(...nums);
    if (maxArg > 9) return 'Placeholder numbers must be between 1 and 9 (e.g. %1, %2).';
    for (let i = 1; i <= maxArg; i++) {
      if (!nums.includes(i)) return `Placeholders must be sequential. You used %${maxArg} but no %${i}.`;
    }
  }
  return null;
}

// ── Server (guild) snippet helpers ───────────────────────────────────────────
// File shape: { [guildId]: { [snippetName]: "expansion" } }
// Only users with the ManageGuild permission can create/delete. Everyone
// in the server can use them. Personal snippets take precedence over
// server snippets with the same name.
function loadServerSnippets() {
  try { return JSON.parse(fs.readFileSync(dataPath('server_snippets.json'), 'utf8')); }
  catch { return {}; }
}
function saveServerSnippets(data) {
  fs.writeFileSync(dataPath('server_snippets.json'), JSON.stringify(data, null, 2));
}
// Merge personal + server snippets for a given user+guild. Personal wins
// on name collision. Returns { [name]: expansion }.
function mergedSnippetsFor(userId, guildId) {
  const personal = (loadSnippets()[userId] ?? {});
  const server = guildId ? (loadServerSnippets()[guildId] ?? {}) : {};
  // Server first, personal override
  return { ...server, ...personal };
}

// ── Monster attack library helpers ────────────────────────────────────────────
// File shape: { [guildId]: { [monsterKey]: { displayName, attacks: [ {...} ] } } }
function loadMonsterAttacks() {
  try { return JSON.parse(fs.readFileSync(dataPath('monster_attacks.json'), 'utf8')); }
  catch { return {}; }
}
function saveMonsterAttacks(data) {
  fs.writeFileSync(dataPath('monster_attacks.json'), JSON.stringify(data, null, 2));
}
function monsterKey(name) {
  return String(name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}
function getGuildMonsters(store, guildId) {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}
// Resolve a monster's display name, preferring the bestiary's canonical name if it matches.
function resolveMonsterDisplayName(inputName) {
  try {
    const hit = findMonster(inputName);
    if (hit.monster) return hit.monster.name;
  } catch { /* findMonster not available yet during module init; fine */ }
  return inputName;
}
// Find a saved attack on a monster by name (case-insensitive, partial).
function findSavedAttack(monsterEntry, attackName) {
  const q = String(attackName ?? '').toLowerCase().trim();
  const atks = monsterEntry?.attacks ?? [];
  return atks.find(a => a.name.toLowerCase() === q)
      || atks.find(a => a.name.toLowerCase().startsWith(q))
      || atks.find(a => a.name.toLowerCase().includes(q))
      || null;
}

// ── Monster art library helpers ───────────────────────────────────────────────
// File shape: { [guildId]: { [monsterKey]: { displayName, url, setBy, setAt } } }
// Per-guild so a GM on one server can't affect another's art.
function loadMonsterArt() {
  try { return JSON.parse(fs.readFileSync(dataPath('monster_art.json'), 'utf8')); }
  catch { return {}; }
}
function saveMonsterArt(data) {
  fs.writeFileSync(dataPath('monster_art.json'), JSON.stringify(data, null, 2));
}
function getGuildArt(store, guildId) {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}
// Look up a saved art URL for a monster in a given guild. Returns null if none.
// The monster arg can be either a bestiary creature object (preferred) or a raw string name.
function lookupMonsterArt(guildId, monsterOrName) {
  if (!guildId) return null;
  const store = loadMonsterArt();
  const guild = store[guildId];
  if (!guild) return null;
  const name = typeof monsterOrName === 'string' ? monsterOrName : monsterOrName?.name;
  if (!name) return null;
  const key = monsterKey(name);
  return guild[key]?.url ?? null;
}

// ── Monster edits store helpers ───────────────────────────────────────────────
// Per-guild per-field overrides for bestiary creatures. Anything a GM sets here
// replaces the corresponding field in the bestiary entry when /monster is shown.
// Unset fields fall through to the bestiary as normal.
//
// File shape:
// { [guildId]: { [monsterKey]: {
//     displayName,                       // canonical name (for list/view)
//     setBy, setAt,                      // audit fields
//     // any of these override bestiary:
//     description,                       // free-form flavor text
//     abilities: [ { name, description, action_cost?, trigger?, traits? } ],
//     items: [ "dogslicer", ... ],
//     languages: [ "goblin", ... ],
//     skills: { "Acrobatics": 5, ... },
//     attacks: [ { type, name, to_hit, damage, traits } ],
//     ability_modifiers: { str, dex, con, int, wis, cha },
//   } } }
function loadMonsterEdits() {
  try { return JSON.parse(fs.readFileSync(dataPath('monster_edits.json'), 'utf8')); }
  catch { return {}; }
}
function saveMonsterEdits(data) {
  fs.writeFileSync(dataPath('monster_edits.json'), JSON.stringify(data, null, 2));
}
function getGuildEdits(store, guildId) {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}
function getMonsterEdit(guildId, displayName) {
  if (!guildId || !displayName) return null;
  const store = loadMonsterEdits();
  const guild = store[guildId];
  if (!guild) return null;
  return guild[monsterKey(displayName)] ?? null;
}
// Create or fetch an edit entry for the given monster, auto-stamping the
// audit fields. Caller is expected to mutate fields on the returned object
// and then call saveMonsterEdits(store). Returns { store, guild, entry }.
function ensureMonsterEdit(guildId, displayName, userId) {
  const store = loadMonsterEdits();
  const guild = getGuildEdits(store, guildId);
  const key = monsterKey(displayName);
  if (!guild[key]) {
    guild[key] = { displayName, setBy: userId, setAt: new Date().toISOString() };
  } else {
    // Touch the audit timestamp on every edit
    guild[key].setAt = new Date().toISOString();
    guild[key].setBy = userId;
    // If the canonical name changed (e.g. bestiary rename), update it
    guild[key].displayName = displayName;
  }
  return { store, guild, entry: guild[key] };
}

// Merge a guild's monster edits onto a bestiary creature. Edits override
// bestiary fields one-at-a-time; unset fields fall through. Returns a NEW
// object — does not mutate the bestiary in memory. Passing a null edit or
// a nonexistent entry returns the monster unchanged.
function applyMonsterEdits(monster, edits) {
  if (!edits || !monster) return monster;
  // Start with a shallow copy so we don't corrupt the bestiary cache.
  const merged = { ...monster };
  // The overlay model: core stays as-is; we layer edit fields onto a
  // virtual "rich" object. Callers read from rich/core via buildMonsterEmbed,
  // which already knows how to merge them.
  const baseRich = monster.rich ? { ...monster.rich } : {};
  // Fields that override cleanly if present
  const overlayKeys = [
    'abilities', 'items', 'languages', 'skills', 'attacks',
    'ability_modifiers', 'spellcasting', 'description',
  ];
  let overlayApplied = false;
  for (const k of overlayKeys) {
    if (edits[k] !== undefined) {
      baseRich[k] = edits[k];
      overlayApplied = true;
    }
  }
  if (overlayApplied || !monster.rich) {
    merged.rich = baseRich;
  }
  // Flag for the embed so we can footnote that edits are applied
  merged._hasGuildEdits = true;
  return merged;
}

// Pull the attacks saved via /monsterattack for this guild+monster and
// surface them on the creature so they render on /monster alongside any
// bestiary or edit attacks. Strike-kind entries become melee/ranged
// bestiary-style attacks; spell and save kinds become special abilities
// (since the bestiary's `attacks` field is strikes-only).
function applyMonsterAttackLibrary(monster, guildId) {
  if (!monster || !guildId) return monster;
  const store = loadMonsterAttacks();
  const guildLib = store[guildId];
  if (!guildLib) return monster;
  const entry = guildLib[monsterKey(monster.name)];
  if (!entry || !entry.attacks?.length) return monster;

  // Clone so we never mutate the bestiary in-memory
  const merged = { ...monster };
  const baseRich = monster.rich ? { ...monster.rich } : {};
  const existingAttacks = Array.isArray(baseRich.attacks) ? [...baseRich.attacks] : [];
  const existingAbilities = baseRich.abilities
    ? { top: [...(baseRich.abilities.top ?? [])], mid: [...(baseRich.abilities.mid ?? [])], bot: [...(baseRich.abilities.bot ?? [])] }
    : { top: [], mid: [], bot: [] };

  // Track names that already exist to avoid duplicate rendering when an
  // attack is in both the bestiary and the library (e.g. the GM re-saved
  // it with a custom damage expression).
  const seenAttackNames = new Set(existingAttacks.map(a => a.name?.toLowerCase()));

  for (const a of entry.attacks) {
    if (a.kind === 'strike') {
      if (seenAttackNames.has(a.name.toLowerCase())) continue;
      existingAttacks.push({
        type: 'melee', // library doesn't track melee vs ranged; melee is the safe default
        name: a.name,
        to_hit: a.bonus,
        damage: `${a.damage} ${a.damageType ?? ''}`.trim() + (a.extraDamage ? ` + ${a.extraDamage}${a.extraType ? ' ' + a.extraType : ''}` : ''),
        traits: a.traits ?? [],
        _fromLibrary: true,
      });
      seenAttackNames.add(a.name.toLowerCase());
    } else if (a.kind === 'spell') {
      // Render spell attacks as abilities so the to-hit and damage are still visible
      existingAbilities.bot.push({
        name: a.name,
        description: `Spell attack ${a.bonus >= 0 ? '+' : ''}${a.bonus}, damage ${a.damage}${a.damageType ? ' ' + a.damageType : ''}.`,
        _fromLibrary: true,
      });
    } else if (a.kind === 'save') {
      const saveCap = a.saveType ? a.saveType.charAt(0).toUpperCase() + a.saveType.slice(1) : 'Save';
      existingAbilities.bot.push({
        name: a.name,
        description: `DC ${a.saveDC} ${saveCap} save — ${a.damage}${a.damageType ? ' ' + a.damageType : ''}.`,
        _fromLibrary: true,
      });
    }
  }

  baseRich.attacks = existingAttacks;
  baseRich.abilities = existingAbilities;
  merged.rich = baseRich;
  return merged;
}

function getOrCreateBag(bags, userId) {
  if (!bags[userId]) {
    bags[userId] = { bagName: 'Bag 1', categories: {} };
  }
  return bags[userId];
}

// ── Bag entry helpers ─────────────────────────────────────────────────────────
// Entries may be either legacy strings ("Healing Potion") or objects ({ name, qty }).
// All read/write paths below tolerate both, and writes always produce the object form.
function normalizeBagEntry(entry) {
  if (typeof entry === 'string') return { name: entry, qty: 1 };
  if (entry && typeof entry === 'object' && entry.name) {
    return { name: String(entry.name), qty: Math.max(1, Number(entry.qty) || 1) };
  }
  return null;
}

// Convert a bulk_normalized string to "light units" (1 L = 1, 1 Bulk = 10, negligible = 0).
// Returns null if we can't parse it (e.g. parser artifacts), so we can skip it cleanly.
function bulkToLightUnits(bulkNormalized) {
  if (bulkNormalized == null) return 0; // treat missing as negligible
  const s = String(bulkNormalized).trim().toLowerCase();
  if (s === '' || s === '—' || s === '-' || s === 'negligible' || s === '0') return 0;
  if (s === 'l' || s === 'light') return 1;
  const n = parseFloat(s);
  if (Number.isFinite(n)) return Math.round(n * 10);
  return null; // unparseable (likely a parser artifact like campaign names)
}

// Format a light-unit total back into PF2e bulk notation: "3 Bulk, 2 L" / "5 L" / "—".
function formatBulk(lightUnits) {
  if (!lightUnits) return '—';
  const bulk = Math.floor(lightUnits / 10);
  const light = lightUnits % 10;
  const parts = [];
  if (bulk > 0)  parts.push(`${bulk} Bulk`);
  if (light > 0) parts.push(`${light} L`);
  return parts.join(', ');
}

// Format a copper-piece total into PF2e coinage (pp/gp/sp/cp), only showing nonzero denominations.
function formatCp(cp) {
  if (!cp) return '0 gp';
  const pp = Math.floor(cp / 1000);
  const gp = Math.floor((cp % 1000) / 100);
  const sp = Math.floor((cp % 100) / 10);
  const cpLeft = cp % 10;
  const parts = [];
  if (pp) parts.push(`${pp} pp`);
  if (gp) parts.push(`${gp} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (cpLeft) parts.push(`${cpLeft} cp`);
  return parts.join(', ') || '0 gp';
}

// Look up an item in itemDatabase by name (case-insensitive exact match, then lookup_name).
// Returns null for homebrew / unrecognized items so the caller can skip them in totals.
function lookupItemData(name) {
  if (!name || !Array.isArray(itemDatabase) || itemDatabase.length === 0) return null;
  const q = String(name).toLowerCase().trim();
  return itemDatabase.find(i => i.name.toLowerCase() === q)
      || itemDatabase.find(i => (i.lookup_name ?? '').toLowerCase() === q)
      || null;
}

// PF2e encumbrance: encumbered at 5 + Str mod, max at 10 + Str mod (in Bulk, i.e. ×10 light-units).
function computeBulkLimits(character) {
  const str = character?.abilities?.str;
  if (typeof str !== 'number') return null;
  const strMod = Math.floor((str - 10) / 2);
  return {
    strMod,
    encumberedLu: (5 + strMod) * 10,
    maxLu:        (10 + strMod) * 10,
  };
}

function buildBagEmbed(userBag, character = null) {
  const embed = new EmbedBuilder()
    .setTitle(`🎒 ${userBag.bagName}`)
    .setColor(0x9B59B6)
    .setFooter({ text: '/bag add • /bag remove • /bag removecategory • /bag rename • /bag clear' });

  const cats = Object.entries(userBag.categories ?? {});

  if (cats.length === 0) {
    embed.setDescription('*Your bag is empty. Use `/bag add <category> <item>` to get started!*');
    return embed;
  }

  let totalLu = 0;
  let totalCp = 0;
  let unknownBulkCount = 0;

  for (const [cat, items] of cats) {
    const lines = [];
    for (const raw of items) {
      const entry = normalizeBagEntry(raw);
      if (!entry) continue;
      const data = lookupItemData(entry.name);
      const qtyPrefix = entry.qty > 1 ? `${entry.qty}× ` : '';

      if (data) {
        // Hydrate live from itemDatabase
        const lu = bulkToLightUnits(data.bulk_normalized);
        if (lu == null) unknownBulkCount += entry.qty;
        else            totalLu += lu * entry.qty;

        if (typeof data.price_cp === 'number') totalCp += data.price_cp * entry.qty;

        const bulkStr = data.bulk_raw ? ` *(${data.bulk_raw})*` : '';
        const priceStr = data.price_raw ? ` — ${data.price_raw}` : '';
        lines.push(`${qtyPrefix}**${data.name}**${bulkStr}${priceStr}`);
      } else {
        // Homebrew / unknown — display as-is, don't contribute to totals
        lines.push(`${qtyPrefix}${entry.name} *(homebrew)*`);
      }
    }
    const value = lines.length > 0 ? lines.join('\n') : '*Empty*';
    embed.addFields({ name: `**${cat}**`, value: value.slice(0, 1024), inline: false });
  }

  // Summary footer fields: Bulk (with encumbrance if character provided) and Total Value
  const limits = computeBulkLimits(character);
  let bulkField = formatBulk(totalLu);
  if (limits) {
    const status = totalLu > limits.maxLu ? ' 🚫 **Overloaded**'
                : totalLu > limits.encumberedLu ? ' ⚠️ *Encumbered*'
                : '';
    bulkField += `  /  ${formatBulk(limits.encumberedLu)} encumbered  /  ${formatBulk(limits.maxLu)} max${status}`;
  }
  if (unknownBulkCount > 0) bulkField += `\n*(${unknownBulkCount} item${unknownBulkCount === 1 ? '' : 's'} with unknown bulk not counted)*`;

  embed.addFields(
    { name: '⚖️ Total Bulk',  value: bulkField,            inline: false },
    { name: '💰 Total Value', value: formatCp(totalCp),    inline: true  },
  );

  return embed;
}

// ── Character helpers ─────────────────────────────────────────────────────────
function getMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
function calcProfNum(profNum, level) {
  if (!profNum || profNum === 0) return 0;
  return profNum + level;
}
function fmt(n) { return n >= 0 ? `+${n}` : `${n}`; }
function xpToNextLevel() { return 1000; }

function resolveChar(userId, nameArg, characters) {
  if (!characters[userId] || Object.keys(characters[userId]).filter(k => !k.startsWith('_')).length === 0)
    return { error: 'You have no saved characters! Use `/char add` to add one.' };
  let charKey;
  if (!nameArg) {
    // Filter out underscore-prefixed metadata keys (like _activeChar)
    const keys = Object.keys(characters[userId]).filter(k => !k.startsWith('_'));
    if (keys.length === 1) { charKey = keys[0]; }
    else {
      // Multiple characters — check for an active character setting first.
      const activeKey = characters[userId]._activeChar;
      if (activeKey && characters[userId][activeKey]) {
        charKey = activeKey;
      } else {
        const names = keys.map(k => characters[userId][k].name).join(', ');
        return { error: `You have multiple characters! Specify one with \`character:<name>\`, or set a default with \`/char active character:<name>\`.\nYour characters: ${names}` };
      }
    }
  } else {
    charKey = nameArg.toLowerCase().replace(/\s+/g, '-');
  }
  if (!characters[userId][charKey]) {
    const names = Object.keys(characters[userId]).filter(k => !k.startsWith('_')).map(k => characters[userId][k].name).join(', ');
    return { error: `Couldn't find that character. Your characters: ${names}` };
  }
  return { charKey, char: characters[userId][charKey] };
}

function buildRollEmbed({ title, breakdown, charName, thumbnail }) {
  const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(title).setDescription(breakdown);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (charName) embed.setFooter({ text: charName });
  return embed;
}

function formatRollBreakdown(dieRoll, modifier, extraBonus, total, sides) {
  const isCrit = sides === 20 && dieRoll === 20;
  const isFumble = sides === 20 && dieRoll === 1;
  const modPart = modifier !== 0 ? ` + ${modifier}` : '';
  const extraPart = extraBonus && extraBonus !== 0 ? ` + ${extraBonus}` : '';
  let line = `1d20 (${dieRoll})${modPart}${extraPart} = **${total}**`;
  if (isCrit) line += '\n⭐ Natural 20!';
  if (isFumble) line += '\n💀 Natural 1!';
  return line;
}

// ── Initiative helpers ────────────────────────────────────────────────────────
function computeCharPerception(charEntry) {
  const c = charEntry.data;
  const lvl = c.level ?? 1;
  const wisMod = Math.floor(((c.abilities?.wis ?? 10) - 10) / 2);
  const profNum = c.proficiencies?.perception ?? 0;
  return wisMod + calcProfNum(profNum, lvl);
}

function computeCharMaxHp(charEntry) {
  const c = charEntry.data;
  const lvl = c.level ?? 1;
  const conMod = Math.floor(((c.abilities?.con ?? 10) - 10) / 2);
  return (c.attributes?.ancestryhp ?? 0) + (c.attributes?.classhp ?? 0) + ((c.attributes?.bonushp ?? 0) * lvl) + (conMod * lvl);
}

// ── Character HP overlay helpers ─────────────────────────────────────────────
// Current HP is stored on charEntry.hp as a bot-managed overlay, defaulting to
// max HP from the sheet if not set. Changes are clamped to [0, max]. Used by
// /hp and /rest; the in-combat tracker uses its own separate combatant.hp.
function getCharacterHp(charEntry) {
  const maxHp = computeCharMaxHp(charEntry);
  if (typeof charEntry.hp === 'number') return Math.max(0, Math.min(maxHp, charEntry.hp));
  return maxHp; // no overlay set yet = full HP
}

function setCharacterHp(charEntry, value) {
  const maxHp = computeCharMaxHp(charEntry);
  charEntry.hp = Math.max(0, Math.min(maxHp, Math.floor(value)));
  return charEntry.hp;
}

function buildCharHpEmbed(char, charEntry, note = null) {
  const maxHp = computeCharMaxHp(charEntry);
  const currentHp = getCharacterHp(charEntry);
  const pct = maxHp > 0 ? currentHp / maxHp : 0;
  // 10-segment HP bar
  const segments = 10;
  const filled = Math.max(currentHp > 0 ? 1 : 0, Math.round(pct * segments));
  const bar = '█'.repeat(filled) + '░'.repeat(segments - filled);
  // Pick a color based on how hurt they are
  const color = pct <= 0 ? 0x8B0000 : pct <= 0.25 ? 0xe74c3c : pct <= 0.5 ? 0xe67e22 : pct < 1 ? 0xf1c40f : 0x2ecc71;
  const status = pct <= 0 ? '💀 Down!' : pct <= 0.25 ? '🔴 Critical' : pct <= 0.5 ? '🟠 Bloodied' : pct < 1 ? '🟡 Injured' : '🟢 Healthy';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`❤️ ${char.name}'s Hit Points`)
    .setDescription(`\`${bar}\`\n**${currentHp} / ${maxHp}** HP · *${status}*`);
  if (note) embed.addFields({ name: '\u200b', value: note, inline: false });
  embed.setFooter({ text: '/hp set, /hp add, /rest to restore · Combat uses /init hp' });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

// ── HP status helpers for the initiative tracker ────────────────────────────
// PF2e uses "bloodied" at ≤50% and tracks dying at 0 HP. We add a "critical"
// band at ≤25% for tactical clarity at the table. Dying/wounded are now
// proper PF2e conditions managed by combatAutomation.js.
function hpStatus(current, max, dying = 0) {
  if (!max || max <= 0) return { label: 'Unknown', emoji: '⚪' };
  if (dying >= 4)           return { label: 'Dead',     emoji: '☠️' };
  if (dying > 0 || current <= 0) return { label: `Dying ${dying || 1}`, emoji: '💀' };
  const pct = current / max;
  if (pct <= 0.25)          return { label: 'Critical', emoji: '🔴' };
  if (pct <= 0.5)           return { label: 'Bloodied', emoji: '🟠' };
  if (pct < 1.0)            return { label: 'Injured',  emoji: '🟡' };
  return                           { label: 'Healthy',  emoji: '🟢' };
}

// Render an 8-segment HP bar. Uses filled/empty blocks so it lines up across
// combatants regardless of HP totals. At 0 HP shows an all-empty bar with skull.
function hpBar(current, max, segments = 8) {
  if (!max || max <= 0) return '░'.repeat(segments);
  if (current <= 0)     return '░'.repeat(segments);
  const pct = Math.max(0, Math.min(1, current / max));
  // Always show at least one filled block if the combatant isn't dead — a
  // 1-HP-out-of-200 combatant still gets one pip, not a visually-empty bar.
  const filled = Math.max(1, Math.round(pct * segments));
  return '█'.repeat(filled) + '░'.repeat(segments - filled);
}

function buildInitiativeEmbed(enc) {
  const lines = enc.combatants.map((combatant, i) => {
    const marker = i === enc.turnIndex ? '▶️ ' : '   ';
    const status = hpStatus(combatant.hp, combatant.maxHp, combatant.dying ?? 0);

    // PCs see their actual HP + bar; NPCs see status only (HP is hidden).
    // Everyone (PC or NPC) shows AC so players can plan shots.
    let hpLine;
    if (combatant.isNpc) {
      hpLine = `${status.emoji} ${status.label}`;
    } else {
      const bar = hpBar(combatant.hp, combatant.maxHp);
      hpLine = `${status.emoji} \`${bar}\` **${combatant.hp}/${combatant.maxHp}** HP · *${status.label}*`;
    }
    const acPart = combatant.ac !== undefined && combatant.ac !== null
      ? ` · **AC ${combatant.ac}**`
      : '';

    // Wounded indicator (separate from dying - persists across deaths)
    const woundedPart = (combatant.wounded ?? 0) > 0
      ? ` · 🩸 Wounded ${combatant.wounded}`
      : '';

    // Reaction indicator: ⤾ available, ⤾⃠ used. Only show if combatant has reactions enabled.
    let reactionPart = '';
    if (combatant.hasReaction !== false && (combatant.dying ?? 0) === 0) {
      reactionPart = combatant.reactionUsed ? ' · ⤾̶' : ' · ⤾';
    }

    let effectLine = '';
    if (combatant.effects && combatant.effects.length > 0) {
      const effectTexts = combatant.effects.map(e => {
        let text = e.name;
        if (e.value !== null && e.value !== undefined) text += ` ${e.value}`;
        if (e.duration !== null && e.duration !== undefined) text += ` (${e.duration}r)`;
        return text;
      });
      effectLine = `\n     🌀 *${effectTexts.join(', ')}*`;
    }

    return `${marker}**${combatant.initiative}** — ${combatant.name}${acPart}${woundedPart}${reactionPart}\n     ${hpLine}${effectLine}`;
  });
  return new EmbedBuilder()
    .setTitle(`⚔️ Initiative — Round ${enc.round}`)
    .setDescription(lines.join('\n') || '*No combatants yet*')
    .setColor(0xAA0000);
}

async function updateSummary(channel, enc) {
  if (!enc) return;
  const embed = buildInitiativeEmbed(enc);
  if (enc.summaryMessageId) {
    try {
      const existing = await channel.messages.fetch(enc.summaryMessageId);
      await existing.edit({ embeds: [embed] });
      return;
    } catch {}
  }
  try {
    const msg = await channel.send({ embeds: [embed] });
    setSummaryMessageId(channel.id, msg.id);
    try {
      await msg.pin();
    } catch (err) {
      console.warn('Could not pin summary message (missing Manage Messages permission?):', err.message);
    }
  } catch (err) {
    console.error('Failed to post summary:', err);
  }
}

async function clearSummary(channel, enc) {
  if (!enc?.summaryMessageId) return;
  try {
    const msg = await channel.messages.fetch(enc.summaryMessageId);
    try { await msg.unpin(); } catch {}
  } catch {}
}

// ── Recovery check display helper ────────────────────────────────────────────
// Builds the embed + optional Hero Point reroll button for a recovery check
// result. Used by both /init next (auto-roll on dying combatant's turn start)
// and /init recovery (manual force-roll). Returns { embeds, components }.
// Pass in the recovery check result from ca.rollRecoveryCheck and the combatant.
function buildRecoveryCheckPayload(rc, combatant) {
  const outcomeEmoji = rc.outcome === 'crit-success' ? '🌟'
    : rc.outcome === 'success' ? '✅'
    : rc.outcome === 'failure' ? '❌'
    : '💥';
  const embed = new EmbedBuilder()
    .setColor(rc.died ? 0x8B0000 : rc.awoke ? 0x2ecc71 : rc.outcome === 'success' || rc.outcome === 'crit-success' ? 0x27ae60 : 0xe74c3c)
    .setTitle(`💀 ${combatant.name}'s Recovery Check`)
    .setDescription(
      `Flat check vs DC ${rc.dc}: 1d20 (${rc.roll})\n` +
      `${outcomeEmoji} **${rc.outcome.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}**\n` +
      `${rc.narration}`
    );

  // Hero Point reroll button for PCs with hero points remaining
  const components = [];
  if (!combatant.isNpc && combatant.ownerId && !rc.died) {
    try {
      const characters = loadCharacters();
      const userCharacters = characters[combatant.ownerId] ?? {};
      const charKey = combatant.name.toLowerCase().replace(/\s+/g, '-');
      const charEntry = userCharacters[charKey];
      const heroPoints = charEntry?.heroPoints ?? (charEntry ? 1 : 0);
      if (heroPoints > 0) {
        const safeName = combatant.name.replace(/[^a-zA-Z0-9]/g, '_');
        const awokeFlag = rc.awoke ? '1' : '0';
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rcheck_reroll_${safeName}_${rc.dyingBefore}_${rc.dyingAfter}_${rc.roll}_${awokeFlag}`)
            .setLabel(`🎭 Hero Point Reroll (${heroPoints} available)`)
            .setStyle(ButtonStyle.Primary),
        ));
      }
    } catch (err) {
      console.error('Recovery check: hero point lookup failed:', err);
    }
  }

  return { embeds: [embed], components };
}

function rollD20Plus(modifier) {
  const roll = Math.floor(Math.random() * 20) + 1;
  return { total: roll + modifier, roll, mod: modifier };
}

function rollDamageExpression(expr) {
  if (!expr) return null;
  const cleaned = expr.toLowerCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!match) return null;
  const numDice = parseInt(match[1]) || 1;
  const numSides = parseInt(match[2]);
  const bonus = match[3] ? parseInt(match[3]) : 0;
  if (numDice < 1 || numDice > 100 || numSides < 1) return null;
  const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * numSides) + 1);
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + bonus;
  const bonusText = bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : '';
  const display = `${numDice}d${numSides}[${rolls.join(', ')}]${bonusText}`;
  return { rolls, bonus, numDice, numSides, sum, total, display };
}

function determineDegreeOfSuccess(attackTotal, dieRoll, targetAc) {
  if (targetAc === null || targetAc === undefined) return null;
  let degree;
  if (attackTotal >= targetAc + 10) degree = 'crit-success';
  else if (attackTotal >= targetAc) degree = 'success';
  else if (attackTotal <= targetAc - 10) degree = 'crit-failure';
  else degree = 'failure';
  if (dieRoll === 20) {
    degree = degree === 'crit-failure' ? 'failure' : degree === 'failure' ? 'success' : 'crit-success';
  } else if (dieRoll === 1) {
    degree = degree === 'crit-success' ? 'success' : degree === 'success' ? 'failure' : 'crit-failure';
  }
  return degree;
}

function calculateMap(mapLevel, agile) {
  if (mapLevel === 0 || !mapLevel) return 0;
  if (mapLevel === 1) return agile ? -4 : -5;
  return agile ? -8 : -10;
}

// Sum up all attack/damage/AC/save/skill modifiers from a combatant's effects.
function sumEffectModifiers(combatant) {
  const totals = {
    attackBonus: 0,
    damageBonus: 0,
    acBonus: 0,
    saveBonus: 0,
    skillBonus: 0,
    activeEffects: [],
  };
  if (!combatant?.effects || combatant.effects.length === 0) return totals;

  for (const effect of combatant.effects) {
    const m = effect.modifiers || {};
    const atk = m.attackBonus ?? 0;
    const dmg = m.damageBonus ?? 0;
    const ac = m.acBonus ?? 0;
    const save = m.saveBonus ?? 0;
    const skill = m.skillBonus ?? 0;

    totals.attackBonus += atk;
    totals.damageBonus += dmg;
    totals.acBonus += ac;
    totals.saveBonus += save;
    totals.skillBonus += skill;

    if (atk || dmg || ac || save || skill) {
      const displayValue = effect.value !== null && effect.value !== undefined ? ` ${effect.value}` : '';
      totals.activeEffects.push({
        name: `${effect.name}${displayValue}`,
        attackBonus: atk,
        damageBonus: dmg,
        acBonus: ac,
      });
    }
  }
  return totals;
}

// Build a human-readable line showing which effects contributed to a roll.
function formatEffectContributions(effects, kind) {
  const contributions = effects
    .filter(e => {
      if (kind === 'attack') return e.attackBonus !== 0;
      if (kind === 'damage') return e.damageBonus !== 0;
      if (kind === 'ac') return e.acBonus !== 0;
      return false;
    })
    .map(e => {
      const val = kind === 'attack' ? e.attackBonus : kind === 'damage' ? e.damageBonus : e.acBonus;
      return `${e.name} ${fmt(val)}`;
    });
  return contributions.length > 0 ? ` (${contributions.join(', ')})` : '';
}

// ── Spell lookup ──────────────────────────────────────────────────────────────
function findSpell(spellName) {
  const normalize = str => str.toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"');
  const query = normalize(spellName);
  return spellDatabase.find(s => normalize(s.name ?? '') === query)
    || spellDatabase.find(s => normalize(s.name ?? '').startsWith(query))
    || spellDatabase.find(s => normalize(s.name ?? '').includes(query))
    || null;
}

// ── Rules lookup ──────────────────────────────────────────────────────────────
function findRule(query) {
  const q = query.toLowerCase().trim().replace(/\s+/g, '-');
  const qRaw = query.toLowerCase().trim();
  for (const category of Object.values(rulesDatabase)) {
    if (category[q]) return { rule: category[q], matches: [] };
    const exactName = Object.values(category).find(r => r.name.toLowerCase() === qRaw);
    if (exactName) return { rule: exactName, matches: [] };
  }
  const matches = [];
  for (const category of Object.values(rulesDatabase)) {
    for (const [key, rule] of Object.entries(category)) {
      if (rule.name.toLowerCase().includes(qRaw) || key.includes(q)) matches.push(rule);
    }
  }
  if (matches.length === 1) return { rule: matches[0], matches: [] };
  if (matches.length > 1)   return { rule: null, matches };
  return { rule: null, matches: [] };
}

function buildRuleEmbed(rule) {
  const colors  = { condition: 0xe74c3c, action: 0x2ecc71, trait: 0xf39c12 };
  const emojis  = { condition: '🩸', action: '⚡', trait: '🏷️' };
  const embed = new EmbedBuilder()
    .setColor(colors[rule.category] ?? 0x7289DA)
    .setTitle(`${emojis[rule.category] ?? '📖'} ${rule.name}`)
    .setDescription(rule.description);
  if (rule.action_cost) embed.addFields({ name: '⏱️ Action Cost', value: rule.action_cost, inline: true });
  if (rule.value_label) embed.addFields({ name: '📊 Format', value: rule.value_label, inline: true });
  if (rule.traits?.length) embed.addFields({ name: '🏷️ Traits', value: rule.traits.join(', '), inline: true });
  if (rule.trigger)      embed.addFields({ name: '🔔 Trigger', value: rule.trigger, inline: false });
  if (rule.requirements) embed.addFields({ name: '📋 Requirements', value: rule.requirements, inline: false });
  const cat = rule.category.charAt(0).toUpperCase() + rule.category.slice(1);
  embed.setFooter({ text: `${cat} • ${rule.source ?? 'Pathfinder 2e'}` });
  return embed;
}

// ── Archetype lookup ──────────────────────────────────────────────────────────
function findArchetype(query) {
  const q = query.toLowerCase().trim();
  for (const [key, archetype] of Object.entries(archetypeDatabase)) {
    if (key.toLowerCase() === q) return { archetype, matches: [] };
  }
  const matches = Object.entries(archetypeDatabase).filter(([key]) => key.toLowerCase().includes(q));
  if (matches.length === 1) return { archetype: matches[0][1], matches: [] };
  if (matches.length > 1)   return { archetype: null, matches: matches.map(([k]) => k) };
  return { archetype: null, matches: [] };
}

function buildArchetypeEmbed(archetype) {
  const rarityColor = { Common: 0x4a90d9, Uncommon: 0xc45f00, Rare: 0x6b21a8 };
  const typeEmoji = archetype.type === 'multiclass' ? '🔀' : '📖';
  const typeLabel = archetype.type === 'multiclass' ? 'Multiclass Archetype' : 'Archetype';
  const rarityLabel = archetype.rarity !== 'Common' ? ` • ${archetype.rarity}` : '';
  const embed = new EmbedBuilder()
    .setColor(rarityColor[archetype.rarity] ?? 0x4a90d9)
    .setTitle(`${typeEmoji} ${archetype.name}`)
    .setDescription(archetype.description || '*No description available.*')
    .addFields(
      { name: '📋 Type',            value: `${typeLabel}${rarityLabel}`, inline: true },
      { name: '🎯 Dedication Feat', value: `Feat ${archetype.dedication_level}`, inline: true },
      { name: '📚 Source',          value: archetype.source || 'Unknown', inline: true },
    );
  if (archetype.prerequisites)
    embed.addFields({ name: '⚠️ Prerequisites', value: archetype.prerequisites, inline: false });
  embed.setFooter({ text: 'Pathway • PF2e Archetype Lookup' });
  return embed;
}

// ── Background lookup ─────────────────────────────────────────────────────────
function findBackground(query) {
  const normalize = str => String(str ?? '').toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\s+/g, ' ');
  const q = normalize(query);
  const qSlug = q.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  // 1. Exact slug key match
  if (backgroundDatabase[qSlug]) return { background: backgroundDatabase[qSlug], matches: [] };

  // 2. Exact display-name match
  const entries = Object.entries(backgroundDatabase);
  const exactName = entries.find(([, b]) => normalize(b.name) === q);
  if (exactName) return { background: exactName[1], matches: [] };

  // 3. Partial match on key or name
  const partials = entries.filter(([key, b]) =>
    key.toLowerCase().includes(qSlug) || normalize(b.name).includes(q)
  );
  if (partials.length === 1) return { background: partials[0][1], matches: [] };
  if (partials.length > 1)   return { background: null, matches: partials.map(([, b]) => b.name) };
  return { background: null, matches: [] };
}

function buildBackgroundEmbed(bg) {
  const rarityColor = { Common: 0x4a90d9, Uncommon: 0xc45f00, Rare: 0x6b21a8, Unique: 0x8b0000 };
  const rarityEmoji = { Common: '⚪', Uncommon: '🟠', Rare: '🟣', Unique: '🔴' };
  const emoji = rarityEmoji[bg.rarity] ?? '📜';

  const boosts = bg.ability_boosts?.length
    ? bg.ability_boosts.join(' or ')
    : '*Choose any two (free)*';
  const skills = bg.trained_skills?.length
    ? bg.trained_skills.map(s => `• ${s}`).join('\n')
    : '*None specified*';
  const feats = bg.granted_feats?.length
    ? bg.granted_feats.map(f => `✨ ${f}`).join('\n')
    : '*None*';

  const embed = new EmbedBuilder()
    .setColor(rarityColor[bg.rarity] ?? 0x4a90d9)
    .setTitle(`${emoji} ${bg.name}`)
    .setDescription(bg.summary || '*No summary available.*')
    .addFields(
      { name: '💪 Ability Boosts',  value: boosts, inline: true },
      { name: '🏅 Rarity',           value: bg.rarity ?? 'Common', inline: true },
      { name: '🎫 PFS',              value: bg.pfs_availability ?? 'Unknown', inline: true },
      { name: '🎓 Trained Skills',   value: skills, inline: false },
      { name: '🎯 Granted Feat',     value: feats,  inline: false },
    )
    .setFooter({ text: `Source: ${bg.source ?? 'Unknown'} • PF2e Background Lookup` });

  return embed;
}

// ── Feat lookup ───────────────────────────────────────────────────────────────
function normalizeFeatQuery(str) {
  return String(str ?? '').toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ');
}

function findFeat(query, levelFilter) {
  const q = normalizeFeatQuery(query);
  if (!q) return { feat: null, matches: [] };

  // Narrow by level if provided
  const pool = levelFilter != null
    ? featDatabase.filter(f => f.level === levelFilter)
    : featDatabase;

  // 1. Exact name match (case-insensitive)
  const exact = pool.filter(f => f.name.toLowerCase() === q);
  if (exact.length === 1) return { feat: exact[0], matches: [] };
  if (exact.length > 1)   return { feat: null, matches: exact, exactDuplicates: true };

  // 2. Starts-with match
  const starts = pool.filter(f => f.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return { feat: starts[0], matches: [] };

  // 3. Contains match
  const contains = pool.filter(f => f.name.toLowerCase().includes(q));
  if (contains.length === 1) return { feat: contains[0], matches: [] };
  if (contains.length > 1)   return { feat: null, matches: contains };

  return { feat: null, matches: [] };
}

function buildFeatEmbed(feat) {
  // Color priority: rarity (new) → pfs_access (legacy) → default
  const rarityColor = {
    Common:   0x4a90d9, // blue
    Uncommon: 0xf39c12, // orange
    Rare:     0xe74c3c, // red
    Unique:   0x9b59b6, // purple
  };
  const pfsColor = {
    Standard:   0x2ecc71,
    Limited:    0xf39c12,
    Restricted: 0xe74c3c,
  };
  const color = rarityColor[feat.rarity] ?? pfsColor[feat.pfs_access] ?? 0x4a90d9;

  // Action type icons (still supported if a feat has action_tag_full)
  const actionIcons = {
    one_action:    '◆ 1 action',
    two_actions:   '◆◆ 2 actions',
    three_actions: '◆◆◆ 3 actions',
    reaction:      '⤾ Reaction',
    free_action:   '◇ Free Action',
  };
  const actionText = feat.action_tag_full ? (actionIcons[feat.action_tag_full] ?? feat.action_tag_full) : null;

  // Build a traits line for the description (shown above the summary text)
  const traitChips = [];
  if (feat.rarity && feat.rarity !== 'Common') traitChips.push(feat.rarity);
  if (Array.isArray(feat.traits)) traitChips.push(...feat.traits);
  const traitsLine = traitChips.length ? `*${traitChips.join(', ')}*` : null;

  // Description: traits line + summary text
  const desc = feat.description || '*No description available.*';
  const fullDesc = traitsLine ? `${traitsLine}\n\n${desc}` : desc;

  // Build field list
  const fields = [
    { name: '📊 Level', value: feat.level != null ? String(feat.level) : 'Unknown', inline: true },
  ];
  if (actionText) fields.push({ name: '⚡ Activity', value: actionText, inline: true });
  if (feat.pfs_access) fields.push({ name: '🎫 PFS', value: feat.pfs_access, inline: true });
  if (feat.prerequisites) {
    const prereq = String(feat.prerequisites).slice(0, 1024);
    fields.push({ name: '📋 Prerequisites', value: prereq, inline: false });
  }
  if (feat.notes) {
    fields.push({ name: '📝 Notes', value: String(feat.notes).slice(0, 1024), inline: false });
  }

  // Footer: source citation (e.g. "Player Core 2 pg. 223")
  const sourceText = feat.source
    ?? (feat.source_book ? `${feat.source_book}${feat.source_page ? ` pg. ${feat.source_page}` : ''}` : null);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🪄 ${feat.name}`)
    .setDescription(fullDesc.slice(0, 4000))
    .addFields(fields)
    .setFooter({ text: `PF2e Feat Lookup • ${sourceText ?? 'Archives of Nethys'}` });

  return embed;
}

function formatFeatMatchLine(feat) {
  const lvl = feat.level != null ? ` *(Lvl ${feat.level})*` : '';
  return `• **${feat.name}**${lvl}`;
}

// ── Item lookup ───────────────────────────────────────────────────────────────
function normalizeItemQuery(str) {
  return String(str ?? '').toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ');
}

function findItem(query, levelFilter) {
  const q = normalizeItemQuery(query);
  if (!q) return { item: null, matches: [] };

  const pool = levelFilter != null
    ? itemDatabase.filter(i => i.level === levelFilter)
    : itemDatabase;

  // 1. Exact name match (prefer lookup_name, fall back to name)
  const exact = pool.filter(i =>
    (i.lookup_name ?? i.name).toLowerCase() === q ||
    i.name.toLowerCase() === q
  );
  if (exact.length === 1) return { item: exact[0], matches: [] };
  if (exact.length > 1)   return { item: null, matches: exact, exactDuplicates: true };

  // 2. Starts-with match
  const starts = pool.filter(i => i.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return { item: starts[0], matches: [] };

  // 3. Contains match
  const contains = pool.filter(i => i.name.toLowerCase().includes(q));
  if (contains.length === 1) return { item: contains[0], matches: [] };
  if (contains.length > 1)   return { item: null, matches: contains };

  return { item: null, matches: [] };
}

function buildItemEmbed(item) {
  // Color by rarity (matches AoN conventions)
  const rarityColor = {
    Common:    0x4a90d9, // blue
    Uncommon:  0xf39c12, // orange
    Rare:      0xe74c3c, // red
    Unique:    0x9b59b6, // purple
  };
  const color = rarityColor[item.rarity] ?? 0x4a90d9;

  // Category emoji
  const categoryIcons = {
    'Weapons':          '⚔️',
    'Armor':            '🛡️',
    'Shields':          '🛡️',
    'Adventuring Gear': '🎒',
    'Alchemical Items': '⚗️',
    'Consumables':      '🧪',
    'Wands':            '🪄',
    'Staves':           '🪄',
    'Runes':            '✨',
    'Worn Items':       '💍',
    'Held Items':       '🤲',
    'Snares':           '🪤',
    'Vehicles':         '🚢',
    'Siege Weapons':    '🏹',
    'Materials':        '🪨',
    'Tattoos':          '🖋️',
    'Artifacts':        '👑',
    'Cursed Items':     '☠️',
  };
  const icon = categoryIcons[item.category] ?? '📦';

  // Build traits line: include rarity if not Common, then traits
  const traitChips = [];
  if (item.rarity && item.rarity !== 'Common') traitChips.push(item.rarity);
  if (Array.isArray(item.traits)) traitChips.push(...item.traits);
  const traitsDisplay = traitChips.length ? `*${traitChips.join(', ')}*` : null;

  // Source line
  const sourceText = item.source?.source_text
    ?? (item.source?.book ? `${item.source.book}${item.source.page ? ` pg. ${item.source.page}` : ''}` : null);

  // Category line (e.g. "Weapons · Specific Magic Weapons")
  const categoryLine = [item.category, item.subcategory].filter(Boolean).join(' · ');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${icon} ${item.name}`);

  // Description is the traits line (italic), since items in this dataset don't have prose descriptions
  if (traitsDisplay) embed.setDescription(traitsDisplay);

  // Top row: Level / Price / Bulk
  const topFields = [
    { name: '📊 Level', value: item.level != null ? String(item.level) : '—', inline: true },
    { name: '💰 Price', value: item.price_raw || '—',                         inline: true },
    { name: '⚖️ Bulk',  value: item.bulk_raw  || '—',                         inline: true },
  ];
  embed.addFields(topFields);

  // Usage (held in 1 hand, worn, etc.)
  if (item.usage) embed.addFields({ name: '✋ Usage', value: item.usage, inline: false });

  // Category / subcategory
  if (categoryLine) embed.addFields({ name: '📂 Category', value: categoryLine, inline: true });

  // PFS availability
  if (item.pfs_availability) embed.addFields({ name: '🎫 PFS', value: item.pfs_availability, inline: true });

  // Campaign (e.g. Kingmaker-only items)
  if (item.campaign) embed.addFields({ name: '📜 Campaign', value: item.campaign, inline: true });

  // Notes, if present
  if (item.notes) embed.addFields({ name: '📝 Notes', value: String(item.notes).slice(0, 1000), inline: false });

  embed.setFooter({ text: `PF2e Item Lookup • ${sourceText ?? 'Archives of Nethys'}` });
  return embed;
}

function formatItemMatchLine(item) {
  const lvl = item.level != null ? ` *(Lvl ${item.level})*` : '';
  const cat = item.category ? ` — ${item.category}` : '';
  return `• **${item.name}**${lvl}${cat}`;
}

// ── Deity lookup ──────────────────────────────────────────────────────────────
function normalizeDeityQuery(str) {
  return String(str ?? '').toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ');
}

function findDeity(query) {
  const q = normalizeDeityQuery(query);
  if (!q) return { deity: null, matches: [] };

  // 1. Exact name match
  const exact = deityDatabase.filter(d => d.name.toLowerCase() === q);
  if (exact.length === 1) return { deity: exact[0], matches: [] };
  if (exact.length > 1)   return { deity: null, matches: exact, exactDuplicates: true };

  // 2. Starts-with
  const starts = deityDatabase.filter(d => d.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return { deity: starts[0], matches: [] };

  // 3. Contains
  const contains = deityDatabase.filter(d => d.name.toLowerCase().includes(q));
  if (contains.length === 1) return { deity: contains[0], matches: [] };
  if (contains.length > 1)   return { deity: null, matches: contains };

  return { deity: null, matches: [] };
}

function buildDeityEmbed(deity) {
  // Color by PFS availability
  const pfsColor = {
    Standard:   0x2ecc71,
    Limited:    0xf39c12,
    Restricted: 0xe74c3c,
  };
  const color = pfsColor[deity.pfs_availability] ?? 0x9b59b6;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⛪ ${deity.name}`);

  // Subtitle line: PFS availability + pantheons
  const subtitleParts = [];
  if (deity.pfs_availability) subtitleParts.push(`PFS ${deity.pfs_availability}`);
  if (deity.pantheons?.length) subtitleParts.push(deity.pantheons.join(', '));
  if (subtitleParts.length) embed.setDescription(`*${subtitleParts.join(' · ')}*`);

  // Edicts / Anathemas — the core flavor content
  if (deity.edicts) {
    embed.addFields({ name: '✅ Edicts',    value: String(deity.edicts).slice(0, 1024),    inline: false });
  }
  if (deity.anathemas) {
    embed.addFields({ name: '🚫 Anathemas', value: String(deity.anathemas).slice(0, 1024), inline: false });
  }

  // Domains — comma-joined
  if (deity.domains?.length) {
    embed.addFields({ name: '🏛️ Domains', value: deity.domains.join(', '), inline: false });
  }

  // Mechanical stats (divine font, sanctification, attributes) — in a compact row
  const mechanicals = [];
  if (deity.divine_font)     mechanicals.push(`**Divine Font** ${deity.divine_font}`);
  if (deity.sanctification)  mechanicals.push(`**Sanctification** ${deity.sanctification}`);
  if (deity.attributes?.length) mechanicals.push(`**Attributes** ${deity.attributes.join(', ')}`);
  if (mechanicals.length) {
    embed.addFields({ name: '⚙️ Cleric Mechanics', value: mechanicals.join('\n'), inline: false });
  }

  // Divine skill + favored weapon
  const gearParts = [];
  if (deity.divine_skill)   gearParts.push(`**Skill** ${deity.divine_skill}`);
  if (deity.favored_weapon) gearParts.push(`**Favored Weapon** ${deity.favored_weapon}`);
  if (gearParts.length) {
    embed.addFields({ name: '🎯 Divine Gifts', value: gearParts.join(' · '), inline: false });
  }

  // Devotee benefits (can be long — truncate if needed)
  if (deity.devotee_benefits?.length) {
    const benefits = deity.devotee_benefits.join(', ');
    embed.addFields({
      name: '✨ Sanctifications / Devotee Benefits',
      value: benefits.length > 1024 ? benefits.slice(0, 1021) + '...' : benefits,
      inline: false,
    });
  }

  embed.setFooter({ text: `PF2e Deity Lookup • ${deity.source_text ?? 'Archives of Nethys'}` });
  return embed;
}

function formatDeityMatchLine(deity) {
  const pantheon = deity.pantheons?.[0] ? ` — ${deity.pantheons[0]}` : '';
  return `• **${deity.name}**${pantheon}`;
}

// ── Skill lookup ──────────────────────────────────────────────────────────────
// Finds a skill by slug key (e.g. "athletics"), display name, or partial match.
function findSkill(query) {
  if (!query) return { skill: null, key: null, matches: [] };
  const q = String(query).toLowerCase().trim();
  const entries = Object.entries(skillDatabase);
  if (entries.length === 0) return { skill: null, key: null, matches: [] };

  // 1. Exact slug key match
  if (skillDatabase[q]) return { skill: skillDatabase[q], key: q, matches: [] };

  // 2. Exact name match
  const exactName = entries.find(([, s]) => s.name.toLowerCase() === q);
  if (exactName) return { skill: exactName[1], key: exactName[0], matches: [] };

  // 3. Starts-with match on name
  const startsWith = entries.filter(([, s]) => s.name.toLowerCase().startsWith(q));
  if (startsWith.length === 1) return { skill: startsWith[0][1], key: startsWith[0][0], matches: [] };
  if (startsWith.length > 1) return { skill: null, key: null, matches: startsWith.map(([, s]) => s.name) };

  // 4. Substring match
  const contains = entries.filter(([, s]) => s.name.toLowerCase().includes(q));
  if (contains.length === 1) return { skill: contains[0][1], key: contains[0][0], matches: [] };
  if (contains.length > 1) return { skill: null, key: null, matches: contains.map(([, s]) => s.name) };

  return { skill: null, key: null, matches: [] };
}

// ── Companion lookup ─────────────────────────────────────────────────────────
// Finds a companion by name. Similar shape to findSkill (exact → starts-with →
// contains), with case-insensitive matching and multi-match handling.
function findCompanion(query) {
  if (!query) return { companion: null, matches: [] };
  const q = String(query).toLowerCase().trim();
  if (companionDatabase.length === 0) return { companion: null, matches: [] };

  // 1. Exact name match
  const exact = companionDatabase.find(c => c.name.toLowerCase() === q);
  if (exact) return { companion: exact, matches: [] };

  // 2. Starts-with match
  const starts = companionDatabase.filter(c => c.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return { companion: starts[0], matches: [] };
  if (starts.length > 1) return { companion: null, matches: starts.map(c => c.name) };

  // 3. Contains match
  const contains = companionDatabase.filter(c => c.name.toLowerCase().includes(q));
  if (contains.length === 1) return { companion: contains[0], matches: [] };
  if (contains.length > 1) return { companion: null, matches: contains.map(c => c.name) };

  return { companion: null, matches: [] };
}

// Format an attack line for the companion embed:
//   "◆ **jaws** (finesse) — 1d8 piercing"
function formatCompanionAttack(atk) {
  const costIcon = atk.actionCost === 'one-action' ? '◆'
    : atk.actionCost === 'two-actions' ? '◆◆'
    : atk.actionCost === 'three-actions' ? '◆◆◆'
    : atk.actionCost === 'reaction' ? '⤾'
    : atk.actionCost === 'free-action' ? '◇'
    : `[${atk.actionCost}]`;
  const traits = atk.traits && atk.traits.length ? ` *(${atk.traits.join(', ')})*` : '';
  const damage = atk.damage ? ` — ${atk.damage}` : '';
  return `${costIcon} **${atk.name}**${traits}${damage}`;
}

// Format the ability scores line: "Str +2, Dex +3, Con +2, Int -4, Wis +1, Cha +0"
function formatCompanionAbilities(abilities) {
  const order = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  return order.map(a => {
    const v = abilities[a] ?? 0;
    const sign = v >= 0 ? '+' : '';
    return `**${a.toUpperCase()}** ${sign}${v}`;
  }).join(' · ');
}

// Build the companion info embed. Shows the full Young-tier statblock with
// description, abilities, defenses, offense, support benefit, and maneuver.
function buildCompanionEmbed(companion) {
  // Category → color: Animal green, Construct gray, Plant forest, Undead crimson
  const colorByCategory = {
    Animal: 0x2ecc71,
    Construct: 0x95a5a6,
    Plant: 0x16a085,
    Undead: 0x8B0000,
  };
  const color = colorByCategory[companion.category] ?? 0x7289DA;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🐾 ${companion.name}`)
    .setFooter({ text: `${companion.category} Companion · ${companion.source ?? 'Pathfinder 2e'}` });

  // Header line: traits + size + PFS
  const traitsLine = companion.traits.length ? `*${companion.traits.join(' ')}*` : '';
  const sizeLine = companion.size ? `**Size:** ${companion.size}` : '';
  const header = [traitsLine, sizeLine].filter(Boolean).join(' · ');
  const descParts = [];
  if (header) descParts.push(header);
  if (companion.description) descParts.push(companion.description);
  if (companion.access) descParts.push(`**Access:** ${companion.access}`);
  if (descParts.length) embed.setDescription(descParts.join('\n\n').slice(0, 4000));

  // Abilities (inline)
  embed.addFields({
    name: '📊 Abilities',
    value: formatCompanionAbilities(companion.abilities),
    inline: false,
  });

  // Defenses: HP + senses
  const defParts = [];
  if (companion.hp !== null) defParts.push(`**HP** ${companion.hp}`);
  if (companion.speed) defParts.push(`**Speed** ${companion.speed}`);
  if (companion.skill) defParts.push(`**Skill** ${companion.skill}`);
  if (companion.senses && companion.senses.length) defParts.push(`**Senses** ${companion.senses.join(', ')}`);
  if (defParts.length) {
    embed.addFields({ name: '🛡️ Stats', value: defParts.join(' · '), inline: false });
  }

  // Attacks
  const attackLines = [];
  for (const a of companion.melee) attackLines.push('Melee: ' + formatCompanionAttack(a));
  for (const a of companion.ranged) attackLines.push('Ranged: ' + formatCompanionAttack(a));
  if (attackLines.length) {
    embed.addFields({ name: '⚔️ Attacks', value: attackLines.join('\n'), inline: false });
  }

  // Special abilities
  if (companion.special) {
    embed.addFields({ name: '✨ Special', value: companion.special.slice(0, 1020), inline: false });
  }

  // Support Benefit
  if (companion.support) {
    embed.addFields({ name: '🤝 Support Benefit', value: companion.support.slice(0, 1020), inline: false });
  }

  // Advanced Maneuver
  if (companion.maneuver) {
    const m = companion.maneuver;
    const actions = m.actions ? m.actions.replace(/\[([^\]]+)\]/, '$1') : '';
    const traits = m.traits && m.traits.length ? ` · *${m.traits.join(' ')}*` : '';
    const heading = `💥 Advanced Maneuver: ${m.name}${actions ? ` (${actions})` : ''}${traits}`;
    const body = m.description ?
      m.description.replace(/^Source .+?pg\.\s*\d+\s*/i, '').slice(0, 1020) :
      '*No description available.*';
    embed.addFields({ name: heading.slice(0, 256), value: body, inline: false });
  }

  return embed;
}

// Build a paginated list embed of companions, optionally filtered by category.
function buildCompanionListEmbed(category, page = 0) {
  const filtered = category
    ? companionDatabase.filter(c => c.category.toLowerCase() === category.toLowerCase())
    : companionDatabase;
  const perPage = 40; // just list names, so we can fit a lot
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const actualPage = Math.min(page, totalPages - 1);
  const start = actualPage * perPage;
  const slice = filtered.slice(start, start + perPage);

  const title = category
    ? `🐾 ${category} Companions`
    : `🐾 Animal Companions`;
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(title)
    .setDescription(slice.map(c => `• **${c.name}**${c.traits.includes('Uncommon') ? ' *(uncommon)*' : c.traits.includes('Rare') ? ' *(rare)*' : ''}`).join('\n') || '*No companions match this filter.*')
    .setFooter({ text: `${filtered.length} total${totalPages > 1 ? ` · Page ${actualPage + 1}/${totalPages}` : ''} · Use /companion info name:<name> for details` });
  return embed;
}


// Scale a companion's combat stats by character level + form.
function scaleCompanion(comp, char) {
  const lvl = char.level ?? 1;
  const form = comp.form ?? 'young';
  let baseHp, abilities, attacks, size, speed;
  if (comp.baseType === 'custom' && comp.customStats) {
    // Use a per-level HP base (default 6, or customStats.hpPerLevel if set).
    // The raw hp from the bestiary is the creature's FULL HP, not a per-level base.
    // For custom companions, we approximate size-based per-level HP.
    baseHp = comp.customStats.hpPerLevel ?? (() => {
      const s = (comp.customStats.size ?? 'Medium').toLowerCase();
      if (s === 'tiny') return 4;
      if (s === 'small') return 6;
      if (s === 'medium') return 8;
      if (s === 'large') return 10;
      if (s === 'huge') return 12;
      return 8;
    })();
    abilities = comp.customStats.abilities ?? {};
    attacks = comp.customStats.attacks ?? [];
    size = comp.customStats.size ?? 'Medium';
    speed = comp.customStats.speed ?? '25 feet';
  } else {
    const { companion: base } = findCompanion(comp.baseType);
    if (!base) return { maxHp: 10, ac: 10, attackBonus: 0, damageDice: '1d4', form, abilities: {}, saves: { fort: 0, ref: 0, will: 0 }, size: 'Medium', speed: '25 feet', damageType: '', damageBonus: 0, attacks: [], primaryAttack: null };
    baseHp = base.hp ?? 6;
    abilities = base.abilities ?? {};
    attacks = [...(base.melee ?? []), ...(base.ranged ?? [])];
    if (attacks.length === 0 && Array.isArray(base.attacks)) attacks = base.attacks;
    size = base.size ?? 'Medium';
    speed = base.speed ?? '25 feet';
  }
  const conMod = abilities.con ?? 0;
  let maxHp;
  if (form === 'young') maxHp = baseHp * lvl;
  else if (form === 'mature') maxHp = (baseHp + conMod) * lvl;
  else maxHp = (baseHp + conMod + 1) * lvl;
  if (maxHp < baseHp) maxHp = baseHp;
  let profBonus;
  if (form === 'young') profBonus = lvl;
  else if (form === 'mature') profBonus = lvl + 2;
  else profBonus = lvl + 4;
  const dexMod = abilities.dex ?? 0;
  const ac = 10 + dexMod + profBonus;
  const saves = { fort: profBonus + conMod, ref: profBonus + dexMod, will: profBonus + (abilities.wis ?? 0) };
  const primary = attacks[0];
  const isFinesse = primary?.traits?.includes('finesse');
  const strMod = abilities.str ?? 0;
  const abilForAttack = isFinesse && dexMod > strMod ? dexMod : strMod;
  const attackBonus = profBonus + abilForAttack;
  let damageDice = '1d4', damageType = '';
  if (primary?.damage) {
    const m = primary.damage.match(/(\d+)d(\d+)\s*(\w*)/);
    if (m) {
      let dieSize = parseInt(m[2], 10);
      if (form === 'savage') dieSize = Math.min(12, dieSize + 2);
      damageDice = `${m[1]}d${dieSize}`;
      damageType = m[3] || '';
    }
  }
  const result = { maxHp, ac, attackBonus, damageDice, damageType, damageBonus: strMod, saves, form, size, speed, primaryAttack: primary, abilities, attacks };

  // Apply per-companion overrides. Any field set to a non-null value in
  // comp.overrides replaces the computed value. This lets players tweak
  // stats (e.g. boost AC, change ability scores, fix odd HP totals) without
  // losing the automatic scaling for untouched fields.
  const ov = comp.overrides ?? {};
  if (ov.hp != null)           result.maxHp = ov.hp;
  if (ov.ac != null)           result.ac = ov.ac;
  if (ov.attackBonus != null)  result.attackBonus = ov.attackBonus;
  if (ov.damageDice)           result.damageDice = ov.damageDice;
  if (ov.damageBonus != null)  result.damageBonus = ov.damageBonus;
  if (ov.speed)                result.speed = ov.speed;
  if (ov.size)                 result.size = ov.size;
  if (ov.abilities) {
    result.abilities = { ...result.abilities };
    for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      if (ov.abilities[key] != null) result.abilities[key] = ov.abilities[key];
    }
  }
  if (ov.saves) {
    result.saves = { ...result.saves };
    for (const key of ['fort', 'ref', 'will']) {
      if (ov.saves[key] != null) result.saves[key] = ov.saves[key];
    }
  }
  // Track which fields were overridden so the sheet can flag them visually
  result.overriddenFields = [];
  if (ov.hp != null) result.overriddenFields.push('HP');
  if (ov.ac != null) result.overriddenFields.push('AC');
  if (ov.attackBonus != null) result.overriddenFields.push('attack');
  if (ov.damageDice) result.overriddenFields.push('damage');
  if (ov.damageBonus != null) result.overriddenFields.push('dmg bonus');
  if (ov.speed) result.overriddenFields.push('speed');
  if (ov.size) result.overriddenFields.push('size');
  if (ov.abilities && Object.values(ov.abilities).some(v => v != null)) result.overriddenFields.push('abilities');
  if (ov.saves && Object.values(ov.saves).some(v => v != null)) result.overriddenFields.push('saves');

  return result;
}

function buildCompanionSheetEmbed(comp, scaled, char, charEntry, isActive) {
  const embed = new EmbedBuilder()
    .setColor(isActive ? 0xf39c12 : 0x7289DA)
    .setTitle(`🐾 ${comp.displayName}${isActive ? ' ⭐' : ''}`)
    .setDescription(`*${char.name}'s ${comp.form} ${comp.baseType === 'custom' ? (comp.customStats?.fromBestiary ?? 'custom') : comp.baseType} companion*`);

  // Show portrait if set. Prefer companion.art, fall back to character art.
  if (comp.art) embed.setThumbnail(comp.art);
  else if (charEntry.art) embed.setThumbnail(charEntry.art);

  // Mark overridden fields with a small asterisk in the label
  const ov = comp.overrides ?? {};
  const flag = (key) => ov[key] != null ? ' ✏️' : '';
  const abFlag = (key) => (ov.abilities && ov.abilities[key] != null) ? '\\*' : '';
  const saveFlag = (key) => (ov.saves && ov.saves[key] != null) ? '\\*' : '';

  const hp = comp.currentHp ?? scaled.maxHp;
  embed.addFields({ name: '🛡️ Defenses', value: `**HP** ${hp}/${scaled.maxHp}${flag('hp')} · **AC** ${scaled.ac}${flag('ac')} · **Size** ${scaled.size}${flag('size')} · **Speed** ${scaled.speed}${flag('speed')}`, inline: false });
  embed.addFields({ name: '💪 Saves', value: `**Fort** ${fmt(scaled.saves.fort)}${saveFlag('fort')} · **Ref** ${fmt(scaled.saves.ref)}${saveFlag('ref')} · **Will** ${fmt(scaled.saves.will)}${saveFlag('will')}`, inline: false });
  const ab = scaled.abilities;
  embed.addFields({ name: '📊 Abilities', value: `Str ${fmt(ab.str ?? 0)}${abFlag('str')} · Dex ${fmt(ab.dex ?? 0)}${abFlag('dex')} · Con ${fmt(ab.con ?? 0)}${abFlag('con')} · Int ${fmt(ab.int ?? -4)}${abFlag('int')} · Wis ${fmt(ab.wis ?? 0)}${abFlag('wis')} · Cha ${fmt(ab.cha ?? 0)}${abFlag('cha')}`, inline: false });
  if (scaled.primaryAttack) {
    const traits = scaled.primaryAttack.traits?.length ? ` *(${scaled.primaryAttack.traits.join(', ')})*` : '';
    const dmgBonus = scaled.damageBonus !== 0 ? (scaled.damageBonus > 0 ? `+${scaled.damageBonus}` : `${scaled.damageBonus}`) : '';
    embed.addFields({ name: '⚔️ Primary Attack', value: `**${scaled.primaryAttack.name}**${traits}\n**+${scaled.attackBonus}**${flag('attackBonus')} to hit · **${scaled.damageDice}${flag('damageDice')}${dmgBonus}${flag('damageBonus')}** ${scaled.damageType}`, inline: false });
  }
  if (comp.notes) embed.addFields({ name: '📝 Notes', value: comp.notes.slice(0, 1020), inline: false });
  const hasOverrides = (scaled.overriddenFields ?? []).length > 0;
  const footerExtra = hasOverrides ? ` · ✏️ = overridden` : '';
  embed.setFooter({ text: `Character: ${char.name} · /companion set to customize${footerExtra}` });
  return embed;
}

// Compute the character's modifier + proficiency for a given skill slug.
// Returns { modifier, profLabel, profNum } or null if no character / invalid skill.
// skillKey is the lowercase slug ("athletics"), not the display name.
function computeCharSkillModifier(charEntry, skillKey) {
  if (!charEntry || !skillKey) return null;
  const c = charEntry.data;
  if (!c) return null;
  const ab = c.abilities ?? {};
  const prof = c.proficiencies ?? {};
  const lvl = c.level ?? 1;

  // Map skill slug → ability used
  const skillAbilMap = {
    acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
    deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
    nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
    society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
  };
  const abilKey = skillAbilMap[skillKey];
  if (!abilKey) return null;
  const abilMod = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
  const profNum = prof[skillKey] ?? 0;
  const modifier = abilMod + calcProfNum(profNum, lvl);
  const profLabelMap = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
  const profLabel = profLabelMap[profNum] ?? 'Untrained';
  return { modifier, profLabel, profNum };
}

// Action-cost icon. Falls back to the original string for unusual costs.
function skillActionCostIcon(cost) {
  if (!cost) return '';
  const c = String(cost).toLowerCase().trim();
  const map = {
    '1 action': '◆',
    '2 actions': '◆◆',
    '3 actions': '◆◆◆',
    'reaction': '⤾',
    '1 reaction': '⤾',
    'free action': '◇',
  };
  return map[c] ?? cost;
}

// ── Skill embed builders (3-page: Overview / Actions / DCs & Examples) ──────
const SKILL_COLORS = {
  overview: 0x2a8fbd, // blue — the skill description
  actions: 0xc45f00, // orange — the actions it unlocks
  dcs: 0x7b5ea7, // purple — DC examples
};

function buildSkillOverviewPage(skill, charMod = null) {
  const embed = new EmbedBuilder()
    .setColor(SKILL_COLORS.overview)
    .setTitle(`🎯 ${skill.name}`)
    .setDescription(skill.description)
    .setFooter({ text: `Page 1/3 • Pathfinder 2e Remaster` });

  // Key attribute + (if character loaded) the character's modifier
  const attrFields = [{ name: '🔑 Key Attribute', value: skill.keyAttribute, inline: true }];
  if (charMod) {
    const sign = charMod.modifier >= 0 ? '+' : '';
    attrFields.push({
      name: '📊 Your Modifier',
      value: `**${sign}${charMod.modifier}** · *${charMod.profLabel}*`,
      inline: true,
    });
  }
  embed.addFields(attrFields);

  // Common uses as a bullet list
  const usesList = (skill.commonUses ?? []).map(u => `• ${u}`).join('\n');
  if (usesList) {
    embed.addFields({ name: '🌟 Common Uses', value: usesList.slice(0, 1024), inline: false });
  }

  return embed;
}

function buildSkillActionsPage(skill) {
  const embed = new EmbedBuilder()
    .setColor(SKILL_COLORS.actions)
    .setTitle(`🎯 ${skill.name} — Actions`)
    .setDescription(`Actions that use **${skill.name}**. Proficiency indicates the minimum rank required.`)
    .setFooter({ text: `Page 2/3 • Pathfinder 2e Remaster` });

  // Chunk the actions into fields. Each action has its own field so it stays readable.
  const actions = skill.actions ?? [];
  for (const action of actions) {
    const costIcon = skillActionCostIcon(action.cost);
    const costPart = costIcon ? `${costIcon} · ` : '';
    const heading = `${costPart}**${action.name}** *(${action.proficiency})*`;
    const body = String(action.description).slice(0, 950);
    embed.addFields({
      name: heading.slice(0, 256),
      value: body,
      inline: false,
    });
  }

  if (actions.length === 0) {
    embed.addFields({ name: '\u200b', value: '*No actions listed for this skill.*', inline: false });
  }

  return embed;
}

function buildSkillDcsPage(skill) {
  const embed = new EmbedBuilder()
    .setColor(SKILL_COLORS.dcs)
    .setTitle(`🎯 ${skill.name} — DCs & Examples`)
    .setDescription(`Example DCs for **${skill.name}** checks. Actual DCs depend on level, circumstance, and GM adjudication.`)
    .setFooter({ text: `Page 3/3 • Pathfinder 2e Remaster` });

  const examples = skill.dcExamples ?? [];
  if (examples.length) {
    const lines = examples.map(e => `**DC ${e.dc}** — ${e.example}`).join('\n');
    embed.addFields({ name: '📐 Example DCs', value: lines.slice(0, 1024), inline: false });
  }

  // General PF2e DC guidance (always the same, independent of skill)
  embed.addFields({
    name: '📊 General DC Guide (by difficulty)',
    value:
      '**Trivial** — usually no check needed\n' +
      '**Easy** — DC -2 (for the task\'s level)\n' +
      '**Standard** — DC for the level\n' +
      '**Hard** — DC +2\n' +
      '**Very Hard** — DC +5\n' +
      '**Incredibly Hard** — DC +10',
    inline: false,
  });

  // Degree of success reminder
  embed.addFields({
    name: '🎲 Degrees of Success',
    value:
      '🌟 **Crit Success** — roll ≥ DC + 10, or nat 20 one step up\n' +
      '✅ **Success** — roll ≥ DC\n' +
      '❌ **Failure** — roll < DC\n' +
      '💥 **Crit Failure** — roll ≤ DC − 10, or nat 1 one step down',
    inline: false,
  });

  return embed;
}

function buildSkillButtons(currentPage, skillKey) {
  const id = skillKey.toLowerCase();
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`skill_${id}_0`).setLabel('◀ Overview').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`skill_${id}_1`).setLabel('Actions').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 1),
    new ButtonBuilder().setCustomId(`skill_${id}_2`).setLabel('DCs & Examples ▶').setStyle(ButtonStyle.Success).setDisabled(currentPage === 2),
  );
}

// ── Class lookup ──────────────────────────────────────────────────────────────
function findClass(query) {
  if (!query) return { cls: null, key: null, matches: [] };
  const q = String(query).toLowerCase().trim();
  const entries = Object.entries(classDatabase);
  if (classDatabase[q]) return { cls: classDatabase[q], key: q, matches: [] };
  const exact = entries.find(([, c]) => c.name.toLowerCase() === q);
  if (exact) return { cls: exact[1], key: exact[0], matches: [] };
  const starts = entries.filter(([, c]) => c.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return { cls: starts[0][1], key: starts[0][0], matches: [] };
  if (starts.length > 1) return { cls: null, key: null, matches: starts.map(([, c]) => c.name) };
  const contains = entries.filter(([, c]) => c.name.toLowerCase().includes(q));
  if (contains.length === 1) return { cls: contains[0][1], key: contains[0][0], matches: [] };
  return { cls: null, key: null, matches: contains.map(([, c]) => c.name) };
}

// Chunk a long text into Discord-safe field values (max 1024 chars each)
function chunkText(text, max = 1020) {
  if (!text) return [];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    // Break at last paragraph/sentence within max
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('. ', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function buildClassOverviewPage(cls, userCharName = null) {
  const embed = new EmbedBuilder()
    .setColor(0x8e44ad)
    .setTitle(`⚔️ ${cls.name}`)
    .setDescription((cls.description || '*No description available.*').slice(0, 4000));
  const metaBits = [];
  if (cls.keyAttribute) metaBits.push(`**🔑 Key Attribute:** ${cls.keyAttribute}`);
  if (cls.hitPoints) metaBits.push(`**❤️ Hit Points:** ${cls.hitPoints}`);
  if (cls.source) metaBits.push(`**📖 Source:** ${cls.source}`);
  if (userCharName) metaBits.push(`*Your character: ${userCharName}*`);
  if (metaBits.length) embed.addFields({ name: 'Class Basics', value: metaBits.join('\n'), inline: false });
  if (Array.isArray(cls.keyTerms) && cls.keyTerms.length > 0) {
    const termText = cls.keyTerms.map(t => `**${t.name}**: ${t.description}`).join('\n\n');
    const chunks = chunkText(termText, 1020);
    chunks.slice(0, 2).forEach((chunk, i) => {
      embed.addFields({ name: i === 0 ? '📚 Key Terms' : '📚 Key Terms (cont.)', value: chunk, inline: false });
    });
  }
  embed.setFooter({ text: `Page 1/5 • Pathfinder 2e` });
  return embed;
}

function buildClassProficienciesPage(cls) {
  const embed = new EmbedBuilder()
    .setColor(0x2980b9)
    .setTitle(`⚔️ ${cls.name} — Proficiencies`)
    .setDescription(`Initial proficiencies at 1st level.`);
  const order = ['perception', 'savingthrows', 'skills', 'attacks', 'defenses', 'classdc', 'armor', 'spellattacks', 'spelldcs'];
  const labels = { perception: '👁️ Perception', savingthrows: '💪 Saving Throws', skills: '🎯 Skills', attacks: '⚔️ Attacks', defenses: '🛡️ Defenses', classdc: '🎲 Class DC', armor: '🛡️ Armor', spellattacks: '✨ Spell Attacks', spelldcs: '✨ Spell DCs' };
  for (const key of order) {
    if (cls.proficiencies?.[key]) {
      embed.addFields({ name: labels[key] ?? key, value: String(cls.proficiencies[key]).slice(0, 1020), inline: false });
    }
  }
  if (Object.keys(cls.proficiencies ?? {}).length === 0) {
    embed.setDescription('*No proficiency data available for this class.*');
  }
  embed.setFooter({ text: `Page 2/5 • Pathfinder 2e` });
  return embed;
}

function buildClassFeaturesPage(cls) {
  const embed = new EmbedBuilder()
    .setColor(0xc0392b)
    .setTitle(`⚔️ ${cls.name} — Class Features`)
    .setDescription(`Features gained as you level up. Level-by-level progression is printed in the class's Archives of Nethys entry.`);
  if (Array.isArray(cls.classFeatures) && cls.classFeatures.length > 0) {
    const text = cls.classFeatures.join('\n');
    const chunks = chunkText(text, 1020);
    chunks.slice(0, 4).forEach((chunk, i) => {
      embed.addFields({ name: i === 0 ? '📋 Features' : '📋 Features (cont.)', value: chunk, inline: false });
    });
  } else {
    embed.setDescription('*No structured class features parsed. Check the Archives of Nethys entry for a full list.*');
  }
  embed.setFooter({ text: `Page 3/5 • Pathfinder 2e` });
  return embed;
}

function buildClassFeatsPage(cls) {
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`⚔️ ${cls.name} — Class Feats`)
    .setDescription(`Class-specific feats available to ${cls.name}s. Full descriptions are on Archives of Nethys; this is a level-organized summary.`);
  if (Array.isArray(cls.classFeatsRaw) && cls.classFeatsRaw.length > 0) {
    // The raw lines are a mix of feat names and descriptions; we just chunk and render them.
    const text = cls.classFeatsRaw.join('\n');
    const chunks = chunkText(text, 1020);
    chunks.slice(0, 4).forEach((chunk, i) => {
      embed.addFields({ name: i === 0 ? '📜 Feats' : '📜 Feats (cont.)', value: chunk, inline: false });
    });
    if (chunks.length > 4) {
      embed.addFields({ name: '…', value: `*${chunks.length - 4} more sections — see Archives of Nethys for the complete list.*`, inline: false });
    }
  } else {
    embed.setDescription('*No class feats parsed. Check Archives of Nethys for the full feat list.*');
  }
  embed.setFooter({ text: `Page 4/5 • Pathfinder 2e` });
  return embed;
}

function buildClassSubclassPage(cls) {
  const label = cls.subclassLabel ?? 'Subclasses';
  const embed = new EmbedBuilder()
    .setColor(0x16a085)
    .setTitle(`⚔️ ${cls.name} — ${label}`)
    .setDescription(`${cls.name} subclass options.`);
  if (Array.isArray(cls.subclassesRaw) && cls.subclassesRaw.length > 0) {
    const text = cls.subclassesRaw.join('\n');
    const chunks = chunkText(text, 1020);
    chunks.slice(0, 4).forEach((chunk, i) => {
      embed.addFields({ name: i === 0 ? `🎭 ${label}` : `🎭 ${label} (cont.)`, value: chunk, inline: false });
    });
  } else if (cls.subclassLabel) {
    embed.setDescription(`*${label} data not parsed cleanly. Check Archives of Nethys.*`);
  } else {
    embed.setDescription(`*${cls.name} doesn't have a formal subclass structure. Check Archives of Nethys for ${cls.name}-specific options.*`);
  }
  embed.setFooter({ text: `Page 5/5 • Pathfinder 2e` });
  return embed;
}

function buildClassButtons(currentPage, classKey) {
  const id = classKey.toLowerCase();
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`class_${id}_0`).setLabel('Overview').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`class_${id}_1`).setLabel('Proficiencies').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 1),
    new ButtonBuilder().setCustomId(`class_${id}_2`).setLabel('Features').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 2),
    new ButtonBuilder().setCustomId(`class_${id}_3`).setLabel('Class Feats').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 3),
    new ButtonBuilder().setCustomId(`class_${id}_4`).setLabel('Subclasses').setStyle(ButtonStyle.Success).setDisabled(currentPage === 4),
  );
}

// ── Bestiary lookup ───────────────────────────────────────────────────────────
function findMonster(query) {
  const normalize = str => String(str ?? '').toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ');
  const q = normalize(query);
  const qSlug = q.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  const entries = Object.entries(bestiaryDatabase);
  if (entries.length === 0) return { monster: null, matches: [] };

  // 1. Exact slug key match (e.g. "ancient_red_dragon")
  if (bestiaryDatabase[qSlug]) return { monster: bestiaryDatabase[qSlug], matches: [] };

  // 2. Exact display-name match
  const exactName = entries.find(([, m]) => normalize(m.name) === q);
  if (exactName) return { monster: exactName[1], matches: [] };

  // 3. Starts-with match on name
  const startsWith = entries.filter(([, m]) => normalize(m.name).startsWith(q));
  if (startsWith.length === 1) return { monster: startsWith[0][1], matches: [] };
  if (startsWith.length > 1 && startsWith.length <= 25) {
    return { monster: null, matches: startsWith.map(([, m]) => m.name) };
  }

  // 4. Substring match on name
  const contains = entries.filter(([, m]) => normalize(m.name).includes(q));
  if (contains.length === 1) return { monster: contains[0][1], matches: [] };
  if (contains.length > 1) {
    // Cap suggestions so we don't explode the embed
    const names = contains.map(([, m]) => m.name).sort();
    return { monster: null, matches: names.slice(0, 25), total: names.length };
  }

  return { monster: null, matches: [] };
}

// Format a single ability score modifier for the embed (e.g. "+3", "-1").
function fmtMod(n) {
  if (n === undefined || n === null) return null;
  return n >= 0 ? `+${n}` : `${n}`;
}

// Icons for PF2e action costs. Falls back to the raw string for unexpected values
// (e.g. "1 varies", "none", campaign-specific costs).
function actionCostIcon(cost) {
  if (!cost) return '';
  const c = String(cost).toLowerCase().trim();
  const map = {
    '1 action': '◆',
    'single action': '◆',
    '2 actions': '◆◆',
    'two actions': '◆◆',
    '3 actions': '◆◆◆',
    'three actions': '◆◆◆',
    '1 reaction': '⤾',
    'reaction': '⤾',
    '1 free': '◇',
    'free action': '◇',
    'none': '',
  };
  return map[c] ?? cost;
}

// Format one entry from the attacks array. Strikes look like:
//   ⚔️ dogslicer +8 (agile, backstabber, finesse), 1d6 slashing
function formatAttackLine(attack) {
  if (!attack) return '';
  const typeIcon = attack.type === 'ranged' ? '🏹' : '⚔️';
  const to = attack.to_hit !== undefined && attack.to_hit !== null
    ? ` ${attack.to_hit >= 0 ? '+' : ''}${attack.to_hit}`
    : '';
  const traits = Array.isArray(attack.traits) && attack.traits.length
    ? ` *(${attack.traits.join(', ')})*`
    : '';
  const dmg = attack.damage ? `, ${attack.damage}` : '';
  return `${typeIcon} **${attack.name}**${to}${traits}${dmg}`;
}

// Format one ability from the abilities.top/mid/bot arrays for the embed body.
// Kept compact — full descriptions can run long, so we truncate to 350 chars
// per ability to avoid blowing out the embed's 4096-char description cap.
function formatAbilityLine(ab) {
  if (!ab || !ab.name) return '';
  const icon = ab.action_cost ? actionCostIcon(ab.action_cost) : '';
  const iconPrefix = icon ? `${icon} ` : '';
  const traits = Array.isArray(ab.traits) && ab.traits.length
    ? ` *[${ab.traits.join(', ')}]*`
    : '';
  let body = '';
  if (ab.trigger)      body += `\n  *Trigger:* ${ab.trigger}`;
  if (ab.requirements) body += `\n  *Requirements:* ${ab.requirements}`;
  if (ab.frequency)    body += `\n  *Frequency:* ${ab.frequency}`;
  if (ab.description) {
    const desc = String(ab.description);
    body += `\n  ${desc.length > 350 ? desc.slice(0, 347) + '...' : desc}`;
  }
  return `${iconPrefix}**${ab.name}**${traits}${body}`;
}

// Schema-aware monster embed builder. Works with both the new merged bestiary
// shape ({ core, rich, summary }) and the legacy summary-only shape that
// used to live at the top level. Renders the full PF2e stat block when rich
// data is available: ability scores, skills, languages, items, attacks,
// abilities (top/mid/bot), spellcasting, plus the embed-only lore/tactics.
function buildMonsterEmbed(monster, artUrl = null) {
  const rarityColor = {
    Common: 0x4a90d9,
    Uncommon: 0xc45f00,
    Rare: 0x6b21a8,
    Unique: 0xb91c4a,
  };
  const sizeEmoji = {
    Tiny: '🐁', Small: '🐇', Medium: '🧍', Large: '🐎',
    Huge: '🐘', Gargantuan: '🐲',
  };

  // Prefer the flattened `core` block from the merged schema; fall back to
  // legacy `summary` and top-level fields for older bestiary files.
  const core = monster.core ?? {};
  const legacySummary = monster.summary ?? {};
  const rich = monster.rich ?? null;

  const level      = core.level      ?? legacySummary.level;
  const size       = core.size       ?? monster.size;
  const rarity     = core.rarity     ?? monster.rarity;
  const traits     = core.traits     ?? monster.traits ?? [];
  const hp         = core.hp         ?? legacySummary.hp?.value;
  const hpNotes    = legacySummary.hp?.notes ?? null;
  const ac         = core.ac         ?? legacySummary.ac;
  const perception = core.perception ?? legacySummary.perception;
  const fort = core.saves?.fort ?? legacySummary.fortitude;
  const ref  = core.saves?.ref  ?? legacySummary.reflex;
  const will = core.saves?.will ?? legacySummary.will;

  // Speed: rich has a structured object { land, fly, swim, ... };
  // summary has a raw string like "30 feet, fly 60 feet".
  let speedText = legacySummary.speed_raw ?? null;
  if (!speedText && rich?.speed) {
    speedText = Object.entries(rich.speed).map(([k, v]) => `${k} ${v} ft.`).join(', ');
  }

  // Senses: summary has senses_raw; rich has an array.
  const sensesText = legacySummary.senses_raw
    ?? (rich?.senses?.length ? rich.senses.join(', ') : null);

  const family = monster.family ?? null;

  const title = `${sizeEmoji[size] ?? '👹'} ${monster.name}`;
  const levelLine = level !== undefined && level !== null ? `Creature ${level}` : 'Creature';
  const rarityLine = rarity && rarity !== 'Common' ? ` • ${rarity}` : '';
  const sizeLine = size ? ` • ${size}` : '';

  // Description can come from the overlay (flavor text the GM set) or from
  // the bestiary's own summary. Only show it if present, and keep the header
  // block italicized so it reads as the subtitle.
  const headerDescription = `*${levelLine}${rarityLine}${sizeLine}*`;
  const editDescription = rich?.description ? `\n\n${String(rich.description).slice(0, 600)}` : '';

  const embed = new EmbedBuilder()
    .setColor(rarityColor[rarity] ?? 0x4a90d9)
    .setTitle(title)
    .setDescription(`${headerDescription}${editDescription}`);

  if (traits.length) {
    embed.addFields({ name: '🏷️ Traits', value: traits.join(', '), inline: false });
  }

  // Languages — rich only, but if a GM edit set them they'll be here too.
  if (rich?.languages?.length) {
    embed.addFields({ name: '🗣️ Languages', value: rich.languages.join(', '), inline: false });
  }

  // Skills — rich only. Show as "Athletics +8, Stealth +5" etc.
  if (rich?.skills && typeof rich.skills === 'object' && Object.keys(rich.skills).length) {
    const skillLine = Object.entries(rich.skills)
      .map(([name, mod]) => `${name} ${mod >= 0 ? '+' : ''}${mod}`)
      .join(', ');
    embed.addFields({ name: '🎯 Skills', value: skillLine.slice(0, 1024), inline: false });
  }

  // Ability scores — rich only, shown as a compact row. These are PF2e
  // modifiers (already the ±N form), not D&D-style raw scores.
  if (rich?.ability_modifiers && typeof rich.ability_modifiers === 'object') {
    const m = rich.ability_modifiers;
    const parts = [];
    if (m.str !== undefined) parts.push(`**Str** ${fmtMod(m.str)}`);
    if (m.dex !== undefined) parts.push(`**Dex** ${fmtMod(m.dex)}`);
    if (m.con !== undefined) parts.push(`**Con** ${fmtMod(m.con)}`);
    if (m.int !== undefined) parts.push(`**Int** ${fmtMod(m.int)}`);
    if (m.wis !== undefined) parts.push(`**Wis** ${fmtMod(m.wis)}`);
    if (m.cha !== undefined) parts.push(`**Cha** ${fmtMod(m.cha)}`);
    if (parts.length) {
      embed.addFields({ name: '📊 Ability Modifiers', value: parts.join(' · '), inline: false });
    }
  }

  // Items — rich only. Simple comma-joined.
  if (rich?.items?.length) {
    embed.addFields({ name: '🎒 Items', value: rich.items.join(', ').slice(0, 1024), inline: false });
  }

  // Defenses
  const defenseParts = [];
  if (ac !== undefined && ac !== null) defenseParts.push(`**AC** ${ac}`);
  if (hp !== undefined && hp !== null) {
    const notes = hpNotes ? ` ${hpNotes}` : '';
    defenseParts.push(`**HP** ${hp}${notes}`);
  }
  // Extra defensive stats that only live in the rich stat block
  if (rich?.defenses?.hardness) defenseParts.push(`**Hardness** ${rich.defenses.hardness}`);
  if (rich?.defenses?.hp_notes?.length) {
    defenseParts.push(`*${rich.defenses.hp_notes.join(', ')}*`);
  }
  if (defenseParts.length) {
    embed.addFields({ name: '🛡️ Defenses', value: defenseParts.join(' • '), inline: false });
  }

  // Immunities / weaknesses / resistances — rich only
  if (rich?.defenses?.immunities?.length) {
    embed.addFields({ name: '🚫 Immunities', value: rich.defenses.immunities.join(', ').slice(0, 1024), inline: false });
  }
  if (rich?.defenses?.weaknesses?.length) {
    const w = rich.defenses.weaknesses.map(x =>
      typeof x === 'string' ? x : `${x.type} ${x.value}`
    ).join(', ');
    embed.addFields({ name: '💔 Weaknesses', value: w.slice(0, 1024), inline: false });
  }
  if (rich?.defenses?.resistances?.length) {
    const r = rich.defenses.resistances.map(x =>
      typeof x === 'string' ? x : `${x.type} ${x.value}${x.notes ? ` (${x.notes})` : ''}`
    ).join(', ');
    embed.addFields({ name: '💠 Resistances', value: r.slice(0, 1024), inline: false });
  }

  // Saves
  const saveParts = [];
  if (fort !== undefined && fort !== null) saveParts.push(`**Fort** ${fort >= 0 ? '+' : ''}${fort}`);
  if (ref  !== undefined && ref  !== null) saveParts.push(`**Ref** ${ref >= 0 ? '+' : ''}${ref}`);
  if (will !== undefined && will !== null) saveParts.push(`**Will** ${will >= 0 ? '+' : ''}${will}`);
  if (saveParts.length) {
    embed.addFields({ name: '💪 Saves', value: saveParts.join(' • '), inline: true });
  }

  // Perception (+ senses inline)
  if (perception !== undefined && perception !== null) {
    const percStr = `${perception >= 0 ? '+' : ''}${perception}`;
    const sensesSuffix = sensesText ? ` (${sensesText})` : '';
    embed.addFields({ name: '👁️ Perception', value: `${percStr}${sensesSuffix}`, inline: true });
  }

  // Speed
  if (speedText) {
    embed.addFields({ name: '🏃 Speed', value: speedText, inline: false });
  }

  // Attacks — rendered as one field with one line per attack
  if (rich?.attacks?.length) {
    const attackLines = rich.attacks.map(formatAttackLine).filter(Boolean);
    if (attackLines.length) {
      const joined = attackLines.join('\n');
      embed.addFields({
        name: '⚔️ Attacks',
        value: joined.length > 1024 ? joined.slice(0, 1021) + '...' : joined,
        inline: false,
      });
    }
  }

  // Abilities — rendered as separate fields per slot so the PF2e stat block
  // reads naturally (top-of-block before HP, mid between defenses and offense,
  // bot as the attacks/special actions region).
  for (const [slot, label] of [['top', '✨ Special Abilities (Top)'], ['mid', '✨ Abilities'], ['bot', '✨ Offensive / Reactive']]) {
    const list = rich?.abilities?.[slot];
    if (!list?.length) continue;
    const lines = list.map(formatAbilityLine).filter(Boolean);
    if (!lines.length) continue;
    // Discord caps individual fields at 1024 chars — chunk if needed so big
    // creatures (dragons, liches) don't get truncated to one ability.
    let buf = '';
    let partIdx = 1;
    const emit = () => {
      if (!buf) return;
      const suffix = partIdx > 1 ? ` (${partIdx})` : '';
      embed.addFields({ name: `${label}${suffix}`, value: buf.trim(), inline: false });
      partIdx++;
      buf = '';
    };
    for (const line of lines) {
      if (buf.length + line.length + 2 > 1000) emit();
      buf += (buf ? '\n\n' : '') + line;
    }
    emit();
  }

  // Spellcasting — condensed summary; each caster block gets one field.
  if (Array.isArray(rich?.spellcasting) && rich.spellcasting.length) {
    for (const caster of rich.spellcasting) {
      const heading = [caster.type, caster.tradition].filter(Boolean).join(' ') || 'Spells';
      const dcBits = [];
      if (caster.DC !== null && caster.DC !== undefined) dcBits.push(`DC ${caster.DC}`);
      if (caster.attack_bonus !== null && caster.attack_bonus !== undefined) dcBits.push(`attack ${caster.attack_bonus >= 0 ? '+' : ''}${caster.attack_bonus}`);
      const header = dcBits.length ? `*${dcBits.join(', ')}*\n` : '';
      const lines = [];
      const slots = caster.spells_by_level ?? {};
      // Sort numerically; cantrips usually live at level 0
      const levels = Object.keys(slots).sort((a, b) => Number(b) - Number(a));
      for (const lvl of levels) {
        const spellNames = (slots[lvl]?.spells ?? []).map(s => {
          const n = s.name ?? String(s);
          const notes = s.notes?.length ? ` *(${s.notes.join(', ')})*` : '';
          return `${n}${notes}`;
        });
        if (!spellNames.length) continue;
        const label = lvl === '0' ? 'Cantrips' : `Rank ${lvl}`;
        lines.push(`**${label}:** ${spellNames.join(', ')}`);
      }
      const body = (header + lines.join('\n')).slice(0, 1024);
      if (body.trim()) {
        embed.addFields({ name: `🔮 ${heading.charAt(0).toUpperCase() + heading.slice(1)} Spells`, value: body, inline: false });
      }
    }
  }

  // Rich-only goodies: lore + GM tactics. These are what make Pathway
  // distinctly better than Avrae.
  if (rich?.lore_short) {
    embed.addFields({ name: '📖 Lore', value: String(rich.lore_short).slice(0, 1024), inline: false });
  }
  if (rich?.tactics && typeof rich.tactics === 'object') {
    const t = rich.tactics;
    const tacticsLines = [];
    if (t.role)      tacticsLines.push(`**Role:** ${t.role}`);
    if (t.opening)   tacticsLines.push(`**Opening:** ${t.opening}`);
    if (t.in_combat) tacticsLines.push(`**In Combat:** ${t.in_combat}`);
    if (t.when_hurt) tacticsLines.push(`**When Hurt:** ${t.when_hurt}`);
    const tacticsText = tacticsLines.join('\n');
    if (tacticsText) {
      embed.addFields({ name: '🎯 Tactics (GM)', value: tacticsText.slice(0, 1024), inline: false });
    }
  }

  if (family) {
    embed.addFields({ name: '👪 Family', value: family, inline: true });
  }

  // Source: rich has { source_book, pdf_page, _source_bestiary };
  // summary has { raw, book, page }.
  let sourceText = legacySummary.source?.raw
    ?? (legacySummary.source?.book ? `${legacySummary.source.book}${legacySummary.source.page ? ` pg. ${legacySummary.source.page}` : ''}` : null);
  if (!sourceText && rich) {
    sourceText = rich.source_book
      ? `${rich.source_book}${rich.pdf_page ? ` pg. ${rich.pdf_page}` : ''}`
      : (rich._source_bestiary ?? null);
  }
  // Footnote guild edits so GMs remember they're looking at a customized block
  const footerSuffix = monster._hasGuildEdits ? ' • customized for this server' : '';
  embed.setFooter({ text: `${sourceText ?? 'Unknown source'} • PF2e Bestiary Lookup${footerSuffix}` });

  // Monster art: set as the large image below the stat block so it doesn't
  // shrink the embed. GMs can set this per-guild with /monsterart set.
  if (artUrl) embed.setImage(artUrl);

  return embed;
}

// ── Currency helpers ──────────────────────────────────────────────────────────
const COPPER_VALUE = { cp: 1, sp: 10, gp: 100, pp: 1000 };

function walletToCopper(wallet) {
  return (wallet.cp ?? 0) + (wallet.sp ?? 0) * 10 + (wallet.gp ?? 0) * 100 + (wallet.pp ?? 0) * 1000;
}
function copperToWallet(total) {
  const pp = Math.floor(total / 1000); total %= 1000;
  const gp = Math.floor(total / 100);  total %= 100;
  const sp = Math.floor(total / 10);   total %= 10;
  return { pp, gp, sp, cp: total };
}
function formatWallet(wallet) {
  const parts = [];
  if (wallet.pp) parts.push(`${wallet.pp} pp`);
  if (wallet.gp) parts.push(`${wallet.gp} gp`);
  if (wallet.sp) parts.push(`${wallet.sp} sp`);
  if (wallet.cp || parts.length === 0) parts.push(`${wallet.cp ?? 0} cp`);
  return parts.join(', ');
}
function buildWalletEmbed(char, charEntry) {
  const wallet = charEntry.wallet ?? { pp: 0, gp: 0, sp: 0, cp: 0 };
  const totalGP = (walletToCopper(wallet) / 100).toFixed(2);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`💰 ${char.name}'s Wallet`)
    .addFields(
      { name: '🟣 Platinum (pp)', value: `${wallet.pp ?? 0}`, inline: true },
      { name: '🟡 Gold (gp)',     value: `${wallet.gp ?? 0}`, inline: true },
      { name: '⚪ Silver (sp)',   value: `${wallet.sp ?? 0}`, inline: true },
      { name: '🟤 Copper (cp)',   value: `${wallet.cp ?? 0}`, inline: true },
      { name: '💵 Total Value',   value: `${totalGP} gp`,     inline: true },
    )
    .setFooter({ text: 'Use /gold add, /gold spend, or /gold convert' });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

// ── Hero Points helpers ───────────────────────────────────────────────────────
// PF2e rules: characters start with 1 HP per session, max 3 at any time.
// Spend 1 to reroll a check (keep higher). Spend all to avoid death.
const HERO_POINTS_MAX = 3;
const HERO_POINTS_DEFAULT = 1;

function getHeroPoints(charEntry) {
  return charEntry.heroPoints ?? HERO_POINTS_DEFAULT;
}

// Visual representation: filled diamonds for held, hollow for empty (up to display cap).
// If someone has >3 (via /hero set override), we just append "+N" at the end so the embed stays clean.
function renderHeroPointsBar(points) {
  const displayCap = HERO_POINTS_MAX;
  const filled = Math.min(points, displayCap);
  const empty = Math.max(0, displayCap - points);
  const overflow = points > displayCap ? ` **+${points - displayCap}**` : '';
  return '◆'.repeat(filled) + '◇'.repeat(empty) + overflow;
}

function buildHeroPointsEmbed(char, charEntry, note = null) {
  const points = getHeroPoints(charEntry);
  const bar = renderHeroPointsBar(points);
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`⭐ ${char.name}'s Hero Points`)
    .setDescription(`${bar}\n**${points}** / ${HERO_POINTS_MAX}${points > HERO_POINTS_MAX ? ` *(over cap)*` : ''}`)
    .setFooter({ text: 'Spend 1 to reroll (keep higher) · Spend all to avoid death · Max 3' });
  if (note) embed.addFields({ name: '\u200b', value: note, inline: false });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

// ── XP helpers ────────────────────────────────────────────────────────────────
// PF2e: 1000 XP = 1 level. Bot-managed XP is stored on charEntry.xp (overlay-style),
// falling back to Pathbuilder's c.xp if the bot has never touched it. Awards are
// recorded in charEntry.xpLog as a list of { amount, reason, at, awardedBy }.
const XP_PER_LEVEL = 1000;

function getCharacterXp(charEntry) {
  // charEntry.xp is the bot-managed value; it wins over the Pathbuilder value.
  // If no bot value is set, fall back to the Pathbuilder-exported value.
  if (typeof charEntry.xp === 'number') return charEntry.xp;
  return charEntry.data?.xp ?? 0;
}

function setCharacterXp(charEntry, newValue) {
  charEntry.xp = Math.max(0, Math.floor(newValue));
  return charEntry.xp;
}

// Award XP. Returns { newXp, leveledUp, oldXp }. leveledUp is true if the award
// pushed the total past a 1000 XP boundary (the PC should level up in Pathbuilder).
function awardXp(charEntry, amount, reason, awarderId) {
  const oldXp = getCharacterXp(charEntry);
  const newXp = Math.max(0, Math.floor(oldXp + amount));
  charEntry.xp = newXp;
  // Track the award in a simple log so /xp view can show recent awards.
  // Cap the log at 20 entries to keep the JSON file from ballooning over a campaign.
  if (!Array.isArray(charEntry.xpLog)) charEntry.xpLog = [];
  charEntry.xpLog.push({
    amount: Math.floor(amount),
    reason: reason ?? null,
    at: new Date().toISOString(),
    awardedBy: awarderId ?? null,
  });
  while (charEntry.xpLog.length > 20) charEntry.xpLog.shift();
  // Leveled up if we crossed a 1000 XP threshold this award
  const oldLevels = Math.floor(oldXp / XP_PER_LEVEL);
  const newLevels = Math.floor(newXp / XP_PER_LEVEL);
  const leveledUp = newLevels > oldLevels;
  return { oldXp, newXp, leveledUp };
}

// Visual progress bar for XP: filled blocks for earned XP in the current level,
// empty blocks for remaining. Always 10 segments so 100 XP = 1 block.
function renderXpBar(xp, segments = 10) {
  const progressInLevel = xp % XP_PER_LEVEL;
  const filled = Math.min(segments, Math.round((progressInLevel / XP_PER_LEVEL) * segments));
  return '█'.repeat(filled) + '░'.repeat(segments - filled);
}

function buildXpEmbed(char, charEntry, { note, showLog } = {}) {
  const xp = getCharacterXp(charEntry);
  const currentSheetLevel = charEntry.data?.level ?? 1;
  // Level "earned" by XP = currentSheetLevel + number of 1000-XP thresholds crossed since last /char update
  const levelsEarnedSinceUpdate = Math.floor(xp / XP_PER_LEVEL);
  const effectiveLevel = currentSheetLevel + levelsEarnedSinceUpdate;
  const progress = xp % XP_PER_LEVEL;
  const bar = renderXpBar(xp);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`⭐ ${char.name}'s Experience`)
    .setDescription(
      `\`${bar}\` **${progress} / ${XP_PER_LEVEL}** XP this level\n` +
      `**Sheet Level:** ${currentSheetLevel}` +
      (levelsEarnedSinceUpdate > 0
        ? `\n**Ready to level up:** ${levelsEarnedSinceUpdate} time${levelsEarnedSinceUpdate === 1 ? '' : 's'} — level up in Pathbuilder, then \`/char update\``
        : ''
      ),
    );

  if (note) embed.addFields({ name: '\u200b', value: note, inline: false });

  if (showLog && Array.isArray(charEntry.xpLog) && charEntry.xpLog.length > 0) {
    const entries = charEntry.xpLog.slice(-5).reverse();
    const lines = entries.map(e => {
      const sign = e.amount >= 0 ? '+' : '';
      const date = e.at ? new Date(e.at).toLocaleDateString() : '';
      const reason = e.reason ? ` — ${e.reason}` : '';
      return `\`${sign}${e.amount} XP\` *(${date})*${reason}`;
    });
    embed.addFields({ name: '📜 Recent Awards', value: lines.join('\n').slice(0, 1024), inline: false });
  }

  embed.setFooter({ text: '/xp award to give XP · /xp view character:<name> · 1000 XP = level up' });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

function buildLevelUpEmbed(char, charEntry, oldXp, newXp) {
  const newLevel = (charEntry.data?.level ?? 1) + Math.floor(newXp / XP_PER_LEVEL);
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(`🎉 ${char.name} leveled up!`)
    .setDescription(
      `**${char.name}** crossed ${XP_PER_LEVEL} XP — they're ready to become **Level ${newLevel}**!\n\n` +
      `Level up in Pathbuilder, then run \`/char update\` to sync the new sheet. ` +
      `Use \`/xp set character:${char.name} amount:0\` once the update is imported to reset progress toward the next level.`,
    )
    .addFields({
      name: 'XP',
      value: `${oldXp} → **${newXp}**`,
      inline: true,
    });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

// ── Session Notes (per-character notebooks) ──────────────────────────────────
// Storage: notes.json keyed by "<ownerId>:<charKey>" → { nextId, notes: [] }.
// Each note: { id, category, text, pinned, createdAt, editedAt, authorId, authorName }.
// Only the character's owner can add, edit, remove, pin. Anyone can view/search.

const NOTE_CATEGORIES = {
  npcs:         { label: 'NPCs',         icon: '🧑', color: 0x3498db },
  locations:    { label: 'Locations',    icon: '🗺️', color: 0x2ecc71 },
  'plot-threads': { label: 'Plot Threads', icon: '🎭', color: 0x9b59b6 },
  influence:    { label: 'Influence',    icon: '🤝', color: 0xf39c12 },
  items:        { label: 'Items',        icon: '💎', color: 0xe91e63 },
};
const NOTE_CATEGORY_ORDER = ['npcs', 'locations', 'plot-threads', 'influence', 'items'];

function loadNotes() {
  try { return JSON.parse(fs.readFileSync(dataPath('notes.json'), 'utf8')); }
  catch { return { _meta: { version: 1 } }; }
}

function saveNotes(notes) {
  try {
    fs.writeFileSync(dataPath('notes.json'), JSON.stringify(notes, null, 2));
    return true;
  } catch (err) {
    console.error('Failed to save notes.json:', err);
    return false;
  }
}

// Compose the storage key for a character's notebook
function noteKey(ownerId, charKey) {
  return `${ownerId}:${charKey}`;
}

// Get (or initialize) the notebook for a character
function getNotebook(notesData, ownerId, charKey) {
  const key = noteKey(ownerId, charKey);
  if (!notesData[key]) notesData[key] = { nextId: 1, notes: [] };
  return notesData[key];
}

// Add a note. Returns the new note object.
function addNote(notesData, ownerId, charKey, { category, text, pinned, authorId, authorName }) {
  const book = getNotebook(notesData, ownerId, charKey);
  const note = {
    id: book.nextId++,
    category,
    text,
    pinned: !!pinned,
    createdAt: new Date().toISOString(),
    editedAt: null,
    authorId,
    authorName,
  };
  book.notes.push(note);
  return note;
}

// Sort order: pinned first (within each category), then newest first.
function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1; // pinned true first
    // Newer createdAt later in the list? Actually: newer first (desc).
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

// Truncate text for list previews (preserves word boundaries when possible)
function truncateNote(text, max = 120) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > max * 0.7 ? slice.slice(0, lastSpace) : slice) + '…';
}

// Format a single note line for a list display
function formatNoteLine(note) {
  const pinTag = note.pinned ? '📌 ' : '';
  const preview = truncateNote(note.text, 100);
  return `\`#${note.id}\` ${pinTag}${preview}`;
}

// Build the notebook listing embed. If categoryFilter is set, only show that
// category. If pinnedOnly, only show pinned notes.
function buildNotebookEmbed(char, notes, { categoryFilter, pinnedOnly } = {}) {
  const categoriesToShow = categoryFilter
    ? [categoryFilter]
    : NOTE_CATEGORY_ORDER;

  const filtered = pinnedOnly ? notes.filter(n => n.pinned) : notes;

  const embed = new EmbedBuilder()
    .setColor(0x7b5ea7)
    .setTitle(`📓 ${char.name}'s Notebook`);

  let descParts = [];
  if (categoryFilter) {
    const cat = NOTE_CATEGORIES[categoryFilter];
    descParts.push(`Filtered by **${cat.icon} ${cat.label}**`);
  }
  if (pinnedOnly) descParts.push('Pinned notes only');
  if (descParts.length) embed.setDescription(descParts.join(' · '));

  let totalShown = 0;
  for (const catKey of categoriesToShow) {
    const cat = NOTE_CATEGORIES[catKey];
    const inCat = sortNotes(filtered.filter(n => n.category === catKey));
    if (inCat.length === 0) continue;
    const lines = inCat.map(formatNoteLine).join('\n');
    // Discord field max is 1024 chars — if we'd exceed, truncate with a note
    const value = lines.length > 1020
      ? lines.slice(0, 1020) + '\n*…more. Use `/notes search` or `/notes list` with a filter.*'
      : lines;
    embed.addFields({
      name: `${cat.icon} ${cat.label} (${inCat.length})`,
      value,
      inline: false,
    });
    totalShown += inCat.length;
  }

  if (totalShown === 0) {
    embed.setDescription(
      (descParts.length ? descParts.join(' · ') + '\n\n' : '') +
      '*No notes yet. Add one with `/notes add`.*'
    );
  }

  embed.setFooter({ text: `/notes view id:<n> for full detail · /notes add to contribute` });
  if (char.art || notes.charArt) embed.setThumbnail(char.art || notes.charArt);
  return embed;
}

// Build a single-note detail embed (for /notes view)
function buildNoteDetailEmbed(char, note) {
  const cat = NOTE_CATEGORIES[note.category];
  const embed = new EmbedBuilder()
    .setColor(cat?.color ?? 0x95a5a6)
    .setTitle(`${cat?.icon ?? '📝'} Note #${note.id} · ${cat?.label ?? 'Uncategorized'}`)
    .setDescription(note.text.slice(0, 4000));

  const meta = [];
  if (note.pinned) meta.push('📌 Pinned');
  meta.push(`By **${note.authorName}**`);
  meta.push(`Added ${new Date(note.createdAt).toLocaleDateString()}`);
  if (note.editedAt) meta.push(`*edited ${new Date(note.editedAt).toLocaleDateString()}*`);
  embed.setFooter({ text: meta.join(' · ') });
  embed.setAuthor({ name: `${char.name}'s notebook` });
  return embed;
}

// Roll an expression using the exact same engine as /roll.
// Returns { total, breakdown, error } — breakdown is the pretty display string.
// On parse error, returns { error: "..." }; callers should surface that to the user.
function rollDiceExpression(raw) {
  const expr = String(raw ?? '').toLowerCase().replace(/\s+/g, '');
  if (!/^[0-9d+\-*/]+$/.test(expr)) return { error: 'Invalid expression. Use dice like `2d6`, math like `10+5`, or mix them like `1d8+4`.' };

  const tokens = expr.split(/([+\-*/])/).filter(Boolean);
  const breakdownParts = [];
  const values = [];
  for (const token of tokens) {
    if (['+', '-', '*', '/'].includes(token)) {
      breakdownParts.push(token === '*' ? '×' : token === '/' ? '÷' : token);
      values.push(token);
      continue;
    }
    if (token.includes('d')) {
      const [numDiceStr, numSidesStr] = token.split('d');
      const numDice = parseInt(numDiceStr) || 1;
      const numSides = parseInt(numSidesStr);
      if (!numSides || numSides < 1 || numDice < 1 || numDice > 100) return { error: `Invalid dice: \`${token}\`.` };
      const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * numSides) + 1);
      const rollTotal = rolls.reduce((a, b) => a + b, 0);
      breakdownParts.push(numDice > 1 ? `${numDice}d${numSides}[${rolls.join(', ')}]` : `${numDice}d${numSides}(${rolls[0]})`);
      values.push(rollTotal);
    } else {
      const num = parseInt(token);
      if (isNaN(num)) return { error: `Couldn't parse \`${token}\`.` };
      breakdownParts.push(`${num}`);
      values.push(num);
    }
  }
  // Two-pass: handle * and / first, then + and -
  const pass1values = [];
  const pass1ops = [];
  let current = values[0];
  for (let i = 1; i < values.length; i += 2) {
    const op = values[i];
    const next = values[i + 1];
    if (op === '*') current = current * next;
    else if (op === '/') {
      if (next === 0) return { error: 'Cannot divide by zero.' };
      current = Math.floor(current / next);
    } else {
      pass1values.push(current);
      pass1ops.push(op);
      current = next;
    }
  }
  pass1values.push(current);
  let total = pass1values[0];
  for (let i = 0; i < pass1ops.length; i++) {
    if (pass1ops[i] === '+') total += pass1values[i + 1];
    if (pass1ops[i] === '-') total -= pass1values[i + 1];
  }
  total = Math.floor(total);
  return { total, breakdown: breakdownParts.join(' ') };
}

// ── Advanced roll engine ──────────────────────────────────────────────────────
// Supports modifiers beyond basic dice arithmetic:
//   adv / dis        — roll everything twice, take higher / lower of each die
//   crit             — double the number of dice (5e-style; bonuses unchanged)
//   rr1              — reroll any die that shows a 1, once, keep new value
//   rr<N             — reroll any die <= N, once, keep new value
//   kh<N> / kl<N>    — keep highest / lowest N dice of a given roll group
//   N#expr           — iteration prefix: roll the expression N times
//   [label]          — after any dice term, annotates the result (e.g. +2d6[sneak])
//   {snippet}        — user snippet reference, expanded before parsing
//
// Returns { error } on failure, or { iterations: [{ total, breakdown }, ...],
// grandTotal, summary, expanded } on success. `expanded` is the raw text
// after snippet expansion, useful for showing in the embed.

function rollAdvanced(raw, userSnippets = {}) {
  if (!raw || typeof raw !== 'string') return { error: 'Empty roll expression.' };

  // ── 1. Expand snippets with optional arguments ──────────────────────────
  // Snippets are resolved in source order. A snippet name followed by bare
  // numbers (or simple dice like 3d6) can "consume" those as positional
  // args if the snippet's expansion contains %1, %2, ... placeholders.
  //
  // Example: snippet `sneak` = "+%1:2d6[sneak]"
  //   /roll 1d20 sneak      → /roll 1d20 +2d6[sneak]     (default %1=2)
  //   /roll 1d20 sneak 4    → /roll 1d20 +4d6[sneak]
  //
  // Modifiers (adv, crit, rr1...) and other snippet names break the arg run.
  //
  // Snippets are case-insensitive. We lower-case names for the lookup table.
  const snippetTable = {};
  for (const [name, expansion] of Object.entries(userSnippets)) {
    snippetTable[name.toLowerCase()] = expansion;
  }
  const snippetNames = Object.keys(snippetTable);

  // Reserved tokens that should not be treated as args or snippets.
  const RESERVED_TOKENS = new Set([
    'adv', 'advantage', 'dis', 'disadvantage', 'disadv',
    'crit', 'critical',
  ]);
  function isReservedToken(tok) {
    const low = tok.toLowerCase();
    if (RESERVED_TOKENS.has(low)) return true;
    if (/^rr\d+$/.test(low) || /^rr<\d+$/.test(low)) return true;
    if (/^kh\d+$/.test(low) || /^kl\d+$/.test(low)) return true;
    return false;
  }
  // A valid argument value is a bare number or simple NdM. Anything else
  // (operators, modifiers, other snippet names, dice expressions with
  // arithmetic) ends the arg run.
  function isSnippetArg(tok) {
    if (!tok) return false;
    if (isReservedToken(tok)) return false;
    if (snippetTable[tok.toLowerCase()]) return false;
    if (/^\d+$/.test(tok)) return true;
    if (/^\d*d\d+$/i.test(tok)) return true;
    return false;
  }
  // Apply arguments to an expansion. Replaces %N and %N:default with args[N-1]
  // (or the default if arg not provided). Returns { expansion, consumed,
  // warnings } where `consumed` is the number of args actually used.
  function applyArgs(expansion, args) {
    const placeholders = [...expansion.matchAll(/%(\d+)(?::([0-9.]+))?/g)];
    // No placeholders: snippet doesn't take args. Consume nothing.
    if (placeholders.length === 0) return { expansion, consumed: 0, warnings: [] };
    const maxArg = Math.max(...placeholders.map(m => parseInt(m[1])));
    const warnings = [];
    const missing = [];
    // Only use args up to maxArg. Extras are left for the caller to decide
    // (our caller consumes exactly maxArg, so extras fall through as
    // normal tokens — which means they'll error out if they're not valid
    // dice expression tokens).
    const usedArgs = args.slice(0, maxArg);
    const replaced = expansion.replace(/%(\d+)(?::([0-9.]+))?/g, (_, numStr, def) => {
      const idx = parseInt(numStr) - 1;
      if (usedArgs[idx] !== undefined) return usedArgs[idx];
      if (def !== undefined) return def;
      missing.push(numStr);
      return '0';
    });
    if (missing.length) {
      warnings.push(`Missing argument(s) ${missing.map(n => '%' + n).join(', ')} — used 0. Provide defaults with \`%N:default\` syntax.`);
    }
    return { expansion: replaced, consumed: usedArgs.length, warnings };
  }

  // Pre-compute placeholder counts for each snippet so the walker knows
  // how many args to grab.
  const snippetMaxArgs = {};
  for (const [name, expansion] of Object.entries(snippetTable)) {
    const phs = [...expansion.matchAll(/%(\d+)(?::([0-9.]+))?/g)];
    snippetMaxArgs[name] = phs.length ? Math.max(...phs.map(m => parseInt(m[1]))) : 0;
  }

  const expansionWarnings = [];
  let expanded;
  {
    const allTokens = raw.trim().split(/\s+/).filter(Boolean);
    const outTokens = [];
    let i = 0;
    while (i < allTokens.length) {
      const tok = allTokens[i];
      const low = tok.toLowerCase();
      if (snippetTable[low]) {
        // Found a snippet name. Peek ahead for args, but only as many as
        // the snippet's placeholder count.
        const maxArgs = snippetMaxArgs[low];
        const collected = [];
        let j = i + 1;
        while (j < allTokens.length && collected.length < maxArgs && isSnippetArg(allTokens[j])) {
          collected.push(allTokens[j]);
          j++;
        }
        const { expansion, consumed, warnings } = applyArgs(snippetTable[low], collected);
        expansionWarnings.push(...warnings);
        outTokens.push(expansion);
        i += 1 + consumed;
      } else {
        outTokens.push(tok);
        i++;
      }
    }
    expanded = outTokens.join(' ');
  }

  // ── 2. Extract iteration prefix (N#...) ────────────────────────────────
  let iterations = 1;
  const iterMatch = expanded.match(/^\s*(\d+)\s*#\s*(.+)$/);
  if (iterMatch) {
    iterations = parseInt(iterMatch[1]);
    if (iterations < 1 || iterations > 25) {
      return { error: 'Iteration count must be between 1 and 25.' };
    }
    expanded = iterMatch[2];
  }

  // ── 3. Extract modifier keywords ──────────────────────────────────────
  // These are space-separated tokens at any position. We strip them out
  // and leave only the dice expression for evaluation.
  const mods = { adv: false, dis: false, crit: false, rrThreshold: 0, keep: null };
  const tokens = expanded.split(/\s+/).filter(Boolean);
  const exprTokens = [];
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (low === 'adv' || low === 'advantage') { mods.adv = true; continue; }
    if (low === 'dis' || low === 'disadvantage' || low === 'disadv') { mods.dis = true; continue; }
    if (low === 'crit' || low === 'critical') { mods.crit = true; continue; }
    const rrMatch = low.match(/^rr(\d+)$/) || low.match(/^rr<(\d+)$/);
    if (rrMatch) { mods.rrThreshold = Math.max(mods.rrThreshold, parseInt(rrMatch[1])); continue; }
    const khMatch = low.match(/^kh(\d+)$/);
    if (khMatch) { mods.keep = { mode: 'high', n: parseInt(khMatch[1]) }; continue; }
    const klMatch = low.match(/^kl(\d+)$/);
    if (klMatch) { mods.keep = { mode: 'low', n: parseInt(klMatch[1]) }; continue; }
    exprTokens.push(tok);
  }
  if (mods.adv && mods.dis) return { error: 'Cannot apply both `adv` and `dis` to the same roll.' };

  // Join tokens, but insert an implicit `+` between any two adjacent tokens
  // where the second doesn't start with an operator. This handles cases like
  // `1d20 +2d6 3` (snippet expansion followed by a bare number) — we want
  // `1d20+2d6+3`, not `1d20+2d63`.
  let expr = '';
  for (let k = 0; k < exprTokens.length; k++) {
    const tok = exprTokens[k];
    if (k > 0 && !/^[+\-*/)]/.test(tok) && !/[+\-*/(]$/.test(exprTokens[k - 1])) {
      expr += '+';
    }
    expr += tok;
  }
  if (!expr) return { error: 'No dice expression found. Example: `1d20+5 adv`' };

  // Collapse double operators that can happen when a snippet expansion
  // starts with a sign (e.g. `str` -> `+3`, and input is `1d20+str` -> `1d20++3`)
  expr = expr
    .replace(/\+\s*\+/g, '+')
    .replace(/-\s*\+/g, '-')
    .replace(/\+\s*-/g, '-')
    .replace(/-\s*-/g, '+');

  // ── 4. Extract labels like [name] from dice terms ──────────────────────
  // Walk the expression; every time we see a NdM[label] pattern, stash the
  // label in a map keyed by a unique sentinel we embed in its place.
  const labelMap = {}; // sentinel -> label text
  let sentinelCounter = 0;
  expr = expr.replace(/\[([^\]]+)\]/g, (_, lbl) => {
    const sentinel = `LBL${sentinelCounter++}`;
    labelMap[sentinel] = lbl;
    return `_${sentinel}_`;
  });

  // ── 5. Validate characters ─────────────────────────────────────────────
  // Allow k/h/l/b for kh/kl dice suffixes and "lbl" label sentinels,
  // plus underscores for the sentinels themselves.
  const cleaned = expr.toLowerCase().replace(/\s+/g, '');
  if (!/^[0-9dkhlb_+\-*/().]+$/.test(cleaned)) {
    return { error: `Invalid characters in expression: \`${expr}\`` };
  }

  // ── 6. Apply crit modifier: double every NdM dice count ────────────────
  let workExpr = cleaned;
  if (mods.crit) {
    // Only double the leading dice-count number, not things inside sentinels
    workExpr = workExpr.replace(/(\d+)d(\d+)/g, (_, n, m) => `${parseInt(n) * 2}d${m}`);
  }

  // ── 7. Roll evaluator ──────────────────────────────────────────────────
  function rollOneDie(sides) {
    return Math.floor(Math.random() * sides) + 1;
  }

  function rollDiceGroup(numDice, numSides, localMods) {
    let rolls;
    if (localMods.adv || localMods.dis) {
      rolls = [];
      const rollsShown = [];
      for (let i = 0; i < numDice; i++) {
        const a = rollOneDie(numSides);
        const b = rollOneDie(numSides);
        const picked = localMods.adv ? Math.max(a, b) : Math.min(a, b);
        rolls.push(picked);
        rollsShown.push({ a, b, picked });
      }
      if (localMods.rrThreshold > 0) {
        for (let i = 0; i < rolls.length; i++) {
          if (rolls[i] <= localMods.rrThreshold) {
            const newVal = rollOneDie(numSides);
            rollsShown[i].rerolled = { from: rolls[i], to: newVal };
            rolls[i] = newVal;
          }
        }
      }
      return { rolls, rollsShown, advDisplay: true };
    }
    rolls = Array.from({ length: numDice }, () => rollOneDie(numSides));
    const rerollInfo = [];
    if (localMods.rrThreshold > 0) {
      for (let i = 0; i < rolls.length; i++) {
        if (rolls[i] <= localMods.rrThreshold) {
          const newVal = rollOneDie(numSides);
          rerollInfo.push({ idx: i, from: rolls[i], to: newVal });
          rolls[i] = newVal;
        }
      }
    }
    return { rolls, rerollInfo };
  }

  function evalOnce() {
    // Split on operators; labels-as-sentinels stay attached to their dice term
    const tokens = workExpr.split(/([+\-*/()])/).filter(t => t && t.trim());
    const breakdownParts = [];
    const values = [];
    for (const token of tokens) {
      if ('+-*/()'.includes(token)) {
        const disp = token === '*' ? '×' : token === '/' ? '÷' : token;
        breakdownParts.push(disp);
        values.push(token);
        continue;
      }
      // Pull a trailing label sentinel off this token, if any
      let cleanTok = token;
      let labelText = null;
      const sentMatch = cleanTok.match(/_lbl(\d+)_$/i);
      if (sentMatch) {
        labelText = labelMap[`LBL${sentMatch[1]}`] ?? null;
        cleanTok = cleanTok.replace(/_lbl\d+_$/i, '');
      }

      if (cleanTok.includes('d')) {
        const diceMatch = cleanTok.match(/^(\d*)d(\d+)(kh\d+|kl\d+)?$/);
        if (!diceMatch) return { error: `Could not parse dice \`${cleanTok}\`.` };
        const numDice = parseInt(diceMatch[1]) || 1;
        const numSides = parseInt(diceMatch[2]);
        const localKeep = diceMatch[3] ? parseKeep(diceMatch[3]) : null;
        if (numSides < 2 || numDice < 1 || numDice > 100) {
          return { error: `Invalid dice \`${cleanTok}\`.` };
        }
        const { rolls, rollsShown, rerollInfo, advDisplay } = rollDiceGroup(numDice, numSides, mods);
        let keptIndices = null;
        if (localKeep) keptIndices = pickKeep(rolls, localKeep);
        const finalRolls = keptIndices ? keptIndices.map(i => rolls[i]) : rolls;
        const rollTotal = finalRolls.reduce((a, b) => a + b, 0);

        let diceDisplay;
        if (advDisplay) {
          const parts = rollsShown.map(r => {
            const pStr = `**${r.picked}**`;
            const oStr = r.picked === r.a ? `~~${r.b}~~` : `~~${r.a}~~`;
            const ordered = r.a === r.picked ? `${pStr},${oStr}` : `${oStr},${pStr}`;
            let s = `(${ordered})`;
            if (r.rerolled) s += `→↻${r.rerolled.to}`;
            return s;
          }).join(',');
          diceDisplay = `${numDice}d${numSides}${mods.adv ? '↑' : '↓'}[${parts}]`;
        } else {
          if (keptIndices) {
            const display = rolls.map((v, i) => keptIndices.includes(i) ? `**${v}**` : `~~${v}~~`);
            diceDisplay = `${numDice}d${numSides}${diceMatch[3] || ''}[${display.join(', ')}]`;
          } else {
            const parts = rolls.map((v, i) => {
              const rer = (rerollInfo || []).find(r => r.idx === i);
              return rer ? `~~${rer.from}~~→${v}` : `${v}`;
            });
            diceDisplay = numDice > 1
              ? `${numDice}d${numSides}[${parts.join(', ')}]`
              : `${numDice}d${numSides}(${parts[0]})`;
          }
        }
        if (labelText) diceDisplay += ` *[${labelText}]*`;
        breakdownParts.push(diceDisplay);
        values.push(rollTotal);
      } else {
        const num = parseInt(cleanTok);
        if (isNaN(num)) return { error: `Couldn't parse \`${cleanTok}\`.` };
        breakdownParts.push(`${num}`);
        values.push(num);
      }
    }

    // Math evaluator (same as rollDiceExpression: × ÷ first, then + -)
    const flat = values.filter(v => v !== '(' && v !== ')');
    if (flat.length === 0) return { error: 'Empty evaluation.' };
    const pass1values = [];
    const pass1ops = [];
    let current = flat[0];
    for (let i = 1; i < flat.length; i += 2) {
      const op = flat[i];
      const next = flat[i + 1];
      if (op === '*') current = current * next;
      else if (op === '/') {
        if (next === 0) return { error: 'Cannot divide by zero.' };
        current = Math.floor(current / next);
      } else {
        pass1values.push(current);
        pass1ops.push(op);
        current = next;
      }
    }
    pass1values.push(current);
    let total = pass1values[0];
    for (let i = 0; i < pass1ops.length; i++) {
      if (pass1ops[i] === '+') total += pass1values[i + 1];
      if (pass1ops[i] === '-') total -= pass1values[i + 1];
    }
    return { total: Math.floor(total), breakdown: breakdownParts.join(' ') };
  }

  function parseKeep(suffix) {
    const m = suffix.match(/^(kh|kl)(\d+)$/);
    if (!m) return null;
    return { mode: m[1] === 'kh' ? 'high' : 'low', n: parseInt(m[2]) };
  }
  function pickKeep(rolls, keep) {
    const indexed = rolls.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => keep.mode === 'high' ? b.v - a.v : a.v - b.v);
    return indexed.slice(0, keep.n).map(x => x.i).sort((a, b) => a - b);
  }

  // ── 8. Run iterations ─────────────────────────────────────────────────
  const results = [];
  let grandTotal = 0;
  for (let i = 0; i < iterations; i++) {
    const r = evalOnce();
    if (r.error) return { error: r.error };
    results.push(r);
    grandTotal += r.total;
  }

  // Build a summary line — useful for iteration rolls
  let summary = null;
  if (iterations > 1) {
    const totals = results.map(r => r.total);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const avg = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length * 10) / 10;
    summary = `Sum: **${grandTotal}** · Min: ${min} · Max: ${max} · Avg: ${avg}`;
  }

  return { iterations: results, grandTotal, summary, expanded, mods, warnings: expansionWarnings };
}

// ── Normalize spell ───────────────────────────────────────────────────────────
function normalizeSpell(spell) {
  let level = spell.level;
  if (typeof level === 'string') level = parseInt(level) || 1;
  let traditions = spell.traditions ?? '';
  if (typeof traditions === 'string') traditions = traditions.split(',').map(t => t.trim()).filter(Boolean);
  if (!Array.isArray(traditions)) traditions = [];
  let traits = spell.traits ?? '';
  if (typeof traits === 'string') traits = traits.split(',').map(t => t.trim()).filter(Boolean);
  if (!Array.isArray(traits)) traits = [];
  let type = spell.type ?? 'Spell';
  if (traits.map(t => t.toLowerCase()).includes('cantrip')) type = 'Cantrip';
  if (level === 0) type = 'Cantrip';
  let savingThrow = null;
  if (spell.defense && spell.defense.trim()) savingThrow = spell.defense.replace(/^basic\s+/i, '').trim();
  const target = spell.target ?? spell.targets ?? null;
  let damage = spell.damage;
  if (damage && typeof damage === 'object') {
    const parts = [damage.base, damage.type].filter(Boolean).join(' ');
    damage = (parts + (damage.extra ? ` + ${damage.extra}` : '')).trim() || null;
  }
  if (!damage || (typeof damage === 'string' && !damage.trim())) damage = null;
  let description = spell.description?.trim() || spell.summary?.trim() || '*No description available.*';
  return { ...spell, level, traditions, traits, type, savingThrow, target, damage, description };
}

function buildSpellEmbed(rawSpell) {
  const spell = normalizeSpell(rawSpell);
  const isCantrip = spell.type === 'Cantrip';
  const levelDisplay = isCantrip ? `Cantrip ${spell.level}` : `Spell ${spell.level}`;
  const traditionsDisplay = spell.traditions.length > 0 ? spell.traditions.join(', ') : 'None';
  const traitsDisplay = spell.traits.length > 0 ? spell.traits.join(', ') : null;
  let description = spell.description && spell.description.trim() ? spell.description : '*No description available.*';
  if (description.length > 1500) description = description.slice(0, 1500) + '...\n*(description truncated)*';
  const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(spell.name).setDescription(description);
  const levelLine = [`**${levelDisplay}**`, spell.school ?? null].filter(Boolean).join(' · ');
  embed.addFields({ name: '\u200b', value: levelLine, inline: false });
  if (spell.source) embed.addFields({ name: 'Source', value: spell.source, inline: false });
  embed.addFields({ name: 'Traditions', value: traditionsDisplay, inline: false });
  if (traitsDisplay) embed.addFields({ name: 'Traits', value: traitsDisplay, inline: false });
  const metaLines = [
    spell.cast     ? `**Cast** ${spell.cast}`         : null,
    spell.range    ? `**Range** ${spell.range}`       : null,
    spell.area     ? `**Area** ${spell.area}`         : null,
    spell.target   ? `**Target** ${spell.target}`     : null,
    spell.duration ? `**Duration** ${spell.duration}` : null,
  ].filter(Boolean);
  if (metaLines.length > 0) embed.addFields({ name: 'Meta', value: metaLines.join('\n'), inline: false });
  if (spell.savingThrow) embed.addFields({ name: 'Saving Throw', value: spell.savingThrow, inline: false });
  if (spell.damage)      embed.addFields({ name: 'Damage', value: spell.damage, inline: false });
  if (spell.heightening && typeof spell.heightening === 'object') {
    let htText = '';
    if (spell.heightening.type === 'per_rank' && spell.heightening.damage_bonus)
      htText = `Each rank above ${spell.level}: +${spell.heightening.damage_bonus} damage`;
    else if (spell.heightening.type === 'fixed' && spell.heightening.levels)
      htText = Object.entries(spell.heightening.levels).map(([k, v]) => `**${k}:** ${v}`).join('\n');
    else htText = JSON.stringify(spell.heightening);
    if (htText) embed.addFields({ name: '⬆️ Heightened', value: htText, inline: false });
  } else if (spell.heightened?.trim()) {
    embed.addFields({ name: '⬆️ Heightened', value: spell.heightened, inline: false });
  }
  embed.setFooter({ text: `Pathfinder 2e · ${spell.source ?? 'Unknown source'}` });
  return embed;
}

// ── Ancestry embed builders ───────────────────────────────────────────────────
const ANCESTRY_COLORS = { main: 0x4B8B6F, heritage: 0x7B5EA7, feats: 0xC4862A };

function buildAncestryCorePage(ancestry) {
  const boosts = ancestry.attribute_boosts.join(', ');
  const flaws  = ancestry.attribute_flaws.length ? ancestry.attribute_flaws.join(', ') : 'None';
  const sensesText   = ancestry.senses.map(s => `**${s.name}** — ${s.description}`).join('\n');
  const languageText = `${ancestry.languages.base.join(', ')}\n*Plus additional languages equal to ${ancestry.languages.bonus_count}, chosen from: ${ancestry.languages.bonus_pool.join(', ')}.*`;
  return new EmbedBuilder()
    .setTitle(ancestry.name)
    .setDescription(`*${ancestry.traits.join(', ')}*\n\n${ancestry.description}`)
    .setColor(ANCESTRY_COLORS.main)
    .setFooter({ text: `Source: ${ancestry.source} • Page 1/3` })
    .addFields(
      { name: '❤️ Hit Points',       value: `${ancestry.hp}`,       inline: true },
      { name: '🏃 Speed',            value: `${ancestry.speed} ft.`, inline: true },
      { name: '📏 Size',             value: ancestry.size,           inline: true },
      { name: '📈 Attribute Boosts', value: boosts,                  inline: true },
      { name: '📉 Attribute Flaw',   value: flaws,                   inline: true },
      { name: '\u200B',              value: '\u200B',                inline: true },
      { name: '👁️ Senses',          value: sensesText || 'None',    inline: false },
      { name: '🗣️ Languages',       value: languageText,            inline: false },
    );
}

function buildAncestryHeritagesPage(ancestry) {
  const embed = new EmbedBuilder()
    .setTitle(`${ancestry.name} — Heritages`)
    .setDescription('Choose one heritage at character creation.')
    .setColor(ANCESTRY_COLORS.heritage)
    .setFooter({ text: `Source: ${ancestry.source} • Page 2/3` });
  for (const h of ancestry.heritages)
    embed.addFields({ name: `◈ ${h.name}`, value: h.description, inline: false });
  return embed;
}

function buildAncestryFeatsPage(ancestry) {
  const embed = new EmbedBuilder()
    .setTitle(`${ancestry.name} — Ancestry Feats`)
    .setDescription('You gain ancestry feats at 1st level and every 4 levels thereafter.')
    .setColor(ANCESTRY_COLORS.feats)
    .setFooter({ text: `Source: ${ancestry.source} • Page 3/3` });
  for (const group of ancestry.ancestry_feats) {
    embed.addFields({ name: `── Level ${group.level} ──`, value: '\u200B', inline: false });
    for (const feat of group.feats) {
      const prereqLine = feat.prerequisites ? `*Prerequisite: ${feat.prerequisites.join(', ')}*\n` : '';
      embed.addFields({ name: `✦ ${feat.name}`, value: `${prereqLine}${feat.description}`, inline: false });
    }
  }
  return embed;
}

function buildAncestryButtons(currentPage, ancestryKey) {
  const id = ancestryKey.toLowerCase();
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ancestry_${id}_0`).setLabel('◀ Core').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`ancestry_${id}_1`).setLabel('Heritages').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 1),
    new ButtonBuilder().setCustomId(`ancestry_${id}_2`).setLabel('Feats ▶').setStyle(ButtonStyle.Success).setDisabled(currentPage === 2),
  );
}

// ── /help system ──────────────────────────────────────────────────────────────
// Commands are grouped into categories. Each entry has:
//   name        - command name shown in the embed
//   summary     - one-line what-it-does
//   options     - short list of key options (not always exhaustive)
//   example     - the most common usage
// Categories are rendered one at a time via button navigation.

const HELP_CATEGORIES = {
  character: {
    emoji: '🧙',
    label: 'Character',
    blurb: 'Manage your saved characters, sheets, rolls, and daily resources.',
    commands: [
      { name: '/char import', summary: 'Import a character by Pathbuilder ID (easier than uploading a file). Get the ID from Pathbuilder → Menu → Export JSON.', options: 'id', example: '/char import id:123456' },
      { name: '/char sync', summary: 'Update an existing character by Pathbuilder ID. Keeps hero points, XP, HP, notes.', options: 'id', example: '/char sync id:123456' },
      { name: '/char add', summary: 'Add a character by uploading a Pathbuilder JSON file (file-based fallback).', options: 'file', example: '/char add file:[attach .json]' },
      { name: '/char update', summary: 'Refresh an existing character from an uploaded JSON file. Keeps your overlay additions.', options: 'file', example: '/char update file:[attach .json]' },
      { name: '/char remove', summary: 'Delete a saved character.', options: 'name', example: '/char remove name:Hylia' },
      { name: '/char list', summary: 'List all your saved characters.', example: '/char list' },
      { name: '/char art', summary: 'Set a portrait URL shown on your character\'s rolls and sheets.', options: 'url, character', example: '/char art url:https://... character:Hylia' },
      { name: '/char feats', summary: 'Show all feats on your character.', options: 'name', example: '/char feats' },
      { name: '/char info', summary: 'Manually set senses or languages not in the Pathbuilder export.', options: 'field, value, character', example: '/char info field:Senses value:Darkvision' },
      { name: '/sheet', summary: 'Display a full character sheet with skills, attacks, and defenses.', options: 'name', example: '/sheet' },
      { name: '/portrait', summary: 'Show your character\'s current portrait art, large. Hint: set one with `/char art`.', options: 'character', example: '/portrait' },
      { name: '/roll', summary: 'Roll dice with full PF2e expression support, plus modifiers like `adv`, `dis`, `crit`, `rr1`, iterations (`4#`), and user/server snippets.', options: 'dice, character', example: '/roll dice:1d20+7 adv sneaky 3' },
      { name: '/snippet create', summary: 'Create a personal roll snippet. Use `%1`, `%2` etc. for args (e.g. `+%1:2d6[sneak]`).', options: 'name, expand', example: '/snippet create name:sneaky expand:+%1:2d6[sneak]' },
      { name: '/snippet list', summary: 'List all your personal roll snippets.', options: '', example: '/snippet list' },
      { name: '/snippet view', summary: 'Show what a personal snippet expands to, and its arguments.', options: 'name', example: '/snippet view name:sneaky' },
      { name: '/snippet delete', summary: 'Delete one of your personal snippets.', options: 'name', example: '/snippet delete name:sneaky' },
      { name: '/serversnippet create', summary: 'GM only: create a server-wide snippet everyone on this server can use. Requires Manage Server.', options: 'name, expand', example: '/serversnippet create name:bless expand:+1d4' },
      { name: '/serversnippet list', summary: 'Show all server-wide snippets for this server.', options: '', example: '/serversnippet list' },
      { name: '/serversnippet view', summary: 'Show what a server snippet expands to.', options: 'name', example: '/serversnippet view name:bless' },
      { name: '/serversnippet delete', summary: 'GM only: remove a server-wide snippet. Requires Manage Server.', options: 'name', example: '/serversnippet delete name:bless' },
      { name: '/skill', summary: 'Roll a skill check using your character\'s bonuses.', options: 'skill, character, bonus', example: '/skill skill:Athletics' },
      { name: '/perception', summary: 'Roll a Perception check (Wis + proficiency).', options: 'character, bonus', example: '/perception' },
      { name: '/initiative', summary: 'Roll initiative (defaults to Perception; optional skill override for ambushes/social).', options: 'skill, character, bonus', example: '/initiative skill:Stealth' },
      { name: '/save', summary: 'Roll a saving throw (Fortitude, Reflex, or Will).', options: 'type, character, bonus', example: '/save type:Reflex' },
      { name: '/hero', summary: 'Track and use Hero Points (PF2e: max 3, start with 1 per session).', options: '(subcommands)', example: '/hero use' },
      { name: '/hp', summary: 'Out-of-combat HP tracking. Set/heal/damage your character\'s HP between fights.', options: '(subcommands: view, set, add, reset)', example: '/hp add value:-5' },
      { name: '/char active', summary: 'Set a default character so you don\'t have to type character: every time.', options: 'character (or action:clear)', example: '/char active character:Hylia' },
      { name: '/xp', summary: 'Track experience per character. Award XP and see level progress.', options: '(subcommands: award, view, set, reset)', example: '/xp award character:Hylia amount:80 reason:Defeated the goblin chief' },
      { name: '/notes', summary: 'Per-character session notebook: NPCs, Locations, Plot Threads, Influence, Items. Owner-only write, public read.', options: '(subcommands: add, list, view, search, edit, remove, pin)', example: '/notes add category:Influence text:+1 with Lady Aldori after the banquet pin:true' },
      { name: '/resource show', summary: 'View current focus points, hero points, and spell slots.', options: 'character', example: '/resource show' },
      { name: '/resource set', summary: 'Manually override a daily resource value.', options: 'resource, value, rank, caster, character', example: '/resource set resource:focus value:0' },
      { name: '/rest', summary: 'Long rest: refill slots, focus points, hero points. Clears prepared list (with confirm).', options: 'character', example: '/rest' },
      { name: '/refocus', summary: '10-minute refocus. Regain 1 focus point.', options: 'character', example: '/refocus' },
      { name: '/bag', summary: 'Manage your inventory beyond what\'s in the Pathbuilder export.', options: '(subcommands)', example: '/bag add category:Consumables item:Elixir of Life' },
      { name: '/gold', summary: 'Manage currency (pp/gp/sp/cp).', options: '(subcommands)', example: '/gold add gp:10' },
    ],
  },

  spells: {
    emoji: '🔮',
    label: 'Spells',
    blurb: 'Cast, learn, prepare, and look up spells. Overlay-added spells survive Pathbuilder re-imports.',
    commands: [
      { name: '/spell', summary: 'Look up any spell in the database.', options: 'name', example: '/spell name:Fireball' },
      { name: '/spellbook', summary: 'Show your character\'s full spell list grouped by rank with slot counters.', options: 'name', example: '/spellbook' },
      { name: '/cast', summary: 'Cast a spell. Auto-spends a slot and warns if out of slots or unprepared.', options: 'spell, target, character, level', example: '/cast spell:Heal target:Fighter' },
      { name: '/spells learn', summary: 'Add a spell to a caster\'s spellbook permanently (wizards, witches, etc.).', options: 'spell, caster, character', example: '/spells learn spell:Fireball caster:Wizard' },
      { name: '/spells forget', summary: 'Remove a spell you previously learned via overlay.', options: 'spell, caster, character', example: '/spells forget spell:Fireball' },
      { name: '/spells prepare', summary: 'Prepare a spell into today\'s slot (prepared casters).', options: 'spell, rank, caster, character', example: '/spells prepare spell:Heal rank:1' },
      { name: '/spells unprepare', summary: 'Unfill a prepared slot.', options: 'spell, rank, caster, character', example: '/spells unprepare spell:Heal rank:1' },
      { name: '/spells swap', summary: 'Swap a known spell (spontaneous caster repertoire change).', options: 'remove, add, rank, caster, character', example: '/spells swap remove:Bane add:Bless rank:1' },
      { name: '/spells list', summary: 'Show merged spellbook with ✨ on overlay-added spells.', options: 'caster, character', example: '/spells list' },
    ],
  },

  combat: {
    emoji: '⚔️',
    label: 'Combat',
    blurb: 'Encounter tracker, initiative, attacks, and effects. Now with auto-MAP, dying/wounded, persistent damage, and reaction prompts.',
    commands: [
      { name: '/init start', summary: 'Start a new encounter in this channel (GM).', example: '/init start' },
      { name: '/init end', summary: 'End the current encounter.', example: '/init end' },
      { name: '/init add', summary: 'Add a combatant to the current encounter.', options: 'name, initiative, hp, (gm flags)', example: '/init add name:Goblin 1 initiative:18 hp:6' },
      { name: '/init addmonster', summary: 'GM: add a bestiary monster with auto-filled HP/AC/perception. Supports multi-spawn.', options: 'monster, count, init_mode, hp_mode, bonus', example: '/init addmonster monster:Goblin Warrior count:4' },
      { name: '/init addnpc', summary: 'GM: add a custom NPC with manual stats (for homebrew).', options: 'name, bonus, hp, ac', example: '/init addnpc name:Bandit Captain bonus:6 hp:45 ac:20' },
      { name: '/init remove', summary: 'Remove a combatant.', options: 'name', example: '/init remove name:Goblin 1' },
      { name: '/init next', summary: 'Advance turn. Auto-rolls persistent damage and recovery checks.', example: '/init next' },
      { name: '/init hp', summary: 'Modify a combatant\'s HP. Auto-applies dying when reduced to 0.', options: 'name, change', example: '/init hp name:Fighter change:-12' },
      { name: '/init dying', summary: 'GM: manually set a combatant\'s dying value (0–4).', options: 'name, value', example: '/init dying name:Fighter value:0' },
      { name: '/init recovery', summary: 'Manually roll a recovery check for a dying combatant. Use if auto-roll didn\'t fire.', options: 'name', example: '/init recovery name:Fighter' },
      { name: '/init move', summary: 'Declare a combatant moves. Prompts all combatants with reactions for AoO.', options: 'name', example: '/init move name:Fighter' },
      { name: '/init reaction', summary: 'Manually prompt a specific combatant for a reaction (Shield Block, etc.).', options: 'name, reason', example: '/init reaction name:Fighter reason:Shield Block' },
      { name: '/init damage', summary: 'Manually roll persistent damage on a combatant outside the normal turn tick.', options: 'name', example: '/init damage name:Fighter' },
      { name: '/init effect', summary: 'Apply a status effect. Includes persistent-fire/bleed/etc. and dying/wounded.', options: '(subcommands)', example: '/init effect add name:Fighter effect:persistent-fire value:1' },
      { name: '/attack', summary: 'Roll an attack. MAP is auto-tracked across attacks this turn.', options: 'weapon, target, map (optional), no_map, bonus', example: '/attack weapon:Longsword target:Goblin 1' },
    ],
  },

  lookup: {
    emoji: '📚',
    label: 'Lookup',
    blurb: 'Look up anything from the PF2e rulebooks.',
    commands: [
      { name: '/ancestry', summary: 'Look up a PF2e ancestry (Core, Heritages, Feats across 3 pages).', options: 'name', example: '/ancestry name:Elf' },
      { name: '/archetype', summary: 'Look up a PF2e archetype.', options: 'name', example: '/archetype name:Assassin' },
      { name: '/background', summary: 'Look up a PF2e background.', options: 'name', example: '/background name:Acolyte' },
      { name: '/feat', summary: 'Look up a feat. Filter by level to disambiguate same-named feats.', options: 'name, level', example: '/feat name:Power Attack' },
      { name: '/item', summary: 'Look up an item, weapon, armor, or gear. Filter by level for tiered versions.', options: 'name, level', example: '/item name:Healing Potion level:3' },
      { name: '/rule', summary: 'Look up a condition, action, or trait.', options: 'name', example: '/rule name:frightened' },
      { name: '/monster', summary: 'Look up a creature from the bestiary.', options: 'name', example: '/monster name:Ancient Red Dragon' },
      { name: '/deity', summary: 'Look up a deity.', options: 'name', example: '/deity name:Pharasma' },
      { name: '/skillinfo', summary: 'Learn how a skill works: uses, actions by proficiency, DC examples. Shows your modifier if you have a character loaded.', options: 'skill, character', example: '/skillinfo skill:Athletics' },
      { name: '/class', summary: 'Look up a PF2e class with 5-page navigation: overview, proficiencies, features, class feats, subclass.', options: 'class, character', example: '/class class:Fighter' },
      { name: '/companion', summary: 'Look up animal/plant/undead companions. Shows stats, support benefit, and advanced maneuver.', options: '(subcommands: info, list)', example: '/companion info name:Wolf' },
      { name: '/companion art', summary: 'Set a portrait image URL for one of your companions. Shows on the sheet.', options: 'url, companion, character', example: '/companion art url:https://... companion:Fluffy' },
      { name: '/companion set', summary: 'Override any companion stat (ability scores, AC, HP, saves, attack, damage, speed, size).', options: 'stat, value, companion, character', example: '/companion set stat:ac value:22 companion:Fluffy' },
      { name: '/companion reset', summary: 'Clear one override so the stat auto-scales again.', options: 'stat, companion, character', example: '/companion reset stat:ac companion:Fluffy' },
      { name: '/companion resetall', summary: 'Clear ALL stat overrides on a companion (keeps art and notes).', options: 'companion, character', example: '/companion resetall companion:Fluffy' },
    ],
  },

  gm: {
    emoji: '🎲',
    label: 'GM Tools',
    blurb: 'Stat-block editing, monster attacks, and GM-only utilities.',
    commands: [
      { name: '/monsteradd paste', summary: 'Bot-owner only: add a missing creature to the global bestiary from pasted text.', options: 'statblock', example: '/monsteradd paste statblock:[paste AoN text]' },
      { name: '/monsteradd file', summary: 'Bot-owner only: add a creature from a .txt file.', options: 'file', example: '/monsteradd file file:[.txt attachment]' },
      { name: '/monsteradd remove', summary: 'Bot-owner only: remove a creature from the bestiary.', options: 'monster', example: '/monsteradd remove monster:Adult Bog Dragon' },
      { name: '/spelladd paste', summary: 'Bot-owner only: add a homebrew spell to the global database from pasted text.', options: 'statblock', example: '/spelladd paste statblock:[paste AoN text]' },
      { name: '/spelladd file', summary: 'Bot-owner only: add a homebrew spell from a .txt file.', options: 'file', example: '/spelladd file file:[.txt attachment]' },
      { name: '/spelladd remove', summary: 'Bot-owner only: remove a homebrew spell from the database.', options: 'spell', example: '/spelladd remove spell:Mind Lash' },
      { name: '/itemadd paste', summary: 'Bot-owner only: add a homebrew item to the global database from pasted text.', options: 'statblock', example: '/itemadd paste statblock:[paste AoN text]' },
      { name: '/itemadd file', summary: 'Bot-owner only: add a homebrew item from a .txt file.', options: 'file', example: '/itemadd file file:[.txt attachment]' },
      { name: '/itemadd remove', summary: 'Bot-owner only: remove a homebrew item from the database.', options: 'item', example: '/itemadd remove item:Flaming Rapier' },
      { name: '/monsterart set', summary: 'Attach a custom image to a monster\'s stat block for this server.', options: 'monster, url', example: '/monsterart set monster:Goblin Warrior url:https://...' },
      { name: '/monsterart remove', summary: 'Remove the custom image for a monster on this server.', options: 'monster', example: '/monsterart remove monster:Goblin Warrior' },
      { name: '/monsterart view', summary: 'View saved art for one monster, or list all saved art on this server.', options: 'monster', example: '/monsterart view' },
      { name: '/monsteredit', summary: 'Override or add stat-block fields for a monster on this server.', options: '(many subcommands)', example: '/monsteredit ability monster:Goblin name:Sneak Attack' },
      { name: '/mattack', summary: 'Roll a monster attack against a target in the active encounter.', options: 'attacker, target, map', example: '/mattack attacker:Goblin target:Fighter' },
      { name: '/monsterattack', summary: 'Save and manage a library of monster attacks (per-server).', options: '(subcommands)', example: '/monsterattack add monster:Goblin attack:Shortsword ...' },
    ],
  },
};

function buildHelpEmbed(categoryKey) {
  const cat = HELP_CATEGORIES[categoryKey] ?? HELP_CATEGORIES.character;
  const embed = new EmbedBuilder()
    .setColor(0x4a90d9)
    .setTitle(`${cat.emoji} Pathway Help — ${cat.label}`)
    .setDescription(cat.blurb);

  // Pack commands into fields. Discord caps each field value at 1024 chars,
  // so group until we'd overflow, then start a new field.
  const maxFieldLen = 1000;
  let buf = '';
  let partIdx = 1;
  const emit = () => {
    if (!buf) return;
    const fieldName = partIdx === 1 ? 'Commands' : `Commands (cont. ${partIdx})`;
    embed.addFields({ name: fieldName, value: buf.trim(), inline: false });
    partIdx++;
    buf = '';
  };
  for (const cmd of cat.commands) {
    const block = `**${cmd.name}**\n${cmd.summary}` +
      (cmd.options ? `\n  *Options:* ${cmd.options}` : '') +
      (cmd.example ? `\n  *Example:* \`${cmd.example}\`` : '') + '\n\n';
    if (buf.length + block.length > maxFieldLen) emit();
    buf += block;
  }
  emit();

  embed.setFooter({ text: 'Pick a category below • ✨ = added to your character via overlay' });
  return embed;
}

function buildHelpButtons(currentCategory) {
  const row = new ActionRowBuilder();
  for (const [key, cat] of Object.entries(HELP_CATEGORIES)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`help_${key}`)
        .setLabel(cat.label)
        .setEmoji(cat.emoji)
        .setStyle(key === currentCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(key === currentCategory),
    );
  }
  return row;
}

// ── Bot ready ─────────────────────────────────────────────────────────────────
client.once('clientReady', () => { console.log(`Logged in as ${client.user.tag}!`); });

// ── Interaction handler ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  if (interaction.isButton()) {
    // ─── Monster-attack save roll button ────────────────────────────
    if (interaction.customId.startsWith('msave_')) {
      // customId shape: msave_<saveType>_<dc>
      const [, saveType, dcStr] = interaction.customId.split('_');
      const dc = parseInt(dcStr, 10);
      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(interaction.user.id, null, characters);
      if (error) {
        return interaction.reply({ content: `❌ ${error}\nLoad a character with \`/char add\` first, or roll manually with \`/save type:${saveType}\`.`, ephemeral: true });
      }
      const c = charEntry.data;
      const ab = c.abilities ?? {};
      const prof = c.proficiencies ?? {};
      const lvl = c.level ?? 1;
      const saveAbilMap = { fortitude: 'con', reflex: 'dex', will: 'wis' };
      const abilKey  = saveAbilMap[saveType];
      const abilMod  = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
      const profNum  = prof[saveType] ?? 0;
      const modifier = abilMod + calcProfNum(profNum, lvl);
      const dieRoll  = Math.floor(Math.random() * 20) + 1;
      const total    = dieRoll + modifier;
      // Degree of success vs DC
      let degree;
      if (total >= dc + 10)      degree = 'crit-success';
      else if (total >= dc)      degree = 'success';
      else if (total <= dc - 10) degree = 'crit-failure';
      else                       degree = 'failure';
      if (dieRoll === 20) degree = degree === 'crit-failure' ? 'failure' : degree === 'failure' ? 'success' : degree === 'success' ? 'crit-success' : degree;
      if (dieRoll === 1)  degree = degree === 'crit-success' ? 'success' : degree === 'success' ? 'failure' : degree === 'failure' ? 'crit-failure' : degree;
      const saveDisplay = saveType.charAt(0).toUpperCase() + saveType.slice(1);
      const outcomeMap = {
        'crit-success': '🌟 **Critical Success** (no damage)',
        'success':      '✅ **Success** (half damage)',
        'failure':      '❌ **Failure** (full damage)',
        'crit-failure': '💥 **Critical Failure** (double damage)'
      };
      let natLine = '';
      if (dieRoll === 20) natLine = '\n⭐ Natural 20!';
      if (dieRoll === 1)  natLine = '\n💀 Natural 1!';
      const embed = new EmbedBuilder()
        .setColor(degree === 'crit-success' ? 0x2ecc71 : degree === 'success' ? 0x27ae60 : degree === 'failure' ? 0xe67e22 : 0xe74c3c)
        .setTitle(`${c.name} rolls a ${saveDisplay} save!`)
        .setDescription(`1d20 (${dieRoll}) ${fmt(modifier)} = **${total}** vs DC ${dc}${natLine}\n\n${outcomeMap[degree]}`)
        .setFooter({ text: `${c.name} · ${saveDisplay} ${fmt(modifier)}` });
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      return interaction.reply({ embeds: [embed] });
    }

    // ─── Help category navigation ───────────────────────────────────
    if (interaction.customId.startsWith('help_')) {
      const category = interaction.customId.slice('help_'.length);
      if (!HELP_CATEGORIES[category]) {
        return interaction.update({ content: '❌ Unknown help category.', embeds: [], components: [] });
      }
      return interaction.update({
        embeds: [buildHelpEmbed(category)],
        components: [buildHelpButtons(category)],
      });
    }

    // ─── Rest confirmation buttons ──────────────────────────────────
    if (interaction.customId.startsWith('rest_confirm_')) {
      // customId: rest_confirm_<userId>_<charKey>
      const rest = interaction.customId.slice('rest_confirm_'.length);
      const underscoreIdx = rest.indexOf('_');
      const ownerId = rest.slice(0, underscoreIdx);
      const charKey = rest.slice(underscoreIdx + 1);
      if (interaction.user.id !== ownerId) {
        return interaction.reply({ content: '❌ Only the person who used `/rest` can confirm.', ephemeral: true });
      }
      const characters = loadCharacters();
      const charEntry = characters[ownerId]?.[charKey];
      if (!charEntry) {
        return interaction.update({ content: '❌ Could not find that character anymore.', embeds: [], components: [] });
      }
      charOverlay.longRest(charEntry);
      // Restore HP to max as part of a full rest
      const maxHp = computeCharMaxHp(charEntry);
      charEntry.hp = maxHp;
      saveCharacters(characters);
      const focus = charOverlay.getCurrentFocus(charEntry);
      const doneEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`🌙 ${charEntry.data.name} rests and recovers`)
        .setDescription(`HP restored to **${maxHp}/${maxHp}**. All spell slots refilled. Focus points: ${focus.current}/${focus.max}. Hero points reset to 1. Prepared spells cleared.`);
      return interaction.update({ embeds: [doneEmbed], components: [] });
    }
    if (interaction.customId.startsWith('rest_cancel_')) {
      const ownerId = interaction.customId.slice('rest_cancel_'.length);
      if (interaction.user.id !== ownerId) {
        return interaction.reply({ content: '❌ Only the person who used `/rest` can cancel.', ephemeral: true });
      }
      return interaction.update({ content: '🚫 Rest cancelled. Nothing changed.', embeds: [], components: [] });
    }

    // ─── Reaction trigger / skip buttons ────────────────────────────
    if (interaction.customId.startsWith('reaction_trigger_') || interaction.customId.startsWith('reaction_skip_')) {
      const isTrigger = interaction.customId.startsWith('reaction_trigger_');
      // Recover the combatant name from the safe-encoded customId
      const safeName = interaction.customId.slice(isTrigger ? 'reaction_trigger_'.length : 'reaction_skip_'.length);
      const channelId = interaction.channel.id;
      const enc = getEncounter(channelId);
      if (!enc) {
        return interaction.update({ content: '❌ The encounter has ended.', components: [] });
      }
      // Find the combatant by reverse-encoding the safe name (replace _ back to . match)
      const combatant = enc.combatants.find(c => c.name.replace(/[^a-zA-Z0-9]/g, '_') === safeName);
      if (!combatant) {
        return interaction.update({ content: '❌ Could not find that combatant in the encounter.', components: [] });
      }
      // Permission gate: only the combatant's owner (or GM) can decide
      const isOwner = !combatant.isNpc && interaction.user.id === combatant.ownerId;
      const isGm = interaction.user.id === enc.gmId;
      if (!isOwner && !isGm) {
        return interaction.reply({ content: `❌ Only ${combatant.isNpc ? 'the GM' : 'the combatant\'s owner'} can decide on this reaction.`, ephemeral: true });
      }
      // Update the message
      const original = interaction.message.content || '';
      // Strip the reaction prompt line(s) from the original content (lines starting with the combatant's mention)
      const cleanedContent = original.split('\n').filter(line =>
        !line.includes(`**${combatant.name}** may have a reaction available`)
      ).join('\n').trim();

      if (isTrigger) {
        ca.consumeReaction(channelId, combatant.name);
        const newContent = `${cleanedContent}\n⤾ **${combatant.name}** uses their reaction! *(GM: resolve the reaction now.)*`.trim();
        await interaction.update({ content: newContent, components: [] });
        await updateSummary(interaction.channel, enc);
      } else {
        const newContent = `${cleanedContent}\n*${combatant.name} declines the reaction.*`.trim();
        await interaction.update({ content: newContent, components: [] });
      }
      return;
    }

    // ─── Recovery check hero-point reroll ───────────────────────────
    if (interaction.customId.startsWith('rcheck_reroll_')) {
      // customId: rcheck_reroll_<safeName>_<dyingBefore>_<dyingAfter>_<roll>_<awoke 1|0>
      const tail = interaction.customId.slice('rcheck_reroll_'.length);
      const lastUnderscore5 = tail.lastIndexOf('_');
      const lastUnderscore4 = tail.lastIndexOf('_', lastUnderscore5 - 1);
      const lastUnderscore3 = tail.lastIndexOf('_', lastUnderscore4 - 1);
      const lastUnderscore2 = tail.lastIndexOf('_', lastUnderscore3 - 1);
      const safeName = tail.slice(0, lastUnderscore2);
      const dyingBefore = parseInt(tail.slice(lastUnderscore2 + 1, lastUnderscore3));
      const dyingAfter = parseInt(tail.slice(lastUnderscore3 + 1, lastUnderscore4));
      const roll = parseInt(tail.slice(lastUnderscore4 + 1, lastUnderscore5));
      const awoke = tail.slice(lastUnderscore5 + 1) === '1';

      const channelId = interaction.channel.id;
      const enc = getEncounter(channelId);
      if (!enc) return interaction.update({ content: '❌ The encounter has ended.', components: [] });
      const combatant = enc.combatants.find(c => c.name.replace(/[^a-zA-Z0-9]/g, '_') === safeName);
      if (!combatant) return interaction.update({ content: '❌ Combatant not found.', components: [] });

      // Only the combatant's owner can spend the hero point
      if (combatant.isNpc || interaction.user.id !== combatant.ownerId) {
        return interaction.reply({ content: '❌ Only the combatant\'s owner can spend the Hero Point.', ephemeral: true });
      }

      // Burn the hero point
      const characters = loadCharacters();
      const charKey = combatant.name.toLowerCase().replace(/\s+/g, '-');
      const charEntry = characters[combatant.ownerId]?.[charKey];
      if (!charEntry) return interaction.reply({ content: '❌ Character not found.', ephemeral: true });
      const currentHp = charEntry.heroPoints ?? 1;
      if (currentHp <= 0) return interaction.reply({ content: '❌ No hero points available.', ephemeral: true });
      charEntry.heroPoints = currentHp - 1;
      saveCharacters(characters);

      // Reroll
      const originalResult = { dyingBefore, dyingAfter, roll, awoke };
      const result = ca.rerollRecoveryCheck(channelId, combatant.name, originalResult);
      const outcomeEmoji = result.outcome === 'crit-success' ? '🌟'
        : result.outcome === 'success' ? '✅'
        : result.outcome === 'failure' ? '❌'
        : '💥';
      const newEmbed = new EmbedBuilder()
        .setColor(result.died ? 0x8B0000 : result.awoke ? 0x2ecc71 : result.outcome === 'success' || result.outcome === 'crit-success' ? 0x27ae60 : 0xe74c3c)
        .setTitle(`💀 ${combatant.name}'s Recovery Check (Hero Point Reroll)`)
        .setDescription(
          `Original: ${originalResult.roll} · Reroll: ${result.rerollRoll}\n` +
          `${outcomeEmoji} **${(result.outcome ?? 'unchanged').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}**\n` +
          `${result.narration}\n\n` +
          `*Hero Points: ${charEntry.heroPoints}/3*`
        );
      await interaction.update({ embeds: [newEmbed], components: [] });
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ─── Skill info page navigation ─────────────────────────────────
    if (interaction.customId.startsWith('skill_')) {
      const parts = interaction.customId.split('_');
      const pageIndex = parseInt(parts[parts.length - 1], 10);
      const skillKey = parts.slice(1, parts.length - 1).join('_');
      const skill = skillDatabase[skillKey];
      if (!skill) return interaction.update({ content: '❌ Could not reload skill data.', components: [] });

      // Recompute the character's modifier for the Overview page — the user
      // might have leveled up or added a character since this was first posted.
      let charMod = null;
      if (pageIndex === 0) {
        try {
          const characters = loadCharacters();
          const { char: charEntry } = resolveChar(interaction.user.id, null, characters);
          if (charEntry) charMod = computeCharSkillModifier(charEntry, skillKey);
        } catch { /* no character, skip */ }
      }

      let newEmbed;
      if (pageIndex === 0) newEmbed = buildSkillOverviewPage(skill, charMod);
      else if (pageIndex === 1) newEmbed = buildSkillActionsPage(skill);
      else if (pageIndex === 2) newEmbed = buildSkillDcsPage(skill);
      else return interaction.update({ content: '❌ Unknown skill page.', components: [] });

      return interaction.update({ embeds: [newEmbed], components: [buildSkillButtons(pageIndex, skillKey)] });
    }

    // Class page navigation: class_<key>_<pageIndex>
    if (interaction.customId.startsWith('class_')) {
      const parts = interaction.customId.split('_');
      const pageIndex = parseInt(parts[parts.length - 1], 10);
      const classKey = parts.slice(1, parts.length - 1).join('_');
      const cls = classDatabase[classKey];
      if (!cls) return interaction.update({ content: '❌ Could not reload class data.', components: [] });
      // Try to get user's character name for the overview page
      let userCharName = null;
      if (pageIndex === 0) {
        try {
          const characters = loadCharacters();
          const { char: charEntry } = resolveChar(interaction.user.id, null, characters);
          if (charEntry?.data?.class?.toLowerCase() === cls.name.toLowerCase()) {
            userCharName = charEntry.data.name;
          }
        } catch { /* skip */ }
      }
      let newEmbed;
      if (pageIndex === 0) newEmbed = buildClassOverviewPage(cls, userCharName);
      else if (pageIndex === 1) newEmbed = buildClassProficienciesPage(cls);
      else if (pageIndex === 2) newEmbed = buildClassFeaturesPage(cls);
      else if (pageIndex === 3) newEmbed = buildClassFeatsPage(cls);
      else if (pageIndex === 4) newEmbed = buildClassSubclassPage(cls);
      else return interaction.update({ content: '❌ Unknown class page.', components: [] });
      return interaction.update({ embeds: [newEmbed], components: [buildClassButtons(pageIndex, classKey)] });
    }

    if (!interaction.customId.startsWith('ancestry_')) return;
    const parts = interaction.customId.split('_');
    const pageIndex = parseInt(parts[parts.length - 1], 10);
    const ancestryKey = parts.slice(1, parts.length - 1).join('_');
    const ancestry = ancestryDatabase[ancestryKey];
    if (!ancestry) return interaction.update({ content: '❌ Could not reload ancestry data.', components: [] });
    let newEmbed;
    if (pageIndex === 0) newEmbed = buildAncestryCorePage(ancestry);
    if (pageIndex === 1) newEmbed = buildAncestryHeritagesPage(ancestry);
    if (pageIndex === 2) newEmbed = buildAncestryFeatsPage(ancestry);
    return interaction.update({ embeds: [newEmbed], components: [buildAncestryButtons(pageIndex, ancestryKey)] });
  }

  if (!interaction.isChatInputCommand()) {
    // ─── Autocomplete ────────────────────────────────────────────────
    if (interaction.isAutocomplete()) {
      try {
        const focused = interaction.options.getFocused(true); // { name, value }
        const q = String(focused.value ?? '').toLowerCase().trim();
        const cmd = interaction.commandName;

        // Score & slice helper: exact first, then starts-with, then contains.
        // `names` is an array of strings (already deduped). Max 25 results.
        const pick = (names) => {
          const seen = new Set();
          const out = [];
          const push = (n) => {
            const key = n.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            // Discord requires name ≤ 100 chars
            const display = n.length > 100 ? n.slice(0, 97) + '...' : n;
            out.push({ name: display, value: display });
          };
          if (!q) {
            // Empty query: first 25 alphabetically so the dropdown isn't blank
            [...names].sort((a, b) => a.localeCompare(b)).slice(0, 25).forEach(push);
          } else {
            const exact    = names.filter(n => n.toLowerCase() === q);
            const starts   = names.filter(n => n.toLowerCase().startsWith(q));
            const contains = names.filter(n => n.toLowerCase().includes(q));
            for (const n of exact)    { if (out.length >= 25) break; push(n); }
            for (const n of starts)   { if (out.length >= 25) break; push(n); }
            for (const n of contains) { if (out.length >= 25) break; push(n); }
          }
          return out;
        };

        let suggestions = [];

        if (cmd === 'item' && focused.name === 'name') {
          suggestions = pick(itemDatabase.map(i => i.name));
        }
        else if ((cmd === 'spell' && focused.name === 'name') ||
                 (cmd === 'cast'  && focused.name === 'spell')) {
          suggestions = pick(spellDatabase.map(s => s.name).filter(Boolean));
        }
        else if (cmd === 'spells') {
          // Context-aware spell autocomplete for the various subcommands.
          const sub = interaction.options.getSubcommand(false);
          const charNameArg = interaction.options.getString('character');
          // Helper: get the current character's overlay + pathbuilder spellbooks
          const getOwnSpells = (filterPredicate) => {
            try {
              const characters = loadCharacters();
              const { error, char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters);
              if (error || !charEntry) return [];
              const casterFilter = interaction.options.getString('caster');
              const casters = charOverlay.getCasters(charEntry.data)
                .filter(c => !casterFilter || c.name.toLowerCase() === casterFilter.toLowerCase());
              const names = new Set();
              for (const caster of casters) {
                const merged = charOverlay.getMergedSpellbook(charEntry, caster.name);
                if (!merged) continue;
                for (const n of merged.cantrips) {
                  if (!filterPredicate || filterPredicate({ name: n, rank: 0, caster, merged })) names.add(n);
                }
                for (const [rank, list] of Object.entries(merged.ranks)) {
                  for (const n of list) {
                    if (!filterPredicate || filterPredicate({ name: n, rank: Number(rank), caster, merged })) names.add(n);
                  }
                }
              }
              return [...names];
            } catch { return []; }
          };

          if (focused.name === 'character') {
            const characters = loadCharacters();
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          }
          else if (focused.name === 'caster') {
            const characters = loadCharacters();
            const { char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters) || {};
            const names = charEntry ? charOverlay.getCasters(charEntry.data).map(c => c.name) : [];
            suggestions = pick(names);
          }
          else if (focused.name === 'spell') {
            if (sub === 'learn' || sub === 'prepare') {
              // Suggest from the full spell database
              suggestions = pick(spellDatabase.map(s => s.name).filter(Boolean));
            } else if (sub === 'forget') {
              // Only overlay-added spells can be forgotten
              const characters = loadCharacters();
              const { char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters) || {};
              if (charEntry) {
                charOverlay.ensureOverlay(charEntry);
                const casterFilter = interaction.options.getString('caster');
                const names = charEntry.overlay.spellbook
                  .filter(e => !casterFilter || e.caster.toLowerCase() === casterFilter.toLowerCase())
                  .map(e => e.spell);
                suggestions = pick([...new Set(names)]);
              }
            } else if (sub === 'unprepare') {
              // Only prepared spells
              const characters = loadCharacters();
              const { char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters) || {};
              if (charEntry) {
                charOverlay.ensureOverlay(charEntry);
                const casterFilter = interaction.options.getString('caster');
                const prepSets = Object.entries(charEntry.overlay.prepared_override ?? {});
                const names = new Set();
                for (const [cname, list] of prepSets) {
                  if (casterFilter && cname.toLowerCase() !== casterFilter.toLowerCase()) continue;
                  for (const p of list) names.add(p.spell);
                }
                suggestions = pick([...names]);
              }
            }
          }
          else if (focused.name === 'remove') {
            // /spells swap: remove should only show spells the character knows
            suggestions = pick(getOwnSpells());
          }
          else if (focused.name === 'add') {
            // /spells swap: add from full spell database
            suggestions = pick(spellDatabase.map(s => s.name).filter(Boolean));
          }
        }
        else if (cmd === 'feat' && focused.name === 'name') {
          suggestions = pick(featDatabase.map(f => f.name));
        }
        else if (cmd === 'rule' && focused.name === 'name') {
          // rulesDatabase is nested { category: { key: rule } }
          const names = [];
          for (const category of Object.values(rulesDatabase)) {
            for (const rule of Object.values(category)) if (rule?.name) names.push(rule.name);
          }
          suggestions = pick(names);
        }
        else if (cmd === 'ancestry' && focused.name === 'name') {
          suggestions = pick(Object.values(ancestryDatabase).map(a => a?.name).filter(Boolean));
        }
        else if (cmd === 'archetype' && focused.name === 'name') {
          suggestions = pick(Object.values(archetypeDatabase).map(a => a?.name).filter(Boolean));
        }
        else if (cmd === 'background' && focused.name === 'name') {
          suggestions = pick(Object.values(backgroundDatabase).map(b => b?.name).filter(Boolean));
        }
        else if (cmd === 'monster' && focused.name === 'name') {
          suggestions = pick(Object.values(bestiaryDatabase).map(m => m?.name).filter(Boolean));
        }
        else if (cmd === 'monsterart' && focused.name === 'monster') {
          // For 'view' and 'remove', prefer suggesting only monsters that
          // actually have art saved on this server; fall back to the full
          // bestiary if the user's query doesn't match any saved art.
          const sub = interaction.options.getSubcommand(false);
          if ((sub === 'view' || sub === 'remove') && interaction.guildId) {
            const store = loadMonsterArt();
            const guild = store[interaction.guildId] ?? {};
            const savedNames = Object.values(guild).map(e => e.displayName);
            const savedMatch = savedNames.some(n => n.toLowerCase().includes(q));
            suggestions = pick(savedMatch || !q ? savedNames : Object.values(bestiaryDatabase).map(m => m?.name).filter(Boolean));
          } else {
            // 'set' — full bestiary so GMs can attach art to any creature.
            suggestions = pick(Object.values(bestiaryDatabase).map(m => m?.name).filter(Boolean));
          }
        }
        else if (cmd === 'monsteredit' && focused.name === 'monster') {
          // For 'view', 'remove', 'reset', prefer monsters that already have
          // edits saved on this server so the GM can find them quickly.
          // For everything else, suggest the full bestiary so they can edit
          // anything (and can also type homebrew names freely).
          const sub = interaction.options.getSubcommand(false);
          const editOnly = ['view', 'remove', 'reset'];
          if (editOnly.includes(sub) && interaction.guildId) {
            const store = loadMonsterEdits();
            const guild = store[interaction.guildId] ?? {};
            const savedNames = Object.values(guild).map(e => e.displayName);
            const savedMatch = savedNames.some(n => n.toLowerCase().includes(q));
            suggestions = pick(savedMatch || !q ? savedNames : Object.values(bestiaryDatabase).map(m => m?.name).filter(Boolean));
          } else {
            suggestions = pick(Object.values(bestiaryDatabase).map(m => m?.name).filter(Boolean));
          }
        }
        else if ((cmd === 'rest' || cmd === 'refocus' || cmd === 'resource')) {
          const characters = loadCharacters();
          if (focused.name === 'character') {
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          } else if (focused.name === 'caster') {
            const charNameArg = interaction.options.getString('character');
            const { char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters) || {};
            const names = charEntry ? charOverlay.getCasters(charEntry.data).map(c => c.name) : [];
            suggestions = pick(names);
          }
        }
        else if (cmd === 'xp' && focused.name === 'character') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
          suggestions = pick(own);
        }
        else if ((cmd === 'hp' || cmd === 'perception' || cmd === 'initiative' || cmd === 'portrait') && focused.name === 'character') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
          suggestions = pick(own);
        }
        else if (cmd === 'snippet' && focused.name === 'name') {
          // Autocomplete user's own snippets for view/delete subcommands.
          const all = loadSnippets();
          const own = Object.keys(all[interaction.user.id] ?? {});
          suggestions = pick(own);
        }
        else if (cmd === 'serversnippet' && focused.name === 'name') {
          // Autocomplete this guild's snippets
          const all = loadServerSnippets();
          const here = Object.keys(all[interaction.guildId] ?? {});
          suggestions = pick(here);
        }
        else if (cmd === 'initiative' && focused.name === 'skill') {
          // Suggest Perception + the 16 core skills for initiative overrides
          const skills = ['Perception', 'Acrobatics', 'Arcana', 'Athletics', 'Crafting', 'Deception', 'Diplomacy', 'Intimidation', 'Medicine', 'Nature', 'Occultism', 'Performance', 'Religion', 'Society', 'Stealth', 'Survival', 'Thievery'];
          suggestions = pick(skills);
        }
        else if (cmd === 'char' && focused.name === 'character' && interaction.options.getSubcommand(false) === 'active') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
          suggestions = pick(own);
        }
        else if (cmd === 'notes') {
          if (focused.name === 'character') {
            // Suggest ALL characters on the server (notebooks are public-read)
            const characters = loadCharacters();
            const allNames = [];
            for (const userChars of Object.values(characters)) {
              for (const entry of Object.values(userChars)) {
                if (entry?.name) allNames.push(entry.name);
              }
            }
            suggestions = pick(allNames);
          } else if (focused.name === 'id') {
            // Suggest note IDs from the selected character's book
            try {
              const charNameArg = interaction.options.getString('character');
              const characters = loadCharacters();
              // Find the character the user is asking about
              let ownerId = null, charKey = null;
              if (!charNameArg) {
                const own = resolveChar(interaction.user.id, null, characters);
                if (!own.error) { ownerId = interaction.user.id; charKey = own.charKey; }
              } else {
                const target = String(charNameArg).toLowerCase();
                outer2: for (const [oId, userChars] of Object.entries(characters)) {
                  for (const [k, e] of Object.entries(userChars)) {
                    if (k.startsWith('_') || !e || !e.name) continue;
                    if (e.name.toLowerCase() === target) { ownerId = oId; charKey = k; break outer2; }
                  }
                }
              }
              if (ownerId && charKey) {
                const notesData = loadNotes();
                const book = notesData[noteKey(ownerId, charKey)] ?? { notes: [] };
                // Show most recent first, with a short preview label
                const sorted = sortNotes(book.notes);
                const q = String(focused.value ?? '').toLowerCase();
                const out = [];
                for (const n of sorted) {
                  if (out.length >= 25) break;
                  const label = `#${n.id} · ${NOTE_CATEGORIES[n.category]?.label ?? '?'}: ${truncateNote(n.text, 60)}`;
                  const display = label.length > 100 ? label.slice(0, 97) + '...' : label;
                  if (!q || display.toLowerCase().includes(q) || String(n.id) === q) {
                    out.push({ name: display, value: n.id });
                  }
                }
                suggestions = out;
              }
            } catch { suggestions = []; }
          }
        }
        else if (cmd === 'init' && focused.name === 'monster') {
          suggestions = pick(Object.values(bestiaryDatabase).map(m => m?.name).filter(Boolean));
        }
        else if (cmd === 'monsteradd' && focused.name === 'monster') {
          // For /monsteradd remove, suggest the full bestiary.
          suggestions = pick(Object.values(bestiaryDatabase).map(m => m?.name).filter(Boolean));
        }
        else if (cmd === 'spelladd' && focused.name === 'spell') {
          // Only suggest homebrew spells for removal.
          suggestions = pick(spellDatabase.filter(s => s._homebrew).map(s => s.name).filter(Boolean));
        }
        else if (cmd === 'itemadd' && focused.name === 'item') {
          // Only suggest homebrew items for removal.
          suggestions = pick(itemDatabase.filter(i => i._homebrew).map(i => i.name).filter(Boolean));
        }
        else if (cmd === 'deity' && focused.name === 'name') {
          suggestions = pick(deityDatabase.map(d => d.name));
        }
        else if (cmd === 'skillinfo') {
          if (focused.name === 'skill') {
            suggestions = pick(Object.values(skillDatabase).map(s => s.name).filter(Boolean));
          } else if (focused.name === 'character') {
            const characters = loadCharacters();
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          }
        }
        else if (cmd === 'class') {
          if (focused.name === 'class') {
            suggestions = pick(Object.values(classDatabase).map(c => c.name).filter(Boolean));
          } else if (focused.name === 'character') {
            const characters = loadCharacters();
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          }
        }
        else if (cmd === 'companion' && focused.name === 'name') {
          suggestions = pick(companionDatabase.map(c => c.name));
        }
        else if (cmd === 'bag') {
          const sub = interaction.options.getSubcommand(false);
          if (sub === 'add' && focused.name === 'item') {
            // Suggest from the full item database
            suggestions = pick(itemDatabase.map(i => i.name));
          } else if (sub === 'remove' && focused.name === 'item') {
            // Suggest only from the user's own bag contents in that category (if they've picked one)
            const bags = loadBags();
            const userBag = bags[interaction.user.id];
            const cat = interaction.options.getString('category');
            const names = [];
            if (userBag?.categories) {
              const buckets = cat && userBag.categories[cat] ? [userBag.categories[cat]] : Object.values(userBag.categories);
              for (const bucket of buckets) {
                for (const raw of bucket) {
                  const e = normalizeBagEntry(raw);
                  if (e) names.push(e.name);
                }
              }
            }
            suggestions = pick(names);
          } else if ((sub === 'remove' || sub === 'removecategory') && focused.name === 'category') {
            const bags = loadBags();
            const userBag = bags[interaction.user.id];
            suggestions = pick(Object.keys(userBag?.categories ?? {}));
          }
        }


        else if (cmd === 'companion') {
          const sub2 = interaction.options.getSubcommand(false);
          if (focused.name === 'name') {
            suggestions = pick(companionDatabase.map(c => c.name));
          } else if (focused.name === 'base') {
            const custom = interaction.options.getBoolean('custom');
            if (custom) suggestions = pick(Object.values(bestiaryDatabase ?? {}).map(m => m?.name).filter(Boolean));
            else suggestions = pick(companionDatabase.map(c => c.name));
          } else if (focused.name === 'companion') {
            const characters = loadCharacters();
            // If the user has partially filled the character: field, use that
            // character's companions; otherwise default to the active one.
            const charArg = interaction.options.getString('character');
            const { char: ce } = resolveChar(interaction.user.id, charArg, characters);
            const comps = ce?.companions ? Object.values(ce.companions).map(c => c.displayName) : [];
            suggestions = pick(comps);
          } else if (focused.name === 'character') {
            const characters = loadCharacters();
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          }
        }
        else if (cmd === 'char' && interaction.options.getSubcommand(false) === 'feat') {
          if (focused.name === 'character') {
            const characters = loadCharacters();
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          } else if (focused.name === 'name') {
            // Suggest from feat database (full list is ~5000, filter by typed input)
            const q = String(focused.value ?? '').toLowerCase();
            if (q.length >= 2 && typeof featDatabase !== 'undefined') {
              suggestions = pick(featDatabase.filter(f => f.name && f.name.toLowerCase().includes(q)).map(f => f.name));
            }
          }
        }
        else if (cmd === 'init' && focused.name === 'companion') {
          const characters = loadCharacters();
          const { char: ce } = resolveChar(interaction.user.id, null, characters);
          const comps = ce?.companions ? Object.values(ce.companions).map(c => c.displayName) : [];
          suggestions = pick(comps);
        }
        return interaction.respond(suggestions);
      } catch (err) {
        console.error('Autocomplete error:', err);
        // Discord requires a response; empty array is fine as a fallback.
        // Use await so async errors here are caught by the surrounding try.
        try { await interaction.respond([]); } catch (innerErr) {
          // Interaction expired or was already responded to. Just log and move on —
          // do NOT throw, or it'll crash the process.
          console.error('Autocomplete fallback also failed:', innerErr.message);
        }
      }
    }
    return;
  }
  const { commandName } = interaction;

  // ─── /ping ───────────────────────────────────────────────────────
  if (commandName === 'ping') {
    await interaction.reply('Pong! 🏓 Bot is alive and running.');
  }

  // ─── /char ───────────────────────────────────────────────────────
  else if (commandName === 'char') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {

      // If a companion: option is specified, add the user's companion to init
      // as an NPC-controlled combatant with scaled stats.
      const compArg = interaction.options.getString('companion');
      if (compArg) {
        const characters = loadCharacters();
        const { error: cerr, char: ce } = resolveChar(userId, null, characters);
        if (cerr) return interaction.reply({ content: cerr, ephemeral: true });
        if (!ce.companions || Object.keys(ce.companions).length === 0) return interaction.reply({ content: `❌ **${ce.data.name}** has no companions. Add one with \`/companion add\`.`, ephemeral: true });
        const compKey = compArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const comp = ce.companions[compKey] ?? (compArg === 'active' || compArg === '' ? ce.companions[ce.activeCompanion] : null);
        if (!comp) return interaction.reply({ content: `❌ No companion "${compArg}" found for **${ce.data.name}**.`, ephemeral: true });
        const scaled = scaleCompanion(comp, ce.data);
        const initBonus = interaction.options.getInteger('bonus') ?? 0;
        // Companions usually use Perception for initiative — use wis as approximation
        const wisMod = scaled.abilities.wis ?? 0;
        const initMod = scaled.form === 'young' ? (ce.data.level ?? 1) + wisMod : (scaled.form === 'mature' ? (ce.data.level ?? 1) + 2 + wisMod : (ce.data.level ?? 1) + 4 + wisMod);
        const initRoll = Math.floor(Math.random() * 20) + 1 + initMod + initBonus;
        const addResult = addCombatant(channelId, {
          name: comp.displayName,
          initiative: initRoll,
          hp: comp.currentHp ?? scaled.maxHp,
          maxHp: scaled.maxHp,
          ac: scaled.ac,
          ownerId: userId,
          isNpc: false,
          companionOf: ce.data.name,
        });
        if (!addResult) return interaction.reply({ content: '❌ Could not add companion to initiative.', ephemeral: true });
        await interaction.reply({ content: `🐾 **${comp.displayName}** (${ce.data.name}'s ${comp.form} companion) joins combat with initiative **${initRoll}**! (HP ${comp.currentHp ?? scaled.maxHp}/${scaled.maxHp} · AC ${scaled.ac})` });
        await updateSummary(interaction.channel, enc);
        return;
      }
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('file');
      if (!attachment.name.endsWith('.json')) return interaction.editReply('Please attach a `.json` file exported from Pathbuilder.');
      try {
        const response = await fetch(attachment.url);
        const data = await response.json();
        const char = data.build ?? data;
        if (!char || !char.name) return interaction.editReply('Could not read that file.');
        const characters = loadCharacters();
        const userId = interaction.user.id;
        if (!characters[userId]) characters[userId] = {};
        const key = char.name.toLowerCase().replace(/\s+/g, '-');
        const existingArt    = characters[userId][key]?.art ?? null;
        const existingSenses = characters[userId][key]?.senses ?? null;
        characters[userId][key] = { name: char.name, data: char, art: existingArt, senses: existingSenses, saved: new Date().toISOString() };
        saveCharacters(characters);
        await interaction.editReply(`✅ **${char.name}** saved! Use \`/sheet\` to view them.`);
      } catch (err) { console.error(err); await interaction.editReply('Something went wrong reading that file. Try again!'); }
    }

    else if (sub === 'update') {
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('file');
      if (!attachment.name.endsWith('.json')) return interaction.editReply('Please attach a `.json` file exported from Pathbuilder.');
      try {
        const response = await fetch(attachment.url);
        const data = await response.json();
        const char = data.build ?? data;
        if (!char || !char.name) return interaction.editReply('Could not read that file.');
        const characters = loadCharacters();
        const userId = interaction.user.id;
        const key = char.name.toLowerCase().replace(/\s+/g, '-');
        if (!characters[userId]?.[key]) return interaction.editReply(`Couldn't find **${char.name}**. Use \`/char add\` first.`);

        // Preserve ALL bot-managed overlay fields across the update so hero
        // points, XP, HP, notes etc. aren't wiped by the re-import.
        const prev = characters[userId][key];
        const preserved = {
          art: prev.art ?? null,
          senses: prev.senses ?? null,
          heroPoints: prev.heroPoints,
          xp: prev.xp,
          xpLog: prev.xpLog,
          hp: prev.hp,
          overlay: prev.overlay,
        };

        characters[userId][key] = { name: char.name, data: char, saved: new Date().toISOString(), ...preserved };

        // Clamp current HP to new max if the sheet update lowered the max for any reason.
        // Recompute max from the new sheet data.
        if (typeof preserved.hp === 'number') {
          const newMax = computeCharMaxHp(characters[userId][key]);
          if (newMax > 0 && preserved.hp > newMax) {
            characters[userId][key].hp = newMax;
          }
        }

        saveCharacters(characters);
        await interaction.editReply(`✅ **${char.name}** updated to level ${char.level}! *(hero points, XP, current HP, and bag preserved.)*`);
      } catch (err) { console.error(err); await interaction.editReply('Something went wrong. Try again!'); }
    }

    // /char import id:<n>
    // Fetch character directly from Pathbuilder's server using their 6-digit
    // reference code. Much easier for mobile Discord users than "download JSON,
    // re-upload to Discord". IDs expire after about 24 hours.
    else if (sub === 'import') {
      await interaction.deferReply();
      const id = interaction.options.getInteger('id');
      if (!id || id < 1) return interaction.editReply('❌ Invalid ID. Get a 6-digit code from Pathbuilder via Menu → Export JSON.');
      try {
        const url = `https://pathbuilder2e.com/json.php?id=${encodeURIComponent(id)}`;
        const response = await fetch(url);
        if (!response.ok) return interaction.editReply(`❌ Couldn't reach Pathbuilder (HTTP ${response.status}). Try again in a minute.`);
        const payload = await response.json();
        // Pathbuilder returns { success: false } for expired or invalid IDs.
        if (!payload.success) {
          return interaction.editReply(
            `❌ Pathbuilder says ID **${id}** isn't valid. IDs expire after about 24 hours — generate a fresh one:\n` +
            `1. Open Pathbuilder\n2. Menu → **Export JSON**\n3. Use the new 6-digit code here.`,
          );
        }
        const char = payload.build;
        if (!char || !char.name) return interaction.editReply('❌ Got a response, but no character data in it. Try again with a fresh ID.');

        const characters = loadCharacters();
        const userId = interaction.user.id;
        if (!characters[userId]) characters[userId] = {};
        const key = char.name.toLowerCase().replace(/\s+/g, '-');
        // Preserve art/senses if the character already existed
        const existingArt    = characters[userId][key]?.art ?? null;
        const existingSenses = characters[userId][key]?.senses ?? null;
        characters[userId][key] = { name: char.name, data: char, art: existingArt, senses: existingSenses, saved: new Date().toISOString() };
        saveCharacters(characters);
        await interaction.editReply(`✅ **${char.name}** imported from Pathbuilder (ID ${id}). Use \`/sheet\` to view them.`);
      } catch (err) {
        console.error('/char import error:', err);
        await interaction.editReply('❌ Something went wrong fetching from Pathbuilder. Double-check the ID is correct and try again.');
      }
    }

    // /char sync id:<n>
    // Same as /char update, but pulls from Pathbuilder by ID instead of file
    // upload. Preserves hero points, XP, HP, xpLog, overlay — same as update.
    else if (sub === 'sync') {
      await interaction.deferReply();
      const id = interaction.options.getInteger('id');
      if (!id || id < 1) return interaction.editReply('❌ Invalid ID. Get a 6-digit code from Pathbuilder via Menu → Export JSON.');
      try {
        const url = `https://pathbuilder2e.com/json.php?id=${encodeURIComponent(id)}`;
        const response = await fetch(url);
        if (!response.ok) return interaction.editReply(`❌ Couldn't reach Pathbuilder (HTTP ${response.status}). Try again in a minute.`);
        const payload = await response.json();
        if (!payload.success) {
          return interaction.editReply(
            `❌ Pathbuilder says ID **${id}** isn't valid. IDs expire after about 24 hours — generate a fresh one:\n` +
            `1. Open Pathbuilder\n2. Menu → **Export JSON**\n3. Use the new 6-digit code here.`,
          );
        }
        const char = payload.build;
        if (!char || !char.name) return interaction.editReply('❌ Got a response, but no character data in it. Try again with a fresh ID.');

        const characters = loadCharacters();
        const userId = interaction.user.id;
        const key = char.name.toLowerCase().replace(/\s+/g, '-');
        if (!characters[userId]?.[key]) return interaction.editReply(`❌ Couldn't find **${char.name}** in your saved characters. Use \`/char import\` first to add them, then \`/char sync\` on future updates.`);

        // Preserve bot-managed overlay state across the update (same pattern as /char update).
        const prev = characters[userId][key];
        const preserved = {
          art: prev.art ?? null,
          senses: prev.senses ?? null,
          heroPoints: prev.heroPoints,
          xp: prev.xp,
          xpLog: prev.xpLog,
          hp: prev.hp,
          overlay: prev.overlay,
        };
        characters[userId][key] = { name: char.name, data: char, saved: new Date().toISOString(), ...preserved };
        // Clamp current HP to new max if the sheet changed.
        if (typeof preserved.hp === 'number') {
          const newMax = computeCharMaxHp(characters[userId][key]);
          if (newMax > 0 && preserved.hp > newMax) {
            characters[userId][key].hp = newMax;
          }
        }
        saveCharacters(characters);
        await interaction.editReply(`✅ **${char.name}** synced to level ${char.level} from Pathbuilder (ID ${id}). *(hero points, XP, current HP, and bag preserved.)*`);
      } catch (err) {
        console.error('/char sync error:', err);
        await interaction.editReply('❌ Something went wrong fetching from Pathbuilder. Double-check the ID is correct and try again.');
      }
    }

    else if (sub === 'remove') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      const charKey = interaction.options.getString('name').toLowerCase().replace(/\s+/g, '-');
      if (!characters[userId]?.[charKey]) {
        const names = Object.keys(characters[userId] ?? {}).filter(k => !k.startsWith('_')).map(k => characters[userId][k].name).join(', ');
        return interaction.reply(`Couldn't find that character. Your characters: ${names}`);
      }
      const name = characters[userId][charKey].name;
      delete characters[userId][charKey];
      // If the removed character was the active one, clear that pointer.
      if (characters[userId]._activeChar === charKey) delete characters[userId]._activeChar;
      saveCharacters(characters);
      await interaction.reply(`✅ **${name}** has been removed.`);
    }

    else if (sub === 'list') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      const userChars = characters[userId] ?? {};
      const charKeys = Object.keys(userChars).filter(k => !k.startsWith('_'));
      if (charKeys.length === 0)
        return interaction.reply('You have no saved characters! Use `/char add` to add one.');
      const activeKey = userChars._activeChar;
      const list = charKeys.map(k => {
        const c = userChars[k];
        const activeTag = k === activeKey ? ' 📌 *(active)*' : '';
        const artTag = c.art ? ' 🖼️' : '';
        return `• **${c.name}**${activeTag}${artTag}`;
      }).join('\n');
      await interaction.reply(`Your characters:\n${list}`);
    }

    else if (sub === 'feats') {
      await interaction.deferReply();
      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('name'), characters);
      if (error) return interaction.editReply(error);
      const c = charEntry.data;
      const allFeats = (c.feats ?? []).map(f => Array.isArray(f) ? f[0] : f).filter(Boolean);
      const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(`✨ ${c.name}'s Feats`).setDescription(allFeats.length > 0 ? allFeats.join('\n') : 'No feats found');
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      await interaction.editReply({ embeds: [embed] });
    }

    else if (sub === 'art') {
      const url = interaction.options.getString('url');
      const characters = loadCharacters();
      const { error, charKey } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      if (!url.startsWith('http://') && !url.startsWith('https://')) return interaction.reply({ content: "That doesn't look like a valid URL.", ephemeral: true });
      characters[interaction.user.id][charKey].art = url;
      saveCharacters(characters);
      const charName = characters[interaction.user.id][charKey].name;
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x7289DA).setTitle(`✅ Art set for ${charName}`).setThumbnail(url).setDescription('Character art updated!')] });
    }

    else if (sub === 'info') {
      const field = interaction.options.getString('field');
      const value = interaction.options.getString('value');
      const nameArg = interaction.options.getString('character');
      const characters = loadCharacters();
      const { error, charKey } = resolveChar(interaction.user.id, nameArg, characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      const parsed = value.split(',').map(v => v.trim()).filter(Boolean);
      characters[interaction.user.id][charKey][field] = parsed;
      saveCharacters(characters);
      const charName = characters[interaction.user.id][charKey].name;
      const fieldLabel = field.charAt(0).toUpperCase() + field.slice(1);
      await interaction.reply({ content: `✅ **${fieldLabel}** updated for **${charName}**:\n${parsed.join(', ')}`, ephemeral: true });
    }

    // ── /char active ──
    // Set (or clear, or view) the user's active/default character. When set,
    // any command that takes a `character:` option will fall through to this
    // character if the user doesn't specify one. Per-user, applies globally.
    else if (sub === 'active') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      if (!characters[userId] || Object.keys(characters[userId]).filter(k => !k.startsWith('_')).length === 0) {
        return interaction.reply({ content: 'You have no saved characters! Use `/char add` to add one.', ephemeral: true });
      }
      const nameArg = interaction.options.getString('character');
      const action = interaction.options.getString('action'); // optional: 'clear' or null

      // /char active action:clear
      if (action === 'clear') {
        delete characters[userId]._activeChar;
        saveCharacters(characters);
        return interaction.reply({ content: `✅ Active character cleared. Commands will now prompt you to choose when you have multiple characters.`, ephemeral: true });
      }

      // /char active (no args) — view current active
      if (!nameArg) {
        const activeKey = characters[userId]._activeChar;
        if (activeKey && characters[userId][activeKey]) {
          const name = characters[userId][activeKey].name;
          return interaction.reply({ content: `📌 Active character: **${name}**\n*Use \`/char active character:<n>\` to change, or \`/char active action:clear\` to clear.*`, ephemeral: true });
        } else {
          const names = Object.keys(characters[userId]).filter(k => !k.startsWith('_')).map(k => characters[userId][k].name).join(', ');
          return interaction.reply({ content: `📌 No active character set.\n*Your characters: ${names}*\n*Use \`/char active character:<n>\` to set one.*`, ephemeral: true });
        }
      }

      // /char active character:<n> — set active
      const charKey = nameArg.toLowerCase().replace(/\s+/g, '-');
      if (!characters[userId][charKey]) {
        const names = Object.keys(characters[userId]).filter(k => !k.startsWith('_')).map(k => characters[userId][k].name).join(', ');
        return interaction.reply({ content: `❌ Couldn't find **${nameArg}**.\nYour characters: ${names}`, ephemeral: true });
      }
      characters[userId]._activeChar = charKey;
      saveCharacters(characters);
      const charName = characters[userId][charKey].name;
      return interaction.reply({ content: `📌 Active character set to **${charName}**. Commands will default to them when no \`character:\` is specified.`, ephemeral: true });
    }

    else if (sub === 'feat') {
      const action = interaction.options.getString('action'); // add or remove
      const featName = interaction.options.getString('name');
      const featLevel = interaction.options.getInteger('level') ?? charEntry.data?.level ?? 1;
      const userId = interaction.user.id;
      const characters2 = loadCharacters();
      const { error: e2, charKey: ck2, char: ce2 } = resolveChar(userId, interaction.options.getString('character'), characters2);
      if (e2) return interaction.reply({ content: e2, ephemeral: true });
      if (!ce2.data.feats) ce2.data.feats = [];
      if (action === 'add') {
        // Pathbuilder stores feats as arrays: [name, sourceText, level, ...]
        ce2.data.feats.push([featName, '', featLevel, '']);
        characters2[userId][ck2] = ce2;
        saveCharacters(characters2);
        return interaction.reply({ content: `✅ Added feat **${featName}** (level ${featLevel}) to **${ce2.data.name}**.` });
      }
      if (action === 'remove') {
        const before = ce2.data.feats.length;
        ce2.data.feats = ce2.data.feats.filter(f => {
          const name = Array.isArray(f) ? f[0] : (f.name ?? f);
          return String(name).toLowerCase() !== featName.toLowerCase();
        });
        if (ce2.data.feats.length === before) return interaction.reply({ content: `❌ Feat "${featName}" not found on **${ce2.data.name}**.`, ephemeral: true });
        characters2[userId][ck2] = ce2;
        saveCharacters(characters2);
        return interaction.reply({ content: `🗑️ Removed feat **${featName}** from **${ce2.data.name}**.` });
      }
      if (action === 'list') {
        const feats = ce2.data.feats ?? [];
        if (feats.length === 0) return interaction.reply({ content: `**${ce2.data.name}** has no feats recorded.`, ephemeral: true });
        const lines = feats.map(f => {
          if (Array.isArray(f)) return `• **${f[0]}** ${f[2] ? '*(lvl ' + f[2] + ')*' : ''}`;
          return `• **${f.name ?? f}**`;
        });
        const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle(`📜 ${ce2.data.name}'s Feats`).setDescription(lines.join('\n').slice(0, 4000));
        return interaction.reply({ embeds: [embed] });
      }
    }
  }

  // ─── /sheet ──────────────────────────────────────────────────────
  else if (commandName === 'sheet') {
    await interaction.deferReply();
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const nameArg = interaction.options.getString('name');
    const { error, charKey, char: charEntry } = resolveChar(userId, nameArg, characters);
    if (error) return interaction.editReply(error);
    try {
      const c = charEntry.data;
      const lvl = c.level ?? 1;
      const ab = c.abilities ?? {};
      const prof = c.proficiencies ?? {};
      const currentXP = getCharacterXp(charEntry);
      const xpDisplay = `${currentXP} / ${xpToNextLevel(lvl)} XP`;
      const conMod = Math.floor(((ab.con ?? 10) - 10) / 2);
      const totalHP = (c.attributes?.ancestryhp ?? 0) + (c.attributes?.classhp ?? 0) + ((c.attributes?.bonushp ?? 0) * lvl) + (conMod * lvl);
      // If the bot has been tracking HP (via /hp), show current/max; otherwise just max.
      const currentHP = getCharacterHp(charEntry);
      const hpDisplay = (currentHP < totalHP) ? `${currentHP}/${totalHP}` : `${totalHP}`;
      const profBonus = Math.floor(lvl / 4) + 2;
      const wisMod = Math.floor(((ab.wis ?? 10) - 10) / 2);
      const percMod = wisMod + calcProfNum(prof.perception ?? 0, lvl);
      let spellAttackBonus = null, spellDC = null;
      if (c.spellCasters?.length > 0) {
        const caster = c.spellCasters[0];
        const tradAbilMap = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
        const traditionProfMap = { arcane: 'castingArcane', divine: 'castingDivine', occult: 'castingOccult', primal: 'castingPrimal' };
        const tradKey = traditionProfMap[caster.magicTradition?.toLowerCase()] ?? 'castingArcane';
        const keyAbility = caster.ability?.toLowerCase() ?? tradAbilMap[caster.magicTradition?.toLowerCase()] ?? 'int';
        const keyMod = Math.floor(((ab[keyAbility] ?? 10) - 10) / 2);
        const spellProfMod = calcProfNum(prof[tradKey] ?? 0, lvl);
        spellAttackBonus = keyMod + spellProfMod;
        spellDC = 10 + keyMod + spellProfMod;
      }
      const fortMod   = Math.floor(((ab.con ?? 10) - 10) / 2) + calcProfNum(prof.fortitude ?? 0, lvl);
      const reflexMod = Math.floor(((ab.dex ?? 10) - 10) / 2) + calcProfNum(prof.reflex ?? 0, lvl);
      const willMod   = Math.floor(((ab.wis ?? 10) - 10) / 2) + calcProfNum(prof.will ?? 0, lvl);
      const skillMap = {
        acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
        deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
        nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
        society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
      };
      const profIcons = { 2: '◑', 4: '●', 6: '★', 8: '⭐' };
      const trainedSkills = Object.entries(prof)
        .filter(([skill, profNum]) => skillMap[skill] && profNum > 0)
        .map(([skill, profNum]) => {
          const abilMod = Math.floor(((ab[skillMap[skill]] ?? 10) - 10) / 2);
          const total = abilMod + calcProfNum(profNum, lvl);
          return `${profIcons[profNum] || '◑'} ${skill.charAt(0).toUpperCase() + skill.slice(1)} ${fmt(total)}`;
        });
      const loreSkills = (c.lores ?? []).map(([loreName, profNum]) => {
        const intMod = Math.floor(((ab.int ?? 10) - 10) / 2);
        const total = intMod + calcProfNum(profNum, lvl);
        return `${profIcons[profNum] || '◑'} Lore: ${loreName} ${fmt(total)}`;
      });
      const allTrainedSkills = [...trainedSkills, ...loreSkills];
      const half = Math.ceil(allTrainedSkills.length / 2);
      const col1 = allTrainedSkills.slice(0, half);
      const col2 = allTrainedSkills.slice(half);
      const skillCols = col1.map((s, i) => `${s.padEnd(24)}${col2[i] ?? ''}`).join('\n');
      let attackLines = '';
      if (c.weapons?.length > 0) {
        c.weapons.forEach(w => {
          const atkBonus = w.attack ?? 0;
          const dmgBonus = w.damageBonus > 0 ? `+${w.damageBonus}` : w.damageBonus < 0 ? `${w.damageBonus}` : '';
          const dmgType = w.damageType === 'P' ? 'Piercing' : w.damageType === 'S' ? 'Slashing' : w.damageType === 'B' ? 'Bludgeoning' : w.damageType ?? '';
          attackLines += `**${w.display ?? w.name}** ${fmt(atkBonus)} to hit · ${w.die ?? '1d4'}${dmgBonus} ${dmgType}\n`;
        });
      }
      const languages = charEntry.languages ?? c.languages ?? [];
      const senses = charEntry.senses ?? [];
      const ancestryDisplay = `${c.ancestry ?? ''} ${c.heritage ?? ''}`.trim();
      const classDisplay = c.class ?? 'Unknown';
      const dualClass = c.dualClass ? ` / ${c.dualClass}` : '';
      const embed = new EmbedBuilder()
        .setColor(0x7289DA)
        .setTitle(c.name)
        .setDescription(
          `*${ancestryDisplay} · ${classDisplay}${dualClass} · Level ${lvl}*\n` +
          `**Background:** ${c.background ?? 'Unknown'} · **Deity:** ${c.deity ?? 'None'}\n` +
          `**XP:** ${xpDisplay}`
        )
        .addFields(
          { name: '⚔️ Combat Stats', value: `**AC** ${c.acTotal?.acTotal ?? '?'} · **HP** ${hpDisplay} · **Speed** ${c.attributes?.speed ?? 30} ft · **Perception** ${fmt(percMod)}\n**Prof Bonus** +${profBonus}` + (spellAttackBonus !== null ? ` · **Spell Attack** ${fmt(spellAttackBonus)} · **Spell DC** ${spellDC}` : ''), inline: false },
          { name: '💪 Ability Scores', value: `**STR** ${ab.str ?? '?'} (${getMod(ab.str ?? 10)}) · **DEX** ${ab.dex ?? '?'} (${getMod(ab.dex ?? 10)}) · **CON** ${ab.con ?? '?'} (${getMod(ab.con ?? 10)})\n**INT** ${ab.int ?? '?'} (${getMod(ab.int ?? 10)}) · **WIS** ${ab.wis ?? '?'} (${getMod(ab.wis ?? 10)}) · **CHA** ${ab.cha ?? '?'} (${getMod(ab.cha ?? 10)})`, inline: false },
          { name: '🛡️ Saving Throws', value: `**Fort** ${fmt(fortMod)} · **Reflex** ${fmt(reflexMod)} · **Will** ${fmt(willMod)}`, inline: false },
          { name: '🎯 Trained Skills', value: allTrainedSkills.length > 0 ? `\`\`\`${skillCols}\`\`\`` : 'No trained skills', inline: false },
          ...(attackLines ? [{ name: '⚔️ Attacks', value: attackLines.trim(), inline: false }] : []),
          { name: '🌐 Languages', value: languages.length > 0 ? languages.join(', ') : 'None set — use `/char info`', inline: true },
          { name: '👁️ Senses', value: senses.length > 0 ? senses.join(', ') : 'None set — use `/char info`', inline: true },
        )
        .setFooter({ text: `Pathfinder 2e · Saved ${charEntry.saved?.split('T')[0] ?? ''}` });
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      await interaction.editReply('Something went wrong. Check the terminal for details!');
    }
  }

  // ─── /portrait ─────────────────────────────────────────────────
  // Show the current active art for a character, large. Defaults to the
  // caller's active character; takes an optional `character:` arg to pick
  // one by name. If no art is set, points the user at `/char art`.
  else if (commandName === 'portrait') {
    const characters = loadCharacters();
    const nameArg = interaction.options.getString('character');
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });

    const c = charEntry.data ?? {};
    const charName = charEntry.name || c.name || 'Unknown';

    if (!charEntry.art) {
      return interaction.reply({
        content: `🖼️ **${charName}** doesn't have a portrait set yet. Use \`/char art url:<image-url> character:${charName}\` to add one.`,
        ephemeral: true,
      });
    }

    const lvl = c.level ?? '?';
    const ancestryDisplay = `${c.ancestry ?? ''} ${c.heritage ?? ''}`.trim();
    const classDisplay = c.class ?? '';
    const dualClass = c.dualClass ? ` / ${c.dualClass}` : '';
    const subtitleParts = [
      ancestryDisplay || null,
      classDisplay ? `${classDisplay}${dualClass}` : null,
      lvl !== '?' ? `Level ${lvl}` : null,
    ].filter(Boolean);
    const subtitle = subtitleParts.length ? `*${subtitleParts.join(' · ')}*` : null;

    const embed = new EmbedBuilder()
      .setColor(0x7289DA)
      .setTitle(`🖼️ ${charName}`)
      .setImage(charEntry.art);
    if (subtitle) embed.setDescription(subtitle);
    embed.setFooter({ text: 'Update with /char art · Showing current portrait' });

    await interaction.reply({ embeds: [embed] });
  }

  // ─── /snippet ─────────────────────────────────────────────────────
  // Per-user text substitutions for /roll. Create shortcuts like `sneaky`
  // = `+2d6[sneak]` so users can type `/roll 1d20+5 sneaky` instead of
  // the full expression every time.
  else if (commandName === 'snippet') {
    const sub = interaction.options.getSubcommand();
    const snippets = loadSnippets();
    const userSnippets = snippets[interaction.user.id] ?? {};

    if (sub === 'create') {
      const name = interaction.options.getString('name').trim();
      const expansion = interaction.options.getString('expand').trim();
      const nameErr = validateSnippetName(name);
      if (nameErr) return interaction.reply({ content: `❌ ${nameErr}`, ephemeral: true });
      const expErr = validateSnippetExpansion(expansion);
      if (expErr) return interaction.reply({ content: `❌ ${expErr}`, ephemeral: true });

      // Limit per-user snippet count so someone can't bloat the file.
      if (!userSnippets[name.toLowerCase()] && Object.keys(userSnippets).length >= 50) {
        return interaction.reply({ content: '❌ You\'ve reached the 50-snippet limit. Delete one with `/snippet delete` to make room.', ephemeral: true });
      }

      const existed = !!userSnippets[name.toLowerCase()];
      snippets[interaction.user.id] = { ...userSnippets, [name.toLowerCase()]: expansion };
      saveSnippets(snippets);
      // Detect arg count to give an accurate usage hint
      const argCount = (expansion.match(/%\d+/g) ?? []).length
        ? Math.max(...[...expansion.matchAll(/%(\d+)/g)].map(m => parseInt(m[1])))
        : 0;
      const usageHint = argCount > 0
        ? `Use like: \`/roll 1d20+5 ${name} ${Array.from({ length: argCount }, (_, i) => `<arg${i + 1}>`).join(' ')}\``
        : `Use like: \`/roll 1d20+5 ${name}\``;
      return interaction.reply({
        content: `${existed ? '✏️ Updated' : '✅ Created'} snippet **${name}** = \`${expansion}\`\n${usageHint}`,
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const entries = Object.entries(userSnippets);
      if (entries.length === 0) {
        return interaction.reply({
          content: '📭 You have no personal snippets yet. Create one with `/snippet create name:sneaky expand:+2d6[sneak]`\n\nTip: use `%1`, `%2`, etc. for arguments. Example: `+%1:2d6[sneak]` lets you do `/roll 1d20 sneaky 4` for 4d6.',
          ephemeral: true,
        });
      }
      entries.sort(([a], [b]) => a.localeCompare(b));
      const lines = entries.map(([n, v]) => {
        const hasArgs = /%\d+/.test(v);
        return `• **${n}**${hasArgs ? ' *(takes args)*' : ''} → \`${v}\``;
      });
      const embed = new EmbedBuilder()
        .setColor(0x7289DA)
        .setTitle(`📋 Your Snippets (${entries.length}/50)`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Use any snippet name in /roll. Snippets with args take numbers after the name.' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'view') {
      const name = interaction.options.getString('name').trim().toLowerCase();
      const expansion = userSnippets[name];
      if (!expansion) return interaction.reply({ content: `❌ No snippet named \`${name}\`.`, ephemeral: true });
      const phs = [...expansion.matchAll(/%(\d+)(?::([0-9.]+))?/g)];
      let argInfo = '';
      if (phs.length > 0) {
        const maxArg = Math.max(...phs.map(m => parseInt(m[1])));
        const argLines = [];
        for (let i = 1; i <= maxArg; i++) {
          const match = phs.find(m => parseInt(m[1]) === i);
          argLines.push(`  • \`%${i}\`${match?.[2] ? ` (default: ${match[2]})` : ' *required*'}`);
        }
        argInfo = `\n**Arguments:**\n${argLines.join('\n')}`;
      }
      return interaction.reply({
        content: `**${name}** → \`${expansion}\`${argInfo}`,
        ephemeral: true,
      });
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name').trim().toLowerCase();
      if (!userSnippets[name]) return interaction.reply({ content: `❌ No snippet named \`${name}\`.`, ephemeral: true });
      delete userSnippets[name];
      snippets[interaction.user.id] = userSnippets;
      saveSnippets(snippets);
      return interaction.reply({ content: `🗑️ Deleted snippet **${name}**.`, ephemeral: true });
    }

    return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
  }

  // ─── /serversnippet ───────────────────────────────────────────────
  // Server-wide snippets, available to everyone in the server. Creation
  // and deletion require the ManageGuild permission (typically GMs/mods).
  // Personal snippets override server snippets with the same name.
  else if (commandName === 'serversnippet') {
    if (!interaction.guildId) {
      return interaction.reply({ content: '❌ Server snippets can only be used in a server, not in DMs.', ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    const all = loadServerSnippets();
    const guildSnippets = all[interaction.guildId] ?? {};

    // Helper: can the user manage server snippets?
    const { PermissionFlagsBits } = require('discord.js');
    function canManage() {
      return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    }

    if (sub === 'create') {
      if (!canManage()) {
        return interaction.reply({ content: '🔒 Only users with the **Manage Server** permission can create server snippets.', ephemeral: true });
      }
      const name = interaction.options.getString('name').trim();
      const expansion = interaction.options.getString('expand').trim();
      const nameErr = validateSnippetName(name);
      if (nameErr) return interaction.reply({ content: `❌ ${nameErr}`, ephemeral: true });
      const expErr = validateSnippetExpansion(expansion);
      if (expErr) return interaction.reply({ content: `❌ ${expErr}`, ephemeral: true });

      if (!guildSnippets[name.toLowerCase()] && Object.keys(guildSnippets).length >= 100) {
        return interaction.reply({ content: '❌ This server has reached the 100 server-snippet limit.', ephemeral: true });
      }

      const existed = !!guildSnippets[name.toLowerCase()];
      all[interaction.guildId] = { ...guildSnippets, [name.toLowerCase()]: expansion };
      saveServerSnippets(all);
      const argCount = (expansion.match(/%\d+/g) ?? []).length
        ? Math.max(...[...expansion.matchAll(/%(\d+)/g)].map(m => parseInt(m[1])))
        : 0;
      const usageHint = argCount > 0
        ? `Anyone on this server can use: \`/roll 1d20+5 ${name} ${Array.from({ length: argCount }, (_, i) => `<arg${i + 1}>`).join(' ')}\``
        : `Anyone on this server can use: \`/roll 1d20+5 ${name}\``;
      return interaction.reply({
        content: `${existed ? '✏️ Updated' : '✅ Created'} server snippet **${name}** = \`${expansion}\`\n${usageHint}`,
      });
    }

    if (sub === 'list') {
      const entries = Object.entries(guildSnippets);
      if (entries.length === 0) {
        return interaction.reply({
          content: '📭 This server has no snippets yet. A GM can create one with `/serversnippet create`.',
          ephemeral: true,
        });
      }
      entries.sort(([a], [b]) => a.localeCompare(b));
      const lines = entries.map(([n, v]) => {
        const hasArgs = /%\d+/.test(v);
        return `• **${n}**${hasArgs ? ' *(takes args)*' : ''} → \`${v}\``;
      });
      const embed = new EmbedBuilder()
        .setColor(0x43B581)
        .setTitle(`📋 ${interaction.guild?.name ?? 'Server'} Snippets (${entries.length}/100)`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Everyone on this server can use these. Personal snippets override same-name server snippets.' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'view') {
      const name = interaction.options.getString('name').trim().toLowerCase();
      const expansion = guildSnippets[name];
      if (!expansion) return interaction.reply({ content: `❌ No server snippet named \`${name}\`.`, ephemeral: true });
      const phs = [...expansion.matchAll(/%(\d+)(?::([0-9.]+))?/g)];
      let argInfo = '';
      if (phs.length > 0) {
        const maxArg = Math.max(...phs.map(m => parseInt(m[1])));
        const argLines = [];
        for (let i = 1; i <= maxArg; i++) {
          const match = phs.find(m => parseInt(m[1]) === i);
          argLines.push(`  • \`%${i}\`${match?.[2] ? ` (default: ${match[2]})` : ' *required*'}`);
        }
        argInfo = `\n**Arguments:**\n${argLines.join('\n')}`;
      }
      return interaction.reply({
        content: `**${name}** → \`${expansion}\`${argInfo}`,
        ephemeral: true,
      });
    }

    if (sub === 'delete') {
      if (!canManage()) {
        return interaction.reply({ content: '🔒 Only users with the **Manage Server** permission can delete server snippets.', ephemeral: true });
      }
      const name = interaction.options.getString('name').trim().toLowerCase();
      if (!guildSnippets[name]) return interaction.reply({ content: `❌ No server snippet named \`${name}\`.`, ephemeral: true });
      delete guildSnippets[name];
      all[interaction.guildId] = guildSnippets;
      saveServerSnippets(all);
      return interaction.reply({ content: `🗑️ Deleted server snippet **${name}**.` });
    }

    return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
  }

  // ─── /spellbook ──────────────────────────────────────────────────
  else if (commandName === 'spellbook') {
    await interaction.deferReply();
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('name'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    if (!c.spellCasters?.length) return interaction.editReply(`**${c.name}** has no spellcasting!`);

    charOverlay.ensureOverlay(charEntry);
    const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`🔮 ${c.name}'s Spellbook`);
    if (charEntry.art) embed.setThumbnail(charEntry.art);

    for (const caster of c.spellCasters) {
      const merged = charOverlay.getMergedSpellbook(charEntry, caster.name);
      if (!merged) continue;

      // Mark overlay-added spells with ✨
      const fmtList = (names) =>
        names.map(n => merged.overlayNames.has(n) ? `${n} ✨` : n).join(', ');

      const sections = [];
      if (merged.cantrips.length) {
        sections.push(`**Cantrips:** ${fmtList(merged.cantrips)}`);
      }
      const ranks = Object.keys(merged.ranks).map(Number).sort((a, b) => a - b);
      for (const rank of ranks) {
        const spellList = merged.ranks[rank];
        if (!spellList.length) continue;
        // Slot counter: show only if perDay has a positive number at this rank
        const max = Number(caster.perDay?.[rank] ?? 0);
        let slotSuffix = '';
        if (max > 0) {
          const { current } = charOverlay.getSlotsRemaining(charEntry, caster.name, rank);
          slotSuffix = ` *(${current}/${max} slots)*`;
        }
        sections.push(`**Rank ${rank}${slotSuffix}:** ${fmtList(spellList)}`);
      }

      // Prepared override — display today's prepared list separately for prepared casters
      const overlay = charEntry.overlay;
      const prepList = overlay.prepared_override?.[caster.name] ?? [];
      if (caster.spellcastingType === 'prepared' && prepList.length) {
        const byRank = {};
        for (const p of prepList) {
          (byRank[p.rank] = byRank[p.rank] ?? []).push(p.spell);
        }
        const lines = Object.keys(byRank).map(Number).sort((a, b) => a - b)
          .map(r => `Rank ${r}: ${byRank[r].join(', ')}`);
        sections.push(`**📋 Prepared today:**\n${lines.join('\n')}`);
      }

      const body = sections.join('\n') || '*No spells known.*';
      const casterType = caster.spellcastingType || 'unknown';
      const innateTag = caster.innate ? ' · innate' : '';
      const header = `${caster.name} (${caster.magicTradition} · ${casterType}${innateTag})`;
      embed.addFields({ name: header, value: body.slice(0, 1024), inline: false });
    }

    // Focus spells at the bottom (separate system in Pathbuilder)
    const focus = c.focus ?? {};
    const focusLines = [];
    for (const [tradition, byAbility] of Object.entries(focus)) {
      for (const [ability, fdata] of Object.entries(byAbility)) {
        const spells = [...(fdata.focusCantrips ?? []), ...(fdata.focusSpells ?? [])];
        if (spells.length) {
          focusLines.push(`**${tradition.charAt(0).toUpperCase() + tradition.slice(1)} (${ability.toUpperCase()}):** ${spells.join(', ')}`);
        }
      }
    }
    if (focusLines.length) {
      const { current, max } = charOverlay.getCurrentFocus(charEntry);
      embed.addFields({
        name: `🌟 Focus Spells (${current}/${max} points)`,
        value: focusLines.join('\n').slice(0, 1024),
        inline: false,
      });
    }

    embed.setFooter({ text: '✨ = added via /spells · /cast <spell> to cast · /rest to refresh' });
    saveCharacters(characters);
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── /spell ──────────────────────────────────────────────────────
  else if (commandName === 'spell') {
    await interaction.deferReply();
    const spell = findSpell(interaction.options.getString('name'));
    if (!spell) return interaction.editReply(`Couldn't find that spell. Check the spelling and try again!`);
    await interaction.editReply({ embeds: [buildSpellEmbed(spell)] });
  }

  // ─── /cast ───────────────────────────────────────────────────────
  else if (commandName === 'cast') {
    await interaction.deferReply();
    const spellName = interaction.options.getString('spell');
    const nameArg   = interaction.options.getString('character');
    const castLevel = interaction.options.getInteger('level') ?? null;
    const targetName = interaction.options.getString('target');
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.editReply(error);
    const rawSpell = findSpell(spellName);
    if (!rawSpell) return interaction.editReply(`Couldn't find a spell called **${spellName}**. Check the spelling and try again!`);
    const spell = normalizeSpell(rawSpell);
    const c = charEntry.data;
    const ab = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl = c.level ?? 1;
    const traditionProfMap = { arcane: 'castingArcane', divine: 'castingDivine', occult: 'castingOccult', primal: 'castingPrimal' };
    const tradAbilMap = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
    let keyAbility = 'int', spellProfNum = 2;
    if (c.spellCasters?.length > 0) {
      const spellTraditions = spell.traditions.map(t => t.toLowerCase());
      const caster = c.spellCasters.find(sc => spellTraditions.includes(sc.magicTradition?.toLowerCase())) ?? c.spellCasters[0];
      const tradKey = traditionProfMap[caster.magicTradition?.toLowerCase()] ?? 'castingArcane';
      spellProfNum = prof[tradKey] ?? 2;
      keyAbility = caster.ability?.toLowerCase() ?? tradAbilMap[caster.magicTradition?.toLowerCase()] ?? 'int';
    }
    const keyMod = Math.floor(((ab[keyAbility] ?? 10) - 10) / 2);
    const spellAttackBonus = keyMod + calcProfNum(spellProfNum, lvl);
    const spellDC = 10 + keyMod + calcProfNum(spellProfNum, lvl);
    const isAttackSpell = !!spell.attack;
    const saveType = spell.savingThrow ?? null;
    const effectiveLevel = castLevel ?? spell.level ?? 1;
    const isCantrip = spell.type === 'Cantrip';
    const levelDisplay = isCantrip ? `Cantrip ${effectiveLevel}` : `Level ${effectiveLevel}`;
    const traditionDisplay = spell.traditions?.[0] ?? '';

    // ── Overlay-aware slot tracking ──
    // Find which caster is actually casting (same match as above).
    charOverlay.ensureOverlay(charEntry);
    let castingCaster = null;
    if (c.spellCasters?.length > 0) {
      const spellTraditions = spell.traditions.map(t => t.toLowerCase());
      castingCaster = c.spellCasters.find(sc => spellTraditions.includes(sc.magicTradition?.toLowerCase())) ?? c.spellCasters[0];
    }
    // Non-cantrips consume slots. Cantrips and focus spells are at-will.
    const consumesSlot = !isCantrip && castingCaster && effectiveLevel > 0;
    const warnings = [];
    if (consumesSlot) {
      const slots = charOverlay.getSlotsRemaining(charEntry, castingCaster.name, effectiveLevel);
      if (slots && slots.max > 0 && slots.current <= 0) {
        warnings.push(`⚠️ ${castingCaster.name} has no rank ${effectiveLevel} slots remaining (0/${slots.max}). Casting anyway — use \`/rest\` to refresh, or this might be from a wand/scroll/staff.`);
      } else if (slots && slots.max === 0) {
        warnings.push(`⚠️ ${castingCaster.name} has no rank ${effectiveLevel} slots at all. Casting anyway — this is likely a scroll, wand, or higher-rank slot use.`);
      }
      // Prepared-caster check: warn if spell isn't on today's prepared list (only if they've prepared anything)
      if (castingCaster.spellcastingType === 'prepared') {
        const overlay = charEntry.overlay;
        const prep = overlay.prepared_override?.[castingCaster.name] ?? [];
        if (prep.length > 0) {
          const hasPrep = prep.some(p =>
            Number(p.rank) === Number(effectiveLevel) &&
            (p.spell || '').toLowerCase() === spell.name.toLowerCase()
          );
          if (!hasPrep) {
            warnings.push(`⚠️ **${spell.name}** isn't on ${castingCaster.name}'s prepared list for today. Casting anyway.`);
          }
        }
      }
      // Spend the slot
      charOverlay.spendSlot(charEntry, castingCaster.name, effectiveLevel);
      saveCharacters(characters);
    }

    const channelId = interaction.channel.id;
    const enc = getEncounter(channelId);
    let target = null;
    if (targetName) {
      if (!enc) return interaction.editReply('❌ Target specified but no active encounter in this channel. Start one with `/init start`.');
      target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) return interaction.editReply(`❌ No combatant named "${targetName}" in this encounter.`);
    }

    const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`${c.name} casts ${spell.name}!`);
    if (charEntry.art) embed.setThumbnail(charEntry.art);

    let description = `*${levelDisplay}${traditionDisplay ? ` ${traditionDisplay}` : ''} spell*\n`;
    if (spell.cast)     description += `**Cast** ${spell.cast}\n`;
    if (spell.range)    description += `**Range** ${spell.range}\n`;
    if (spell.area)     description += `**Area** ${spell.area}\n`;
    if (spell.target)   description += `**Target** ${spell.target}\n`;
    if (spell.duration) description += `**Duration** ${spell.duration}\n`;
    description += '\n';

    // Look up caster's active effects if in encounter
    const casterCombatant = enc ? enc.combatants.find(x => x.name.toLowerCase() === c.name.toLowerCase()) : null;
    const casterMods = sumEffectModifiers(casterCombatant);
    const targetMods = target ? sumEffectModifiers(target) : { acBonus: 0, activeEffects: [] };

    let attackDegree = null;
    let attackDieRoll = null;
    let attackTotal = null;
    let effectiveTargetAcForSpell = null;
    if (isAttackSpell) {
      attackDieRoll = Math.floor(Math.random() * 20) + 1;
      attackTotal = attackDieRoll + spellAttackBonus + casterMods.attackBonus;
      const casterEffectText = formatEffectContributions(casterMods.activeEffects, 'attack');
      description += `**Spell Attack Roll**\n1d20 (${attackDieRoll}) ${fmt(spellAttackBonus)}${casterEffectText ? ` ${fmt(casterMods.attackBonus)}` : ''} = **${attackTotal}**`;
      if (casterEffectText) description += `\n*${casterEffectText.trim().slice(1, -1)}*`;
      if (attackDieRoll === 20) description += ' ⭐ Natural 20!';
      if (attackDieRoll === 1)  description += ' 💀 Natural 1!';
      description += '\n\n';
      if (target && target.ac !== null && target.ac !== undefined) {
        effectiveTargetAcForSpell = target.ac + targetMods.acBonus;
        attackDegree = determineDegreeOfSuccess(attackTotal, attackDieRoll, effectiveTargetAcForSpell);
      }
    }

    if (saveType) {
      if (target) description += `**${saveType.charAt(0).toUpperCase() + saveType.slice(1)} Save DC: ${spellDC}** — ${target.name} must roll \`/save type:${saveType}\`\n\n`;
      else description += `**${saveType.charAt(0).toUpperCase() + saveType.slice(1)} Save DC: ${spellDC}**\n\n`;
    }

    let damageResult = null;
    let finalDamage = 0;
    if (spell.damage && typeof spell.damage === 'string') damageResult = rollDamageExpression(spell.damage);

    if (damageResult) {
      if (isAttackSpell && target && attackDegree) {
        if (attackDegree === 'crit-success') {
          finalDamage = damageResult.total * 2;
          description += `**Damage (CRIT × 2)**\n${damageResult.display} = ${damageResult.total} × 2 = **${finalDamage}**\n`;
        } else if (attackDegree === 'success') {
          finalDamage = damageResult.total;
          description += `**Damage**\n${damageResult.display} = **${finalDamage}**\n`;
        }
      } else {
        finalDamage = damageResult.total;
        description += `**Damage:** ${damageResult.display} = **${finalDamage}**\n`;
        if (saveType && target) description += `*(On a failed save, apply ${finalDamage} damage. Crit fail = ${finalDamage * 2}, success = ${Math.floor(finalDamage / 2)}, crit success = 0)*\n`;
      }
    } else if (spell.damage) {
      description += `**Damage:** ${spell.damage}\n`;
    }

    if (isAttackSpell && target) {
      const acBreakdown = target.ac !== null && target.ac !== undefined && targetMods.acBonus !== 0
        ? ` (base ${target.ac}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAcForSpell})`
        : '';
      const displayAc = effectiveTargetAcForSpell ?? target.ac;
      if (attackDegree === 'crit-success')      description += `\n🎯 **Critical Hit on ${target.name}!** AC ${displayAc}${acBreakdown}`;
      else if (attackDegree === 'success')      description += `\n✅ **Hit on ${target.name}!** AC ${displayAc}${acBreakdown}`;
      else if (attackDegree === 'failure')      description += `\n❌ **Miss on ${target.name}.** AC ${displayAc}${acBreakdown}`;
      else if (attackDegree === 'crit-failure') description += `\n💢 **Critical Miss on ${target.name}.** AC ${displayAc}${acBreakdown}`;
      else                                       description += `\n🎯 Attack against **${target.name}** (AC unknown — GM decides)`;
    }

    if (target && isAttackSpell && (attackDegree === 'success' || attackDegree === 'crit-success') && finalDamage > 0) {
      const dmgResult = ca.applyDamage(channelId, target.name, finalDamage);
      const dyingNote = dmgResult?.displaySuffix ?? '';
      description += target.isNpc
        ? `\n❤️ **${target.name}** took ${finalDamage} damage${dyingNote}`
        : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
    }

    const shortDesc = spell.description ?? '';
    if (shortDesc && shortDesc !== '*No description available.*') {
      const desc = shortDesc.length > 300 ? shortDesc.slice(0, 300) + `...\n*Use \`/spell ${spell.name}\` for full details*` : shortDesc;
      description += `\n\n${desc}`;
    }

    embed.setDescription(description);
    // Build footer with spell attack + DC + remaining slots if relevant
    let footer = `${c.name} · Spell Attack ${fmt(spellAttackBonus)} · DC ${spellDC}`;
    if (consumesSlot && castingCaster) {
      const slotsNow = charOverlay.getSlotsRemaining(charEntry, castingCaster.name, effectiveLevel);
      if (slotsNow && slotsNow.max > 0) {
        footer += ` · Rank ${effectiveLevel} slots: ${slotsNow.current}/${slotsNow.max}`;
      }
    }
    embed.setFooter({ text: footer });

    const payload = { embeds: [embed] };
    if (warnings.length) payload.content = warnings.join('\n');
    if (target && !target.isNpc && target.ownerId) payload.content = [payload.content, `<@${target.ownerId}>`].filter(Boolean).join('\n');
    await interaction.editReply(payload);
    if (target && enc) await updateSummary(interaction.channel, enc);
  }

  // ─── /help ───────────────────────────────────────────────────────
  // Category-picker style help. Lands on the Character page by default,
  // or jumps to a specific category if `topic:` is passed.
  else if (commandName === 'help') {
    const topic = interaction.options.getString('topic');
    const startCategory = topic && HELP_CATEGORIES[topic] ? topic : 'character';
    const embed = buildHelpEmbed(startCategory);
    const row = buildHelpButtons(startCategory);
    // Public in guilds, auto-ephemeral in DMs (buttons render there just fine)
    const isDM = !interaction.guildId;
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: isDM });
  }

  // ─── /spells ─────────────────────────────────────────────────────
  // Character spellbook/repertoire/prepared management. Subcommands:
  //   learn  — permanent addition (wizards copying scrolls, witches learning)
  //   forget — remove an overlay-learned spell
  //   prepare / unprepare — today's prep for prepared casters
  //   swap   — permanent repertoire change for spontaneous casters
  //   list   — show the merged view (same as /spellbook)
  else if (commandName === 'spells') {
    const sub = interaction.options.getSubcommand();
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const c = charEntry.data;
    const casters = charOverlay.getCasters(c);
    if (!casters.length) return interaction.reply({ content: `**${c.name}** has no spellcasting!`, ephemeral: true });

    // Pick which caster to operate on. If the character has multiple casters
    // and the user didn't specify one, show a picker.
    async function pickCaster(explicitName) {
      if (explicitName) {
        const found = charOverlay.findCaster(c, explicitName);
        if (!found) {
          return { error: `No caster named "${explicitName}" on **${c.name}**. Available: ${casters.map(x => x.name).join(', ')}` };
        }
        return { caster: found };
      }
      if (casters.length === 1) return { caster: casters[0] };
      return { error: `**${c.name}** has multiple casters. Specify one with the \`caster\` option: ${casters.map(x => x.name).join(', ')}` };
    }

    // ── /spells learn ──
    if (sub === 'learn') {
      const spellName = interaction.options.getString('spell');
      const explicitCaster = interaction.options.getString('caster');
      const picked = await pickCaster(explicitCaster);
      if (picked.error) return interaction.reply({ content: picked.error, ephemeral: true });
      // Validate via spellDatabase
      const rawSpell = findSpell(spellName);
      if (!rawSpell) return interaction.reply({ content: `❌ Couldn't find a spell called **${spellName}**.`, ephemeral: true });
      const spell = normalizeSpell(rawSpell);
      const rank = spell.type === 'Cantrip' ? 0 : Number(spell.level ?? 1);
      // Tradition warning (non-blocking)
      const casterTradition = picked.caster.magicTradition?.toLowerCase() ?? '';
      const spellTraditions = (spell.traditions ?? []).map(t => t.toLowerCase());
      const traditionMismatch = spellTraditions.length && !spellTraditions.includes(casterTradition);
      const r = charOverlay.learnSpell(charEntry, picked.caster.name, spell.name, rank);
      if (!r.ok) return interaction.reply({ content: `❌ ${r.error}`, ephemeral: true });
      saveCharacters(characters);
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`📘 ${c.name} learned ${spell.name}`)
        .setDescription(`Added to **${picked.caster.name}**'s ${rank === 0 ? 'cantrips' : `rank ${rank} spells`}.`)
        .setFooter({ text: 'Use /spellbook to see the full list · /spells forget to undo' });
      if (traditionMismatch) {
        embed.addFields({
          name: '⚠️ Tradition note',
          value: `**${spell.name}** is ${spell.traditions.join('/')}. **${picked.caster.name}** casts ${picked.caster.magicTradition}. Added anyway — if you meant a different caster, use \`/spells forget\` and retry with the \`caster\` option.`,
          inline: false,
        });
      }
      return interaction.reply({ embeds: [embed] });
    }

    // ── /spells forget ──
    if (sub === 'forget') {
      const spellName = interaction.options.getString('spell');
      const explicitCaster = interaction.options.getString('caster');
      const picked = await pickCaster(explicitCaster);
      if (picked.error) return interaction.reply({ content: picked.error, ephemeral: true });
      const r = charOverlay.forgetSpell(charEntry, picked.caster.name, spellName);
      if (!r.ok) return interaction.reply({ content: `❌ ${r.error}`, ephemeral: true });
      saveCharacters(characters);
      return interaction.reply({ content: `🗑️ **${c.name}** forgot **${spellName}** (from ${picked.caster.name}).` });
    }

    // ── /spells prepare ──
    if (sub === 'prepare') {
      const spellName = interaction.options.getString('spell');
      const rank = interaction.options.getInteger('rank');
      const explicitCaster = interaction.options.getString('caster');
      const picked = await pickCaster(explicitCaster);
      if (picked.error) return interaction.reply({ content: picked.error, ephemeral: true });
      const r = charOverlay.prepareSpell(charEntry, picked.caster.name, spellName, rank);
      if (!r.ok) return interaction.reply({ content: `❌ ${r.error}`, ephemeral: true });
      saveCharacters(characters);
      const slots = charOverlay.getSlotsRemaining(charEntry, picked.caster.name, rank);
      return interaction.reply({ content: `📋 Prepared **${spellName}** at rank ${rank} for **${picked.caster.name}**. Slots filled this rank: ${r.slot_index + 1}/${slots.max || '?'}.` });
    }

    // ── /spells unprepare ──
    if (sub === 'unprepare') {
      const spellName = interaction.options.getString('spell');
      const rank = interaction.options.getInteger('rank');
      const explicitCaster = interaction.options.getString('caster');
      const picked = await pickCaster(explicitCaster);
      if (picked.error) return interaction.reply({ content: picked.error, ephemeral: true });
      const r = charOverlay.unprepareSpell(charEntry, picked.caster.name, spellName, rank);
      if (!r.ok) return interaction.reply({ content: `❌ ${r.error}`, ephemeral: true });
      saveCharacters(characters);
      return interaction.reply({ content: `🗑️ Unprepared **${spellName}** (rank ${rank}) from **${picked.caster.name}**.` });
    }

    // ── /spells swap ──
    if (sub === 'swap') {
      const removeName = interaction.options.getString('remove');
      const addName = interaction.options.getString('add');
      const rank = interaction.options.getInteger('rank');
      const explicitCaster = interaction.options.getString('caster');
      const picked = await pickCaster(explicitCaster);
      if (picked.error) return interaction.reply({ content: picked.error, ephemeral: true });
      // Validate the replacement spell exists
      const rawSpell = findSpell(addName);
      if (!rawSpell) return interaction.reply({ content: `❌ Couldn't find a spell called **${addName}** in the database.`, ephemeral: true });
      const r = charOverlay.swapRepertoire(charEntry, picked.caster.name, rank, removeName, addName);
      if (!r.ok) return interaction.reply({ content: `❌ ${r.error}`, ephemeral: true });
      saveCharacters(characters);
      return interaction.reply({ content: `🔄 **${picked.caster.name}** swapped **${removeName}** → **${addName}** (rank ${rank}).` });
    }

    // ── /spells list ──
    if (sub === 'list') {
      const explicitCaster = interaction.options.getString('caster');
      charOverlay.ensureOverlay(charEntry);
      const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`🔮 ${c.name}'s Spells`);
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      const showCasters = explicitCaster ? casters.filter(x => (x.name || '').toLowerCase() === explicitCaster.toLowerCase()) : casters;
      if (!showCasters.length) return interaction.reply({ content: `No caster named "${explicitCaster}" on **${c.name}**.`, ephemeral: true });
      for (const caster of showCasters) {
        const merged = charOverlay.getMergedSpellbook(charEntry, caster.name);
        if (!merged) continue;
        const fmtList = (names) => names.map(n => merged.overlayNames.has(n) ? `${n} ✨` : n).join(', ');
        const sections = [];
        if (merged.cantrips.length) sections.push(`**Cantrips:** ${fmtList(merged.cantrips)}`);
        for (const rank of Object.keys(merged.ranks).map(Number).sort((a, b) => a - b)) {
          const max = Number(caster.perDay?.[rank] ?? 0);
          const slotSuffix = max > 0
            ? ` *(${charOverlay.getSlotsRemaining(charEntry, caster.name, rank).current}/${max} slots)*`
            : '';
          sections.push(`**Rank ${rank}${slotSuffix}:** ${fmtList(merged.ranks[rank])}`);
        }
        const overlay = charEntry.overlay;
        const prepList = overlay.prepared_override?.[caster.name] ?? [];
        if (caster.spellcastingType === 'prepared' && prepList.length) {
          const byRank = {};
          for (const p of prepList) (byRank[p.rank] = byRank[p.rank] ?? []).push(p.spell);
          const lines = Object.keys(byRank).map(Number).sort((a, b) => a - b).map(r => `Rank ${r}: ${byRank[r].join(', ')}`);
          sections.push(`**📋 Prepared today:**\n${lines.join('\n')}`);
        }
        const casterType = caster.spellcastingType || 'unknown';
        const innateTag = caster.innate ? ' · innate' : '';
        const header = `${caster.name} (${caster.magicTradition} · ${casterType}${innateTag})`;
        embed.addFields({ name: header, value: (sections.join('\n') || '*No spells known.*').slice(0, 1024), inline: false });
      }
      embed.setFooter({ text: '✨ = added via /spells learn or /spells swap' });
      return interaction.reply({ embeds: [embed] });
    }

    return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
  }

  // ─── /rest ───────────────────────────────────────────────────────
  // Long rest: refills slots, focus, hero points → 1, clears prepared list.
  // Shows a confirmation button first so people don't wipe today's prep accidentally.
  else if (commandName === 'rest') {
    const nameArg = interaction.options.getString('character');
    const characters = loadCharacters();
    const { error, char: charEntry, charKey } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    charOverlay.ensureOverlay(charEntry);
    // Summarize what's going to change
    const overlay = charEntry.overlay;
    const preparedCount = Object.values(overlay.prepared_override || {}).reduce((a, list) => a + list.length, 0);
    const lines = [
      `Resting will refill all spell slots, refresh focus points to max, and reset hero points to 1.`,
    ];
    if (preparedCount > 0) lines.push(`⚠️ This will also **clear ${preparedCount} prepared spell(s)** from today's prep list.`);
    const confirmEmbed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`🌙 Rest — ${charEntry.data.name}?`)
      .setDescription(lines.join('\n'));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rest_confirm_${interaction.user.id}_${charKey}`).setLabel('Proceed').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rest_cancel_${interaction.user.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true });
  }

  // ─── /refocus ────────────────────────────────────────────────────
  else if (commandName === 'refocus') {
    const nameArg = interaction.options.getString('character');
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const before = charOverlay.getCurrentFocus(charEntry);
    if (before.max === 0) return interaction.reply({ content: `**${charEntry.data.name}** has no focus pool.`, ephemeral: true });
    if (before.current >= before.max) return interaction.reply({ content: `**${charEntry.data.name}**'s focus pool is already full (${before.current}/${before.max}).`, ephemeral: true });
    const after = charOverlay.refocus(charEntry, 1);
    saveCharacters(characters);
    return interaction.reply({ content: `🌀 **${charEntry.data.name}** refocuses. Focus points: ${after.current}/${after.max}.` });
  }

  // ─── /resource ───────────────────────────────────────────────────
  else if (commandName === 'resource') {
    const sub = interaction.options.getSubcommand();
    const nameArg = interaction.options.getString('character');
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const c = charEntry.data;
    charOverlay.ensureOverlay(charEntry);

    if (sub === 'show') {
      const focus = charOverlay.getCurrentFocus(charEntry);
      const hero = charOverlay.getHeroPoints(charEntry);
      const lines = [
        `**🌟 Focus points:** ${focus.current}/${focus.max}`,
        `**⭐ Hero points:** ${hero}/3`,
      ];
      for (const caster of charOverlay.getCasters(c)) {
        const rankLines = [];
        for (let rank = 1; rank <= 10; rank++) {
          const max = Number(caster.perDay?.[rank] ?? 0);
          if (max === 0) continue;
          const { current } = charOverlay.getSlotsRemaining(charEntry, caster.name, rank);
          rankLines.push(`  Rank ${rank}: ${current}/${max}`);
        }
        if (rankLines.length) {
          lines.push(`**${caster.name} slots:**\n${rankLines.join('\n')}`);
        }
      }
      const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle(`${c.name}'s Daily Resources`).setDescription(lines.join('\n'));
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      embed.setFooter({ text: 'Use /rest to refill · /refocus for 1 focus point · /resource set to override' });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'set') {
      const resource = interaction.options.getString('resource');
      const value = interaction.options.getInteger('value');
      const rank = interaction.options.getInteger('rank');
      const explicitCaster = interaction.options.getString('caster');
      if (resource === 'focus') {
        const max = charOverlay.getMaxFocus(c);
        const clamped = Math.max(0, Math.min(max, value));
        charEntry.overlay.daily.focus_spent = max - clamped;
        saveCharacters(characters);
        return interaction.reply({ content: `🌟 Focus points set to ${clamped}/${max}.` });
      }
      if (resource === 'hero') {
        const v = charOverlay.setHeroPoints(charEntry, value);
        saveCharacters(characters);
        return interaction.reply({ content: `⭐ Hero points set to ${v}/3.` });
      }
      if (resource === 'slot') {
        if (rank === null || rank === undefined) return interaction.reply({ content: '❌ The `rank` option is required when setting spell slots.', ephemeral: true });
        const casters = charOverlay.getCasters(c);
        const caster = explicitCaster ? charOverlay.findCaster(c, explicitCaster) : (casters.length === 1 ? casters[0] : null);
        if (!caster) return interaction.reply({ content: `❌ Specify which caster with the \`caster\` option. Available: ${casters.map(x => x.name).join(', ')}`, ephemeral: true });
        const max = Number(caster.perDay?.[rank] ?? 0);
        const clamped = Math.max(0, Math.min(max, value));
        if (!charEntry.overlay.daily.slots_used[caster.name]) charEntry.overlay.daily.slots_used[caster.name] = {};
        charEntry.overlay.daily.slots_used[caster.name][rank] = max - clamped;
        saveCharacters(characters);
        return interaction.reply({ content: `✨ ${caster.name} rank ${rank} slots set to ${clamped}/${max}.` });
      }
      return interaction.reply({ content: '❌ Unknown resource.', ephemeral: true });
    }

    return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
  }

  // ─── /mattack ────────────────────────────────────────────────────
  else if (commandName === 'mattack') {
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;
    const enc = getEncounter(channelId);

    if (!enc) return interaction.reply({ content: '❌ No active encounter in this channel. Start one with `/init start`.', ephemeral: true });
    if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can use `/mattack`.', ephemeral: true });

    const attackerName = interaction.options.getString('attacker');
    const attackName = interaction.options.getString('name');
    const attackBonus = interaction.options.getInteger('bonus');
    const damageExpr = interaction.options.getString('damage');
    const targetName = interaction.options.getString('target');
    const damageType = (interaction.options.getString('type') ?? 'damage').toLowerCase();
    const explicitMap = interaction.options.getInteger('map'); // null if unset
    const agile = interaction.options.getBoolean('agile') ?? false;

    const attacker = enc.combatants.find(x => x.name.toLowerCase() === attackerName.toLowerCase());
    if (!attacker) return interaction.reply({ content: `❌ No combatant named "${attackerName}" in this encounter.`, ephemeral: true });

    const target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
    if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });

    const damageResult = rollDamageExpression(damageExpr);
    if (!damageResult) return interaction.reply({ content: `❌ Couldn't parse damage expression "${damageExpr}". Use something like \`1d6+2\` or \`2d8\`.`, ephemeral: true });

    const attackerMods = sumEffectModifiers(attacker);
    const targetMods = sumEffectModifiers(target);

    // Auto-MAP if not explicitly provided
    let mapPenalty, mapNoteText;
    if (explicitMap !== null) {
      mapPenalty = calculateMap(explicitMap, agile);
      mapNoteText = explicitMap > 0 ? `MAP ${mapPenalty} (manual)` : null;
    } else {
      const mapInfo = ca.computeMapForNextAttack(attacker, agile);
      mapPenalty = mapInfo.penalty;
      mapNoteText = mapInfo.noteText;
    }
    const dieRoll = Math.floor(Math.random() * 20) + 1;
    const attackTotal = dieRoll + attackBonus + mapPenalty + attackerMods.attackBonus;

    const baseTargetAc = target.ac ?? null;
    const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;
    const degree = effectiveTargetAc !== null
      ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc)
      : null;

    // Build attack line
    const mapText = mapPenalty !== 0 ? ` ${mapPenalty}` : '';
    const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
    let attackLine = `**Attack Roll**\n1d20 (${dieRoll}) ${fmt(attackBonus)}${mapText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
    if (mapNoteText) attackLine += `\n*${mapNoteText}*`;
    if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
    if (dieRoll === 20) attackLine += '\n⭐ Natural 20!';
    if (dieRoll === 1)  attackLine += '\n💀 Natural 1!';

    // Damage
    const totalDamageBonus = attackerMods.damageBonus;
    let finalDamage = Math.max(1, damageResult.total + totalDamageBonus);
    const damageContribText = formatEffectContributions(attackerMods.activeEffects, 'damage');
    let damageLine;
    if (degree === 'crit-success') {
      finalDamage = finalDamage * 2;
      damageLine = `**Damage (CRIT × 2)**\n${damageResult.display}${totalDamageBonus ? ` ${fmt(totalDamageBonus)}` : ''} = ${damageResult.total + totalDamageBonus} × 2 = **${finalDamage} ${damageType}**`;
    } else {
      damageLine = `**Damage**\n${damageResult.display}${totalDamageBonus ? ` ${fmt(totalDamageBonus)}` : ''} = **${finalDamage} ${damageType}**`;
    }
    if (damageContribText) damageLine += `\n*${damageContribText.trim().slice(1, -1)}*`;

    const acBreakdown = baseTargetAc !== null && targetMods.acBonus !== 0
      ? ` (base ${baseTargetAc}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAc})`
      : '';
    let outcomeLine;
    if (degree === 'crit-success')      outcomeLine = `🎯 **Critical Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (degree === 'success')      outcomeLine = `✅ **Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (degree === 'failure')      outcomeLine = `❌ **Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (degree === 'crit-failure') outcomeLine = `💢 **Critical Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
    else                                outcomeLine = `🎯 Attack against **${target.name}** (AC unknown — GM decides)`;

    let hpLine = '';
    let mentionLine = '';
    if (degree === 'success' || degree === 'crit-success') {
      const dmgResult = ca.applyDamage(channelId, target.name, finalDamage);
      const dyingNote = dmgResult?.displaySuffix ?? '';
      hpLine = target.isNpc
        ? `\n❤️ **${target.name}** took ${finalDamage} damage${dyingNote}`
        : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
    }
    if (!target.isNpc && target.ownerId) mentionLine = `<@${target.ownerId}>`;

    const showDamage = (degree === 'success' || degree === 'crit-success' || degree === null);
    const description = [
      attackLine,
      '',
      showDamage ? damageLine : null,
      outcomeLine,
      hpLine || null,
    ].filter(s => s !== null).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle(`👹 ${attacker.name} attacks with ${attackName}!`)
      .setDescription(description)
      .setFooter({ text: `GM attack · Attack ${fmt(attackBonus)} · ${damageExpr} ${damageType}` });

    const replyPayload = { embeds: [embed] };
    if (mentionLine) replyPayload.content = mentionLine;
    await interaction.reply(replyPayload);
    // Record attack for MAP tracking (only if MAP wasn't manually overridden)
    if (explicitMap === null) {
      ca.recordAttack(channelId, attacker.name);
    }
    await updateSummary(interaction.channel, enc);
  }

  // ─── /roll ───────────────────────────────────────────────────────
  else if (commandName === 'roll') {
    const raw = interaction.options.getString('dice');
    const snippets = mergedSnippetsFor(interaction.user.id, interaction.guildId);
    const result = rollAdvanced(raw, snippets);
    if (result.error) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });

    const charNameArg = interaction.options.getString('character');
    let thumbnail = null;
    if (charNameArg) {
      const characters = loadCharacters();
      thumbnail = characters[interaction.user.id]?.[charNameArg.toLowerCase().replace(/\s+/g, '-')]?.art ?? null;
    }

    // Build description: one line per iteration, then summary if multi-iter
    const lines = result.iterations.map((iter, i) =>
      result.iterations.length > 1
        ? `**${i + 1}.** ${iter.breakdown} = **${iter.total}**`
        : `${iter.breakdown} = **${iter.total}**`
    );
    let description = lines.join('\n');
    if (result.summary) description += `\n\n${result.summary}`;
    if (result.warnings?.length) {
      description += '\n\n⚠️ ' + result.warnings.join('\n⚠️ ');
    }

    // If the input had snippets expanded, show the expansion in the footer
    // so users can see what actually got rolled.
    const expandedChanged = result.expanded.trim() !== raw.trim();

    const embed = new EmbedBuilder()
      .setColor(0x7289DA)
      .setTitle(`🎲 ${raw}`)
      .setDescription(description);
    if (thumbnail) embed.setThumbnail(thumbnail);
    const footerParts = [charNameArg ?? interaction.user.username];
    if (expandedChanged) footerParts.push(`Expanded: ${result.expanded}`);
    embed.setFooter({ text: footerParts.join(' · ') });
    await interaction.reply({ embeds: [embed] });
  }

  // ─── /skill ──────────────────────────────────────────────────────
  else if (commandName === 'skill') {
    await interaction.deferReply();
    const skillName  = interaction.options.getString('skill');
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    const ab = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl = c.level ?? 1;
    const skillMap = {
      acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
      deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
      nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
      society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
    };
    const abilKey  = skillMap[skillName];
    const abilMod  = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
    const profNum  = prof[skillName] ?? 0;
    const modifier = abilMod + calcProfNum(profNum, lvl);
    const dieRoll  = Math.floor(Math.random() * 20) + 1;
    const total    = dieRoll + modifier + extraBonus;
    const profLabels = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
    const skillDisplay = skillName.charAt(0).toUpperCase() + skillName.slice(1);
    await interaction.editReply({ embeds: [buildRollEmbed({ title: `${c.name} makes a ${skillDisplay} check!`, breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20), charName: `${c.name} · ${profLabels[profNum] ?? 'Untrained'} (${fmt(modifier)})`, thumbnail: charEntry.art ?? null })] });
  }

  // ─── /perception ─────────────────────────────────────────────────
  // Roll a Perception check (Wis + proficiency). Used for spotting things,
  // Seeking, resisting illusions, and by default for Initiative too.
  else if (commandName === 'perception') {
    await interaction.deferReply();
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    const modifier = computeCharPerception(charEntry);
    const profNum = c.proficiencies?.perception ?? 0;
    const profLabels = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
    const dieRoll = Math.floor(Math.random() * 20) + 1;
    const total = dieRoll + modifier + extraBonus;
    await interaction.editReply({ embeds: [buildRollEmbed({
      title: `👁️ ${c.name} rolls Perception!`,
      breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20),
      charName: `${c.name} · ${profLabels[profNum] ?? 'Untrained'} Perception (${fmt(modifier)})`,
      thumbnail: charEntry.art ?? null,
    })] });
  }

  // ─── /initiative ─────────────────────────────────────────────────
  // Roll initiative. Defaults to Perception-based initiative (the PF2e
  // standard). Allows an optional `skill:` override (e.g. stealth for an
  // ambush, diplomacy for a social scene). Does NOT add you to an active
  // encounter — use /init add for that. This is just for rolling.
  else if (commandName === 'initiative') {
    await interaction.deferReply();
    const skillOverride = interaction.options.getString('skill'); // optional
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    const ab = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl = c.level ?? 1;

    // Compute the modifier based on skill override or default perception.
    // Same skill map used by /skill so the two stay consistent.
    const skillMap = {
      acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
      deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
      nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
      society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
    };
    let modifier, profNum, sourceLabel;
    if (skillOverride && skillOverride.toLowerCase() !== 'perception' && skillMap[skillOverride.toLowerCase()]) {
      const key = skillOverride.toLowerCase();
      const abilKey = skillMap[key];
      const abilMod = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
      profNum = prof[key] ?? 0;
      modifier = abilMod + calcProfNum(profNum, lvl);
      sourceLabel = skillOverride.charAt(0).toUpperCase() + skillOverride.slice(1);
    } else {
      modifier = computeCharPerception(charEntry);
      profNum = prof.perception ?? 0;
      sourceLabel = 'Perception';
    }
    const profLabels = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
    const dieRoll = Math.floor(Math.random() * 20) + 1;
    const total = dieRoll + modifier + extraBonus;
    await interaction.editReply({ embeds: [buildRollEmbed({
      title: `⚔️ ${c.name} rolls Initiative!`,
      breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20),
      charName: `${c.name} · ${sourceLabel} (${fmt(modifier)}) · ${profLabels[profNum] ?? 'Untrained'}`,
      thumbnail: charEntry.art ?? null,
    })] });
  }

  // ─── /save ───────────────────────────────────────────────────────
  else if (commandName === 'save') {
    await interaction.deferReply();
    const saveType   = interaction.options.getString('type');
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    const ab = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl = c.level ?? 1;
    const saveAbilMap = { fortitude: 'con', reflex: 'dex', will: 'wis' };
    const abilKey  = saveAbilMap[saveType];
    const abilMod  = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
    const profNum  = prof[saveType] ?? 0;
    const modifier = abilMod + calcProfNum(profNum, lvl);
    const dieRoll  = Math.floor(Math.random() * 20) + 1;
    const total    = dieRoll + modifier + extraBonus;
    const profLabels = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
    const saveDisplay = saveType.charAt(0).toUpperCase() + saveType.slice(1);
    await interaction.editReply({ embeds: [buildRollEmbed({ title: `${c.name} makes a ${saveDisplay} save!`, breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20), charName: `${c.name} · ${profLabels[profNum] ?? 'Untrained'} (${fmt(modifier)})`, thumbnail: charEntry.art ?? null })] });
  }

  // ─── /ancestry ───────────────────────────────────────────────────
  else if (commandName === 'ancestry') {
    const input = interaction.options.getString('name');
    const key = input.toLowerCase().trim();
    const ancestry = ancestryDatabase[key];
    if (!ancestry) return interaction.reply({ content: `❌ No ancestry found for **"${input}"**. Available: ${Object.keys(ancestryDatabase).join(', ')}`, ephemeral: true });
    await interaction.reply({ embeds: [buildAncestryCorePage(ancestry)], components: [buildAncestryButtons(0, key)] });
  }

  // ─── /archetype ──────────────────────────────────────────────────
  else if (commandName === 'archetype') {
    const input = interaction.options.getString('name');
    const { archetype, matches } = findArchetype(input);
    if (!archetype && matches.length > 1) return interaction.reply({ content: `🔍 Multiple archetypes match **"${input}"**. Did you mean one of these?\n**${matches.sort().join(', ')}**`, ephemeral: true });
    if (!archetype) return interaction.reply({ content: `❌ No archetype found for **"${input}"**. Check your spelling or try another name.`, ephemeral: true });
    await interaction.reply({ embeds: [buildArchetypeEmbed(archetype)] });
  }

  // ─── /background ─────────────────────────────────────────────────
  else if (commandName === 'background') {
    const input = interaction.options.getString('name');
    const { background, matches } = findBackground(input);
    if (!background && matches.length > 1) {
      const preview = matches.sort().slice(0, 25).join(', ');
      const extra = matches.length > 25 ? ` *(+${matches.length - 25} more)*` : '';
      return interaction.reply({ content: `🔍 Multiple backgrounds match **"${input}"**. Did you mean one of these?\n**${preview}**${extra}`, ephemeral: true });
    }
    if (!background) return interaction.reply({ content: `❌ No background found for **"${input}"**. Check your spelling or try another name.`, ephemeral: true });
    await interaction.reply({ embeds: [buildBackgroundEmbed(background)] });
  }

  // ─── /feat ───────────────────────────────────────────────────────
  else if (commandName === 'feat') {
    const input = interaction.options.getString('name');
    const levelFilter = interaction.options.getInteger('level') ?? null;
    const { feat, matches, exactDuplicates } = findFeat(input, levelFilter);

    if (feat) {
      return interaction.reply({ embeds: [buildFeatEmbed(feat)] });
    }

    if (matches && matches.length > 1) {
      // Sort alphabetically, then by level
      const sorted = [...matches].sort((a, b) => a.name.localeCompare(b.name) || (a.level ?? 0) - (b.level ?? 0));
      const preview = sorted.slice(0, 20).map(formatFeatMatchLine).join('\n');
      const extra = sorted.length > 20 ? `\n*…and ${sorted.length - 20} more. Try narrowing your search.*` : '';
      const header = exactDuplicates
        ? `🔍 Multiple feats share the exact name **"${input}"**. Add a level to narrow it down:`
        : `🔍 Multiple feats match **"${input}"**. Did you mean one of these?`;
      return interaction.reply({ content: `${header}\n${preview}${extra}`, ephemeral: true });
    }

    const levelMsg = levelFilter != null ? ` at level ${levelFilter}` : '';
    return interaction.reply({ content: `❌ No feat found for **"${input}"**${levelMsg}. Check your spelling or try another name.`, ephemeral: true });
  }

  // ─── /item ───────────────────────────────────────────────────────
  else if (commandName === 'item') {
    const input = interaction.options.getString('name');
    const levelFilter = interaction.options.getInteger('level') ?? null;
    const { item, matches, exactDuplicates } = findItem(input, levelFilter);

    if (item) {
      return interaction.reply({ embeds: [buildItemEmbed(item)] });
    }

    if (matches && matches.length > 1) {
      const sorted = [...matches].sort((a, b) =>
        a.name.localeCompare(b.name) || (a.level ?? 0) - (b.level ?? 0)
      );
      const preview = sorted.slice(0, 20).map(formatItemMatchLine).join('\n');
      const extra = sorted.length > 20 ? `\n*…and ${sorted.length - 20} more. Try narrowing your search.*` : '';
      const header = exactDuplicates
        ? `🔍 Multiple items share the exact name **"${input}"**. Add a level to narrow it down:`
        : `🔍 Multiple items match **"${input}"**. Did you mean one of these?`;
      return interaction.reply({ content: `${header}\n${preview}${extra}`, ephemeral: true });
    }

    const levelMsg = levelFilter != null ? ` at level ${levelFilter}` : '';
    return interaction.reply({
      content: `❌ No item found for **"${input}"**${levelMsg}. Check your spelling or try another name.`,
      ephemeral: true
    });
  }

  // ─── /rule ───────────────────────────────────────────────────────
  else if (commandName === 'rule') {
    const input = interaction.options.getString('name');
    const { rule, matches } = findRule(input);
    if (!rule && matches.length > 1) {
      const nameList = matches.map(r => `${r.name} *(${r.category})*`).sort().join('\n');
      return interaction.reply({ content: `🔍 Multiple entries match **"${input}"**:\n${nameList}`, ephemeral: true });
    }
    if (!rule) return interaction.reply({ content: `❌ No rule found for **"${input}"**.\nTry a **condition** (e.g. frightened, prone), **action** (e.g. stride, grapple), or **trait** (e.g. agile, finesse).`, ephemeral: true });
    await interaction.reply({ embeds: [buildRuleEmbed(rule)] });
  }

  // ─── /deity ──────────────────────────────────────────────────────
  else if (commandName === 'deity') {
    const input = interaction.options.getString('name');
    const { deity, matches, exactDuplicates } = findDeity(input);

    if (deity) {
      return interaction.reply({ embeds: [buildDeityEmbed(deity)] });
    }

    if (matches && matches.length > 1) {
      const sorted = [...matches].sort((a, b) => a.name.localeCompare(b.name));
      const preview = sorted.slice(0, 20).map(formatDeityMatchLine).join('\n');
      const extra = sorted.length > 20 ? `\n*…and ${sorted.length - 20} more. Try narrowing your search.*` : '';
      const header = exactDuplicates
        ? `🔍 Multiple deities share the exact name **"${input}"**:`
        : `🔍 Multiple deities match **"${input}"**. Did you mean one of these?`;
      return interaction.reply({ content: `${header}\n${preview}${extra}`, ephemeral: true });
    }

    return interaction.reply({
      content: `❌ No deity found for **"${input}"**. Check your spelling or try another name.`,
      ephemeral: true,
    });
  }

  // ─── /skillinfo ──────────────────────────────────────────────────
  // Rules-reference lookup for the 16 core PF2e Remaster skills. Pulls
  // the character's current modifier in when a character is loaded.
  // 3-page button nav: Overview / Actions / DCs & Examples.
  else if (commandName === 'skillinfo') {
    const input = interaction.options.getString('skill');
    const { skill, key: skillKey, matches } = findSkill(input);

    if (!skill && matches.length > 1) {
      const preview = matches.sort().join(', ');
      return interaction.reply({
        content: `🔍 Multiple skills match **"${input}"**. Did you mean one of these?\n**${preview}**`,
        ephemeral: true,
      });
    }

    if (!skill) {
      const allSkills = Object.values(skillDatabase).map(s => s.name).sort().join(', ');
      return interaction.reply({
        content: `❌ No skill found for **"${input}"**.\nAvailable: ${allSkills}`,
        ephemeral: true,
      });
    }

    // Optional: pull the user's current skill modifier from their character sheet
    let charMod = null;
    try {
      const characters = loadCharacters();
      const charNameArg = interaction.options.getString('character');
      const { char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters);
      if (charEntry) {
        charMod = computeCharSkillModifier(charEntry, skillKey);
      }
    } catch { /* no character loaded, that's fine — just show the reference */ }

    const embed = buildSkillOverviewPage(skill, charMod);
    const row = buildSkillButtons(0, skillKey);
    await interaction.reply({ embeds: [embed], components: [row] });
  }

  // ─── /class ──────────────────────────────────────────────────────
  // Class lookup. 5 pages: Overview / Proficiencies / Features / Class Feats / Subclasses.
  // Optionally auto-selects the user's character's class if class: isn't specified.
  else if (commandName === 'class') {
    let input = interaction.options.getString('class');
    let userCharName = null;
    // If no class specified, try to pull from character
    if (!input) {
      try {
        const characters = loadCharacters();
        const charArg = interaction.options.getString('character');
        const { char: charEntry } = resolveChar(interaction.user.id, charArg, characters);
        if (charEntry?.data?.class) {
          input = charEntry.data.class;
          userCharName = charEntry.data.name;
        }
      } catch { /* fall through to error below */ }
    } else {
      // Still try to pull user's character name for display
      try {
        const characters = loadCharacters();
        const charArg = interaction.options.getString('character');
        const { char: charEntry } = resolveChar(interaction.user.id, charArg, characters);
        if (charEntry?.data?.class && charEntry.data.class.toLowerCase() === input.toLowerCase()) {
          userCharName = charEntry.data.name;
        }
      } catch { /* no character loaded, that's fine */ }
    }
    if (!input) return interaction.reply({ content: '❌ Specify a class with `class:<name>`, or load a character first.', ephemeral: true });
    const { cls, key, matches } = findClass(input);
    if (!cls && matches.length > 1) {
      return interaction.reply({ content: `🔍 Multiple classes match **"${input}"**: ${matches.slice(0, 10).join(', ')}`, ephemeral: true });
    }
    if (!cls) {
      const all = Object.values(classDatabase).map(c => c.name).sort().join(', ');
      return interaction.reply({ content: `❌ No class found for **"${input}"**.\nAvailable: ${all}`, ephemeral: true });
    }
    const embed = buildClassOverviewPage(cls, userCharName);
    const buttons = buildClassButtons(0, key);
    return interaction.reply({ embeds: [embed], components: [buttons] });
  }

  // ─── /companion ──────────────────────────────────────────────────
  else if (commandName === 'companion') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'info') {
      const input = interaction.options.getString('name');
      const { companion, matches } = findCompanion(input);
      if (!companion && matches.length > 1) {
        const preview = matches.sort().slice(0, 15).join(', ');
        return interaction.reply({ content: `🔍 Multiple companions match **"${input}"**. Did you mean:\n**${preview}**`, ephemeral: true });
      }
      if (!companion) return interaction.reply({ content: `❌ No companion found for **"${input}"**. Use \`/companion list\`.`, ephemeral: true });
      return interaction.reply({ embeds: [buildCompanionEmbed(companion)] });
    }

    if (sub === 'list') {
      const category = interaction.options.getString('category');
      return interaction.reply({ embeds: [buildCompanionListEmbed(category)] });
    }

    // Tracking subcommands require a character
    const characters = loadCharacters();
    const charNameArg = interaction.options.getString('character');
    const { error, charKey, char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const char = charEntry.data;
    if (!charEntry.companions) charEntry.companions = {};

    if (sub === 'add') {
      const displayName = interaction.options.getString('name');
      const baseInput = interaction.options.getString('base');
      const form = interaction.options.getString('form') ?? 'young';
      const custom = interaction.options.getBoolean('custom') ?? false;
      const compKey = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (charEntry.companions[compKey]) return interaction.reply({ content: `❌ **${char.name}** already has a companion named **${displayName}**.`, ephemeral: true });
      let baseType, customStats = null;
      if (custom) {
        const { monster } = findMonster(baseInput);
        if (monster) {
          customStats = {
            fromBestiary: monster.name,
            size: monster.size ?? 'Medium',
            speed: monster.speed ?? '25 feet',
            hp: monster.hp ?? 20,
            ac: monster.ac ?? 15,
            attacks: (monster.attacks ?? []).slice(0, 3),
            abilities: { str: monster.str ?? 0, dex: monster.dex ?? 0, con: monster.con ?? 0, int: monster.int ?? -4, wis: monster.wis ?? 0, cha: monster.cha ?? 0 },
          };
          baseType = 'custom';
        } else {
          return interaction.reply({ content: `❌ Custom companion base "${baseInput}" not found in bestiary.`, ephemeral: true });
        }
      } else {
        const { companion } = findCompanion(baseInput);
        if (!companion) return interaction.reply({ content: `❌ Companion type "${baseInput}" not found. Use \`/companion list\` or set custom:true for homebrew.`, ephemeral: true });
        baseType = companion.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
      charEntry.companions[compKey] = { displayName, baseType, form, notes: '', customStats, currentHp: null };
      if (!charEntry.activeCompanion) charEntry.activeCompanion = compKey;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ content: `🐾 **${displayName}** (${custom ? 'custom: ' + baseInput : baseInput}, ${form}) added to **${char.name}**'s companions!${charEntry.activeCompanion === compKey ? ' *(active)*' : ''}\nUse \`/companion sheet\` to view.` });
    }

    if (sub === 'mine') {
      const mine = Object.entries(charEntry.companions);
      if (mine.length === 0) return interaction.reply({ content: `**${char.name}** has no companions. Add one with \`/companion add\`.`, ephemeral: true });
      const activeKey = charEntry.activeCompanion;
      const lines = mine.map(([k, c]) => {
        const active = k === activeKey ? ' ⭐ *(active)*' : '';
        const customTag = c.baseType === 'custom' && c.customStats?.fromBestiary ? ` *(custom: ${c.customStats.fromBestiary})*` : '';
        return `• **${c.displayName}** — ${c.form}${customTag}${active}`;
      });
      const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle(`🐾 ${char.name}'s Companions`).setDescription(lines.join('\n'));
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'sheet') {
      const compNameArg = interaction.options.getString('companion');
      const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
      if (!compKey || !charEntry.companions[compKey]) return interaction.reply({ content: `❌ ${compNameArg ? 'No companion named "' + compNameArg + '"' : char.name + ' has no active companion'}.`, ephemeral: true });
      const comp = charEntry.companions[compKey];
      const scaled = scaleCompanion(comp, char);
      if (comp.currentHp === null || comp.currentHp === undefined) {
        comp.currentHp = scaled.maxHp;
        characters[interaction.user.id][charKey] = charEntry;
        saveCharacters(characters);
      }
      return interaction.reply({ embeds: [buildCompanionSheetEmbed(comp, scaled, char, charEntry, compKey === charEntry.activeCompanion)] });
    }

    if (sub === 'swap') {
      const compNameArg = interaction.options.getString('companion');
      const compKey = compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!charEntry.companions[compKey]) return interaction.reply({ content: `❌ No companion named "${compNameArg}".`, ephemeral: true });
      charEntry.activeCompanion = compKey;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ content: `⭐ **${charEntry.companions[compKey].displayName}** is now **${char.name}**'s active companion.` });
    }

    if (sub === 'form') {
      const compNameArg = interaction.options.getString('companion');
      const newForm = interaction.options.getString('form');
      const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
      if (!compKey || !charEntry.companions[compKey]) return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
      const oldForm = charEntry.companions[compKey].form;
      charEntry.companions[compKey].form = newForm;
      const scaled = scaleCompanion(charEntry.companions[compKey], char);
      if (charEntry.companions[compKey].currentHp && charEntry.companions[compKey].currentHp > scaled.maxHp) {
        charEntry.companions[compKey].currentHp = scaled.maxHp;
      }
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ content: `🔄 **${charEntry.companions[compKey].displayName}**: **${oldForm}** → **${newForm}**.\nNew max HP: **${scaled.maxHp}** · Attack: **+${scaled.attackBonus}** · AC: **${scaled.ac}**` });
    }

    if (sub === 'hp') {
      const compNameArg = interaction.options.getString('companion');
      const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
      if (!compKey || !charEntry.companions[compKey]) return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
      const comp = charEntry.companions[compKey];
      const scaled = scaleCompanion(comp, char);
      const change = interaction.options.getInteger('change');
      const setValue = interaction.options.getInteger('set');
      if (setValue !== null && setValue !== undefined) comp.currentHp = Math.max(0, Math.min(scaled.maxHp, setValue));
      else if (change !== null && change !== undefined) comp.currentHp = Math.max(0, Math.min(scaled.maxHp, (comp.currentHp ?? scaled.maxHp) + change));
      else comp.currentHp = scaled.maxHp;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ content: `❤️ **${comp.displayName}**: ${comp.currentHp}/${scaled.maxHp} HP.` });
    }

    if (sub === 'remove') {
      const compNameArg = interaction.options.getString('companion');
      const compKey = compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!charEntry.companions[compKey]) return interaction.reply({ content: `❌ No companion named "${compNameArg}".`, ephemeral: true });
      const name = charEntry.companions[compKey].displayName;
      delete charEntry.companions[compKey];
      if (charEntry.activeCompanion === compKey) {
        const remaining = Object.keys(charEntry.companions);
        charEntry.activeCompanion = remaining[0] ?? null;
      }
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ content: `🗑️ Removed **${name}** from **${char.name}**'s companions.` });
    }

    // ── /companion art — set portrait URL ──────────────────────────────
    if (sub === 'art') {
      const compNameArg = interaction.options.getString('companion');
      const url = interaction.options.getString('url');
      const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
      if (!compKey || !charEntry.companions[compKey]) {
        return interaction.reply({ content: `❌ Companion not found. Use \`/companion mine\` to see your companions.`, ephemeral: true });
      }
      // Empty / "clear" / "none" wipes the art
      if (!url || /^(clear|none|remove|off)$/i.test(url.trim())) {
        delete charEntry.companions[compKey].art;
        characters[interaction.user.id][charKey] = charEntry;
        saveCharacters(characters);
        return interaction.reply({ content: `🗑️ Cleared portrait for **${charEntry.companions[compKey].displayName}**.`, ephemeral: true });
      }
      // Basic URL validation — must start with http(s) and point at a plausible image host
      if (!/^https?:\/\/\S+\.\S+/.test(url)) {
        return interaction.reply({ content: `❌ That doesn't look like a valid URL. Use a direct image link (e.g. https://i.imgur.com/abc.png).`, ephemeral: true });
      }
      charEntry.companions[compKey].art = url.trim();
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ content: `🖼️ Updated portrait for **${charEntry.companions[compKey].displayName}**.\nView it with \`/companion sheet\`.`, ephemeral: true });
    }

    // ── /companion set — override any stat field ───────────────────────
    // stat choice values:
    //   str, dex, con, int, wis, cha   → overrides.abilities[key]
    //   ac, hp, speed, size            → overrides[key]
    //   fort, ref, will                → overrides.saves[key]
    //   attack, damage_dice, damage_bonus → overrides[key]
    if (sub === 'set') {
      const compNameArg = interaction.options.getString('companion');
      const stat = interaction.options.getString('stat');
      const rawValue = interaction.options.getString('value');
      const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
      if (!compKey || !charEntry.companions[compKey]) {
        return interaction.reply({ content: `❌ Companion not found. Use \`/companion mine\` to see your companions.`, ephemeral: true });
      }
      const comp = charEntry.companions[compKey];
      if (!comp.overrides) comp.overrides = { abilities: {}, saves: {} };
      if (!comp.overrides.abilities) comp.overrides.abilities = {};
      if (!comp.overrides.saves) comp.overrides.saves = {};

      // Classify the stat and validate the value.
      const abilityKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
      const saveKeys = ['fort', 'ref', 'will'];
      const numericKeys = ['ac', 'hp', 'attack', 'damage_bonus'];
      const stringKeys = ['speed', 'size', 'damage_dice'];

      function parseIntStrict(s) {
        // Accept leading +/- and whitespace; reject anything non-numeric
        const cleaned = String(s).trim();
        if (!/^[+-]?\d+$/.test(cleaned)) return null;
        return parseInt(cleaned);
      }

      let displayLabel, displayValue;
      if (abilityKeys.includes(stat)) {
        const n = parseIntStrict(rawValue);
        if (n === null) return interaction.reply({ content: `❌ \`${stat}\` expects a number (ability modifier, e.g. 3 or -1).`, ephemeral: true });
        if (n < -5 || n > 10) return interaction.reply({ content: `❌ Ability modifier ${n} is out of range (-5 to +10).`, ephemeral: true });
        comp.overrides.abilities[stat] = n;
        displayLabel = stat.toUpperCase();
        displayValue = fmt(n);
      }
      else if (saveKeys.includes(stat)) {
        const n = parseIntStrict(rawValue);
        if (n === null) return interaction.reply({ content: `❌ \`${stat}\` expects a number (total save bonus, e.g. 12).`, ephemeral: true });
        if (n < -5 || n > 50) return interaction.reply({ content: `❌ Save bonus ${n} is out of range (-5 to +50).`, ephemeral: true });
        comp.overrides.saves[stat] = n;
        displayLabel = stat.charAt(0).toUpperCase() + stat.slice(1);
        displayValue = fmt(n);
      }
      else if (stat === 'ac' || stat === 'hp' || stat === 'attack' || stat === 'damage_bonus') {
        const n = parseIntStrict(rawValue);
        if (n === null) return interaction.reply({ content: `❌ \`${stat}\` expects a number.`, ephemeral: true });
        const bounds = { ac: [0, 80], hp: [0, 2000], attack: [-5, 60], damage_bonus: [-5, 40] };
        const [lo, hi] = bounds[stat];
        if (n < lo || n > hi) return interaction.reply({ content: `❌ ${stat} ${n} is out of range (${lo} to ${hi}).`, ephemeral: true });
        const keyMap = { ac: 'ac', hp: 'hp', attack: 'attackBonus', damage_bonus: 'damageBonus' };
        comp.overrides[keyMap[stat]] = n;
        displayLabel = stat === 'damage_bonus' ? 'Damage bonus' : stat.toUpperCase();
        displayValue = stat === 'attack' || stat === 'damage_bonus' ? fmt(n) : String(n);
      }
      else if (stat === 'damage_dice') {
        if (!/^\d+d\d+$/i.test(rawValue.trim())) {
          return interaction.reply({ content: `❌ \`damage_dice\` expects a dice expression like \`2d6\` or \`1d10\`.`, ephemeral: true });
        }
        comp.overrides.damageDice = rawValue.trim().toLowerCase();
        displayLabel = 'Damage dice';
        displayValue = comp.overrides.damageDice;
      }
      else if (stat === 'speed') {
        if (rawValue.length > 60) return interaction.reply({ content: `❌ Speed text is too long (60 chars max).`, ephemeral: true });
        comp.overrides.speed = rawValue.trim();
        displayLabel = 'Speed';
        displayValue = comp.overrides.speed;
      }
      else if (stat === 'size') {
        const normalized = rawValue.trim().charAt(0).toUpperCase() + rawValue.trim().slice(1).toLowerCase();
        if (!['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'].includes(normalized)) {
          return interaction.reply({ content: `❌ Size must be one of: Tiny, Small, Medium, Large, Huge, Gargantuan.`, ephemeral: true });
        }
        comp.overrides.size = normalized;
        displayLabel = 'Size';
        displayValue = normalized;
      }
      else {
        return interaction.reply({ content: `❌ Unknown stat \`${stat}\`.`, ephemeral: true });
      }

      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ content: `✏️ **${comp.displayName}** — ${displayLabel} set to **${displayValue}**.\nView with \`/companion sheet\`. Undo with \`/companion reset stat:${stat}\`.`, ephemeral: true });
    }

    // ── /companion reset — clear one override ──────────────────────────
    if (sub === 'reset') {
      const compNameArg = interaction.options.getString('companion');
      const stat = interaction.options.getString('stat');
      const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
      if (!compKey || !charEntry.companions[compKey]) {
        return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
      }
      const comp = charEntry.companions[compKey];
      if (!comp.overrides) {
        return interaction.reply({ content: `ℹ️ **${comp.displayName}** has no overrides to reset.`, ephemeral: true });
      }

      const abilityKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
      const saveKeys = ['fort', 'ref', 'will'];
      const topKeyMap = { ac: 'ac', hp: 'hp', attack: 'attackBonus', damage_bonus: 'damageBonus', damage_dice: 'damageDice', speed: 'speed', size: 'size' };

      if (abilityKeys.includes(stat)) {
        if (comp.overrides.abilities) delete comp.overrides.abilities[stat];
      } else if (saveKeys.includes(stat)) {
        if (comp.overrides.saves) delete comp.overrides.saves[stat];
      } else if (topKeyMap[stat]) {
        delete comp.overrides[topKeyMap[stat]];
      } else {
        return interaction.reply({ content: `❌ Unknown stat \`${stat}\`.`, ephemeral: true });
      }

      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ content: `↺ Reset \`${stat}\` on **${comp.displayName}** to auto-calculated.`, ephemeral: true });
    }

    // ── /companion resetall — clear all overrides ──────────────────────
    if (sub === 'resetall') {
      const compNameArg = interaction.options.getString('companion');
      const compKey = compNameArg ? compNameArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : charEntry.activeCompanion;
      if (!compKey || !charEntry.companions[compKey]) {
        return interaction.reply({ content: `❌ Companion not found.`, ephemeral: true });
      }
      const comp = charEntry.companions[compKey];
      comp.overrides = { abilities: {}, saves: {} };
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ content: `↺ Cleared all stat overrides on **${comp.displayName}**. Using auto-calculated stats again.`, ephemeral: true });
    }
  }

  // ─── /monster ────────────────────────────────────────────────────
  else if (commandName === 'monster') {
    const input = interaction.options.getString('name');
    const { monster, matches, total } = findMonster(input);

    if (monster) {
      // Layer the GM's edits (if any) on top of the bestiary data, then
      // layer the server's saved /monsterattack library on top of that
      // so strike/spell/save attacks all appear on the stat block.
      const edits = getMonsterEdit(interaction.guildId, monster.name);
      const edited = applyMonsterEdits(monster, edits);
      const withLibrary = applyMonsterAttackLibrary(edited, interaction.guildId);
      const artUrl = lookupMonsterArt(interaction.guildId, monster);
      return interaction.reply({ embeds: [buildMonsterEmbed(withLibrary, artUrl)] });
    }

    if (matches && matches.length > 1) {
      const sorted = [...matches].sort((a, b) => a.localeCompare(b));
      const preview = sorted.slice(0, 20).map(n => `• **${n}**`).join('\n');
      const totalCount = total ?? matches.length;
      const extra = totalCount > 20 ? `\n*…and ${totalCount - 20} more. Try narrowing your search.*` : '';
      return interaction.reply({
        content: `🔍 Multiple creatures match **"${input}"**. Did you mean one of these?\n${preview}${extra}`,
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: `❌ No creature found for **"${input}"**. Check your spelling or try another name.`,
      ephemeral: true,
    });
  }

  // ─── /monsteradd ─────────────────────────────────────────────────
  // Owner-only. Parses a pasted Archives-of-Nethys stat block (or one attached
  // as a .txt file) and inserts it into the global bestiary.json so it shows
  // up in /monster for everyone. Also supports `remove` to roll back mistakes.
  else if (commandName === 'monsteradd') {
    // Gate: only the bot owner can mutate the global dataset.
    if (!BOT_OWNER_ID) {
      return interaction.reply({
        content: '⚙️ `/monsteradd` is disabled: the bot operator hasn\'t set the `BOT_OWNER_ID` environment variable. Add it to `.env` and restart the bot.',
        ephemeral: true,
      });
    }
    if (!isBotOwner(interaction.user.id)) {
      return interaction.reply({
        content: '🔒 Only the bot owner can add creatures to the global bestiary.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    // ── /monsteradd paste ─────────────────────────────────────────────────
    if (sub === 'paste') {
      const raw = interaction.options.getString('statblock');
      await interaction.deferReply({ ephemeral: true });
      const result = parseBestiaryStatBlock(raw);
      if (!result.ok) {
        return interaction.editReply({ content: `❌ Parse failed: ${result.error}` });
      }
      const slug = addMonsterToBestiary(result.entry, result.slug);
      const preview = buildMonsterEmbed(result.entry, null);
      const warnLine = result.warnings.length
        ? `\n⚠️ Warnings:\n• ${result.warnings.join('\n• ')}`
        : '';
      return interaction.editReply({
        content: `✅ Added **${result.entry.name}** to the global bestiary (key: \`${slug}\`).${warnLine}\nUse \`/monster name:${result.entry.name}\` to view. If something looks off, use \`/monsteredit\` to fix it or \`/monsteradd remove\` to roll back.`,
        embeds: [preview],
      });
    }

    // ── /monsteradd file ──────────────────────────────────────────────────
    if (sub === 'file') {
      const attachment = interaction.options.getAttachment('file');
      if (!attachment) return interaction.reply({ content: '❌ No file attached.', ephemeral: true });
      // Basic sanity: only accept small text-ish files
      if (attachment.size > 256 * 1024) {
        return interaction.reply({ content: '❌ File is too large (256 KB max). Please paste the stat block inline instead.', ephemeral: true });
      }
      const ctype = (attachment.contentType || '').toLowerCase();
      const isTexty = ctype.startsWith('text/') || /\.(txt|md|text)$/i.test(attachment.name || '');
      if (!isTexty) {
        return interaction.reply({ content: '❌ Only plain-text files (.txt / .md) are supported. If you have an image, retype the stat block into a .txt file or use `/monsteradd paste`.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      let body;
      try {
        const resp = await fetch(attachment.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        body = await resp.text();
      } catch (err) {
        return interaction.editReply({ content: `❌ Could not download the attachment: ${err.message}` });
      }
      const result = parseBestiaryStatBlock(body);
      if (!result.ok) {
        return interaction.editReply({ content: `❌ Parse failed: ${result.error}` });
      }
      const slug = addMonsterToBestiary(result.entry, result.slug);
      const preview = buildMonsterEmbed(result.entry, null);
      const warnLine = result.warnings.length
        ? `\n⚠️ Warnings:\n• ${result.warnings.join('\n• ')}`
        : '';
      return interaction.editReply({
        content: `✅ Added **${result.entry.name}** to the global bestiary (key: \`${slug}\`).${warnLine}\nUse \`/monster name:${result.entry.name}\` to view. If something looks off, use \`/monsteredit\` to fix it or \`/monsteradd remove\` to roll back.`,
        embeds: [preview],
      });
    }

    // ── /monsteradd remove ────────────────────────────────────────────────
    if (sub === 'remove') {
      const input = interaction.options.getString('monster').trim();
      const result = removeMonsterFromBestiary(input);
      if (!result.removed) {
        return interaction.reply({ content: `❌ No creature found for \`${input}\` in the bestiary.`, ephemeral: true });
      }
      return interaction.reply({ content: `🗑️ Removed **${result.name}** (key: \`${result.key}\`) from the global bestiary.`, ephemeral: true });
    }

    return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
  }

  // ─── /spelladd ────────────────────────────────────────────────────────────
  // Owner-only. Parses a pasted statblock (or attached .txt) and appends it to
  // spells.json so it shows up in /spell and autocomplete for everyone.
  else if (commandName === 'spelladd') {
    if (!BOT_OWNER_ID) {
      return interaction.reply({
        content: '⚙️ `/spelladd` is disabled: the bot operator hasn\'t set the `BOT_OWNER_ID` environment variable. Add it to `.env` and restart the bot.',
        ephemeral: true,
      });
    }
    if (!isBotOwner(interaction.user.id)) {
      return interaction.reply({
        content: '🔒 Only the bot owner can add homebrew spells to the global database.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'paste') {
      const raw = interaction.options.getString('statblock');
      await interaction.deferReply({ ephemeral: true });
      const result = parseSpellStatBlock(raw);
      if (!result.ok) return interaction.editReply({ content: `❌ Parse failed: ${result.error}` });
      const finalName = addSpellToDatabase(result.entry);
      const warnLine = result.warnings.length ? `\n⚠️ Warnings:\n• ${result.warnings.join('\n• ')}` : '';
      return interaction.editReply({
        content: `✅ Added **${finalName}** to the global spell database.${warnLine}\nUse \`/spell name:${finalName}\` to view. Remove with \`/spelladd remove spell:${finalName}\`.`,
        embeds: [buildSpellEmbed(result.entry)],
      });
    }

    if (sub === 'file') {
      const attachment = interaction.options.getAttachment('file');
      if (!attachment) return interaction.reply({ content: '❌ No file attached.', ephemeral: true });
      if (attachment.size > 256 * 1024) {
        return interaction.reply({ content: '❌ File is too large (256 KB max). Please paste the statblock inline instead.', ephemeral: true });
      }
      const ctype = (attachment.contentType || '').toLowerCase();
      const isTexty = ctype.startsWith('text/') || /\.(txt|md|text)$/i.test(attachment.name || '');
      if (!isTexty) {
        return interaction.reply({ content: '❌ Only plain-text files (.txt / .md) are supported.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      let body;
      try {
        const resp = await fetch(attachment.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        body = await resp.text();
      } catch (err) {
        return interaction.editReply({ content: `❌ Could not download the attachment: ${err.message}` });
      }
      const result = parseSpellStatBlock(body);
      if (!result.ok) return interaction.editReply({ content: `❌ Parse failed: ${result.error}` });
      const finalName = addSpellToDatabase(result.entry);
      const warnLine = result.warnings.length ? `\n⚠️ Warnings:\n• ${result.warnings.join('\n• ')}` : '';
      return interaction.editReply({
        content: `✅ Added **${finalName}** to the global spell database.${warnLine}\nUse \`/spell name:${finalName}\` to view.`,
        embeds: [buildSpellEmbed(result.entry)],
      });
    }

    if (sub === 'remove') {
      const input = interaction.options.getString('spell').trim();
      const result = removeSpellFromDatabase(input);
      if (result.protected) {
        return interaction.reply({ content: `🛡️ **${result.name}** is part of the core spell database (not homebrew) and cannot be removed via \`/spelladd remove\`.`, ephemeral: true });
      }
      if (!result.removed) {
        return interaction.reply({ content: `❌ No homebrew spell found matching \`${input}\`.`, ephemeral: true });
      }
      return interaction.reply({ content: `🗑️ Removed homebrew spell **${result.name}** from the database.`, ephemeral: true });
    }

    return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
  }

  // ─── /itemadd ─────────────────────────────────────────────────────────────
  // Owner-only. Same shape as /spelladd, for items.
  else if (commandName === 'itemadd') {
    if (!BOT_OWNER_ID) {
      return interaction.reply({
        content: '⚙️ `/itemadd` is disabled: the bot operator hasn\'t set the `BOT_OWNER_ID` environment variable.',
        ephemeral: true,
      });
    }
    if (!isBotOwner(interaction.user.id)) {
      return interaction.reply({
        content: '🔒 Only the bot owner can add homebrew items to the global database.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'paste') {
      const raw = interaction.options.getString('statblock');
      await interaction.deferReply({ ephemeral: true });
      const result = parseItemStatBlock(raw);
      if (!result.ok) return interaction.editReply({ content: `❌ Parse failed: ${result.error}` });
      const finalName = addItemToDatabase(result.entry);
      const warnLine = result.warnings.length ? `\n⚠️ Warnings:\n• ${result.warnings.join('\n• ')}` : '';
      return interaction.editReply({
        content: `✅ Added **${finalName}** to the global item database.${warnLine}\nUse \`/item name:${finalName}\` to view. Remove with \`/itemadd remove item:${finalName}\`.`,
        embeds: [buildItemEmbed(result.entry)],
      });
    }

    if (sub === 'file') {
      const attachment = interaction.options.getAttachment('file');
      if (!attachment) return interaction.reply({ content: '❌ No file attached.', ephemeral: true });
      if (attachment.size > 256 * 1024) {
        return interaction.reply({ content: '❌ File is too large (256 KB max). Please paste the statblock inline instead.', ephemeral: true });
      }
      const ctype = (attachment.contentType || '').toLowerCase();
      const isTexty = ctype.startsWith('text/') || /\.(txt|md|text)$/i.test(attachment.name || '');
      if (!isTexty) {
        return interaction.reply({ content: '❌ Only plain-text files (.txt / .md) are supported.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      let body;
      try {
        const resp = await fetch(attachment.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        body = await resp.text();
      } catch (err) {
        return interaction.editReply({ content: `❌ Could not download the attachment: ${err.message}` });
      }
      const result = parseItemStatBlock(body);
      if (!result.ok) return interaction.editReply({ content: `❌ Parse failed: ${result.error}` });
      const finalName = addItemToDatabase(result.entry);
      const warnLine = result.warnings.length ? `\n⚠️ Warnings:\n• ${result.warnings.join('\n• ')}` : '';
      return interaction.editReply({
        content: `✅ Added **${finalName}** to the global item database.${warnLine}\nUse \`/item name:${finalName}\` to view.`,
        embeds: [buildItemEmbed(result.entry)],
      });
    }

    if (sub === 'remove') {
      const input = interaction.options.getString('item').trim();
      const result = removeItemFromDatabase(input);
      if (result.protected) {
        return interaction.reply({ content: `🛡️ **${result.name}** is part of the core item database (not homebrew) and cannot be removed via \`/itemadd remove\`.`, ephemeral: true });
      }
      if (!result.removed) {
        return interaction.reply({ content: `❌ No homebrew item found matching \`${input}\`.`, ephemeral: true });
      }
      return interaction.reply({ content: `🗑️ Removed homebrew item **${result.name}** from the database.`, ephemeral: true });
    }

    return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
  }

  // ─── /monsterart ─────────────────────────────────────────────────
  // Per-guild art library for monsters. When set, the URL is attached as the
  // bottom image on any /monster lookup. Storing per-guild means different
  // tables can have different art without stepping on each other.
  else if (commandName === 'monsterart') {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: '❌ `/monsterart` only works in a server, not in DMs.', ephemeral: true });

    if (sub === 'set') {
      const monsterInput = interaction.options.getString('monster');
      const url = interaction.options.getString('url').trim();
      if (!/^https?:\/\//i.test(url)) {
        return interaction.reply({ content: '❌ That doesn\'t look like a valid image URL. Make sure it starts with `http://` or `https://`.', ephemeral: true });
      }
      // Soft check for common image extensions. Discord will render any
      // URL it can fetch as an image, but warn the user if they pass a
      // webpage URL (e.g., a reddit thread instead of the i.redd.it link).
      const looksLikeImage = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);

      // Resolve the canonical bestiary name so "goblin warrior" and
      // "Goblin Warrior" both key to the same entry.
      const found = findMonster(monsterInput);
      const displayName = found.monster?.name ?? monsterInput;
      const key = monsterKey(displayName);

      const store = loadMonsterArt();
      const guild = getGuildArt(store, guildId);
      guild[key] = {
        displayName,
        url,
        setBy: interaction.user.id,
        setAt: new Date().toISOString(),
      };
      saveMonsterArt(store);

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`🖼️ Art set for ${displayName}`)
        .setDescription(`Future \`/monster\` lookups for **${displayName}** on this server will display this image.${looksLikeImage ? '' : '\n\n⚠️ *This URL doesn\'t end in a typical image extension — if it doesn\'t render, try a direct image link (right-click → Copy Image Address).*'}`)
        .setImage(url)
        .setFooter({ text: `Set by ${interaction.user.username} • /monsterart remove to undo` });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'remove') {
      const monsterInput = interaction.options.getString('monster');
      const found = findMonster(monsterInput);
      const displayName = found.monster?.name ?? monsterInput;
      const key = monsterKey(displayName);

      const store = loadMonsterArt();
      const guild = store[guildId] ?? {};
      if (!guild[key]) {
        return interaction.reply({ content: `❌ No saved art for **${displayName}** on this server.`, ephemeral: true });
      }
      delete guild[key];
      // Prune empty guild bucket so the file stays tidy.
      if (Object.keys(guild).length === 0) delete store[guildId];
      else store[guildId] = guild;
      saveMonsterArt(store);
      return interaction.reply({ content: `🗑️ Removed art for **${displayName}**.`, ephemeral: true });
    }

    if (sub === 'view') {
      const monsterInput = interaction.options.getString('monster');
      if (monsterInput) {
        // Show art for one specific monster
        const found = findMonster(monsterInput);
        const displayName = found.monster?.name ?? monsterInput;
        const key = monsterKey(displayName);
        const store = loadMonsterArt();
        const entry = store[guildId]?.[key];
        if (!entry) return interaction.reply({ content: `❌ No saved art for **${displayName}** on this server.`, ephemeral: true });
        const embed = new EmbedBuilder()
          .setColor(0x9B59B6)
          .setTitle(`🖼️ ${entry.displayName}`)
          .setImage(entry.url)
          .setFooter({ text: `Set by user ${entry.setBy} • /monsterart remove to delete` });
        return interaction.reply({ embeds: [embed] });
      }
      // List all monsters with saved art for this server
      const store = loadMonsterArt();
      const guild = store[guildId] ?? {};
      const entries = Object.values(guild);
      if (entries.length === 0) {
        return interaction.reply({ content: '📖 No monster art saved for this server yet. Use `/monsterart set` to add some.', ephemeral: true });
      }
      entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
      const lines = entries.map(e => `• **${e.displayName}**`);
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`🖼️ Saved Monster Art (${entries.length})`)
        .setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: '/monsterart view monster:<name> to see the image • /monsterart remove to delete' });
      return interaction.reply({ embeds: [embed] });
    }
  }

  // ─── /monsteredit ────────────────────────────────────────────────
  // Per-guild per-field overrides for bestiary entries. Each subcommand
  // touches ONE field; untouched fields fall through to the bestiary. This
  // lets you add a single custom ability to Lanks without rebuilding her
  // whole stat block. Use /monsteredit paste to drop in a full JSON block
  // (handy for homebrew creatures), and /monsteredit reset to wipe.
  else if (commandName === 'monsteredit') {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: '❌ `/monsteredit` only works in a server, not in DMs.', ephemeral: true });

    // Resolve the canonical bestiary name where possible so "goblin warrior"
    // and "Goblin Warrior" always edit the same entry. Homebrew names that
    // don't match anything in the bestiary are accepted as-is.
    const resolveName = (input) => {
      const found = findMonster(input);
      return found.monster?.name ?? input;
    };

    // ── ability: add or replace a named ability ──
    if (sub === 'ability') {
      const monsterInput = interaction.options.getString('monster');
      const name = interaction.options.getString('name').trim();
      const description = interaction.options.getString('description');
      const actionCost = interaction.options.getString('action_cost');
      const trigger = interaction.options.getString('trigger');
      const traitsRaw = interaction.options.getString('traits');
      const slot = interaction.options.getString('slot') ?? 'mid';

      if (!['top', 'mid', 'bot'].includes(slot)) {
        return interaction.reply({ content: '❌ `slot` must be one of: top, mid, bot.', ephemeral: true });
      }

      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);

      // If the user hasn't edited abilities yet, seed from the bestiary so
      // they keep Goblin Scuttle etc. and merely add Scoundrel's Feint.
      if (!entry.abilities) {
        const base = findMonster(monsterInput).monster?.rich?.abilities;
        entry.abilities = base
          ? { top: [...(base.top ?? [])], mid: [...(base.mid ?? [])], bot: [...(base.bot ?? [])] }
          : { top: [], mid: [], bot: [] };
      }

      const newAbility = { name };
      if (description) newAbility.description = description;
      if (actionCost)  newAbility.action_cost = actionCost;
      if (trigger)     newAbility.trigger = trigger;
      if (traitsRaw)   newAbility.traits = traitsRaw.split(',').map(t => t.trim()).filter(Boolean);

      const bucket = entry.abilities[slot] ?? (entry.abilities[slot] = []);
      // Replace any existing ability with the same name (case-insensitive)
      const existingIdx = bucket.findIndex(a => a.name?.toLowerCase() === name.toLowerCase());
      if (existingIdx >= 0) bucket[existingIdx] = newAbility;
      else bucket.push(newAbility);

      saveMonsterEdits(store);
      const verb = existingIdx >= 0 ? 'Updated' : 'Added';
      return interaction.reply({ content: `✅ ${verb} ability **${name}** on **${displayName}** (slot: ${slot}).`, ephemeral: true });
    }

    // ── item: add one to the carried items list ──
    if (sub === 'item') {
      const monsterInput = interaction.options.getString('monster');
      const item = interaction.options.getString('item').trim();
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      if (!entry.items) {
        const base = findMonster(monsterInput).monster?.rich?.items;
        entry.items = Array.isArray(base) ? [...base] : [];
      }
      if (entry.items.some(i => String(i).toLowerCase() === item.toLowerCase())) {
        return interaction.reply({ content: `❌ **${displayName}** already has item **${item}**.`, ephemeral: true });
      }
      entry.items.push(item);
      saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Added item **${item}** to **${displayName}**.`, ephemeral: true });
    }

    // ── language: add one to the languages list ──
    if (sub === 'language') {
      const monsterInput = interaction.options.getString('monster');
      const lang = interaction.options.getString('language').trim();
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      if (!entry.languages) {
        const base = findMonster(monsterInput).monster?.rich?.languages;
        entry.languages = Array.isArray(base) ? [...base] : [];
      }
      if (entry.languages.some(l => String(l).toLowerCase() === lang.toLowerCase())) {
        return interaction.reply({ content: `❌ **${displayName}** already speaks **${lang}**.`, ephemeral: true });
      }
      entry.languages.push(lang);
      saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Added language **${lang}** to **${displayName}**.`, ephemeral: true });
    }

    // ── skill: set a skill modifier (for Recall Knowledge etc.) ──
    if (sub === 'skill') {
      const monsterInput = interaction.options.getString('monster');
      const skillName = interaction.options.getString('skill').trim();
      const modifier = interaction.options.getInteger('modifier');
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      if (!entry.skills) {
        const base = findMonster(monsterInput).monster?.rich?.skills;
        entry.skills = base && typeof base === 'object' ? { ...base } : {};
      }
      const normalized = skillName.charAt(0).toUpperCase() + skillName.slice(1).toLowerCase();
      entry.skills[normalized] = modifier;
      saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Set **${normalized}** ${modifier >= 0 ? '+' : ''}${modifier} on **${displayName}**.`, ephemeral: true });
    }

    // ── attack: add a strike to the attacks array (flavor-only; for
    // attacks you want to roll use /monsterattack instead) ──
    if (sub === 'attack') {
      const monsterInput = interaction.options.getString('monster');
      const name = interaction.options.getString('name').trim();
      const toHit = interaction.options.getInteger('to_hit');
      const damage = interaction.options.getString('damage').trim();
      const type = interaction.options.getString('type') ?? 'melee';
      const traitsRaw = interaction.options.getString('traits');
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      if (!entry.attacks) {
        const base = findMonster(monsterInput).monster?.rich?.attacks;
        entry.attacks = Array.isArray(base) ? [...base] : [];
      }
      const newAtk = {
        type,
        name,
        to_hit: toHit,
        damage,
        traits: traitsRaw ? traitsRaw.split(',').map(t => t.trim()).filter(Boolean) : [],
      };
      const idx = entry.attacks.findIndex(a => a.name?.toLowerCase() === name.toLowerCase());
      if (idx >= 0) entry.attacks[idx] = newAtk;
      else entry.attacks.push(newAtk);
      saveMonsterEdits(store);
      return interaction.reply({ content: `✅ ${idx >= 0 ? 'Updated' : 'Added'} attack **${name}** on **${displayName}**.`, ephemeral: true });
    }

    // ── ability-score: set str/dex/con/int/wis/cha modifier ──
    if (sub === 'ability-score') {
      const monsterInput = interaction.options.getString('monster');
      const which = interaction.options.getString('score');
      const value = interaction.options.getInteger('value');
      const valid = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
      if (!valid.includes(which)) {
        return interaction.reply({ content: `❌ \`score\` must be one of: ${valid.join(', ')}`, ephemeral: true });
      }
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      if (!entry.ability_modifiers) {
        const base = findMonster(monsterInput).monster?.rich?.ability_modifiers;
        entry.ability_modifiers = base && typeof base === 'object' ? { ...base } : {};
      }
      entry.ability_modifiers[which] = value;
      saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Set **${which.toUpperCase()}** ${value >= 0 ? '+' : ''}${value} on **${displayName}**.`, ephemeral: true });
    }

    // ── description: set the flavor text shown under the title ──
    if (sub === 'description') {
      const monsterInput = interaction.options.getString('monster');
      const description = interaction.options.getString('description').trim();
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      entry.description = description;
      saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Description set on **${displayName}**.`, ephemeral: true });
    }

    // ── paste: bulk JSON paste (for homebrew creatures) ──
    if (sub === 'paste') {
      const monsterInput = interaction.options.getString('monster');
      const jsonRaw = interaction.options.getString('json');
      let parsed;
      try {
        parsed = JSON.parse(jsonRaw);
      } catch (err) {
        return interaction.reply({ content: `❌ That's not valid JSON: ${err.message}`, ephemeral: true });
      }
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        return interaction.reply({ content: '❌ The JSON must be an object with fields like `abilities`, `items`, `attacks`, etc.', ephemeral: true });
      }
      const allowed = ['abilities', 'items', 'languages', 'skills', 'attacks', 'ability_modifiers', 'spellcasting', 'description'];
      const applied = [];
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      for (const k of allowed) {
        if (parsed[k] !== undefined) {
          entry[k] = parsed[k];
          applied.push(k);
        }
      }
      if (applied.length === 0) {
        return interaction.reply({ content: `❌ JSON had none of the recognized fields: ${allowed.join(', ')}`, ephemeral: true });
      }
      saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Applied fields [${applied.join(', ')}] to **${displayName}**.`, ephemeral: true });
    }

    // ── view: dump the current edits for a monster, or list all ──
    if (sub === 'view') {
      const monsterInput = interaction.options.getString('monster');
      if (monsterInput) {
        const displayName = resolveName(monsterInput);
        const entry = getMonsterEdit(guildId, displayName);
        if (!entry) return interaction.reply({ content: `📭 No saved edits for **${displayName}** on this server.`, ephemeral: true });
        const { displayName: _d, setBy: _b, setAt: _a, ...fields } = entry;
        const body = '```json\n' + JSON.stringify(fields, null, 2).slice(0, 1800) + '\n```';
        const embed = new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle(`📝 Edits for ${entry.displayName}`)
          .setDescription(body)
          .setFooter({ text: `Set by user ${entry.setBy} • /monsteredit reset to clear` });
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      const store = loadMonsterEdits();
      const guild = store[guildId] ?? {};
      const entries = Object.values(guild);
      if (entries.length === 0) return interaction.reply({ content: '📖 No monster edits saved for this server yet.', ephemeral: true });
      entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
      const lines = entries.map(e => {
        const { displayName: _d, setBy: _b, setAt: _a, ...fields } = e;
        const keys = Object.keys(fields);
        return `• **${e.displayName}** — ${keys.length ? keys.join(', ') : '*empty*'}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`📝 Monster Edits (${entries.length})`)
        .setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: '/monsteredit view monster:<n> to see details' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── remove: drop one entry from a list field ──
    if (sub === 'remove') {
      const monsterInput = interaction.options.getString('monster');
      const field = interaction.options.getString('field');
      const value = interaction.options.getString('value').trim();
      const displayName = resolveName(monsterInput);
      const entry = getMonsterEdit(guildId, displayName);
      if (!entry) return interaction.reply({ content: `❌ No edits to modify for **${displayName}**.`, ephemeral: true });

      const store = loadMonsterEdits();
      const liveEntry = store[guildId][monsterKey(displayName)];

      if (field === 'ability') {
        let removed = false;
        for (const slot of ['top', 'mid', 'bot']) {
          const list = liveEntry.abilities?.[slot];
          if (!list) continue;
          const idx = list.findIndex(a => a.name?.toLowerCase() === value.toLowerCase());
          if (idx >= 0) { list.splice(idx, 1); removed = true; break; }
        }
        if (!removed) return interaction.reply({ content: `❌ No ability named "${value}" on **${displayName}**.`, ephemeral: true });
      } else if (field === 'item') {
        const list = liveEntry.items;
        if (!list) return interaction.reply({ content: `❌ No items to remove.`, ephemeral: true });
        const idx = list.findIndex(i => String(i).toLowerCase() === value.toLowerCase());
        if (idx < 0) return interaction.reply({ content: `❌ **${displayName}** doesn't have item "${value}".`, ephemeral: true });
        list.splice(idx, 1);
      } else if (field === 'language') {
        const list = liveEntry.languages;
        if (!list) return interaction.reply({ content: `❌ No languages to remove.`, ephemeral: true });
        const idx = list.findIndex(l => String(l).toLowerCase() === value.toLowerCase());
        if (idx < 0) return interaction.reply({ content: `❌ **${displayName}** doesn't speak "${value}".`, ephemeral: true });
        list.splice(idx, 1);
      } else if (field === 'skill') {
        if (!liveEntry.skills) return interaction.reply({ content: `❌ No skills to remove.`, ephemeral: true });
        const matchKey = Object.keys(liveEntry.skills).find(k => k.toLowerCase() === value.toLowerCase());
        if (!matchKey) return interaction.reply({ content: `❌ **${displayName}** has no edit for skill "${value}".`, ephemeral: true });
        delete liveEntry.skills[matchKey];
      } else if (field === 'attack') {
        const list = liveEntry.attacks;
        if (!list) return interaction.reply({ content: `❌ No attacks to remove.`, ephemeral: true });
        const idx = list.findIndex(a => a.name?.toLowerCase() === value.toLowerCase());
        if (idx < 0) return interaction.reply({ content: `❌ **${displayName}** has no attack named "${value}".`, ephemeral: true });
        list.splice(idx, 1);
      } else {
        return interaction.reply({ content: `❌ \`field\` must be one of: ability, item, language, skill, attack.`, ephemeral: true });
      }
      saveMonsterEdits(store);
      return interaction.reply({ content: `🗑️ Removed ${field} **${value}** from **${displayName}**.`, ephemeral: true });
    }

    // ── reset: wipe all edits for one monster ──
    if (sub === 'reset') {
      const monsterInput = interaction.options.getString('monster');
      const displayName = resolveName(monsterInput);
      const store = loadMonsterEdits();
      const guild = store[guildId];
      if (!guild || !guild[monsterKey(displayName)]) {
        return interaction.reply({ content: `📭 No saved edits for **${displayName}** on this server.`, ephemeral: true });
      }
      delete guild[monsterKey(displayName)];
      if (Object.keys(guild).length === 0) delete store[guildId];
      else store[guildId] = guild;
      saveMonsterEdits(store);
      return interaction.reply({ content: `🗑️ Wiped all edits for **${displayName}**.`, ephemeral: true });
    }
  }

  // ─── /bag ────────────────────────────────────────────────────────
  else if (commandName === 'bag') {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const bags = loadBags();
    const userBag = getOrCreateBag(bags, userId);

    if (sub === 'view') {
      // Try to resolve the user's character to show encumbrance; silent if unavailable.
      let character = null;
      try {
        const characters = loadCharacters();
        const nameArg = interaction.options.getString('character');
        const resolved = resolveChar(userId, nameArg, characters);
        if (!resolved.error) character = resolved.character;
      } catch { /* no character, just skip encumbrance */ }
      return interaction.reply({ embeds: [buildBagEmbed(userBag, character)] });
    }
    if (sub === 'rename') {
      const newName = interaction.options.getString('name');
      userBag.bagName = newName;
      saveBags(bags);
      return interaction.reply({ content: `✅ Bag renamed to **${newName}**!`, ephemeral: true });
    }
    if (sub === 'add') {
      const category = interaction.options.getString('category').trim();
      const itemInput = interaction.options.getString('item').trim();
      const qty = Math.max(1, interaction.options.getInteger('qty') ?? 1);

      // Prefer the canonical name from itemDatabase (so "healing potion (lesser)" -> "Healing Potion (Lesser)")
      const data = lookupItemData(itemInput);
      const displayName = data?.name ?? itemInput;

      if (!userBag.categories[category]) userBag.categories[category] = [];

      // Merge with an existing stack of the same name (case-insensitive), else push a new entry.
      const bucket = userBag.categories[category];
      const existingIdx = bucket.findIndex(raw => {
        const e = normalizeBagEntry(raw);
        return e && e.name.toLowerCase() === displayName.toLowerCase();
      });
      if (existingIdx !== -1) {
        const existing = normalizeBagEntry(bucket[existingIdx]);
        bucket[existingIdx] = { name: existing.name, qty: existing.qty + qty };
      } else {
        bucket.push({ name: displayName, qty });
      }
      saveBags(bags);

      const tag = data ? '' : ' *(homebrew)*';
      const qtyLabel = qty > 1 ? ` ×${qty}` : '';
      return interaction.reply({ content: `✅ Added **${displayName}**${qtyLabel}${tag} to **${category}**!`, ephemeral: true });
    }
    if (sub === 'remove') {
      const category = interaction.options.getString('category').trim();
      const itemInput = interaction.options.getString('item').trim();
      const qty = interaction.options.getInteger('qty') ?? null; // null = remove whole stack
      if (!userBag.categories[category]) return interaction.reply({ content: `❌ Category **"${category}"** doesn't exist in your bag.`, ephemeral: true });

      const bucket = userBag.categories[category];
      const idx = bucket.findIndex(raw => {
        const e = normalizeBagEntry(raw);
        return e && e.name.toLowerCase() === itemInput.toLowerCase();
      });
      if (idx === -1) return interaction.reply({ content: `❌ **${itemInput}** not found in **${category}**.`, ephemeral: true });

      const existing = normalizeBagEntry(bucket[idx]);
      if (qty == null || qty >= existing.qty) {
        bucket.splice(idx, 1);
      } else {
        bucket[idx] = { name: existing.name, qty: existing.qty - qty };
      }
      if (bucket.length === 0) delete userBag.categories[category];
      saveBags(bags);

      const removedQty = qty == null ? existing.qty : Math.min(qty, existing.qty);
      const qtyLabel = removedQty > 1 ? ` ×${removedQty}` : '';
      return interaction.reply({ content: `✅ Removed **${existing.name}**${qtyLabel} from **${category}**!`, ephemeral: true });
    }
    if (sub === 'removecategory') {
      const category = interaction.options.getString('category').trim();
      if (!userBag.categories[category]) return interaction.reply({ content: `❌ Category **"${category}"** doesn't exist.`, ephemeral: true });
      delete userBag.categories[category];
      saveBags(bags);
      return interaction.reply({ content: `🗑️ Removed category **${category}** from your bag.`, ephemeral: true });
    }
    if (sub === 'clear') {
      userBag.categories = {};
      saveBags(bags);
      return interaction.reply({ content: `🗑️ Your bag has been cleared!`, ephemeral: true });
    }
  }

  // ─── /gold ───────────────────────────────────────────────────────
  else if (commandName === 'gold') {
    const subcommand = interaction.options.getSubcommand();
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const char = charEntry.data;
    if (!charEntry.wallet) charEntry.wallet = { pp: 0, gp: 0, sp: 0, cp: 0 };
    const wallet = charEntry.wallet;

    if (subcommand === 'view') return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry)] });
    if (subcommand === 'add') {
      const pp = interaction.options.getInteger('pp') ?? 0;
      const gp = interaction.options.getInteger('gp') ?? 0;
      const sp = interaction.options.getInteger('sp') ?? 0;
      const cp = interaction.options.getInteger('cp') ?? 0;
      if (pp === 0 && gp === 0 && sp === 0 && cp === 0) return interaction.reply({ content: '❌ Specify at least one currency amount.', ephemeral: true });
      wallet.pp = (wallet.pp ?? 0) + pp;
      wallet.gp = (wallet.gp ?? 0) + gp;
      wallet.sp = (wallet.sp ?? 0) + sp;
      wallet.cp = (wallet.cp ?? 0) + cp;
      charEntry.wallet = wallet;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`💰 ${char.name}'s Wallet — Added ${formatWallet({ pp, gp, sp, cp })}`)] });
    }
    if (subcommand === 'spend') {
      const pp = interaction.options.getInteger('pp') ?? 0;
      const gp = interaction.options.getInteger('gp') ?? 0;
      const sp = interaction.options.getInteger('sp') ?? 0;
      const cp = interaction.options.getInteger('cp') ?? 0;
      if (pp === 0 && gp === 0 && sp === 0 && cp === 0) return interaction.reply({ content: '❌ Specify at least one currency amount.', ephemeral: true });
      const currentTotal = walletToCopper(wallet);
      const spendTotal = pp * 1000 + gp * 100 + sp * 10 + cp;
      if (spendTotal > currentTotal) return interaction.reply({ content: `❌ **${char.name}** can't afford that! They only have **${formatWallet(wallet)}**.`, ephemeral: true });
      charEntry.wallet = copperToWallet(currentTotal - spendTotal);
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`💸 ${char.name}'s Wallet — Spent ${formatWallet({ pp, gp, sp, cp })}`)] });
    }
    if (subcommand === 'convert') {
      const from   = interaction.options.getString('from');
      const to     = interaction.options.getString('to');
      const amount = interaction.options.getInteger('amount');
      if (from === to) return interaction.reply({ content: `❌ Can't convert ${from} to ${from}!`, ephemeral: true });
      const fromValue = COPPER_VALUE[from];
      const toValue   = COPPER_VALUE[to];
      const totalCopperToConvert = amount * fromValue;
      if ((wallet[from] ?? 0) < amount) return interaction.reply({ content: `❌ **${char.name}** only has **${wallet[from] ?? 0} ${from}**.`, ephemeral: true });
      if (fromValue < toValue && totalCopperToConvert < toValue) return interaction.reply({ content: `❌ ${amount} ${from} isn't worth even 1 ${to}.`, ephemeral: true });
      const converted = Math.floor(totalCopperToConvert / toValue);
      const remainder = totalCopperToConvert % toValue;
      wallet[from] = (wallet[from] ?? 0) - amount;
      wallet[to]   = (wallet[to]   ?? 0) + converted;
      wallet.cp    = (wallet.cp    ?? 0) + remainder;
      charEntry.wallet = wallet;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      const remainderNote = remainder > 0 ? ` (+${remainder} cp remainder)` : '';
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`🔄 ${char.name}'s Wallet — Converted`).setDescription(`Converted **${amount} ${from}** → **${converted} ${to}**${remainderNote}`)] });
    }
    if (subcommand === 'set') {
      charEntry.wallet = {
        pp: interaction.options.getInteger('pp') ?? wallet.pp ?? 0,
        gp: interaction.options.getInteger('gp') ?? wallet.gp ?? 0,
        sp: interaction.options.getInteger('sp') ?? wallet.sp ?? 0,
        cp: interaction.options.getInteger('cp') ?? wallet.cp ?? 0,
      };
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`✏️ ${char.name}'s Wallet — Updated`)] });
    }
  }

  // ─── /hero ───────────────────────────────────────────────────────
  else if (commandName === 'hero') {
    const sub = interaction.options.getSubcommand();
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const char = charEntry.data;
    const current = getHeroPoints(charEntry);

    if (sub === 'view') {
      return interaction.reply({ embeds: [buildHeroPointsEmbed(char, charEntry)] });
    }

    if (sub === 'add') {
      const amount = interaction.options.getInteger('amount') ?? 1;
      if (amount < 1) return interaction.reply({ content: '❌ Amount must be at least 1.', ephemeral: true });

      // Cap at 3 per the rules; report how many were actually added and if any were wasted
      const raw = current + amount;
      const capped = Math.min(raw, HERO_POINTS_MAX);
      charEntry.heroPoints = capped;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);

      const actuallyAdded = capped - current;
      const wasted = amount - actuallyAdded;
      let note;
      if (actuallyAdded === 0) note = `⚠️ **${char.name}** already has the max of ${HERO_POINTS_MAX}. No points added.`;
      else if (wasted > 0)    note = `✨ Awarded **+${amount}**, but ${wasted} exceeded the cap. Now at **${capped}/${HERO_POINTS_MAX}**.`;
      else                    note = `✨ Awarded **+${amount}**. Now at **${capped}/${HERO_POINTS_MAX}**.`;
      return interaction.reply({ embeds: [buildHeroPointsEmbed(char, charEntry, note)] });
    }

    if (sub === 'spend') {
      const amount = interaction.options.getInteger('amount') ?? 1;
      if (amount < 1) return interaction.reply({ content: '❌ Amount must be at least 1.', ephemeral: true });
      if (amount > current) return interaction.reply({ content: `❌ **${char.name}** only has **${current}** Hero Point${current === 1 ? '' : 's'}.`, ephemeral: true });

      charEntry.heroPoints = current - amount;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);

      const note = amount === current && amount >= 3
        ? `💫 **${char.name}** spent all **${amount}** Hero Points! *(Enough to avoid death and stabilize.)*`
        : `🎲 **${char.name}** spent **${amount}** Hero Point${amount === 1 ? '' : 's'}. **${charEntry.heroPoints}** remaining.`;
      return interaction.reply({ embeds: [buildHeroPointsEmbed(char, charEntry, note)] });
    }

    if (sub === 'set') {
      // Override — allows going above 3 if the GM really wants to
      const value = interaction.options.getInteger('value');
      if (value < 0) return interaction.reply({ content: '❌ Hero Points can\'t be negative.', ephemeral: true });
      charEntry.heroPoints = value;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      const overflow = value > HERO_POINTS_MAX ? ` *(above normal max of ${HERO_POINTS_MAX} — GM override)*` : '';
      const note = `✏️ Set to **${value}**${overflow}.`;
      return interaction.reply({ embeds: [buildHeroPointsEmbed(char, charEntry, note)] });
    }

    if (sub === 'reset') {
      // Reset to the session default (1)
      charEntry.heroPoints = HERO_POINTS_DEFAULT;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      const note = `🌅 Reset for a new session. **${char.name}** starts with **${HERO_POINTS_DEFAULT}**.`;
      return interaction.reply({ embeds: [buildHeroPointsEmbed(char, charEntry, note)] });
    }

    if (sub === 'reroll') {
      if (current < 1) return interaction.reply({ content: `❌ **${char.name}** has no Hero Points to spend. Use \`/hero add\` if the GM just awarded one.`, ephemeral: true });

      const dice = interaction.options.getString('dice');
      const previous = interaction.options.getInteger('previous'); // optional prior total for side-by-side

      const result = rollDiceExpression(dice);
      if (result.error) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });

      // Deduct 1 hero point (the reroll cost)
      charEntry.heroPoints = current - 1;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);

      // PF2e rule: keep the HIGHER of the two rolls. If user gave us their prior total, compare.
      let keepLine;
      if (previous !== null && previous !== undefined) {
        const kept = Math.max(previous, result.total);
        const improved = result.total > previous;
        keepLine = improved
          ? `**Kept: ${kept}** ✨ *(rerolled higher!)*`
          : result.total === previous
            ? `**Kept: ${kept}** *(tied)*`
            : `**Kept: ${kept}** *(previous roll was better)*`;
      } else {
        keepLine = `**Result: ${result.total}**\n*Keep the higher of your original roll and this one.*`;
      }

      const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`⭐ ${char.name} spends a Hero Point to reroll!`)
        .setDescription(
          (previous !== null && previous !== undefined ? `**Previous:** ${previous}\n` : '') +
          `**Reroll:** ${result.breakdown} = **${result.total}**\n\n` +
          keepLine + '\n\n' +
          `*Hero Points: ${renderHeroPointsBar(charEntry.heroPoints)} (${charEntry.heroPoints}/${HERO_POINTS_MAX})*`
        )
        .setFooter({ text: `${char.name} · 1 Hero Point spent` });
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      return interaction.reply({ embeds: [embed] });
    }
  }

  // ─── /hp ─────────────────────────────────────────────────────────
  // Out-of-combat HP tracking. Persists on charEntry.hp (bot-managed overlay),
  // clamped to [0, maxHp]. In-combat HP uses /init hp instead (tracked on the
  // combatant, not the character entry). This command is for between-combat
  // use: setting HP after a fight that wasn't tracked, healing over time, etc.
  else if (commandName === 'hp') {
    const sub = interaction.options.getSubcommand();
    const characters = loadCharacters();
    const charNameArg = interaction.options.getString('character');
    const { error, charKey, char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const char = charEntry.data;

    if (sub === 'view') {
      return interaction.reply({ embeds: [buildCharHpEmbed(char, charEntry)] });
    }

    if (sub === 'set') {
      const value = interaction.options.getInteger('value');
      if (value < 0) return interaction.reply({ content: '❌ HP cannot be negative.', ephemeral: true });
      const maxHp = computeCharMaxHp(charEntry);
      const oldHp = getCharacterHp(charEntry);
      const newHp = setCharacterHp(charEntry, value);
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      let note;
      if (value > maxHp) note = `✏️ Set to **${newHp}/${maxHp}** (clamped from requested ${value}).`;
      else note = `✏️ Set to **${newHp}/${maxHp}** (was ${oldHp}).`;
      return interaction.reply({ embeds: [buildCharHpEmbed(char, charEntry, note)] });
    }

    if (sub === 'add') {
      const value = interaction.options.getInteger('value');
      if (value === 0) return interaction.reply({ content: '❌ Amount cannot be 0.', ephemeral: true });
      const maxHp = computeCharMaxHp(charEntry);
      const oldHp = getCharacterHp(charEntry);
      const newHp = setCharacterHp(charEntry, oldHp + value);
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      const sign = value >= 0 ? '+' : '';
      const actuallyChanged = newHp - oldHp;
      let note;
      if (actuallyChanged === 0 && value > 0) note = `💚 Already at full HP (${maxHp}/${maxHp}).`;
      else if (actuallyChanged === 0 && value < 0) note = `💀 Already at 0 HP.`;
      else if (value > 0) note = `💚 Healed **+${actuallyChanged}** HP: ${oldHp} → **${newHp}**/${maxHp}.`;
      else note = `💔 Took **${value}** damage: ${oldHp} → **${newHp}**/${maxHp}.`;
      return interaction.reply({ embeds: [buildCharHpEmbed(char, charEntry, note)] });
    }

    if (sub === 'reset') {
      const maxHp = computeCharMaxHp(charEntry);
      charEntry.hp = maxHp;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      const note = `🌅 Fully healed: **${maxHp}/${maxHp}** HP.`;
      return interaction.reply({ embeds: [buildCharHpEmbed(char, charEntry, note)] });
    }
  }

  // ─── /xp ─────────────────────────────────────────────────────────
  // Per-character XP tracking. GM manually awards; bot auto-detects
  // level-up thresholds (every 1000 XP) and prompts to level up in
  // Pathbuilder. Bot never edits sheet data directly.
  else if (commandName === 'xp') {
    const sub = interaction.options.getSubcommand();
    const characters = loadCharacters();

    // All /xp subcommands need a character, but the character arg is optional
    // (defaults to the user's only loaded char, if they have exactly one).
    const charNameArg = interaction.options.getString('character');
    const { error, charKey, char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const char = charEntry.data;

    if (sub === 'view') {
      return interaction.reply({ embeds: [buildXpEmbed(char, charEntry, { showLog: true })] });
    }

    if (sub === 'award') {
      const amount = interaction.options.getInteger('amount');
      const reason = interaction.options.getString('reason');
      if (amount === 0) return interaction.reply({ content: '❌ Amount cannot be 0.', ephemeral: true });

      const { oldXp, newXp, leveledUp } = awardXp(charEntry, amount, reason, interaction.user.id);
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);

      const sign = amount >= 0 ? '+' : '';
      const note = `${amount >= 0 ? '✨' : '📉'} **${sign}${amount} XP**${reason ? ` — *${reason}*` : ''}\n${oldXp} → **${newXp}** XP`;
      const replyPayload = { embeds: [buildXpEmbed(char, charEntry, { note, showLog: false })] };

      // If they crossed a 1000 XP threshold, post a celebratory level-up embed too
      if (leveledUp) {
        replyPayload.embeds.push(buildLevelUpEmbed(char, charEntry, oldXp, newXp));
        // Ping the owner if someone else (e.g. GM) awarded the XP
        if (charEntry.ownerId && charEntry.ownerId !== interaction.user.id) {
          replyPayload.content = `<@${charEntry.ownerId}>`;
        } else if (interaction.user.id) {
          // Self-award still pings for visibility
          replyPayload.content = `<@${interaction.user.id}>`;
        }
      }
      return interaction.reply(replyPayload);
    }

    if (sub === 'set') {
      const amount = interaction.options.getInteger('amount');
      if (amount < 0) return interaction.reply({ content: '❌ XP cannot be negative.', ephemeral: true });
      const oldXp = getCharacterXp(charEntry);
      setCharacterXp(charEntry, amount);
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      const note = `✏️ Set XP to **${amount}** (was ${oldXp}).`;
      return interaction.reply({ embeds: [buildXpEmbed(char, charEntry, { note })] });
    }

    if (sub === 'reset') {
      // Zero the XP AND the log. Use this after leveling up in Pathbuilder
      // and running /char update, to start fresh toward the next level.
      const oldXp = getCharacterXp(charEntry);
      charEntry.xp = 0;
      charEntry.xpLog = [];
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      const note = `🌅 Reset XP to **0** (was ${oldXp}). Good luck on the road to the next level!`;
      return interaction.reply({ embeds: [buildXpEmbed(char, charEntry, { note })] });
    }
  }

  // ─── /notes ──────────────────────────────────────────────────────
  // Per-character session notebook. Categorized (NPCs/Locations/Plot Threads/
  // Influence/Items). Only the character's owner can add/edit/remove/pin;
  // anyone can view/search/list.
  else if (commandName === 'notes') {
    const sub = interaction.options.getSubcommand();
    const charNameArg = interaction.options.getString('character');
    const characters = loadCharacters();

    // Find the character — could be ANY character on the server, not just the
    // invoker's. We search every user's characters.
    let charOwnerId = null;
    let charKey = null;
    let charEntry = null;

    if (!charNameArg) {
      // No character specified — try to resolve the invoker's own default character.
      const own = resolveChar(interaction.user.id, null, characters);
      if (!own.error) {
        charOwnerId = interaction.user.id;
        charKey = own.charKey;
        charEntry = own.char;
      }
    } else {
      // Search across every user's characters for one with this name
      const target = String(charNameArg).toLowerCase();
      outer: for (const [ownerId, userChars] of Object.entries(characters)) {
        for (const [key, entry] of Object.entries(userChars)) {
          if (key.startsWith('_') || !entry || !entry.name) continue;
          if (entry.name.toLowerCase() === target) {
            charOwnerId = ownerId;
            charKey = key;
            charEntry = entry;
            break outer;
          }
        }
      }
    }

    if (!charEntry) {
      return interaction.reply({
        content: charNameArg
          ? `❌ No character named **"${charNameArg}"** found on this server.`
          : `❌ You don't have a character loaded. Specify one with \`character:<name>\`, or load one with \`/char add\`.`,
        ephemeral: true,
      });
    }

    const char = charEntry.data;
    const isOwner = interaction.user.id === charOwnerId;
    const notesData = loadNotes();
    const book = getNotebook(notesData, charOwnerId, charKey);

    // Helper: find note by id in this book, or return null
    const findNote = (id) => book.notes.find(n => n.id === id) ?? null;

    if (sub === 'add') {
      if (!isOwner) {
        return interaction.reply({ content: `❌ Only **${char.name}**'s owner can add notes to their notebook.`, ephemeral: true });
      }
      const category = interaction.options.getString('category');
      const text = interaction.options.getString('text');
      const pinned = interaction.options.getBoolean('pin') ?? false;
      if (!NOTE_CATEGORIES[category]) {
        return interaction.reply({ content: `❌ Invalid category. Choose one of: ${Object.values(NOTE_CATEGORIES).map(c => c.label).join(', ')}.`, ephemeral: true });
      }
      if (text.length > 1800) {
        return interaction.reply({ content: `❌ Note too long (${text.length} chars, max 1800).`, ephemeral: true });
      }
      const note = addNote(notesData, charOwnerId, charKey, {
        category, text, pinned,
        authorId: interaction.user.id,
        authorName: interaction.user.username,
      });
      if (!saveNotes(notesData)) {
        return interaction.reply({ content: `❌ Failed to save the note. Try again?`, ephemeral: true });
      }
      const cat = NOTE_CATEGORIES[category];
      return interaction.reply({
        content: `${cat.icon} Added note \`#${note.id}\` to **${char.name}**'s ${cat.label}${pinned ? ' *(pinned)*' : ''}.\n> ${truncateNote(text, 200)}`,
      });
    }

    if (sub === 'list') {
      const categoryFilter = interaction.options.getString('category');
      const pinnedOnly = interaction.options.getBoolean('pinned') ?? false;
      if (categoryFilter && !NOTE_CATEGORIES[categoryFilter]) {
        return interaction.reply({ content: `❌ Invalid category filter.`, ephemeral: true });
      }
      const embed = buildNotebookEmbed(char, book.notes, { categoryFilter, pinnedOnly });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'view') {
      const id = interaction.options.getInteger('id');
      const note = findNote(id);
      if (!note) return interaction.reply({ content: `❌ No note with ID **#${id}** in **${char.name}**'s notebook.`, ephemeral: true });
      return interaction.reply({ embeds: [buildNoteDetailEmbed(char, note)] });
    }

    if (sub === 'search') {
      const query = interaction.options.getString('query').toLowerCase();
      const matches = book.notes.filter(n => n.text.toLowerCase().includes(query));
      if (matches.length === 0) {
        return interaction.reply({ content: `🔍 No notes matching **"${query}"** in **${char.name}**'s notebook.`, ephemeral: true });
      }
      const sorted = sortNotes(matches);
      const embed = new EmbedBuilder()
        .setColor(0x7b5ea7)
        .setTitle(`🔍 Search: "${query}" in ${char.name}'s notebook`)
        .setDescription(`Found **${matches.length}** matching note${matches.length === 1 ? '' : 's'}.`);

      // Group matches by category for readability
      for (const catKey of NOTE_CATEGORY_ORDER) {
        const inCat = sorted.filter(n => n.category === catKey);
        if (inCat.length === 0) continue;
        const cat = NOTE_CATEGORIES[catKey];
        const lines = inCat.map(formatNoteLine).join('\n');
        embed.addFields({
          name: `${cat.icon} ${cat.label} (${inCat.length})`,
          value: lines.length > 1020 ? lines.slice(0, 1020) + '\n*…more.*' : lines,
          inline: false,
        });
      }
      embed.setFooter({ text: `Tip: /notes view id:<n> for full detail` });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'edit') {
      if (!isOwner) return interaction.reply({ content: `❌ Only **${char.name}**'s owner can edit notes in their notebook.`, ephemeral: true });
      const id = interaction.options.getInteger('id');
      const newText = interaction.options.getString('text');
      const note = findNote(id);
      if (!note) return interaction.reply({ content: `❌ No note with ID **#${id}**.`, ephemeral: true });
      if (note.authorId !== interaction.user.id) {
        return interaction.reply({ content: `❌ Only the person who wrote note **#${id}** (${note.authorName}) can edit it.`, ephemeral: true });
      }
      if (newText.length > 1800) return interaction.reply({ content: `❌ Note too long (${newText.length} chars, max 1800).`, ephemeral: true });
      note.text = newText;
      note.editedAt = new Date().toISOString();
      if (!saveNotes(notesData)) return interaction.reply({ content: `❌ Failed to save.`, ephemeral: true });
      return interaction.reply({ embeds: [buildNoteDetailEmbed(char, note)] });
    }

    if (sub === 'remove') {
      if (!isOwner) return interaction.reply({ content: `❌ Only **${char.name}**'s owner can remove notes from their notebook.`, ephemeral: true });
      const id = interaction.options.getInteger('id');
      const note = findNote(id);
      if (!note) return interaction.reply({ content: `❌ No note with ID **#${id}**.`, ephemeral: true });
      if (note.authorId !== interaction.user.id) {
        return interaction.reply({ content: `❌ Only the person who wrote note **#${id}** (${note.authorName}) can remove it.`, ephemeral: true });
      }
      book.notes = book.notes.filter(n => n.id !== id);
      if (!saveNotes(notesData)) return interaction.reply({ content: `❌ Failed to save.`, ephemeral: true });
      const cat = NOTE_CATEGORIES[note.category];
      return interaction.reply({ content: `🗑️ Removed note \`#${id}\` from **${char.name}**'s ${cat.label}.` });
    }

    if (sub === 'pin') {
      if (!isOwner) return interaction.reply({ content: `❌ Only **${char.name}**'s owner can pin notes in their notebook.`, ephemeral: true });
      const id = interaction.options.getInteger('id');
      const note = findNote(id);
      if (!note) return interaction.reply({ content: `❌ No note with ID **#${id}**.`, ephemeral: true });
      note.pinned = !note.pinned;
      if (!saveNotes(notesData)) return interaction.reply({ content: `❌ Failed to save.`, ephemeral: true });
      return interaction.reply({
        content: `${note.pinned ? '📌' : '📍'} Note \`#${id}\` is now ${note.pinned ? '**pinned**' : '**unpinned**'}.`,
      });
    }
  }

  // ─── /init ───────────────────────────────────────────────────────
  else if (commandName === 'init') {
    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;

    if (sub === 'start') {
      if (getEncounter(channelId)) return interaction.reply({ content: '⚠️ An encounter is already active here. Use `/init end` first.', ephemeral: true });
      const newEnc = createEncounter(channelId, userId);
      await interaction.reply(
        `⚔️ Combat started! <@${userId}> is the GM.\n` +
        `Players: use \`/init add\` to join. GM: use \`/init addnpc\` for monsters.\n` +
        `When everyone is in, the GM uses \`/init next\` to begin.`
      );
      await updateSummary(interaction.channel, newEnc);
      return;
    }

    const enc = getEncounter(channelId);
    if (!enc) return interaction.reply({ content: '❌ No active encounter. Start one with `/init start`.', ephemeral: true });

    if (sub === 'add') {
      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });

      const charName = charEntry.name;
      if (enc.combatants.some(x => x.name.toLowerCase() === charName.toLowerCase())) return interaction.reply({ content: `❌ ${charName} is already in the encounter.`, ephemeral: true });

      const perception = computeCharPerception(charEntry);
      const maxHp = computeCharMaxHp(charEntry);
      const bonusOverride = interaction.options.getInteger('bonus');
      const resultOverride = interaction.options.getInteger('result');
      const bonus = bonusOverride ?? perception;

      let initiative, rollText;
      if (resultOverride !== null) {
        initiative = resultOverride;
        rollText = `(set to ${resultOverride})`;
      } else {
        const r = rollD20Plus(bonus);
        initiative = r.total;
        rollText = `(rolled ${r.roll} ${fmt(r.mod)})`;
      }

      const charAc = charEntry.data?.acTotal?.acTotal ?? null;
      addCombatant(channelId, {
        name: charName,
        initiative,
        hp: maxHp,
        maxHp,
        ac: charAc,
        ownerId: userId,
        isNpc: false,
        effects: [],
      });

      await interaction.reply(`✅ **${charName}** joined initiative at **${initiative}** ${rollText}.`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'addnpc') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can add NPCs.', ephemeral: true });

      const name = interaction.options.getString('name');
      const bonus = interaction.options.getInteger('bonus');
      const hp = interaction.options.getInteger('hp');
      const ac = interaction.options.getInteger('ac');
      const resultOverride = interaction.options.getInteger('result');

      if (enc.combatants.some(x => x.name.toLowerCase() === name.toLowerCase())) return interaction.reply({ content: `❌ A combatant named "${name}" already exists. Use a unique name (e.g. "Goblin 1").`, ephemeral: true });

      let initiative, rollText;
      if (resultOverride !== null) {
        initiative = resultOverride;
        rollText = `(set to ${resultOverride})`;
      } else {
        const r = rollD20Plus(bonus);
        initiative = r.total;
        rollText = `(rolled ${r.roll} ${fmt(r.mod)})`;
      }

      addCombatant(channelId, {
        name,
        initiative,
        hp,
        maxHp: hp,
        ac,
        ownerId: userId,
        isNpc: true,
        effects: [],
      });

      await interaction.reply(`👹 **${name}** joined initiative at **${initiative}** ${rollText}.`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init addmonster ─────────────────────────────────────────────
    // Pull name/HP/AC/perception straight from bestiary.json. Supports
    // count for multi-spawns (auto-numbered "Goblin Warrior 1", 2, etc.).
    // GM chooses whether to roll initiative once (shared) or per-copy,
    // and whether to use the published HP or roll a d10 wiggle.
    if (sub === 'addmonster') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can add monsters.', ephemeral: true });

      const input = interaction.options.getString('monster');
      const count = interaction.options.getInteger('count') ?? 1;
      const initMode = interaction.options.getString('init_mode') ?? 'per_copy';
      const hpMode = interaction.options.getString('hp_mode') ?? 'fixed';
      const bonusOverride = interaction.options.getInteger('bonus');
      const resultOverride = interaction.options.getInteger('result');

      if (count < 1 || count > 20) return interaction.reply({ content: '❌ Count must be between 1 and 20.', ephemeral: true });

      // Look up the monster, falling back to match suggestions
      const { monster, matches, total } = findMonster(input);
      if (!monster) {
        if (matches && matches.length > 1) {
          const preview = matches.slice(0, 10).map(n => `• **${n}**`).join('\n');
          const totalCount = total ?? matches.length;
          const extra = totalCount > 10 ? `\n*…and ${totalCount - 10} more.*` : '';
          return interaction.reply({ content: `🔍 Multiple creatures match **"${input}"**:\n${preview}${extra}`, ephemeral: true });
        }
        return interaction.reply({ content: `❌ No creature named **"${input}"** in the bestiary.`, ephemeral: true });
      }

      // Apply GM edits + attack library so added monsters have the overlays
      // their bestiary entry promises (same pipeline as /monster shows).
      const edits = getMonsterEdit(interaction.guildId, monster.name);
      const edited = applyMonsterEdits(monster, edits);
      const withLibrary = applyMonsterAttackLibrary(edited, interaction.guildId);
      const core = withLibrary.core ?? {};
      const summary = withLibrary.summary ?? {};
      const rich = withLibrary.rich ?? null;

      const baseHp = core.hp ?? summary.summary?.hp?.value ?? rich?.defenses?.hp ?? null;
      const ac = core.ac ?? summary.summary?.ac ?? rich?.defenses?.ac ?? null;
      const perception = core.perception ?? summary.summary?.perception ?? rich?.perception ?? null;

      if (baseHp === null || baseHp === undefined) {
        return interaction.reply({ content: `❌ **${monster.name}** has no HP value in the bestiary. Use \`/init addnpc\` or \`/monsteredit\` to fix it.`, ephemeral: true });
      }

      // Bonus defaults to published perception; GM can override
      const bonus = bonusOverride ?? perception ?? 0;

      // For shared init, roll once up front
      let sharedInit = null, sharedRollText = '';
      if (resultOverride !== null) {
        sharedInit = resultOverride;
        sharedRollText = `(set to ${resultOverride})`;
      } else if (initMode === 'shared') {
        const r = rollD20Plus(bonus);
        sharedInit = r.total;
        sharedRollText = `(rolled ${r.roll} ${fmt(r.mod)})`;
      }

      // Figure out how to compute HP per copy
      const rollHp = () => {
        if (hpMode === 'fixed') return baseHp;
        // 'varied': apply a d10 wiggle — ±5 around the published HP, clamped
        // to ≥1. This isn't a full HP formula (bestiary doesn't store one),
        // just a way to avoid four identical goblins at exactly 14 HP each.
        const wiggle = Math.floor(Math.random() * 11) - 5;
        return Math.max(1, baseHp + wiggle);
      };

      // Auto-number copies, skipping names already in the encounter.
      const baseName = monster.name;
      const existingNames = new Set(enc.combatants.map(c => c.name.toLowerCase()));
      const addedLines = [];
      let skipped = 0;
      for (let i = 1; i <= count; i++) {
        // Try "baseName 1", "baseName 2", ... until we find one not taken.
        // If count === 1 and there's no existing "baseName", use "baseName" alone.
        let name;
        if (count === 1 && !existingNames.has(baseName.toLowerCase())) {
          name = baseName;
        } else {
          let suffix = i;
          while (existingNames.has(`${baseName} ${suffix}`.toLowerCase())) suffix++;
          name = `${baseName} ${suffix}`;
        }
        existingNames.add(name.toLowerCase());

        let initiative, rollText;
        if (initMode === 'shared' || resultOverride !== null) {
          initiative = sharedInit;
          rollText = sharedRollText;
        } else {
          const r = rollD20Plus(bonus);
          initiative = r.total;
          rollText = `(${r.roll} ${fmt(r.mod)})`;
        }

        const hp = rollHp();
        addCombatant(channelId, {
          name,
          initiative,
          hp,
          maxHp: hp,
          ac,
          ownerId: userId,
          isNpc: true,
          effects: [],
          // Stash the bestiary key so future features (e.g. "show this combatant's
          // stat block") can look them up without having to re-search.
          bestiaryKey: monster.name,
        });
        addedLines.push(`• **${name}** — init **${initiative}** ${rollText}, HP ${hp}, AC ${ac ?? '?'}`);
      }

      const header = `👹 Added **${count}× ${baseName}** to initiative${skipped ? ` (${skipped} name collision(s) auto-renumbered)` : ''}:`;
      await interaction.reply(`${header}\n${addedLines.join('\n')}`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'next') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can advance turns.', ephemeral: true });
      if (enc.combatants.length === 0) return interaction.reply({ content: '❌ No combatants in the encounter yet.', ephemeral: true });

      // ca.processTurnTransition handles: persistent damage tick on outgoing
      // combatant, advanceTurn (effect duration ticks), MAP/reaction reset, and
      // recovery check on incoming combatant if dying.
      const result = ca.processTurnTransition(channelId);
      const current = result.current;
      const mention = current.isNpc ? `<@${enc.gmId}>` : `<@${current.ownerId}>`;

      // Diagnostic logging — helps us see what happened if auto-roll doesn't fire
      console.log(`[init next] Advanced to ${current.name} (isNpc=${current.isNpc}, hp=${current.hp}/${current.maxHp}, dying=${current.dying ?? 0}, wounded=${current.wounded ?? 0}). recoveryCheck=${result.recoveryCheck ? 'fired' : 'not-triggered'}`);

      const lines = [`🎯 It's **${current.name}**'s turn! ${mention}`];

      // Show new round banner
      if (result.newRound) {
        lines.push(`🔄 **Round ${enc.round}** — all reactions refreshed.`);
      }

      // Show expired effects
      if (result.expiredEffects && result.expiredEffects.length > 0) {
        const expiredText = result.expiredEffects.map(x => `**${x.effect.name}** on **${x.combatantName}**`).join(', ');
        lines.push(`⏳ Expired: ${expiredText}`);
      }

      // Show persistent damage results from outgoing combatant
      if (result.persistentResults && result.persistentResults.length > 0) {
        for (const pr of result.persistentResults) {
          const flatStatus = pr.ended
            ? `🩹 *Flat check ${pr.flatRoll} ≥ ${pr.flatDc} — condition ends.*`
            : `🔁 *Flat check ${pr.flatRoll} < ${pr.flatDc} — persists.*`;
          const dyingTag = pr.died ? ' ☠️ **Dead!**' : pr.wentDown ? ` 💀 (Dying ${pr.dying})` : '';
          lines.push(`🩸 **${pr.name}** ticks: ${pr.damageDice}[${pr.damageRolls.join(',')}] = ${pr.damage} ${pr.damageType} damage${dyingTag}\n${flatStatus}`);
        }
      }

      // Hint to the GM if the combatant is dying but the check didn't fire
      // (shouldn't happen, but diagnostic aid for the user)
      if ((current.dying ?? 0) > 0 && !result.recoveryCheck) {
        lines.push(`⚠️ **${current.name}** is Dying ${current.dying} but no recovery check auto-rolled. Use \`/init recovery name:${current.name}\` to force a roll.`);
      }

      const replyPayload = { content: lines.join('\n') };
      if (result.recoveryCheck) {
        const payload = buildRecoveryCheckPayload(result.recoveryCheck, current);
        replyPayload.embeds = payload.embeds;
        if (payload.components.length) replyPayload.components = payload.components;
      }

      await interaction.reply(replyPayload);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'list') return interaction.reply({ embeds: [buildInitiativeEmbed(enc)] });

    if (sub === 'hp') {
      const name = interaction.options.getString('name');
      const change = interaction.options.getInteger('change');
      const combatant = enc.combatants.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!combatant) return interaction.reply({ content: `❌ No combatant named "${name}".`, ephemeral: true });
      if (combatant.ownerId !== userId && enc.gmId !== userId) return interaction.reply({ content: '❌ You can only modify HP for your own character (or any, if GM).', ephemeral: true });

      // Use ca.applyHpChange so dying/wounded transitions are handled automatically.
      const result = ca.applyHpChange(channelId, name, change);
      const verb = change >= 0 ? 'healed' : 'took';
      const amount = Math.abs(change);
      const dyingNote = result?.displaySuffix ?? '';
      await interaction.reply(`❤️ **${combatant.name}** ${verb} ${amount} → ${combatant.hp}/${combatant.maxHp} HP${dyingNote}`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'remove') {
      const name = interaction.options.getString('name');
      const result = removeCombatant(channelId, name);
      if (!result) return interaction.reply({ content: `❌ No combatant named "${name}".`, ephemeral: true });
      await interaction.reply(`🗑️ Removed **${name}** from initiative.`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'effect') {
      const targetName = interaction.options.getString('target');
      const effectName = interaction.options.getString('name');
      const value = interaction.options.getInteger('value');
      const duration = interaction.options.getInteger('duration');

      const target = findCombatant(enc, targetName);
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });

      const preset = getPreset(effectName);
      let effect;

      if (preset) {
        const modifiers = preset.build(value ?? 1);
        effect = {
          name: preset.name,
          value: preset.scaling ? (value ?? 1) : null,
          duration: duration ?? null,
          modifiers,
          isPreset: true,
          presetKey: preset.key,
          appliedBy: userId,
        };
      } else {
        const modifiers = {
          attackBonus: interaction.options.getInteger('attack_bonus') ?? 0,
          damageBonus: interaction.options.getInteger('damage_bonus') ?? 0,
          acBonus: interaction.options.getInteger('ac_bonus') ?? 0,
          saveBonus: interaction.options.getInteger('save_bonus') ?? 0,
          skillBonus: interaction.options.getInteger('skill_bonus') ?? 0,
          description: interaction.options.getString('description') ?? '(custom effect)',
        };
        effect = {
          name: effectName,
          value: value ?? null,
          duration: duration ?? null,
          modifiers,
          isPreset: false,
          presetKey: null,
          appliedBy: userId,
        };
      }

      const result = addEffect(channelId, target.name, effect);
      if (!result) return interaction.reply({ content: `❌ Failed to apply effect.`, ephemeral: true });

      const modLines = [];
      const m = effect.modifiers;
      if (m.attackBonus) modLines.push(`Attack: ${fmt(m.attackBonus)}`);
      if (m.damageBonus) modLines.push(`Damage: ${fmt(m.damageBonus)}`);
      if (m.acBonus)     modLines.push(`AC: ${fmt(m.acBonus)}`);
      if (m.saveBonus)   modLines.push(`Saves: ${fmt(m.saveBonus)}`);
      if (m.skillBonus)  modLines.push(`Skills: ${fmt(m.skillBonus)}`);

      const valueText = effect.value !== null ? ` ${effect.value}` : '';
      const durationText = effect.duration !== null ? ` for ${effect.duration} round${effect.duration === 1 ? '' : 's'}` : '';
      const replacedText = result.replaced ? ' (replaced existing)' : '';
      const modText = modLines.length > 0 ? `\n**Modifiers:** ${modLines.join(', ')}` : '';
      const descText = m.description ? `\n*${m.description}*` : '';

      await interaction.reply(`🌀 Applied **${effect.name}${valueText}** to **${target.name}**${durationText}${replacedText}${modText}${descText}`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'removeeffect') {
      const targetName = interaction.options.getString('target');
      const effectName = interaction.options.getString('name');

      const target = findCombatant(enc, targetName);
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });

      const result = removeEffect(channelId, target.name, effectName);
      if (!result) return interaction.reply({ content: `❌ **${target.name}** doesn't have an effect named "${effectName}".`, ephemeral: true });

      await interaction.reply(`🧹 Removed **${result.effect.name}** from **${target.name}**.`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'effects') {
      const targetName = interaction.options.getString('target');
      const target = findCombatant(enc, targetName);
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });

      if (!target.effects || target.effects.length === 0) return interaction.reply(`**${target.name}** has no active effects.`);

      const lines = target.effects.map(e => {
        const valueText = e.value !== null && e.value !== undefined ? ` ${e.value}` : '';
        const durationText = e.duration !== null && e.duration !== undefined ? ` — ${e.duration} round${e.duration === 1 ? '' : 's'} left` : ' — permanent';
        const desc = e.modifiers?.description ? `\n    *${e.modifiers.description}*` : '';
        return `• **${e.name}${valueText}**${durationText}${desc}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`🌀 ${target.name}'s Active Effects`)
        .setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'conditions') {
      const presets = listPresets();
      const scaling = presets.filter(p => p.scaling).map(p => p.name).sort();
      const flat = presets.filter(p => !p.scaling).map(p => p.name).sort();

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🌀 Available PF2e Conditions')
        .setDescription('Use `/init effect target:<name> name:<condition>` to apply one. Conditions with values need the `value:` option (e.g. Frightened 2).')
        .addFields(
          { name: 'Scaling (need a value)', value: scaling.join(', '), inline: false },
          { name: 'Flat', value: flat.join(', '), inline: false },
          { name: 'Custom Effects', value: 'Use any name not in the list and provide your own `attack_bonus`, `damage_bonus`, `ac_bonus`, `save_bonus`, or `skill_bonus` options.', inline: false }
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'end') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can end the encounter.', ephemeral: true });
      await clearSummary(interaction.channel, enc);
      deleteEncounter(channelId);
      return interaction.reply('🏁 Combat ended. Well fought!');
    }

    // ── /init move ──
    // Manual movement trigger for Attacks of Opportunity. Since the bot
    // doesn't know positioning, the GM/player calls this when someone
    // moves out of an enemy's reach. Bot prompts all combatants with
    // reactions available.
    if (sub === 'move') {
      const moverName = interaction.options.getString('name');
      const mover = enc.combatants.find(x => x.name.toLowerCase() === moverName.toLowerCase());
      if (!mover) return interaction.reply({ content: `❌ No combatant named "${moverName}".`, ephemeral: true });

      const reactors = ca.findPotentialReactors(channelId, moverName);
      if (reactors.length === 0) {
        return interaction.reply(`🏃 **${mover.name}** moves. No combatants have reactions available.`);
      }

      // Build a single message with one row per reactor (max 5 due to Discord button limit)
      const lines = [`🏃 **${mover.name}** moves — provoking attacks of opportunity?`];
      const components = [];
      for (const reactor of reactors.slice(0, 5)) {
        const reactorMention = reactor.isNpc ? `<@${enc.gmId}>` : (reactor.ownerId ? `<@${reactor.ownerId}>` : '');
        lines.push(`${reactorMention} **${reactor.name}** has a reaction available.`);
        const safeName = reactor.name.replace(/[^a-zA-Z0-9]/g, '_');
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`reaction_trigger_${safeName}`)
            .setLabel(`${reactor.name}: AoO`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎲'),
          new ButtonBuilder()
            .setCustomId(`reaction_skip_${safeName}`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary),
        ));
      }
      if (reactors.length > 5) {
        lines.push(`*…and ${reactors.length - 5} more (Discord caps at 5 buttons per message). Use \`/init reaction\` for the rest.*`);
      }
      return interaction.reply({ content: lines.join('\n'), components });
    }

    // ── /init reaction ──
    // Manual reaction prompt for any edge case (Shield Block, Reactive Shield,
    // narrative triggers, etc.) Lets the GM ping a specific combatant.
    if (sub === 'reaction') {
      const reactorName = interaction.options.getString('name');
      const reason = interaction.options.getString('reason') ?? 'something just happened';
      const reactor = enc.combatants.find(x => x.name.toLowerCase() === reactorName.toLowerCase());
      if (!reactor) return interaction.reply({ content: `❌ No combatant named "${reactorName}".`, ephemeral: true });
      if (!ca.hasReactionAvailable(reactor)) {
        return interaction.reply({ content: `⚠️ **${reactor.name}** has already used their reaction this round (or is dying).`, ephemeral: true });
      }

      const reactorMention = reactor.isNpc ? `<@${enc.gmId}>` : (reactor.ownerId ? `<@${reactor.ownerId}>` : '');
      const safeName = reactor.name.replace(/[^a-zA-Z0-9]/g, '_');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`reaction_trigger_${safeName}`)
          .setLabel(`${reactor.name}: Trigger Reaction`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎲'),
        new ButtonBuilder()
          .setCustomId(`reaction_skip_${safeName}`)
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary),
      );
      return interaction.reply({
        content: `${reactorMention} ⤾ **${reactor.name}** — reaction prompt: *${reason}*`,
        components: [row],
      });
    }

    // ── /init damage ──
    // Manually trigger persistent damage roll for a combatant outside the
    // normal turn-end tick. Useful when a GM forgot to /init next or wants
    // to apply a one-off dot.
    if (sub === 'damage') {
      const targetName = interaction.options.getString('name');
      const target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}".`, ephemeral: true });
      const persistentResults = ca.tickPersistentDamage(channelId, target.name);
      if (persistentResults.length === 0) {
        return interaction.reply({ content: `**${target.name}** has no persistent damage to roll.`, ephemeral: true });
      }
      const lines = [`🩸 Manually rolling persistent damage on **${target.name}**:`];
      for (const pr of persistentResults) {
        const flatStatus = pr.ended
          ? `🩹 *Flat check ${pr.flatRoll} ≥ ${pr.flatDc} — condition ends.*`
          : `🔁 *Flat check ${pr.flatRoll} < ${pr.flatDc} — persists.*`;
        const dyingTag = pr.died ? ' ☠️ **Dead!**' : pr.wentDown ? ` 💀 (Dying ${pr.dying})` : '';
        lines.push(`**${pr.name}**: ${pr.damageDice}[${pr.damageRolls.join(',')}] = ${pr.damage} ${pr.damageType}${dyingTag}\n${flatStatus}`);
      }
      await interaction.reply(lines.join('\n'));
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init dying ──
    // Manually set a combatant's dying value (override the auto-applied value
    // for cases like a critical effect that bumps dying directly).
    if (sub === 'dying') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can override dying values.', ephemeral: true });
      const targetName = interaction.options.getString('name');
      const value = interaction.options.getInteger('value');
      const target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}".`, ephemeral: true });
      if (value < 0 || value > 4) return interaction.reply({ content: '❌ Dying value must be 0–4.', ephemeral: true });

      const before = target.dying ?? 0;
      target.dying = value;
      let extra = '';
      if (value === 0 && before > 0) {
        // Recovered — bump wounded
        target.wounded = (target.wounded ?? 0) + 1;
        if (target.hp <= 0) target.hp = 1;
        extra = ` ✨ Recovered (now Wounded ${target.wounded}, HP 1)`;
      } else if (value >= 4) {
        extra = ' ☠️ **Dead!**';
      }
      await interaction.reply(`💀 **${target.name}** dying set to ${value} (was ${before}).${extra}`);
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init recovery ──
    // Manually force a recovery check roll for a dying combatant. Useful as a
    // reliability backup when the auto-roll on turn start doesn't fire, or to
    // force an off-turn recovery check (e.g. "the party just stopped combat
    // to stabilize the fallen; everyone dying rolls now"). The roll rules and
    // display are identical to the auto-rolled version, and the Hero Point
    // reroll button is available.
    if (sub === 'recovery') {
      const targetName = interaction.options.getString('name');
      const target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}".`, ephemeral: true });

      // Permission: GM can roll for anyone; players can only roll for their own PC
      const isOwner = !target.isNpc && interaction.user.id === target.ownerId;
      const isGm = interaction.user.id === enc.gmId;
      if (!isOwner && !isGm) {
        return interaction.reply({ content: `❌ Only ${target.isNpc ? 'the GM' : 'the combatant\'s owner (or GM)'} can roll recovery for **${target.name}**.`, ephemeral: true });
      }

      if ((target.dying ?? 0) <= 0) {
        return interaction.reply({ content: `❌ **${target.name}** isn't dying (Dying ${target.dying ?? 0}). No recovery check needed.\n\n*If they SHOULD be dying, a GM can use \`/init dying name:${target.name} value:1\` to set it.*`, ephemeral: true });
      }

      console.log(`[init recovery] Manual recovery check for ${target.name} (dying=${target.dying}, wounded=${target.wounded ?? 0})`);

      const rc = ca.rollRecoveryCheck(channelId, target.name);
      if (!rc) {
        return interaction.reply({ content: `❌ Failed to roll recovery check. (This shouldn't happen — please report.)`, ephemeral: true });
      }

      const payload = buildRecoveryCheckPayload(rc, target);
      await interaction.reply(payload);
      await updateSummary(interaction.channel, enc);
      return;
    }
  }

  // ─── /attack ─────────────────────────────────────────────────────
  else if (commandName === 'attack') {
    const weaponName = interaction.options.getString('weapon');
    const targetName = interaction.options.getString('target');
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const explicitMap = interaction.options.getInteger('map'); // null if unset
    const noMap = interaction.options.getBoolean('no_map') ?? false;
    const characters = loadCharacters();

    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });

    const c = charEntry.data;
    const weapons = c.weapons ?? [];

    const weapon = weapons.find(w => (w.display ?? w.name).toLowerCase() === weaponName.toLowerCase())
      ?? weapons.find(w => (w.display ?? w.name).toLowerCase().includes(weaponName.toLowerCase()));
    if (!weapon) {
      const available = weapons.map(w => w.display ?? w.name).join(', ') || 'none';
      return interaction.reply({ content: `❌ Couldn't find weapon "${weaponName}" on ${c.name}. Available: ${available}`, ephemeral: true });
    }

    const hasAgile = (weapon.traits ?? []).map(t => t.toLowerCase()).includes('agile');

    const channelId = interaction.channel.id;
    const enc = getEncounter(channelId);

    // Look up attacker in encounter to get their active effects + MAP state
    const attackerCombatant = enc ? enc.combatants.find(x => x.name.toLowerCase() === c.name.toLowerCase()) : null;
    const attackerMods = sumEffectModifiers(attackerCombatant);

    // ── Auto-MAP ──
    // If user passed map: explicitly, honor it. Otherwise, compute from
    // attacksThisTurn tracked on the combatant. The no_map flag (e.g. for
    // Flurry of Blows) skips MAP entirely.
    let mapPenalty, mapNoteText;
    if (noMap) {
      mapPenalty = 0;
      mapNoteText = null;
    } else if (explicitMap !== null) {
      mapPenalty = explicitMap === 0 ? 0 : explicitMap === 1 ? (hasAgile ? -4 : -5) : (hasAgile ? -8 : -10);
      mapNoteText = explicitMap > 0 ? `MAP ${mapPenalty} (manual)` : null;
    } else if (attackerCombatant) {
      const mapInfo = ca.computeMapForNextAttack(attackerCombatant, hasAgile);
      mapPenalty = mapInfo.penalty;
      mapNoteText = mapInfo.noteText;
    } else {
      // Not in an encounter — no MAP tracking possible
      mapPenalty = 0;
      mapNoteText = null;
    }

    // Look up target
    let target = null;
    if (targetName) {
      if (!enc) return interaction.reply({ content: '❌ Target specified but no active encounter in this channel. Start one with `/init start`.', ephemeral: true });
      target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });
    }
    const targetMods = target ? sumEffectModifiers(target) : { acBonus: 0, activeEffects: [] };

    const baseAttackBonus = weapon.attack ?? 0;
    const dieRoll = Math.floor(Math.random() * 20) + 1;
    const attackTotal = dieRoll + baseAttackBonus + extraBonus + mapPenalty + attackerMods.attackBonus;

    // Effective target AC includes effect modifiers
    const baseTargetAc = target?.ac ?? null;
    const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;

    const targetDegree = effectiveTargetAc !== null
      ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc)
      : null;

    // Roll damage
    const dieSize = weapon.die ?? 'd4';
    const damageBonusBase = weapon.damageBonus ?? 0;
    const damageType = weapon.damageType === 'P' ? 'piercing'
      : weapon.damageType === 'S' ? 'slashing'
      : weapon.damageType === 'B' ? 'bludgeoning'
      : (weapon.damageType ?? '').toLowerCase();

    const dieMatch = dieSize.match(/^(\d*)d(\d+)$/i);
    const numDice = dieMatch ? (parseInt(dieMatch[1]) || 1) : 1;
    const numSides = dieMatch ? parseInt(dieMatch[2]) : 4;
    const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * numSides) + 1);
    const damageRollSum = rolls.reduce((a, b) => a + b, 0);
    const totalDamageBonus = damageBonusBase + attackerMods.damageBonus;
    const damageTotal = Math.max(1, damageRollSum + totalDamageBonus);

    // Build attack line. Auto-MAP shows "Attack #2 this turn · MAP -5" instead
    // of just "-5" so the player learns where the penalty came from.
    const mapText = mapPenalty !== 0 ? ` ${mapPenalty}` : '';
    const bonusText = extraBonus !== 0 ? ` ${fmt(extraBonus)}` : '';
    const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
    let attackLine = `**Attack Roll**\n1d20 (${dieRoll}) ${fmt(baseAttackBonus)}${mapText}${bonusText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
    if (mapNoteText) attackLine += `\n*${mapNoteText}*`;
    if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
    if (dieRoll === 20) attackLine += '\n⭐ Natural 20!';
    if (dieRoll === 1)  attackLine += '\n💀 Natural 1!';

    // Build damage line
    let finalDamage = damageTotal;
    const damageContribText = formatEffectContributions(attackerMods.activeEffects, 'damage');
    const damageBonusDisplay = totalDamageBonus !== 0 ? fmt(totalDamageBonus) : '';
    let damageLine;
    if (targetDegree === 'crit-success') {
      finalDamage = damageTotal * 2;
      damageLine = `**Damage (CRIT × 2)**\n${numDice}d${numSides}[${rolls.join(', ')}] ${damageBonusDisplay} = ${damageTotal} × 2 = **${finalDamage} ${damageType}**`;
    } else {
      damageLine = `**Damage**\n${numDice}d${numSides}[${rolls.join(', ')}] ${damageBonusDisplay} = **${finalDamage} ${damageType}**`;
    }
    if (damageContribText) damageLine += `\n*${damageContribText.trim().slice(1, -1)}*`;

    // Outcome with AC breakdown
    const acBreakdown = baseTargetAc !== null && targetMods.acBonus !== 0
      ? ` (base ${baseTargetAc}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAc})`
      : '';
    let outcomeLine = '';
    if (targetDegree === 'crit-success') outcomeLine = `🎯 **Critical Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (targetDegree === 'success')      outcomeLine = `✅ **Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (targetDegree === 'failure')      outcomeLine = `❌ **Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (targetDegree === 'crit-failure') outcomeLine = `💢 **Critical Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
    else if (target)                          outcomeLine = `🎯 Attack against **${target.name}** (AC unknown — GM decides)`;

    let hpLine = '';
    let mentionLine = '';
    if (target && (targetDegree === 'success' || targetDegree === 'crit-success')) {
      const dmgResult = ca.applyDamage(channelId, target.name, finalDamage);
      const dyingNote = dmgResult?.displaySuffix ?? '';
      hpLine = target.isNpc
        ? `\n❤️ **${target.name}** took ${finalDamage} damage${dyingNote}`
        : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
      if (!target.isNpc && target.ownerId) mentionLine = `<@${target.ownerId}> `;
    } else if (target && !target.isNpc && target.ownerId) {
      mentionLine = `<@${target.ownerId}> `;
    }

    // Record attack for MAP tracking (after the attack resolves so the next one gets the bumped value)
    if (attackerCombatant && !noMap && explicitMap === null) {
      ca.recordAttack(channelId, c.name);
    }

    // ── Reaction prompts ──
    // Only prompt for a target's reactions (Reactive Strike triggers on attacks
    // by adjacent enemies). We can't know adjacency, so we only prompt for the
    // direct target — that's the simplest case where a reaction is plausible.
    let reactionPromptRow = null;
    let reactionPromptContent = '';
    if (target && target.hasReaction !== false && ca.hasReactionAvailable(target)) {
      // Skip if target is the attacker themselves
      if (target.name.toLowerCase() !== c.name.toLowerCase()) {
        const reactorMention = target.isNpc ? `<@${enc.gmId}>` : (target.ownerId ? `<@${target.ownerId}>` : '');
        reactionPromptContent = `\n${reactorMention} **${target.name}** may have a reaction available (e.g. Reactive Strike, Shield Block).`;
        reactionPromptRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`reaction_trigger_${target.name.replace(/[^a-zA-Z0-9]/g, '_')}`)
            .setLabel(`${target.name}: Trigger Reaction`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎲'),
          new ButtonBuilder()
            .setCustomId(`reaction_skip_${target.name.replace(/[^a-zA-Z0-9]/g, '_')}`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary),
        );
      }
    }

    const description = [
      attackLine,
      '',
      (targetDegree === 'success' || targetDegree === 'crit-success' || targetDegree === null) ? damageLine : null,
      outcomeLine || null,
      hpLine || null,
    ].filter(s => s !== null).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xC0392B)
      .setTitle(`⚔️ ${c.name} attacks with ${weapon.display ?? weapon.name}!`)
      .setDescription(description)
      .setFooter({ text: `${c.name} · Attack ${fmt(baseAttackBonus)} · ${weapon.die ?? ''}${damageBonusBase ? fmt(damageBonusBase) : ''} ${damageType}` });
    if (charEntry.art) embed.setThumbnail(charEntry.art);

    const replyPayload = { embeds: [embed] };
    let content = (mentionLine || '').trim();
    if (reactionPromptContent) content = (content + reactionPromptContent).trim();
    if (content) replyPayload.content = content;
    if (reactionPromptRow) replyPayload.components = [reactionPromptRow];

    await interaction.reply(replyPayload);
    const encForSummary = getEncounter(interaction.channel.id);
    if (encForSummary && target) await updateSummary(interaction.channel, encForSummary);
  }

  // ─── /monsterattack ──────────────────────────────────────────────
  else if (commandName === 'monsterattack') {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!guildId) return interaction.reply({ content: '❌ `/monsterattack` only works in a server, not in DMs.', ephemeral: true });

    // ── add (strike) ──
    if (sub === 'add' || sub === 'addspell') {
      const monsterInput = interaction.options.getString('monster');
      const attackName = interaction.options.getString('attack').trim();
      const bonus = interaction.options.getInteger('bonus');
      const damage = interaction.options.getString('damage').trim();
      const damageType = (interaction.options.getString('type') ?? 'damage').toLowerCase();
      const traitsRaw = sub === 'add' ? interaction.options.getString('traits') : null;
      const extraDamage = sub === 'add' ? interaction.options.getString('extra_damage') : null;
      const extraType = sub === 'add' ? interaction.options.getString('extra_type') : null;

      if (!rollDamageExpression(damage)) return interaction.reply({ content: `❌ Couldn't parse damage "${damage}". Use something like \`1d6+2\` or \`2d8+4\`.`, ephemeral: true });
      if (extraDamage && !rollDamageExpression(extraDamage)) return interaction.reply({ content: `❌ Couldn't parse extra damage "${extraDamage}". Use something like \`1d6\`.`, ephemeral: true });

      const traits = traitsRaw
        ? traitsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
        : [];

      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const displayName = resolveMonsterDisplayName(monsterInput);
      const key = monsterKey(displayName);
      if (!guild[key]) guild[key] = { displayName, attacks: [] };
      // Replace existing attack with same name
      const existingIdx = guild[key].attacks.findIndex(a => a.name.toLowerCase() === attackName.toLowerCase());
      const entry = {
        name: attackName,
        kind: sub === 'addspell' ? 'spell' : 'strike',
        bonus,
        damage,
        damageType,
        traits,
        extraDamage: extraDamage || null,
        extraType: extraType ? extraType.toLowerCase() : null
      };
      if (existingIdx >= 0) guild[key].attacks[existingIdx] = entry;
      else guild[key].attacks.push(entry);
      saveMonsterAttacks(store);
      const verb = existingIdx >= 0 ? 'Updated' : 'Saved';
      const kindLabel = sub === 'addspell' ? 'spell attack' : 'strike';
      const traitText = traits.length ? ` *(${traits.join(', ')})*` : '';
      return interaction.reply({ content: `✅ ${verb} ${kindLabel} **${attackName}** on **${displayName}**: ${fmt(bonus)}, ${damage} ${damageType}${traitText}`, ephemeral: true });
    }

    // ── addsave ──
    if (sub === 'addsave') {
      const monsterInput = interaction.options.getString('monster');
      const attackName = interaction.options.getString('attack').trim();
      const saveType = interaction.options.getString('save');
      const dc = interaction.options.getInteger('dc');
      const damage = interaction.options.getString('damage').trim();
      const damageType = (interaction.options.getString('type') ?? 'damage').toLowerCase();
      if (!rollDamageExpression(damage)) return interaction.reply({ content: `❌ Couldn't parse damage "${damage}". Use something like \`6d6\` or \`4d10+5\`.`, ephemeral: true });

      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const displayName = resolveMonsterDisplayName(monsterInput);
      const key = monsterKey(displayName);
      if (!guild[key]) guild[key] = { displayName, attacks: [] };
      const existingIdx = guild[key].attacks.findIndex(a => a.name.toLowerCase() === attackName.toLowerCase());
      const entry = { name: attackName, kind: 'save', saveType, saveDC: dc, damage, damageType };
      if (existingIdx >= 0) guild[key].attacks[existingIdx] = entry;
      else guild[key].attacks.push(entry);
      saveMonsterAttacks(store);
      const verb = existingIdx >= 0 ? 'Updated' : 'Saved';
      return interaction.reply({ content: `✅ ${verb} save attack **${attackName}** on **${displayName}**: DC ${dc} ${saveType}, ${damage} ${damageType}`, ephemeral: true });
    }

    // ── remove ──
    if (sub === 'remove') {
      const monsterInput = interaction.options.getString('monster');
      const attackName = interaction.options.getString('attack').trim();
      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const displayName = resolveMonsterDisplayName(monsterInput);
      const key = monsterKey(displayName);
      if (!guild[key]) return interaction.reply({ content: `❌ No saved attacks for **${displayName}**.`, ephemeral: true });
      const idx = guild[key].attacks.findIndex(a => a.name.toLowerCase() === attackName.toLowerCase());
      if (idx < 0) return interaction.reply({ content: `❌ **${displayName}** has no attack named "${attackName}".`, ephemeral: true });
      const removed = guild[key].attacks.splice(idx, 1)[0];
      if (guild[key].attacks.length === 0) delete guild[key];
      saveMonsterAttacks(store);
      return interaction.reply({ content: `🗑️ Removed **${removed.name}** from **${displayName}**.`, ephemeral: true });
    }

    // ── clear ──
    if (sub === 'clear') {
      const monsterInput = interaction.options.getString('monster');
      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const displayName = resolveMonsterDisplayName(monsterInput);
      const key = monsterKey(displayName);
      if (!guild[key]) return interaction.reply({ content: `❌ No saved attacks for **${displayName}**.`, ephemeral: true });
      delete guild[key];
      saveMonsterAttacks(store);
      return interaction.reply({ content: `🗑️ Cleared all attacks for **${displayName}**.`, ephemeral: true });
    }

    // ── list ──
    if (sub === 'list') {
      const monsterInput = interaction.options.getString('monster');
      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      if (monsterInput) {
        const displayName = resolveMonsterDisplayName(monsterInput);
        const key = monsterKey(displayName);
        const entry = guild[key];
        if (!entry || entry.attacks.length === 0) return interaction.reply({ content: `❌ No saved attacks for **${displayName}**.`, ephemeral: true });
        const embed = new EmbedBuilder()
          .setColor(0x8B0000)
          .setTitle(`👹 ${entry.displayName} — Saved Attacks`)
          .setFooter({ text: `${entry.attacks.length} attack${entry.attacks.length === 1 ? '' : 's'} · /monsterattack use to roll` });
        for (const a of entry.attacks) {
          let line;
          if (a.kind === 'save') {
            line = `DC ${a.saveDC} ${a.saveType} · ${a.damage} ${a.damageType}`;
          } else {
            const traitText = a.traits?.length ? ` *(${a.traits.join(', ')})*` : '';
            const extra = a.extraDamage ? ` + ${a.extraDamage} ${a.extraType ?? ''}`.trimEnd() : '';
            line = `${fmt(a.bonus)} · ${a.damage} ${a.damageType}${extra}${traitText}`;
          }
          const kindIcon = a.kind === 'save' ? '💨' : a.kind === 'spell' ? '✨' : '⚔️';
          embed.addFields({ name: `${kindIcon} ${a.name}`, value: line, inline: false });
        }
        return interaction.reply({ embeds: [embed] });
      }
      // List all monsters
      const entries = Object.values(guild);
      if (entries.length === 0) return interaction.reply({ content: `📖 No saved monsters yet. Use \`/monsterattack add\` to save one.`, ephemeral: true });
      entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
      const lines = entries.map(e => `• **${e.displayName}** — ${e.attacks.length} attack${e.attacks.length === 1 ? '' : 's'}`);
      const embed = new EmbedBuilder()
        .setColor(0x8B0000)
        .setTitle(`📖 Saved Monsters (${entries.length})`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: '/monsterattack list monster:<name> to see attacks' });
      return interaction.reply({ embeds: [embed] });
    }

    // ── use ──
    if (sub === 'use') {
      const attackerName = interaction.options.getString('attacker');
      const monsterInput = interaction.options.getString('monster');
      const attackQuery = interaction.options.getString('attack');
      const targetName = interaction.options.getString('target');
      const explicitMap = interaction.options.getInteger('map'); // null if unset

      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const displayName = resolveMonsterDisplayName(monsterInput);
      const key = monsterKey(displayName);
      const entry = guild[key];
      if (!entry) return interaction.reply({ content: `❌ No saved attacks for **${displayName}**. Use \`/monsterattack add\` first.`, ephemeral: true });
      const attack = findSavedAttack(entry, attackQuery);
      if (!attack) return interaction.reply({ content: `❌ **${displayName}** has no attack matching "${attackQuery}". Try \`/monsterattack list monster:${displayName}\`.`, ephemeral: true });

      const channelId = interaction.channel.id;
      const enc = getEncounter(channelId);
      if (!enc) return interaction.reply({ content: '❌ No active encounter in this channel. Start one with `/init start`.', ephemeral: true });
      if (interaction.user.id !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can use `/monsterattack use`.', ephemeral: true });

      const attacker = enc.combatants.find(x => x.name.toLowerCase() === attackerName.toLowerCase());
      if (!attacker) return interaction.reply({ content: `❌ No combatant named "${attackerName}" in this encounter.`, ephemeral: true });

      let target = null;
      if (targetName) {
        target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
        if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });
      }

      // ─── Strike / Spell Attack ───
      if (attack.kind === 'strike' || attack.kind === 'spell') {
        if (!target) return interaction.reply({ content: `❌ **${attack.name}** is a ${attack.kind === 'spell' ? 'spell attack' : 'strike'} — you must specify a target.`, ephemeral: true });

        const agile = attack.traits?.includes('agile') ?? false;
        // Auto-MAP unless explicitly provided
        let mapPenalty, mapNoteText;
        if (explicitMap !== null) {
          mapPenalty = calculateMap(explicitMap, agile);
          mapNoteText = explicitMap > 0 ? `MAP ${mapPenalty} (manual)` : null;
        } else {
          const mapInfo = ca.computeMapForNextAttack(attacker, agile);
          mapPenalty = mapInfo.penalty;
          mapNoteText = mapInfo.noteText;
        }
        const attackerMods = sumEffectModifiers(attacker);
        const targetMods = sumEffectModifiers(target);
        const dieRoll = Math.floor(Math.random() * 20) + 1;
        const attackTotal = dieRoll + attack.bonus + mapPenalty + attackerMods.attackBonus;
        const baseTargetAc = target.ac ?? null;
        const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;
        const degree = effectiveTargetAc !== null ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc) : null;

        const mapText = mapPenalty !== 0 ? ` ${mapPenalty}` : '';
        const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
        const rollLabel = attack.kind === 'spell' ? 'Spell Attack Roll' : 'Attack Roll';
        let attackLine = `**${rollLabel}**\n1d20 (${dieRoll}) ${fmt(attack.bonus)}${mapText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
        if (mapNoteText) attackLine += `\n*${mapNoteText}*`;
        if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
        if (dieRoll === 20) attackLine += '\n⭐ Natural 20!';
        if (dieRoll === 1)  attackLine += '\n💀 Natural 1!';

        // Main damage
        const damageResult = rollDamageExpression(attack.damage);
        const totalDamageBonus = attackerMods.damageBonus;
        let mainDamage = Math.max(1, damageResult.total + totalDamageBonus);
        const damageContribText = formatEffectContributions(attackerMods.activeEffects, 'damage');
        // Extra damage (not doubled on crit per PF2e rules for persistent/splash; but for simple extra dice we do double)
        let extraDamageResult = null;
        if (attack.extraDamage) extraDamageResult = rollDamageExpression(attack.extraDamage);

        let damageLine;
        let totalDealt;
        if (degree === 'crit-success') {
          mainDamage = mainDamage * 2;
          const extraDoubled = extraDamageResult ? extraDamageResult.total * 2 : 0;
          totalDealt = mainDamage + extraDoubled;
          damageLine = `**Damage (CRIT × 2)**\n${damageResult.display}${totalDamageBonus ? ` ${fmt(totalDamageBonus)}` : ''} = ${damageResult.total + totalDamageBonus} × 2 = **${mainDamage} ${attack.damageType}**`;
          if (extraDamageResult) damageLine += `\n+ ${extraDamageResult.display} × 2 = **${extraDoubled} ${attack.extraType ?? ''}**`.trimEnd();
        } else {
          const extraBase = extraDamageResult ? extraDamageResult.total : 0;
          totalDealt = mainDamage + extraBase;
          damageLine = `**Damage**\n${damageResult.display}${totalDamageBonus ? ` ${fmt(totalDamageBonus)}` : ''} = **${mainDamage} ${attack.damageType}**`;
          if (extraDamageResult) damageLine += `\n+ ${extraDamageResult.display} = **${extraBase} ${attack.extraType ?? ''}**`.trimEnd();
        }
        if (damageContribText) damageLine += `\n*${damageContribText.trim().slice(1, -1)}*`;

        const acBreakdown = baseTargetAc !== null && targetMods.acBonus !== 0
          ? ` (base ${baseTargetAc}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAc})`
          : '';
        let outcomeLine;
        if (degree === 'crit-success')      outcomeLine = `🎯 **Critical Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
        else if (degree === 'success')      outcomeLine = `✅ **Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
        else if (degree === 'failure')      outcomeLine = `❌ **Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
        else if (degree === 'crit-failure') outcomeLine = `💢 **Critical Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
        else                                outcomeLine = `🎯 Attack against **${target.name}** (AC unknown — GM decides)`;

        let hpLine = '';
        let mentionLine = '';
        if (degree === 'success' || degree === 'crit-success') {
          const dmgResult = ca.applyDamage(channelId, target.name, totalDealt);
          const dyingNote = dmgResult?.displaySuffix ?? '';
          hpLine = target.isNpc
            ? `\n❤️ **${target.name}** took ${totalDealt} damage${dyingNote}`
            : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
        }
        if (!target.isNpc && target.ownerId) mentionLine = `<@${target.ownerId}>`;

        const showDamage = (degree === 'success' || degree === 'crit-success' || degree === null);
        const description = [attackLine, '', showDamage ? damageLine : null, outcomeLine, hpLine || null].filter(s => s !== null).join('\n');

        const kindIcon = attack.kind === 'spell' ? '✨' : '👹';
        const traitFooter = attack.traits?.length ? ` · ${attack.traits.join(', ')}` : '';
        const embed = new EmbedBuilder()
          .setColor(attack.kind === 'spell' ? 0x9B59B6 : 0x8B0000)
          .setTitle(`${kindIcon} ${attacker.name} uses ${attack.name}!`)
          .setDescription(description)
          .setFooter({ text: `${entry.displayName}${traitFooter} · ${fmt(attack.bonus)} · ${attack.damage} ${attack.damageType}` });

        const replyPayload = { embeds: [embed] };
        if (mentionLine) replyPayload.content = mentionLine;
        await interaction.reply(replyPayload);
        // Record attack for MAP tracking (only if MAP wasn't manually overridden)
        if (explicitMap === null) {
          ca.recordAttack(channelId, attacker.name);
        }
        await updateSummary(interaction.channel, enc);
        return;
      }

      // ─── Save-based (breath weapon, aura, AoE) ───
      if (attack.kind === 'save') {
        const damageResult = rollDamageExpression(attack.damage);
        const saveDisplay = attack.saveType.charAt(0).toUpperCase() + attack.saveType.slice(1);
        const targetLine = target ? ` against **${target.name}**` : '';
        const mentionLine = (target && !target.isNpc && target.ownerId) ? `<@${target.ownerId}>` : '';

        const description =
          `**${saveDisplay} Save DC ${attack.saveDC}**${targetLine}\n\n` +
          `**Damage Rolled:** ${damageResult.display} = **${damageResult.total} ${attack.damageType}**\n\n` +
          `• 🌟 Crit Success → **0** damage\n` +
          `• ✅ Success → **${Math.floor(damageResult.total / 2)}** damage (half)\n` +
          `• ❌ Failure → **${damageResult.total}** damage (full)\n` +
          `• 💥 Crit Failure → **${damageResult.total * 2}** damage (double)\n\n` +
          `*${target ? target.name : 'Target(s)'}, tap the button below to roll your save — or use \`/save type:${attack.saveType}\` manually.*`;

        const embed = new EmbedBuilder()
          .setColor(0xD35400)
          .setTitle(`💨 ${attacker.name} uses ${attack.name}!`)
          .setDescription(description)
          .setFooter({ text: `${entry.displayName} · DC ${attack.saveDC} ${attack.saveType} · ${attack.damage} ${attack.damageType}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`msave_${attack.saveType}_${attack.saveDC}`)
            .setLabel(`Roll ${saveDisplay} Save (DC ${attack.saveDC})`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎲')
        );

        const replyPayload = { embeds: [embed], components: [row] };
        if (mentionLine) replyPayload.content = mentionLine;
        await interaction.reply(replyPayload);
        return;
      }

      return interaction.reply({ content: `❌ Unknown attack kind "${attack.kind}".`, ephemeral: true });
    }
  }

});

client.login(process.env.TOKEN);