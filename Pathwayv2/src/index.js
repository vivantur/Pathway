require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ── Persistent-data directory + JSON loader ─────────────────────────────────
// Moved to utils/storage.js. See that file for the full force-reseed and
// homebrew-preservation logic. On Railway, set DATA_DIR env var to your mounted
// volume path (e.g. /app/data) so user state survives redeploys.
const {
  DATA_DIR,
  dataPath,
  loadJson,
  mutateJson,
  restoreAllFromSupabase,
  loadReferenceDatabasesFromSupabase,
  // Characters: state/characters now owns its cache + Realtime; bulk sync flows through there.
  syncActiveCharacterToSupabase,
  setupHomebrewRealtimeSync,
  // Bags: state/bags now owns its cache + Realtime (bags + bag_items).
  // Downtime: state/downtime now owns its cache + Realtime; sync flows through there.
  // Notes: state/notes now owns its cache + Realtime; sync flows through there.
  // Snippets (user + guild): state/snippets now owns caches + Realtime.
  // Monster art/edits/attacks: state/monster now owns caches + Realtime.
  seedJsonCache,
} = require('./lib/storage');
const { getSupabase } = require('./lib/supabase');

// ── State modules (Phase 2 — own their cache + Realtime subscription) ──────
// Each module is the single owner of one table's in-memory cache. They are
// subscribed to Supabase Realtime in clientReady BEFORE restoreAllFromSupabase
// so web-app writes propagate live and the bot's cache never goes stale.
const notes = require('./state/notes');
const downtimeState = require('./state/downtime');
const snippetState = require('./state/snippets');
const monsterState = require('./state/monster');
const bagState = require('./state/bags');
const companionState = require('./state/companions');
const characterState = require('./state/characters');
const {
  computeCharMaxHp, getCharacterHp, setCharacterHp,
  getCharacterXp, setCharacterXp,
  getCharacterWeapons,
  resolveChar,
  MAX_CHARACTERS_PER_USER,
} = characterState;
const { loreKey, loreTopicLabel, isLoreProficiencyKey } = require('./rules/lore');
const {
  fetchPathwayCharacter,
  fetchLinkedPathwayCharacter,
  saveImportedCharacter,
} = require('./lib/pathwayWebClient');
const { isDeadInteractionError } = require('./lib/discordErrors');
const guildStateModule = require('./state/guild');

// ── Shared helpers (extracted from index.js in Phase 3) ────────────────────
// Pure display formatters (no character data needed):
const { getMod, fmt, calcProfNum, xpToNextLevel, truncateField } = require('./lib/format');
// Character-data-aware PF2e proficiency math:
const {
  usesRankProficiencies,
  canonicalProfValue,
  calcCharacterProfNum,
  calcEditableProfNum,
  editableProfValue,
  characterProfValue,
  characterProfLabel,
  profIconForValue,
  computeCharSkillModifier,
} = require('./rules/pf2eMath');

// ── Extracted command handlers (Phase 3) ───────────────────────────────────
// Per-command folders under src/commands/ own their handler + embed +
// any button/autocomplete logic. index.js shrinks by ~250 lines per
// command extracted. Helpers that still live in index.js are passed
// through a `ctx` object built at call-site.
const sheetCmd         = require('./commands/sheet/command');
const hpCmd            = require('./commands/hp/command');
const notesCmd         = require('./commands/notes/command');
const featsCmd         = require('./commands/feats/command');
const abilitiesCmd     = require('./commands/abilities/command');
const descriptionCmd   = require('./commands/description/command');
const brCmd            = require('./commands/br/command');
const pingCmd          = require('./commands/ping/command');
const snippetCmd       = require('./commands/snippet/command');
const serverSnippetCmd = require('./commands/serversnippet/command');
const portraitCmd      = require('./commands/portrait/command');
const heroCmd          = require('./commands/hero/command');
const ccCmd            = require('./commands/cc/command');
const cvarCmd          = require('./commands/cvar/command');
const spellsCmd        = require('./commands/spells/command');
const spellbookCmd     = require('./commands/spellbook/command');
const castCmd          = require('./commands/cast/command');
const rollCmd          = require('./commands/roll/command');
const spellCmd         = require('./commands/spell/command');
const spelladdCmd      = require('./commands/spelladd/command');
const monsteraddCmd    = require('./commands/monsteradd/command');
const helpCmd          = require('./commands/help/command');
const bagCmd           = require('./commands/bag/command');
const { normalizeBagEntry } = require('./commands/bag/helpers');
const { normalizeCharacterFeat } = require('./commands/feats/fields');
const { findSpell, spellAmbiguityMessage } = require('./commands/spell/lookup');
const { normalizeSpell } = require('./commands/spell/embed');
const xpCmd            = require('./commands/xp/command');
const restCmd          = require('./commands/rest/command');
const restButtonsCmd   = require('./commands/rest/buttons');
const refocusCmd       = require('./commands/refocus/command');
const resourceCmd      = require('./commands/resource/command');
const conditionCmd     = require('./commands/condition/command');
const backgroundCmd    = require('./commands/background/command');
const heritageCmd      = require('./commands/heritage/command');
const featCmd          = require('./commands/feat/command');
const ancestryCmd      = require('./commands/ancestry/command');
const ancestryButtons  = require('./commands/ancestry/buttons');
const archetypeCmd     = require('./commands/archetype/command');
const itemCmd          = require('./commands/item/command');
const itemaddCmd       = require('./commands/itemadd/command');
const ruleCmd          = require('./commands/rule/command');
const deityCmd         = require('./commands/deity/command');
const goldCmd          = require('./commands/gold/command');
const { deityAutocompleteChoices } = require('./commands/deity/lookup');
const eberronCmd       = require('./commands/eberron/command');
const { eberronDeityAutocompleteChoices } = require('./commands/eberron/deityLookup');
const { eberronHouseAutocompleteChoices } = require('./commands/eberron/houseLookup');
const skillCmd         = require('./commands/skill/command');
const skillinfoCmd     = require('./commands/skillinfo/command');
const skillinfoButtons = require('./commands/skillinfo/buttons');
const perceptionCmd    = require('./commands/perception/command');
const saveCmd          = require('./commands/save/command');
const initiativeCmd    = require('./commands/initiative/command');
const classCmd         = require('./commands/class/command');
const classButtons     = require('./commands/class/buttons');
const companionCmd     = require('./commands/companion/command');
const weatherFeatureCmd = require('./commands/weather/command');
const calendarFeatureCmd = require('./commands/calendar/command');
const { scaleCompanion } = require('./commands/companion/helpers');
const { buildCharHpEmbed } = require('./commands/hp/embed');
// Notes autocomplete (still inline in index.js) reaches into note helpers.
const { noteKey, sortNotes } = require('./commands/notes/notebook');
const { findMonster } = require('./commands/monster/lookup');
const { buildMonsterEmbed } = require('./commands/monster/embed');

// Fuzzy matching for autocomplete dropdowns and "Did you mean?" fallback
// messages on lookup commands. fuzzyPick is a drop-in replacement for the
// old inline pick() helper that powered all autocomplete; didYouMeanLine
// is appended to "❌ No X found" messages on lookup commands.
const { fuzzyPick, didYouMeanLine, score: fuzzyScore } = require('./lib/fuzzyMatch');

// Ancestry description parser — splits the messy AoN-imported description
// field into labeled sections (Edicts, Anathema, Society, etc.) and
// normalizes the hp/hit_points field-name discrepancy between schemas.
const {
  parseDescription: parseAncestryDescription,
  getAncestryHp,
  hasHeritages,
  hasAncestryFeats,
} = require('./lib/ancestryParser');

// Spell damage resolver — figures out the right dice expression for a spell at
// any cast rank, handling all four heightening shapes that appear in spells.json
// (per_rank with/without damage_bonus, fixed with/without dice in level text).
// rollCompoundExpression handles compound expressions like "6d6 + 4d6" that
// the original rollDamageExpression couldn't parse.
const { resolveSpellDamage, rollCompoundExpression } = require('./lib/spellDamage');

console.log(`DATA_DIR: ${DATA_DIR}`);

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('Missing required environment variable: TOKEN or DISCORD_TOKEN');
  process.exit(1);
}

const encounters = require('./commands/encounters');
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
  delayCombatant,
  rejoinFromDelay,
} = encounters;
const { getPreset, listPresets } = require('./rules/effects');
const downtime = require('./commands/downtime');
const charOverlay = require('./rules/characterOverlay');
const ca = require('./rules/combatAutomation');
const combatV2State = require('./rules/combatV2/state');
const combatV2Render = require('./rules/combatV2/render');
const combatV2Rolls = require('./rules/combatV2/rolls');
const { computeCharPerception } = require('./rules/characterChecks');
// Spell effects auto-application: maps spell names to mechanical effects
// (Frightened, Slowed, Bless, etc.) that get applied to targets based on
// their save degree of success. Used by /cast.
const spellEffects = require('./rules/spellEffects');
const weatherCmd = require('./commands/weather-cmd');
const weatherEngine = require('./rules/weather');
const calendarCmd = require('./commands/calendar-cmd');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Message content intent — kept enabled in case future features (like reading
    // posted JSON or chat-based commands) need it. Toggle in Discord Developer Portal.
    GatewayIntentBits.MessageContent,
  ]
});

process.on('unhandledRejection', error => {
  if (isDeadInteractionError(error)) return; // silently ignore
  console.error('Unhandled rejection:', error);
});

// Flush all in-flight Supabase syncs before Railway kills the container.
// Railway sends SIGTERM then waits 30 s before SIGKILL — enough for one sync.
process.on('SIGTERM', async () => {
  console.log('[shutdown] SIGTERM received — flushing Supabase syncs…');
  const { drainSupabaseSyncs } = require('./lib/storage');
  try { await drainSupabaseSyncs(); } catch { /* errors already logged inside storage.js */ }
  process.exit(0);
});

// Critical: discord.js emits 'error' events on the Client when something goes
// wrong (network blips, expired interactions, rate-limit issues). If nothing
// listens for that event, Node treats it as a fatal error and crashes the
// process. Logging it here keeps the bot alive across transient errors.
client.on('error', error => {
  if (isDeadInteractionError(error)) return;
  console.error('Discord client error:', error);
});

// Same for shard errors (if running sharded, which we're not, but defensive).
client.on('shardError', error => {
  if (isDeadInteractionError(error)) return;
  console.error('Discord shard error:', error);
});

// Catch uncaught exceptions to prevent crashes from synchronous errors too.
process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Reference databases moved to src/reference/databases.js in Phase 3.13.
// loadReferenceDatabasesFromSupabase still receives them as a `dbs` object
// (the references are identical to the module-level objects).
const referenceDb = require('./reference/databases');
const {
  spellDatabase,
  ancestryDatabase,
  harvestRewardsDatabase,
  archetypeDatabase,
  backgroundDatabase,
  featDatabase,
  rulesDatabase,
  heritageDatabase,
  heritagesByAncestry,
  bestiaryDatabase,
} = referenceDb;

// ── Bestiary mutation helpers ─────────────────────────────────────────────────
// /monsteradd writes to the global bestiary.json. Keep this locked to the bot
// owner via BOT_OWNER_ID env var, since this bot is public and any server could
// otherwise pollute the global dataset.

// Atomic write: dump to a temp file, fsync, then rename. If anything goes wrong
// mid-write, bestiary.json is either the old version or the new version — never
// a half-written file.
// ── Spell database mutation helpers ───────────────────────────────────────────
const { itemDatabase } = referenceDb;

// ── Item database mutation helpers ────────────────────────────────────────────
const {
  deityDatabase,
  eberronDeityDatabase,
  eberronHouseDatabase,
  skillDatabase,
  classDatabase,
  companionDatabase,
  REFERENCE_DATABASE_CONFIG,
  referenceDatabases,
} = referenceDb;

// charactersCache removed in Phase 2 — state/characters owns the cache.
// loadCharacters() returns characterState.getAll(), which is the same map.

// usernameCache moved to state/characters.js in Phase 3.7.
// interactionCreate now calls characterState.rememberUsername(...) directly;
// characterState.saveAll() reads the cache implicitly.

// bagsCache removed in Phase 2 — state/bags owns the cache.
// downtimeCache removed in Phase 2 — state/downtime owns the cache.
// notesCache removed in Phase 2 — state/notes owns the cache.
// snippetsCache + serverSnippetsCache removed in Phase 2 — state/snippets owns both.
// monsterArtCache + monsterEditsCache + monsterAttacksCache removed in Phase 2 — state/monster owns all three.

// Phase 2: state/characters owns the cache + Realtime. These remain as thin
// delegations so the 213 existing call sites keep working unchanged.
// loadCharacters() returns the live cache reference (same map mutations
// flow through to subsequent reads). saveCharacters() goes through
// characterState.saveAll which writes both cache and Supabase, and the
// Realtime subscription updates the cache when the web app writes.
function loadCharacters() {
  return characterState.getAll();
}

async function saveCharacters(data) {
  // characterState.saveAll() reads the internal username cache implicitly
  // (Phase 3.7) — no parameter needed.
  await characterState.saveAll(data);
}

// ── Downtime helpers ──────────────────────────────────────────────────────────
// Downtime activities and the per-character bank of downtime days are stored
// in Supabase (cache-based; no JSON file). See downtime.js for the data shape.
// Phase 2: downtime cache is owned by state/downtime. loadDowntime and
// saveDowntime are now thin delegations so the 10+ existing call sites and
// the auto-accrual job keep working unchanged. The auto-accrual job benefits
// from the same Realtime sync that fixes Liv's bug for player commands.
function loadDowntime() {
  return downtimeState.getAll();
}
async function saveDowntime(data) {
  await downtimeState.saveAll(data);
}

const DOWNTIME_AUTO_ACCRUAL_INTERVAL_MS = 60 * 60 * 1000;
let downtimeAutoAccrualTimer = null;
let downtimeAutoAccrualRunning = false;

async function runDowntimeAutoAccrual(reason = 'scheduled') {
  if (downtimeAutoAccrualRunning) return;
  downtimeAutoAccrualRunning = true;
  try {
    const store = loadDowntime();
    const result = downtime.accrueAutoEnabled(store);
    if (result.changed) {
      await saveDowntime(store);
      console.log(
        `[downtime:auto] ${reason}: credited ${result.totalAdded} day(s) across ${result.records.length} character(s)` +
        (result.totalCapped ? `; ${result.totalCapped} day(s) capped` : '')
      );
    }
  } catch (err) {
    console.error('[downtime:auto] accrual failed:', err.message);
  } finally {
    downtimeAutoAccrualRunning = false;
  }
}

function startDowntimeAutoAccrual() {
  if (downtimeAutoAccrualTimer) return;
  runDowntimeAutoAccrual('startup');
  downtimeAutoAccrualTimer = setInterval(
    () => runDowntimeAutoAccrual('interval'),
    DOWNTIME_AUTO_ACCRUAL_INTERVAL_MS
  );
}

const DOWNTIME_SKILL_ABILITIES = {
  acrobatics: 'dex',
  arcana: 'int',
  athletics: 'str',
  crafting: 'int',
  deception: 'cha',
  diplomacy: 'cha',
  intimidation: 'cha',
  medicine: 'wis',
  nature: 'wis',
  occultism: 'int',
  performance: 'cha',
  perception: 'wis',
  religion: 'wis',
  society: 'int',
  stealth: 'dex',
  survival: 'wis',
  thievery: 'dex',
};

function normalizeDowntimeSkillName(skillName) {
  return String(skillName ?? '').trim().toLowerCase().replace(/\s+/g, '-');
}

function getDowntimeSkillModifier(character, skillName) {
  const raw = String(skillName ?? '').trim();
  const key = normalizeDowntimeSkillName(raw);
  const baseSkillKey = key.endsWith('-lore') || key === 'lore' ? 'lore' : key;
  const abilityKey = DOWNTIME_SKILL_ABILITIES[baseSkillKey] ?? (key.includes('lore') ? 'int' : null);
  if (!abilityKey) return { error: `Unknown skill "${raw}".` };

  const abilities = character.abilities ?? {};
  const proficiencies = character.proficiencies ?? {};
  const level = Number(character.level ?? 1);
  const abilityMod = Math.floor(((abilities[abilityKey] ?? 10) - 10) / 2);
  const profValue = proficiencies[key]
    ?? proficiencies[baseSkillKey]
    ?? proficiencies[String(raw).toLowerCase()]
    ?? 0;
  const total = abilityMod + calcProfNum(Number(profValue) || 0, level);
  return {
    skill: raw,
    key,
    abilityKey,
    abilityMod,
    profNum: Number(profValue) || 0,
    profRank: downtime.profRankKey(Number(profValue) || 0),
    total,
  };
}

function downtimeRoll(total, dc, bonus = 0) {
  const die = Math.floor(Math.random() * 20) + 1;
  const finalTotal = die + total + bonus;
  let degree = finalTotal >= dc + 10 ? 'criticalSuccess'
    : finalTotal >= dc ? 'success'
    : finalTotal <= dc - 10 ? 'criticalFailure'
    : 'failure';
  if (die === 20) {
    degree = degree === 'criticalFailure' ? 'failure' : degree === 'failure' ? 'success' : 'criticalSuccess';
  } else if (die === 1) {
    degree = degree === 'criticalSuccess' ? 'success' : degree === 'success' ? 'failure' : 'criticalFailure';
  }
  return { die, total: finalTotal, degree };
}

function downtimeDegreeLabel(degree) {
  return {
    criticalSuccess: 'Critical Success',
    success: 'Success',
    failure: 'Failure',
    criticalFailure: 'Critical Failure',
  }[degree] ?? degree;
}

function downtimeDcFromOptions(interaction, defaultLevel = 0, defaultDifficulty = 'normal') {
  const dc = interaction.options.getInteger('dc');
  if (dc) return dc;
  const level = interaction.options.getInteger('level') ?? defaultLevel;
  const difficulty = interaction.options.getString('difficulty') ?? defaultDifficulty;
  return downtime.taskLevelDC(level, difficulty);
}

function spendDowntimeDaysOrReply(store, interaction, userId, charKey, charName, days, reason) {
  downtime.accrue(store, userId, charKey);
  const result = downtime.spend(store, userId, charKey, days, reason, userId);
  if (!result.ok) {
    return { ok: false, reply: { content: `Cannot spend downtime: ${result.reason}` } };
  }
  return { ok: true, balance: result.balance };
}

const SIMPLE_DOWNTIME_COMMANDS = new Set([
  'learnname', 'subsist', 'bribe', 'forgedocuments', 'gaincontact', 'gossip',
  'scout', 'disguise', 'research', 'study',
]);

// ── Bag helpers ───────────────────────────────────────────────────────────────
// Phase 2: state/bags owns the cache + Realtime — thin delegations here.
function loadBags() {
  return bagState.getAll();
}
async function saveBags(data) {
  await bagState.saveAll(data);
}

// ── Snippet helpers ──────────────────────────────────────────────────────────
// File shape: { [userId]: { [snippetName]: "expansion string" } }
// Snippets are per-user text substitutions applied to /roll expressions.
// Example: user creates `sneaky` => `+2d6[sneak]`, then /roll 1d20+5 sneaky
// expands to /roll 1d20+5 +2d6[sneak] before parsing.
// Phase 2: state/snippets owns the cache + Realtime. These remain as thin
// delegations so the existing call sites and the snippet-expansion helpers
// keep working unchanged.
function loadSnippets() {
  return snippetState.getAllUser();
}
async function saveSnippets(data) {
  await snippetState.saveAllUser(data);
}
// Validate a snippet name: letters/numbers/underscore only, 1-24 chars, not
// colliding with reserved roll modifiers.
// Snippet validation moved to commands/snippet/validation.js in Phase 3.8.
// RESERVED_SNIPPET_NAMES, validateSnippetName, validateSnippetExpansion now
// imported via the require at the top of this file.

// ── Server (guild) snippet helpers ───────────────────────────────────────────
// File shape: { [guildId]: { [snippetName]: "expansion" } }
// Only users with the ManageGuild permission can create/delete. Everyone
// in the server can use them. Personal snippets take precedence over
// server snippets with the same name.
// Phase 2: state/snippets owns the cache + Realtime — thin delegations here.
function loadServerSnippets() {
  return snippetState.getAllGuild();
}
async function saveServerSnippets(data) {
  await snippetState.saveAllGuild(data);
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
// Shape: { [guildId]: { [monsterKey]: { displayName, attacks: [ {...} ] } } }
// Phase 2: state/monster owns the attacks cache + Realtime.
function loadMonsterAttacks() {
  return monsterState.getAllAttacks();
}
async function saveMonsterAttacks(data) {
  await monsterState.saveAllAttacks(data);
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
// Shape: { [guildId]: { [monsterKey]: { displayName, url, setBy, setAt } } }
// Per-guild so a GM on one server can't affect another's art.
// Phase 2: state/monster owns the art cache + Realtime.
function loadMonsterArt() {
  return monsterState.getAllArt();
}
async function saveMonsterArt(data) {
  await monsterState.saveAllArt(data);
}
function getGuildArt(store, guildId) {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}
function monsterBuiltinArtUrl(monsterOrName) {
  if (!monsterOrName || typeof monsterOrName === 'string') return null;
  const raw = Array.isArray(monsterOrName.image) ? monsterOrName.image[0] : monsterOrName.image;
  if (!raw || typeof raw !== 'string') return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `https://2e.aonprd.com${raw}`;
  return `https://2e.aonprd.com/${raw.replace(/^\/+/, '')}`;
}
// Look up a saved art URL for a monster in a given guild. Returns null if none.
// The monster arg can be either a bestiary creature object (preferred) or a raw string name.
function lookupMonsterArt(guildId, monsterOrName) {
  let saved = null;
  const name = typeof monsterOrName === 'string' ? monsterOrName : monsterOrName?.name;
  if (guildId && name) {
    const store = loadMonsterArt();
    const guild = store[guildId];
    const key = monsterKey(name);
    saved = guild?.[key]?.url ?? null;
  }
  return saved ?? monsterBuiltinArtUrl(monsterOrName);
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
// Phase 2: state/monster owns the edits cache + Realtime.
function loadMonsterEdits() {
  return monsterState.getAllEdits();
}
async function saveMonsterEdits(data) {
  await monsterState.saveAllEdits(data);
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


// ── Character helpers ─────────────────────────────────────────────────────────
// PF2e math helpers (getMod, calcProfNum, fmt, xpToNextLevel) moved to lib/format.js
// in Phase 0 (duplicate definitions removed here in Phase 3.4).
// Character-data-aware proficiency helpers (canonicalProfValue, calcCharacterProfNum,
// calcEditableProfNum, editableProfValue, characterProfValue, characterProfLabel,
// usesRankProficiencies, profIconForValue) moved to src/rules/pf2eMath.js in Phase 3.4.
// All 12 are imported at the top of this file so existing call sites resolve naturally.
// customKey moved out of index.js in Phase 3.5 — see rules/lore.js or state/characters.js.
// loreKey moved out of index.js in Phase 3.5 — see rules/lore.js or state/characters.js.
// loreTopicLabel moved out of index.js in Phase 3.5 — see rules/lore.js or state/characters.js.
// isLoreProficiencyKey moved out of index.js in Phase 3.5 — see rules/lore.js or state/characters.js.

// Parse a Pathbuilder import reference from user input. Accepts either:
//   - a 4-8 digit ID (e.g. "122550")
//   - a full URL (e.g. "https://pathbuilder2e.com/json.php?id=122550")
//   - a shortened form with query string (e.g. "pathbuilder2e.com/json.php?id=122550")
// Returns { id } on success or { error } on failure.
// Save a parsed Pathbuilder character object into the user's store. Creates
// or updates. Returns { ok, key, replaced } or { error }.
// sourceInfo is a human-readable string like "from file upload" or
// "pasted" that gets shown in the reply.
function getBlankCharacterTemplate() {
  return `// Pathway Character Template
// =====================================================================
// This is a fill-in-the-blanks character template.
//
// HOW TO USE:
//   1. Open this file in Notepad (Windows) / TextEdit (Mac) / any text editor
//   2. Replace the placeholder values with your character's data
//   3. Leave fields you don't need as their defaults — the bot ignores empty
//      or zero fields gracefully
//   4. Save the file (keep the .txt extension)
//   5. In Discord, run:  /char add file:<this-edited-file>
//      (or /char update  to refresh an existing character with the same name)
//
// EDITING TIPS:
//   - Lines that start with // are comments. You can leave them or delete them.
//   - Fields starting with _comment are explanation hints. Leave them; they're
//     ignored by the bot.
//   - All numbers must stay as numbers (no quotes around them).
//   - All text must stay wrapped in "quotes".
//   - Lists use square brackets: ["item1", "item2", "item3"].
//   - Tradition options: "arcane", "divine", "occult", "primal".
//   - Spellcasting type: "prepared" (wizard/cleric) or "spontaneous" (sorcerer/bard).
//   - Proficiency ranks: 0 = untrained, 2 = trained, 4 = expert, 6 = master, 8 = legendary.
//   - Ability scores use the actual SCORE (18 = +4 mod). To convert a mod to a
//     score: score = (mod * 2) + 10.  +4 mod → 18, +3 mod → 16, etc.
//
// If you only need to make quick edits to an existing character, skip this
// template and use /char edit, /char skill, or /char lore instead.
// =====================================================================

{
  "_comment_IDENTITY": "== CHARACTER IDENTITY ==",
  "name": "Your Character Name",
  "class": "Fighter",
  "dualClass": null,
  "level": 1,
  "ancestry": "Human",
  "heritage": "Versatile Human",
  "background": "Warrior",
  "alignment": "N",
  "gender": "",
  "age": "",
  "deity": "",
  "_comment_size": "size: -2=Tiny, -1=Small, 0=Medium, 1=Large, 2=Huge, 3=Gargantuan",
  "size": 0,
  "keyability": "str",
  "languages": ["Common"],

  "_comment_ATTRIBUTES": "== HP + SPEED ==",
  "_comment_hp": "HP is computed as ancestryhp + bonushp + ((classhp + bonushpPerLevel + conMod) * level). For a level 1 Fighter with Con +2: 8 + 0 + ((10 + 0 + 2) * 1) = 20 HP. ancestryhp/bonushp are FLAT one-time values; classhp/bonushpPerLevel are PER-LEVEL.",
  "attributes": {
    "ancestryhp": 8,
    "classhp": 10,
    "bonushp": 0,
    "bonushpPerLevel": 0,
    "speed": 25,
    "speedBonus": 0
  },

  "_comment_ABILITIES": "== ABILITY SCORES (use score not mod; +4 mod = 18 score) ==",
  "abilities": {
    "str": 18,
    "dex": 14,
    "con": 14,
    "int": 10,
    "wis": 12,
    "cha": 10,
    "breakdown": { "ancestryFree": [], "ancestryBoosts": [], "ancestryFlaws": [], "backgroundBoosts": [], "classBoosts": [], "mapLevelledBoosts": {} }
  },

  "_comment_PROFICIENCIES": "== PROFICIENCIES (0=untrained, 2=trained, 4=expert, 6=master, 8=legendary) ==",
  "_comment_spellcasting_profs": "castingArcane/Divine/Occult/Primal are spell attack/DC proficiency. Leave at 0 for non-casters.",
  "proficiencies": {
    "classDC": 2,
    "perception": 2,
    "fortitude": 4,
    "reflex": 2,
    "will": 2,
    "heavy": 2, "medium": 2, "light": 2, "unarmored": 2,
    "advanced": 0, "martial": 2, "simple": 2, "unarmed": 2,
    "castingArcane": 0, "castingDivine": 0, "castingOccult": 0, "castingPrimal": 0,
    "acrobatics": 0, "arcana": 0, "athletics": 2, "crafting": 0,
    "deception": 0, "diplomacy": 0, "intimidation": 2, "medicine": 0,
    "nature": 0, "occultism": 0, "performance": 0, "religion": 0,
    "society": 0, "stealth": 0, "survival": 0, "thievery": 0
  },

  "_comment_AC": "== ARMOR CLASS (acTotal is what /sheet shows; value should match acTotal) ==",
  "acTotal": { "acTotal": 18, "acProfBonus": 3, "acAbilityBonus": 2, "acItemBonus": 3, "acValue": 18 },

  "_comment_LORES": "== LORE SKILLS as [name, rank] pairs. rank: 2=trained, 4=expert, 6=master, 8=legendary ==",
  "lores": [],

  "_comment_WEAPONS": "== WEAPONS ==",
  "_comment_weapon_fields": "attack is the full to-hit bonus including str/dex + prof + item. die is damage dice like '1d8+4' or '2d6'. damageType: B=Bludgeoning, P=Piercing, S=Slashing.",
  "weapons": [
    {
      "name": "Longsword",
      "display": "Longsword",
      "attack": 7,
      "damageBonus": 0,
      "die": "1d8+4",
      "damageType": "S",
      "traits": ["Versatile P"],
      "strikingRune": "",
      "potencyRune": 0,
      "runes": []
    }
  ],

  "_comment_FEATS": "== FEATS as [name, null, null, null]. Only the first element (name) matters. ==",
  "feats": [
    ["Power Attack", null, null, null]
  ],

  "_comment_SPECIALS": "== CLASS FEATURES / ANCESTRY FEATURES by name ==",
  "specials": [
    "Attack of Opportunity",
    "Shield Block"
  ],

  "_comment_EQUIPMENT": "== INVENTORY as [name, quantity] pairs ==",
  "equipment": [
    ["Longsword", 1],
    ["Chain Mail", 1],
    ["Shield", 1],
    ["Backpack", 1],
    ["Bedroll", 1],
    ["Rations (1 week)", 1]
  ],

  "_comment_MONEY": "== COINS ==",
  "money": { "cp": 0, "sp": 0, "gp": 15, "pp": 0 },

  "_comment_SPELLCASTING": "== SPELLCASTING (leave spellCasters empty [] for non-casters) ==",
  "_comment_spellcaster_fields": "magicTradition: arcane/divine/occult/primal. spellcastingType: prepared or spontaneous. attack = spell attack bonus. dc = spell DC. cantrips is the list of known/prepared cantrips. spells is list of {spellLevel, list} per rank. perDay is {rankNumber: slotCount}.",
  "spellCasters": [],

  "_comment_FOCUS": "== FOCUS SPELLS. Leave as {} if no focus pool. Example: { \\"focusPoints\\": 2, \\"spells\\": [\\"Lay on Hands\\"] } ==",
  "focus": {},

  "_comment_UNUSED": "These fields exist for Pathbuilder compatibility but the bot doesn't use them heavily:",
  "specificProficiencies": {},
  "armor": [],
  "formula": [],
  "pets": [],
  "senses": ""
}

// =====================================================================
// EXAMPLE: WIZARD SPELLCASTER
// =====================================================================
// To turn this into a wizard, you'd change these fields:
//
//   "class": "Wizard",
//   "keyability": "int",
//   "attributes": { "ancestryhp": 8, "classhp": 6, ... },     // wizards have classhp 6
//   "abilities": { "str": 10, "dex": 14, ..., "int": 18, ...},
//   "proficiencies": {
//     ...
//     "castingArcane": 2,            // trained in arcane spell attack/DC
//     "arcana": 2,                   // trained in Arcana skill
//     "light": 0, "medium": 0, "heavy": 0,
//     "simple": 2, "martial": 0,
//     ...
//   },
//   "spellCasters": [
//     {
//       "name": "Arcane Prepared",
//       "magicTradition": "arcane",
//       "spellcastingType": "prepared",
//       "innate": false,
//       "attack": 7,
//       "dc": 17,
//       "keyAbility": "int",
//       "cantrips": ["Electric Arc", "Detect Magic", "Light", "Read Aura", "Shield"],
//       "spells": [
//         { "spellLevel": 1, "list": ["Magic Missile", "Mystic Armor"] }
//       ],
//       "prepared": [
//         { "spellLevel": 1, "list": ["Magic Missile", "Mystic Armor"] }
//       ],
//       "blendedSpells": [],
//       "perDay": { "1": 2 }
//     }
//   ]
// =====================================================================
`;
}

// MAX_CHARACTERS_PER_USER moved to state/characters.js in Phase 3.7.

// mergeCharacterOverlay moved to lib/pathwayWebClient.js in Phase 3.7.

// saveImportedCharacter moved to lib/pathwayWebClient.js in Phase 3.7.

function createBlankCharacterData({ name, className, ancestry, heritage, level }) {
  const lvl = Math.max(1, Math.min(20, Number.parseInt(level, 10) || 1));
  const characterName = String(name ?? '').trim();
  return {
    name: characterName,
    class: String(className ?? '').trim() || 'Adventurer',
    dualClass: null,
    level: lvl,
    ancestry: String(ancestry ?? '').trim() || 'Unknown',
    heritage: String(heritage ?? '').trim() || '',
    background: '',
    alignment: 'N',
    gender: '',
    age: '',
    deity: '',
    size: 0,
    keyability: '',
    languages: ['Common'],
    attributes: {
      ancestryhp: 8,
      classhp: 8,
      bonushp: 0,
      bonushpPerLevel: 0,
      speed: 25,
      speedBonus: 0,
    },
    abilities: {
      str: 10,
      dex: 10,
      con: 10,
      int: 10,
      wis: 10,
      cha: 10,
      breakdown: { ancestryFree: [], ancestryBoosts: [], ancestryFlaws: [], backgroundBoosts: [], classBoosts: [], mapLevelledBoosts: {} },
    },
    proficiencies: {
      classDC: 0,
      perception: 0,
      fortitude: 0,
      reflex: 0,
      will: 0,
      heavy: 0, medium: 0, light: 0, unarmored: 0,
      advanced: 0, martial: 0, simple: 0, unarmed: 0,
      castingArcane: 0, castingDivine: 0, castingOccult: 0, castingPrimal: 0,
      acrobatics: 0, arcana: 0, athletics: 0, crafting: 0,
      deception: 0, diplomacy: 0, intimidation: 0, medicine: 0,
      nature: 0, occultism: 0, performance: 0, religion: 0,
      society: 0, stealth: 0, survival: 0, thievery: 0,
    },
    acTotal: { acTotal: 10, acProfBonus: 0, acAbilityBonus: 0, acItemBonus: 0, acValue: 10 },
    lores: [],
    weapons: [],
    feats: [],
    specials: [],
    equipment: [],
    money: { cp: 0, sp: 0, gp: 0, pp: 0 },
    spellCasters: [],
    focus: {},
    specificProficiencies: {},
    armor: [],
    formula: [],
    pets: [],
    senses: '',
    _pathwayCreated: true,
  };
}

async function saveCreatedCharacter(userId, char) {
  if (!char?.name) return { error: 'Character name is required.' };
  const characters = loadCharacters();
  if (!characters[userId]) characters[userId] = {};
  const key = char.name.toLowerCase().replace(/\s+/g, '-');
  if (characters[userId][key]) return { error: `You already have a character named **${char.name}**. Use a different name or remove the old one first.` };
  const count = Object.keys(characters[userId]).filter(k => !k.startsWith('_')).length;
  if (count >= MAX_CHARACTERS_PER_USER) {
    return { error: `You've reached the ${MAX_CHARACTERS_PER_USER}-character limit. Remove one with \`/char remove\` before adding another.` };
  }
  const entry = {
    name: char.name,
    data: char,
    art: null,
    senses: null,
    edits: {},
    saved: new Date().toISOString(),
  };
  characters[userId][key] = entry;
  if (!characters[userId]._activeChar) characters[userId]._activeChar = key;
  await saveCharacters(characters);
  return { ok: true, key, name: char.name, level: char.level, maxHp: computeCharMaxHp(entry) };
}

// Try to parse a JSON string that may have extra wrapping (code blocks,
// leading/trailing text, nested `{"success":true,"build":{...}}` wrapper).
// Returns { char } or { error }.
function parsePastedPathbuilderJSON(rawText) {
  if (!rawText || typeof rawText !== 'string') return { error: 'Paste is empty.' };

  let text = rawText.trim();

  // Strip common code-block wrappers: ```json ... ``` or ``` ... ```
  const codeBlockMatch = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  if (codeBlockMatch) text = codeBlockMatch[1].trim();

  // Strip any line-level // comments. Our /char template uses these for
  // instructions, and users might add their own while editing. We only strip
  // lines that BEGIN with optional whitespace + // (we don't touch // that
  // appears mid-line, which might be legitimate data like a URL).
  text = text.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n').trim();

  // If the user pasted multiple lines with non-JSON preamble, find the first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return { error: 'That paste doesn\'t contain valid JSON. Make sure you copied the entire export from Pathbuilder.' };
  }
  text = text.slice(firstBrace, lastBrace + 1);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Truncation/incomplete paste usually surfaces as "Unexpected end" or
    // "Unterminated string" — point the user toward the multi-field fix.
    const isTruncation = /Unexpected end|Unterminated string|Expected/.test(err.message);
    if (isTruncation) {
      return { error: 'Your paste looks cut off. If you\'re using a template, make sure the file wasn\'t truncated. Otherwise check for missing commas or brackets near the end.' };
    }
    return { error: `Couldn't parse that JSON: ${err.message}. Double-check you copied the entire export from Pathbuilder's Menu → Export JSON.` };
  }

  // Unwrap { success, build } if present
  const char = parsed.build ?? parsed;
  if (!char || !char.name) {
    return { error: 'Got valid JSON but no character data. Make sure you exported from Pathbuilder\'s Menu → Export JSON.' };
  }
  return { char };
}


// ─── PDF STATBLOCK PARSER ─────────────────────────────────────────────
function pdfDeduplicateBoldLetters(text) {
  // Pathbuilder statblocks render bold LETTERS with each character doubled by
  // pdf-parse. Observed patterns:
  //   - Capitals: "G\tGuardian" (capital, tab, same capital, rest of word)
  //   - Lowercase: "Guuaarrddiiaann" (each char doubled)
  //   - Punctuation inside bold: "((Runelord))", ",," — these DO double
  //   - Digits in header: "33" for level 3 in "Guardian 33\tKhyber" (larger font)
  //   - Digits in ordinals: "11sstt" for bold "1st" in "Arcane Prepared Spells ... 1st"
  //   - Digits in bare values: "HP 22" stays as "HP 22" (NOT bold-doubled)
  //
  // Strategy: dedupe all letters and punctuation always. Dedupe digits only
  // when they're part of a header (first non-empty line) or ordinal suffix.
  //
  // Different pdf-parse versions produce different leading whitespace:
  //   - pdf-parse v1.1.1 (classic): prepends two empty lines before the real header
  //   - pdf-parse v2.x: no leading blanks
  // We find the first non-empty line and treat that as the header, preserving
  // any leading blank content as-is.
  const lines = text.split('\n');
  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === '') headerIdx++;
  // Rebuild with splits
  const leading = lines.slice(0, headerIdx).join('\n') + (headerIdx > 0 ? '\n' : '');
  const header = lines[headerIdx] ?? '';
  const rest = lines.slice(headerIdx + 1).join('\n');

  const dedupePass = (str, dedupeDigitsGlobally) => {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i], next = str[i + 1], after = str[i + 2];
      if (/[A-Z]/.test(ch) && next === '\t' && after === ch) {
        out += ch; i += 2; continue;
      }
      // Letters and bold-rendered punctuation always dedupe
      if (/[a-zA-Z()[\]+\-]/.test(ch) && next === ch) {
        out += ch; i += 1; continue;
      }
      // Digits: dedupe in header, OR when this digit is part of an ordinal
      // (followed by sstt/nndd/rrdd/tthh double-suffix pattern).
      if (/\d/.test(ch) && next === ch) {
        const ordinalCheck = str.slice(i + 2, i + 6);
        const isBoldOrdinal = /^(ssttt?t?|nnddd?d?|rrddd?d?|tthhh?h?)/.test(ordinalCheck) ||
                              /^(st|nd|rd|th)/.test(str.slice(i + 2, i + 4));
        if (dedupeDigitsGlobally || isBoldOrdinal) {
          out += ch; i += 1; continue;
        }
      }
      out += ch;
    }
    return out;
  };

  return leading + dedupePass(header, true) + (rest ? '\n' + dedupePass(rest, false) : '');
}

function pdfRestoreDoubledWords(text) {
  // Our simple deduplication collapses legitimate double letters in words
  // like "Additional", "Occultism", "Common". Restore known Pathbuilder
  // statblock vocabulary that has doubled letters in it.
  //
  // All patterns use word boundaries to prevent cascading matches. Without
  // \b, a rule like "cal → call" would incorrectly match the "cal" inside
  // "Magical" and produce "Magicall". Rules are applied simultaneously via
  // a single regex so order doesn't create cascades.
  const map = {
    // Languages / common short words (all word-boundary-safe)
    'Comon': 'Common',
    'comon': 'common',
    'Aditional': 'Additional',
    'aditional': 'additional',
    'Ocultism': 'Occultism',
    'ocultism': 'occultism',
    'Dragonblod': 'Dragonblood',
    'Resurection': 'Resurrection',
    'resurection': 'resurrection',
    'Spelcasting': 'Spellcasting',
    'spelcasting': 'spellcasting',
    'Spelbok': 'Spellbook',
    'spelbok': 'spellbook',
    'Schol': 'School',
    'schol': 'school',
    'Tolkit': 'Toolkit',
    'tolkit': 'toolkit',
    'Barage': 'Barrage',
    'barage': 'barrage',
    'Magicall': 'Magical',
    'magicall': 'magical',
    'Physicall': 'Physical',
    'physicall': 'physical',
    'Batle': 'Battle',
    'batle': 'battle',
    'Sadle': 'Saddle',
    'sadle': 'saddle',
    'Uncomon': 'Uncommon',
    'uncomon': 'uncommon',
    'Finese': 'Finesse',
    'finese': 'finesse',
    'Pary': 'Parry',
    'pary': 'parry',
    'Swep': 'Sweep',
    'swep': 'sweep',
    'Kil': 'Kill',
    'kil': 'kill',
    'Skil': 'Skill',
    'skil': 'skill',
    'Skillls': 'Skills', // triple-L artifact of bold Skills label
    'Spels': 'Spells',
    'spels': 'spells',
    'Spel': 'Spell',
    'spel': 'spell',
    // Body/description text
    'atack': 'attack',
    'Atack': 'Attack',
    'sucess': 'success',
    'Sucess': 'Success',
    'efect': 'effect',
    'Efect': 'Effect',
    'Bedrol': 'Bedroll',
    'bedrol': 'bedroll',
    'Stel': 'Steel',
    'Hardnes': 'Hardness',
    'aly': 'ally',
    'Aly': 'Ally',
    'trigering': 'triggering',
    'Trigering': 'Triggering',
    'fet': 'feet',
    'roled': 'rolled',
    'Roled': 'Rolled',
    'cal': 'call',
    'Cal': 'Call',
    'posibly': 'possibly',
    'Posibly': 'Possibly',
    'Steping': 'Stepping',
    'steping': 'stepping',
    'stil': 'still',
    'Stil': 'Still',
    'imunities': 'immunities',
    'Imunities': 'Immunities',
    'weakneses': 'weaknesses',
    'Weakneses': 'Weaknesses',
    'Aply': 'Apply',
    'aply': 'apply',
    'atempt': 'attempt',
    'Atempt': 'Attempt',
    'Spelshape': 'Spellshape',
    'spelshape': 'spellshape',
    'Rot': 'Root',
  };

  // Build a single alternation regex so replacements happen simultaneously,
  // preventing cascading (e.g. "cal"→"call" then another rule matching "call").
  // \b ensures we only match whole words, so "cal" inside "Magical" won't match.
  const keys = Object.keys(map).sort((a, b) => b.length - a.length); // longest-first
  const pattern = new RegExp('\\b(' + keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'g');
  let out = text.replace(pattern, (m) => map[m] ?? m);

  // Handle special cases that don't fit \b-word-boundary:
  // "Dam\tmage" → "Damage" (tab in middle of word)
  out = out.replace(/Dam\tmage/g, 'Damage');
  out = out.replace(/Item\tms/g, 'Items');
  // "Rot Reading" → "Root Reading" (Rot on its own isn't uniquely restorable)
  out = out.replace(/\bRot\s+Reading\b/g, 'Root Reading');

  return out;
}

function pdfParseMod(s) {
  const m = String(s).trim().match(/^([+-]?\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}
function pdfModToScore(mod) { return mod * 2 + 10; }

// Split on commas, keeping parenthesized groups together. Used for items
// and similar lists where entries contain internal commas inside parens.
function splitOnCommasRespectingParens(text) {
  const parts = [];
  let depth = 0, buf = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') { depth++; buf += ch; continue; }
    if (ch === ')' || ch === ']') { depth--; buf += ch; continue; }
    if (ch === ',' && depth === 0) {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

function parsePathbuilderStatblockPDF(rawText) {
  if (!rawText || typeof rawText !== 'string' || rawText.length < 100) {
    return { error: 'That PDF doesn\'t look like a Pathbuilder statblock. Make sure you used Pathbuilder\'s Menu → Export → View Statblock → Save as PDF (not the character sheet PDF).' };
  }

  const warnings = [];
  const cleaned = pdfRestoreDoubledWords(pdfDeduplicateBoldLetters(rawText));
  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // 1) Header
  const headerLine = lines[0] ?? '';
  const headerMatch = headerLine.match(/^([A-Za-z][A-Za-z ]*?)(?:\s*\(([^)]+)\))?\s+(\d+)\s*\t?\s*(.+)$/);
  if (!headerMatch) {
    return { error: `Couldn't read the statblock header. First line was: "${headerLine}". Expected format like "Wizard (Runelord) 2\\tAurelius".` };
  }
  const charClass = headerMatch[1].trim();
  const subclass = headerMatch[2]?.trim() ?? null;
  const level = parseInt(headerMatch[3], 10);
  const name = headerMatch[4].trim();

  // 2) Creature type line (line 2)
  const typeLine = lines[1] ?? '';
  const typeParts = typeLine.split(/\s+/).filter(Boolean);
  const sizes = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
  let size = 'Medium', ancestry = '', heritage = '', creatureType = 'Humanoid';
  if (sizes.includes(typeParts[0])) {
    size = typeParts[0];
    const rest = typeParts.slice(1);
    if (rest.length >= 1) creatureType = rest[rest.length - 1];
    if (rest.length >= 2) ancestry = rest[0];
    if (rest.length >= 3) heritage = rest.slice(1, -1).join(' ');
  } else {
    warnings.push(`Couldn't parse size/ancestry from: "${typeLine}"`);
  }

  // 3) Field-based extraction. Use the single-line joined form for easier regex.
  const joined = lines.join(' ');

  // Perception
  let perception = 0, senses = '';
  const percM = joined.match(/Perception\s+([+-]?\d+)(?:\s*;\s*(.+?))?\s+(?:Languages|Skills|Str\s+[+-])/);
  if (percM) {
    perception = pdfParseMod(percM[1]);
    senses = (percM[2] ?? '').trim();
  } else warnings.push('Perception line not found');

  // Languages (may be "None selected" or "None")
  let languages = [];
  const langM = joined.match(/Languages\s+(.+?)\s+(?:Skills|Str\s+[+-]|Items)/);
  if (langM) {
    const raw = langM[1].trim();
    if (!/^(None|None selected)$/i.test(raw)) {
      languages = raw.split(/,\s*/).map(s => s.trim()).filter(Boolean);
    }
  }

  // Skills
  const skills = {};
  const skillM = joined.match(/Skills\s+(.+?)\s+Str\s+[+-]/);
  if (skillM) {
    const skillRe = /(Lore:\s*[A-Z][A-Za-z' ]*|[A-Z][A-Za-z]*)\s+([+-]\d+)/g;
    let m;
    while ((m = skillRe.exec(skillM[1])) !== null) {
      skills[m[1].replace(/\s+/g, ' ').trim()] = pdfParseMod(m[2]);
    }
  }

  // Abilities
  const abilities = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  const abilRe = /(Str|Dex|Con|Int|Wis|Cha)\s+([+-]?\d+)(?=[,\s])/g;
  let am;
  while ((am = abilRe.exec(joined)) !== null) {
    abilities[am[1].toLowerCase()] = pdfParseMod(am[2]);
  }

  // Items — split on commas but keep parenthesized groups together
  let items = [];
  const itemsM = joined.match(/Items\s+(.+?)\s+AC\s+\d/);
  if (itemsM) {
    items = splitOnCommasRespectingParens(itemsM[1]);
  }

  // AC
  let ac = 10;
  const acM = joined.match(/AC\s+(\d+)(?:\s*\([^)]+\))?;\s*Fort/);
  if (acM) ac = parseInt(acM[1], 10);

  // Saves
  let fort = 0, ref = 0, will = 0;
  const savM = joined.match(/Fort\s+([+-]?\d+),?\s+Ref\s+([+-]?\d+),?\s+Will\s+([+-]?\d+)/);
  if (savM) {
    fort = pdfParseMod(savM[1]);
    ref = pdfParseMod(savM[2]);
    will = pdfParseMod(savM[3]);
  }

  // HP (match "HP NN" where the NN comes AFTER Will save to avoid matching
  // the shield's "HP 6" in the Items line)
  let hp = 0;
  let resistances = [], weaknesses = [], immunities = [];
  const hpM = joined.match(/Will\s+[+-]?\d+\s+HP\s+(\d+)(?:\s*;\s*(.+?))?(?=\s+(?:Speed|Shield|Intercept|Warding|Melee|Ranged|Reach|Drain|Recognize|Breath|Taunt|Arcane|Divine|Occult|Primal|Focus|Additional|$))/);
  if (hpM) {
    hp = parseInt(hpM[1], 10);
    const extras = (hpM[2] ?? '').trim();
    const rM = extras.match(/Resistances?:?\s+([^;]+?)(?=\s*(?:Weaknesses|Immunities|$))/i);
    if (rM) resistances = rM[1].split(/,\s*/).map(s => s.trim()).filter(Boolean);
    const wM = extras.match(/Weaknesses?:?\s+([^;]+?)(?=\s*(?:Resistances|Immunities|$))/i);
    if (wM) weaknesses = wM[1].split(/,\s*/).map(s => s.trim()).filter(Boolean);
    const iM = extras.match(/Immunities?:?\s+([^;]+?)(?=\s*(?:Resistances|Weaknesses|$))/i);
    if (iM) immunities = iM[1].split(/,\s*/).map(s => s.trim()).filter(Boolean);
  }

  // Speed
  let speed = 25;
  const spdM = joined.match(/Speed\s+(\d+)\s*feet/);
  if (spdM) speed = parseInt(spdM[1], 10);

  // Weapons. Line format: "Melee|Ranged <name> +N (<traits>), Damage <dice+N> <type>"
  // <type> is 1-3 uppercase letters (B, P, S, B/P, B/P/S, fire, etc.)
  const weapons = [];
  const wRe = /(Melee|Ranged)\s+(.+?)\s+([+-]\d+)\s*\(([^)]*)\),?\s*Damage\s+(\S+)\s+([A-Za-z/]+)/g;
  let wm;
  while ((wm = wRe.exec(joined)) !== null) {
    weapons.push({
      type: wm[1].toLowerCase(),
      name: wm[2].trim(),
      attackBonus: pdfParseMod(wm[3]),
      traits: wm[4].split(/,\s*/).map(s => s.trim()).filter(Boolean),
      damage: wm[5].trim(),
      damageType: wm[6].trim(),
    });
  }

  // Spellcasting
  const spellcasters = [];
  const traditions = ['Arcane', 'Divine', 'Occult', 'Primal'];
  const kinds = ['Prepared', 'Spontaneous', 'Innate', 'Focus'];
  for (const tradition of traditions) {
    for (const kind of kinds) {
      if (kind === 'Focus') continue;
      const kindRe = new RegExp(
        `${tradition}\\s+${kind}\\s+Spells\\s+DC\\s+(\\d+),?\\s*attack\\s+([+-]?\\d+);?\\s*(.+?)(?=\\s+(?:Arcane|Divine|Occult|Primal)\\s+(?:Prepared|Spontaneous|Innate)\\s+Spells\\s+DC|\\s+Focus Spells|\\s+Additional (?:Feats|Specials)|\\s+Rituals|$)`,
        'i'
      );
      const scM = joined.match(kindRe);
      if (scM) {
        const dc = parseInt(scM[1], 10);
        const attackBonus = pdfParseMod(scM[2]);
        const block = scM[3];

        // Spell slots by rank
        const spellsByRank = {};
        const rankRe = /(\d+)(?:st|nd|rd|th)\s+((?:[^,;]+,\s*)*[^,;]+?)(?=\s*;|\s+Cantrips|\s+\d+(?:st|nd|rd|th)|$)/g;
        let rm;
        while ((rm = rankRe.exec(block)) !== null) {
          const rank = parseInt(rm[1], 10);
          const spells = rm[2].split(/,\s*/).map(s => s.trim()).filter(Boolean);
          spellsByRank[rank] = spells;
        }

        // Cantrips
        let cantrips = [];
        const ctM = block.match(/Cantrips\s+(.+?)(?:;|$)/i);
        if (ctM) cantrips = ctM[1].split(/,\s*/).map(s => s.trim()).filter(Boolean);

        spellcasters.push({
          tradition: tradition.toLowerCase(),
          kind: kind.toLowerCase(),
          dc,
          attackBonus,
          cantrips,
          spellsByRank,
        });
      }
    }
  }

  // Focus spells (one line: "Focus Spells (N points) Spell1, Spell2")
  let focusPoints = 0;
  let focusSpells = [];
  const fM = joined.match(/Focus Spells\s*\((\d+)\s+points?\)\s+(.+?)(?=\s+Additional\s+(?:Feats|Specials)|$)/);
  if (fM) {
    focusPoints = parseInt(fM[1], 10);
    focusSpells = fM[2].split(/,\s*/).map(s => s.trim()).filter(Boolean);
  }

  // Additional Feats
  let feats = [];
  const featsM = joined.match(/Additional Feats\s+(.+?)(?=\s+Additional Specials|\s+Pathbuilder 2e|$)/);
  if (featsM) {
    feats = featsM[1].split(/,\s*/).map(s => s.trim()).filter(Boolean);
  }

  // Additional Specials
  let specials = [];
  const spM = joined.match(/Additional Specials\s+(.+?)(?=\s+Pathbuilder 2e|$)/);
  if (spM) {
    specials = spM[1].split(/,\s*/).map(s => s.trim()).filter(Boolean);
  }

  // Build a Pathbuilder-JSON-shaped output.
  const char = {
    name, class: charClass, dualClass: null, level,
    ancestry, heritage, background: '', alignment: 'N',
    gender: '', age: '', deity: '', size: 0,
    keyability: '', languages,
    attributes: { ancestryhp: 0, classhp: 0, bonushp: 0, bonushpPerLevel: 0, speed, speedBonus: 0 },
    abilities: {
      str: pdfModToScore(abilities.str),
      dex: pdfModToScore(abilities.dex),
      con: pdfModToScore(abilities.con),
      int: pdfModToScore(abilities.int),
      wis: pdfModToScore(abilities.wis),
      cha: pdfModToScore(abilities.cha),
      breakdown: { ancestryFree: [], ancestryBoosts: [], ancestryFlaws: [], backgroundBoosts: [], classBoosts: [], mapLevelledBoosts: {} },
    },
    proficiencies: {
      classDC: 0, perception, fortitude: fort, reflex: ref, will,
      heavy: 0, medium: 0, light: 0, unarmored: 0,
      advanced: 0, martial: 0, simple: 0, unarmed: 0,
      castingArcane: spellcasters.find(c => c.tradition === 'arcane')?.attackBonus ?? 0,
      castingDivine: spellcasters.find(c => c.tradition === 'divine')?.attackBonus ?? 0,
      castingOccult: spellcasters.find(c => c.tradition === 'occult')?.attackBonus ?? 0,
      castingPrimal: spellcasters.find(c => c.tradition === 'primal')?.attackBonus ?? 0,
    },
    acTotal: { acTotal: ac, acProfBonus: 0, acAbilityBonus: 0, acItemBonus: 0, acValue: ac },
    feats: feats.map(f => [f, null, null, null]),
    specificProficiencies: {},
    money: { cp: 0, sp: 0, gp: 0, pp: 0 },
    armor: [],
    weapons: weapons.map(w => ({
      name: w.name, display: w.name, attack: w.attackBonus, damageBonus: 0,
      die: w.damage, damageType: w.damageType, traits: w.traits,
      strikingRune: '', potencyRune: 0, runes: [],
    })),
    equipment: items.map(i => [i, 1]),
    specials,
    // Extract Lore entries from the skill totals. Format from statblock is
    // "Lore: Dragon +9" — we convert to [topic, profRank] tuples matching
    // Pathbuilder JSON shape. Rank is inferred: total - intMod - level gives
    // the bare proficiency bonus, which maps to rank (2/4/6/8).
    lores: (() => {
      const intMod = abilities.int ?? 0;
      const out = [];
      for (const [skillName, skillTotal] of Object.entries(skills)) {
        if (!skillName.startsWith('Lore:')) continue;
        const topic = skillName.replace(/^Lore:\s*/, '').trim();
        // Back out rank from: total = intMod + level + rank
        const rankBonus = skillTotal - intMod - level;
        // Map to standard ranks; anything non-matching stored as 2 (trained) as fallback
        let rank = 2;
        if (rankBonus >= 8) rank = 8;
        else if (rankBonus >= 6) rank = 6;
        else if (rankBonus >= 4) rank = 4;
        else if (rankBonus >= 2) rank = 2;
        else continue; // skip untrained/negative (shouldn't show up in statblock anyway)
        out.push([topic, rank]);
      }
      return out;
    })(),
    formula: [],
    pets: [],
    spellCasters: spellcasters.map(sc => ({
      name: `${sc.tradition.charAt(0).toUpperCase() + sc.tradition.slice(1)} ${sc.kind.charAt(0).toUpperCase() + sc.kind.slice(1)}`,
      magicTradition: sc.tradition,
      spellcastingType: sc.kind,
      innate: sc.kind === 'innate',
      attack: sc.attackBonus, dc: sc.dc, keyAbility: '',
      spells: Object.entries(sc.spellsByRank).map(([r, l]) => ({ spellLevel: parseInt(r, 10), list: l })),
      prepared: sc.kind === 'prepared' ? Object.entries(sc.spellsByRank).map(([r, l]) => ({ spellLevel: parseInt(r, 10), list: l })) : [],
      blendedSpells: [],
      perDay: Object.fromEntries(Object.keys(sc.spellsByRank).map(r => [r, sc.spellsByRank[r].length])),
      cantrips: sc.cantrips,
    })),
    focus: focusPoints > 0 ? { focusPoints, spells: focusSpells } : {},
    senses,
    // PDF-specific metadata so the bot knows this is a partial import
    _source: 'pdf',
    _pdfWarnings: warnings,
    _displayMods: abilities,
    _skillTotals: skills,
    _hpMaxOverride: hp,
    _resistances: resistances,
    _weaknesses: weaknesses,
    _immunities: immunities,
    _subclass: subclass,
  };

  return { char, warnings };
}

function parsePathbuilderRef(raw) {
  if (!raw || typeof raw !== 'string') return { error: 'Please provide a Pathbuilder ID or export URL.' };
  const trimmed = raw.trim();
  // Pure number
  if (/^\d{4,8}$/.test(trimmed)) return { id: trimmed };
  // URL with id=NNNN query param (handles http/https, with or without www, with any path)
  const urlMatch = trimmed.match(/[?&]id=(\d{4,8})(?:&|$)/);
  if (urlMatch) return { id: urlMatch[1] };
  // Just a number inside some other text (last resort — extract the only digit run if unambiguous)
  const numbers = trimmed.match(/\d{4,8}/g);
  if (numbers && numbers.length === 1) return { id: numbers[0] };
  return {
    error: 'Could not find a Pathbuilder ID in that input. Paste either the 6-digit code (e.g. `122550`) or the full URL from Pathbuilder\'s Export JSON (e.g. `https://pathbuilder2e.com/json.php?id=122550`).',
  };
}

const PATHWAY_CHARACTER_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function parseCharacterUpdateRef(raw) {
  if (!raw || typeof raw !== 'string') {
    return { error: 'Please provide a Pathbuilder ID/export URL or Pathway JSON ID.' };
  }
  const trimmed = raw.trim();
  const pathwayMatch = trimmed.match(PATHWAY_CHARACTER_ID_RE);
  if (pathwayMatch) return { type: 'pathway', id: pathwayMatch[0].toLowerCase() };

  const pathbuilderRef = parsePathbuilderRef(trimmed);
  if (pathbuilderRef.error) {
    return {
      error:
        'Could not find a valid character ID in that input. Paste a Pathway JSON ID ' +
        '(e.g. `e33b3c85-03d5-44f0-9cc1-40a139a0a7db`), a Pathbuilder code ' +
        '(e.g. `122550`), or a Pathbuilder Export JSON URL.',
    };
  }
  return { type: 'pathbuilder', id: pathbuilderRef.id };
}

// Fetch a character by Pathbuilder ID. Returns { char, id } or { error }.
// Centralizes the fetch/parse/error-handling so /char import and /char sync
// don't drift apart.
async function fetchPathbuilderCharacter(id) {
  const url = `https://pathbuilder2e.com/json.php?id=${encodeURIComponent(id)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Pathway-Bot/1.0 (+https://github.com/vivantur/Pathway; PF2e Discord bot)',
      },
    });
  } catch (err) {
    return { error: `❌ Couldn't reach Pathbuilder: ${err.message}. Try again in a minute.` };
  }
  const rawText = await response.text();
  if (response.status === 403 || /host not in allowlist/i.test(rawText)) {
    return {
      error:
        `âŒ **Pathbuilder blocked the request â€” its allowlist doesn't include this bot's server.**\n\n` +
        `Use \`/char update file:<updated-json>\` instead:\n` +
        `1. In Pathbuilder, open **Menu** â†’ **Export JSON**\n` +
        `2. Save or copy the JSON into a \`.json\` or \`.txt\` file\n` +
        `3. Upload that file with \`/char update\`.`,
    };
  }
  if (!response.ok) {
    return { error: `❌ Pathbuilder responded with HTTP ${response.status}. Try again in a minute.` };
  }
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return { error: '❌ Pathbuilder gave back an invalid response. Try re-exporting from the app.' };
  }
  if (!payload.success) {
    return {
      error:
        `❌ Pathbuilder says ID **${id}** isn't valid. IDs expire after about 24 hours.\n` +
        `Get a fresh one:\n1. Open Pathbuilder\n2. Menu → **Export JSON**\n3. Paste the new ID or URL here.`,
    };
  }
  const char = payload.build;
  if (!char || !char.name) {
    return { error: '❌ Got a response, but no character data in it. Try again with a fresh ID.' };
  }
  return { char, id };
}

// fetchPathwayCharacter moved to lib/pathwayWebClient.js in Phase 3.7.

// fetchLinkedPathwayCharacter moved to lib/pathwayWebClient.js in Phase 3.7.

// resolveChar moved to state/characters.js in Phase 3.3.
// Imported via the destructure at the top of this file so all 87 call
// sites continue to resolve to the same function.

// Pathway brand colors used across roll embeds. Gold matches the d20 art.
const PATHWAY_GOLD = 0xC9A24A;

// Pathway dice fallback art shown when a character/companion has no portrait
// set. Loaded once at startup; if the file is missing, embeds gracefully omit
// the thumbnail. Attach via files:[...] using PATHWAY_DICE_NAME, then
// reference in the embed as `attachment://${PATHWAY_DICE_NAME}`.
const PATHWAY_DICE_NAME = 'pathway-dice.png';
const PATHWAY_DICE_REF = `attachment://${PATHWAY_DICE_NAME}`;
let PATHWAY_DICE_BUFFER = null;
try {
  PATHWAY_DICE_BUFFER = fs.readFileSync(path.join(__dirname, '..', 'assets', PATHWAY_DICE_NAME));
} catch {
  // No fallback art on disk — embeds will render without a thumbnail.
}

// Files array to pass alongside any roll embed. Empty if the caller has a real
// thumbnail URL or if the fallback asset isn't on disk.
function rollFallbackFiles(thumbnail) {
  if (thumbnail || !PATHWAY_DICE_BUFFER) return [];
  return [new AttachmentBuilder(PATHWAY_DICE_BUFFER, { name: PATHWAY_DICE_NAME })];
}

function buildRollEmbed({ title, breakdown, charName, thumbnail }) {
  const embed = new EmbedBuilder().setColor(PATHWAY_GOLD).setTitle(title).setDescription(breakdown);
  if (thumbnail) embed.setThumbnail(thumbnail);
  else if (PATHWAY_DICE_BUFFER) embed.setThumbnail(PATHWAY_DICE_REF);
  if (charName) embed.setFooter({ text: charName });
  return embed;
}

function buildCombatDeathEmbed(name) {
  return new EmbedBuilder()
    .setColor(0x8b0000)
    .setTitle(`${name} has Died!`)
    .setDescription(`**${name}** reached Dying 4 and has been removed from initiative.`);
}

function combatDeathPayload(result) {
  const name = result?.removed?.name ?? result?.name ?? result?.combatant?.name;
  return result?.died && name ? { embeds: [buildCombatDeathEmbed(name)] } : null;
}

function combatDyingSuffix(result) {
  if (!result) return '';
  if (result.died) return `\n☠️ **${result.removed?.name ?? result.combatant?.name ?? result.name} has Died!** Removed from initiative.`;
  if (result.wentDown && result.dying > 0) return `\n💀 **Down!** (Dying ${result.dying})`;
  if (result.dyingIncreased && result.dying > 0) return `\n💀 **Dying increased to ${result.dying}**`;
  if (result.wokeUp) return `\n✨ **Recovered from dying!** (now Wounded ${result.wounded})`;
  return '';
}

function formatRollBreakdown(dieRoll, modifier, extraBonus, total, sides) {
  const isCrit = sides === 20 && dieRoll === 20;
  const isFumble = sides === 20 && dieRoll === 1;
  const modPart = modifier !== 0 ? ` + ${modifier}` : '';
  const extraPart = extraBonus && extraBonus !== 0 ? ` + ${extraBonus}` : '';
  let line = `1d20 (${dieRoll})${modPart}${extraPart} = \`${total}\``;
  if (isCrit) line += '\n⭐ Natural 20!';
  if (isFumble) line += '\n💀 Natural 1!';
  return line;
}

// ── Initiative helpers ────────────────────────────────────────────────────────
// HP overlay helpers (computeCharMaxHp, getCharacterHp, setCharacterHp)
// moved to state/characters.js in Phase 3.2. They're imported below as part
// of the characterState destructure so existing call sites resolve naturally.

// buildCharHpEmbed moved to src/commands/hp/embed.js in Phase 3.2.
// Imported via the destructure below so existing call sites in index.js
// (besides /hp itself) keep working unchanged.

// ── HP status helpers for the initiative tracker ────────────────────────────
// PF2e uses "bloodied" at ≤50% and tracks dying at 0 HP. We add a "critical"
// band at ≤25% for tactical clarity at the table. Dying/wounded are now
// proper PF2e conditions managed by combatAutomation.js.
function hpStatus(current, max, dying = 0, doomed = 0, unconscious = false) {
  if (!max || max <= 0) return { label: 'Unknown', emoji: '⚪' };
  const maxDying = Math.max(1, 4 - doomed);
  if (dying >= maxDying)    return { label: 'Dead',     emoji: '☠️' };
  if (dying > 0)            return { label: `Dying ${dying}`, emoji: '💀' };
  if (current <= 0 && unconscious) return { label: 'Unconscious', emoji: '😴' };
  if (current <= 0)         return { label: 'Down',     emoji: '💤' };
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

// Format a single effect for the initiative embed line. Handles persistent
// damage specially so it shows the dice and damage type, not just the name.
function formatEffectForEmbed(e) {
  if (e.kind === 'persistent-damage' || e.modifiers?.kind === 'persistent-damage') {
    const dice = e.modifiers?.dice ?? e.dice ?? '?';
    const dtype = e.modifiers?.damageType ?? e.damageType ?? 'damage';
    return `🩸 ${dice} ${dtype}`;
  }
  let text = e.name;
  if (e.value !== null && e.value !== undefined) text += ` ${e.value}`;
  if (e.duration !== null && e.duration !== undefined) text += ` (${e.duration}r)`;
  return text;
}

// ── Initiative display: hybrid pagination ────────────────────────────────────
// Layout strategy by combatant count:
//   1-4  combatants → all detailed (HP bar + effects sub-line per entry)
//   5+   combatants → current turn detailed, everyone else compact one-liners
//   >5   combatants → paginated, 5 per page, ◀ ▶ buttons; current turn's
//                    page is always shown by default (cursor follows the turn)
//
// PAGE_SIZE controls page break for compact mode. Picked 5 because compact
// lines now include HP bars (one per line) plus a blank line between each
// entry, so 5 fits comfortably on screen without scrolling. Crossing 5
// combatants is the most common encounter scale, so buttons appear when
// they matter.
const INIT_PAGE_SIZE = 5;
const INIT_COMPACT_THRESHOLD = 5; // 5+ combatants triggers compact mode

// Render ONE combatant in DETAILED form (HP bar, effects sub-line, all the trim).
// This is the "headline" rendering used for current turn and small encounters.
function renderCombatantDetailed(combatant, isCurrent) {
  const marker = isCurrent ? '🎯' : '▫️';
  const status = hpStatus(
    combatant.hp,
    combatant.maxHp,
    combatant.dying ?? 0,
    combatant.doomed ?? 0,
    combatant.unconscious === true,
  );

  // PCs see actual HP + bar; NPCs see status only (HP hidden from players).
  let hpInline;
  if (combatant.isNpc) {
    hpInline = status.label;
  } else {
    const bar = hpBar(combatant.hp, combatant.maxHp);
    hpInline = `\`${bar}\` ${combatant.hp}/${combatant.maxHp}`;
  }

  const acPart      = combatant.ac != null ? ` · AC ${combatant.ac}` : '';
  const woundedPart = (combatant.wounded ?? 0) > 0 ? ` · Wounded ${combatant.wounded}` : '';
  const doomedPart  = (combatant.doomed  ?? 0) > 0 ? ` · Doomed ${combatant.doomed}`   : '';
  const delayedPart = combatant.delayed ? ' · *Delayed*' : '';

  // Reaction indicator: ⤾ available, ⌀ used. Cross-platform-safe glyphs.
  let reactionPart = '';
  if (combatant.hasReaction !== false && (combatant.dying ?? 0) === 0 && !combatant.delayed) {
    reactionPart = combatant.reactionUsed ? ' · ⌀' : ' · ⤾';
  }

  // Active effects (excluding the dying/wounded/doomed pips, which already
  // surface in their own slots above).
  let effectLine = '';
  if (combatant.effects?.length) {
    const visible = combatant.effects.filter(e => {
      const k = e.presetKey;
      return k !== 'dying' && k !== 'wounded' && k !== 'doomed' && k !== 'unconscious';
    });
    if (visible.length) {
      const effectTexts = visible.map(formatEffectForEmbed);
      effectLine = `\n      *${effectTexts.join(', ')}*`;
    }
  }

  // Current turn gets a thick highlight: a separator line above and below,
  // and the name is wrapped in __underline__ + **bold** so it pops even on
  // mobile where the marker emoji might shrink. Non-current combatants get
  // a quieter, simpler line.
  const mainLine = `${marker} **${combatant.initiative}** — ${combatant.name} · ${hpInline}${acPart}${woundedPart}${doomedPart}${delayedPart}${reactionPart}${effectLine}`;
  if (isCurrent) {
    return `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n🎯 **__${combatant.initiative} — ${combatant.name}__** · ${hpInline}${acPart}${woundedPart}${doomedPart}${delayedPart}${reactionPart}${effectLine}\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`;
  }
  return mainLine;
}

// Render ONE combatant in COMPACT form (single line with HP bar, no effects).
// Used for everyone except the current turn when there are 5+ combatants.
function renderCombatantCompact(combatant, isCurrent) {
  const marker = isCurrent ? '🎯' : '▫️';
  const status = hpStatus(
    combatant.hp,
    combatant.maxHp,
    combatant.dying ?? 0,
    combatant.doomed ?? 0,
    combatant.unconscious === true,
  );

  // Compact HP: PCs show bar + HP/MAX; NPCs show qualitative status only
  // (still hides numeric HP from players, just like detailed mode).
  let hpPart;
  if (combatant.isNpc) {
    hpPart = status.label;
  } else {
    const bar = hpBar(combatant.hp, combatant.maxHp, 6); // shorter bar for compact
    hpPart = `\`${bar}\` ${combatant.hp}/${combatant.maxHp}`;
  }

  // Compact mode drops AC and reaction state to keep lines short. Doomed/
  // Wounded/Delayed still surface as terse keywords because they affect
  // tactical decisions ("oh that goblin's wounded, finish it").
  const tags = [];
  if ((combatant.wounded ?? 0) > 0) tags.push(`W${combatant.wounded}`);
  if ((combatant.doomed  ?? 0) > 0) tags.push(`D${combatant.doomed}`);
  if (combatant.delayed) tags.push('Delayed');
  if ((combatant.dying  ?? 0) > 0) tags.push(`Dying ${combatant.dying}`);
  const tagPart = tags.length ? ` · ${tags.join('/')}` : '';

  const nameDisplay = isCurrent ? `**__${combatant.name}__**` : combatant.name;
  return `${marker} **${combatant.initiative}** — ${nameDisplay} · ${hpPart}${tagPart}`;
}

// Compute which page (0-indexed) contains the given combatant index.
function pageForIndex(idx, pageSize) {
  return Math.floor(idx / pageSize);
}

// Build the initiative embed. Optional `pageOverride` lets the button handler
// jump to an arbitrary page (private/ephemeral); default is the page that
// contains the current turn so the cursor naturally follows.
function buildInitiativeEmbed(enc, { pageOverride = null } = {}) {
  const total = enc.combatants.length;
  if (total === 0) {
    return {
      embed: new EmbedBuilder()
        .setTitle(`Initiative — Round ${enc.round}`)
        .setDescription('*No combatants yet*')
        .setColor(0xAA0000),
      page: 0,
      totalPages: 1,
    };
  }

  // ── Mode A: Tiny encounter (1-4) — render everyone detailed, no pagination
  if (total < INIT_COMPACT_THRESHOLD) {
    const lines = enc.combatants.map((c, i) =>
      renderCombatantDetailed(c, i === enc.turnIndex)
    );
    return {
      embed: new EmbedBuilder()
        .setTitle(`Initiative — Round ${enc.round}`)
        .setDescription(lines.join('\n\n'))
        .setColor(0xAA0000),
      page: 0,
      totalPages: 1,
    };
  }

  // ── Mode B: 5+ combatants — compact list, current turn detailed
  // Pagination kicks in only when total > PAGE_SIZE. Default page is the
  // one containing the current turn so the embed always shows whoever's up.
  const pageSize = INIT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const naturalPage = pageForIndex(enc.turnIndex, pageSize);
  const page = pageOverride != null
    ? Math.max(0, Math.min(totalPages - 1, pageOverride))
    : naturalPage;

  const start = page * pageSize;
  const end = Math.min(total, start + pageSize);

  // Build the page's combatant lines. The current turn is detailed only if
  // they're ON this page; otherwise we show them in compact form like
  // everyone else and add a "Current turn elsewhere" note at the top.
  const lines = [];
  const currentOnThisPage = enc.turnIndex >= start && enc.turnIndex < end;
  if (!currentOnThisPage) {
    const cur = enc.combatants[enc.turnIndex];
    if (cur) {
      lines.push(`*Current turn (page ${naturalPage + 1}):* ${renderCombatantCompact(cur, true)}`);
      lines.push(''); // visual gap before page contents
    }
  }
  for (let i = start; i < end; i++) {
    const c = enc.combatants[i];
    const isCurrent = i === enc.turnIndex;
    if (isCurrent) {
      lines.push(renderCombatantDetailed(c, true));
    } else {
      lines.push(renderCombatantCompact(c, false));
    }
  }

  const pageSuffix = totalPages > 1 ? ` — Page ${page + 1}/${totalPages}` : '';
  const embed = new EmbedBuilder()
    .setTitle(`Initiative — Round ${enc.round}${pageSuffix}`)
    .setDescription(lines.join('\n\n'))
    .setColor(0xAA0000);

  if (totalPages > 1) {
    embed.setFooter({ text: `${total} combatants · ◀ ▶ for more (private view)` });
  }

  return { embed, page, totalPages };
}

// Build the action row of pagination buttons. Returns null when there's
// only one page so we don't post empty button rows.
function buildInitiativeButtons(channelId, page, totalPages) {
  if (totalPages <= 1) return null;
  // Compute prev/next with wrap-around. CRITICAL: when totalPages === 2 and
  // wrap-around is on, both prev and next would point to the SAME other page,
  // and Discord rejects duplicate custom_ids on a single message. So we DON'T
  // wrap — at the boundaries we just disable the button instead. Keeps the
  // UX honest (no surprise wrap) and dodges the duplicate-id error.
  const prevPage = page - 1;  // -1 means "no prev"
  const nextPage = page + 1;  // === totalPages means "no next"
  const hasPrev = prevPage >= 0;
  const hasNext = nextPage < totalPages;

  // Use a unique id per button position even when disabled, so Discord still
  // sees two distinct components. Disabled ids never fire so collisions
  // don't matter, but we keep them distinct for cleanliness.
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(hasPrev ? `init_page_${channelId}_${prevPage}` : `init_page_${channelId}_disabled_prev`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrev),
    new ButtonBuilder()
      .setCustomId(hasNext ? `init_page_${channelId}_${nextPage}` : `init_page_${channelId}_disabled_next`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasNext),
  );
}

async function updateSummary(channel, enc) {
  if (!enc) return;
  // Always render the summary at the natural page (the one containing the
  // current turn) so the cursor follows along automatically as /init next
  // rotates through combatants. Players who want to peek at later pages use
  // the buttons, which give them a private/ephemeral view.
  const { embed, page, totalPages } = buildInitiativeEmbed(enc);
  const buttons = buildInitiativeButtons(channel.id, page, totalPages);
  const components = buttons ? [buttons] : [];
  const payload = { embeds: [embed], components };

  if (enc.summaryMessageId) {
    try {
      const existing = await channel.messages.fetch(enc.summaryMessageId);
      await existing.edit(payload);
      return;
    } catch {}
  }
  try {
    const msg = await channel.send(payload);
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

async function updateCombatV2Summary(channel, encounter, { gmView = false } = {}) {
  if (!encounter) return null;
  const { embed, page, totalPages } = combatV2Render.renderEncounter(encounter, { gmView });
  const components = combatV2Render.pageButtons(channel.id, page, totalPages);
  const payload = { embeds: [embed], components };

  if (encounter.summaryMessageId) {
    try {
      const existing = await channel.messages.fetch(encounter.summaryMessageId);
      await existing.edit(payload);
      return existing;
    } catch {}
  }

  const msg = await channel.send(payload);
  encounter.summaryMessageId = msg.id;
  try {
    await msg.pin();
  } catch (err) {
    console.warn('Could not pin combat v2 summary message:', err.message);
  }
  return msg;
}

async function clearCombatV2Summary(channel, encounter) {
  if (!encounter?.summaryMessageId) return;
  try {
    const msg = await channel.messages.fetch(encounter.summaryMessageId);
    try { await msg.unpin(); } catch {}
  } catch {}
}

function combatV2Initiative(modifier, resultOverride = null) {
  if (resultOverride !== null && resultOverride !== undefined) {
    return { initiative: resultOverride, text: `(set to ${resultOverride})` };
  }
  const roll = rollD20Plus(modifier ?? 0);
  return { initiative: roll.total, text: `(rolled ${roll.roll} ${fmt(roll.mod)})` };
}

// getCharacterWeapons moved out of index.js in Phase 3.5 — see rules/lore.js or state/characters.js.

// normalizeCharacterDamageType moved out of index.js in Phase 3.5 — see rules/lore.js or state/characters.js.

// splitCharacterDamage moved out of index.js in Phase 3.5 — see rules/lore.js or state/characters.js.

// normalizePathwayCustomAttacks moved out of index.js in Phase 3.5 — see rules/lore.js or state/characters.js.

function combatV2CharacterAttacks(charEntry) {
  return getCharacterWeapons(charEntry).map(w => {
    const damage = splitCharacterDamage(w.die ?? '1d4', w.damageType);
    return {
      name: w.display ?? w.name,
      bonus: w.attack ?? 0,
      damage: `${damage.die}${w.damageBonus ? (w.damageBonus > 0 ? '+' : '') + w.damageBonus : ''}`,
      damageType: damage.damageType,
      traits: w.traits ?? [],
      source: 'character',
    };
  });
}

function combatV2CharacterSave(c, saveType) {
  const key = saveType === 'fortitude' ? 'fortitude'
    : saveType === 'reflex' ? 'reflex'
    : saveType === 'will' ? 'will'
    : saveType;
  const abilityKey = key === 'fortitude' ? 'con'
    : key === 'reflex' ? 'dex'
    : 'wis';
  const abilityMod = Math.floor(((c.abilities?.[abilityKey] ?? 10) - 10) / 2);
  return abilityMod + calcCharacterProfNum(c, c.proficiencies?.[key] ?? 0, c.level ?? 1);
}

const COMBAT_V2_SKILL_LABELS = {
  acrobatics: 'Acrobatics',
  arcana: 'Arcana',
  athletics: 'Athletics',
  crafting: 'Crafting',
  deception: 'Deception',
  diplomacy: 'Diplomacy',
  intimidation: 'Intimidation',
  medicine: 'Medicine',
  nature: 'Nature',
  occultism: 'Occultism',
  performance: 'Performance',
  religion: 'Religion',
  society: 'Society',
  stealth: 'Stealth',
  survival: 'Survival',
  thievery: 'Thievery',
};

function combatV2NormalizeSkillName(input) {
  const q = String(input ?? '').toLowerCase().trim();
  if (!q) return null;
  const slug = q.replace(/[^a-z0-9]+/g, '');
  return Object.keys(COMBAT_V2_SKILL_LABELS).find(key => key === q || key.replace(/[^a-z0-9]+/g, '') === slug)
    ?? Object.keys(COMBAT_V2_SKILL_LABELS).find(key => key.startsWith(q) || COMBAT_V2_SKILL_LABELS[key].toLowerCase().startsWith(q))
    ?? null;
}

function combatV2CharacterSkills(charEntry) {
  const skills = {};
  for (const [key, label] of Object.entries(COMBAT_V2_SKILL_LABELS)) {
    const mod = computeCharSkillModifier(charEntry, key);
    if (mod) skills[key] = { label, modifier: mod.modifier, profLabel: mod.profLabel };
  }
  return skills;
}

function combatV2FindSkill(actor, input) {
  const requested = String(input ?? '').toLowerCase().trim();
  if (requested === 'perception' || requested === 'initiative' || requested === 'init') {
    const perception = actor?.perception ?? actor?.stats?.perception ?? actor?.core?.perception ?? null;
    if (perception != null) {
      return {
        key: requested === 'perception' ? 'perception' : 'initiative',
        label: requested === 'perception' ? 'Perception' : 'Initiative',
        modifier: Number(perception),
        usesPerception: true,
      };
    }
  }

  const skills = actor?.skills ?? {};
  const normalized = combatV2NormalizeSkillName(input);
  if (normalized && skills[normalized] != null) {
    const raw = skills[normalized];
    return typeof raw === 'number'
      ? { key: normalized, label: COMBAT_V2_SKILL_LABELS[normalized], modifier: raw }
      : { key: normalized, label: raw.label ?? COMBAT_V2_SKILL_LABELS[normalized], modifier: Number(raw.modifier ?? raw.total ?? 0) };
  }

  const q = requested;
  for (const [key, raw] of Object.entries(skills)) {
    const label = raw?.label ?? key;
    if (key.toLowerCase() === q || label.toLowerCase() === q || label.toLowerCase().includes(q)) {
      return typeof raw === 'number'
        ? { key, label, modifier: raw }
        : { key, label, modifier: Number(raw.modifier ?? raw.total ?? raw ?? 0) };
    }
  }
  return null;
}

function combatV2CheckEmbed(actor, result, thumbnail = null) {
  const lines = [
    `1d20 (${result.die}) ${fmt(result.stat)}`,
  ];
  if (result.effectBonus) lines[0] += ` ${fmt(result.effectBonus)} effects`;
  if (result.bonus) lines[0] += ` ${fmt(result.bonus)} bonus`;
  lines[0] += ` = \`${result.total}\``;
  if (result.dc != null) lines.push(`DC ${result.dc}: **${combatV2Rolls.degreeLabel(result.degree)}**`);
  // Normalize "Performance Check" / "Fortitude Save" / "Spell Attack" into
  // natural-language titles: "Actor makes a Performance check!". The label
  // suffix is lowercased so the title reads like prose, not a column header.
  const prettyLabel = String(result.label ?? '').replace(/ (Check|Save|Attack)$/i, (_m, w) => ` ${w.toLowerCase()}`);
  const embed = new EmbedBuilder()
    .setColor(result.degree === 'criticalSuccess' ? 0x2ecc71
      : result.degree === 'success' ? 0x27ae60
      : result.degree === 'criticalFailure' ? 0x992d22
      : result.degree === 'failure' ? 0xc0392b
      : PATHWAY_GOLD)
    .setTitle(`${actor.name} makes a ${prettyLabel}!`)
    .setDescription(lines.join('\n'));
  if (thumbnail) embed.setThumbnail(thumbnail);
  else if (PATHWAY_DICE_BUFFER) embed.setThumbnail(PATHWAY_DICE_REF);
  return embed;
}

function combatV2SaveKey(saveType) {
  const key = String(saveType ?? '').toLowerCase();
  if (key.startsWith('fort')) return 'fort';
  if (key.startsWith('ref')) return 'ref';
  if (key.startsWith('will')) return 'will';
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function combatV2NormalizeMonsterSaves(core = {}, summary = {}, rich = null) {
  const summaryObj = summary.summary ?? summary ?? {};
  const richSaves = rich?.saves ?? rich?.defenses?.saves ?? {};
  const coreSaves = core.saves ?? {};
  return {
    fort: firstNumber(
      richSaves.fort,
      richSaves.fortitude,
      richSaves.Fortitude,
      coreSaves.fort,
      coreSaves.fortitude,
      core.fort,
      core.fortitude,
      summaryObj.fort,
      summaryObj.fortitude,
      summaryObj.Fortitude,
    ),
    ref: firstNumber(
      richSaves.ref,
      richSaves.reflex,
      richSaves.Reflex,
      coreSaves.ref,
      coreSaves.reflex,
      core.ref,
      core.reflex,
      summaryObj.ref,
      summaryObj.reflex,
      summaryObj.Reflex,
    ),
    will: firstNumber(
      richSaves.will,
      richSaves.Will,
      coreSaves.will,
      core.will,
      summaryObj.will,
      summaryObj.Will,
    ),
  };
}

function combatV2SaveModifier(combatant, saveKey, guildId = null) {
  const direct = combatant?.saves?.[saveKey];
  if (direct != null) {
    const number = Number(direct);
    if (Number.isFinite(number)) return number;
  }
  const lookupName = combatant?.sourceKey ?? combatant?.bestiaryKey ?? combatant?.name;
  if (!lookupName) return null;
  try {
    const { monster } = findMonster(lookupName);
    if (!monster) return null;
    return combatV2MonsterStats(monster, guildId).saves?.[saveKey] ?? null;
  } catch {
    return null;
  }
}

function combatV2DegreeLabel(degree) {
  return {
    criticalSuccess: 'Critical Success',
    success: 'Success',
    failure: 'Failure',
    criticalFailure: 'Critical Failure',
  }[degree] ?? 'Result';
}

function combatV2LegacyDegree(degree) {
  return {
    criticalSuccess: 'crit-success',
    success: 'success',
    failure: 'failure',
    criticalFailure: 'crit-failure',
  }[degree] ?? degree;
}

function combatV2PickCaster(charEntry, spell, casterName = null) {
  const c = charEntry?.data ?? {};
  const casters = charOverlay.getCasters(c);
  if (!casters.length) return null;
  if (casterName) return charOverlay.findCaster(c, casterName);
  const spellTraditions = (spell.traditions ?? []).map(t => String(t).toLowerCase());
  return casters.find(sc => spellTraditions.includes(String(sc.magicTradition ?? '').toLowerCase())) ?? casters[0];
}

function combatV2CasterStats(charEntry, spell, casterName = null) {
  const c = charEntry?.data ?? {};
  const caster = combatV2PickCaster(charEntry, spell, casterName);
  const traditionProfMap = { arcane: 'castingArcane', divine: 'castingDivine', occult: 'castingOccult', primal: 'castingPrimal' };
  const tradAbilMap = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
  const tradition = String(caster?.magicTradition ?? spell.traditions?.[0] ?? 'arcane').toLowerCase();
  const keyAbility = String(caster?.ability ?? tradAbilMap[tradition] ?? 'int').toLowerCase();
  const keyMod = Math.floor((((c.abilities ?? {})[keyAbility] ?? 10) - 10) / 2);
  const profKey = traditionProfMap[tradition] ?? 'castingArcane';
  const profNum = (c.proficiencies ?? {})[profKey] ?? 2;
  const profBonus = calcProfNum(profNum, c.level ?? 1);
  return { caster, attack: keyMod + profBonus, dc: 10 + keyMod + profBonus, tradition };
}

function combatV2ParseDefenseMap(input) {
  if (input == null) return null;
  const map = {};
  for (const part of String(input).split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)\s+(-?\d+)$/);
    if (!match) continue;
    map[match[1].trim().toLowerCase()] = Number(match[2]);
  }
  return map;
}

function combatV2ParseList(input) {
  if (input == null) return null;
  return String(input).split(',').map(s => s.trim()).filter(Boolean);
}

function combatV2CompanionAttacks(comp, scaled) {
  const attacks = [];
  if (scaled.primaryAttack) {
    attacks.push({
      name: scaled.primaryAttack.name,
      bonus: scaled.attackBonus,
      damage: `${scaled.damageDice}${scaled.damageBonus !== 0 ? (scaled.damageBonus > 0 ? '+' : '') + scaled.damageBonus : ''}`,
      damageType: scaled.damageType ?? '',
      traits: scaled.primaryAttack.traits ?? [],
      source: 'companion',
    });
  }
  for (const a of (comp.customAttacks ?? [])) {
    attacks.push({
      name: a.name,
      bonus: a.bonus ?? 0,
      damage: a.damage ?? '1d4',
      damageType: a.damageType ?? '',
      traits: a.traits ?? [],
      source: 'companion-custom',
    });
  }
  return attacks;
}

function combatV2MonsterStats(monster, guildId) {
  const edits = guildId ? getMonsterEdit(guildId, monster.name) : null;
  const edited = applyMonsterEdits(monster, edits);
  const withLibrary = guildId ? applyMonsterAttackLibrary(edited, guildId) : edited;
  const core = withLibrary.core ?? {};
  const summary = withLibrary.summary ?? {};
  const rich = withLibrary.rich ?? null;
  const rawAttacks = Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
  const spellcasting = Array.isArray(rich?.spellcasting) ? rich.spellcasting : [];
  const spells = [];
  for (const caster of spellcasting) {
    const byRank = caster.spells_by_level ?? {};
    for (const [rank, bucket] of Object.entries(byRank)) {
      for (const entry of (bucket?.spells ?? [])) {
        const name = entry?.name ?? String(entry ?? '');
        if (!name) continue;
        spells.push({
          name,
          rank: Number(rank),
          dc: caster.DC ?? caster.dc ?? null,
          attack: caster.attack_bonus ?? caster.attack ?? null,
          tradition: caster.tradition ?? null,
          type: caster.type ?? null,
          source: 'bestiary',
        });
      }
    }
  }
  const resistanceMap = {};
  for (const r of rich?.defenses?.resistances ?? []) {
    if (typeof r === 'string') {
      const match = r.match(/^(.+?)\s+(\d+)$/);
      if (match) resistanceMap[match[1].trim().toLowerCase()] = Number(match[2]);
    } else if (r?.type && r?.value != null) {
      resistanceMap[String(r.type).toLowerCase()] = Number(r.value);
    }
  }
  const weaknessMap = {};
  for (const w of rich?.defenses?.weaknesses ?? []) {
    if (typeof w === 'string') {
      const match = w.match(/^(.+?)\s+(\d+)$/);
      if (match) weaknessMap[match[1].trim().toLowerCase()] = Number(match[2]);
    } else if (w?.type && w?.value != null) {
      weaknessMap[String(w.type).toLowerCase()] = Number(w.value);
    }
  }
  return {
    monster: withLibrary,
    hp: core.hp ?? summary.summary?.hp?.value ?? rich?.defenses?.hp ?? 1,
    ac: core.ac ?? summary.summary?.ac ?? rich?.defenses?.ac ?? null,
    perception: core.perception ?? summary.summary?.perception ?? rich?.perception ?? 0,
    saves: combatV2NormalizeMonsterSaves(core, summary, rich),
    skills: (rich?._skillTotals && typeof rich._skillTotals === 'object') ? { ...rich._skillTotals }
      : (rich?.skills && typeof rich.skills === 'object') ? { ...rich.skills }
      : {},
    spells,
    resistances: resistanceMap,
    weaknesses: weaknessMap,
    immunities: Array.isArray(rich?.defenses?.immunities) ? rich.defenses.immunities : [],
    attacks: rawAttacks.map(a => {
      const normalized = normalizeAttackForRolling(a);
      return {
        name: normalized.name,
        bonus: normalized.bonus ?? normalized.to_hit ?? 0,
        damage: normalized.damage ?? '1d4',
        damageType: normalized.damageType ?? '',
        traits: normalized.traits ?? [],
        source: 'bestiary',
      };
    }),
  };
}

function uniqueCombatV2Name(encounter, baseName, count, index) {
  const taken = new Set((encounter?.combatants ?? []).map(c => c.name.toLowerCase()));
  if (count === 1 && !taken.has(baseName.toLowerCase())) return baseName;
  let suffix = index;
  let name = `${baseName} ${suffix}`;
  while (taken.has(name.toLowerCase())) {
    suffix += 1;
    name = `${baseName} ${suffix}`;
  }
  return name;
}

function combatV2HasName(encounter, name) {
  return (encounter?.combatants ?? []).some(c => c.name.toLowerCase() === String(name).toLowerCase());
}

function combatV2PickActor(encounter, userId, actorName = null) {
  if (!encounter) return null;
  if (actorName) return combatV2State.findCombatant(encounter, actorName);
  const current = combatV2State.currentCombatant(encounter);
  if (current && (current.ownerId === userId || userId === encounter.gmId)) return current;
  const owned = encounter.combatants.filter(c => c.ownerId === userId && c.hp > 0);
  return owned.length === 1 ? owned[0] : null;
}

function combatV2PickTarget(encounter, actor, targetName = null) {
  if (!encounter || !actor) return null;
  if (targetName) return combatV2State.findCombatant(encounter, targetName);
  const enemies = encounter.combatants.filter(c =>
    c.id !== actor.id &&
    c.hp > 0 &&
    c.isNpc !== actor.isNpc
  );
  return enemies[0] ?? null;
}

function combatV2FindAttack(actor, attackName = null) {
  const attacks = actor?.attacks ?? [];
  if (attacks.length === 0) return null;
  if (!attackName) return attacks[0];
  const q = String(attackName).toLowerCase().trim();
  return attacks.find(a => a.name.toLowerCase() === q)
    ?? attacks.find(a => a.name.toLowerCase().includes(q))
    ?? null;
}

function combatV2AttackListText(actor) {
  const attacks = actor?.attacks ?? [];
  if (!attacks.length) return `**${actor?.name ?? 'Actor'}** has no attacks configured.`;
  return attacks.map(a => {
    const traits = a.traits?.length ? ` (${a.traits.join(', ')})` : '';
    const damage = a.damage ? `, ${a.damage}${a.damageType ? ` ${a.damageType}` : ''}` : '';
    return `• **${a.name}** ${fmt(a.bonus ?? 0)}${damage}${traits}`;
  }).join('\n');
}

// ── Recovery check display helper ────────────────────────────────────────────
// Builds the embed + optional Hero Point buttons for a recovery check result.
// Used by both /init next (auto-roll on dying combatant's turn start) and
// /init recovery (manual force-roll). Returns { embeds, components }.
//
// Hero Point options shown to PCs:
//   - Reroll (if dying value WORSENED and HP ≥ 1): one-button reroll
//   - Escape death (if died OR dying increased): spend ALL hero points to
//     stabilize at 0 HP without gaining wounded
//
// Pass in the recovery check result from ca.rollRecoveryCheck and the combatant.
function buildRecoveryCheckPayload(rc, combatant, { heroButtons = true } = {}) {
  const outcomeEmoji = rc.outcome === 'crit-success' ? '🌟'
    : rc.outcome === 'success' ? '✅'
    : rc.outcome === 'failure' ? '❌'
    : '💥';

  // Build the embed description with all the Remaster details
  const lines = [
    `Flat check vs DC ${rc.dc}: 1d20 (${rc.roll})`,
    `${outcomeEmoji} **${rc.outcome.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}**`,
    rc.narration,
  ];
  if (rc.doomed && rc.doomed > 0) {
    lines.splice(1, 0, `*Doomed ${rc.doomed} → death threshold is Dying ${rc.maxDying}*`);
  }

  const embed = new EmbedBuilder()
    .setColor(rc.died ? 0x8B0000 : rc.awoke ? 0x2ecc71 : rc.outcome === 'success' || rc.outcome === 'crit-success' ? 0x27ae60 : 0xe74c3c)
    .setTitle(`💀 ${combatant.name}'s Recovery Check`)
    .setDescription(lines.join('\n'));

  const components = [];
  if (!heroButtons || combatant.isNpc || !combatant.ownerId) return { embeds: [embed], components };

  // Look up hero points (PCs only)
  let heroPoints = 0;
  try {
    const characters = loadCharacters();
    const userCharacters = characters[combatant.ownerId] ?? {};
    const charKey = combatant.name.toLowerCase().replace(/\s+/g, '-');
    const charEntry = userCharacters[charKey];
    heroPoints = charEntry?.heroPoints ?? (charEntry ? 1 : 0);
  } catch (err) {
    console.error('Recovery check: hero point lookup failed:', err);
  }

  if (heroPoints <= 0) return { embeds: [embed], components };

  const safeName = combatant.name.replace(/[^a-zA-Z0-9]/g, '_');
  const buttons = [];

  // "Reroll" button — only when not dead. Reroll one die, keep better.
  if (!rc.died) {
    const awokeFlag = rc.awoke ? '1' : '0';
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`rcheck_reroll_${safeName}_${rc.dyingBefore}_${rc.dyingAfter}_${rc.roll}_${awokeFlag}`)
        .setLabel(`🎭 Reroll (1 HP)`)
        .setStyle(ButtonStyle.Primary)
    );
  }

  // "Spend all to escape death" button — show whenever they got worse OR died.
  // PF2e RAW: triggers at start of turn OR when dying value would increase.
  const dyingWentUp = rc.dyingAfter > rc.dyingBefore;
  if (rc.died || dyingWentUp) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`rcheck_stabilize_${safeName}`)
        .setLabel(`🛡️ Escape Death (spend all ${heroPoints} HP)`)
        .setStyle(rc.died ? ButtonStyle.Danger : ButtonStyle.Secondary)
    );
  }

  if (buttons.length > 0) {
    components.push(new ActionRowBuilder().addComponents(...buttons));
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

// Parse a bestiary-style compound damage string like "3d12+15 piercing plus 2d6 fire"
// or "4d8 void plus siphon life" (the trailing non-dice rider becomes a flavor note).
//
// Returns an array of damage parts. Each part has:
//   { expr: '3d12+15', type: 'piercing', rollResult: {...} }   ← rollable
//   { expr: null, type: null, note: 'siphon life' }             ← flavor only
//
// If nothing parses out, returns null. Use this for monster attacks where the
// damage may be compound. For simple "1d6+2" expressions, rollDamageExpression
// is the right tool.
function parseAndRollAttackDamage(damageString) {
  if (!damageString || typeof damageString !== 'string') return null;
  // Split on " plus " to handle compound damage. PF2e canonically uses "plus"
  // as the separator; we lowercase to be safe.
  const parts = damageString.split(/\s+plus\s+/i);
  const out = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Try to extract a dice expression followed by a damage type. Patterns:
    //   "1d6 slashing"
    //   "3d12+15 piercing"
    //   "2d6 fire"
    //   "siphon life"   ← no dice, treat as flavor note
    const dmgMatch = trimmed.match(/^(\d*d\d+(?:[+-]\d+)?)\s+(.+)$/i);
    if (dmgMatch) {
      const expr = dmgMatch[1];
      const type = dmgMatch[2].trim().toLowerCase();
      const rollResult = rollDamageExpression(expr);
      if (rollResult) {
        out.push({ expr, type, rollResult });
        continue;
      }
    }
    // Non-dice part — treat as flavor (e.g. "siphon life", "grab", "knockdown")
    out.push({ expr: null, type: null, note: trimmed });
  }
  return out.length > 0 ? out : null;
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

// Damage type → emoji. Falls back to ⚔️ for unknown types. PF2e has a fixed
// set of damage types; these cover every canonical type in the Player Core.
const DAMAGE_TYPE_EMOJI = {
  acid: '🧪', bleed: '🩸', bludgeoning: '🔨', chaotic: '🌀', cold: '❄️',
  electricity: '⚡', evil: '😈', fire: '🔥', force: '✨', good: '🌟',
  lawful: '⚖️', mental: '🧠', negative: '💀', physical: '💥', piercing: '🏹',
  poison: '☠️', positive: '✨', slashing: '🗡️', sonic: '🔊', spirit: '👻',
  untyped: '⚔️', vitality: '💖', void: '🕳️',
};
function damageTypeEmoji(type) {
  if (!type) return '⚔️';
  const key = String(type).toLowerCase().trim();
  // Handle "persistent fire", "precision", etc. — strip qualifiers, match main word
  for (const [k, emoji] of Object.entries(DAMAGE_TYPE_EMOJI)) {
    if (key.includes(k)) return emoji;
  }
  return '⚔️';
}

// Find a save bonus for a combatant. Checks in order:
//   1. Character-sheet data (PC combatants)
//   2. Bestiary data (NPC combatants matched by name to a monster)
//   3. Stored combatant overrides (from /init addnpc with manual stats)
// Returns { bonus, source } or null if no info.
// saveType must be one of 'fortitude' / 'reflex' / 'will' (case-insensitive).
function getTargetSaveBonus(target, saveType, loadedCharacters) {
  if (!target || !saveType) return null;
  const key = String(saveType).toLowerCase();
  const normalized = key.startsWith('fort') ? 'fort' : key.startsWith('ref') ? 'ref' : key.startsWith('will') ? 'will' : null;
  if (!normalized) return null;

  // Combatants may have saveBonuses attached from /init addmonster integration.
  // Preferred source — matches whatever the bestiary/GM configured.
  if (target.saveBonuses && target.saveBonuses[normalized] != null) {
    return { bonus: target.saveBonuses[normalized], source: 'stored' };
  }

  // PC combatants: look up their character sheet
  if (!target.isNpc && target.ownerId) {
    const characters = loadedCharacters ?? loadCharacters();
    const userChars = characters[target.ownerId] ?? {};
    for (const charEntry of Object.values(userChars)) {
      if (charEntry?.data?.name && charEntry.data.name.toLowerCase() === target.name.toLowerCase()) {
        const c = charEntry.data;
        const ab = c.abilities ?? {};
        const prof = c.proficiencies ?? {};
        const lvl = c.level ?? 1;
        const abilityFor = { fort: 'con', ref: 'dex', will: 'wis' };
        const profKey = { fort: 'fortitude', ref: 'reflex', will: 'will' };
        const abilMod = Math.floor(((ab[abilityFor[normalized]] ?? 10) - 10) / 2);
        const profNum = prof[profKey[normalized]] ?? 0;
        const itemBonus = (c.overlay?.saveItemBonuses?.[normalized]) ?? 0;
        return { bonus: abilMod + calcCharacterProfNum(c, profNum, lvl) + itemBonus, source: 'character' };
      }
    }
  }

  // NPC combatants: try the bestiary
  if (target.isNpc) {
    const { monster } = findMonster(target.name) || {};
    if (monster) {
      const rich = monster.rich ?? null;
      const coreSaves = monster.core?.saves ?? {};
      const legacySaves = monster.summary?.summary ?? {};
      const saveMap = { fort: ['fort', 'fortitude'], ref: ['ref', 'reflex'], will: ['will'] };
      for (const k of saveMap[normalized]) {
        if (coreSaves[k] != null) return { bonus: coreSaves[k], source: 'bestiary' };
        if (legacySaves[k] != null) return { bonus: legacySaves[k], source: 'bestiary' };
        if (rich?.defenses?.saves?.[k.charAt(0).toUpperCase() + k.slice(1)] != null) {
          return { bonus: rich.defenses.saves[k.charAt(0).toUpperCase() + k.slice(1)], source: 'bestiary' };
        }
      }
    }
  }

  return null;
}

// Roll a save and compute the degree of success vs the given DC.
// Returns { dieRoll, total, degree } — degree is 'crit-success' | 'success' |
// 'failure' | 'crit-failure'. Uses the same DoS table as attack rolls.
function rollSaveForTarget(bonus, dc) {
  const dieRoll = Math.floor(Math.random() * 20) + 1;
  const total = dieRoll + bonus;
  const degree = determineDegreeOfSuccess(total, dieRoll, dc);
  return { dieRoll, total, degree };
}

// Given a spell's damage and a basic-save degree of success, return the final
// damage amount. Per PF2e Remaster:
//   crit-success → 0 damage
//   success → half damage (rounded down)
//   failure → full damage
//   crit-failure → double damage (ALL dice and bonuses)
function basicSaveDamage(fullDamage, degree) {
  if (degree === 'crit-success') return 0;
  if (degree === 'success')      return Math.floor(fullDamage / 2);
  if (degree === 'failure')      return fullDamage;
  if (degree === 'crit-failure') return fullDamage * 2;
  return fullDamage;
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
function normalizeReferenceQuery(str) {
  return String(str ?? '').toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ');
}

function referenceSourcePriority(entry) {
  const source = String(entry?.source ?? '').toLowerCase();
  const category = String(entry?.category ?? '').toLowerCase();
  const text = `${source} ${category}`;
  const priorities = [
    'player core 2',
    'player core',
    'gm core',
    'monster core',
    'rage of elements',
    'war of immortals',
    'core rulebook',
    'gamemastery guide',
    'bestiary',
  ];
  const index = priorities.findIndex(name => text.includes(name));
  return index === -1 ? priorities.length : index;
}

function pickReferenceEntry(entries) {
  return [...entries].sort((a, b) =>
    referenceSourcePriority(a) - referenceSourcePriority(b) ||
    String(a.source ?? '').localeCompare(String(b.source ?? '')) ||
    String(a.category ?? '').localeCompare(String(b.category ?? '')) ||
    String(a.name ?? '').localeCompare(String(b.name ?? ''))
  )[0] ?? null;
}

function findReference(commandName, query) {
  const q = normalizeReferenceQuery(query);
  const db = referenceDatabases[commandName] ?? [];
  if (!q) return { entry: null, matches: [] };

  const exact = db.filter(e => normalizeReferenceQuery(e.name) === q || normalizeReferenceQuery(e.slug) === q);
  if (exact.length === 1) return { entry: exact[0], matches: [] };
  if (exact.length > 1) return { entry: pickReferenceEntry(exact), matches: [], exactDuplicates: true };

  const starts = db.filter(e => normalizeReferenceQuery(e.name).startsWith(q));
  if (starts.length === 1) return { entry: starts[0], matches: [] };
  if (starts.length > 1 && starts.length <= 25) return { entry: null, matches: starts };

  const contains = db.filter(e => normalizeReferenceQuery(e.name).includes(q));
  if (contains.length === 1) return { entry: contains[0], matches: [] };
  if (contains.length > 1) return { entry: null, matches: contains.slice(0, 25), total: contains.length };

  return { entry: null, matches: [] };
}

function referenceCategoryLabel(category) {
  return String(category ?? 'reference')
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildReferenceEmbed(commandName, entry) {
  const cfg = REFERENCE_DATABASE_CONFIG[commandName] ?? {};
  const level = entry.level != null && !Number.isNaN(entry.level) ? ` ${entry.level}` : '';
  const category = referenceCategoryLabel(entry.category);
  const embed = new EmbedBuilder()
    .setColor(cfg.color ?? 0x7289da)
    .setTitle(`${cfg.icon ?? '📖'} ${entry.name}`)
    .setDescription(truncateField(entry.description || entry.summary || 'No description available.', 3900));

  const meta = [];
  if (category) meta.push(category);
  if (entry.rarity && entry.rarity !== 'Common') meta.push(entry.rarity);
  if (level) meta.push(`Level${level}`);
  if (meta.length) embed.addFields({ name: 'Type', value: meta.join(' • '), inline: true });
  if (entry.actions) embed.addFields({ name: 'Actions', value: truncateField(entry.actions, 256), inline: true });
  if (entry.traits?.length) embed.addFields({ name: 'Traits', value: truncateField(entry.traits.join(', '), 1024), inline: false });
  if (entry.trigger) embed.addFields({ name: 'Trigger', value: truncateField(entry.trigger), inline: false });
  if (entry.requirements) embed.addFields({ name: 'Requirements', value: truncateField(entry.requirements), inline: false });
  if (entry.frequency) embed.addFields({ name: 'Frequency', value: truncateField(entry.frequency), inline: false });
  if (entry.prerequisite) embed.addFields({ name: 'Prerequisites', value: truncateField(entry.prerequisite), inline: false });
  if (entry.access) embed.addFields({ name: 'Access', value: truncateField(entry.access), inline: false });
  if (entry.price_raw || entry.bulk_raw) {
    embed.addFields({
      name: 'Stats',
      value: [`Price: ${entry.price_raw ?? '—'}`, `Bulk: ${entry.bulk_raw ?? '—'}`].join(' • '),
      inline: false,
    });
  }
  if (entry.aon_url) embed.addFields({ name: 'AoN', value: entry.aon_url, inline: false });
  embed.setFooter({ text: `${cfg.label ?? 'Reference'} • ${entry.source ?? 'Pathfinder 2e'}` });
  return embed;
}

// ── Companion lookup ─────────────────────────────────────────────────────────
// Format an attack line for the companion embed:
//   "◆ **jaws** (finesse) — 1d8 piercing"
// Format the ability scores line: "Str +2, Dex +3, Con +2, Int -4, Wis +1, Cha +0"
// Build the companion info embed. Shows the full Young-tier statblock with
// description, abilities, defenses, offense, support benefit, and maneuver.
// Build a paginated list embed of companions, optionally filtered by category.

// Scale a companion's combat stats by character level + form.
function buildCompanionSheetEmbed(comp, scaled, char, charEntry, isActive) {
  const customLabel = comp.customStats?.fromBestiary ?? comp.customStats?.sourceName ?? 'custom';
  const embed = new EmbedBuilder()
    .setColor(isActive ? 0xf39c12 : 0x7289DA)
    .setTitle(`🐾 ${comp.displayName}${isActive ? ' ⭐' : ''}`)
    .setDescription(`*${char.name}'s ${comp.form} ${comp.baseType === 'custom' ? customLabel : comp.baseType} companion*`);

  // Show portrait if set. Prefer companion.art, fall back to character art.
  if (comp.art) embed.setThumbnail(comp.art);
  else if (charEntry.art) embed.setThumbnail(charEntry.art);

  // Mark overridden fields with a small visible flag
  const ov = comp.overrides ?? {};
  const flag = (key) => ov[key] != null ? ' ✏️' : '';
  const abFlag = (key) => (ov.abilities && ov.abilities[key] != null) ? '\\*' : '';
  const saveFlag = (key) => (ov.saves && ov.saves[key] != null) ? '\\*' : '';

  const hp = comp.currentHp ?? scaled.maxHp;
  embed.addFields({ name: '🛡️ Defenses', value: `**HP** ${hp}/${scaled.maxHp}${flag('hp')} · **AC** ${scaled.ac}${flag('ac')} · **Size** ${scaled.size}${flag('size')} · **Speed** ${scaled.speed}${flag('speed')}`, inline: false });
  embed.addFields({ name: '💪 Saves', value: `**Fort** ${fmt(scaled.saves.fort)}${saveFlag('fort')} · **Ref** ${fmt(scaled.saves.ref)}${saveFlag('ref')} · **Will** ${fmt(scaled.saves.will)}${saveFlag('will')} · **Perception** ${fmt(scaled.perception)}${flag('perception')}`, inline: false });
  const ab = scaled.abilities;
  embed.addFields({ name: '📊 Abilities', value: `Str ${fmt(ab.str ?? 0)}${abFlag('str')} · Dex ${fmt(ab.dex ?? 0)}${abFlag('dex')} · Con ${fmt(ab.con ?? 0)}${abFlag('con')} · Int ${fmt(ab.int ?? -4)}${abFlag('int')} · Wis ${fmt(ab.wis ?? 0)}${abFlag('wis')} · Cha ${fmt(ab.cha ?? 0)}${abFlag('cha')}`, inline: false });

  // Skills (override-only). Display alphabetically.
  const skills = comp.skills ?? {};
  const skillEntries = Object.entries(skills).sort(([a], [b]) => a.localeCompare(b));
  if (skillEntries.length > 0) {
    const line = skillEntries.map(([name, bonus]) => `**${name}** ${fmt(bonus)}`).join(' · ');
    embed.addFields({ name: '🎯 Skills', value: line.slice(0, 1020), inline: false });
  }

  // Attacks: primary (from catalog/custom, with scaling) + any custom attacks
  // added via /companion attack add. Show all of them.
  const attackLines = [];
  if (scaled.primaryAttack) {
    const traits = scaled.primaryAttack.traits?.length ? ` *(${scaled.primaryAttack.traits.join(', ')})*` : '';
    const dmgBonus = scaled.damageBonus !== 0 ? (scaled.damageBonus > 0 ? `+${scaled.damageBonus}` : `${scaled.damageBonus}`) : '';
    attackLines.push(`**${scaled.primaryAttack.name}**${traits} — **+${scaled.attackBonus}**${flag('attackBonus')} to hit · **${scaled.damageDice}${flag('damageDice')}${dmgBonus}${flag('damageBonus')}** ${scaled.damageType}`);
  }
  if (Array.isArray(comp.customAttacks) && comp.customAttacks.length) {
    for (const atk of comp.customAttacks) {
      const traits = atk.traits?.length ? ` *(${atk.traits.join(', ')})*` : '';
      const bonusText = atk.bonus != null ? `**${fmt(atk.bonus)}** to hit · ` : '';
      const dmgText = atk.damage ? `**${atk.damage}** ${atk.damageType ?? ''}` : '';
      attackLines.push(`**${atk.name}**${traits} — ${bonusText}${dmgText}`);
    }
  }
  if (attackLines.length) {
    embed.addFields({ name: '⚔️ Attacks', value: attackLines.join('\n').slice(0, 1020), inline: false });
  }

  // Abilities: free-form text abilities + structured maneuver-style ones
  if (Array.isArray(comp.customAbilities) && comp.customAbilities.length) {
    const abilityLines = comp.customAbilities.map(a => {
      if (a.actionCost) {
        const costIcon = { 'one-action': '◆', 'two-actions': '◆◆', 'three-actions': '◆◆◆', 'reaction': '⤾', 'free-action': '◇' }[a.actionCost] ?? a.actionCost;
        return `**${a.name}** ${costIcon} — ${a.description}`;
      }
      return `**${a.name}** — ${a.description}`;
    });
    embed.addFields({ name: '✨ Abilities', value: abilityLines.join('\n').slice(0, 1020), inline: false });
  }

  if (comp.notes) embed.addFields({ name: '📝 Notes', value: comp.notes.slice(0, 1020), inline: false });
  const hasOverrides = (scaled.overriddenFields ?? []).length > 0;
  const footerExtra = hasOverrides ? ` · ✏️ = overridden` : '';
  embed.setFooter({ text: `Character: ${char.name} · /companion set to customize${footerExtra}` });
  return embed;
}



// Given a combatant from the encounter (with bestiaryKey set by /init addmonster),
// return the merged list of attacks available on that monster: bestiary base
// attacks + GM edits + monster_attacks library entries. Returns [] if the
// combatant has no bestiary backing (e.g. they were added via /init addnpc).
function getCombatantAttacks(combatant, guildId) {
  if (!combatant?.bestiaryKey) return [];
  const { monster } = findMonster(combatant.bestiaryKey);
  if (!monster) return [];
  // Same pipeline /init addmonster used: GM edits + attack library overlay
  const edits = guildId ? getMonsterEdit(guildId, monster.name) : null;
  const edited = applyMonsterEdits(monster, edits);
  const withLibrary = guildId ? applyMonsterAttackLibrary(edited, guildId) : edited;
  return Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
}

function findCombatantLoose(enc, name) {
  if (!enc || !name) return null;
  const q = String(name).toLowerCase().trim();
  const exact = enc.combatants.find(c => c.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = enc.combatants.filter(c => c.name.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0] : null;
}

function pickDefaultAttacker(enc, userId, attackerName) {
  if (!enc || enc.combatants.length === 0) return null;
  if (attackerName) return findCombatantLoose(enc, attackerName);
  const current = enc.combatants[enc.turnIndex] ?? null;
  if (current && (current.ownerId === userId || userId === enc.gmId)) return current;
  const owned = enc.combatants.filter(c => c.ownerId === userId && c.hp > 0);
  return owned.length === 1 ? owned[0] : current;
}

function pickDefaultTarget(enc, attacker, targetName) {
  if (!enc || !attacker) return null;
  if (targetName) return findCombatantLoose(enc, targetName);
  const enemies = enc.combatants.filter(c =>
    c.name.toLowerCase() !== attacker.name.toLowerCase() &&
    c.hp > 0 &&
    c.isNpc !== attacker.isNpc
  );
  return enemies[0] ?? null;
}

function findCharacterEntryForCombatant(characters, combatant) {
  if (!combatant?.ownerId) return null;
  const owned = characters[combatant.ownerId] ?? {};
  for (const key of Object.keys(owned).filter(k => !k.startsWith('_'))) {
    const entry = owned[key];
    const charName = entry?.data?.name ?? entry?.name;
    if (charName && charName.toLowerCase() === combatant.name.toLowerCase()) {
      return { charKey: key, char: entry, companion: null };
    }
    const companions = entry?.companions ?? {};
    const companion = Object.values(companions).find(c =>
      c?.displayName && c.displayName.toLowerCase() === combatant.name.toLowerCase()
    );
    if (companion) return { charKey: key, char: entry, companion };
  }
  return null;
}

// Find a specific named attack on a combatant. Tries exact match first,
// then case-insensitive, then substring. Returns null if nothing matches.
function findCombatantAttack(combatant, attackName, guildId) {
  const attacks = getCombatantAttacks(combatant, guildId);
  if (attacks.length === 0) return null;
  const q = String(attackName ?? '').toLowerCase().trim();
  if (!q) return attacks[0];
  // 1. Exact (case-insensitive) match
  const exact = attacks.find(a => String(a.name ?? '').toLowerCase() === q);
  if (exact) return exact;
  // 2. Substring match — return only if unambiguous
  const partial = attacks.filter(a => String(a.name ?? '').toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  return null;
}

// ── Attack schema normalizer ──────────────────────────────────────────────
// The bestiary parser stores attacks in a different shape than the saved
// attack library:
//
//   Bestiary shape (from parsers/bestiaryParser.js):
//     { type: 'melee'|'ranged', name, to_hit, traits, damage: "1d8+7 slashing plus Knockdown" }
//
//   Library shape (from /m attack add):
//     { kind: 'strike'|'spell'|'save', name, bonus, damage, damageType, traits, extraDamage, extraType }
//
// The rolling code (in /m attack use) keys off `kind`, `bonus`, `damage`,
// `damageType` — so a raw bestiary attack ends up with `attack.kind === undefined`
// and falls through to "Unknown attack kind". This helper converts bestiary
// shape into library shape so they can both flow through the same roller.
//
// Returns the input unchanged if it already has a `kind` field (i.e. it's
// already library-shaped). Idempotent.
function normalizeAttackForRolling(attack) {
  if (!attack || typeof attack !== 'object') return attack;

  const bonusRaw = attack.bonus
    ?? attack.to_hit
    ?? attack.toHit
    ?? attack.attack_bonus
    ?? attack.attackBonus
    ?? attack.attack;
  const bonus = Number.isFinite(Number(bonusRaw)) ? Number(bonusRaw) : 0;

  // Parse the damage string. Examples we need to handle:
  //   "1d8+7 slashing"
  //   "2d6 fire"
  //   "1d8+3 piercing plus Knockdown"          ← extra is non-dice text
  //   "1d6+3 bludgeoning plus 1d6 fire"        ← extra is dice + type
  //   "4d12+16 slashing plus 1d6 cold and Grotesque Gift"
  const dmgRaw = String(
    attack.damage
      ?? attack.damageDice
      ?? attack.damage_dice
      ?? attack.die
      ?? ''
  ).trim();
  // Match the leading dice expression + one word (the damage type).
  // Pattern: digits + 'd' + digits + optional +/-N, then a single word.
  const mainMatch = dmgRaw.match(/^(\d+d\d+(?:[+-]\d+)?)\s+([a-z]+)/i);
  let mainDamage = attack.damageDice ?? attack.damage_dice ?? attack.die ?? null;
  let mainType = attack.damageType ?? attack.damage_type ?? null;
  let trailing = '';
  if (mainMatch) {
    mainDamage = mainMatch[1];
    mainType = mainMatch[2].toLowerCase();
    trailing = dmgRaw.slice(mainMatch[0].length).trim();
  } else if (/^\d+d\d+(?:[+-]\d+)?$/i.test(dmgRaw)) {
    mainDamage = dmgRaw;
  } else {
    // Couldn't parse — best effort: pass the whole string as damage and
    // leave damageType unset. Rolling will still attempt to roll.
    mainDamage = dmgRaw || '0';
    mainType = mainType ?? '';
  }

  // Look for "plus <dice> <type>" trailing fragment for extra damage.
  // We only auto-extract dice-typed extras; non-dice "plus Knockdown" /
  // "plus Grotesque Gift" type fragments are ability triggers the GM
  // narrates manually — we don't synthesize a roll for them.
  let extraDamage = null;
  let extraType = null;
  if (trailing) {
    const extraMatch = trailing.match(/plus\s+(\d+d\d+(?:[+-]\d+)?)\s+([a-z]+)/i);
    if (extraMatch) {
      extraDamage = extraMatch[1];
      extraType = extraMatch[2].toLowerCase();
    }
  }

  const rawTraits = attack.traits ?? [];
  const traits = Array.isArray(rawTraits)
    ? rawTraits
    : String(rawTraits).split(',').map(t => t.trim()).filter(Boolean);

  return {
    ...attack,
    kind: attack.kind ?? 'strike',
    name: attack.name,
    bonus,
    damage: mainDamage,
    damageType: mainType,
    traits,
    extraDamage,
    extraType,
    // Carry through some metadata in case display code wants it
    type: attack.type,
    _normalized: true,
  };
}

// ── Bestiary lookup ───────────────────────────────────────────────────────────
const HUNT_CREATURE_SKILLS = {
  aberration: ['Occultism'],
  animal: ['Nature'],
  astral: ['Occultism'],
  beast: ['Arcana', 'Nature'],
  celestial: ['Religion'],
  construct: ['Arcana', 'Crafting'],
  dragon: ['Arcana'],
  elemental: ['Arcana', 'Nature'],
  ethereal: ['Occultism'],
  fey: ['Nature'],
  fiend: ['Religion'],
  fungus: ['Nature'],
  humanoid: ['Society'],
  monitor: ['Religion'],
  ooze: ['Occultism'],
  plant: ['Nature'],
  spirit: ['Occultism'],
  undead: ['Religion'],
};

const HUNT_LEVEL_DCS = {
  '-1': 13, 0: 14, 1: 15, 2: 16, 3: 18, 4: 19, 5: 20, 6: 22, 7: 23, 8: 24, 9: 26,
  10: 27, 11: 28, 12: 30, 13: 31, 14: 32, 15: 34, 16: 35, 17: 36, 18: 38, 19: 39,
  20: 40, 21: 42, 22: 44, 23: 46, 24: 48, 25: 50,
};

const HUNT_DIFFICULTY_BUDGETS = { trivial: 40, low: 60, moderate: 80, severe: 120, extreme: 160 };
const HUNT_XP_BY_RELATIVE_LEVEL = new Map([
  [-4, 10], [-3, 15], [-2, 20], [-1, 30], [0, 40], [1, 60], [2, 80], [3, 120], [4, 160],
]);

function huntDcByLevel(level) {
  const lvl = Math.max(-1, Math.min(25, Number(level) || 0));
  return HUNT_LEVEL_DCS[lvl] ?? HUNT_LEVEL_DCS[String(lvl)] ?? 14;
}

function huntMonsterLevel(monster) {
  return monster?.core?.level ?? monster?.summary?.summary?.level ?? monster?.summary?.level ?? monster?.level ?? null;
}

function huntMonsterTraits(monster) {
  return (monster?.core?.traits ?? monster?.traits ?? []).map(t => String(t).toLowerCase());
}

function huntXpForCreature(partyLevel, creatureLevel) {
  const relative = Math.max(-4, Math.min(4, Number(creatureLevel) - Number(partyLevel)));
  return HUNT_XP_BY_RELATIVE_LEVEL.get(relative) ?? 40;
}

function huntTargetCreatureLevel(partyLevel, players, difficulty) {
  const baseBudget = HUNT_DIFFICULTY_BUDGETS[difficulty] ?? HUNT_DIFFICULTY_BUDGETS.moderate;
  const budget = Math.max(10, Math.round(baseBudget * Math.max(1, players) / 4));
  let bestLevel = Number(partyLevel);
  let bestXp = 0;
  for (let rel = -4; rel <= 4; rel++) {
    const xp = HUNT_XP_BY_RELATIVE_LEVEL.get(rel);
    if (xp <= budget && xp >= bestXp) {
      bestXp = xp;
      bestLevel = Number(partyLevel) + rel;
    }
  }
  return Math.max(-1, Math.min(25, bestLevel));
}

function findHuntCandidates({ trait, partyLevel, players, difficulty }) {
  const targetLevel = huntTargetCreatureLevel(partyLevel, players, difficulty);
  const entries = Object.values(bestiaryDatabase).filter(m => {
    const level = huntMonsterLevel(m);
    if (level == null || Number(level) !== targetLevel) return false;
    return huntMonsterTraits(m).includes(trait);
  });
  if (entries.length) return { candidates: entries, targetLevel };

  const fallback = Object.values(bestiaryDatabase)
    .filter(m => {
      const level = huntMonsterLevel(m);
      return level != null
        && Math.abs(Number(level) - targetLevel) <= 1
        && huntMonsterTraits(m).includes(trait);
    })
    .sort((a, b) => Math.abs(huntMonsterLevel(a) - targetLevel) - Math.abs(huntMonsterLevel(b) - targetLevel));
  return { candidates: fallback, targetLevel };
}

function huntDegree(total, die, dc) {
  let degree = total >= dc + 10 ? 2 : total >= dc ? 1 : total <= dc - 10 ? -1 : 0;
  if (die === 20) degree += 1;
  if (die === 1) degree -= 1;
  return Math.max(-1, Math.min(2, degree));
}

function huntDegreeLabel(degree) {
  return degree === 2 ? 'Critical Success'
    : degree === 1 ? 'Success'
    : degree === 0 ? 'Failure'
    : 'Critical Failure';
}

const HARVEST_RARITY_RANK = { common: 0, uncommon: 1, rare: 2, unique: 3 };

function harvestTraitTable(trait) {
  const tables = harvestRewardsDatabase?.creature_types ?? {};
  const wanted = String(trait ?? '').toLowerCase();
  return Object.entries(tables).find(([key]) => key.toLowerCase() === wanted)?.[1] ?? null;
}

function harvestScaleValue(value, level) {
  const base = Number(value) || 0;
  if (base <= 0) return 0;
  const scale = Math.max(1, (Number(level) || 0) / 5);
  return Math.round(base * scale * 100) / 100;
}

function harvestAllowedRarity(degree) {
  if (degree >= 2) return 2;
  if (degree === 1) return 1;
  if (degree === 0) return 0;
  return -1;
}

function pickHarvestRewards(trait, level, degree) {
  const table = harvestTraitTable(trait);
  if (!table?.harvest_items?.length || degree < 0) {
    return { table, items: [], totalValue: 0 };
  }

  const maxRank = harvestAllowedRarity(degree);
  const pool = table.harvest_items.filter(item => {
    const rank = HARVEST_RARITY_RANK[String(item.rarity ?? 'common').toLowerCase()] ?? 0;
    return rank <= maxRank;
  });
  const fallbackPool = table.harvest_items.filter(item => String(item.rarity ?? 'common').toLowerCase() !== 'unique');
  const source = pool.length ? pool : fallbackPool;
  if (!source.length) return { table, items: [], totalValue: 0 };

  const count = degree >= 2 ? Math.min(2, source.length) : 1;
  const shuffled = [...source].sort(() => Math.random() - 0.5);
  const items = shuffled.slice(0, count).map(item => ({
    ...item,
    scaled_value_gp: harvestScaleValue(item.value_gp, level),
  }));
  const valueMultiplier = degree === 0 ? 0.25 : 1;
  const totalValue = Math.round(items.reduce((sum, item) => sum + item.scaled_value_gp, 0) * valueMultiplier * 100) / 100;
  return { table, items, totalValue };
}

function formatHarvestValue(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} gp`;
}

function buildHuntEmbed({ monster, trait, skill, modifier, roll, total, dc, degree, targetLevel, players, difficulty }) {
  const level = huntMonsterLevel(monster);
  const traits = huntMonsterTraits(monster).map(t => t.charAt(0).toUpperCase() + t.slice(1));
  const xp = huntXpForCreature(targetLevel, level);
  const description = degree >= 1
    ? `The party tracks signs of suitable prey and finds **${monster.name}**. Complete the encounter, then use \`/harvest creature:${monster.name}\`.`
    : `The trail goes cold. The GM can still choose to run a complication, false trail, or different encounter.`;
  return new EmbedBuilder()
    .setColor(degree >= 1 ? 0x2ecc71 : 0x95a5a6)
    .setTitle(`Hunt: ${monster.name}`)
    .setDescription(description)
    .addFields(
      { name: 'Hunt Check', value: `${skill} ${fmt(modifier)}: d20 ${roll.roll} ${fmt(modifier)} = **${total}** vs DC ${dc}\n**${huntDegreeLabel(degree)}**`, inline: false },
      { name: 'Encounter', value: `Party level ${targetLevel}, ${players} player${players === 1 ? '' : 's'}, ${difficulty}\nCreature ${level} (${xp} XP each by PF2e relative-level budget)`, inline: false },
      { name: 'Creature Traits', value: traits.join(', ') || 'None listed', inline: false },
    );
}

function buildHarvestEmbed({ monster, trait, skill, modifier, roll, total, dc, degree }) {
  const level = huntMonsterLevel(monster) ?? 0;
  const rewards = pickHarvestRewards(trait, level, degree);
  const traitName = trait.charAt(0).toUpperCase() + trait.slice(1);
  const reward = degree >= 1
    ? `Recover useful **${traitName}** components worth about **${formatHarvestValue(rewards.totalValue)}**.`
    : degree === 0
      ? `Recover damaged **${traitName}** scraps worth about **${formatHarvestValue(rewards.totalValue)}**.`
      : 'The useful parts are ruined or unsafe to use.';
  const embed = new EmbedBuilder()
    .setColor(degree >= 1 ? 0xf1c40f : 0x7f8c8d)
    .setTitle(`Harvest: ${monster.name}`)
    .setDescription(reward)
    .addFields(
      { name: 'Harvest Check', value: `${skill} ${fmt(modifier)}: d20 ${roll.roll} ${fmt(modifier)} = **${total}** vs DC ${dc}\n**${huntDegreeLabel(degree)}**`, inline: false },
    );
  if (rewards.items.length) {
    embed.addFields({
      name: degree === 0 ? 'Damaged Component' : 'Harvested Components',
      value: rewards.items.map(item => {
        const rarity = String(item.rarity ?? 'common');
        const type = String(item.type ?? 'component').replace(/_/g, ' ');
        return `**${item.name}** (${rarity}, ${type}) - ${formatHarvestValue(item.scaled_value_gp)}\n${item.use ?? 'Useful as a crafting, alchemical, spell, or trophy component.'}`;
      }).join('\n\n').slice(0, 1024),
      inline: false,
    });
    const sources = [...new Set(rewards.items.map(item => item.source).filter(Boolean))];
    if (sources.length) {
      embed.addFields({ name: 'Source Notes', value: sources.join('; ').slice(0, 1024), inline: false });
    }
  } else {
    embed.addFields({
      name: 'Suggested Use',
      value: 'Use as crafting materials, alchemical ingredients, trophies, spell components, or sellable monster parts at GM discretion.',
      inline: false,
    });
  }
  return embed;
}

// Format a single ability score modifier for the embed (e.g. "+3", "-1").
// Icons for PF2e action costs. Falls back to the raw string for unexpected values
// (e.g. "1 varies", "none", campaign-specific costs).
// Format one entry from the attacks array. Strikes look like:
//   ⚔️ dogslicer +8 (agile, backstabber, finesse), 1d6 slashing
// Format one ability from the abilities.top/mid/bot arrays for the embed body.
// Kept compact — full descriptions can run long, so we truncate to 350 chars
// per ability to avoid blowing out the embed's 4096-char description cap.
// Schema-aware monster embed builder. Works with both the new merged bestiary
// shape ({ core, rich, summary }) and the legacy summary-only shape that
// used to live at the top level. Renders the full PF2e stat block when rich
// data is available: ability scores, skills, languages, items, attacks,
// abilities (top/mid/bot), spellcasting, plus the embed-only lore/tactics.
// ── Currency helpers ──────────────────────────────────────────────────────────

// ── Hero Points helpers ───────────────────────────────────────────────────────
// PF2e rules: characters start with 1 HP per session, max 3 at any time.
// Spend 1 to reroll a check (keep higher). Spend all to avoid death.

// Visual representation: filled diamonds for held, hollow for empty (up to display cap).
// If someone has >3 (via /hero set override), we just append "+N" at the end so the embed stays clean.
// ── XP helpers ────────────────────────────────────────────────────────────────
// PF2e: 1000 XP = 1 level. Bot-managed XP is stored on charEntry.xp (overlay-style),
// falling back to Pathbuilder's c.xp if the bot has never touched it. Awards are
// recorded in charEntry.xpLog as a list of { amount, reason, at, awardedBy }.
// XP helpers moved to commands/xp/ in Phase 3.11.

// getCharacterXp moved out of index.js in Phase 3.5 — see rules/lore.js or state/characters.js.

// setCharacterXp moved out of index.js in Phase 3.5 — see rules/lore.js or state/characters.js.

// Award XP. Returns { newXp, leveledUp, oldXp }. leveledUp is true if the award
// pushed the total past a 1000 XP boundary (the PC should level up in Pathbuilder).

// Visual progress bar for XP: filled blocks for earned XP in the current level,
// empty blocks for remaining. Always 10 segments so 100 XP = 1 block.



// Note helpers moved to src/commands/notes/ in Phase 3.6.



// ── Normalize spell ───────────────────────────────────────────────────────────
function formatSpellHeightened(heightened, baseLevel = null) {
  if (!heightened) return '';
  if (typeof heightened === 'string') return heightened.trim();
  if (Array.isArray(heightened)) {
    return heightened.map(entry => formatSpellHeightened(entry, baseLevel)).filter(Boolean).join('\n');
  }
  if (typeof heightened !== 'object') return String(heightened).trim();

  const lines = [];
  const type = String(heightened.type || '').toLowerCase();
  const step = heightened.step ?? heightened.interval ?? null;

  if (heightened.damage_bonus) {
    if (type === 'per_rank') {
      const prefix = step ? `Every +${step} ranks` : `Each rank above ${baseLevel ?? 'base rank'}`;
      lines.push(`${prefix}: +${heightened.damage_bonus} damage`);
    } else {
      lines.push(`+${heightened.damage_bonus} damage`);
    }
  }

  if (heightened.extra_text) {
    const text = String(heightened.extra_text).trim();
    if (text) {
      if (type === 'per_rank' && step && !lines.length) lines.push(`Every +${step} ranks: ${text}`);
      else lines.push(text);
    }
  }

  if (heightened.levels && typeof heightened.levels === 'object') {
    for (const [rank, value] of Object.entries(heightened.levels)) {
      const text = formatSpellHeightened(value, baseLevel);
      if (text) lines.push(`**${rank}:** ${text}`);
    }
  }

  if (heightened.text) lines.push(String(heightened.text).trim());
  if (heightened.note) lines.push(String(heightened.note).trim());

  return lines.filter(Boolean).join('\n').trim();
}

// ── /help system ──────────────────────────────────────────────────────────────
// Commands are grouped into categories. Each entry has:
//   name        - command name shown in the embed
//   summary     - one-line what-it-does
//   options     - short list of key options (not always exhaustive)
//   example     - the most common usage
// Categories are rendered one at a time via button navigation.

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  // Phase 2: subscribe state modules to Supabase Realtime BEFORE restore.
  // Subscribe-then-restore ordering guarantees no gap where a web write
  // could land undetected between restore's snapshot and the subscription
  // going live. Events received during restore are queued inside each
  // module and drained at the end of its restore().
  const sb = getSupabase();
  if (sb) {
    notes.subscribe(sb);
    downtimeState.subscribe(sb);
    snippetState.subscribe(sb);
    monsterState.subscribe(sb);
    bagState.subscribe(sb);
    characterState.subscribe(sb);
    guildStateModule.subscribe(sb);
    // Companions don't own their own cache — they patch the shared
    // characters cache (owned by state/characters as of Phase 2) in place.
    companionState.subscribe(sb, () => characterState.getAll());
  }

  const restored = await restoreAllFromSupabase();
  // Seed legacy caches directly from Supabase data (no JSON file reads).
  // notes / downtime / snippets / monster / bags / characters / companions
  // are omitted — their state modules already populated their own caches
  // inside restoreAllFromSupabase via *.restore().
  await encounters.restoreEncountersFromSupabase?.();
  await combatV2State.restoreEncountersFromSupabase?.();
  // Guild state: seed the JSON cache so loadJson/mutateJson for these files
  // use in-memory state instead of reading from disk.
  seedJsonCache('calendar-state.json', restored?.calendarState ?? {});
  seedJsonCache('weather-state.json',  restored?.weatherState  ?? {});
  seedJsonCache('bot-settings.json',   restored?.botSettings   ?? {});
  // Load reference databases (bestiary/spells/items/gamedata) from Supabase
  // directly into memory. Throws if Supabase is unreachable or table is empty.
  const spellEffectsData = {};
  const calendarData = {};  // populated with { golarion: {...}, eberron: {...} }
  const weatherData = {};   // populated with { golarion: {...}, eberron: {...} }
  await loadReferenceDatabasesFromSupabase({
    bestiaryDatabase,
    spellDatabase,
    itemDatabase,
    backgroundDatabase,
    rulesDatabase,
    heritageDatabase,
    heritagesByAncestry,
    deityDatabase,
    eberronDeityDatabase,
    eberronHouseDatabase,
    skillDatabase,
    classDatabase,
    companionDatabase,
    referenceDatabases,
    ancestryDatabase,
    archetypeDatabase,
    featDatabase,
    harvestRewardsDatabase,
    spellEffectsData,
    calendarData,
    weatherData,
  });
  // Inject rules data into system modules now that Supabase has loaded them.
  // Node's require cache means these return the same module objects as the top-
  // level requires — no double-loading. The setRules() calls repopulate the
  // module-level RULES variable and recompute any derived constants.
  if (spellEffectsData && Object.keys(spellEffectsData).length) {
    spellEffects.setRules(spellEffectsData);
  }
  if (calendarData?.golarion) require('./rules/calendar').setRules(calendarData.golarion);
  if (calendarData?.eberron)  require('./rules/eberronCalendar').setRules(calendarData.eberron);
  if (weatherData?.golarion)  weatherEngine.setRules(weatherData.golarion);
  if (weatherData?.eberron)   require('./rules/eberronWeather').setRules(weatherData.eberron);
  calendarCmd.startCalendarAutotick(client, weatherEngine);
  startDowntimeAutoAccrual();
  // Subscribe to live homebrew changes so entries added/removed via the
  // web UI take effect immediately without a bot restart.
  setupHomebrewRealtimeSync({ bestiaryDatabase, spellDatabase, itemDatabase });
});

// ── Interaction handler ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  // Cache the Discord username so character writes can auto-create users
  // rows for bot-only users who haven't logged into the web app. The cache
  // itself lives in state/characters now (Phase 3.7).
  if (interaction.user) characterState.rememberUsername(interaction.user.id, interaction.user.username);

  if (interaction.isButton()) {
    // ─── Initiative pagination buttons ──────────────────────────────
    // customId shape: init_page_<channelId>_<targetPage>
    // Anyone can click; the new page renders as an EPHEMERAL reply visible
    // ONLY to the clicker (per Viv's design: "their click is private").
    // The pinned summary message itself doesn't change — the cursor still
    // follows the current turn for everyone else.
    //
    // First click on the public summary → reply with a fresh ephemeral.
    // Subsequent clicks on that same ephemeral → update it in place so the
    // user doesn't end up with a stack of ephemeral messages while paging.
    if (interaction.customId.startsWith('init_page_')) {
      const tail = interaction.customId.slice('init_page_'.length);
      const lastUnderscore = tail.lastIndexOf('_');
      if (lastUnderscore < 0) {
        return interaction.reply({ content: '❌ Malformed pagination button.', ephemeral: true });
      }
      const channelId = tail.slice(0, lastUnderscore);
      const targetPage = parseInt(tail.slice(lastUnderscore + 1), 10);
      const enc = getEncounter(channelId);
      if (!enc) {
        // Edge case: encounter ended while user was viewing buttons.
        // If we're on the public summary message, reply ephemerally;
        // if we're on a prior ephemeral, just update with the bad-news.
        if (interaction.message.flags?.has('Ephemeral')) {
          return interaction.update({ content: '❌ The encounter has ended.', embeds: [], components: [] });
        }
        return interaction.reply({ content: '❌ The encounter has ended.', ephemeral: true });
      }
      const { embed, page, totalPages } = buildInitiativeEmbed(enc, { pageOverride: targetPage });
      const buttons = buildInitiativeButtons(channelId, page, totalPages);
      const components = buttons ? [buttons] : [];
      // Detect ephemeral vs public by checking the source message's flags.
      // Discord exposes a 64 flag (Ephemeral) on ephemeral messages.
      const isOnEphemeral = !!(interaction.message.flags?.has?.('Ephemeral')
        || (typeof interaction.message.flags === 'object' && interaction.message.flags?.bitfield & 64));
      if (isOnEphemeral) {
        return interaction.update({ embeds: [embed], components });
      }
      return interaction.reply({ embeds: [embed], components, ephemeral: true });
    }

    // ─── Monster-attack save roll button ────────────────────────────
    if (interaction.customId.startsWith('cv2_page_')) {
      const tail = interaction.customId.slice('cv2_page_'.length);
      const lastUnderscore = tail.lastIndexOf('_');
      if (lastUnderscore < 0) {
        return interaction.reply({ content: 'Malformed combat page button.', ephemeral: true });
      }
      const channelId = tail.slice(0, lastUnderscore);
      const targetPage = parseInt(tail.slice(lastUnderscore + 1), 10);
      const enc = combatV2State.getEncounter(channelId);
      if (!enc) {
        if (interaction.message.flags?.has('Ephemeral')) {
          return interaction.update({ content: 'The combat has ended.', embeds: [], components: [] });
        }
        return interaction.reply({ content: 'The combat has ended.', ephemeral: true });
      }
      const gmView = interaction.user.id === enc.gmId;
      const { embed, page, totalPages } = combatV2Render.renderEncounter(enc, { page: targetPage, gmView });
      const components = combatV2Render.pageButtons(channelId, page, totalPages);
      const isOnEphemeral = !!(interaction.message.flags?.has?.('Ephemeral')
        || (typeof interaction.message.flags === 'object' && interaction.message.flags?.bitfield & 64));
      if (isOnEphemeral) return interaction.update({ embeds: [embed], components });
      return interaction.reply({ embeds: [embed], components, ephemeral: true });
    }

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
    if (helpCmd.prefixes.some(p => interaction.customId.startsWith(p))) {
      return helpCmd.handle(interaction);
    }


    // ─── Rest confirmation buttons (Phase 3.12 — delegated) ─────────
    if (restButtonsCmd.prefixes.some(p => interaction.customId.startsWith(p))) {
      return restButtonsCmd.handle(interaction);
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

    // ─── Hero Point: Spend ALL to escape death ──────────────────────────────
    // PF2e Player Core p. 411: "If you have at least 1 Hero Point, you can spend
    // all of your remaining Hero Points at the start of your turn or when your
    // dying value would increase. You lose the dying condition entirely and
    // stabilize with 0 Hit Points. You don't gain the wounded condition."
    if (interaction.customId.startsWith('rcheck_stabilize_')) {
      const safeName = interaction.customId.slice('rcheck_stabilize_'.length);
      const channelId = interaction.channel.id;
      const enc = getEncounter(channelId);
      if (!enc) return interaction.update({ content: '❌ The encounter has ended.', components: [] });
      const combatant = enc.combatants.find(c => c.name.replace(/[^a-zA-Z0-9]/g, '_') === safeName);
      if (!combatant) return interaction.update({ content: '❌ Combatant not found.', components: [] });

      // Only the combatant's owner can spend their hero points
      if (combatant.isNpc || interaction.user.id !== combatant.ownerId) {
        return interaction.reply({ content: '❌ Only the combatant\'s owner can spend Hero Points.', ephemeral: true });
      }

      // Look up character + hero points; require at least 1
      const characters = loadCharacters();
      const charKey = combatant.name.toLowerCase().replace(/\s+/g, '-');
      const charEntry = characters[combatant.ownerId]?.[charKey];
      if (!charEntry) return interaction.reply({ content: '❌ Character not found.', ephemeral: true });
      const currentHp = charEntry.heroPoints ?? 1;
      if (currentHp <= 0) return interaction.reply({ content: '❌ No Hero Points to spend.', ephemeral: true });

      // Burn ALL hero points and stabilize
      const spent = currentHp;
      charEntry.heroPoints = 0;
      saveCharacters(characters);

      const stab = ca.stabilizeWithHeroPoints(channelId, combatant.name);
      if (!stab || !stab.ok) {
        // Refund (shouldn't happen — guard rail)
        charEntry.heroPoints = currentHp;
        saveCharacters(characters);
        return interaction.reply({ content: `❌ Could not stabilize **${combatant.name}**: not currently dying.`, ephemeral: true });
      }

      const newEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`🛡️ ${combatant.name} Cheats Death`)
        .setDescription(
          `${stab.narration}\n\n` +
          `*Spent ${spent} Hero Point${spent === 1 ? '' : 's'}. Hero Points: 0/3.*`
        );
      await interaction.update({ embeds: [newEmbed], components: [] });
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ─── Skill info page navigation ─────────────────────────────────
    if (skillinfoButtons.prefixes.some(p => interaction.customId.startsWith(p))) {
      return skillinfoButtons.handle(interaction);
    }

    // Class page navigation: class_<key>_<pageIndex>
    if (classButtons.prefixes.some(p => interaction.customId.startsWith(p))) {
      return classButtons.handle(interaction);
    }

    if (ancestryButtons.prefixes.some(p => interaction.customId.startsWith(p))) {
      return ancestryButtons.handle(interaction);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) {
    // ─── Modal submissions ───────────────────────────────────────────
    // Only /char edit uses modals now (the old /char paste modal was removed).
    // customId format: "char_edit_modal:<charKey>" so we know which character
    // the user was editing at the time the modal opened.
    if (interaction.isModalSubmit?.()) {
      try {
        if (interaction.customId === 'char_create_modal') {
          await interaction.deferReply({ ephemeral: true });
          const name = interaction.fields.getTextInputValue('name').trim();
          const className = interaction.fields.getTextInputValue('class').trim();
          const ancestry = interaction.fields.getTextInputValue('ancestry').trim();
          const heritage = interaction.fields.getTextInputValue('heritage').trim();
          const levelRaw = interaction.fields.getTextInputValue('level').trim() || '1';

          if (!name) return interaction.editReply('❌ Character name is required.');
          const level = Number.parseInt(levelRaw, 10);
          if (!Number.isFinite(level) || level < 1 || level > 20) {
            return interaction.editReply(`❌ Level must be a whole number from 1 to 20. Got "${levelRaw}".`);
          }

          const char = createBlankCharacterData({ name, className, ancestry, heritage, level });
          const saved = await saveCreatedCharacter(interaction.user.id, char);
          if (saved.error) return interaction.editReply(`❌ ${saved.error}`);
          return interaction.editReply(
            `✅ **${saved.name}** created as a blank level ${saved.level} character.\n` +
            `Use \`/sheet name:${saved.name}\` to view it, then fill in details with \`/char ability\`, \`/char stat\`, \`/char skill\`, \`/char weapon\`, \`/char item\`, and \`/char edit\`.`
          );
        }

        if (descriptionCmd.prefixes.some(prefix => interaction.customId.startsWith(prefix))) {
          return descriptionCmd.handleModal(interaction);
        }

        if (interaction.customId.startsWith('char_edit_modal:')) {
          await interaction.deferReply({ ephemeral: true });
          const charKey = interaction.customId.slice('char_edit_modal:'.length);

          const characters = loadCharacters();
          const userChars = characters[interaction.user.id] ?? {};
          const charEntry = userChars[charKey];
          if (!charEntry) {
            return interaction.editReply('❌ Character not found. Did you delete them while the popup was open?');
          }

          const background = interaction.fields.getTextInputValue('background').trim();
          const deity      = interaction.fields.getTextInputValue('deity').trim();
          const langRaw    = interaction.fields.getTextInputValue('languages').trim();
          const sensesRaw  = interaction.fields.getTextInputValue('senses').trim();

          if (!charEntry.edits) charEntry.edits = {};
          // Only set overrides when the user actually typed something; empty
          // strings clear the override so the original JSON value shows again.
          if (background) charEntry.edits.background = background;
          else delete charEntry.edits.background;
          if (deity) charEntry.edits.deity = deity;
          else delete charEntry.edits.deity;
          if (langRaw) charEntry.edits.languages = langRaw.split(/,\s*/).map(s => s.trim()).filter(Boolean);
          else delete charEntry.edits.languages;
          if (sensesRaw) charEntry.edits.senses = sensesRaw.split(/,\s*/).map(s => s.trim()).filter(Boolean);
          else delete charEntry.edits.senses;

          await saveCharacters(characters);
          return interaction.editReply(`✅ Updated **${charEntry.name}**. Use \`/sheet\` to see the changes.`);
        }

        // /char identity modal: class, subclass, level, ancestry, heritage
        else if (interaction.customId.startsWith('char_identity_modal:')) {
          await interaction.deferReply({ ephemeral: true });
          const charKey = interaction.customId.slice('char_identity_modal:'.length);
          const characters = loadCharacters();
          const charEntry = (characters[interaction.user.id] ?? {})[charKey];
          if (!charEntry) return interaction.editReply('❌ Character not found.');

          if (!charEntry.edits) charEntry.edits = {};
          if (!charEntry.edits.identity) charEntry.edits.identity = {};
          const id = charEntry.edits.identity;

          const setOrClear = (fieldId, target) => {
            const raw = interaction.fields.getTextInputValue(fieldId).trim();
            if (raw) id[target] = raw;
            else delete id[target];
          };
          setOrClear('class', 'class');
          setOrClear('subclass', 'subclass');
          setOrClear('ancestry', 'ancestry');
          setOrClear('heritage', 'heritage');
          // Level is an integer
          const lvlRaw = interaction.fields.getTextInputValue('level').trim();
          if (lvlRaw) {
            const n = parseInt(lvlRaw, 10);
            if (Number.isFinite(n) && n >= 1 && n <= 20) id.level = n;
            else return interaction.editReply(`❌ Level must be a whole number 1-20. Got "${lvlRaw}".`);
          } else {
            delete id.level;
          }

          await saveCharacters(characters);
          return interaction.editReply(`✅ Updated identity for **${charEntry.name}**. Use \`/sheet\` to see it.`);
        }

        // /char misc modal: gender, age, size, alignment, keyability
        else if (interaction.customId.startsWith('char_misc_modal:')) {
          await interaction.deferReply({ ephemeral: true });
          const charKey = interaction.customId.slice('char_misc_modal:'.length);
          const characters = loadCharacters();
          const charEntry = (characters[interaction.user.id] ?? {})[charKey];
          if (!charEntry) return interaction.editReply('❌ Character not found.');

          if (!charEntry.edits) charEntry.edits = {};
          if (!charEntry.edits.misc) charEntry.edits.misc = {};
          const m = charEntry.edits.misc;

          const setOrClear = (fieldId, target) => {
            const raw = interaction.fields.getTextInputValue(fieldId).trim();
            if (raw) m[target] = raw;
            else delete m[target];
          };
          setOrClear('gender', 'gender');
          setOrClear('age', 'age');
          setOrClear('alignment', 'alignment');
          setOrClear('keyability', 'keyability');
          // Size: accept number or friendly name
          const sizeRaw = interaction.fields.getTextInputValue('size').trim().toLowerCase();
          if (sizeRaw) {
            const sizeMap = { tiny: -2, small: -1, medium: 0, large: 1, huge: 2, gargantuan: 3 };
            if (sizeRaw in sizeMap) {
              m.size = sizeMap[sizeRaw];
            } else {
              const n = parseInt(sizeRaw, 10);
              if (Number.isFinite(n) && n >= -2 && n <= 3) m.size = n;
              else return interaction.editReply(`❌ Size must be a number (-2 to 3) or a name (Tiny/Small/Medium/Large/Huge/Gargantuan). Got "${sizeRaw}".`);
            }
          } else {
            delete m.size;
          }

          await saveCharacters(characters);
          return interaction.editReply(`✅ Updated misc details for **${charEntry.name}**. Use \`/sheet\` to see it.`);
        }
      } catch (err) {
        console.error('Modal submit error:', err);
        try { await interaction.editReply('❌ Something went wrong saving your edits. Try again.'); } catch {}
      }
      return;
    }

    // ─── Autocomplete ────────────────────────────────────────────────
    if (interaction.isAutocomplete()) {
      try {
        // ─── /weather autocomplete ───
        // Delegate /weather autocomplete to weather-cmd.js. It has its own
        // custom logic (climates, seasons, precipitation/wind/fog values
        // depending on which 'component' the user picked) and doesn't fit the
        // pick() helper pattern used below.
        if (interaction.commandName === 'weather') {
          return await weatherCmd.handleWeatherAutocomplete(interaction);
        }
        // ─── /calendar autocomplete ───
        // Calendar autocomplete (just month names mapped to 1-12 integers).
        if (interaction.commandName === 'calendar') {
          return await calendarCmd.handleCalendarAutocomplete(interaction);
        }

        const focused = interaction.options.getFocused(true); // { name, value }
        const q = String(focused.value ?? '').toLowerCase().trim();
        // /m subcommand groups are aliased back to the legacy commandName so
        // the existing autocomplete branches below work unchanged. Mirrors
        // the same rewrite in the main handler dispatcher above.
        let cmd = interaction.commandName;
        if (cmd === 'm') {
          const group = interaction.options.getSubcommandGroup(false);
          if (group === 'roll')        cmd = 'monsterroll';
          else if (group === 'attack') cmd = 'monsterattack';
          else if (group === 'edit')   cmd = 'monsteredit';
          else if (group === 'add')    cmd = 'monsteradd';
          else {
            const sub = interaction.options.getSubcommand(false);
            if (sub === 'show') cmd = 'monster';
            else if (sub === 'save' || sub === 'skill') cmd = 'monsterroll';
            else if (sub === 'cast') cmd = 'monstercast';
            else if (sub === 'ability') cmd = 'monsterability';
            else if (sub === 'attacks') cmd = 'monsterattacks';
          }
        }

        // Score & slice helper: exact > prefix > substring > fuzzy.
        // Powered by utils/fuzzyMatch — typos like "grabed" still surface
        // "Grabbed", and `pick()` keeps the same input/output as before so
        // every autocomplete branch below benefits without further changes.
        const pick = (names) => fuzzyPick(q, names);

        let suggestions = [];

        if (cmd === 'i') {
          const sub = interaction.options.getSubcommand(false);
          const v2 = combatV2State.getEncounter(interaction.channel.id);
          const actorName = interaction.options.getString('actor') ?? null;
          const actor = v2 ? combatV2PickActor(v2, interaction.user.id, actorName) : null;
          if (focused.name === 'target' || focused.name === 'actor') {
            suggestions = pick((v2?.combatants ?? []).map(c => c.name));
          } else if (focused.name === 'name' && sub === 'attack') {
            const names = new Set((actor?.attacks ?? []).map(a => a?.name).filter(Boolean));
            try {
              const characters = loadCharacters();
              let charEntry = null;
              if (actor) {
                const match = findCharacterEntryForCombatant(characters, actor);
                if (match?.char && !match.companion) charEntry = match.char;
              } else {
                const resolved = resolveChar(interaction.user.id, null, characters);
                if (!resolved?.error) charEntry = resolved.char;
              }
              if (charEntry) {
                for (const attack of combatV2CharacterAttacks(charEntry)) {
                  if (attack?.name) names.add(attack.name);
                }
              }
            } catch {}
            suggestions = pick([...names]);
          } else if (focused.name === 'name' && sub === 'skill') {
            const names = new Set(Object.values(COMBAT_V2_SKILL_LABELS));
            for (const [key, raw] of Object.entries(actor?.skills ?? {})) names.add(raw?.label ?? key);
            suggestions = pick([...names]);
          } else if (focused.name === 'spell' && sub === 'cast') {
            suggestions = pick(spellDatabase.map(s => s.name).filter(Boolean));
          } else if (focused.name === 'caster' && sub === 'cast') {
            try {
              const characters = loadCharacters();
              const { char: charEntry } = resolveChar(interaction.user.id, null, characters) || {};
              suggestions = pick(charEntry ? charOverlay.getCasters(charEntry.data).map(c => c.name) : []);
            } catch { suggestions = []; }
          } else if (focused.name === 'character' && sub === 'join') {
            const characters = loadCharacters();
            suggestions = pick(Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name));
          }
        }
        else if (REFERENCE_DATABASE_CONFIG[cmd] && focused.name === 'name') {
          suggestions = pick([...new Set((referenceDatabases[cmd] ?? []).map(e => e.name).filter(Boolean))]);
        }
        else if (cmd === 'item' && focused.name === 'name') {
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
        else if (cmd === 'condition' && focused.name === 'name') {
          // Scope autocomplete to the Conditions category only — typing in
          // /condition shouldn't surface every chapter heading from rules.json.
          const names = Object.values(rulesDatabase.Conditions ?? {})
            .map(r => r?.name)
            .filter(Boolean);
          suggestions = pick(names);
        }
        else if (cmd === 'ancestry' && focused.name === 'name') {
          suggestions = pick(Object.values(ancestryDatabase).map(a => a?.name).filter(Boolean));
        }
        else if (cmd === 'heritage' && focused.name === 'name') {
          // 322 heritages (305 ancestry-specific + 17 versatile). Surface
          // names; fuzzyPick handles partials, prefixes, and typo tolerance.
          suggestions = pick(Object.values(heritageDatabase).map(h => h?.name).filter(Boolean));
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
        else if (cmd === 'harvest' && focused.name === 'creature') {
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
        else if (cmd === 'mattack') {
          const v2 = combatV2State.getEncounter(interaction.channel.id);
          if (focused.name === 'attacker' || focused.name === 'target') {
            const names = new Set((v2?.combatants ?? []).map(c => c.name));
            if (focused.name === 'attacker') {
              for (const monster of Object.values(bestiaryDatabase)) {
                if (monster?.name) names.add(monster.name);
              }
            } else {
              const characters = loadCharacters();
              for (const entry of Object.values(characters[interaction.user.id] ?? {})) {
                const name = entry?.data?.name ?? entry?.name;
                if (name) names.add(name);
              }
            }
            suggestions = pick([...names]);
          } else if (focused.name === 'name') {
            const attackerName = interaction.options.getString('attacker');
            const attacker = v2 ? combatV2State.findCombatant(v2, attackerName) : null;
            const names = new Set((attacker?.attacks ?? []).map(a => a.name).filter(Boolean));
            if (attackerName) {
              const displayName = attacker?.bestiaryKey ?? resolveMonsterDisplayName(attackerName);
              const { monster } = findMonster(displayName);
              if (monster) {
                const edits = getMonsterEdit(interaction.guildId, monster.name);
                const edited = applyMonsterEdits(monster, edits);
                const withLibrary = applyMonsterAttackLibrary(edited, interaction.guildId);
                const rawAttacks = Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
                for (const attack of rawAttacks) {
                  const normalized = normalizeAttackForRolling(attack);
                  if (normalized?.name) names.add(normalized.name);
                }
              }
              const store = loadMonsterAttacks();
              const guild = interaction.guildId ? getGuildMonsters(store, interaction.guildId) : {};
              const libEntry = guild[monsterKey(displayName)] ?? guild[monsterKey(attackerName)];
              for (const attack of (libEntry?.attacks ?? [])) {
                if (attack?.name) names.add(attack.name);
              }
            }
            suggestions = pick([...names]);
          }
        }
        else if (cmd === 'monsterroll') {
          const v2 = combatV2State.getEncounter(interaction.channel.id);
          if (focused.name === 'monster') {
            suggestions = pick([
              ...(v2?.combatants ?? []).filter(c => c.isNpc).map(c => c.name),
              ...Object.values(bestiaryDatabase).map(m => m?.name).filter(Boolean),
            ]);
          } else if (focused.name === 'skill') {
            const monsterName = interaction.options.getString('monster');
            const actor = v2 ? combatV2State.findCombatant(v2, monsterName) : null;
            const names = new Set(['Perception', 'Initiative', ...Object.values(COMBAT_V2_SKILL_LABELS)]);
            for (const [key, raw] of Object.entries(actor?.skills ?? {})) names.add(raw?.label ?? key);
            suggestions = pick([...names]);
          }
        }
        else if (cmd === 'monstercast') {
          const v2 = combatV2State.getEncounter(interaction.channel.id);
          if (focused.name === 'monster' || focused.name === 'target') {
            suggestions = pick((v2?.combatants ?? []).map(c => c.name));
          } else if (focused.name === 'spell') {
            const monsterName = interaction.options.getString('monster');
            const actor = v2 ? combatV2State.findCombatant(v2, monsterName) : null;
            suggestions = pick([
              ...(actor?.spells ?? []).map(s => s.name).filter(Boolean),
              ...spellDatabase.map(s => s.name).filter(Boolean),
            ]);
          }
        }
        else if (cmd === 'monsterattacks') {
          const v2 = combatV2State.getEncounter(interaction.channel.id);
          if (focused.name === 'monster') {
            suggestions = pick((v2?.combatants ?? []).map(c => c.name));
          }
        }
        else if (cmd === 'monsterability') {
          const v2 = combatV2State.getEncounter(interaction.channel.id);
          if (focused.name === 'monster' || focused.name === 'target') {
            suggestions = pick((v2?.combatants ?? []).map(c => c.name));
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
        else if (cmd === 'sheet' && focused.name === 'name') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {})
            .filter(v => v && v.name)
            .map(e => e.name);
          suggestions = pick(own);
        }
        else if (cmd === 'xp' && focused.name === 'character') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
          suggestions = pick(own);
        }
        else if ((cmd === 'hp' || cmd === 'perception' || cmd === 'initiative' || cmd === 'portrait' || cmd === 'feats' || cmd === 'abilities' || cmd === 'description') && focused.name === 'character') {
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
        else if ((cmd === 'cvar' || cmd === 'cc' || cmd === 'counters') && focused.name === 'character') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
          suggestions = pick(own);
        }
        else if (cmd === 'cvar' && focused.name === 'name') {
          // Suggest cvar names on the active (or specified) character.
          const characters = loadCharacters();
          const charNameArg = interaction.options.getString('character');
          const resolved = resolveChar(interaction.user.id, charNameArg, characters);
          if (!resolved.error) {
            charOverlay.ensureOverlay(resolved.char);
            const names = Object.keys(resolved.char.overlay.cvars ?? {});
            suggestions = pick(names);
          }
        }
        else if (cmd === 'cc' && focused.name === 'name') {
          const characters = loadCharacters();
          const charNameArg = interaction.options.getString('character');
          const resolved = resolveChar(interaction.user.id, charNameArg, characters);
          if (!resolved.error) {
            charOverlay.ensureOverlay(resolved.char);
            const names = Object.keys(resolved.char.overlay.counters ?? {});
            // 'reset' subcommand also accepts "all"
            const sub = interaction.options.getSubcommand(false);
            if (sub === 'reset') suggestions = pick(['all', ...names]);
            else suggestions = pick(names);
          }
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
                const notesData = notes.getAll();
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
          // For /init attack, "monster" refers to a combatant in the encounter
          // (an NPC/monster who's about to swing). For /init addmonster (and
          // anywhere else), it means a creature in the bestiary to add.
          const subForMonster = interaction.options.getSubcommand(false);
          if (subForMonster === 'attack') {
            const enc = getEncounter(interaction.channel.id);
            if (enc) {
              // Only NPC combatants — players use /attack themselves
              suggestions = pick(enc.combatants.filter(c => c.isNpc).map(c => c.name));
            }
          } else {
            suggestions = pick(Object.values(bestiaryDatabase).map(m => m?.name).filter(Boolean));
          }
        }
        else if (cmd === 'init' && focused.name === 'attack'
                 && interaction.options.getSubcommand(false) === 'attack') {
          // Autocomplete the attacker's actual attacks. We need to know which
          // combatant the GM picked first — read the 'monster' option.
          const monsterArg = interaction.options.getString('monster');
          const enc = getEncounter(interaction.channel.id);
          if (enc && monsterArg) {
            const attacker = enc.combatants.find(c => c.name.toLowerCase() === monsterArg.toLowerCase());
            if (attacker?.isNpc && attacker?.bestiaryKey) {
              const atks = getCombatantAttacks(attacker, interaction.guildId);
              suggestions = pick(atks.map(a => a.name).filter(Boolean));
            }
          }
        }
        else if (cmd === 'init' && focused.name === 'name'
                 && (interaction.options.getSubcommand(false) === 'effect'
                  || interaction.options.getSubcommand(false) === 'removeeffect')) {
          // Autocomplete preset condition names for /init effect name:
          // For removeeffect, autocomplete from the target's actual effects
          // (preset names + custom names they actually have).
          const sub = interaction.options.getSubcommand(false);
          if (sub === 'effect') {
            // Suggest preset names — Frightened, Stupefied, etc.
            const names = listPresets().map(p => p.name);
            suggestions = pick(names);
          } else {
            // removeeffect: pull effects from the named target
            const targetName = interaction.options.getString('target');
            const v2 = combatV2State.getEncounter(interaction.channel.id);
            const enc = v2 ?? getEncounter(interaction.channel.id);
            if (enc && targetName) {
              const target = v2 ? combatV2State.findCombatant(v2, targetName) : findCombatant(enc, targetName);
              if (target?.effects) {
                suggestions = pick(target.effects.map(e => e.name));
              }
            }
            // Fallback: preset names
            if (!suggestions || suggestions.length === 0) {
              suggestions = pick(listPresets().map(p => p.name));
            }
          }
        }
        else if (cmd === 'init' && focused.name === 'target') {
          // Autocomplete combatants currently in this channel's encounter
          const enc = combatV2State.getEncounter(interaction.channel.id) ?? getEncounter(interaction.channel.id);
          if (enc) suggestions = pick(enc.combatants.map(c => c.name));
        }
        else if (cmd === 'init' && focused.name === 'name'
                 && ['hp', 'thp', 'remove', 'modify', 'reaction', 'damage', 'dying', 'recovery', 'move'].includes(interaction.options.getSubcommand(false))) {
          // Autocomplete combatants for any subcommand that takes a 'name' parameter
          // referring to a combatant in the encounter.
          const enc = combatV2State.getEncounter(interaction.channel.id) ?? getEncounter(interaction.channel.id);
          if (enc) suggestions = pick(enc.combatants.map(c => c.name));
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
          suggestions = deityAutocompleteChoices(focused.value);
        }
        else if (cmd === 'eberron' && focused.name === 'name') {
          const sub = interaction.options.getSubcommand(false);
          suggestions = sub === 'deity'
            ? eberronDeityAutocompleteChoices(focused.value)
            : eberronHouseAutocompleteChoices(focused.value);
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
        else if (cmd === 'char' && interaction.options.getSubcommand(false) === 'skill') {
          if (focused.name === 'character') {
            const characters = loadCharacters();
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          } else if (focused.name === 'name') {
            // Autocomplete skill name from PF2e's standard 16 skills
            const pfSkills = [
              'Acrobatics','Arcana','Athletics','Crafting','Deception','Diplomacy',
              'Intimidation','Medicine','Nature','Occultism','Performance','Religion',
              'Society','Stealth','Survival','Thievery',
            ];
            suggestions = pick(pfSkills);
          }
        }
        else if (cmd === 'char' && interaction.options.getSubcommand(false) === 'edit' && focused.name === 'character') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
          suggestions = pick(own);
        }
        else if (cmd === 'char' && interaction.options.getSubcommand(false) === 'lore' && focused.name === 'character') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
          suggestions = pick(own);
        }
        else if (cmd === 'char' && interaction.options.getSubcommand(false) === 'dump' && focused.name === 'character') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
          suggestions = pick(own);
        }
        else if (cmd === 'char' && interaction.options.getSubcommand(false) === 'stat' && focused.name === 'character') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
          suggestions = pick(own);
        }
        else if (cmd === 'char' && ['identity', 'misc', 'ability', 'money', 'item', 'spellcasting'].includes(interaction.options.getSubcommand(false)) && focused.name === 'character') {
          const characters = loadCharacters();
          const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
          suggestions = pick(own);
        }
        else if (cmd === 'char' && interaction.options.getSubcommand(false) === 'item' && focused.name === 'name') {
          // For edit/remove actions: autocomplete from existing items
          const characters = loadCharacters();
          const { char: ce } = resolveChar(interaction.user.id, null, characters) || {};
          if (ce) {
            const c = ce.data ?? {};
            const jsonItems = (c.equipment ?? []).map(e => Array.isArray(e) ? e[0] : e).filter(Boolean);
            const editItems = (ce.edits?.items ?? []).map(e => Array.isArray(e) ? e[0] : e).filter(Boolean);
            suggestions = pick([...new Set([...jsonItems, ...editItems])]);
          }
        }
        else if (cmd === 'char' && ['weapon', 'attack'].includes(interaction.options.getSubcommand(false))) {
          if (focused.name === 'character') {
            const characters = loadCharacters();
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          } else if (focused.name === 'name') {
            // Autocomplete from existing weapons on the selected/active character.
            const characters = loadCharacters();
            const charArg = interaction.options.getString('character');
            const { char: ce } = resolveChar(interaction.user.id, charArg, characters) || {};
            if (ce) {
              suggestions = pick([...new Set(getCharacterWeapons(ce).map(w => w.display ?? w.name).filter(Boolean))]);
            }
          }
        }
        else if (cmd === 'char' && interaction.options.getSubcommand(false) === 'skill') {
          if (focused.name === 'character') {
            const characters = loadCharacters();
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          } else if (focused.name === 'name') {
            suggestions = pick(Object.values(COMBAT_V2_SKILL_LABELS));
          }
        }
        else if (cmd === 'char' && interaction.options.getSubcommand(false) === 'feat') {
          if (focused.name === 'character') {
            const characters = loadCharacters();
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          } else if (focused.name === 'name') {
            // Add uses the full feat database; remove uses feats already on the active character.
            const action = interaction.options.getString('action');
            const q = String(focused.value ?? '').toLowerCase();
            if (action === 'remove') {
              const characters = loadCharacters();
              const charArg = interaction.options.getString('character');
              const { char: ce } = resolveChar(interaction.user.id, charArg, characters) || {};
              const ownFeats = (ce?.data?.feats ?? []).map(f => normalizeCharacterFeat(f).name).filter(Boolean);
              suggestions = pick([...new Set(ownFeats)]);
            } else if (q.length >= 2 && typeof featDatabase !== 'undefined') {
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
        else if (cmd === 'downtime' && focused.name === 'activity'
                 && interaction.options.getSubcommand(false) === 'start') {
          // For /downtime start, autocomplete the activity TYPE (earn-income, etc.)
          const names = Object.entries(downtime.ACTIVITIES).map(([k, def]) => def.name);
          suggestions = pick(names).map(o => ({
            // Map display name back to the key the handler expects
            name: o.name,
            value: Object.keys(downtime.ACTIVITIES).find(
              k => downtime.ACTIVITIES[k].name === o.name
            ) || o.value,
          }));
        }
        else if (cmd === 'downtime' && focused.name === 'activity') {
          // For /downtime complete/cancel/spend, autocomplete with the player's
          // active entry IDs paired with a friendly description.
          const characters = loadCharacters();
          const { charKey } = resolveChar(interaction.user.id, null, characters);
          if (charKey) {
            const store = loadDowntime();
            const active = downtime.listActiveEntries(store, interaction.user.id, charKey);
            // Show "earn-income (crafting) day 3/7 [abc123]" style entries
            suggestions = active
              .map(e => {
                const def = downtime.ACTIVITIES[e.activity];
                const skill = e.params?.skill ? ` (${e.params.skill})` : '';
                const ready = e.status === 'ready-to-complete' ? ' ✅' : '';
                return {
                  name: `${def.name}${skill} day ${e.elapsedDays}/${e.plannedDays}${ready} [${e.id}]`.slice(0, 100),
                  value: e.id,
                };
              })
              .slice(0, 25);
          }
        }
        else if (cmd === 'downtime' && focused.name === 'skill') {
          const skills = ['Acrobatics', 'Arcana', 'Athletics', 'Crafting', 'Deception', 'Diplomacy', 'Intimidation', 'Medicine', 'Nature', 'Occultism', 'Performance', 'Religion', 'Society', 'Stealth', 'Survival', 'Thievery'];
          suggestions = pick(skills);
        }
        // Await respond so any rejection (network blip, expired interaction,
        // already-acknowledged etc.) is caught by the local try/catch instead
        // of escaping to the unhandledRejection handler. The catch block
        // below will swallow these errors quietly and try a fallback respond.
        try {
          await interaction.respond(suggestions);
        } catch (respondErr) {
          // Don't try to respond again — it'll just error the same way.
          // Log if it's not the common already-acked or expired cases.
          if (respondErr?.code !== 40060 && respondErr?.code !== 10062) {
            console.error('Autocomplete respond failed:', respondErr.message);
          }
        }
        return;
      } catch (err) {
        // This catches errors during suggestion BUILDING (above the respond
        // call), not respond errors themselves (those are caught inline).
        console.error('Autocomplete error:', err);
        try { await interaction.respond([]); } catch (innerErr) {
          // Already-responded or interaction expired. Just log and move on.
          if (innerErr?.code !== 40060 && innerErr?.code !== 10062) {
            console.error('Autocomplete fallback also failed:', innerErr.message);
          }
        }
      }
    }
    return;
  }
  // commandName is mutable here so we can rewrite /m subcommands into their
  // legacy equivalents before the dispatch chain. See the /m router below.
  let { commandName } = interaction;

  // ─── /m router ───────────────────────────────────────────────────
  // Single GM-friendly umbrella for monster admin. Subcommand groups:
  //
  //   /m show name:                          → /monster name:
  //   /m roll save monster:save:[dc] [public]  → /monsterroll save ...
  //   /m roll skill monster:skill:[dc] [public] → /monsterroll skill ...
  //   /m attack add/addspell/addsave/remove/clear/list/use → /monsterattack X
  //   /m edit set/paste/list/reset/show       → /monsteredit X
  //   /m add paste/file/remove                → /monsteradd X
  //
  // We rewrite commandName to the legacy name so the existing handlers (which
  // are big and shouldn't be duplicated) handle the request. The user-facing
  // name in the slash-command picker is just `/m`; everything else flows.
  // Existing /monster, /monsterattack, /monsteredit, /monsteradd, /monsterroll
  // are kept registered as aliases so old muscle memory still works.
  if (commandName === 'm') {
    const group = interaction.options.getSubcommandGroup(false);
    if (group === 'roll')        commandName = 'monsterroll';
    else if (group === 'attack') commandName = 'monsterattack';
    else if (group === 'edit')   commandName = 'monsteredit';
    else if (group === 'add')    commandName = 'monsteradd';
    else {
      // No group — must be top-level subcommand like /m show
      const sub = interaction.options.getSubcommand(false);
      if (sub === 'show') commandName = 'monster';
      else if (sub === 'save' || sub === 'skill') commandName = 'monsterroll';
      else if (sub === 'cast') commandName = 'monstercast';
      else if (sub === 'ability') commandName = 'monsterability';
      else if (sub === 'attacks') commandName = 'monsterattacks';
      // Everything else: /m alone or unknown — fall through with no rewrite,
      // which will hit the catch-all "unknown command" handler.
    }
  }
  if (commandName === 'ping') {
    await pingCmd.execute(interaction);
  }

  else if (commandName === 'br' || commandName === 'break') {
    await brCmd.execute(interaction);
  }

  // ─── /char ───────────────────────────────────────────────────────
  else if (commandName === 'char') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const modal = new ModalBuilder()
        .setCustomId('char_create_modal')
        .setTitle('Create Blank Character');

      const mk = (id, label, placeholder, required = false) => new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(placeholder)
        .setRequired(required)
        .setMaxLength(100);

      modal.addComponents(
        new ActionRowBuilder().addComponents(mk('name', 'Character Name', 'Viv', true)),
        new ActionRowBuilder().addComponents(mk('class', 'Class', 'Fighter')),
        new ActionRowBuilder().addComponents(mk('ancestry', 'Ancestry', 'Human')),
        new ActionRowBuilder().addComponents(mk('heritage', 'Heritage', 'Versatile Human')),
        new ActionRowBuilder().addComponents(mk('level', 'Level', '1', true).setMaxLength(2)),
      );
      return interaction.showModal(modal);
    }

    if (sub === 'add') {
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('file');
      const nameLower = attachment.name.toLowerCase();
      if (!nameLower.endsWith('.json') && !nameLower.endsWith('.txt')) {
        return interaction.editReply('Please attach a `.json` **or** `.txt` file. To make one on mobile:\n1. In Pathbuilder → Menu → **Export JSON** → **Copy JSON**\n2. Paste into Notes app / Google Keep / any text editor\n3. Save/share as a `.txt` file\n4. Attach it here and run `/char add` again.');
      }
      if (attachment.size > 2 * 1024 * 1024) {
        return interaction.editReply('❌ File too large (max 2 MB). Pathbuilder JSON exports are typically under 100 KB.');
      }
      try {
        const response = await fetch(attachment.url);
        const rawText = await response.text();
        // Try JSON parse; fall back with a clean error if the file content
        // isn't actually JSON (user uploaded the wrong file, etc.)
        const parsed = parsePastedPathbuilderJSON(rawText);
        if (parsed.error) return interaction.editReply(`❌ ${parsed.error}`);
        const saved = await saveImportedCharacter(interaction.user.id, parsed.char, { preserveOverlay: false });
        if (saved.error) return interaction.editReply(`❌ ${saved.error}`);
        await interaction.editReply(`✅ **${saved.name}** saved! Use \`/sheet\` to view them.`);
      } catch (err) { console.error(err); await interaction.editReply('Something went wrong reading that file. Try again!'); }
    }

    else if (sub === 'update') {
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('file');
      const idInput = interaction.options.getString('id');
      if (!attachment && !idInput) {
        return interaction.editReply('Please attach a `.json`/`.txt` file, provide a Pathbuilder JSON ID, or provide a Pathway web JSON ID.');
      }
      if (!attachment) {
        try {
          const parsedRef = parseCharacterUpdateRef(idInput);
          if (parsedRef.error) return interaction.editReply(`âŒ ${parsedRef.error}`);
          const fetched = parsedRef.type === 'pathway'
            ? await fetchPathwayCharacter(parsedRef.id, interaction.user.id)
            : await fetchPathbuilderCharacter(parsedRef.id);
          if (fetched.error) return interaction.editReply(fetched.error);
          const saved = await saveImportedCharacter(interaction.user.id, fetched.char, { preserveOverlay: true, pathwayRow: fetched.row });
          if (saved.error) return interaction.editReply(`âŒ ${saved.error}`);
          if (!saved.replaced) return interaction.editReply(`Couldn't find **${saved.name}**. Use \`/char add\` first.`);
          if (parsedRef.type === 'pathway') {
            return interaction.editReply(`✅ **${saved.name}** updated to level ${saved.level} from Pathway web JSON ID \`${fetched.id}\`! *(hero points, XP, current HP, and bag preserved.)*`);
          }
          return interaction.editReply(`âœ… **${saved.name}** updated to level ${saved.level} from Pathbuilder ID \`${fetched.id}\`! *(hero points, XP, current HP, and bag preserved.)*`);
        } catch (err) { console.error(err); return interaction.editReply('Something went wrong. Try again!'); }
      }
      const nameLower = attachment.name.toLowerCase();
      if (!nameLower.endsWith('.json') && !nameLower.endsWith('.txt')) {
        return interaction.editReply('Please attach a `.json` or `.txt` file exported from Pathbuilder.');
      }
      if (attachment.size > 2 * 1024 * 1024) {
        return interaction.editReply('❌ File too large (max 2 MB). Pathbuilder JSON exports are typically under 100 KB.');
      }
      try {
        const response = await fetch(attachment.url);
        const rawText = await response.text();
        const parsed = parsePastedPathbuilderJSON(rawText);
        if (parsed.error) return interaction.editReply(`❌ ${parsed.error}`);
        const saved = await saveImportedCharacter(interaction.user.id, parsed.char, { preserveOverlay: true });
        if (saved.error) return interaction.editReply(`❌ ${saved.error}`);
        if (!saved.replaced) return interaction.editReply(`Couldn't find **${saved.name}**. Use \`/char add\` first.`);
        await interaction.editReply(`✅ **${saved.name}** updated to level ${saved.level}! *(hero points, XP, current HP, and bag preserved.)*`);
      } catch (err) { console.error(err); await interaction.editReply('Something went wrong. Try again!'); }
    }
    else if (sub === 'edit') {
      try {
        const charNameArg = interaction.options.getString('character');
        const characters = loadCharacters();
        const resolved = resolveChar(interaction.user.id, charNameArg, characters);
        if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
        const { charKey, char: charEntry } = resolved;
        const c = charEntry.data ?? {};
        const edits = charEntry.edits ?? {};

        // Pre-fill values: overlay first, then original data
        const prefillBackground = edits.background ?? c.background ?? '';
        const prefillDeity      = edits.deity ?? c.deity ?? '';
        const prefillLanguages  = (edits.languages && edits.languages.length)
          ? edits.languages.join(', ')
          : (charEntry.languages ?? c.languages ?? []).join(', ');
        const prefillSenses     = (edits.senses && edits.senses.length)
          ? edits.senses.join(', ')
          : (charEntry.senses ?? []).join(', ');

        const modal = new ModalBuilder()
          .setCustomId(`char_edit_modal:${charKey}`)
          .setTitle(`Edit ${c.name ?? charEntry.name ?? 'Character'}`.slice(0, 45));

        // All Discord modal labels must be ≤ 45 chars. These are fine.
        const bgInput = new TextInputBuilder()
          .setCustomId('background')
          .setLabel('Background')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
          .setValue(prefillBackground.slice(0, 100));
        const deityInput = new TextInputBuilder()
          .setCustomId('deity')
          .setLabel('Deity')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
          .setValue(prefillDeity.slice(0, 100));
        const langInput = new TextInputBuilder()
          .setCustomId('languages')
          .setLabel('Languages (comma-separated)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(prefillLanguages.slice(0, 500));
        const sensesInput = new TextInputBuilder()
          .setCustomId('senses')
          .setLabel('Senses (comma-separated)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setValue(prefillSenses.slice(0, 500));

        modal.addComponents(
          new ActionRowBuilder().addComponents(bgInput),
          new ActionRowBuilder().addComponents(deityInput),
          new ActionRowBuilder().addComponents(langInput),
          new ActionRowBuilder().addComponents(sensesInput),
        );
        return await interaction.showModal(modal);
      } catch (err) {
        console.error('/char edit showModal failed:', err);
        return interaction.reply({ content: `❌ Couldn't open the edit popup: ${err.message}`, ephemeral: true });
      }
    }

    // /char skill — set proficiency rank or flat total for a specific skill.
    // Kept separate from /char edit because:
    //   - There are too many skills (16+ in PF2e) to fit in a modal
    //   - Skills need structured input (rank dropdown or integer), not free text
    //   - Autocomplete on skill name makes discovery easy
    // If `rank` is provided, we compute total = ability_mod + (rank + level).
    // If `total` is provided, we store it as a flat override that wins over rank.
    // Use 'untrained' rank to clear an existing override.
    else if (sub === 'skill') {
      const charNameArg = interaction.options.getString('character');
      const action = interaction.options.getString('action') ?? 'set';
      const skillName = interaction.options.getString('name')?.trim();
      const rankStr = interaction.options.getString('rank'); // optional
      const total = interaction.options.getInteger('total'); // optional

      const rankMap = { untrained: 0, trained: 2, expert: 4, master: 6, legendary: 8 };
      {
        const skillLabels = {
          acrobatics: 'Acrobatics', arcana: 'Arcana', athletics: 'Athletics', crafting: 'Crafting',
          deception: 'Deception', diplomacy: 'Diplomacy', intimidation: 'Intimidation', medicine: 'Medicine',
          nature: 'Nature', occultism: 'Occultism', performance: 'Performance', religion: 'Religion',
          society: 'Society', stealth: 'Stealth', survival: 'Survival', thievery: 'Thievery',
        };
        const normalizeSkill = (value) => {
          const q = String(value ?? '').toLowerCase().trim();
          const slug = q.replace(/[^a-z0-9]+/g, '');
          return Object.keys(skillLabels).find(key => key === q || key.replace(/[^a-z0-9]+/g, '') === slug)
            ?? Object.keys(skillLabels).find(key => key.startsWith(q) || skillLabels[key].toLowerCase().startsWith(q))
            ?? null;
        };
        const normalizeLoreTopic = (value) => {
          const raw = String(value ?? '').trim();
          const topic = raw
            .replace(/^lore\s*[:\-]?\s*/i, '')
            .replace(/\s+lore$/i, '')
            .trim();
          return topic && topic.toLowerCase() !== raw.toLowerCase() ? topic : null;
        };
        if (!['set', 'list', 'remove'].includes(action)) {
          return interaction.reply({ content: 'Action must be `set`, `list`, or `remove`.', ephemeral: true });
        }
        if (rankStr !== null && !(rankStr.toLowerCase() in rankMap)) {
          return interaction.reply({ content: `Invalid rank "${rankStr}". Use: untrained, trained, expert, master, or legendary.`, ephemeral: true });
        }

        const characters = loadCharacters();
        const resolved = resolveChar(interaction.user.id, charNameArg, characters);
        if (resolved.error) return interaction.reply({ content: resolved.error, ephemeral: true });
        const { char: charEntry } = resolved;
        if (!charEntry.edits) charEntry.edits = {};
        if (!charEntry.edits.skillOverrides) charEntry.edits.skillOverrides = {};

        if (action === 'list') {
          const lines = Object.keys(skillLabels).map(key => {
            const mod = computeCharSkillModifier(charEntry, key);
            const mark = charEntry.edits.skillOverrides[key] ? ' *manual*' : '';
            return `• **${skillLabels[key]}** ${mod.modifier >= 0 ? '+' : ''}${mod.modifier} (${mod.profLabel})${mark}`;
          });
          const hiddenLores = new Set((charEntry.edits?.hiddenLores ?? []).map(s => loreKey(s)));
          const loreMap = new Map();
          for (const lore of (charEntry.data?.lores ?? [])) {
            const name = Array.isArray(lore) ? lore[0] : (lore?.name ?? lore?.skill ?? lore?.topic);
            const profNum = Array.isArray(lore)
              ? (typeof lore[1] === 'number' ? lore[1] : 0)
              : (typeof lore?.rank === 'number' ? lore.rank : typeof lore?.proficiency === 'number' ? lore.proficiency : 0);
            const totalOverride = Array.isArray(lore)
              ? (typeof lore[2] === 'number' ? lore[2] : null)
              : (typeof lore?.total === 'number' ? lore.total : null);
            if (!name || hiddenLores.has(loreKey(name))) continue;
            loreMap.set(loreKey(name), { name: loreTopicLabel(name), rank: profNum, total: totalOverride, source: 'json', manual: false });
          }
          for (const [key, rank] of Object.entries(charEntry.data?.proficiencies ?? {})) {
            if (rank <= 0 || !isLoreProficiencyKey(key) || hiddenLores.has(loreKey(key))) continue;
            loreMap.set(loreKey(key), { name: loreTopicLabel(key), rank, total: null, source: 'proficiency', manual: true });
          }
          for (const lore of (charEntry.edits?.lores ?? [])) {
            if (!lore?.name || hiddenLores.has(loreKey(lore.name))) continue;
            loreMap.set(loreKey(lore.name), {
              name: loreTopicLabel(lore.name),
              rank: lore.rank ?? 0,
              total: (typeof lore.total === 'number') ? lore.total : null,
              source: 'edit',
              manual: true,
            });
          }
          for (const lore of loreMap.values()) {
            const intMod = Math.floor((((charEntry.data?.abilities ?? {}).int ?? 10) - 10) / 2);
            const lvlForLore = charEntry.data?.level ?? 1;
            const profBonus = lore.source === 'proficiency'
              ? calcEditableProfNum(lore.rank, lvlForLore)
              : lore.source === 'edit'
                ? calcProfNum(lore.rank, lvlForLore)
                : calcCharacterProfNum(charEntry.data, lore.rank, lvlForLore);
            const displayProfValue = lore.source === 'proficiency'
              ? editableProfValue(lore.rank)
              : lore.source === 'edit'
                ? lore.rank
                : characterProfValue(charEntry.data, lore.rank);
            const computedTotal = intMod + profBonus;
            const totalValue = lore.total !== null ? lore.total : computedTotal;
            const rankLabel = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' }[displayProfValue] ?? 'Untrained';
            lines.push(`• **Lore: ${lore.name}** ${totalValue >= 0 ? '+' : ''}${totalValue} (${rankLabel})${lore.manual ? ' *manual*' : ''}`);
          }
          const embed = new EmbedBuilder()
            .setColor(0x2a8fbd)
            .setTitle(`${charEntry.name}'s Skills`)
            .setDescription(lines.join('\n').slice(0, 4000))
            .setFooter({ text: 'Use /char skill name:<skill> rank:trained to add a trained skill.' });
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (!skillName) {
          return interaction.reply({ content: 'Please provide a skill name, or use `action:list` to show all skills.', ephemeral: true });
        }

        const skillKeyLower = normalizeSkill(skillName);
        if (!skillKeyLower) {
          const loreTopic = normalizeLoreTopic(skillName);
          if (!loreTopic) {
            return interaction.reply({ content: `Unknown skill "${skillName}". For Lore, type it like \`Lore: Dragons\` or \`Dragons Lore\`.`, ephemeral: true });
          }
          if (!charEntry.edits.lores) charEntry.edits.lores = [];
          const topicLower = loreTopic.toLowerCase();
          const existingIdx = charEntry.edits.lores.findIndex(l => String(l.name ?? '').toLowerCase() === topicLower);
          const inJson = (charEntry.data?.lores ?? []).some(([name]) => String(name ?? '').toLowerCase() === topicLower);

          if (action === 'remove') {
            const wasInEdits = existingIdx !== -1;
            if (!wasInEdits && !inJson) {
              return interaction.reply({ content: `No **Lore: ${loreTopic}** found on **${charEntry.name}**.`, ephemeral: true });
            }
            if (wasInEdits) charEntry.edits.lores.splice(existingIdx, 1);
            if (inJson) {
              if (!charEntry.edits.hiddenLores) charEntry.edits.hiddenLores = [];
              if (!charEntry.edits.hiddenLores.some(h => String(h).toLowerCase() === topicLower)) charEntry.edits.hiddenLores.push(loreTopic);
            }
            saveCharacters(characters);
            return interaction.reply({ content: `Removed **Lore: ${loreTopic}** from **${charEntry.name}**.`, ephemeral: true });
          }

          if (charEntry.edits.hiddenLores) {
            charEntry.edits.hiddenLores = charEntry.edits.hiddenLores.filter(h => String(h).toLowerCase() !== topicLower);
          }
          const loreEntry = { name: loreTopic };
          if (rankStr !== null) loreEntry.rank = rankMap[rankStr.toLowerCase()];
          else if (total === null) loreEntry.rank = 2;
          if (total !== null) loreEntry.total = total;
          if (existingIdx >= 0) {
            charEntry.edits.lores[existingIdx] = {
              ...charEntry.edits.lores[existingIdx],
              ...loreEntry,
              name: loreTopic,
            };
          } else {
            charEntry.edits.lores.push(loreEntry);
          }
          saveCharacters(characters);
          const rankText = rankStr !== null ? rankStr.toLowerCase() : (total === null ? 'trained' : null);
          const detail = [rankText ? `rank **${rankText}**` : null, total !== null ? `flat total **${total >= 0 ? '+' : ''}${total}**` : null].filter(Boolean).join(' and ');
          return interaction.reply({ content: `Set **Lore: ${loreTopic}** on **${charEntry.name}** to ${detail}. Use \`/sheet\` to see it.`, ephemeral: true });
        }

        if (action === 'remove') {
          const hadOverride = Object.prototype.hasOwnProperty.call(charEntry.edits.skillOverrides, skillKeyLower);
          if (!hadOverride) {
            return interaction.reply({ content: `**${skillLabels[skillKeyLower]}** does not have a manual override on **${charEntry.name}**.`, ephemeral: true });
          }
          delete charEntry.edits.skillOverrides[skillKeyLower];
          saveCharacters(characters);
          return interaction.reply({ content: `Removed manual override for **${skillLabels[skillKeyLower]}** on **${charEntry.name}**.`, ephemeral: true });
        }

        const override = {};
        if (rankStr !== null) override.rank = rankMap[rankStr.toLowerCase()];
        else if (total === null) override.rank = 2;
        if (total !== null) override.total = total;

        if (rankStr?.toLowerCase() === 'untrained' && total === null) {
          delete charEntry.edits.skillOverrides[skillKeyLower];
        } else {
          charEntry.edits.skillOverrides[skillKeyLower] = override;
        }
        saveCharacters(characters);

        const parts = [];
        if (rankStr !== null) parts.push(`rank **${rankStr.toLowerCase()}**`);
        else if (total === null) parts.push('rank **trained**');
        if (total !== null) parts.push(`flat total **${total >= 0 ? '+' : ''}${total}**`);
        const msg = (rankStr?.toLowerCase() === 'untrained' && total === null)
          ? `Cleared override for **${skillLabels[skillKeyLower]}** on **${charEntry.name}**.`
          : `Set **${skillLabels[skillKeyLower]}** on **${charEntry.name}** to ${parts.join(' and ')}. Use \`/sheet\` to see it.`;
        return interaction.reply({ content: msg, ephemeral: true });
      }
      const skillKeyLower = skillName.toLowerCase();
      const validSkills = new Set([
        'acrobatics','arcana','athletics','crafting','deception','diplomacy',
        'intimidation','medicine','nature','occultism','performance','religion',
        'society','stealth','survival','thievery',
      ]);
      if (!validSkills.has(skillKeyLower)) {
        return interaction.reply({ content: `❌ Unknown skill "${skillName}". Valid: ${[...validSkills].join(', ')}.`, ephemeral: true });
      }
      if (rankStr === null && total === null) {
        return interaction.reply({ content: '❌ Provide either `rank` (trained/expert/master/legendary/untrained) or `total` (flat bonus), or both. If both, total wins.', ephemeral: true });
      }
      if (rankStr !== null && !(rankStr.toLowerCase() in rankMap)) {
        return interaction.reply({ content: `❌ Invalid rank "${rankStr}". Use: untrained, trained, expert, master, or legendary.`, ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { charKey, char: charEntry } = resolved;

      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.skillOverrides) charEntry.edits.skillOverrides = {};

      const override = {};
      if (rankStr !== null) override.rank = rankMap[rankStr.toLowerCase()];
      if (total !== null)   override.total = total;

      // If user sets untrained AND no total, they probably want to clear the override
      if (rankStr?.toLowerCase() === 'untrained' && total === null) {
        delete charEntry.edits.skillOverrides[skillKeyLower];
      } else {
        charEntry.edits.skillOverrides[skillKeyLower] = override;
      }

      saveCharacters(characters);

      // Build confirmation message
      const parts = [];
      if (rankStr !== null) parts.push(`rank **${rankStr.toLowerCase()}**`);
      if (total !== null)   parts.push(`flat total **${total >= 0 ? '+' : ''}${total}**`);
      const msg = (rankStr?.toLowerCase() === 'untrained' && total === null)
        ? `✅ Cleared override for **${skillName}** on **${charEntry.name}**.`
        : `✅ Set **${skillName}** on **${charEntry.name}** to ${parts.join(' and ')}. Use \`/sheet\` to see it.`;
      return interaction.reply({ content: msg, ephemeral: true });
    }

    // /char lore — add, edit, or remove a Lore skill (e.g. Lore: Farming, Lore: Dragons).
    // Unlike /char skill, lore topics are arbitrary strings — no autocomplete, no
    // fixed list. Stored in charEntry.edits.lores so they're preserved across JSON
    // re-imports. To remove one: pass `remove:True`.
    else if (sub === 'lore') {
      const charNameArg = interaction.options.getString('character');
      const topic = interaction.options.getString('topic').trim();
      const rankStr = interaction.options.getString('rank'); // optional
      const total = interaction.options.getInteger('total'); // optional
      const shouldRemove = interaction.options.getBoolean('remove') ?? false;

      if (!topic) {
        return interaction.reply({ content: '❌ Please provide a lore topic (e.g. "Dragon", "Farming", "Absalom").', ephemeral: true });
      }

      const rankMap = { untrained: 0, trained: 2, expert: 4, master: 6, legendary: 8 };
      if (!shouldRemove && rankStr === null && total === null) {
        return interaction.reply({ content: '❌ When adding/editing, provide `rank` (trained/expert/master/legendary) or `total`, or both. To delete an existing lore, pass `remove:True`.', ephemeral: true });
      }
      if (rankStr !== null && !(rankStr.toLowerCase() in rankMap)) {
        return interaction.reply({ content: `❌ Invalid rank "${rankStr}". Use: untrained, trained, expert, master, or legendary.`, ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;

      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.lores) charEntry.edits.lores = [];

      const topicLower = topic.toLowerCase();
      const existingIdx = charEntry.edits.lores.findIndex(l => l.name.toLowerCase() === topicLower);

      if (shouldRemove) {
        // Three cases:
        //   (a) Lore exists only in edits.lores → splice it out
        //   (b) Lore exists only in c.lores (JSON/PDF-sourced) → add to hiddenLores
        //   (c) Both → remove from edits AND hide the JSON one
        const c = charEntry.data ?? {};
        const inJson = (c.lores ?? []).some(([n]) => n.toLowerCase() === topicLower);
        const wasInEdits = existingIdx !== -1;
        if (!inJson && !wasInEdits) {
          return interaction.reply({ content: `❌ No lore "${topic}" to remove on **${charEntry.name}**. Use \`/sheet\` to see their current lores.`, ephemeral: true });
        }
        if (wasInEdits) {
          charEntry.edits.lores.splice(existingIdx, 1);
        }
        if (inJson) {
          if (!charEntry.edits.hiddenLores) charEntry.edits.hiddenLores = [];
          // Keep the hidden list case-insensitive-unique
          const alreadyHidden = charEntry.edits.hiddenLores.some(h => h.toLowerCase() === topicLower);
          if (!alreadyHidden) charEntry.edits.hiddenLores.push(topic);
        }
        saveCharacters(characters);
        return interaction.reply({ content: `✅ Removed **Lore: ${topic}** from **${charEntry.name}**.`, ephemeral: true });
      }

      // If the user is editing a lore that was previously hidden, un-hide it
      if (charEntry.edits.hiddenLores) {
        charEntry.edits.hiddenLores = charEntry.edits.hiddenLores.filter(h => h.toLowerCase() !== topicLower);
      }

      // Build the lore entry
      const loreEntry = { name: topic };
      if (rankStr !== null) loreEntry.rank = rankMap[rankStr.toLowerCase()];
      if (total !== null)   loreEntry.total = total;

      if (existingIdx >= 0) {
        // Merge with existing — keep fields that aren't being overwritten
        const existing = charEntry.edits.lores[existingIdx];
        charEntry.edits.lores[existingIdx] = {
          name: topic, // use new casing if user retyped
          rank: (rankStr !== null) ? loreEntry.rank : existing.rank,
          total: (total !== null) ? loreEntry.total : existing.total,
        };
      } else {
        charEntry.edits.lores.push(loreEntry);
      }
      saveCharacters(characters);

      const parts = [];
      if (rankStr !== null) parts.push(`rank **${rankStr.toLowerCase()}**`);
      if (total !== null)   parts.push(`flat total **${total >= 0 ? '+' : ''}${total}**`);
      const verb = existingIdx >= 0 ? 'Updated' : 'Added';
      return interaction.reply({ content: `✅ ${verb} **Lore: ${topic}** on **${charEntry.name}** (${parts.join(' and ')}). Use \`/sheet\` to see it.`, ephemeral: true });
    }

    // /char template — send the user a blank fill-in-the-blanks character
    // template as a .txt attachment. They edit it in any text editor and
    // re-upload via /char add.
    // /char stat — set or clear a combat stat override (AC, HP max, Fort/Ref/Will,
    // Perception, Speed). These are stored in edits.stats and shown on /sheet with
    // a warning that the JSON value is being ignored.
    else if (sub === 'stat') {
      const charNameArg = interaction.options.getString('character');
      const field = interaction.options.getString('field');
      const action = interaction.options.getString('action') ?? 'set';
      const value = interaction.options.getInteger('value');

      const validFields = ['ac', 'hpMax', 'fortitude', 'reflex', 'will', 'perception', 'speed'];
      if (!validFields.includes(field)) {
        return interaction.reply({ content: `❌ Invalid field "${field}". Valid: ${validFields.join(', ')}.`, ephemeral: true });
      }
      if (action === 'set' && value === null) {
        return interaction.reply({ content: `❌ Provide a \`value\` when setting a stat (or use \`action:clear\` to revert).`, ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;

      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.stats) charEntry.edits.stats = {};

      if (action === 'clear') {
        delete charEntry.edits.stats[field];
        saveCharacters(characters);
        const fieldLabel = { ac: 'AC', hpMax: 'HP max', fortitude: 'Fort save', reflex: 'Reflex save', will: 'Will save', perception: 'Perception', speed: 'Speed' }[field];
        return interaction.reply({ content: `✅ Cleared **${fieldLabel}** override on **${charEntry.name}**. JSON value will show on \`/sheet\`.`, ephemeral: true });
      }

      charEntry.edits.stats[field] = value;
      saveCharacters(characters);
      const fieldLabel = { ac: 'AC', hpMax: 'HP max', fortitude: 'Fort save', reflex: 'Reflex save', will: 'Will save', perception: 'Perception', speed: 'Speed' }[field];
      return interaction.reply({ content: `✅ Set **${fieldLabel}** to **${value}** on **${charEntry.name}**. Use \`/sheet\` to see it.`, ephemeral: true });
    }

    // /char weapon and /char attack — add, edit, list, or remove weapons/attacks.
    // Follows the same
    // layered pattern as /char lore: edits.weapons for user-added, edits.hiddenWeapons
    // for JSON-sourced ones to hide.
    else if (sub === 'weapon' || sub === 'attack') {
      const charNameArg = interaction.options.getString('character');
      const action = interaction.options.getString('action');
      const name = interaction.options.getString('name')?.trim();

      if (!['add', 'remove', 'edit', 'list'].includes(action)) {
        return interaction.reply({ content: '❌ action must be `add`, `edit`, `list`, or `remove`.', ephemeral: true });
      }
      if (action !== 'list' && !name) {
        return interaction.reply({ content: '❌ Please provide a weapon name.', ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;
      const c = charEntry.data ?? {};

      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.weapons) charEntry.edits.weapons = [];

      if (action === 'list') {
        const weapons = getCharacterWeapons(charEntry);
        const lines = weapons.map(w => {
          const attackBonus = w.attack ?? 0;
          const damageBonus = w.damageBonus ? (w.damageBonus > 0 ? `+${w.damageBonus}` : `${w.damageBonus}`) : '';
          const damageType = w.damageType === 'P' ? 'piercing'
            : w.damageType === 'S' ? 'slashing'
            : w.damageType === 'B' ? 'bludgeoning'
            : (w.damageType ?? '').toLowerCase();
          const traits = (w.traits ?? []).length ? ` (${w.traits.join(', ')})` : '';
          return `• **${w.display ?? w.name}** ${attackBonus >= 0 ? '+' : ''}${attackBonus} to hit · ${w.die ?? '1d4'}${damageBonus} ${damageType}${traits}`;
        });
        const embed = new EmbedBuilder()
          .setColor(0x9B59B6)
          .setTitle(`${charEntry.name}'s Attacks`)
          .setDescription(lines.length ? lines.join('\n').slice(0, 4000) : '*No attacks are recorded on this character yet.*')
          .setFooter({ text: 'Use /char attack action:add to add a new attack.' });
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      const nameLower = name.toLowerCase();
      const existingIdx = charEntry.edits.weapons.findIndex(w =>
        ((w.display ?? w.name) || '').toLowerCase() === nameLower
      );
      const inJson = (c.weapons ?? []).some(w =>
        ((w.display ?? w.name) || '').toLowerCase() === nameLower
      ) || normalizePathwayCustomAttacks(c.custom_attacks).some(w =>
        ((w.display ?? w.name) || '').toLowerCase() === nameLower
      );

      if (action === 'remove') {
        // Same three-case logic as /char lore remove
        if (!inJson && existingIdx === -1) {
          return interaction.reply({ content: `❌ No weapon "${name}" to remove on **${charEntry.name}**. Use \`/sheet\` to see current weapons.`, ephemeral: true });
        }
        if (existingIdx !== -1) {
          charEntry.edits.weapons.splice(existingIdx, 1);
        }
        if (inJson) {
          if (!charEntry.edits.hiddenWeapons) charEntry.edits.hiddenWeapons = [];
          if (!charEntry.edits.hiddenWeapons.some(h => h.toLowerCase() === nameLower)) {
            charEntry.edits.hiddenWeapons.push(name);
          }
        }
        saveCharacters(characters);
        return interaction.reply({ content: `✅ Removed **${name}** from **${charEntry.name}**.`, ephemeral: true });
      }

      // add/edit: collect the weapon fields
      let attack = null;
      try { attack = interaction.options.getInteger('attack'); } catch {}
      if (attack === null) {
        try { attack = interaction.options.getInteger('bonus'); } catch {}
      }
      const damage = interaction.options.getString('damage');
      const damageType = interaction.options.getString('type'); // B/P/S or word
      const traitsRaw = interaction.options.getString('traits');

      if (action === 'add' && (attack === null || !damage || !damageType)) {
        return interaction.reply({ content: '❌ When adding a weapon, `attack`, `damage`, and `type` are all required.', ephemeral: true });
      }

      // If the user is un-hiding a weapon by re-adding it, remove from hiddenWeapons
      if (charEntry.edits.hiddenWeapons) {
        charEntry.edits.hiddenWeapons = charEntry.edits.hiddenWeapons.filter(h => h.toLowerCase() !== nameLower);
      }

      const newWeapon = existingIdx !== -1
        ? { ...charEntry.edits.weapons[existingIdx] }
        : { name, display: name, attack: 0, damageBonus: 0, die: '1d4', damageType: 'B', traits: [], strikingRune: '', potencyRune: 0, runes: [] };

      newWeapon.name = name;
      newWeapon.display = name;
      if (attack !== null) newWeapon.attack = attack;
      if (damage) newWeapon.die = damage;
      if (damageType) newWeapon.damageType = damageType;
      if (traitsRaw !== null) newWeapon.traits = traitsRaw.split(',').map(t => t.trim()).filter(Boolean);

      if (existingIdx !== -1) {
        charEntry.edits.weapons[existingIdx] = newWeapon;
      } else {
        charEntry.edits.weapons.push(newWeapon);
      }
      saveCharacters(characters);

      const verb = action === 'add' ? (existingIdx !== -1 ? 'Updated' : 'Added') : 'Updated';
      return interaction.reply({ content: `✅ ${verb} **${name}** on **${charEntry.name}** (${newWeapon.attack >= 0 ? '+' : ''}${newWeapon.attack} to hit, ${newWeapon.die} ${newWeapon.damageType}). Use \`/sheet\` to see it.`, ephemeral: true });
    }

    // /char identity — modal for class/subclass/level/ancestry/heritage
    // All 5 slots used. Pre-fills with current values (merged from overrides).
    else if (sub === 'identity') {
      try {
        const charNameArg = interaction.options.getString('character');
        const characters = loadCharacters();
        const resolved = resolveChar(interaction.user.id, charNameArg, characters);
        if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
        const { charKey, char: charEntry } = resolved;
        const c = charEntry.data ?? {};
        const identity = charEntry.edits?.identity ?? {};

        const modal = new ModalBuilder()
          .setCustomId(`char_identity_modal:${charKey}`)
          .setTitle(`Identity: ${c.name ?? charEntry.name ?? 'Character'}`.slice(0, 45));
        const mk = (id, label, defaultValue, maxLen = 100) => new TextInputBuilder()
          .setCustomId(id).setLabel(label.slice(0, 45))
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(maxLen)
          .setValue(String(defaultValue ?? '').slice(0, maxLen));
        modal.addComponents(
          new ActionRowBuilder().addComponents(mk('class', 'Class', identity.class ?? c.class)),
          new ActionRowBuilder().addComponents(mk('subclass', 'Subclass / Archetype', identity.subclass ?? c.subclass)),
          new ActionRowBuilder().addComponents(mk('level', 'Level (number)', identity.level ?? c.level, 3)),
          new ActionRowBuilder().addComponents(mk('ancestry', 'Ancestry (e.g. Human, Elf)', identity.ancestry ?? c.ancestry)),
          new ActionRowBuilder().addComponents(mk('heritage', 'Heritage (e.g. Versatile Human)', identity.heritage ?? c.heritage)),
        );
        return await interaction.showModal(modal);
      } catch (err) {
        console.error('/char identity showModal failed:', err);
        return interaction.reply({ content: `❌ Couldn\'t open the popup: ${err.message}`, ephemeral: true });
      }
    }

    // /char misc — modal for gender/age/size/alignment/keyability
    else if (sub === 'misc') {
      try {
        const charNameArg = interaction.options.getString('character');
        const characters = loadCharacters();
        const resolved = resolveChar(interaction.user.id, charNameArg, characters);
        if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
        const { charKey, char: charEntry } = resolved;
        const c = charEntry.data ?? {};
        const misc = charEntry.edits?.misc ?? {};

        const modal = new ModalBuilder()
          .setCustomId(`char_misc_modal:${charKey}`)
          .setTitle(`Misc: ${c.name ?? charEntry.name ?? 'Character'}`.slice(0, 45));
        const mk = (id, label, defaultValue, maxLen = 60, placeholder) => {
          const b = new TextInputBuilder()
            .setCustomId(id).setLabel(label.slice(0, 45))
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(maxLen)
            .setValue(String(defaultValue ?? '').slice(0, maxLen));
          if (placeholder) b.setPlaceholder(placeholder);
          return b;
        };
        modal.addComponents(
          new ActionRowBuilder().addComponents(mk('gender', 'Gender / Pronouns', misc.gender ?? c.gender)),
          new ActionRowBuilder().addComponents(mk('age', 'Age', misc.age ?? c.age, 20)),
          new ActionRowBuilder().addComponents(mk('size', 'Size (number or name)', (misc.size !== undefined ? misc.size : c.size), 20, '0=Medium, -1=Small, 1=Large, etc.')),
          new ActionRowBuilder().addComponents(mk('alignment', 'Alignment (e.g. LG, N, CE)', misc.alignment ?? c.alignment, 10)),
          new ActionRowBuilder().addComponents(mk('keyability', 'Key ability (str/dex/int/etc.)', misc.keyability ?? c.keyability, 10)),
        );
        return await interaction.showModal(modal);
      } catch (err) {
        console.error('/char misc showModal failed:', err);
        return interaction.reply({ content: `❌ Couldn\'t open the popup: ${err.message}`, ephemeral: true });
      }
    }

    // /char ability — set one ability score. Stored as SCORE (not mod).
    // Quick conversion: mod = (score - 10) / 2, so +4 mod = 18 score.
    else if (sub === 'ability') {
      const charNameArg = interaction.options.getString('character');
      const field = interaction.options.getString('field');
      const action = interaction.options.getString('action') ?? 'set';
      const value = interaction.options.getInteger('value');

      const validFields = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
      if (!validFields.includes(field)) {
        return interaction.reply({ content: `❌ Invalid ability "${field}". Valid: ${validFields.join(', ')}.`, ephemeral: true });
      }
      if (action === 'set' && value === null) {
        return interaction.reply({ content: `❌ Provide a \`value\` when setting (or use \`action:clear\` to revert). Ability scores are typically 8-20 (a +4 modifier is a score of 18).`, ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;
      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.abilities) charEntry.edits.abilities = {};

      if (action === 'clear') {
        delete charEntry.edits.abilities[field];
        saveCharacters(characters);
        return interaction.reply({ content: `✅ Cleared **${field.toUpperCase()}** override on **${charEntry.name}**. JSON value will show on \`/sheet\`.`, ephemeral: true });
      }

      charEntry.edits.abilities[field] = value;
      saveCharacters(characters);
      const mod = Math.floor((value - 10) / 2);
      const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
      return interaction.reply({ content: `✅ Set **${field.toUpperCase()}** to **${value}** (${modStr} mod) on **${charEntry.name}**.`, ephemeral: true });
    }
    else if (sub === 'item') {
      const charNameArg = interaction.options.getString('character');
      const action = interaction.options.getString('action');
      const name = interaction.options.getString('name')?.trim();
      const quantity = interaction.options.getInteger('quantity') ?? 1;

      if (!['add', 'remove', 'edit'].includes(action)) {
        return interaction.reply({ content: '❌ action must be `add`, `remove`, or `edit`.', ephemeral: true });
      }
      if (!name) {
        return interaction.reply({ content: '❌ Please provide an item name.', ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;
      const c = charEntry.data ?? {};
      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.items) charEntry.edits.items = [];

      const nameLower = name.toLowerCase();
      // c.equipment is [name, quantity] tuples in Pathbuilder JSON
      const jsonItems = c.equipment ?? [];
      const existingJsonIdx = jsonItems.findIndex(([n]) => (n || '').toLowerCase() === nameLower);
      const existingEditIdx = charEntry.edits.items.findIndex(([n]) => (n || '').toLowerCase() === nameLower);

      if (action === 'remove') {
        if (existingJsonIdx === -1 && existingEditIdx === -1) {
          return interaction.reply({ content: `❌ No item "${name}" on **${charEntry.name}**.`, ephemeral: true });
        }
        if (existingEditIdx !== -1) charEntry.edits.items.splice(existingEditIdx, 1);
        if (existingJsonIdx !== -1) {
          if (!charEntry.edits.hiddenItems) charEntry.edits.hiddenItems = [];
          if (!charEntry.edits.hiddenItems.some(h => h.toLowerCase() === nameLower)) {
            charEntry.edits.hiddenItems.push(name);
          }
        }
        saveCharacters(characters);
        return interaction.reply({ content: `✅ Removed **${name}** from **${charEntry.name}**.`, ephemeral: true });
      }

      // add/edit: un-hide if previously hidden, then set quantity
      if (charEntry.edits.hiddenItems) {
        charEntry.edits.hiddenItems = charEntry.edits.hiddenItems.filter(h => h.toLowerCase() !== nameLower);
      }
      if (existingEditIdx !== -1) {
        charEntry.edits.items[existingEditIdx] = [name, quantity];
      } else {
        charEntry.edits.items.push([name, quantity]);
      }
      saveCharacters(characters);
      const verb = (existingEditIdx !== -1 || existingJsonIdx !== -1) ? 'Updated' : 'Added';
      return interaction.reply({ content: `✅ ${verb} **${name}** (x${quantity}) on **${charEntry.name}**.`, ephemeral: true });
    }

    // /char spellcasting — set DC, attack, tradition, key ability on the character's
    // primary spellcaster (c.spellCasters[0]). Stored in edits.spellcasting, merged
    // at display/cast time.
    else if (sub === 'spellcasting') {
      const charNameArg = interaction.options.getString('character');
      const field = interaction.options.getString('field');
      const action = interaction.options.getString('action') ?? 'set';
      const valueInt = interaction.options.getInteger('value');
      const valueStr = interaction.options.getString('text_value');

      const numericFields = ['dc', 'attack'];
      const textFields = ['tradition', 'keyAbility'];
      const valid = [...numericFields, ...textFields];
      if (!valid.includes(field)) {
        return interaction.reply({ content: `❌ Invalid field "${field}". Valid: ${valid.join(', ')}.`, ephemeral: true });
      }

      const characters = loadCharacters();
      const resolved = resolveChar(interaction.user.id, charNameArg, characters);
      if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
      const { char: charEntry } = resolved;
      if (!charEntry.edits) charEntry.edits = {};
      if (!charEntry.edits.spellcasting) charEntry.edits.spellcasting = {};

      if (action === 'clear') {
        delete charEntry.edits.spellcasting[field];
        saveCharacters(characters);
        return interaction.reply({ content: `✅ Cleared spellcasting **${field}** override on **${charEntry.name}**.`, ephemeral: true });
      }

      if (numericFields.includes(field)) {
        if (valueInt === null) return interaction.reply({ content: `❌ Provide a \`value\` (integer) when setting ${field}.`, ephemeral: true });
        charEntry.edits.spellcasting[field] = valueInt;
      } else {
        if (!valueStr) return interaction.reply({ content: `❌ Provide a \`text_value\` (e.g. "arcane", "int") when setting ${field}.`, ephemeral: true });
        charEntry.edits.spellcasting[field] = valueStr.toLowerCase();
      }
      saveCharacters(characters);
      const val = numericFields.includes(field) ? valueInt : valueStr.toLowerCase();
      return interaction.reply({ content: `✅ Set spellcasting **${field}** to **${val}** on **${charEntry.name}**.`, ephemeral: true });
    }

    else if (sub === 'template') {
      try {
        const content = getBlankCharacterTemplate();
        const buffer = Buffer.from(content, 'utf8');
        const attachment = new AttachmentBuilder(buffer, { name: 'pathway_character_template.txt' });
        await interaction.reply({
          content: '📝 **Blank character template attached.**\n\n' +
            '**How to use:**\n' +
            '1. Download the file\n' +
            '2. Open it in any text editor (Notepad, TextEdit, phone notes app, etc.)\n' +
            '3. Fill in your character\'s details — the `//` comments explain each field\n' +
            '4. Save (keep the `.txt` extension)\n' +
            '5. Run `/char add file:<the-edited-file>` to import them\n\n' +
            '*You can keep the `// comments` or delete them — the bot ignores them either way.*\n' +
            '*For small changes to an existing character, `/char edit`, `/char skill`, and `/char lore` are faster.*',
          files: [attachment],
          ephemeral: true,
        });
      } catch (err) {
        console.error('/char template error:', err);
        await interaction.reply({ content: `❌ Couldn\'t generate the template: ${err.message}`, ephemeral: true });
      }
    }

    // /char dump — export the user's current character as a template-formatted
    // .txt file. For heavy modifications: dump → edit locally → re-import.
    else if (sub === 'dump') {
      try {
        const charNameArg = interaction.options.getString('character');
        const characters = loadCharacters();
        const resolved = resolveChar(interaction.user.id, charNameArg, characters);
        if (resolved.error) return interaction.reply({ content: `❌ ${resolved.error}`, ephemeral: true });
        const { char: charEntry } = resolved;
        const c = charEntry.data ?? {};

        // Serialize with the same pretty format as the template. Strip
        // _comment_* fields only when dumping (they're useful in the template
        // but the user's real character shouldn't carry them).
        const cleaned = {};
        for (const [k, v] of Object.entries(c)) {
          if (k.startsWith('_comment')) continue;
          cleaned[k] = v;
        }

        const header = `// Pathway Character Export — ${charEntry.name}\n` +
          `// =====================================================================\n` +
          `// Exported: ${new Date().toISOString().split('T')[0]}\n` +
          `// To re-import after editing: /char update file:<this-edited-file>\n` +
          `// (Or /char add to import as a new character with a different name.)\n` +
          `// =====================================================================\n\n`;
        const body = JSON.stringify(cleaned, null, 2);
        const buffer = Buffer.from(header + body, 'utf8');
        const safeName = (charEntry.name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const attachment = new AttachmentBuilder(buffer, { name: `${safeName}.txt` });
        await interaction.reply({
          content: `📤 **${charEntry.name}** exported. Edit and re-import with \`/char update file:<the-edited-file>\` to apply changes.`,
          files: [attachment],
          ephemeral: true,
        });
      } catch (err) {
        console.error('/char dump error:', err);
        await interaction.reply({ content: `❌ Couldn\'t export that character: ${err.message}`, ephemeral: true });
      }
    }
    // ─── /char hp ─────────────────────────────────────────────────────
    // Override or reset a character's max HP, and/or set their current HP.
    // Useful when an import miscalculates HP (e.g. PDF imports missing
    // toughness/diehard/etc., or when a campaign uses house rules).
    //
    // Usage:
    //   /char hp max:42                  → sets max HP override to 42
    //   /char hp max:reset               → clears override, returns to computed
    //   /char hp current:30              → sets current HP to 30 (clamped to max)
    //   /char hp max:42 current:30       → both at once
    else if (sub === 'hp') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      const nameArg = interaction.options.getString('character');
      const { error, charKey, char: charEntry } = resolveChar(userId, nameArg, characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });

      const maxArg = interaction.options.getString('max');
      const currentArg = interaction.options.getInteger('current');

      if (!maxArg && currentArg == null) {
        // No args — just show current state
        const computed = (() => {
          const c = charEntry.data;
          const lvl = c.level ?? 1;
          const conMod = Math.floor(((c.abilities?.con ?? 10) - 10) / 2);
          return (c.attributes?.ancestryhp ?? 0) + (c.attributes?.bonushp ?? 0) + (((c.attributes?.classhp ?? 0) + (c.attributes?.bonushpPerLevel ?? 0) + conMod) * lvl);
        })();
        const effective = computeCharMaxHp(charEntry);
        const current = getCharacterHp(charEntry);
        const overrideText = (typeof charEntry._hpMaxOverride === 'number' && charEntry._hpMaxOverride > 0)
          ? `\n*Override is active.* Computed value would be **${computed}**.`
          : '';
        return interaction.reply({
          content: `**${charEntry.data.name}**: ${current} / ${effective} HP${overrideText}\n\nUse \`/char hp max:<n>\` to override max, \`/char hp current:<n>\` to set current, or \`/char hp max:reset\` to clear an override.`,
          ephemeral: true,
        });
      }

      const changes = [];

      // Handle max: parameter
      if (maxArg) {
        if (maxArg.toLowerCase() === 'reset' || maxArg.toLowerCase() === 'clear' || maxArg.toLowerCase() === 'auto') {
          if (typeof charEntry._hpMaxOverride === 'number') {
            delete charEntry._hpMaxOverride;
            changes.push(`max HP override cleared (now computed)`);
          } else {
            changes.push(`max HP wasn't overridden — no change`);
          }
        } else {
          const n = parseInt(maxArg, 10);
          if (Number.isNaN(n) || n <= 0 || n > 9999) {
            return interaction.reply({ content: `❌ \`max\` must be a positive number (or \`reset\`). Got: \`${maxArg}\``, ephemeral: true });
          }
          charEntry._hpMaxOverride = n;
          changes.push(`max HP set to **${n}**`);
        }
      }

      // Handle current: parameter — apply AFTER max change so clamp uses new max
      if (currentArg != null) {
        const newMax = computeCharMaxHp(charEntry);
        if (currentArg < 0) {
          return interaction.reply({ content: `❌ Current HP can't be negative.`, ephemeral: true });
        }
        const clamped = Math.min(currentArg, newMax);
        setCharacterHp(charEntry, clamped);
        if (clamped !== currentArg) {
          changes.push(`current HP set to **${clamped}** (clamped to max)`);
        } else {
          changes.push(`current HP set to **${clamped}**`);
        }
      }

      saveCharacters(characters);

      const finalMax = computeCharMaxHp(charEntry);
      const finalCurrent = getCharacterHp(charEntry);
      return interaction.reply(`✅ **${charEntry.data.name}**: ${changes.join(', ')}.\nNow at **${finalCurrent} / ${finalMax}** HP.`);
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
      {
        const activeKey = userChars._activeChar;
        {
        const displayName = interaction.member?.displayName ?? interaction.user.displayName ?? interaction.user.username;
        const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 64 });
        const sortedKeys = [...charKeys].sort((a, b) => {
          const aName = userChars[a]?.data?.name ?? userChars[a]?.name ?? a;
          const bName = userChars[b]?.data?.name ?? userChars[b]?.name ?? b;
          return String(aName).localeCompare(String(bName));
        });
        const activeChar = activeKey && userChars[activeKey]
          ? (userChars[activeKey]?.data?.name ?? userChars[activeKey]?.name ?? activeKey)
          : 'None set';
        const names = sortedKeys.map(k => {
          const c = userChars[k];
          return c?.data?.name ?? c?.name ?? k;
        });
        const description = charKeys.length
          ? [
              '**Your characters**',
              '',
              `**Active Character:** ${activeChar}`,
              '',
              names.join(', '),
            ].join('\n').slice(0, 4096)
          : '**Your characters**\n\nNo saved characters yet.';
        const charListEmbed = new EmbedBuilder()
          .setColor(0xff9b45)
          .setAuthor({ name: displayName, iconURL: avatarUrl })
          .setDescription(description);
        if (charKeys.length === 0) {
          charListEmbed.setFooter({ text: 'Use /char add, /char import, or /char create to add one.' });
        }
        return interaction.reply({ embeds: [charListEmbed] });
        }
/*
        if (charKeys.length === 0) {
          const emptyEmbed = new EmbedBuilder()
            .setColor(0x7c3aed)
            .setTitle(`${interaction.user.displayName}'s Characters`)
            .setDescription('No saved characters yet.')
            .setFooter({ text: 'Use /char add, /char import, or /char create to add one.' });
          return interaction.reply({ embeds: [emptyEmbed] });
        }

        const sortedKeys = [...charKeys].sort((a, b) => {
          if (a === activeKey) return -1;
          if (b === activeKey) return 1;
          const aName = userChars[a]?.data?.name ?? userChars[a]?.name ?? a;
          const bName = userChars[b]?.data?.name ?? userChars[b]?.name ?? b;
          return String(aName).localeCompare(String(bName));
        });

        const list = sortedKeys.map((k, idx) => {
          const c = userChars[k];
          const name = c?.data?.name ?? c?.name ?? k;
          const level = c?.data?.level ?? c?.level ?? c?.data?.details?.level ?? null;
          const ancestry = c?.data?.ancestry ?? c?.ancestry ?? null;
          const className = c?.data?.class ?? c?.class ?? c?.data?.className ?? null;
          const activeTag = k === activeKey ? ' 📌' : '';
          const artTag = c?.art ? ' 🖼️' : '';
          const detailParts = [];
          if (level !== null && level !== undefined && level !== '') detailParts.push(`Level ${level}`);
          if (ancestry) detailParts.push(ancestry);
          if (className) detailParts.push(className);
          const details = detailParts.length ? `\n${detailParts.join(' • ')}` : '';
          return `**${idx + 1}. ${name}**${activeTag}${artTag}${details}`;
        }).join('\n\n');

        const embed = new EmbedBuilder()
          .setColor(0x7c3aed)
          .setTitle(`${interaction.user.displayName}'s Characters`)
          .setDescription(list.slice(0, 4096))
          .setFooter({ text: `${charKeys.length} saved character${charKeys.length === 1 ? '' : 's'} • 📌 active • 🖼️ art set` });
        return interaction.reply({ embeds: [embed] });
      }
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
*/
    }
    }

    // /char import — fetch from Pathbuilder's JSON endpoint or Pathway web.
    else if (sub === 'import') {
      await interaction.deferReply({ ephemeral: true });
      const idInput = interaction.options.getString('id', true);
      try {
        const parsedRef = parseCharacterUpdateRef(idInput);
        if (parsedRef.error) return interaction.editReply(`❌ ${parsedRef.error}`);
        const fetched = parsedRef.type === 'pathway'
          ? await fetchPathwayCharacter(parsedRef.id, interaction.user.id)
          : await fetchPathbuilderCharacter(parsedRef.id);
        if (fetched.error) return interaction.editReply(fetched.error);
        const saved = await saveImportedCharacter(interaction.user.id, fetched.char, { preserveOverlay: false, pathwayRow: fetched.row });
        if (saved.error) return interaction.editReply(`❌ ${saved.error}`);
        if (parsedRef.type === 'pathway') {
          return interaction.editReply(`✅ **${saved.name}** imported from Pathway web JSON ID \`${fetched.id}\`! Use \`/sheet\` to view them.`);
        }
        return interaction.editReply(`✅ **${saved.name}** imported from Pathbuilder ID \`${fetched.id}\`! Use \`/sheet\` to view them.`);
      } catch (err) {
        console.error('/char import fetch error:', err);
        return interaction.editReply(`❌ Something went wrong importing that character: \`${err.message}\``);
      }
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
        await syncActiveCharacterToSupabase(userId, null, interaction.user.username);
        await saveCharacters(characters);
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
      await syncActiveCharacterToSupabase(userId, charKey, interaction.user.username);
      await saveCharacters(characters);
      const charName = characters[userId][charKey].name;
      return interaction.reply({ content: `📌 Active character set to **${charName}**. Commands will default to them when no \`character:\` is specified.`, ephemeral: true });
    }

    else if (sub === 'feat') {
      const action = interaction.options.getString('action'); // add or remove
      const featName = interaction.options.getString('name');
      const userId = interaction.user.id;
      const characters2 = loadCharacters();
      const { error: e2, charKey: ck2, char: ce2 } = resolveChar(userId, interaction.options.getString('character'), characters2);
      if (e2) return interaction.reply({ content: e2, ephemeral: true });
      const featLevel = interaction.options.getInteger('level') ?? ce2.data?.level ?? 1;
      if (!ce2.data.feats) ce2.data.feats = [];
      if (action === 'add') {
        // Pathbuilder stores feats as arrays: [name, sourceText, level, ...]
        ce2.data.feats.push([featName, '', featLevel, '']);
        characters2[userId][ck2] = ce2;
        await saveCharacters(characters2);
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
        await saveCharacters(characters2);
        return interaction.reply({ content: `🗑️ Removed feat **${featName}** from **${ce2.data.name}**.` });
      }
    }
  }

  // ─── /feats ──────────────────────────────────────────────────────
  else if (commandName === 'feats') {
    await featsCmd.execute(interaction);
  }

  else if (commandName === 'abilities') {
    await abilitiesCmd.execute(interaction);
  }

  // ─── /description ────────────────────────────────────────────────
  else if (commandName === 'description') {
    await descriptionCmd.execute(interaction);
  }

  else if (commandName === 'sheet') {
    await sheetCmd.execute(interaction);
  }

  // ─── /portrait ─────────────────────────────────────────────────
  // Show the current active art for a character, large. Defaults to the
  // caller's active character; takes an optional `character:` arg to pick
  // one by name. If no art is set, points the user at `/char art`.
  else if (commandName === 'portrait') {
    await portraitCmd.execute(interaction);
  }

  // ─── /snippet ─────────────────────────────────────────────────────
  // Per-user text substitutions for /roll. Create shortcuts like `sneaky`
  // = `+2d6[sneak]` so users can type `/roll 1d20+5 sneaky` instead of
  // the full expression every time.
  else if (commandName === 'snippet') {
    await snippetCmd.execute(interaction);
  }

  // ─── /serversnippet ───────────────────────────────────────────────
  // Server-wide snippets, available to everyone in the server. Creation
  // and deletion require the ManageGuild permission (typically GMs/mods).
  // Personal snippets override server snippets with the same name.
  else if (commandName === 'serversnippet') {
    await serverSnippetCmd.execute(interaction);
  }

  // ─── /cvar ───────────────────────────────────────────────────────
  // Per-character variables. Used by /roll to expand {{name}} into a value.
  // Stored on charEntry.overlay.cvars (no separate Supabase column).
  else if (commandName === 'cvar') {
    await cvarCmd.execute(interaction);
  }

  // ─── /cc ─────────────────────────────────────────────────────────
  // Custom counters: arbitrary per-character resources (panache, reagents,
  // stratagem charges, etc.). Stored at overlay.counters.
  else if (commandName === 'cc') {
    await ccCmd.execute(interaction);
  }

  // ─── /counters ───────────────────────────────────────────────────
  // Top-level shortcut for the same view as /cc list — keeps the counter
  // block one slash command away.
  else if (commandName === 'counters') {
    await ccCmd.executeCounters(interaction);
  }

  // ─── /spellbook ──────────────────────────────────────────────────
  else if (commandName === 'spellbook') {
    await spellbookCmd.execute(interaction);
  }

  else if (commandName === 'prepared') {
    await spellbookCmd.executePrepared(interaction);
  }


  // ─── /spell ──────────────────────────────────────────────────────
  else if (commandName === 'spell') {
    await spellCmd.execute(interaction);
  }

  // ─── /cast ───────────────────────────────────────────────────────
  else if (commandName === 'cast') {
    await castCmd.execute(interaction);
  }


  // or jumps to a specific category if `topic:` is passed.
  else if (commandName === 'help') {
    await helpCmd.execute(interaction);
  }

  // ─── /spells ─────────────────────────────────────────────────────
  // Character spellbook/repertoire/prepared management. Subcommands:
  //   learn  — permanent addition (wizards copying scrolls, witches learning)
  //   forget — remove an overlay-learned spell
  //   prepare / unprepare — today's prep for prepared casters
  //   swap   — permanent repertoire change for spontaneous casters
  //   list   — show the merged view (same as /spellbook)
  else if (commandName === 'spells') {
    await spellsCmd.execute(interaction);
  }

  // ─── /rest ───────────────────────────────────────────────────────
  // Long rest: refills slots, focus, hero points → 1, clears prepared list.
  // Shows a confirmation button first so people don't wipe today's prep accidentally.
  else if (commandName === 'rest') {
    await restCmd.execute(interaction);
  }

  // ─── /refocus ────────────────────────────────────────────────────
  else if (commandName === 'refocus') {
    await refocusCmd.execute(interaction);
  }

  // ─── /resource ───────────────────────────────────────────────────
  else if (commandName === 'resource') {
    await resourceCmd.execute(interaction);
  }

  // ─── /mattack ────────────────────────────────────────────────────
  else if (commandName === 'mattack') {
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;
    const v2Encounter = combatV2State.getEncounter(channelId);
    if (v2Encounter) {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can use `/mattack` in combat v2.', ephemeral: true });
      const attackerName = interaction.options.getString('attacker');
      const attackName = interaction.options.getString('name');
      const targetName = interaction.options.getString('target');
      const manualBonus = interaction.options.getInteger('bonus');
      const manualDamage = interaction.options.getString('damage');
      const manualType = interaction.options.getString('type');
      const mapOverride = interaction.options.getInteger('map');
      const agile = interaction.options.getBoolean('agile') ?? false;

      const attacker = combatV2State.findCombatant(v2Encounter, attackerName);
      if (!attacker) return interaction.reply({ content: `No combatant named **"${attackerName}"** in combat.`, ephemeral: true });
      const target = combatV2State.findCombatant(v2Encounter, targetName);
      if (!target) return interaction.reply({ content: `No combatant named **"${targetName}"** in combat.`, ephemeral: true });

      let attack = combatV2FindAttack(attacker, attackName);
      if (!attack && manualBonus == null && !manualDamage) {
        return interaction.reply({ content: `No saved attack matching **"${attackName}"** found for **${attacker.name}**. Add manual \`bonus\` and \`damage\`, or use one of:\n${combatV2AttackListText(attacker)}`, ephemeral: true });
      }
      if (!attack) {
        attack = {
          name: attackName,
          bonus: manualBonus ?? 0,
          damage: manualDamage ?? '1d4',
          damageType: manualType ?? 'damage',
          traits: agile ? ['agile'] : [],
          source: 'manual',
        };
      } else {
        attack = {
          ...attack,
          bonus: manualBonus ?? attack.bonus,
          damage: manualDamage ?? attack.damage,
          damageType: manualType ?? attack.damageType,
          traits: agile && !(attack.traits ?? []).some(t => String(t).toLowerCase() === 'agile')
            ? [...(attack.traits ?? []), 'agile']
            : (attack.traits ?? []),
        };
      }

      const [result] = combatV2Rolls.rollAttack({ attacker, target, attack, map: mapOverride, count: 1 });
      const embed = combatV2Render.renderAttackResult(result).setTitle(`${attacker.name} attacks with ${attack.name}`);
      // Monster art lookup — guild-specific override first, then bestiary fallback.
      const thumbnail = lookupMonsterArt(interaction.guildId, attacker.name);
      if (thumbnail) embed.setThumbnail(thumbnail);
      else if (PATHWAY_DICE_BUFFER) embed.setThumbnail(PATHWAY_DICE_REF);
      let content;
      let embedDeath = [];
      if (['success', 'criticalSuccess'].includes(result.degree) && result.finalDamage > 0) {
        const beforeHp = target.hp;
        const applied = combatV2State.applyHp(channelId, target.name, -result.finalDamage);
        content = `**${target.name}** took **${result.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP${combatDyingSuffix(applied)}`;
        const deathPayload = combatDeathPayload(applied);
        if (deathPayload?.embeds?.length) embedDeath = deathPayload.embeds;
      }
      if (mapOverride === null) attacker.attacksThisTurn = (attacker.attacksThisTurn ?? 0) + 1;
      await interaction.reply({ content, embeds: [embed, ...(embedDeath ?? [])].slice(0, 10), files: rollFallbackFiles(thumbnail) });
      await updateCombatV2Summary(interaction.channel, v2Encounter);
      return;
    }

    const outOfCombatAttackerName = interaction.options.getString('attacker');
    const outOfCombatAttackName = interaction.options.getString('name');
    const outOfCombatTargetName = interaction.options.getString('target');
    const outOfCombatBonus = interaction.options.getInteger('bonus');
    const outOfCombatDamage = interaction.options.getString('damage');
    const outOfCombatType = interaction.options.getString('type') ?? 'damage';
    const outOfCombatMap = interaction.options.getInteger('map');
    const outOfCombatAgile = interaction.options.getBoolean('agile') ?? false;

    let outOfCombatAttack = null;
    let outOfCombatDisplayName = outOfCombatAttackerName;

    if (outOfCombatBonus != null && outOfCombatDamage) {
      outOfCombatAttack = {
        name: outOfCombatAttackName,
        bonus: outOfCombatBonus,
        damage: outOfCombatDamage,
        damageType: outOfCombatType,
        traits: outOfCombatAgile ? ['agile'] : [],
        source: 'manual',
      };
    } else {
      const displayName = resolveMonsterDisplayName(outOfCombatAttackerName);
      const { monster } = findMonster(displayName);
      let bestiaryAttacks = [];
      if (monster) {
        outOfCombatDisplayName = monster.name;
        const edits = getMonsterEdit(interaction.guildId, monster.name);
        const edited = applyMonsterEdits(monster, edits);
        const withLibrary = applyMonsterAttackLibrary(edited, interaction.guildId);
        const rawAttacks = Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
        bestiaryAttacks = rawAttacks.map(a => normalizeAttackForRolling(a));
      }

      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, interaction.guildId);
      const libEntry = guild[monsterKey(outOfCombatDisplayName)] ?? guild[monsterKey(displayName)];
      const libAttacks = libEntry?.attacks ?? [];
      const allAttacks = bestiaryAttacks.length > 0 ? bestiaryAttacks : libAttacks;
      const q = String(outOfCombatAttackName ?? '').toLowerCase().trim();
      outOfCombatAttack = allAttacks.find(a => String(a.name ?? '').toLowerCase() === q) ?? null;
      if (!outOfCombatAttack) {
        const partial = allAttacks.filter(a => String(a.name ?? '').toLowerCase().includes(q));
        if (partial.length === 1) outOfCombatAttack = partial[0];
        else if (partial.length > 1) {
          return interaction.reply({
            content: `🔍 Multiple attacks match **"${outOfCombatAttackName}"** on **${outOfCombatDisplayName}**: ${partial.map(a => `\`${a.name}\``).join(', ')}. Be more specific.`,
            ephemeral: true,
          });
        }
      }
      if (!outOfCombatAttack) {
        const available = allAttacks.length ? allAttacks.map(a => `\`${a.name}\``).join(', ') : 'none';
        return interaction.reply({
          content: `❌ **${outOfCombatDisplayName}** has no attack matching **"${outOfCombatAttackName}"**.\nAvailable: ${available}\n\nYou can also roll manually with \`bonus:\` and \`damage:\`.`,
          ephemeral: true,
        });
      }
      outOfCombatAttack = {
        ...outOfCombatAttack,
        bonus: outOfCombatBonus ?? outOfCombatAttack.bonus ?? 0,
        damage: outOfCombatDamage ?? outOfCombatAttack.damage,
        damageType: outOfCombatType !== 'damage' ? outOfCombatType : (outOfCombatAttack.damageType ?? outOfCombatType),
        traits: outOfCombatAgile && !(outOfCombatAttack.traits ?? []).some(t => String(t).toLowerCase() === 'agile')
          ? [...(outOfCombatAttack.traits ?? []), 'agile']
          : (outOfCombatAttack.traits ?? []),
      };
    }

    if (outOfCombatAttack.kind === 'save') {
      const damageResult = rollDamageExpression(outOfCombatAttack.damage);
      if (!damageResult) return interaction.reply({ content: `❌ Couldn't parse damage expression **"${outOfCombatAttack.damage}"**.`, ephemeral: true });
      const saveDisplay = String(outOfCombatAttack.saveType ?? 'save');
      const embed = new EmbedBuilder()
        .setColor(0xD35400)
        .setTitle(`${outOfCombatDisplayName} uses ${outOfCombatAttack.name}${outOfCombatTargetName ? ` on ${outOfCombatTargetName}` : ''}!`)
        .setDescription(
          `**${saveDisplay.charAt(0).toUpperCase() + saveDisplay.slice(1)} Save DC ${outOfCombatAttack.saveDC}**\n\n` +
          `**Damage Rolled:** ${damageResult.display} = **${damageResult.total} ${outOfCombatAttack.damageType ?? ''}**\n\n` +
          `• Crit Success → **0** damage\n` +
          `• Success → **${Math.floor(damageResult.total / 2)}** damage\n` +
          `• Failure → **${damageResult.total}** damage\n` +
          `• Crit Failure → **${damageResult.total * 2}** damage`
        )
        .setFooter({ text: `${outOfCombatDisplayName} · out of initiative` });
      return interaction.reply({ embeds: [embed] });
    }

    if (!outOfCombatAttack.damage) {
      return interaction.reply({
        content: `❌ **${outOfCombatAttack.name}** on **${outOfCombatDisplayName}** does not have rollable damage. Use manual \`damage:\` to override it.`,
        ephemeral: true,
      });
    }

    const [outOfCombatResult] = combatV2Rolls.rollAttack({
      attacker: { name: outOfCombatDisplayName, attacksThisTurn: 0, effects: [] },
      target: null,
      attack: outOfCombatAttack,
      map: outOfCombatMap,
      count: 1,
    });
    const outOfCombatEmbed = combatV2Render.renderAttackResult(outOfCombatResult)
      .setTitle(`${outOfCombatDisplayName} attacks${outOfCombatTargetName ? ` ${outOfCombatTargetName}` : ''} with ${outOfCombatAttack.name}`)
      .setFooter({ text: `${outOfCombatDisplayName} · out of initiative${outOfCombatAttack.traits?.length ? ` · ${outOfCombatAttack.traits.join(', ')}` : ''}` });
    const outOfCombatThumb = lookupMonsterArt(interaction.guildId, outOfCombatDisplayName);
    if (outOfCombatThumb) outOfCombatEmbed.setThumbnail(outOfCombatThumb);
    else if (PATHWAY_DICE_BUFFER) outOfCombatEmbed.setThumbnail(PATHWAY_DICE_REF);
    return interaction.reply({ embeds: [outOfCombatEmbed], files: rollFallbackFiles(outOfCombatThumb) });

    const enc = getEncounter(channelId);
    if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can use `/mattack`.', ephemeral: true });

    const attackerName = interaction.options.getString('attacker');
    const attackName = interaction.options.getString('name');
    const attackBonus = interaction.options.getInteger('bonus');
    const damageExpr = interaction.options.getString('damage');
    const targetName = interaction.options.getString('target');
    const damageType = (interaction.options.getString('type') ?? 'damage').toLowerCase();
    const explicitMap = interaction.options.getInteger('map'); // null if unset
    const agile = interaction.options.getBoolean('agile') ?? false;

    if (attackBonus == null || !damageExpr) {
      return interaction.reply({ content: 'Legacy `/mattack` needs both `bonus` and `damage`. In combat v2 those are optional when using a saved attack.', ephemeral: true });
    }

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
    let deathPayload = null;
    let mentionLine = '';
    if (degree === 'success' || degree === 'crit-success') {
      const dmgResult = ca.applyDamage(channelId, target.name, finalDamage);
      const dyingNote = dmgResult?.displaySuffix ?? '';
      hpLine = target.isNpc
        ? `\n❤️ **${target.name}** took ${finalDamage} damage${dyingNote}`
        : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
      deathPayload = combatDeathPayload(dmgResult);
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
      .setTitle(`${attacker.name} attacks with ${attackName}!`)
      .setDescription(description)
      .setFooter({ text: `GM attack · Attack ${fmt(attackBonus)} · ${damageExpr} ${damageType}` });

    const replyPayload = { embeds: [embed, ...(deathPayload?.embeds ?? [])].slice(0, 10) };
    if (mentionLine) replyPayload.content = mentionLine;
    await interaction.reply(replyPayload);
    // Record attack for MAP tracking (only if MAP wasn't manually overridden)
    if (explicitMap === null) {
      ca.recordAttack(channelId, attacker.name);
    }
    await updateSummary(interaction.channel, enc);
  }

  // ─── /roll ───────────────────────────────────────────────────────
  // Both /roll and /r (the alias) come through here. Same options, same logic.
  else if (commandName === 'monstercast') {
    const channelId = interaction.channel.id;
    const encounter = combatV2State.getEncounter(channelId);
    const wantPublic = interaction.options.getBoolean('public') ?? true;
    if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter in this channel. Start one with `/init start`.', ephemeral: true });
    if (interaction.user.id !== encounter.gmId) return interaction.reply({ content: 'Only the GM can use `/m cast`.', ephemeral: true });

    const monsterName = interaction.options.getString('monster');
    const spellName = interaction.options.getString('spell');
    const targetName = interaction.options.getString('target');
    const levelOverride = interaction.options.getInteger('level');
    const dcOverride = interaction.options.getInteger('dc');
    const attackOverride = interaction.options.getInteger('attack_bonus');
    const manualDamage = interaction.options.getString('damage');
    const manualSave = interaction.options.getString('save');

    const actor = combatV2State.findCombatant(encounter, monsterName);
    if (!actor) return interaction.reply({ content: `No combatant named **"${monsterName}"** in combat v2.`, ephemeral: true });
    const target = targetName
      ? combatV2State.findCombatant(encounter, targetName)
      : encounter.combatants.find(c => c.id !== actor.id && c.hp > 0 && c.isNpc !== actor.isNpc);
    if (targetName && !target) return interaction.reply({ content: `No combatant named **"${targetName}"** in combat v2.`, ephemeral: true });

    const savedSpell = (actor.spells ?? []).find(s => s.name.toLowerCase() === spellName.toLowerCase())
      ?? (actor.spells ?? []).find(s => s.name.toLowerCase().includes(spellName.toLowerCase()));
    const rawSpell = findSpell(spellName);
    if (rawSpell?.ambiguous) return interaction.reply({ content: spellAmbiguityMessage(rawSpell), ephemeral: true });
    const spell = rawSpell ? normalizeSpell(rawSpell) : {
      name: savedSpell?.name ?? spellName,
      level: savedSpell?.rank ?? 1,
      type: 'Ability',
      traditions: [],
      isAttackSpell: attackOverride != null && !manualSave,
      savingThrow: manualSave,
      saveIsBasic: true,
      description: '',
    };

    const effectiveLevel = levelOverride ?? savedSpell?.rank ?? spell.level ?? 1;
    const dc = dcOverride ?? savedSpell?.dc ?? 10;
    const attackBonus = attackOverride ?? savedSpell?.attack ?? 0;
    const saveKey = manualSave ?? combatV2SaveKey(spell.savingThrow);
    const isAttack = spell.isAttackSpell || (attackOverride != null && !saveKey);
    const resolved = manualDamage
      ? { diceExpr: manualDamage, damageType: null, heightenedNote: '' }
      : resolveSpellDamage(spell, effectiveLevel);
    const damageRoll = resolved?.diceExpr ? rollCompoundExpression(resolved.diceExpr) : null;
    const damageType = resolved?.damageType ?? null;

    const lines = [];
    lines.push(`*${spell.type === 'Cantrip' ? `Cantrip ${effectiveLevel}` : spell.type === 'Ability' ? 'Ability' : `Rank ${effectiveLevel} spell`}*`);
    if (target) lines.push(`**Target** ${target.name}`);
    lines.push('');
    let appliedLine = null;

    if (isAttack) {
      const targetEffects = combatV2Rolls.effectTotals(target);
      const ac = target?.ac != null ? target.ac + targetEffects.ac : null;
      const result = combatV2Rolls.rollCheck({ actor, stat: attackBonus, dc: ac, label: 'Spell Attack', effectKind: 'attack' });
      lines.push('**Spell Attack**');
      lines.push(`1d20 (${result.die}) ${fmt(result.stat)}${result.effectBonus ? ` ${fmt(result.effectBonus)} effects` : ''} = **${result.total}**`);
      if (target && ac != null) lines.push(`vs AC ${ac}: **${combatV2DegreeLabel(result.degree)}**`);
      if (damageRoll && ['success', 'criticalSuccess'].includes(result.degree)) {
        const baseDamage = result.degree === 'criticalSuccess' ? damageRoll.total * 2 : damageRoll.total;
        const defended = target ? combatV2Rolls.applyDefenses(baseDamage, damageType, target) : { finalDamage: baseDamage, notes: [] };
        lines.push(`**Damage${result.degree === 'criticalSuccess' ? ' (crit x2)' : ''}** ${damageRoll.display} = **${defended.finalDamage}**${damageType ? ` ${damageType}` : ''}`);
        if (defended.notes.length) lines.push(`*${defended.notes.join(', ')}*`);
        if (target && defended.finalDamage > 0) {
          const beforeHp = target.hp;
          const applied = combatV2State.applyHp(channelId, target.name, -defended.finalDamage);
          appliedLine = `**${target.name}** took **${defended.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP`;
        }
      } else if (damageRoll) {
        lines.push('*No damage.*');
      }
    } else if (saveKey) {
      const saveLabels = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
      lines.push(`**${spell.saveIsBasic ? 'Basic ' : ''}${saveLabels[saveKey] ?? saveKey} Save DC ${dc}**`);
      const targetSave = target && saveKey ? combatV2SaveModifier(target, saveKey, interaction.guildId) : null;
      if (target && targetSave != null) {
        const result = combatV2Rolls.rollCheck({ actor: target, stat: targetSave, dc, label: `${saveLabels[saveKey]} Save`, effectKind: 'save' });
        lines.push(`${target.name}: 1d20 (${result.die}) ${fmt(result.stat)}${result.effectBonus ? ` ${fmt(result.effectBonus)} effects` : ''} = **${result.total}**`);
        lines.push(`**${combatV2DegreeLabel(result.degree)}**`);
        if (damageRoll) {
          const fullDamage = spell.saveIsBasic ? basicSaveDamage(damageRoll.total, combatV2LegacyDegree(result.degree)) : damageRoll.total;
          const defended = combatV2Rolls.applyDefenses(fullDamage, damageType, target);
          lines.push(`**Damage** ${damageRoll.display} -> **${defended.finalDamage}**${damageType ? ` ${damageType}` : ''}`);
          if (defended.notes.length) lines.push(`*${defended.notes.join(', ')}*`);
          if (defended.finalDamage > 0 && (spell.saveIsBasic || result.degree === 'failure' || result.degree === 'criticalFailure')) {
            const beforeHp = target.hp;
            const applied = combatV2State.applyHp(channelId, target.name, -defended.finalDamage);
            appliedLine = `**${target.name}** took **${defended.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP`;
          }
        }
      } else if (target) {
        lines.push(`${target.name}'s save bonus is not recorded.`);
      }
    } else if (damageRoll) {
      lines.push(`**Damage** ${damageRoll.display} = **${damageRoll.total}**${damageType ? ` ${damageType}` : ''}`);
    } else {
      lines.push('No attack, save, or damage data found. Add `dc` plus `save`, `attack_bonus`, or `damage` for custom abilities.');
    }

    if (resolved?.heightenedNote) lines.push(`*Heightened: ${resolved.heightenedNote}*`);
    if (spell.description && spell.description !== '*No description available.*') {
      lines.push('', spell.description.length > 300 ? `${spell.description.slice(0, 300)}...\n*Use \`/spell ${spell.name}\` for full details.*` : spell.description);
    }
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`${actor.name} casts ${spell.name}`)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setFooter({ text: `GM cast · Attack ${fmt(attackBonus)} · DC ${dc}` });
    await interaction.reply({ content: appliedLine ?? undefined, embeds: [embed], ephemeral: !wantPublic });
    await updateCombatV2Summary(interaction.channel, encounter);
    return;
  }

  else if (commandName === 'monsterattacks') {
    const channelId = interaction.channel.id;
    const encounter = combatV2State.getEncounter(channelId);
    const wantPublic = interaction.options.getBoolean('public') ?? true;
    if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter in this channel. Start one with `/init start`.', ephemeral: true });
    if (interaction.user.id !== encounter.gmId) return interaction.reply({ content: 'Only the GM can use `/m attacks`.', ephemeral: true });
    const monsterName = interaction.options.getString('monster');
    const actor = combatV2State.findCombatant(encounter, monsterName);
    if (!actor) return interaction.reply({ content: `No combatant named **"${monsterName}"** in combat v2.`, ephemeral: true });
    const attackText = combatV2AttackListText(actor);
    const spellLines = (actor.spells ?? []).map(s => {
      const rank = Number(s.rank) === 0 ? 'Cantrip' : `Rank ${s.rank}`;
      const dc = s.dc != null ? ` DC ${s.dc}` : '';
      const atk = s.attack != null ? ` attack ${fmt(s.attack)}` : '';
      return `• **${s.name}** (${rank}${dc}${atk})`;
    });
    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle(`${actor.name}'s Actions`)
      .addFields({ name: 'Attacks', value: attackText.slice(0, 1024), inline: false });
    if (spellLines.length) embed.addFields({ name: 'Spells', value: spellLines.join('\n').slice(0, 1024), inline: false });
    return interaction.reply({ embeds: [embed], ephemeral: !wantPublic });
  }

  else if (commandName === 'monsterability') {
    const channelId = interaction.channel.id;
    const encounter = combatV2State.getEncounter(channelId);
    const wantPublic = interaction.options.getBoolean('public') ?? true;
    if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter in this channel. Start one with `/init start`.', ephemeral: true });
    if (interaction.user.id !== encounter.gmId) return interaction.reply({ content: 'Only the GM can use `/m ability`.', ephemeral: true });

    const actorName = interaction.options.getString('monster');
    const abilityName = interaction.options.getString('name');
    const targetName = interaction.options.getString('target');
    const saveKey = combatV2SaveKey(interaction.options.getString('save'));
    const dc = interaction.options.getInteger('dc');
    const damageExpr = interaction.options.getString('damage');
    const damageType = interaction.options.getString('type');
    const isBasic = interaction.options.getBoolean('basic') ?? !!damageExpr;
    const notes = interaction.options.getString('notes');

    const actor = combatV2State.findCombatant(encounter, actorName);
    if (!actor) return interaction.reply({ content: `No combatant named **"${actorName}"** in combat v2.`, ephemeral: true });
    const target = combatV2State.findCombatant(encounter, targetName);
    if (!target) return interaction.reply({ content: `No combatant named **"${targetName}"** in combat v2.`, ephemeral: true });
    if (!saveKey) return interaction.reply({ content: 'Unknown save type.', ephemeral: true });
    const targetSave = combatV2SaveModifier(target, saveKey, interaction.guildId);
    if (targetSave == null) return interaction.reply({ content: `**${target.name}** does not have that save recorded.`, ephemeral: true });

    const saveLabels = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
    const result = combatV2Rolls.rollCheck({
      actor: target,
      stat: targetSave,
      dc,
      label: `${saveLabels[saveKey]} Save`,
      effectKind: 'save',
    });
    const lines = [
      `**Target** ${target.name}`,
      `**${saveLabels[saveKey]} Save DC ${dc}**`,
      `1d20 (${result.die}) ${fmt(result.stat)}${result.effectBonus ? ` ${fmt(result.effectBonus)} effects` : ''} = **${result.total}**`,
      `**${combatV2DegreeLabel(result.degree)}**`,
    ];

    let appliedLine = null;
    if (damageExpr) {
      const damageRoll = rollCompoundExpression(damageExpr);
      if (!damageRoll) return interaction.reply({ content: `Could not parse damage expression **${damageExpr}**.`, ephemeral: true });
      const scaledDamage = isBasic ? basicSaveDamage(damageRoll.total, combatV2LegacyDegree(result.degree)) : damageRoll.total;
      const defended = combatV2Rolls.applyDefenses(scaledDamage, damageType, target);
      lines.push('', `**Damage${isBasic ? ' (basic save)' : ''}** ${damageRoll.display} -> **${defended.finalDamage}**${damageType ? ` ${damageType}` : ''}`);
      if (defended.notes.length) lines.push(`*${defended.notes.join(', ')}*`);
      if (defended.finalDamage > 0 && (isBasic || result.degree === 'failure' || result.degree === 'criticalFailure')) {
        const beforeHp = target.hp;
        const applied = combatV2State.applyHp(channelId, target.name, -defended.finalDamage);
        appliedLine = `**${target.name}** took **${defended.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP`;
      }
    }
    if (notes) lines.push('', `**Effect Reminder** ${notes}`);

    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`${actor.name}: ${abilityName}`)
      .setDescription(lines.join('\n').slice(0, 4096));
    await interaction.reply({ content: appliedLine ?? undefined, embeds: [embed], ephemeral: !wantPublic });
    await updateCombatV2Summary(interaction.channel, encounter);
    return;
  }

  else if (commandName === 'roll' || commandName === 'r') {
    await rollCmd.execute(interaction);
  }


  // ─── /skill ──────────────────────────────────────────────────────
  else if (commandName === 'skill') {
    await skillCmd.execute(interaction);
  }

  // ─── /perception ─────────────────────────────────────────────────
  // Roll a Perception check (Wis + proficiency). Used for spotting things,
  // Seeking, resisting illusions, and by default for Initiative too.
  else if (commandName === 'perception') {
    await perceptionCmd.execute(interaction);
  }

  // ─── /initiative ─────────────────────────────────────────────────
  // Roll initiative. Defaults to Perception-based initiative (the PF2e
  // standard). Allows an optional `skill:` override (e.g. stealth for an
  // ambush, diplomacy for a social scene). Does NOT add you to an active
  // encounter — use /init add for that. This is just for rolling.
  else if (commandName === 'initiative') {
    await initiativeCmd.execute(interaction);
  }

  // ─── /save ───────────────────────────────────────────────────────
  else if (commandName === 'save') {
    await saveCmd.execute(interaction);
  }

  // ─── /ancestry ───────────────────────────────────────────────────
  else if (commandName === 'ancestry') {
    await ancestryCmd.execute(interaction);
  }

  // ─── /heritage ───────────────────────────────────────────────────
  else if (commandName === 'heritage') {
    await heritageCmd.execute(interaction);
  }

  // ─── /archetype ──────────────────────────────────────────────────
  else if (commandName === 'archetype') {
    await archetypeCmd.execute(interaction);
  }

  // ─── /background ─────────────────────────────────────────────────
  else if (commandName === 'background') {
    await backgroundCmd.execute(interaction);
  }

  // ─── /feat ───────────────────────────────────────────────────────
  else if (commandName === 'feat') {
    await featCmd.execute(interaction);
  }

  // ─── /item ───────────────────────────────────────────────────────
  else if (commandName === 'item') {
    await itemCmd.execute(interaction);
  }

  // ─── /rule ───────────────────────────────────────────────────────
  else if (REFERENCE_DATABASE_CONFIG[commandName]) {
    await interaction.deferReply();
    try {
    const input = interaction.options.getString('name');
    const { entry, matches, exactDuplicates, total } = findReference(commandName, input);
    const cfg = REFERENCE_DATABASE_CONFIG[commandName];

    if (entry) {
      return interaction.editReply({ embeds: [buildReferenceEmbed(commandName, entry)] });
    }

    if (matches && matches.length > 1) {
      const sorted = [...matches].sort((a, b) => a.name.localeCompare(b.name));
      const preview = sorted.slice(0, 20)
        .map(e => `• **${e.name}** *(${referenceCategoryLabel(e.category)}${e.source ? `, ${e.source}` : ''})*`)
        .join('\n');
      const extra = total && total > 20 ? `\n*...and ${total - 20} more. Try narrowing your search.*` : '';
      const header = exactDuplicates
        ? `🔍 Multiple ${cfg.label} share the exact name **"${input}"**:`
        : `🔍 Multiple ${cfg.label} match **"${input}"**. Did you mean one of these?`;
      return interaction.editReply({ content: `${header}\n${preview}${extra}` });
    }

    const names = (referenceDatabases[commandName] ?? []).map(e => e.name).filter(Boolean);
    const hint = didYouMeanLine(input, names);
    return interaction.editReply({
      content: `❌ No ${cfg.label.slice(0, -1) || 'entry'} found for **"${input}"**.${hint || ' Check your spelling or try another name.'}`,
    });
    } catch (err) {
      console.error(`/${commandName} reference lookup failed:`, err);
      return interaction.editReply('Sorry, that reference lookup failed while the bot was building the response. Please try again.');
    }
  }

  else if (commandName === 'rule') {
    await ruleCmd.execute(interaction);
  }

  // ─── /condition ──────────────────────────────────────────────────
  else if (commandName === 'condition') {
    await conditionCmd.execute(interaction);
  }

  // ─── /deity ──────────────────────────────────────────────────────
  else if (commandName === 'deity') {
    await deityCmd.execute(interaction);
  }

  // ─── /skillinfo ──────────────────────────────────────────────────
  // Rules-reference lookup for the 16 core PF2e Remaster skills. Pulls
  // the character's current modifier in when a character is loaded.
  // 3-page button nav: Overview / Actions / DCs & Examples.
  else if (commandName === 'eberron') {
    await eberronCmd.execute(interaction);
  }

  else if (commandName === 'skillinfo') {
    await skillinfoCmd.execute(interaction);
  }

  // ─── /class ──────────────────────────────────────────────────────
  else if (commandName === 'class') {
    await classCmd.execute(interaction);
  }

  // ─── /companion ──────────────────────────────────────────────────
  else if (commandName === 'companion') {
    await companionCmd.execute(interaction);
  }

  // ─── /monster ────────────────────────────────────────────────────
  else if (commandName === 'hunt') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') {
      const trait = interaction.options.getString('trait');
      const partyLevel = interaction.options.getInteger('level');
      const players = interaction.options.getInteger('players');
      const difficulty = interaction.options.getString('difficulty') ?? 'moderate';
      const allowedSkills = HUNT_CREATURE_SKILLS[trait] ?? ['Nature'];
      const skill = interaction.options.getString('skill') ?? allowedSkills[0];
      if (!allowedSkills.includes(skill)) {
        return interaction.reply({ content: `For **${trait}** hunts, use: ${allowedSkills.join(', ')}.`, ephemeral: true });
      }
      const modifier = interaction.options.getInteger('bonus');
      const { candidates, targetLevel } = findHuntCandidates({ trait, partyLevel, players, difficulty });
      if (!candidates.length) {
        return interaction.reply({
          content: `No ${trait} creatures found around creature level ${targetLevel}. Try a different trait, party level, or difficulty.`,
          ephemeral: true,
        });
      }
      const monster = candidates[Math.floor(Math.random() * candidates.length)];
      const level = huntMonsterLevel(monster) ?? targetLevel;
      const dc = huntDcByLevel(level);
      const roll = rollD20Plus(modifier);
      const degree = huntDegree(roll.total, roll.roll, dc);
      return interaction.reply({
        embeds: [buildHuntEmbed({
          monster, trait, skill, modifier, roll, total: roll.total, dc, degree,
          targetLevel: partyLevel, players, difficulty,
        })],
      });
    }
  }

  else if (commandName === 'harvest') {
    const input = interaction.options.getString('creature');
    const modifier = interaction.options.getInteger('bonus');
    const { monster, matches, total } = findMonster(input);
    if (!monster) {
      if (matches?.length) {
        const preview = matches.slice(0, 20).map(n => `• **${n}**`).join('\n');
        const extra = (total ?? matches.length) > 20 ? `\n*...and ${(total ?? matches.length) - 20} more. Try narrowing your search.*` : '';
        return interaction.reply({ content: `Multiple creatures match **"${input}"**:\n${preview}${extra}`, ephemeral: true });
      }
      return interaction.reply({ content: `No creature found for **${input}**.`, ephemeral: true });
    }
    const traits = huntMonsterTraits(monster);
    const trait = traits.find(t => HUNT_CREATURE_SKILLS[t]) ?? 'animal';
    const allowedSkills = HUNT_CREATURE_SKILLS[trait] ?? ['Nature'];
    const skill = interaction.options.getString('skill') ?? allowedSkills[0];
    if (!allowedSkills.includes(skill)) {
      return interaction.reply({ content: `For **${trait}** harvesting, use: ${allowedSkills.join(', ')}.`, ephemeral: true });
    }
    const level = huntMonsterLevel(monster) ?? 0;
    const dc = huntDcByLevel(level);
    const roll = rollD20Plus(modifier);
    const degree = huntDegree(roll.total, roll.roll, dc);
    return interaction.reply({
      embeds: [buildHarvestEmbed({ monster, trait, skill, modifier, roll, total: roll.total, dc, degree })],
    });
  }

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
      content: (() => {
        const _names = Object.values(bestiaryDatabase).map(c => c?.name).filter(Boolean);
        const _hint = didYouMeanLine(input, _names);
        return `❌ No creature found for **"${input}"**.${_hint || ' Check your spelling or try another name.'}`;
      })(),
      ephemeral: true,
    });
  }

  // ─── /monsteradd ─────────────────────────────────────────────────
  // Owner-only. Parses a pasted Archives-of-Nethys stat block (or one attached
  // as a .txt file) and inserts it into the global bestiary.json so it shows
  // up in /monster for everyone. Also supports `remove` to roll back mistakes.
  else if (commandName === 'monsteradd') {
    await monsteraddCmd.execute(interaction);
  }

  // ─── /spelladd ────────────────────────────────────────────────────────────
  // Owner-only. Parses a pasted statblock (or attached .txt) and appends it to
  // spells.json so it shows up in /spell and autocomplete for everyone.
  else if (commandName === 'spelladd') {
    await spelladdCmd.execute(interaction);
  }

  // ─── /itemadd ─────────────────────────────────────────────────────────────
  // Owner-only. Same shape as /spelladd, for items.
  else if (commandName === 'itemadd') {
    await itemaddCmd.execute(interaction);
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
      await saveMonsterArt(store);

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
      await saveMonsterArt(store);
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

  // ─── /monsterroll ────────────────────────────────────────────────
  // Roll saves and skills for a monster — works whether they're in an active
  // encounter or not. GM-only (in DMs anywhere; in a server only the encounter
  // GM if there's an active encounter, else any GM-permission user).
  //
  // Subcommands:
  //   /monsterroll save monster:<name> save:<fort/ref/will> [dc:<n>]
  //   /monsterroll skill monster:<name> skill:<name> [dc:<n>]
  //
  // Resolution priority for finding the monster's modifier:
  //   1. If `monster` matches an active combatant → use the combatant's
  //      bestiaryKey (so init effects/edits flow through).
  //   2. Else look up directly in the bestiary by name.
  //
  // Replies are EPHEMERAL by default (only the GM sees the roll) so monster
  // mod values don't leak. Use the `public:true` flag to broadcast results.
  else if (commandName === 'monsterroll') {
    const sub = interaction.options.getSubcommand();
    const monsterInput = interaction.options.getString('monster');
    const dc = interaction.options.getInteger('dc'); // optional
    const wantPublic = interaction.options.getBoolean('public') ?? true;
    const guildId = interaction.guildId;
    const channelId = interaction.channel?.id;
    const v2Encounter = channelId ? combatV2State.getEncounter(channelId) : null;
    if (v2Encounter) {
      if (interaction.user.id !== v2Encounter.gmId) {
        return interaction.reply({ content: 'Only the GM can roll for monsters in active combat v2.', ephemeral: true });
      }
      const combatant = combatV2State.findCombatant(v2Encounter, monsterInput);
      if (!combatant) return interaction.reply({ content: `No combatant named **"${monsterInput}"** in combat v2.`, ephemeral: true });

      if (sub === 'save') {
        const saveKey = combatV2SaveKey(interaction.options.getString('save'));
        const saveLabels = { fort: 'Fortitude Save', ref: 'Reflex Save', will: 'Will Save' };
        const stat = combatV2SaveModifier(combatant, saveKey, interaction.guildId);
        if (stat == null) return interaction.reply({ content: `**${combatant.name}** does not have a ${saveLabels[saveKey] ?? 'save'} modifier recorded.`, ephemeral: true });
        const result = combatV2Rolls.rollCheck({ actor: combatant, stat: Number(stat), dc, label: saveLabels[saveKey], effectKind: 'save' });
        return interaction.reply({ embeds: [combatV2CheckEmbed(combatant, result)], ephemeral: !wantPublic });
      }

      if (sub === 'skill') {
        const skillName = interaction.options.getString('skill');
        const skill = combatV2FindSkill(combatant, skillName);
        if (!skill) {
          const available = Object.keys(combatant.skills ?? {}).slice(0, 20).join(', ') || 'none';
          return interaction.reply({ content: `No skill matching **"${skillName}"** found for **${combatant.name}**. Available: ${available}.`, ephemeral: true });
        }
        const result = combatV2Rolls.rollCheck({ actor: combatant, stat: skill.modifier, dc, label: `${skill.label} Check`, effectKind: 'skill' });
        return interaction.reply({ embeds: [combatV2CheckEmbed(combatant, result)], ephemeral: !wantPublic });
      }
    }

    // Find the monster's data. First check active encounter for a combatant
    // by that name (so init effects + GM edits apply), then fall back to
    // the raw bestiary.
    const enc = channelId ? getEncounter(channelId) : null;
    let combatant = null;
    if (enc) {
      combatant = enc.combatants.find(c => c.name.toLowerCase() === monsterInput.toLowerCase()) || null;
    }

    // GM gate: if there's an encounter, only the GM can roll. Otherwise allow
    // anyone with Manage Channels (consistent with /weather, /calendar).
    if (enc && interaction.user.id !== enc.gmId) {
      return interaction.reply({ content: '❌ Only the encounter GM can roll for monsters in active combat.', ephemeral: true });
    }

    // Resolve to a bestiary monster. If we have a combatant with bestiaryKey,
    // use that — it's the canonical name. Otherwise look up by raw input.
    const lookupName = combatant?.bestiaryKey ?? monsterInput;
    const { monster, matches } = findMonster(lookupName);
    if (!monster) {
      if (matches && matches.length > 1) {
        const preview = matches.slice(0, 5).map(n => `• **${n}**`).join('\n');
        return interaction.reply({ content: `🔍 Multiple matches for **"${monsterInput}"**:\n${preview}`, ephemeral: true });
      }
      return interaction.reply({ content: `❌ No creature named **"${monsterInput}"** found in the bestiary or encounter.`, ephemeral: true });
    }

    // Apply per-guild edits + attack library overlay (matches /init addmonster pipeline)
    const edits = guildId ? getMonsterEdit(guildId, monster.name) : null;
    const edited = applyMonsterEdits(monster, edits);
    const finalMonster = guildId ? applyMonsterAttackLibrary(edited, guildId) : edited;
    const rich = finalMonster.rich ?? null;
    const core = finalMonster.core ?? {};
    const summary = finalMonster.summary?.summary ?? {};

    // ── /monsterroll save ────────────────────────────────────────────
    if (sub === 'save') {
      const saveType = interaction.options.getString('save'); // 'fort' | 'ref' | 'will'
      const normalized = saveType.startsWith('fort') ? 'fort'
                       : saveType.startsWith('ref')  ? 'ref'
                       : saveType.startsWith('will') ? 'will'
                       : null;
      if (!normalized) return interaction.reply({ content: `❌ Unknown save: ${saveType}`, ephemeral: true });

      // Pull the modifier — try core, then summary, then rich.defenses.
      const saveMap = { fort: ['fort', 'fortitude'], ref: ['ref', 'reflex'], will: ['will'] };
      const richKey = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' }[normalized];
      const saveLabel = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' }[normalized];
      let modifier = null;
      for (const k of saveMap[normalized]) {
        if (core?.saves?.[k] != null) { modifier = core.saves[k]; break; }
        if (summary?.[k] != null) { modifier = summary[k]; break; }
      }
      if (modifier == null && rich?.defenses?.saves?.[richKey] != null) {
        modifier = rich.defenses.saves[richKey];
      }
      if (modifier == null) {
        return interaction.reply({ content: `❌ **${monster.name}** has no ${saveLabel} save listed in the bestiary.`, ephemeral: true });
      }

      // If this is a combatant, apply effect modifiers (frightened etc.)
      let effectBonus = 0;
      if (combatant) {
        const mods = sumEffectModifiers(combatant);
        // Generic save bonus from effects, if any
        effectBonus = mods.saveBonus ?? 0;
      }
      const r = rollD20Plus(modifier + effectBonus);
      const totalModifier = modifier + effectBonus;

      // Build the breakdown using the shared formatter so monster rolls look
      // identical to character rolls (1d20 (X) + Y = **Z**, with crit/fumble
      // emoji on natural 20/1). When effects bumped the modifier, surface
      // that on its own line so the GM can see where the bonus came from.
      let breakdown = formatRollBreakdown(r.roll, totalModifier, 0, r.total, 20);
      if (effectBonus !== 0) {
        breakdown += `\n*base ${fmt(modifier)}, effects ${fmt(effectBonus)}*`;
      }
      if (dc != null) {
        const degree = determineDegreeOfSuccess(r.total, r.roll, dc);
        const degreeNames = { 'crit-success': '⭐ Critical Success', 'success': '✅ Success', 'failure': '❌ Failure', 'crit-failure': '💀 Critical Failure' };
        breakdown += `\nvs DC ${dc}: **${degreeNames[degree] ?? degree}**`;
      }

      // Monster art (per-guild override) if set, so the embed has a portrait
      // matching the rest of the bot's roll style.
      const art = guildId ? lookupMonsterArt(guildId, monster) : null;

      const embed = buildRollEmbed({
        title: `🛡️ ${monster.name} rolls a ${saveLabel} save!`,
        breakdown,
        charName: `${monster.name} · ${saveLabel} ${fmt(totalModifier)}`,
        thumbnail: art,
      });
      // Override the default purple to a deep red — that's the established
      // monster/threat color used throughout /monster, /mattack, etc.
      embed.setColor(0x8B0000);
      return interaction.reply({ embeds: [embed], ephemeral: !wantPublic });
    }

    // ── /monsterroll skill ───────────────────────────────────────────
    if (sub === 'skill') {
      const skillInput = interaction.options.getString('skill').trim();
      const skillQuery = skillInput.toLowerCase();
      const isPerceptionRoll = ['perception', 'initiative', 'init'].includes(skillQuery);

      if (isPerceptionRoll) {
        const modifier = core.perception ?? summary.perception ?? rich?.perception ?? null;
        if (modifier == null) {
          return interaction.reply({ content: `❌ **${monster.name}** has no Perception modifier listed in the bestiary.`, ephemeral: true });
        }

        let effectBonus = 0;
        if (combatant) {
          const mods = sumEffectModifiers(combatant);
          effectBonus = mods.perceptionBonus ?? mods.skillBonus ?? 0;
        }
        const totalModifier = Number(modifier) + effectBonus;
        const r = rollD20Plus(totalModifier);

        let breakdown = formatRollBreakdown(r.roll, totalModifier, 0, r.total, 20);
        if (effectBonus !== 0) {
          breakdown += `\n*base ${fmt(Number(modifier))}, effects ${fmt(effectBonus)}*`;
        }
        if (dc != null) {
          const degree = determineDegreeOfSuccess(r.total, r.roll, dc);
          const degreeNames = { 'crit-success': '⭐ Critical Success', 'success': '✅ Success', 'failure': '❌ Failure', 'crit-failure': '💀 Critical Failure' };
          breakdown += `\nvs DC ${dc}: **${degreeNames[degree] ?? degree}**`;
        }

        const art = guildId ? lookupMonsterArt(guildId, monster) : null;
        const label = skillQuery === 'perception' ? 'Perception' : 'Initiative';
        const embed = buildRollEmbed({
          title: `👁️ ${monster.name} rolls ${label}!`,
          breakdown,
          charName: `${monster.name} · Perception ${fmt(totalModifier)}`,
          thumbnail: art,
        });
        embed.setColor(0x8B0000);
        return interaction.reply({ embeds: [embed], ephemeral: !wantPublic });
      }

      // Skills come from rich.skills as { "Athletics": 8, "Stealth": 5 }.
      // Match case-insensitively + allow partial.
      const skillsObj = rich?._skillTotals ?? rich?.skills ?? {};
      const skillKeys = Object.keys(skillsObj);
      if (skillKeys.length === 0) {
        return interaction.reply({ content: `❌ **${monster.name}** has no skills listed in the bestiary.`, ephemeral: true });
      }
      const q = skillInput.toLowerCase();
      const exact = skillKeys.find(k => k.toLowerCase() === q);
      const partial = skillKeys.filter(k => k.toLowerCase().includes(q));
      let chosenKey = exact;
      if (!chosenKey && partial.length === 1) chosenKey = partial[0];
      if (!chosenKey) {
        if (partial.length > 1) {
          return interaction.reply({ content: `🔍 Multiple skills match "${skillInput}": ${partial.join(', ')}`, ephemeral: true });
        }
        return interaction.reply({ content: `❌ **${monster.name}** has no **${skillInput}**. Available: ${skillKeys.join(', ')}`, ephemeral: true });
      }
      const modifier = skillsObj[chosenKey];

      // Effect modifiers (e.g. clumsy, enfeebled — though we don't differentiate by skill yet)
      let effectBonus = 0;
      if (combatant) {
        const mods = sumEffectModifiers(combatant);
        effectBonus = mods.skillBonus ?? 0;
      }
      const r = rollD20Plus(modifier + effectBonus);
      const totalModifier = modifier + effectBonus;

      let breakdown = formatRollBreakdown(r.roll, totalModifier, 0, r.total, 20);
      if (effectBonus !== 0) {
        breakdown += `\n*base ${fmt(modifier)}, effects ${fmt(effectBonus)}*`;
      }
      if (dc != null) {
        const degree = determineDegreeOfSuccess(r.total, r.roll, dc);
        const degreeNames = { 'crit-success': '⭐ Critical Success', 'success': '✅ Success', 'failure': '❌ Failure', 'crit-failure': '💀 Critical Failure' };
        breakdown += `\nvs DC ${dc}: **${degreeNames[degree] ?? degree}**`;
      }

      const art = guildId ? lookupMonsterArt(guildId, monster) : null;

      const embed = buildRollEmbed({
        title: `🎯 ${monster.name} attempts ${chosenKey}!`,
        breakdown,
        charName: `${monster.name} · ${chosenKey} ${fmt(totalModifier)}`,
        thumbnail: art,
      });
      embed.setColor(0x8B0000);
      return interaction.reply({ embeds: [embed], ephemeral: !wantPublic });
    }

    return interaction.reply({ content: `Unknown subcommand: ${sub}`, ephemeral: true });
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

      await saveMonsterEdits(store);
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
      await saveMonsterEdits(store);
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
      await saveMonsterEdits(store);
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
      await saveMonsterEdits(store);
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
      await saveMonsterEdits(store);
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
      await saveMonsterEdits(store);
      return interaction.reply({ content: `✅ Set **${which.toUpperCase()}** ${value >= 0 ? '+' : ''}${value} on **${displayName}**.`, ephemeral: true });
    }

    // ── description: set the flavor text shown under the title ──
    if (sub === 'description') {
      const monsterInput = interaction.options.getString('monster');
      const description = interaction.options.getString('description').trim();
      const displayName = resolveName(monsterInput);
      const { store, entry } = ensureMonsterEdit(guildId, displayName, interaction.user.id);
      entry.description = description;
      await saveMonsterEdits(store);
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
      await saveMonsterEdits(store);
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
      await saveMonsterEdits(store);
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
      await saveMonsterEdits(store);
      return interaction.reply({ content: `🗑️ Wiped all edits for **${displayName}**.`, ephemeral: true });
    }
  }

  // ─── /bag ────────────────────────────────────────────────────────
  else if (commandName === 'bag') {
    await bagCmd.execute(interaction);
  }

  // ─── /gold ───────────────────────────────────────────────────────
  else if (commandName === 'gold') {
    await goldCmd.execute(interaction);
  }

  // ─── /hero ───────────────────────────────────────────────────────
  else if (commandName === 'hero') {
    await heroCmd.execute(interaction);
  }

  // ─── /hp ─────────────────────────────────────────────────────────
  // Out-of-combat HP tracking. Persists on charEntry.hp (bot-managed overlay),
  // clamped to [0, maxHp]. In-combat HP uses /init hp instead (tracked on the
  // combatant, not the character entry). This command is for between-combat
  // use: setting HP after a fight that wasn't tracked, healing over time, etc.
  else if (commandName === 'hp') {
    await hpCmd.execute(interaction);
  }

  // ─── /xp ─────────────────────────────────────────────────────────
  // Per-character XP tracking. GM manually awards; bot auto-detects
  // level-up thresholds (every 1000 XP) and prompts to level up in
  // Pathbuilder. Bot never edits sheet data directly.
  else if (commandName === 'xp') {
    await xpCmd.execute(interaction);
  }

  // ─── /notes ──────────────────────────────────────────────────────
  // Per-character session notebook. Categorized (NPCs/Locations/Plot Threads/
  // Influence/Items). Only the character's owner can add/edit/remove/pin;
  // anyone can view/search/list.
  else if (commandName === 'notes') {
    await notesCmd.execute(interaction);
  }

  // ─── /init ───────────────────────────────────────────────────────
  else if (commandName === 'i') {
    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;
    const encounter = combatV2State.getEncounter(channelId);

    if (sub === 'join') {
      if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter here. Ask the GM to use `/init start`.', ephemeral: true });
      await interaction.deferReply();
      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
      if (error) return interaction.editReply(error);
      const c = charEntry.data;
      if (combatV2HasName(encounter, c.name)) return interaction.editReply(`**${c.name}** is already in combat.`);
      const maxHp = computeCharMaxHp(charEntry);
      const initMod = interaction.options.getInteger('bonus') ?? computeCharPerception(charEntry);
      const rolled = combatV2Initiative(initMod, interaction.options.getInteger('result'));
      const { combatant } = combatV2State.addCombatant(channelId, {
        name: c.name,
        type: 'pc',
        isNpc: false,
        hidden: false,
        initiative: rolled.initiative,
        hp: charEntry.hp ?? maxHp,
        maxHp,
        ac: c.acTotal?.acTotal ?? null,
        ownerId: userId,
        attacks: combatV2CharacterAttacks(charEntry),
        saves: {
          fort: combatV2CharacterSave(c, 'fortitude'),
          ref: combatV2CharacterSave(c, 'reflex'),
          will: combatV2CharacterSave(c, 'will'),
        },
        skills: combatV2CharacterSkills(charEntry),
      });
      let warning = '';
      try {
        await updateCombatV2Summary(interaction.channel, encounter);
      } catch (err) {
        console.error('combat v2 join summary update failed:', err);
        warning = '\n⚠️ Joined, but I could not update the pinned combat tracker. Check my channel permissions.';
      }
      return interaction.editReply(`**${combatant.name}** joined combat at **${combatant.initiative}** ${rolled.text}.${warning}`);
    }

    if (sub === 'attacks') {
      const actorName = interaction.options.getString('actor');
      const actor = encounter ? combatV2PickActor(encounter, userId, actorName) : null;
      if (actor) {
        if (userId !== encounter.gmId && actor.ownerId !== userId) return interaction.reply({ content: 'You can only list attacks for your own combatant.', ephemeral: true });
        const embed = new EmbedBuilder().setColor(0x8b0000).setTitle(`${actor.name}'s Attacks`).setDescription(combatV2AttackListText(actor));
        return interaction.reply({ embeds: [embed], ephemeral: actor.hidden && userId === encounter.gmId });
      }

      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(userId, null, characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      const pseudo = { name: charEntry.data.name, attacks: combatV2CharacterAttacks(charEntry) };
      const embed = new EmbedBuilder().setColor(0x8b0000).setTitle(`${pseudo.name}'s Attacks`).setDescription(combatV2AttackListText(pseudo));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'reaction') {
      if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter here.', ephemeral: true });
      const actorName = interaction.options.getString('actor');
      const reason = interaction.options.getString('reason') ?? 'reaction';
      const actor = combatV2PickActor(encounter, userId, actorName);
      if (!actor) return interaction.reply({ content: 'I could not find exactly one combatant you control. Use `actor:` to choose one.', ephemeral: true });
      if (userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'You can only mark reactions for your own combatant.', ephemeral: true });
      }
      if (actor.hasReaction === false) return interaction.reply({ content: `**${actor.name}** does not have reactions enabled.`, ephemeral: true });
      if (actor.reactionUsed) return interaction.reply({ content: `**${actor.name}** has already used their reaction this round.`, ephemeral: true });
      actor.reactionUsed = true;
      encounter.updatedAt = new Date().toISOString();
      encounter.log.push({ at: encounter.updatedAt, kind: 'reaction', name: actor.name, reason });
      await updateCombatV2Summary(interaction.channel, encounter);
      return interaction.reply(`**${actor.name}** used their reaction: ${reason}.`);
    }

    if (sub === 'hp') {
      const actorName = interaction.options.getString('actor');
      const change = interaction.options.getInteger('change');
      const setValue = interaction.options.getInteger('set');
      if (change == null && setValue == null) return interaction.reply({ content: 'Use either `change:` or `set:`.', ephemeral: true });
      if (change != null && setValue != null) return interaction.reply({ content: 'Use only one of `change:` or `set:`.', ephemeral: true });

      const actor = encounter ? combatV2PickActor(encounter, userId, actorName) : null;
      if (actor) {
        if (userId !== encounter.gmId && actor.ownerId !== userId) {
          return interaction.reply({ content: 'You can only modify HP for your own combatant.', ephemeral: true });
        }
        const result = setValue != null
          ? combatV2State.applyHp(channelId, actor.name, setValue, { mode: 'set' })
          : combatV2State.applyHp(channelId, actor.name, change);
        await updateCombatV2Summary(interaction.channel, result.encounter);
        return interaction.reply({
          content: `**${result.combatant.name}** HP: ${result.before.hp}/${result.combatant.maxHp} -> **${result.combatant.hp}/${result.combatant.maxHp}**${result.combatant.tempHp ? ` (${result.combatant.tempHp} temp)` : ''}${combatDyingSuffix(result)}`,
          ...(combatDeathPayload(result) ?? {}),
        });
      }

      const characters = loadCharacters();
      const { error, charKey, char: charEntry } = resolveChar(userId, null, characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      const oldHp = getCharacterHp(charEntry);
      const newHp = setCharacterHp(charEntry, setValue != null ? setValue : oldHp + change);
      characters[userId][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ embeds: [buildCharHpEmbed(charEntry.data, charEntry, `HP: ${oldHp} -> **${newHp}**.`)] });
    }

    if (sub === 'thp') {
      const amount = interaction.options.getInteger('amount');
      if (!encounter) return interaction.reply({ content: 'Temporary HP is currently tracked on combat v2 combatants. Start/join initiative first.', ephemeral: true });
      const actorName = interaction.options.getString('actor');
      const actor = combatV2PickActor(encounter, userId, actorName);
      if (!actor) return interaction.reply({ content: 'I could not find exactly one combatant you control. Use `actor:` to choose one.', ephemeral: true });
      if (userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'You can only set temp HP for your own combatant.', ephemeral: true });
      }
      const result = combatV2State.setTempHp(channelId, actor.name, amount);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return interaction.reply(`**${result.combatant.name}** temp HP: ${result.before} -> **${result.combatant.tempHp}**.`);
    }

    if (sub === 'effect') {
      if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter here.', ephemeral: true });
      const actorName = interaction.options.getString('actor');
      const actor = combatV2PickActor(encounter, userId, actorName);
      if (!actor) return interaction.reply({ content: 'I could not find exactly one combatant you control. Use `actor:` to choose one.', ephemeral: true });
      if (userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'You can only view effects for your own combatant.', ephemeral: true });
      }
      const lines = (actor.effects ?? []).map(e => {
        const value = e.value != null ? ` ${e.value}` : '';
        const durationText = e.duration != null ? ` (${e.duration} rounds)` : '';
        const desc = e.modifiers?.description ? ` - ${e.modifiers.description}` : '';
        return `• **${e.name}${value}**${durationText}${desc}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`${actor.name}'s Effects`)
        .setDescription(lines.length ? lines.join('\n') : 'No active effects.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'remove') {
      if (!encounter) return interaction.reply({ content: 'No active combat v2 encounter here.', ephemeral: true });
      const actorName = interaction.options.getString('actor');
      const actor = combatV2PickActor(encounter, userId, actorName);
      if (!actor) return interaction.reply({ content: 'I could not find exactly one combatant you control. Use `actor:` to choose one.', ephemeral: true });
      if (userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'You can only remove your own combatant.', ephemeral: true });
      }
      const result = combatV2State.removeCombatant(channelId, actor.name);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return interaction.reply(`Removed **${result.combatant.name}** from combat.`);
    }

    if (sub === 'attack') {
      const attackName = interaction.options.getString('name');
      const targetName = interaction.options.getString('target');
      const count = interaction.options.getInteger('n') ?? 1;
      const bonus = interaction.options.getInteger('bonus') ?? 0;
      const mapOverride = interaction.options.getInteger('map');

      let actor = encounter ? combatV2PickActor(encounter, userId, null) : null;
      let target = encounter ? combatV2PickTarget(encounter, actor, targetName) : null;
      const inCombat = !!actor;
      let thumbnail = null;

      if (actor && userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'It is not your combatant. Use `/init view` to check the tracker.', ephemeral: true });
      }

      // Resolve the attacker's portrait. For an in-encounter combatant, walk
      // the owner's characters/companions to find the matching entry. For an
      // ad-hoc actor (no active encounter), the charEntry we just loaded has
      // it directly.
      if (actor) {
        const characters = loadCharacters();
        const match = findCharacterEntryForCombatant(characters, actor);
        thumbnail = match?.companion?.art ?? match?.char?.art ?? null;
      }

      if (!actor) {
        const characters = loadCharacters();
        const { error, char: charEntry } = resolveChar(userId, null, characters);
        if (error) return interaction.reply({ content: error, ephemeral: true });
        thumbnail = charEntry.art ?? null;
        actor = {
          id: `char-${userId}`,
          name: charEntry.data.name,
          ownerId: userId,
          isNpc: false,
          hp: charEntry.hp ?? computeCharMaxHp(charEntry),
          maxHp: computeCharMaxHp(charEntry),
          ac: charEntry.data.acTotal?.acTotal ?? null,
          attacks: combatV2CharacterAttacks(charEntry),
          saves: {
            fort: combatV2CharacterSave(charEntry.data, 'fortitude'),
            ref: combatV2CharacterSave(charEntry.data, 'reflex'),
            will: combatV2CharacterSave(charEntry.data, 'will'),
          },
          skills: combatV2CharacterSkills(charEntry),
          effects: [],
          attacksThisTurn: 0,
        };
        target = null;
      }

      const attack = combatV2FindAttack(actor, attackName);
      if (!attack) return interaction.reply({ content: `No attack ${attackName ? `matching **"${attackName}" ` : ''}found for **${actor.name}**.\n${combatV2AttackListText(actor)}`, ephemeral: true });
      if (targetName && !target) return interaction.reply({ content: `No target named **"${targetName}"** in combat.`, ephemeral: true });

      const results = combatV2Rolls.rollAttack({ attacker: actor, target, attack, bonus, map: mapOverride, count });
      const embeds = [];
      const hpLines = [];
      const deathEmbeds = [];
      for (const result of results) {
        const embed = combatV2Render.renderAttackResult(result).setTitle(`${actor.name} attacks with ${attack.name}`);
        if (thumbnail) embed.setThumbnail(thumbnail);
        else if (PATHWAY_DICE_BUFFER) embed.setThumbnail(PATHWAY_DICE_REF);
        embeds.push(embed);
        if (inCombat && target && ['success', 'criticalSuccess'].includes(result.degree) && result.finalDamage > 0) {
          const beforeHp = target.hp;
          const applied = combatV2State.applyHp(channelId, target.name, -result.finalDamage);
          hpLines.push(`**${target.name}** took **${result.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP${combatDyingSuffix(applied)}`);
          const deathPayload = combatDeathPayload(applied);
          if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
          if (applied.died) break;
        }
      }
      if (inCombat && mapOverride === null) actor.attacksThisTurn = (actor.attacksThisTurn ?? 0) + count;
      if (inCombat) await updateCombatV2Summary(interaction.channel, encounter);
      return interaction.reply({
        content: hpLines.length ? hpLines.join('\n') : undefined,
        embeds: embeds.concat(deathEmbeds).slice(0, 10),
        files: rollFallbackFiles(thumbnail),
      });
    }

    if (sub === 'save') {
      const saveKey = interaction.options.getString('name');
      const dc = interaction.options.getInteger('dc');
      const bonus = interaction.options.getInteger('bonus') ?? 0;
      let actor = encounter ? combatV2PickActor(encounter, userId, null) : null;
      let thumbnail = null;

      if (actor && userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'It is not your combatant. Use `/init view` to check the tracker.', ephemeral: true });
      }

      if (!actor) {
        const characters = loadCharacters();
        const { error, char: charEntry } = resolveChar(userId, null, characters);
        if (error) return interaction.reply({ content: error, ephemeral: true });
        thumbnail = charEntry.art ?? null;
        actor = {
          name: charEntry.data.name,
          ownerId: userId,
          saves: {
            fort: combatV2CharacterSave(charEntry.data, 'fortitude'),
            ref: combatV2CharacterSave(charEntry.data, 'reflex'),
            will: combatV2CharacterSave(charEntry.data, 'will'),
          },
          effects: [],
        };
      }

      const saveLabels = { fort: 'Fortitude Save', ref: 'Reflex Save', will: 'Will Save' };
      const stat = combatV2SaveModifier(actor, saveKey, interaction.guildId);
      if (stat == null) return interaction.reply({ content: `**${actor.name}** does not have a ${saveLabels[saveKey] ?? saveKey} modifier recorded.`, ephemeral: true });
      const result = combatV2Rolls.rollCheck({ actor, stat: Number(stat), dc, bonus, label: saveLabels[saveKey] ?? 'Save', effectKind: 'save' });
      return interaction.reply({ embeds: [combatV2CheckEmbed(actor, result, thumbnail)], files: rollFallbackFiles(thumbnail) });
    }

    if (sub === 'skill') {
      const skillName = interaction.options.getString('name');
      const dc = interaction.options.getInteger('dc');
      const bonus = interaction.options.getInteger('bonus') ?? 0;
      let actor = encounter ? combatV2PickActor(encounter, userId, null) : null;
      let thumbnail = null;

      if (actor && userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.reply({ content: 'It is not your combatant. Use `/init view` to check the tracker.', ephemeral: true });
      }

      if (!actor) {
        const characters = loadCharacters();
        const { error, char: charEntry } = resolveChar(userId, null, characters);
        if (error) return interaction.reply({ content: error, ephemeral: true });
        thumbnail = charEntry.art ?? null;
        actor = {
          name: charEntry.data.name,
          ownerId: userId,
          skills: combatV2CharacterSkills(charEntry),
          effects: [],
        };
      }

      const skill = combatV2FindSkill(actor, skillName);
      if (!skill) {
        const available = Object.keys(actor.skills ?? {}).slice(0, 20).join(', ') || 'none';
        return interaction.reply({ content: `No skill matching **"${skillName}"** found for **${actor.name}**. Available: ${available}.`, ephemeral: true });
      }
      const result = combatV2Rolls.rollCheck({ actor, stat: skill.modifier, dc, bonus, label: `${skill.label} Check`, effectKind: 'skill' });
      return interaction.reply({ embeds: [combatV2CheckEmbed(actor, result, thumbnail)], files: rollFallbackFiles(thumbnail) });
    }

    if (sub === 'cast') {
      await interaction.deferReply();
      const spellName = interaction.options.getString('spell');
      const castLevel = interaction.options.getInteger('level');
      const targetName = interaction.options.getString('target');
      const casterName = interaction.options.getString('caster');
      const bonus = interaction.options.getInteger('bonus') ?? 0;

      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(userId, null, characters);
      if (error) return interaction.editReply(error);

      const rawSpell = findSpell(spellName);
      if (rawSpell?.ambiguous) return interaction.editReply(spellAmbiguityMessage(rawSpell));
      if (!rawSpell) return interaction.editReply(`Couldn't find a spell called **${spellName}**.`);
      const spell = normalizeSpell(rawSpell);
      charOverlay.ensureOverlay(charEntry);
      const casterStats = combatV2CasterStats(charEntry, spell, casterName);
      if (!casterStats.caster) return interaction.editReply(`**${charEntry.data.name}** does not have a spellcaster entry configured.`);

      let actor = encounter ? combatV2PickActor(encounter, userId, null) : null;
      let target = encounter ? combatV2PickTarget(encounter, actor, targetName) : null;
      const inCombat = !!actor;
      if (actor && userId !== encounter.gmId && actor.ownerId !== userId) {
        return interaction.editReply('It is not your combatant. Use `/init view` to check the tracker.');
      }
      if (!actor) {
        actor = {
          name: charEntry.data.name,
          ownerId: userId,
          effects: [],
        };
        target = null;
      }
      if (targetName && !target) return interaction.editReply(`No target named **"${targetName}"** in combat.`);

      const effectiveLevel = castLevel ?? spell.level ?? 1;
      const isCantrip = spell.type === 'Cantrip';
      const consumesSlot = !isCantrip && effectiveLevel > 0;
      const warnings = [];
      if (consumesSlot) {
        const slots = charOverlay.getSlotsRemaining(charEntry, casterStats.caster.name, effectiveLevel);
        if (slots && slots.max > 0 && slots.current <= 0) {
          warnings.push(`${casterStats.caster.name} has no rank ${effectiveLevel} slots remaining. Casting anyway.`);
        } else if (slots && slots.max === 0) {
          warnings.push(`${casterStats.caster.name} has no rank ${effectiveLevel} slots. Casting anyway.`);
        }
        charOverlay.spendSlot(charEntry, casterStats.caster.name, effectiveLevel);
        saveCharacters(characters);
      }

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`${actor.name} casts ${spell.name}`);
      if (charEntry.art) embed.setThumbnail(charEntry.art);

      const lines = [];
      lines.push(`*${isCantrip ? `Cantrip ${effectiveLevel}` : `Rank ${effectiveLevel}`} ${casterStats.tradition} spell*`);
      if (spell.cast) lines.push(`**Cast** ${spell.cast}`);
      if (spell.range) lines.push(`**Range** ${spell.range}`);
      if (spell.area) lines.push(`**Area** ${spell.area}`);
      if (spell.target) lines.push(`**Target** ${spell.target}`);
      if (target) lines.push(`**Combat Target** ${target.name}`);
      lines.push('');

      const resolved = resolveSpellDamage(spell, effectiveLevel);
      const damageRoll = resolved?.diceExpr ? rollCompoundExpression(resolved.diceExpr) : null;
      const damageType = resolved?.damageType ?? spell.damageType ?? null;
      let appliedLine = null;

      if (spell.isAttackSpell) {
        const targetEffects = combatV2Rolls.effectTotals(target);
        const dc = target?.ac != null ? target.ac + targetEffects.ac : null;
        const result = combatV2Rolls.rollCheck({
          actor,
          stat: casterStats.attack,
          dc,
          bonus,
          label: 'Spell Attack',
          effectKind: 'attack',
        });
        lines.push(`**Spell Attack**`);
        lines.push(`1d20 (${result.die}) ${fmt(casterStats.attack)}${result.effectBonus ? ` ${fmt(result.effectBonus)} effects` : ''}${bonus ? ` ${fmt(bonus)} bonus` : ''} = **${result.total}**`);
        if (target && dc != null) lines.push(`vs AC ${dc}: **${combatV2DegreeLabel(result.degree)}**`);
        if (damageRoll) {
          if (['success', 'criticalSuccess'].includes(result.degree)) {
            const baseDamage = result.degree === 'criticalSuccess' ? damageRoll.total * 2 : damageRoll.total;
            const defended = target ? combatV2Rolls.applyDefenses(baseDamage, damageType, target) : { finalDamage: baseDamage, notes: [] };
            lines.push(`**Damage${result.degree === 'criticalSuccess' ? ' (crit x2)' : ''}** ${damageRoll.display} = **${defended.finalDamage}**${damageType ? ` ${damageType}` : ''}`);
            if (defended.notes.length) lines.push(`*${defended.notes.join(', ')}*`);
            if (inCombat && target && defended.finalDamage > 0) {
              const beforeHp = target.hp;
              const applied = combatV2State.applyHp(channelId, target.name, -defended.finalDamage);
              appliedLine = `**${target.name}** took **${defended.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP`;
            }
          } else {
            lines.push('*No damage.*');
          }
        }
      } else if (spell.savingThrow) {
        const saveKey = combatV2SaveKey(spell.savingThrow);
        lines.push(`**${spell.saveIsBasic ? 'Basic ' : ''}${spell.savingThrow} Save DC ${casterStats.dc}**`);
        const targetSave = target && saveKey ? combatV2SaveModifier(target, saveKey, interaction.guildId) : null;
        if (target && saveKey && targetSave != null) {
          const result = combatV2Rolls.rollCheck({
            actor: target,
            stat: targetSave,
            dc: casterStats.dc,
            bonus: 0,
            label: `${spell.savingThrow} Save`,
            effectKind: 'save',
          });
          lines.push(`${target.name}: 1d20 (${result.die}) ${fmt(result.stat)}${result.effectBonus ? ` ${fmt(result.effectBonus)} effects` : ''} = **${result.total}**`);
          lines.push(`**${combatV2DegreeLabel(result.degree)}**`);
          if (damageRoll) {
            const fullDamage = spell.saveIsBasic ? basicSaveDamage(damageRoll.total, combatV2LegacyDegree(result.degree)) : damageRoll.total;
            const defended = target ? combatV2Rolls.applyDefenses(fullDamage, damageType, target) : { finalDamage: fullDamage, notes: [] };
            lines.push(`**Damage** ${damageRoll.display} -> **${defended.finalDamage}**${damageType ? ` ${damageType}` : ''}`);
            if (defended.notes.length) lines.push(`*${defended.notes.join(', ')}*`);
            if (inCombat && target && defended.finalDamage > 0 && (spell.saveIsBasic || result.degree === 'failure' || result.degree === 'criticalFailure')) {
              const beforeHp = target.hp;
              const applied = combatV2State.applyHp(channelId, target.name, -defended.finalDamage);
              appliedLine = `**${target.name}** took **${defended.finalDamage}** damage: ${beforeHp}/${target.maxHp} -> ${applied.combatant.hp}/${applied.combatant.maxHp} HP`;
            }
          }
        } else if (target) {
          lines.push(`${target.name}'s save bonus is not recorded.`);
        } else if (damageRoll) {
          lines.push(`Damage if applicable: ${damageRoll.display} = **${damageRoll.total}**${damageType ? ` ${damageType}` : ''}`);
        }
      } else if (damageRoll) {
        lines.push(`**Damage** ${damageRoll.display} = **${damageRoll.total}**${damageType ? ` ${damageType}` : ''}`);
      }

      if (resolved?.heightenedNote) lines.push(`*Heightened: ${resolved.heightenedNote}*`);
      const shortDesc = spell.description ?? '';
      if (shortDesc && shortDesc !== '*No description available.*') {
        lines.push('');
        lines.push(shortDesc.length > 300 ? `${shortDesc.slice(0, 300)}...\n*Use \`/spell ${spell.name}\` for full details.*` : shortDesc);
      }
      embed.setDescription(lines.join('\n').slice(0, 4096));
      let footer = `${charEntry.data.name} · Spell Attack ${fmt(casterStats.attack)} · DC ${casterStats.dc}`;
      if (consumesSlot) {
        const slotsNow = charOverlay.getSlotsRemaining(charEntry, casterStats.caster.name, effectiveLevel);
        if (slotsNow?.max > 0) footer += ` · Rank ${effectiveLevel} slots: ${slotsNow.current}/${slotsNow.max}`;
      }
      embed.setFooter({ text: footer });

      if (inCombat) await updateCombatV2Summary(interaction.channel, encounter);
      const content = [warnings.join('\n'), appliedLine].filter(Boolean).join('\n') || undefined;
      return interaction.editReply({ content, embeds: [embed] });
    }

    return interaction.reply({ content: `Unknown /i action: ${sub}`, ephemeral: true });
  }

  else if (commandName === 'init') {
    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;

    if (sub === 'start') {
      if (combatV2State.getEncounter(channelId) || getEncounter(channelId)) {
        return interaction.reply({ content: 'An encounter is already active here. Use `/init end` first.', ephemeral: true });
      }
      const newEnc = combatV2State.createEncounter(channelId, {
        guildId: interaction.guildId,
        gmId: userId,
        name: `Combat in #${interaction.channel?.name ?? 'channel'}`,
      });
      await interaction.reply(`Combat started. <@${userId}> is the GM.\nUse \`/init view\` to show the tracker. Next up: \`/init add\` will add PCs, monsters, NPCs, and companions into combat v2.`);
      await updateCombatV2Summary(interaction.channel, newEnc);
      return;
    }

    const v2Encounter = combatV2State.getEncounter(channelId);
    if (v2Encounter && (sub === 'view' || sub === 'list')) {
      const gmView = userId === v2Encounter.gmId;
      const { embed, page, totalPages } = combatV2Render.renderEncounter(v2Encounter, { gmView });
      const components = combatV2Render.pageButtons(channelId, page, totalPages);
      await updateCombatV2Summary(interaction.channel, v2Encounter);
      return interaction.reply({ embeds: [embed], components, ephemeral: gmView });
    }

    if (v2Encounter && sub === 'next') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can advance turns.', ephemeral: true });
      if (v2Encounter.combatants.length === 0) return interaction.reply({ content: 'No combatants in the encounter yet.', ephemeral: true });
      const result = combatV2State.processTurnTransition(channelId, 1);
      const { current, encounter, recoveryCheck } = result;
      await updateCombatV2Summary(interaction.channel, encounter);
      const lines = [current
        ? `Next turn: **${current.name}**. Round **${encounter.round}**.`
        : `No combatants remain. Round **${encounter.round}**.`];
      for (const pr of result.persistentResults ?? []) {
        const flatStatus = pr.ended
          ? `flat check ${pr.flatRoll} vs DC ${pr.flatDc}: persistent damage ends`
          : `flat check ${pr.flatRoll} vs DC ${pr.flatDc}: persistent damage continues`;
        const defenseNote = pr.defenseNotes?.length ? ` (${pr.defenseNotes.join(', ')})` : '';
        const dyingTag = pr.died ? ' and died' : pr.wentDown ? ` and is Dying ${pr.dying}` : '';
        lines.push(`**${pr.name}** persistent ${pr.damageType}: ${pr.damageDice}[${pr.damageRolls.join(', ')}] = ${pr.finalDamage} damage${defenseNote}${dyingTag}; ${flatStatus}.`);
      }
      for (const expired of result.expiredEffects ?? []) {
        lines.push(`**${expired.effect.name}** expired on **${expired.combatantName}**.`);
      }
      if (result.actionEconomy?.text) {
        lines.push(result.actionEconomy.text);
      }
      const replyPayload = {
        content: lines.join('\n'),
      };
      if (recoveryCheck) {
        const recoveryPayload = buildRecoveryCheckPayload(recoveryCheck, recoveryCheck.combatant ?? current, { heroButtons: false });
        replyPayload.embeds = recoveryPayload.embeds;
        const deathPayload = combatDeathPayload(recoveryCheck);
        if (deathPayload?.embeds?.length) replyPayload.embeds = [...replyPayload.embeds, ...deathPayload.embeds].slice(0, 10);
      }
      for (const pr of result.persistentResults ?? []) {
        const deathPayload = combatDeathPayload(pr);
        if (deathPayload?.embeds?.length) {
          replyPayload.embeds = [...(replyPayload.embeds ?? []), ...deathPayload.embeds].slice(0, 10);
        }
      }
      return interaction.reply(replyPayload);
    }

    if (v2Encounter && sub === 'prev') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can move turns backward.', ephemeral: true });
      if (v2Encounter.combatants.length === 0) return interaction.reply({ content: 'No combatants in the encounter yet.', ephemeral: true });
      const { current, encounter } = combatV2State.advanceTurn(channelId, -1);
      await updateCombatV2Summary(interaction.channel, encounter);
      return interaction.reply(`Previous turn: **${current.name}**. Round **${encounter.round}**.`);
    }

    if (v2Encounter && sub === 'end') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can end the encounter.', ephemeral: true });
      await clearCombatV2Summary(interaction.channel, v2Encounter);
      combatV2State.endEncounter(channelId);
      return interaction.reply('Combat ended.');
    }

    if (v2Encounter && sub === 'hp') {
      const name = interaction.options.getString('name');
      const change = interaction.options.getInteger('change');
      const combatant = combatV2State.findCombatant(v2Encounter, name);
      if (!combatant) return interaction.reply({ content: `No combatant named **"${name}"** in combat.`, ephemeral: true });
      if (combatant.ownerId !== userId && v2Encounter.gmId !== userId) {
        return interaction.reply({ content: 'You can only modify HP for your own combatant, unless you are the GM.', ephemeral: true });
      }
      const result = combatV2State.applyHp(channelId, combatant.name, change);
      const verb = change >= 0 ? 'healed' : 'took';
      await interaction.reply({
        content: `**${result.combatant.name}** ${verb} **${Math.abs(change)}**: ${result.before.hp}/${result.combatant.maxHp} -> ${result.combatant.hp}/${result.combatant.maxHp} HP${result.combatant.tempHp ? ` (${result.combatant.tempHp} temp HP)` : ''}${combatDyingSuffix(result)}`,
        ...(combatDeathPayload(result) ?? {}),
      });
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return;
    }

    if (v2Encounter && sub === 'recovery') {
      const name = interaction.options.getString('name');
      const target = combatV2State.findCombatant(v2Encounter, name);
      if (!target) return interaction.reply({ content: `No combatant named **"${name}"** in combat.`, ephemeral: true });
      if (target.ownerId !== userId && v2Encounter.gmId !== userId) {
        return interaction.reply({ content: 'Only the combatant owner or GM can roll that recovery check.', ephemeral: true });
      }
      if ((target.dying ?? 0) <= 0) {
        return interaction.reply({ content: `**${target.name}** is not dying.`, ephemeral: true });
      }
      const recoveryCheck = combatV2State.rollRecoveryCheck(channelId, target.name);
      const payload = buildRecoveryCheckPayload(recoveryCheck, target, { heroButtons: false });
      const deathPayload = combatDeathPayload(recoveryCheck);
      if (deathPayload?.embeds?.length) payload.embeds = [...(payload.embeds ?? []), ...deathPayload.embeds].slice(0, 10);
      await interaction.reply(payload);
      await updateCombatV2Summary(interaction.channel, recoveryCheck.encounter);
      return;
    }

    if (v2Encounter && sub === 'thp') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can set temp HP for combatants right now.', ephemeral: true });
      const name = interaction.options.getString('name');
      const amount = interaction.options.getInteger('amount');
      const result = combatV2State.setTempHp(channelId, name, amount);
      await interaction.reply(`**${result.combatant.name}** temp HP: ${result.before} -> **${result.combatant.tempHp}**.`);
      await updateCombatV2Summary(interaction.channel, v2Encounter);
      return;
    }

    if (v2Encounter && sub === 'remove') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can remove combatants.', ephemeral: true });
      const name = interaction.options.getString('name');
      const result = combatV2State.removeCombatant(channelId, name);
      await interaction.reply(`Removed **${result.combatant.name}** from combat.`);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return;
    }

    if (v2Encounter && sub === 'modify') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can modify combatants.', ephemeral: true });
      const name = interaction.options.getString('name');
      const target = combatV2State.findCombatant(v2Encounter, name);
      if (!target) return interaction.reply({ content: `No combatant named **"${name}"** in combat.`, ephemeral: true });

      const patch = {};
      const changes = [];
      const newName = interaction.options.getString('new_name');
      if (newName) {
        const existing = combatV2State.findCombatant(v2Encounter, newName);
        if (existing && existing.id !== target.id) return interaction.reply({ content: `A combatant named **${newName}** already exists.`, ephemeral: true });
        patch.name = newName.trim();
        changes.push(`name -> ${patch.name}`);
      }
      const initiative = interaction.options.getInteger('initiative');
      if (initiative != null) { patch.initiative = initiative; changes.push(`initiative -> ${initiative}`); }
      const maxHp = interaction.options.getInteger('max_hp');
      if (maxHp != null) { patch.maxHp = maxHp; changes.push(`max HP -> ${maxHp}`); }
      const hp = interaction.options.getInteger('hp');
      if (hp != null) {
        patch.hp = Math.min(hp, maxHp ?? target.maxHp);
        changes.push(`HP -> ${patch.hp}`);
      } else if (maxHp != null && target.hp > maxHp) {
        patch.hp = maxHp;
        changes.push(`HP clamped -> ${maxHp}`);
      }
      const ac = interaction.options.getInteger('ac');
      if (ac != null) { patch.ac = ac; changes.push(`AC -> ${ac}`); }
      const hidden = interaction.options.getBoolean('hidden');
      if (hidden != null) { patch.hidden = hidden; changes.push(`hidden -> ${hidden}`); }
      const group = interaction.options.getString('group');
      if (group != null) { patch.groupId = group.trim() || null; changes.push(`group -> ${patch.groupId ?? 'none'}`); }

      const saves = { ...(target.saves ?? {}) };
      let changedSaves = false;
      for (const [opt, key] of [['fort', 'fort'], ['ref', 'ref'], ['will', 'will']]) {
        const value = interaction.options.getInteger(opt);
        if (value != null) {
          saves[key] = value;
          changedSaves = true;
          changes.push(`${opt} -> ${value}`);
        }
      }
      if (changedSaves) patch.saves = saves;

      const resistances = combatV2ParseDefenseMap(interaction.options.getString('resistances'));
      if (resistances) { patch.resistances = resistances; changes.push(`resistances updated`); }
      const weaknesses = combatV2ParseDefenseMap(interaction.options.getString('weaknesses'));
      if (weaknesses) { patch.weaknesses = weaknesses; changes.push(`weaknesses updated`); }
      const immunities = combatV2ParseList(interaction.options.getString('immunities'));
      if (immunities) { patch.immunities = immunities; changes.push(`immunities updated`); }
      const notes = interaction.options.getString('notes');
      if (notes != null) { patch.notes = notes; changes.push('notes updated'); }

      if (!changes.length) return interaction.reply({ content: 'No changes provided.', ephemeral: true });
      const result = combatV2State.modifyCombatant(channelId, target.name, patch);
      await interaction.reply(`Updated **${result.combatant.name}**: ${changes.join(', ')}.`);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return;
    }

    if (v2Encounter && sub === 'effect') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can add effects.', ephemeral: true });
      const targetName = interaction.options.getString('target');
      const effectName = interaction.options.getString('name');
      const value = interaction.options.getInteger('value');
      const duration = interaction.options.getInteger('duration');
      const target = combatV2State.findCombatant(v2Encounter, targetName);
      if (!target) return interaction.reply({ content: `No combatant named **"${targetName}"** in combat.`, ephemeral: true });
      const preset = getPreset(effectName);
      const effect = preset ? {
        name: preset.name,
        value: preset.scaling ? (value ?? 1) : null,
        duration: duration ?? null,
        modifiers: preset.build(value ?? 1),
        source: 'preset',
      } : {
        name: effectName,
        value: value ?? null,
        duration: duration ?? null,
        modifiers: {
          attackBonus: interaction.options.getInteger('attack_bonus') ?? 0,
          damageBonus: interaction.options.getInteger('damage_bonus') ?? 0,
          acBonus: interaction.options.getInteger('ac_bonus') ?? 0,
          saveBonus: interaction.options.getInteger('save_bonus') ?? 0,
          skillBonus: interaction.options.getInteger('skill_bonus') ?? 0,
          description: interaction.options.getString('description') ?? '',
        },
        source: 'custom',
      };
      const result = combatV2State.addEffect(channelId, target.name, effect);
      await interaction.reply(`Added **${result.effect.name}${result.effect.value ? ` ${result.effect.value}` : ''}** to **${result.combatant.name}**.`);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return;
    }

    if (v2Encounter && sub === 'removeeffect') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can remove effects.', ephemeral: true });
      const targetName = interaction.options.getString('target');
      const effectName = interaction.options.getString('name');
      const result = combatV2State.removeEffect(channelId, targetName, effectName);
      await interaction.reply(`Removed **${result.effect.name}** from **${result.combatant.name}**.`);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return;
    }

    if (v2Encounter && sub === 'effects') {
      const targetName = interaction.options.getString('target');
      const target = combatV2State.findCombatant(v2Encounter, targetName);
      if (!target) return interaction.reply({ content: `No combatant named **"${targetName}"** in combat.`, ephemeral: true });
      const lines = (target.effects ?? []).map(e => {
        const value = e.value != null ? ` ${e.value}` : '';
        const durationText = e.duration != null ? ` (${e.duration} rounds)` : '';
        return `• **${e.name}${value}**${durationText}`;
      });
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`${target.name}'s Effects`)
        .setDescription(lines.length ? lines.join('\n') : 'No active effects.');
      return interaction.reply({ embeds: [embed], ephemeral: target.hidden && userId === v2Encounter.gmId });
    }

    if (v2Encounter && sub === 'move') {
      const moverName = interaction.options.getString('name');
      const mover = combatV2State.findCombatant(v2Encounter, moverName);
      if (!mover) return interaction.reply({ content: `No combatant named **"${moverName}"** in combat.`, ephemeral: true });
      const reactors = v2Encounter.combatants.filter(c =>
        c.id !== mover.id &&
        c.hp > 0 &&
        c.hasReaction !== false &&
        !c.reactionUsed &&
        c.isNpc !== mover.isNpc
      );
      if (!reactors.length) return interaction.reply(`**${mover.name}** moves. No opposing combatants have reactions available.`);
      const lines = [`**${mover.name}** moves. Potential reactions:`];
      for (const reactor of reactors.slice(0, 10)) {
        const mention = reactor.isNpc ? `<@${v2Encounter.gmId}>` : (reactor.ownerId ? `<@${reactor.ownerId}>` : '');
        lines.push(`${mention} **${reactor.name}** can react. Use \`/i reaction actor:${reactor.name}\` if they do.`);
      }
      if (reactors.length > 10) lines.push(`*...and ${reactors.length - 10} more.*`);
      return interaction.reply(lines.join('\n'));
    }

    if (v2Encounter && sub === 'reaction') {
      const reactorName = interaction.options.getString('name');
      const reason = interaction.options.getString('reason') ?? 'reaction trigger';
      const reactor = combatV2State.findCombatant(v2Encounter, reactorName);
      if (!reactor) return interaction.reply({ content: `No combatant named **"${reactorName}"** in combat.`, ephemeral: true });
      if (reactor.hasReaction === false || reactor.reactionUsed || reactor.hp <= 0) {
        return interaction.reply({ content: `**${reactor.name}** does not currently have a reaction available.`, ephemeral: true });
      }
      const mention = reactor.isNpc ? `<@${v2Encounter.gmId}>` : (reactor.ownerId ? `<@${reactor.ownerId}>` : '');
      return interaction.reply(`${mention} **${reactor.name}** reaction prompt: *${reason}*\nUse \`/i reaction actor:${reactor.name}\` if the reaction is used.`);
    }

    if (v2Encounter && sub === 'delay') {
      const current = combatV2State.currentCombatant(v2Encounter);
      if (!current) return interaction.reply({ content: 'No current combatant to delay.', ephemeral: true });
      if (userId !== v2Encounter.gmId && current.ownerId !== userId) {
        return interaction.reply({ content: 'Only the current combatant owner or GM can delay this turn.', ephemeral: true });
      }
      const result = combatV2State.delayCombatant(channelId, current.name);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      const next = result.current ? ` Next up: **${result.current.name}**.` : '';
      return interaction.reply(`**${result.combatant.name}** delays.${next}`);
    }

    if (v2Encounter && sub === 'rejoin') {
      const name = interaction.options.getString('name');
      const targetName = interaction.options.getString('target');
      const combatant = combatV2State.findCombatant(v2Encounter, name);
      if (!combatant) return interaction.reply({ content: `No combatant named **"${name}"** in combat.`, ephemeral: true });
      if (userId !== v2Encounter.gmId && combatant.ownerId !== userId) {
        return interaction.reply({ content: 'Only the combatant owner or GM can rejoin this turn.', ephemeral: true });
      }
      if (!combatant.delayed) return interaction.reply({ content: `**${combatant.name}** is not delaying.`, ephemeral: true });
      if (targetName && !combatV2State.findCombatant(v2Encounter, targetName)) {
        return interaction.reply({ content: `No combatant named **"${targetName}"** in combat.`, ephemeral: true });
      }
      const result = combatV2State.rejoinCombatant(channelId, combatant.name, targetName);
      await updateCombatV2Summary(interaction.channel, result.encounter);
      return interaction.reply(`**${result.combatant.name}** rejoins initiative and acts now.`);
    }

    if (!v2Encounter && ['view', 'prev'].includes(sub)) {
      return interaction.reply({ content: 'No active combat v2 encounter. Start one with `/init start`.', ephemeral: true });
    }

    if (v2Encounter && sub === 'add') {
      const kind = interaction.options.getString('kind') ?? (interaction.options.getString('companion') ? 'companion' : 'pc');
      const nameArg = interaction.options.getString('name');
      const companionArg = interaction.options.getString('companion');
      const resultOverride = interaction.options.getInteger('result');
      const bonusOverride = interaction.options.getInteger('bonus');
      const count = interaction.options.getInteger('count') ?? 1;
      const groupId = interaction.options.getString('group');

      if (['monster', 'npc'].includes(kind) && userId !== v2Encounter.gmId) {
        return interaction.reply({ content: 'Only the GM can add monsters or NPCs.', ephemeral: true });
      }

      if (kind === 'pc') {
        const characters = loadCharacters();
        const { error, char: charEntry } = resolveChar(userId, interaction.options.getString('character') ?? nameArg, characters);
        if (error) return interaction.reply({ content: error, ephemeral: true });
        const c = charEntry.data;
        if (combatV2HasName(v2Encounter, c.name)) return interaction.reply({ content: `**${c.name}** is already in combat.`, ephemeral: true });
        const maxHp = computeCharMaxHp(charEntry);
        const initMod = bonusOverride ?? computeCharPerception(charEntry);
        const rolled = combatV2Initiative(initMod, resultOverride);
        const { combatant } = combatV2State.addCombatant(channelId, {
          name: c.name,
          type: 'pc',
          isNpc: false,
          hidden: false,
          initiative: rolled.initiative,
          hp: charEntry.hp ?? maxHp,
          maxHp,
          ac: c.acTotal?.acTotal ?? null,
          ownerId: userId,
          attacks: combatV2CharacterAttacks(charEntry),
          saves: {
            fort: combatV2CharacterSave(c, 'fortitude'),
            ref: combatV2CharacterSave(c, 'reflex'),
            will: combatV2CharacterSave(c, 'will'),
          },
          skills: combatV2CharacterSkills(charEntry),
        });
        await interaction.reply(`**${combatant.name}** joined combat at **${combatant.initiative}** ${rolled.text}.`);
        await updateCombatV2Summary(interaction.channel, v2Encounter);
        return;
      }

      if (kind === 'companion') {
        const characters = loadCharacters();
        const { error, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
        if (error) return interaction.reply({ content: error, ephemeral: true });
        const companions = charEntry.companions ?? {};
        const query = companionArg ?? nameArg ?? charEntry.activeCompanion ?? 'active';
        const key = String(query).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        let comp = companions[key];
        if (!comp && (query === 'active' || !query)) comp = companions[charEntry.activeCompanion];
        if (!comp) comp = Object.values(companions).find(c => c.displayName?.toLowerCase() === String(query).toLowerCase());
        if (!comp) return interaction.reply({ content: `No companion "${query}" found for **${charEntry.data.name}**.`, ephemeral: true });
        if (combatV2HasName(v2Encounter, comp.displayName)) return interaction.reply({ content: `**${comp.displayName}** is already in combat.`, ephemeral: true });
        const scaled = scaleCompanion(comp, charEntry.data);
        const initMod = bonusOverride ?? scaled.perception ?? 0;
        const rolled = combatV2Initiative(initMod, resultOverride);
        const { combatant } = combatV2State.addCombatant(channelId, {
          name: comp.displayName,
          type: 'companion',
          isNpc: false,
          hidden: false,
          initiative: rolled.initiative,
          hp: comp.currentHp ?? scaled.maxHp,
          maxHp: scaled.maxHp,
          ac: scaled.ac,
          ownerId: userId,
          sourceKey: comp.baseType,
          attacks: combatV2CompanionAttacks(comp, scaled),
          saves: scaled.saves,
          skills: comp.skills ?? {},
          notes: `${charEntry.data.name}'s ${comp.form} companion`,
        });
        await interaction.reply(`**${combatant.name}** joined combat at **${combatant.initiative}** ${rolled.text}.`);
        await updateCombatV2Summary(interaction.channel, v2Encounter);
        return;
      }

      if (kind === 'npc') {
        const name = nameArg ?? 'NPC';
        const hp = interaction.options.getInteger('hp') ?? 1;
        const ac = interaction.options.getInteger('ac');
        const initMod = bonusOverride ?? 0;
        const added = [];
        for (let i = 1; i <= count; i += 1) {
          const rolled = combatV2Initiative(initMod, resultOverride);
          const uniqueName = uniqueCombatV2Name(v2Encounter, name, count, i);
          const { combatant } = combatV2State.addCombatant(channelId, {
            name: uniqueName,
            type: 'npc',
            isNpc: true,
            hidden: true,
            initiative: rolled.initiative,
            groupId,
            hp,
            maxHp: hp,
            ac,
            ownerId: userId,
          });
          added.push(`**${combatant.name}** init ${combatant.initiative}`);
        }
        await interaction.reply(`Added ${added.join(', ')}.`);
        await updateCombatV2Summary(interaction.channel, v2Encounter);
        return;
      }

      if (kind === 'monster') {
        const input = nameArg;
        if (!input) return interaction.reply({ content: 'Monster add needs `name:<monster name>`.', ephemeral: true });
        const { monster, matches, total } = findMonster(input);
        if (!monster) {
          if (matches?.length > 1) {
            const preview = matches.slice(0, 10).map(n => `• **${n}**`).join('\n');
            const extra = (total ?? matches.length) > 10 ? `\n*...and ${(total ?? matches.length) - 10} more.*` : '';
            return interaction.reply({ content: `Multiple creatures match **"${input}"**:\n${preview}${extra}`, ephemeral: true });
          }
          return interaction.reply({ content: `No creature named **"${input}"** in the bestiary.`, ephemeral: true });
        }
        const stats = combatV2MonsterStats(monster, interaction.guildId);
        const initMod = bonusOverride ?? stats.perception ?? 0;
        const sharedRoll = resultOverride !== null || groupId ? combatV2Initiative(initMod, resultOverride) : null;
        const added = [];
        for (let i = 1; i <= count; i += 1) {
          const rolled = sharedRoll ?? combatV2Initiative(initMod, resultOverride);
          const hp = stats.hp;
          const uniqueName = uniqueCombatV2Name(v2Encounter, monster.name, count, i);
          const { combatant } = combatV2State.addCombatant(channelId, {
            name: uniqueName,
            type: 'monster',
            isNpc: true,
            hidden: true,
            initiative: rolled.initiative,
            groupId: groupId ?? (count > 1 && sharedRoll ? monster.name : null),
            hp,
            maxHp: hp,
            ac: stats.ac,
            saves: stats.saves,
            skills: stats.skills,
            spells: stats.spells,
            resistances: stats.resistances,
            weaknesses: stats.weaknesses,
            immunities: stats.immunities,
            attacks: stats.attacks,
            ownerId: v2Encounter.gmId,
            sourceKey: monster.name,
          });
          added.push(`**${combatant.name}** init ${combatant.initiative}`);
        }
        await interaction.reply(`Added ${count === 1 ? monster.name : `${count} ${monster.name}s`} to combat.`);
        await interaction.followUp({ content: `GM details: ${added.join(', ')}. HP ${stats.hp}, AC ${stats.ac ?? '?'}.`, ephemeral: true });
        await updateCombatV2Summary(interaction.channel, v2Encounter);
        return;
      }
    }

    if (v2Encounter && sub === 'addnpc') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can add NPCs.', ephemeral: true });
      const name = interaction.options.getString('name');
      const hp = interaction.options.getInteger('hp');
      const ac = interaction.options.getInteger('ac');
      const bonus = interaction.options.getInteger('bonus') ?? 0;
      const resultOverride = interaction.options.getInteger('result');
      const rolled = combatV2Initiative(bonus, resultOverride);
      if (combatV2HasName(v2Encounter, name)) return interaction.reply({ content: `A combatant named **${name}** is already in combat.`, ephemeral: true });
      const { combatant } = combatV2State.addCombatant(channelId, {
        name,
        type: 'npc',
        isNpc: true,
        hidden: true,
        initiative: rolled.initiative,
        hp,
        maxHp: hp,
        ac,
        ownerId: userId,
      });
      await interaction.reply(`**${combatant.name}** joined combat at **${combatant.initiative}** ${rolled.text}.`);
      await updateCombatV2Summary(interaction.channel, v2Encounter);
      return;
    }

    if (v2Encounter && sub === 'addmonster') {
      if (userId !== v2Encounter.gmId) return interaction.reply({ content: 'Only the GM can add monsters.', ephemeral: true });
      const input = interaction.options.getString('monster');
      const count = interaction.options.getInteger('count') ?? 1;
      const initMode = interaction.options.getString('init_mode') ?? 'per_copy';
      const hpMode = interaction.options.getString('hp_mode') ?? 'fixed';
      const bonusOverride = interaction.options.getInteger('bonus');
      const resultOverride = interaction.options.getInteger('result');
      const { monster, matches, total } = findMonster(input);
      if (!monster) {
        if (matches?.length > 1) {
          const preview = matches.slice(0, 10).map(n => `• **${n}**`).join('\n');
          const extra = (total ?? matches.length) > 10 ? `\n*...and ${(total ?? matches.length) - 10} more.*` : '';
          return interaction.reply({ content: `Multiple creatures match **"${input}"**:\n${preview}${extra}`, ephemeral: true });
        }
        return interaction.reply({ content: `No creature named **"${input}"** in the bestiary.`, ephemeral: true });
      }
      const stats = combatV2MonsterStats(monster, interaction.guildId);
      const initMod = bonusOverride ?? stats.perception ?? 0;
      const sharedRoll = initMode === 'shared' || resultOverride !== null ? combatV2Initiative(initMod, resultOverride) : null;
      const added = [];
      for (let i = 1; i <= count; i += 1) {
        const rolled = sharedRoll ?? combatV2Initiative(initMod, resultOverride);
        const uniqueName = uniqueCombatV2Name(v2Encounter, monster.name, count, i);
        const hp = hpMode === 'varied' ? Math.max(1, stats.hp + Math.floor(Math.random() * 11) - 5) : stats.hp;
        const { combatant } = combatV2State.addCombatant(channelId, {
          name: uniqueName,
          type: 'monster',
          isNpc: true,
          hidden: true,
          initiative: rolled.initiative,
          groupId: initMode === 'shared' && count > 1 ? monster.name : null,
          hp,
          maxHp: hp,
          ac: stats.ac,
          saves: stats.saves,
          skills: stats.skills,
          spells: stats.spells,
          resistances: stats.resistances,
          weaknesses: stats.weaknesses,
          immunities: stats.immunities,
          attacks: stats.attacks,
          ownerId: v2Encounter.gmId,
          sourceKey: monster.name,
        });
        added.push(`**${combatant.name}** init ${combatant.initiative}`);
      }
      await interaction.reply(`Added ${count === 1 ? monster.name : `${count} ${monster.name}s`} to combat.`);
      await interaction.followUp({ content: `GM details: ${added.join(', ')}. Base HP ${stats.hp}, AC ${stats.ac ?? '?'}.`, ephemeral: true });
      await updateCombatV2Summary(interaction.channel, v2Encounter);
      return;
    }

    return interaction.reply({
      content: 'No active combat v2 encounter here. Use `/init start`, then add combatants with `/init add`, `/init addmonster`, or `/i join`.',
      ephemeral: true,
    });

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

      // ── Companion path ─────────────────────────────────────────────
      // If `companion:` is specified, add the user's companion to init as
      // their own combatant (ownedby the user, not NPC-controlled). Uses
      // the companion's Perception for the initiative roll (standard PF2e).
      const compArg = interaction.options.getString('companion');
      if (compArg) {
        const { error: cerr, char: ce } = resolveChar(userId, interaction.options.getString('character'), characters);
        if (cerr) {
          return interaction.reply({ content: cerr, ephemeral: true });
        }
        if (!ce.companions || Object.keys(ce.companions).length === 0) {
          return interaction.reply({ content: `❌ **${ce.data.name}** has no companions. Add one with \`/companion add\`.`, ephemeral: true });
        }
        // Resolve the companion: by slug/name, falling back to active.
        const compKey = compArg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        let comp = ce.companions[compKey];
        if (!comp && (compArg === 'active' || !compArg.trim())) {
          comp = ce.companions[ce.activeCompanion];
        }
        // Try matching by displayName too, in case the user typed the actual
        // shown name (slug-ified may not match if it contains non-ASCII).
        if (!comp) {
          const byDisplay = Object.values(ce.companions).find(
            c => c.displayName.toLowerCase() === compArg.toLowerCase()
          );
          if (byDisplay) comp = byDisplay;
        }
        if (!comp) return interaction.reply({ content: `❌ No companion "${compArg}" found for **${ce.data.name}**.`, ephemeral: true });

        if (enc.combatants.some(x => x.name.toLowerCase() === comp.displayName.toLowerCase())) {
          return interaction.reply({ content: `❌ **${comp.displayName}** is already in the encounter.`, ephemeral: true });
        }

        const scaled = scaleCompanion(comp, ce.data);
        const initBonus = interaction.options.getInteger('bonus') ?? 0;
        const resultOverride = interaction.options.getInteger('result');
        // Companions roll initiative using Perception (standard PF2e rule).
        // scaled.perception already factors in any perception override the user set.
        const initMod = scaled.perception ?? 0;
        let initiative, rollText;
        if (resultOverride !== null) {
          initiative = resultOverride;
          rollText = `(set to ${resultOverride})`;
        } else {
          const r = rollD20Plus(initMod + initBonus);
          initiative = r.total;
          rollText = `(rolled ${r.roll} ${fmt(r.mod)})`;
        }

        addCombatant(channelId, {
          name: comp.displayName,
          initiative,
          hp: comp.currentHp ?? scaled.maxHp,
          maxHp: scaled.maxHp,
          ac: scaled.ac,
          ownerId: userId,
          isNpc: false,
          companionOf: ce.data.name,
          effects: [],
        });

        await interaction.reply(`🐾 **${comp.displayName}** (${ce.data.name}'s ${comp.form} companion) joins initiative at **${initiative}** ${rollText}. HP ${comp.currentHp ?? scaled.maxHp}/${scaled.maxHp} · AC ${scaled.ac}`);
        await updateSummary(interaction.channel, enc);
        return;
      }

      // ── Character path (default) ───────────────────────────────────
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

      await interaction.reply(`**${charName}** joined initiative at **${initiative}** ${rollText}.`);
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

      await interaction.reply(`**${name}** joined initiative at **${initiative}** ${rollText}.`);
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

      // Two-message reply pattern:
      //   1. PUBLIC reply — just the count + name, NO stats. Players see "Goblin
      //      Warrior 1 joined initiative" without being able to see HP/AC/init.
      //   2. EPHEMERAL follow-up to GM — full stat line per copy. GM gets the
      //      details they need to run combat without leaking them to players.
      // This protects metagame info (esp. HP — players shouldn't know the
      // monster has 14 HP because they saw the GM type it in).
      const publicNames = enc.combatants
        .filter(c => c.bestiaryKey === monster.name)
        .slice(-count)
        .map(c => c.name);
      const publicHeader = count === 1
        ? `**${publicNames[0]}** joined the encounter.`
        : `**${count}× ${baseName}** joined the encounter: ${publicNames.join(', ')}`;
      await interaction.reply({ content: publicHeader });

      const gmHeader = `**GM details — ${count}× ${baseName}**${skipped ? ` (${skipped} name collision(s) auto-renumbered)` : ''}:`;
      await interaction.followUp({
        content: `${gmHeader}\n${addedLines.join('\n')}`,
        ephemeral: true,
      });
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init attack — auto-roll a monster's bestiary attack ─────────
    // GM-only. Looks up the combatant in the encounter, pulls the attack
    // from their bestiary entry (rich.attacks), and rolls it just like
    // /attack does for player characters: auto-MAP, effect modifiers,
    // crit handling, damage application, reaction prompts.
    //
    // Replaces the old /mattack flow where GMs had to manually type
    // bonus + damage every time. Now: /init attack monster:Goblin Warrior
    // attack:dogslicer target:Bard does it all.
    if (sub === 'attack') {
      const attackerName = interaction.options.getString('monster');
      const attackName = interaction.options.getString('attack');
      const targetName = interaction.options.getString('target');
      const extraBonus = interaction.options.getInteger('bonus') ?? 0;
      const explicitMap = interaction.options.getInteger('map'); // null if unset

      // 1. Look up the attacker as a combatant in the encounter. If omitted,
      // default to the current turn when it belongs to the caller/GM, otherwise
      // the caller's only living combatant.
      const attacker = pickDefaultAttacker(enc, userId, attackerName);
      if (!attacker) {
        return interaction.reply({
          content: attackerName
            ? `❌ No combatant named **"${attackerName}"** in this encounter. Use \`/init list\` to see who's in initiative.`
            : '❌ I could not tell who is attacking. Use `monster:<name>` once, or wait until your combatant is the current turn.',
          ephemeral: true,
        });
      }
      if (userId !== enc.gmId && attacker.ownerId !== userId) {
        return interaction.reply({ content: `❌ You can only attack with your own combatant. I resolved the attacker as **${attacker.name}**.`, ephemeral: true });
      }
      if (!attacker.isNpc) {
        const characters = loadCharacters();
        const resolved = findCharacterEntryForCombatant(characters, attacker);
        if (!resolved?.char) return interaction.reply({ content: `❌ I found **${attacker.name}** in initiative, but couldn't match it to a saved character or companion.`, ephemeral: true });
        const target = pickDefaultTarget(enc, attacker, targetName);
        if (targetName && !target) return interaction.reply({ content: `❌ No combatant named **"${targetName}"** in this encounter.`, ephemeral: true });

        const charEntry = resolved.char;
        const char = charEntry.data;
        const attacks = [];
        if (resolved.companion) {
          const comp = resolved.companion;
          const scaled = scaleCompanion(comp, char);
          if (scaled.primaryAttack) attacks.push({
            name: scaled.primaryAttack.name,
            bonus: scaled.attackBonus,
            damage: `${scaled.damageDice}${scaled.damageBonus !== 0 ? (scaled.damageBonus > 0 ? '+' : '') + scaled.damageBonus : ''}`,
            damageType: scaled.damageType ?? '',
            traits: scaled.primaryAttack.traits ?? [],
            title: `${comp.displayName} attacks with ${scaled.primaryAttack.name}!`,
            footer: `${char.name}'s companion`,
            thumbnail: comp.art ?? charEntry.art ?? null,
          });
          for (const a of (comp.customAttacks ?? [])) attacks.push({
            name: a.name, bonus: a.bonus, damage: a.damage, damageType: a.damageType ?? '', traits: a.traits ?? [],
            title: `${comp.displayName} attacks with ${a.name}!`, footer: `${char.name}'s companion`, thumbnail: comp.art ?? charEntry.art ?? null,
          });
        } else {
          for (const attack of combatV2CharacterAttacks(charEntry)) {
            attacks.push({
              ...attack,
              title: `${char.name} attacks with ${attack.name}!`,
              footer: `${char.name} · Attack ${fmt(attack.bonus ?? 0)} · ${attack.damage ?? ''} ${attack.damageType ?? ''}`,
              thumbnail: charEntry.art ?? null,
            });
          }
        }
        if (attacks.length === 0) return interaction.reply({ content: `❌ **${attacker.name}** has no attacks configured.`, ephemeral: true });
        const chosen = attackName
          ? attacks.find(a => a.name.toLowerCase() === attackName.toLowerCase()) ?? attacks.find(a => a.name.toLowerCase().includes(attackName.toLowerCase()))
          : attacks[0];
        if (!chosen) return interaction.reply({ content: `❌ No attack matching **"${attackName}"**. Available: ${attacks.map(a => a.name).join(', ')}`, ephemeral: true });

        const agile = (chosen.traits ?? []).map(t => String(t).toLowerCase()).includes('agile');
        const mapInfo = explicitMap !== null
          ? { penalty: calculateMap(explicitMap, agile), noteText: explicitMap > 0 ? `MAP ${calculateMap(explicitMap, agile)} (manual)` : null }
          : ca.computeMapForNextAttack(attacker, agile);
        const attackerMods = sumEffectModifiers(attacker);
        const targetMods = target ? sumEffectModifiers(target) : { acBonus: 0, activeEffects: [] };
        const dieRoll = Math.floor(Math.random() * 20) + 1;
        const attackTotal = dieRoll + chosen.bonus + extraBonus + mapInfo.penalty + attackerMods.attackBonus;
        const baseTargetAc = target?.ac ?? null;
        const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;
        const degree = effectiveTargetAc !== null ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc) : null;
        const dmg = rollCompoundExpression(chosen.damage);
        let finalDamage = dmg ? Math.max(1, dmg.total + attackerMods.damageBonus) : 0;
        const preCritDamage = finalDamage;
        if (degree === 'crit-success') finalDamage *= 2;

        const mapText = mapInfo.penalty !== 0 ? ` ${fmt(mapInfo.penalty)}` : '';
        const bonusText = extraBonus !== 0 ? ` ${fmt(extraBonus)}` : '';
        const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
        let attackLine = `**Attack Roll**\n1d20 (${dieRoll}) ${fmt(chosen.bonus)}${mapText}${bonusText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
        if (mapInfo.noteText) attackLine += `\n*${mapInfo.noteText}*`;
        if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
        if (dieRoll === 20) attackLine += '\n⭐ Natural 20!';
        if (dieRoll === 1) attackLine += '\n💀 Natural 1!';

        let outcomeLine = target ? `🎯 Attack against **${target.name}** (AC unknown — GM decides)` : 'No target selected.';
        if (degree === 'crit-success') outcomeLine = `🎯 **Critical Hit on ${target.name}!** AC ${effectiveTargetAc}`;
        else if (degree === 'success') outcomeLine = `✅ **Hit on ${target.name}!** AC ${effectiveTargetAc}`;
        else if (degree === 'failure') outcomeLine = `❌ **Miss on ${target.name}.** AC ${effectiveTargetAc}`;
        else if (degree === 'crit-failure') outcomeLine = `💢 **Critical Miss on ${target.name}.** AC ${effectiveTargetAc}`;

        let damageLine = '';
        if (dmg && (degree === 'success' || degree === 'crit-success' || !target)) {
          damageLine = degree === 'crit-success'
            ? `**Damage (CRIT × 2)**\n${dmg.display}${attackerMods.damageBonus ? ` ${fmt(attackerMods.damageBonus)}` : ''} = ${preCritDamage} × 2 = **${finalDamage} ${chosen.damageType}**`
            : `**Damage**\n${dmg.display}${attackerMods.damageBonus ? ` ${fmt(attackerMods.damageBonus)}` : ''} = **${finalDamage} ${chosen.damageType}**`;
        }
        let hpLine = '';
        let deathPayload = null;
        if (target && finalDamage > 0 && (degree === 'success' || degree === 'crit-success')) {
          const dmgResult = ca.applyDamage(channelId, target.name, finalDamage, { isCrit: degree === 'crit-success' });
          hpLine = target.isNpc
            ? `\n❤️ **${target.name}** took ${finalDamage} damage${dmgResult?.displaySuffix ?? ''}`
            : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dmgResult?.displaySuffix ?? ''}`;
          deathPayload = combatDeathPayload(dmgResult);
        }
        if (explicitMap === null) ca.recordAttack(channelId, attacker.name);
        const embed = new EmbedBuilder()
          .setColor(0xC0392B)
          .setTitle(`⚔️ ${chosen.title}`)
          .setDescription([attackLine, '', damageLine || null, outcomeLine, hpLine || null].filter(Boolean).join('\n'))
          .setFooter({ text: chosen.footer });
        if (chosen.thumbnail) embed.setThumbnail(chosen.thumbnail);
        await interaction.reply({ embeds: [embed, ...(deathPayload?.embeds ?? [])].slice(0, 10) });
        await updateSummary(interaction.channel, enc);
        return;
      }
      if (!attacker.bestiaryKey) {
        return interaction.reply({
          content: `❌ **${attacker.name}** wasn't added from the bestiary, so I can't auto-pull their attacks. Use \`/mattack\` to roll an attack manually instead.`,
          ephemeral: true,
        });
      }

      // 2. Find the named attack on the attacker
      const atk = findCombatantAttack(attacker, attackName, interaction.guildId);
      if (!atk) {
        const available = getCombatantAttacks(attacker, interaction.guildId)
          .map(a => `**${a.name}** (${a.type === 'ranged' ? '🏹' : '⚔️'} ${fmt(a.to_hit)})`)
          .join(', ') || 'none';
        return interaction.reply({
          content: `❌ **${attacker.name}** has no attack matching **"${attackName}"**. Available: ${available}`,
          ephemeral: true,
        });
      }

      // 3. Look up the target. If omitted, pick the first living opposing
      // combatant so the short form can resolve in ordinary PC-vs-monster turns.
      const target = pickDefaultTarget(enc, attacker, targetName);
      if (!target) {
        return interaction.reply({ content: targetName ? `❌ No combatant named **"${targetName}"** in this encounter.` : '❌ I could not choose a target. Use `target:<name>`.', ephemeral: true });
      }

      const baseAttackBonus = typeof atk.to_hit === 'number' ? atk.to_hit : 0;
      const isAgile = (atk.traits ?? []).some(t => String(t).toLowerCase() === 'agile');
      const attackerMods = sumEffectModifiers(attacker);
      const targetMods = sumEffectModifiers(target);

      // 4. Compute MAP (auto-tracked from encounter, or manual override)
      let mapPenalty, mapNoteText;
      if (explicitMap !== null) {
        mapPenalty = calculateMap(explicitMap, isAgile);
        mapNoteText = explicitMap > 0 ? `MAP ${mapPenalty} (manual)` : null;
      } else {
        const mapInfo = ca.computeMapForNextAttack(attacker, isAgile);
        mapPenalty = mapInfo.penalty;
        mapNoteText = mapInfo.noteText;
      }

      // 5. Roll attack
      const dieRoll = Math.floor(Math.random() * 20) + 1;
      const attackTotal = dieRoll + baseAttackBonus + extraBonus + mapPenalty + attackerMods.attackBonus;

      const baseTargetAc = target.ac ?? null;
      const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;
      const degree = effectiveTargetAc !== null
        ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc)
        : null;

      // 6. Roll damage (handles compound expressions like "3d12+15 piercing plus 2d6 fire")
      const damageParts = parseAndRollAttackDamage(atk.damage);
      const totalDamageBonus = attackerMods.damageBonus;

      // Sum all the rolled dice damage (flavor-only parts contribute 0)
      let totalRolledDamage = 0;
      const damageLineParts = [];
      const allTypes = [];
      if (damageParts) {
        for (const part of damageParts) {
          if (part.rollResult) {
            totalRolledDamage += part.rollResult.total;
            const partTotal = part.rollResult.total;
            damageLineParts.push(`${part.rollResult.display} **${partTotal} ${part.type}**`);
            allTypes.push(part.type);
          } else if (part.note) {
            damageLineParts.push(`*plus ${part.note}*`);
          }
        }
      }
      // Apply effect bonus to damage (e.g. Bless)
      let finalDamage = Math.max(1, totalRolledDamage + totalDamageBonus);
      // Crits double
      if (degree === 'crit-success') finalDamage = finalDamage * 2;

      // 7. Build the embed (same shape as /mattack so it feels consistent)
      const mapText = mapPenalty !== 0 ? ` ${mapPenalty}` : '';
      const bonusText = extraBonus !== 0 ? ` ${fmt(extraBonus)}` : '';
      const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
      const traitsText = (atk.traits?.length) ? ` *(${atk.traits.join(', ')})*` : '';

      let attackLine = `**Attack Roll**\n1d20 (${dieRoll}) ${fmt(baseAttackBonus)}${mapText}${bonusText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
      if (mapNoteText) attackLine += `\n*${mapNoteText}*`;
      if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
      if (dieRoll === 20) attackLine += '\n⭐ Natural 20!';
      if (dieRoll === 1)  attackLine += '\n💀 Natural 1!';

      // Damage line (if we have parsed damage)
      let damageLine = null;
      if (damageParts && damageLineParts.length > 0) {
        const damageContribText = formatEffectContributions(attackerMods.activeEffects, 'damage');
        const bonusDisplay = totalDamageBonus !== 0 ? ` ${fmt(totalDamageBonus)}` : '';
        if (degree === 'crit-success') {
          damageLine = `**Damage (CRIT × 2)**\n${damageLineParts.join(' + ')}${bonusDisplay} → **${finalDamage}** total`;
        } else {
          damageLine = `**Damage**\n${damageLineParts.join(' + ')}${bonusDisplay} → **${finalDamage}** total`;
        }
        if (damageContribText) damageLine += `\n*${damageContribText.trim().slice(1, -1)}*`;
      } else if (atk.damage) {
        // Couldn't parse — show raw string so GM can roll manually
        damageLine = `**Damage**\n*Couldn't auto-roll \`${atk.damage}\` — please roll manually.*`;
      }

      const acBreakdown = baseTargetAc !== null && targetMods.acBonus !== 0
        ? ` (base ${baseTargetAc}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAc})`
        : '';
      let outcomeLine;
      if (degree === 'crit-success')      outcomeLine = `🎯 **Critical Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
      else if (degree === 'success')      outcomeLine = `✅ **Hit on ${target.name}!** AC ${effectiveTargetAc}${acBreakdown}`;
      else if (degree === 'failure')      outcomeLine = `❌ **Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
      else if (degree === 'crit-failure') outcomeLine = `💢 **Critical Miss on ${target.name}.** AC ${effectiveTargetAc}${acBreakdown}`;
      else                                outcomeLine = `🎯 Attack against **${target.name}** (AC unknown — GM decides)`;

      // 8. Apply damage on hit
      let hpLine = '';
      let deathPayload = null;
      let mentionLine = '';
      if (degree === 'success' || degree === 'crit-success') {
        const dmgResult = ca.applyDamage(channelId, target.name, finalDamage);
        const dyingNote = dmgResult?.displaySuffix ?? '';
        hpLine = target.isNpc
          ? `\n❤️ **${target.name}** took ${finalDamage} damage${dyingNote}`
          : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
        deathPayload = combatDeathPayload(dmgResult);
      }
      if (!target.isNpc && target.ownerId) mentionLine = `<@${target.ownerId}>`;

      // 9. Record attack for MAP tracking (only if MAP wasn't manually overridden)
      if (explicitMap === null) {
        ca.recordAttack(channelId, attacker.name);
      }

      // 10. Reaction prompt for the target (Reactive Strike, Shield Block, etc.)
      let reactionPromptRow = null;
      let reactionPromptContent = '';
      if (target && target.hasReaction !== false && ca.hasReactionAvailable(target)) {
        if (target.name.toLowerCase() !== attacker.name.toLowerCase()) {
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
        .setTitle(`${attacker.name} attacks with ${atk.name}!${traitsText}`)
        .setDescription(description)
        .setFooter({ text: `${atk.name} ${fmt(baseAttackBonus)} · ${atk.damage}` });

      const replyPayload = { embeds: [embed, ...(deathPayload?.embeds ?? [])].slice(0, 10) };
      let content = (mentionLine || '').trim();
      if (reactionPromptContent) content = (content + reactionPromptContent).trim();
      if (content) replyPayload.content = content;
      if (reactionPromptRow) replyPayload.components = [reactionPromptRow];

      await interaction.reply(replyPayload);
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

      const lines = [`▶ It's **${current.name}**'s turn! ${mention}`];

      // Show new round banner
      if (result.newRound) {
        lines.push(`**Round ${enc.round}** — all reactions refreshed.`);
      }

      // Show expired effects
      if (result.expiredEffects && result.expiredEffects.length > 0) {
        const expiredText = result.expiredEffects.map(x => `**${x.effect.name}** on **${x.combatantName}**`).join(', ');
        lines.push(`Expired: ${expiredText}`);
      }

      // Show persistent damage results from outgoing combatant
      if (result.persistentResults && result.persistentResults.length > 0) {
        for (const pr of result.persistentResults) {
          const flatStatus = pr.ended
            ? `*Flat check ${pr.flatRoll} ≥ ${pr.flatDc} — condition ends.*`
            : `*Flat check ${pr.flatRoll} < ${pr.flatDc} — persists.*`;
          const dyingTag = pr.died ? ' **Dead!**' : pr.wentDown ? ` (Dying ${pr.dying})` : '';
          lines.push(`**${pr.name}** persistent: ${pr.damageDice}[${pr.damageRolls.join(',')}] = ${pr.damage} ${pr.damageType} damage${dyingTag}\n${flatStatus}`);
        }
      }

      // Hint to the GM if the combatant is dying but the check didn't fire
      // (shouldn't happen, but diagnostic aid for the user)
      if ((current.dying ?? 0) > 0 && !result.recoveryCheck) {
        lines.push(`*${current.name} is Dying ${current.dying} but no recovery check auto-rolled. Use \`/init recovery name:${current.name}\` to force a roll.*`);
      }

      // ── Action economy at start of turn ────────────────────────────
      // PF2e: Slowed N → lose N actions. Quickened → +1 action.
      // Stunned N → lose N actions, then reduce stunned by N (capped at 0).
      // We surface this immediately so the player and GM see it on turn start.
      // Stunned auto-decrements after announcing.
      if (current.effects && current.effects.length > 0) {
        const slowed = current.effects.find(e => e.presetKey === 'slowed');
        const quickened = current.effects.find(e => e.presetKey === 'quickened');
        const stunned = current.effects.find(e => e.presetKey === 'stunned');

        const actionNotes = [];
        let netActions = 3;
        if (slowed?.value) {
          netActions -= slowed.value;
          actionNotes.push(`Slowed ${slowed.value}`);
        }
        if (stunned?.value) {
          const lost = Math.min(stunned.value, netActions);
          netActions -= lost;
          // Auto-decrement stunned by the actions lost (PF2e RAW)
          const stunnedRemaining = Math.max(0, stunned.value - lost);
          if (stunnedRemaining === 0) {
            // Remove the stunned effect entirely
            current.effects = current.effects.filter(e => e !== stunned);
            actionNotes.push(`Stunned ${stunned.value} (lost ${lost} actions; Stunned cleared)`);
          } else {
            stunned.value = stunnedRemaining;
            actionNotes.push(`Stunned ${stunned.value + lost} → ${stunnedRemaining} (lost ${lost} actions)`);
          }
        }
        if (quickened) {
          netActions += 1;
          actionNotes.push('Quickened (+1 action)');
        }
        if (actionNotes.length > 0) {
          netActions = Math.max(0, netActions);
          lines.push(`⚡ **${current.name}** has ${netActions} action${netActions === 1 ? '' : 's'} this turn — *${actionNotes.join(', ')}*`);
        }
      }

      const deathEmbeds = [];
      for (const pr of result.persistentResults ?? []) {
        const deathPayload = combatDeathPayload(pr);
        if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
      }
      const replyPayload = { content: lines.join('\n') };
      if (result.recoveryCheck) {
        const payload = buildRecoveryCheckPayload(result.recoveryCheck, current);
        replyPayload.embeds = payload.embeds;
        if (payload.components.length) replyPayload.components = payload.components;
        const deathPayload = combatDeathPayload(result.recoveryCheck);
        if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
      }
      if (deathEmbeds.length) replyPayload.embeds = [...(replyPayload.embeds ?? []), ...deathEmbeds].slice(0, 10);

      await interaction.reply(replyPayload);
      await updateSummary(interaction.channel, enc);
      return;
    }

    if (sub === 'list') {
      // /init list shows MORE detail than the pinned summary embed:
      // full effect descriptions (with modifiers and durations) and explicit
      // dying/wounded/doomed/unconscious flags. Useful for "what's actually
      // going on" mid-fight when the summary line is too compact.
      //
      // The summary part now uses pagination so big encounters don't blow
      // past Discord's description limit. /init list shows the natural page
      // (current turn) just like the pinned summary.
      const { embed: summaryEmbed, page, totalPages } = buildInitiativeEmbed(enc);
      const detailLines = [];
      for (const c of enc.combatants) {
        const flags = [];
        if ((c.dying ?? 0) > 0)   flags.push(`💀 Dying ${c.dying}`);
        if ((c.wounded ?? 0) > 0) flags.push(`🩸 Wounded ${c.wounded}`);
        if ((c.doomed ?? 0) > 0)  flags.push(`⚰️ Doomed ${c.doomed}`);
        if (c.unconscious === true && (c.dying ?? 0) === 0) flags.push('😴 Unconscious');
        const flagText = flags.length > 0 ? ` · ${flags.join(' · ')}` : '';

        const effectDetails = (c.effects ?? []).map(e => {
          if (e.kind === 'persistent-damage' || e.modifiers?.kind === 'persistent-damage') {
            const dice = e.modifiers?.dice ?? e.dice ?? '?';
            const dtype = e.modifiers?.damageType ?? e.damageType ?? 'damage';
            const dc = e.modifiers?.dc ?? e.dc ?? 15;
            return `   🩸 Persistent ${dice} ${dtype} (DC ${dc} flat to end)`;
          }
          const value = e.value ?? '';
          const dur = e.duration !== null && e.duration !== undefined ? ` — ${e.duration}r left` : '';
          const desc = e.modifiers?.description ? ` *(${e.modifiers.description})*` : '';
          return `   • **${e.name}${value ? ' ' + value : ''}**${dur}${desc}`;
        });
        if (flags.length > 0 || effectDetails.length > 0) {
          detailLines.push(`**${c.name}**${flagText}\n${effectDetails.join('\n')}`.trim());
        }
      }
      const buttons = buildInitiativeButtons(channelId, page, totalPages);
      const replyPayload = { embeds: [summaryEmbed] };
      if (buttons) replyPayload.components = [buttons];
      if (detailLines.length > 0) {
        const detailEmbed = new EmbedBuilder()
          .setColor(0x9B59B6)
          .setTitle('🌀 Active Effects & Conditions')
          .setDescription(detailLines.join('\n\n').slice(0, 4000));
        replyPayload.embeds.push(detailEmbed);
      }
      return interaction.reply(replyPayload);
    }

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
      await interaction.reply({
        content: `❤️ **${combatant.name}** ${verb} ${amount} → ${combatant.hp}/${combatant.maxHp} HP${dyingNote}`,
        ...(combatDeathPayload(result) ?? {}),
      });
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

      // ── Sync core PF2e tracked-field conditions to the combatant ─────
      // Doomed and Wounded need to be on the combatant directly (not just in
      // the effects array) because combatAutomation reads them for dying math.
      // Setting these via /init effect is the same as setting them via a
      // dedicated subcommand — we just keep the surface small.
      if (preset?.key === 'doomed') {
        target.doomed = effect.value ?? 1;
      } else if (preset?.key === 'wounded') {
        target.wounded = effect.value ?? 1;
      } else if (preset?.key === 'unconscious') {
        target.unconscious = true;
      }

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

      // Sync PF2e tracked-field conditions when removing the effect.
      if (result.effect.presetKey === 'doomed')      target.doomed = 0;
      else if (result.effect.presetKey === 'wounded') target.wounded = 0;
      else if (result.effect.presetKey === 'unconscious') target.unconscious = false;

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
      const deathEmbeds = [];
      for (const pr of persistentResults) {
        const flatStatus = pr.ended
          ? `🩹 *Flat check ${pr.flatRoll} ≥ ${pr.flatDc} — condition ends.*`
          : `🔁 *Flat check ${pr.flatRoll} < ${pr.flatDc} — persists.*`;
        const dyingTag = pr.died ? ' ☠️ **Dead!**' : pr.wentDown ? ` 💀 (Dying ${pr.dying})` : '';
        lines.push(`**${pr.name}**: ${pr.damageDice}[${pr.damageRolls.join(',')}] = ${pr.damage} ${pr.damageType}${dyingTag}\n${flatStatus}`);
        const deathPayload = combatDeathPayload(pr);
        if (deathPayload?.embeds?.length) deathEmbeds.push(...deathPayload.embeds);
      }
      const replyPayload = { content: lines.join('\n') };
      if (deathEmbeds.length) replyPayload.embeds = deathEmbeds.slice(0, 10);
      await interaction.reply(replyPayload);
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init dying ──
    // Manually set a combatant's dying value (override the auto-applied value
    // for cases like a critical effect that bumps dying directly, or a GM
    // marking someone dying who isn't tracked through normal damage).
    //
    // PF2e RAW: setting dying to 0 from above 0 does NOT regain HP — the character
    // remains unconscious at 0 HP until something heals them. We follow RAW.
    if (sub === 'dying') {
      if (userId !== enc.gmId) return interaction.reply({ content: '❌ Only the GM can override dying values.', ephemeral: true });
      const targetName = interaction.options.getString('name');
      const value = interaction.options.getInteger('value');
      const target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) return interaction.reply({ content: `❌ No combatant named "${targetName}".`, ephemeral: true });
      if (value < 0 || value > 4) return interaction.reply({ content: '❌ Dying value must be 0–4.', ephemeral: true });

      const maxDying = Math.max(1, 4 - (target.doomed ?? 0));
      const before = target.dying ?? 0;
      target.dying = value;
      let extra = '';
      if (value === 0 && before > 0) {
        // Recovered from dying — gain Wounded 1 (or +1 if already wounded).
        // Per RAW, do NOT auto-restore HP; the character is unconscious at 0 HP.
        target.wounded = (target.wounded ?? 0) + 1;
        if ((target.hp ?? 0) <= 0) {
          target.unconscious = true;
          extra = ` ✨ Recovered from dying (now Wounded ${target.wounded}, still unconscious at 0 HP — needs healing to wake)`;
        } else {
          target.unconscious = false;
          extra = ` ✨ Recovered from dying (now Wounded ${target.wounded})`;
        }
      } else if (value >= maxDying) {
        target.dying = maxDying;
        extra = target.doomed > 0
          ? ` ☠️ **Dead!** (Doomed ${target.doomed} → death at Dying ${maxDying})`
          : ' ☠️ **Dead!**';
      }
      const deathPayload = value >= maxDying ? combatDeathPayload({ died: true, name: target.name }) : null;
      if (value >= maxDying) removeCombatant(channelId, target.name);
      await interaction.reply({
        content: `💀 **${target.name}** dying set to ${value} (was ${before}).${extra}`,
        ...(deathPayload ?? {}),
      });
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
      const deathPayload = combatDeathPayload(rc);
      if (deathPayload?.embeds?.length) payload.embeds = [...(payload.embeds ?? []), ...deathPayload.embeds].slice(0, 10);
      await interaction.reply(payload);
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init delay ──
    // PF2e Player Core p. 469: When it's your turn, you may take the Delay
    // action. Your turn ends, you're set aside, and you can rejoin at any
    // point before your next normal turn. Implemented as a flag on the
    // combatant; turn rotation skips delayed combatants.
    //
    // NOTE: Until this subcommand is registered with Discord (via deploy.js
    // or the Dev Portal), users won't see it. The handler is here and ready.
    if (sub === 'delay') {
      const current = enc.combatants[enc.turnIndex];
      if (!current) return interaction.reply({ content: '❌ No active combatant to delay.', ephemeral: true });
      // Permission: only the current combatant's owner (or GM) can delay
      const isOwner = !current.isNpc && interaction.user.id === current.ownerId;
      const isGm = interaction.user.id === enc.gmId;
      if (!isOwner && !isGm) {
        return interaction.reply({ content: `❌ Only ${current.name}'s controller (or GM) can have them delay.`, ephemeral: true });
      }
      if (current.delayed) {
        return interaction.reply({ content: `❌ **${current.name}** is already delayed.`, ephemeral: true });
      }

      // Use encounters.js delay function (also advances turn past delayed combatants)
      const result = delayCombatant(channelId);
      if (!result) return interaction.reply({ content: '❌ Could not delay.', ephemeral: true });

      const newCurrent = result.current;
      const newMention = newCurrent.isNpc ? `<@${enc.gmId}>` : `<@${newCurrent.ownerId}>`;
      const lines = [
        `⏸️ **${current.name}** delays. They'll rejoin with \`/init rejoin\`.`,
        `🎯 It's **${newCurrent.name}**'s turn! ${newMention}`,
      ];
      // Show expired effects on the new current combatant
      if (result.expiredEffects && result.expiredEffects.length > 0) {
        const expiredText = result.expiredEffects.map(x => `**${x.effect.name}** on **${x.combatantName}**`).join(', ');
        lines.push(`⏳ Expired: ${expiredText}`);
      }
      await interaction.reply(lines.join('\n'));
      await updateSummary(interaction.channel, enc);
      return;
    }

    // ── /init rejoin ──
    // A delayed combatant returns to initiative. Optional `before:` parameter
    // sets initiative just before the named target. Without it, they rejoin
    // immediately before the current combatant (taking their turn now).
    if (sub === 'rejoin') {
      const rejoinerName = interaction.options.getString('name');
      const rejoiner = enc.combatants.find(c => c.name.toLowerCase() === rejoinerName.toLowerCase());
      if (!rejoiner) return interaction.reply({ content: `❌ No combatant named "${rejoinerName}".`, ephemeral: true });
      if (!rejoiner.delayed) {
        return interaction.reply({ content: `❌ **${rejoiner.name}** isn't delayed. (Are they trying to use /init next?)`, ephemeral: true });
      }
      const isOwner = !rejoiner.isNpc && interaction.user.id === rejoiner.ownerId;
      const isGm = interaction.user.id === enc.gmId;
      if (!isOwner && !isGm) {
        return interaction.reply({ content: `❌ Only ${rejoiner.name}'s controller (or GM) can have them rejoin.`, ephemeral: true });
      }

      const beforeName = interaction.options.getString('target');
      const result = rejoinFromDelay(channelId, rejoiner.name, beforeName);
      if (!result || !result.ok) {
        const reason = result?.reason === 'before-not-found'
          ? `❌ No combatant named "${beforeName}" to rejoin before.`
          : `❌ Could not rejoin.`;
        return interaction.reply({ content: reason, ephemeral: true });
      }

      const mention = rejoiner.isNpc ? `<@${enc.gmId}>` : `<@${rejoiner.ownerId}>`;
      const beforeText = beforeName ? ` (just before **${beforeName}**)` : '';
      await interaction.reply(`▶️ **${rejoiner.name}** rejoins initiative at **${result.newInit.toFixed(3)}**${beforeText}. ${mention}, take your turn!`);
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
    const weapons = getCharacterWeapons(charEntry);

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
    let deathPayload = null;
    let mentionLine = '';
    if (target && (targetDegree === 'success' || targetDegree === 'crit-success')) {
      const dmgResult = ca.applyDamage(channelId, target.name, finalDamage);
      const dyingNote = dmgResult?.displaySuffix ?? '';
      hpLine = target.isNpc
        ? `\n❤️ **${target.name}** took ${finalDamage} damage${dyingNote}`
        : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
      deathPayload = combatDeathPayload(dmgResult);
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

    const replyPayload = { embeds: [embed, ...(deathPayload?.embeds ?? [])].slice(0, 10) };
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
      await saveMonsterAttacks(store);
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
      await saveMonsterAttacks(store);
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
      await saveMonsterAttacks(store);
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
      await saveMonsterAttacks(store);
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
        const libEntry = guild[key];

        // Pull bestiary attacks too (with library overlay applied so user
        // overrides show through). Without this, /m attack list would say
        // "no attacks" for canonical creatures like Aasimar Redeemer that
        // have built-in attacks in the bestiary.
        const { monster } = findMonster(displayName);
        let bestiaryAttacks = [];
        if (monster) {
          const edits = getMonsterEdit(guildId, monster.name);
          const edited = applyMonsterEdits(monster, edits);
          const withLibrary = applyMonsterAttackLibrary(edited, guildId);
          const rawAttacks = Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
          // Normalize bestiary schema → rolling schema (kind/bonus/damage/type)
          bestiaryAttacks = rawAttacks.map(a => normalizeAttackForRolling(a));
        }
        const libAttacks = libEntry?.attacks ?? [];

        // Use bestiary list if available (already includes library overlay);
        // fall back to library-only for pure homebrew.
        const allAttacks = bestiaryAttacks.length > 0 ? bestiaryAttacks : libAttacks;

        if (allAttacks.length === 0) {
          return interaction.reply({
            content: `❌ No attacks for **${displayName}** in the bestiary or saved library.`,
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0x8B0000)
          .setTitle(`${displayName} — Available Attacks`)
          .setFooter({ text: `${allAttacks.length} attack${allAttacks.length === 1 ? '' : 's'} · /m attack use to roll` });
        for (const a of allAttacks) {
          let line;
          if (a.kind === 'save') {
            line = `DC ${a.saveDC} ${a.saveType} · ${a.damage} ${a.damageType ?? 'damage'}`;
          } else {
            const traitText = a.traits?.length ? ` *(${a.traits.join(', ')})*` : '';
            const extra = a.extraDamage ? ` + ${a.extraDamage} ${a.extraType ?? ''}`.trimEnd() : '';
            line = `${fmt(a.bonus)} · ${a.damage} ${a.damageType ?? ''}${extra}${traitText}`;
          }
          embed.addFields({ name: a.name, value: line, inline: false });
        }
        return interaction.reply({ embeds: [embed] });
      }
      // List all monsters in the saved library (bestiary list is too big).
      const entries = Object.values(guild);
      if (entries.length === 0) return interaction.reply({ content: `📖 No saved monsters in the library yet.\n\nNote: Bestiary creatures already have their attacks built in — try \`/m attack use attacker:<combatant> monster:Goblin Warrior attack:dogslicer\` directly.\n\nUse \`/m attack add\` to save custom or homebrew attacks.`, ephemeral: true });
      entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
      const lines = entries.map(e => `• **${e.displayName}** — ${e.attacks.length} custom attack${e.attacks.length === 1 ? '' : 's'}`);
      const embed = new EmbedBuilder()
        .setColor(0x8B0000)
        .setTitle(`Saved Library (${entries.length} monster${entries.length === 1 ? '' : 's'})`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'These are CUSTOM saved attacks. Bestiary creatures have their attacks built-in.' });
      return interaction.reply({ embeds: [embed] });
    }

    // ── use ──
    // Designed to work in TWO modes:
    //
    //   1. INSIDE initiative (encounter active in this channel):
    //      attacker is matched against combatants. MAP, effect modifiers, and
    //      target AC/effects all flow through. /init attack-style behavior.
    //
    //   2. OUTSIDE initiative (no encounter, or attacker not in encounter):
    //      attacker is treated as a bestiary name. Standalone roll — no MAP,
    //      no per-combatant effect modifiers. target can be a PC combatant
    //      name (if encounter exists) or omitted (just shows raw attack roll
    //      and damage; the GM narrates).
    //
    // The `monster` parameter is OPTIONAL. When omitted, we look up the
    // attacker's bestiary entry (so the common case is just /m attack use
    // attacker:Aasimar Redeemer attack:longsword). Provide `monster` only
    // when you want to use a DIFFERENT monster's attack library (rare).
    if (sub === 'use') {
      const attackerName = interaction.options.getString('attacker');
      const monsterInputRaw = interaction.options.getString('monster'); // may be null
      const attackQuery = interaction.options.getString('attack');
      const targetName = interaction.options.getString('target');
      const explicitMap = interaction.options.getInteger('map'); // null if unset

      const channelId = interaction.channel.id;
      const enc = getEncounter(channelId);

      // Try to find the attacker as a combatant first. If we find them,
      // we're in "init mode" — MAP and effects flow. Otherwise we treat the
      // attacker name as a bestiary lookup for "out of init" mode.
      const attacker = enc?.combatants.find(x => x.name.toLowerCase() === attackerName.toLowerCase()) ?? null;
      const inInit = !!attacker;

      // Resolve which monster's attack library to consult:
      //   • If `monster` was provided explicitly → use that name.
      //   • Else if attacker is a combatant with a bestiaryKey → use that.
      //   • Else → fall back to the attacker name itself.
      const lookupName = monsterInputRaw ?? attacker?.bestiaryKey ?? attackerName;
      const displayName = resolveMonsterDisplayName(lookupName);
      const { monster } = findMonster(displayName);

      // Collect bestiary built-in attacks (already merged with library overlay).
      // The bestiary parser stores attacks in a DIFFERENT shape than the
      // library: `{ type, name, to_hit, traits, damage: "1d8+7 slashing plus..." }`
      // vs the library's `{ kind, name, bonus, damage, damageType, ... }`.
      // We normalize bestiary attacks here so the strike/spell/save rolling
      // code below can treat them uniformly.
      let bestiaryAttacks = [];
      if (monster) {
        const edits = getMonsterEdit(guildId, monster.name);
        const edited = applyMonsterEdits(monster, edits);
        const withLibrary = applyMonsterAttackLibrary(edited, guildId);
        const rawAttacks = Array.isArray(withLibrary?.rich?.attacks) ? withLibrary.rich.attacks : [];
        bestiaryAttacks = rawAttacks.map(a => normalizeAttackForRolling(a));
      }
      // Library fallback for pure homebrew (monster not in bestiary). These
      // already have the right shape (kind/bonus/damage/damageType).
      const store = loadMonsterAttacks();
      const guild = getGuildMonsters(store, guildId);
      const libEntry = guild[monsterKey(displayName)];
      const libAttacks = libEntry?.attacks ?? [];
      const allAttacks = bestiaryAttacks.length > 0 ? bestiaryAttacks : libAttacks;

      if (allAttacks.length === 0) {
        return interaction.reply({
          content: `❌ **${displayName}** has no attacks in the bestiary or saved library. Use \`/m attack add\` to define one.`,
          ephemeral: true,
        });
      }

      // Find the requested attack: exact match → unambiguous substring.
      const q = String(attackQuery ?? '').toLowerCase().trim();
      let attack = allAttacks.find(a => String(a.name ?? '').toLowerCase() === q);
      if (!attack) {
        const partial = allAttacks.filter(a => String(a.name ?? '').toLowerCase().includes(q));
        if (partial.length === 1) attack = partial[0];
        else if (partial.length > 1) {
          return interaction.reply({
            content: `🔍 Multiple attacks match "${attackQuery}" on **${displayName}**: ${partial.map(a => `\`${a.name}\``).join(', ')}. Be more specific.`,
            ephemeral: true,
          });
        }
      }
      if (!attack) {
        const available = allAttacks.map(a => `\`${a.name}\``).join(', ');
        return interaction.reply({
          content: `❌ **${displayName}** has no attack matching "${attackQuery}".\nAvailable: ${available}`,
          ephemeral: true,
        });
      }

      // Resolve target: ONLY meaningful in init mode. Out of init, target is
      // just a label string we'll mention in the embed (or null if omitted).
      let target = null;
      if (targetName && enc) {
        target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase()) ?? null;
        // If targetName was given but didn't match a combatant, don't error —
        // just treat it as a label. Useful for "/m attack use ... target:that goblin"
        // when describing things narratively.
      }

      // ─── Strike / Spell Attack ───
      if (attack.kind === 'strike' || attack.kind === 'spell') {
        // Out-of-init mode: target is optional. Without a target we just roll
        // attack + damage and let the GM narrate. With a target name (no
        // matching combatant) we use the name as a label.
        const attackerLabel = inInit ? attacker.name : displayName;
        const targetLabel = target?.name ?? targetName ?? null;

        const agile = attack.traits?.includes('agile') ?? false;
        // MAP only tracked in init mode. Out of init, MAP must be manually
        // specified or it defaults to 0 (first attack).
        let mapPenalty = 0, mapNoteText = null;
        if (explicitMap !== null) {
          mapPenalty = calculateMap(explicitMap, agile);
          mapNoteText = explicitMap > 0 ? `MAP ${mapPenalty} (manual)` : null;
        } else if (inInit) {
          const mapInfo = ca.computeMapForNextAttack(attacker, agile);
          mapPenalty = mapInfo.penalty;
          mapNoteText = mapInfo.noteText;
        }

        // Effect modifiers only apply in init (and only when both attacker
        // and target are combatants).
        const attackerMods = inInit ? sumEffectModifiers(attacker)
          : { attackBonus: 0, damageBonus: 0, acBonus: 0, activeEffects: [] };
        const targetMods = (inInit && target) ? sumEffectModifiers(target)
          : { attackBonus: 0, damageBonus: 0, acBonus: 0, activeEffects: [] };

        const dieRoll = Math.floor(Math.random() * 20) + 1;
        const attackTotal = dieRoll + attack.bonus + mapPenalty + attackerMods.attackBonus;
        const baseTargetAc = target?.ac ?? null;
        const effectiveTargetAc = baseTargetAc !== null ? baseTargetAc + targetMods.acBonus : null;
        const degree = effectiveTargetAc !== null ? determineDegreeOfSuccess(attackTotal, dieRoll, effectiveTargetAc) : null;

        const mapText = mapPenalty !== 0 ? ` ${mapPenalty}` : '';
        const attackerEffectText = formatEffectContributions(attackerMods.activeEffects, 'attack');
        const rollLabel = attack.kind === 'spell' ? 'Spell Attack Roll' : 'Attack Roll';
        let attackLine = `**${rollLabel}**\n1d20 (${dieRoll}) ${fmt(attack.bonus)}${mapText}${attackerEffectText ? ` ${fmt(attackerMods.attackBonus)}` : ''} = **${attackTotal}**`;
        if (mapNoteText) attackLine += `\n*${mapNoteText}*`;
        if (attackerEffectText) attackLine += `\n*${attackerEffectText.trim().slice(1, -1)}*`;
        if (dieRoll === 20) attackLine += '\nNatural 20!';
        if (dieRoll === 1)  attackLine += '\nNatural 1!';

        // Main damage
        const damageResult = rollDamageExpression(attack.damage);
        const totalDamageBonus = attackerMods.damageBonus;
        let mainDamage = Math.max(1, damageResult.total + totalDamageBonus);
        const damageContribText = formatEffectContributions(attackerMods.activeEffects, 'damage');
        let extraDamageResult = null;
        if (attack.extraDamage) extraDamageResult = rollDamageExpression(attack.extraDamage);

        let damageLine;
        let totalDealt;
        if (degree === 'crit-success') {
          mainDamage = mainDamage * 2;
          const extraDoubled = extraDamageResult ? extraDamageResult.total * 2 : 0;
          totalDealt = mainDamage + extraDoubled;
          damageLine = `**Damage (CRIT × 2)**\n${damageResult.display}${totalDamageBonus ? ` ${fmt(totalDamageBonus)}` : ''} = ${damageResult.total + totalDamageBonus} × 2 = **${mainDamage} ${attack.damageType ?? ''}**`.trimEnd();
          if (extraDamageResult) damageLine += `\n+ ${extraDamageResult.display} × 2 = **${extraDoubled} ${attack.extraType ?? ''}**`.trimEnd();
        } else {
          const extraBase = extraDamageResult ? extraDamageResult.total : 0;
          totalDealt = mainDamage + extraBase;
          damageLine = `**Damage**\n${damageResult.display}${totalDamageBonus ? ` ${fmt(totalDamageBonus)}` : ''} = **${mainDamage} ${attack.damageType ?? ''}**`.trimEnd();
          if (extraDamageResult) damageLine += `\n+ ${extraDamageResult.display} = **${extraBase} ${attack.extraType ?? ''}**`.trimEnd();
        }
        if (damageContribText) damageLine += `\n*${damageContribText.trim().slice(1, -1)}*`;

        const acBreakdown = baseTargetAc !== null && targetMods.acBonus !== 0
          ? ` (base ${baseTargetAc}${fmt(targetMods.acBonus)} from effects = ${effectiveTargetAc})`
          : '';
        let outcomeLine;
        if (targetLabel && degree !== null) {
          if (degree === 'crit-success')      outcomeLine = `**Critical Hit on ${targetLabel}!** AC ${effectiveTargetAc}${acBreakdown}`;
          else if (degree === 'success')      outcomeLine = `**Hit on ${targetLabel}!** AC ${effectiveTargetAc}${acBreakdown}`;
          else if (degree === 'failure')      outcomeLine = `**Miss on ${targetLabel}.** AC ${effectiveTargetAc}${acBreakdown}`;
          else                                outcomeLine = `**Critical Miss on ${targetLabel}.** AC ${effectiveTargetAc}${acBreakdown}`;
        } else if (targetLabel) {
          outcomeLine = `Attack against **${targetLabel}** (AC unknown — GM decides)`;
        } else {
          outcomeLine = `*GM: compare ${attackTotal} to target's AC.*`;
        }

        // HP application + mention only happens in init mode with a real target
        let hpLine = '';
        let deathPayload = null;
        let mentionLine = '';
        if (inInit && target && (degree === 'success' || degree === 'crit-success')) {
          const dmgResult = ca.applyDamage(channelId, target.name, totalDealt);
          const dyingNote = dmgResult?.displaySuffix ?? '';
          hpLine = target.isNpc
            ? `\n**${target.name}** took ${totalDealt} damage${dyingNote}`
            : `\n**${target.name}**: ${target.hp}/${target.maxHp} HP${dyingNote}`;
          deathPayload = combatDeathPayload(dmgResult);
        }
        if (inInit && target && !target.isNpc && target.ownerId) mentionLine = `<@${target.ownerId}>`;

        const showDamage = (degree === 'success' || degree === 'crit-success' || degree === null);
        const description = [attackLine, '', showDamage ? damageLine : null, outcomeLine, hpLine || null].filter(s => s !== null).join('\n');

        const traitFooter = attack.traits?.length ? ` · ${attack.traits.join(', ')}` : '';
        const titlePrefix = inInit ? attackerLabel : `${displayName}'s`;
        const embed = new EmbedBuilder()
          .setColor(attack.kind === 'spell' ? 0x9B59B6 : 0x8B0000)
          .setTitle(`${titlePrefix} ${attack.name}!`)
          .setDescription(description)
          .setFooter({ text: `${displayName}${traitFooter} · ${fmt(attack.bonus)} · ${attack.damage} ${attack.damageType ?? ''}`.trim() });

        const replyPayload = { embeds: [embed, ...(deathPayload?.embeds ?? [])].slice(0, 10) };
        if (mentionLine) replyPayload.content = mentionLine;
        await interaction.reply(replyPayload);
        // Record attack for MAP tracking (only in init, only if MAP wasn't manual)
        if (inInit && explicitMap === null) {
          ca.recordAttack(channelId, attacker.name);
        }
        if (inInit) await updateSummary(interaction.channel, enc);
        return;
      }

      // ─── Save-based (breath weapon, aura, AoE) ───
      if (attack.kind === 'save') {
        const damageResult = rollDamageExpression(attack.damage);
        const saveDisplay = attack.saveType.charAt(0).toUpperCase() + attack.saveType.slice(1);
        // Target line works for both modes: combatant name, free text label, or no target.
        const targetText = target?.name ?? targetName ?? null;
        const targetLine = targetText ? ` against **${targetText}**` : '';
        const mentionLine = (target && !target.isNpc && target.ownerId) ? `<@${target.ownerId}>` : '';

        const description =
          `**${saveDisplay} Save DC ${attack.saveDC}**${targetLine}\n\n` +
          `**Damage Rolled:** ${damageResult.display} = **${damageResult.total} ${attack.damageType ?? ''}**\n\n` +
          `• Crit Success → **0** damage\n` +
          `• Success → **${Math.floor(damageResult.total / 2)}** damage (half)\n` +
          `• Failure → **${damageResult.total}** damage (full)\n` +
          `• Crit Failure → **${damageResult.total * 2}** damage (double)\n\n` +
          `*${targetText ?? 'Target(s)'}, tap the button below to roll your save — or use \`/save type:${attack.saveType}\` manually.*`;

        const titlePrefix = inInit ? attacker.name : displayName;
        const embed = new EmbedBuilder()
          .setColor(0xD35400)
          .setTitle(`${titlePrefix} uses ${attack.name}!`)
          .setDescription(description)
          .setFooter({ text: `${displayName} · DC ${attack.saveDC} ${attack.saveType} · ${attack.damage} ${attack.damageType ?? ''}`.trim() });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`msave_${attack.saveType}_${attack.saveDC}`)
            .setLabel(`Roll ${saveDisplay} Save (DC ${attack.saveDC})`)
            .setStyle(ButtonStyle.Primary)
        );

        const replyPayload = { embeds: [embed], components: [row] };
        if (mentionLine) replyPayload.content = mentionLine;
        await interaction.reply(replyPayload);
        return;
      }

      return interaction.reply({ content: `❌ Unknown attack kind "${attack.kind}".`, ephemeral: true });
    }
  }

  // ─── /downtime ────────────────────────────────────────────────────
  // Standalone PF2e downtime activity commands from Downtime Activities-2.pdf.
  else if (commandName === 'income') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const skillName = interaction.options.getString('skill');
    const taskLevel = interaction.options.getInteger('task_level');
    const days = interaction.options.getInteger('days') ?? 1;
    const bonus = interaction.options.getInteger('bonus') ?? 0;
    const skill = getDowntimeSkillModifier(c, skillName);
    if (skill.error) return interaction.reply({ content: skill.error });
    if (skill.profNum === 0) return interaction.reply({ content: `${c.name ?? 'This character'} must be trained in ${skill.skill} to Earn Income.` });

    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, `Earn Income (${skill.skill})`);
    if (!spend.ok) return interaction.reply(spend.reply);
    const dc = downtime.taskLevelDC(taskLevel);
    const roll = downtimeRoll(skill.total, dc, bonus);
    const outcome = roll.degree === 'criticalSuccess' ? 'crit-success' : roll.degree === 'criticalFailure' ? 'crit-failure' : roll.degree;
    const dailyCp = downtime.dailyIncomeCopper({ taskLevel, profRank: skill.profNum, outcome });
    saveDowntime(store);

    const embed = new EmbedBuilder()
      .setColor(roll.degree === 'criticalFailure' ? 0xC0392B : roll.degree === 'failure' ? 0xE67E22 : 0x27AE60)
      .setTitle(`${c.name ?? 'Character'} Earns Income`)
      .setDescription(
        `**Skill:** ${skill.skill} (${skill.profRank})\n` +
        `**Task Level/DC:** ${taskLevel} / ${dc}\n` +
        `**Roll:** d20 (${roll.die}) ${fmt(skill.total)}${bonus ? ` ${fmt(bonus)}` : ''} = **${roll.total}**\n` +
        `**Result:** ${downtimeDegreeLabel(roll.degree)}\n` +
        `**Pay:** ${downtime.formatCopper(dailyCp)} per day x ${days} = **${downtime.formatCopper(dailyCp * days)}**\n` +
        `**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`
      );
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'forgery') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const days = interaction.options.getInteger('days') ?? 1;
    const bonus = interaction.options.getInteger('bonus') ?? 0;
    const document = interaction.options.getString('document');
    const skill = getDowntimeSkillModifier(c, 'society');
    if (skill.profNum === 0) return interaction.reply({ content: `${c.name ?? 'This character'} must be trained in Society to Create a Forgery.` });

    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, `Create Forgery (${document})`);
    if (!spend.ok) return interaction.reply(spend.reply);
    const roll = downtimeRoll(skill.total, 20, bonus);
    saveDowntime(store);

    const embed = new EmbedBuilder()
      .setColor(roll.total >= 20 ? 0x27AE60 : 0xE67E22)
      .setTitle(`${c.name ?? 'Character'} Creates a Forgery`)
      .setDescription(
        `**Document:** ${document}\n` +
        `**Secret Society Check:** d20 (${roll.die}) ${fmt(skill.total)}${bonus ? ` ${fmt(bonus)}` : ''} = **${roll.total}** vs DC **20**\n` +
        `**Quality:** ${roll.total >= 20 ? 'Good enough to fool passive observers unless closely examined.' : 'Obvious signs exist; compare this result to observer Perception DC or Society DC.'}\n` +
        `**Close scrutiny:** observers can still roll Perception or Society against your Society DC.\n` +
        `**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`
      );
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'craft') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const item = interaction.options.getString('item');
    const itemLevel = interaction.options.getInteger('item_level');
    const days = interaction.options.getInteger('days') ?? 4;
    const bonus = interaction.options.getInteger('bonus') ?? 0;
    const dc = interaction.options.getInteger('dc') ?? downtime.taskLevelDC(itemLevel);
    const skill = getDowntimeSkillModifier(c, 'crafting');
    if (skill.profNum === 0) return interaction.reply({ content: `${c.name ?? 'This character'} must be trained in Crafting to Craft items.` });

    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, `Craft ${item}`);
    if (!spend.ok) return interaction.reply(spend.reply);
    const roll = downtimeRoll(skill.total, dc, bonus);
    saveDowntime(store);

    const reductionLevel = roll.degree === 'criticalSuccess' ? Math.min(20, (c.level ?? 1) + 1) : (c.level ?? 1);
    const dailyReduction = ['criticalSuccess', 'success'].includes(roll.degree)
      ? downtime.dailyIncomeCopper({ taskLevel: reductionLevel, profRank: skill.profNum, outcome: 'success' })
      : 0;
    const resultText = {
      criticalSuccess: `You can complete it, or reduce remaining material cost by ${downtime.formatCopper(dailyReduction)} per extra day.`,
      success: `You can complete it, or reduce remaining material cost by ${downtime.formatCopper(dailyReduction)} per extra day.`,
      failure: 'You fail, but can salvage the supplied raw materials and start again.',
      criticalFailure: 'You fail and ruin 10% of the supplied raw materials.',
    }[roll.degree];
    const embed = new EmbedBuilder()
      .setColor(['criticalSuccess', 'success'].includes(roll.degree) ? 0x27AE60 : 0xC0392B)
      .setTitle(`${c.name ?? 'Character'} Crafts ${item}`)
      .setDescription(
        `**Item Level/DC:** ${itemLevel} / ${dc}\n` +
        `**Roll:** d20 (${roll.die}) ${fmt(skill.total)}${bonus ? ` ${fmt(bonus)}` : ''} = **${roll.total}**\n` +
        `**Result:** ${downtimeDegreeLabel(roll.degree)}\n${resultText}\n` +
        `**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`
      );
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'longrest') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const days = interaction.options.getInteger('days') ?? 1;
    const conMod = Math.floor((((c.abilities ?? {}).con ?? 10) - 10) / 2);
    const healingPerDay = Math.max(1, conMod) * 2 * Math.max(1, c.level ?? 1);
    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, 'Long-Term Rest');
    if (!spend.ok) return interaction.reply(spend.reply);
    saveDowntime(store);
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x27AE60)
        .setTitle(`${c.name ?? 'Character'} Takes Long-Term Rest`)
        .setDescription(`Recovered **${healingPerDay * days} HP** over ${days} day${days === 1 ? '' : 's'}.\nDowntime bank: **${spend.balance}**/${downtime.MAX_BANK}.`)],
    });
  }

  else if (commandName === 'treatdisease') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const target = interaction.options.getString('target');
    const dc = interaction.options.getInteger('dc');
    const days = interaction.options.getInteger('days') ?? 1;
    const bonus = interaction.options.getInteger('bonus') ?? 0;
    const skill = getDowntimeSkillModifier(c, 'medicine');
    if (skill.profNum === 0) return interaction.reply({ content: `${c.name ?? 'This character'} must be trained in Medicine to Treat Disease.` });
    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, `Treat Disease (${target})`);
    if (!spend.ok) return interaction.reply(spend.reply);
    const roll = downtimeRoll(skill.total, dc, bonus);
    saveDowntime(store);
    const resultText = {
      criticalSuccess: `${target} gains a +4 circumstance bonus to the next save against the disease.`,
      success: `${target} gains a +2 circumstance bonus to the next save against the disease.`,
      failure: `No benefit for ${target}.`,
      criticalFailure: `${target} takes a -2 circumstance penalty to the next save against the disease.`,
    }[roll.degree];
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(['criticalSuccess', 'success'].includes(roll.degree) ? 0x27AE60 : 0xC0392B)
        .setTitle(`${c.name ?? 'Character'} Treats Disease`)
        .setDescription(`**Target:** ${target}\n**Roll:** d20 (${roll.die}) ${fmt(skill.total)}${bonus ? ` ${fmt(bonus)}` : ''} = **${roll.total}** vs DC **${dc}**\n**Result:** ${downtimeDegreeLabel(roll.degree)}\n${resultText}\n**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`)],
    });
  }

  else if (SIMPLE_DOWNTIME_COMMANDS.has(commandName)) {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const skillName = interaction.options.getString('skill');
    const days = interaction.options.getInteger('days') ?? (commandName === 'learnname' ? 7 : 1);
    const bonus = interaction.options.getInteger('bonus') ?? 0;
    const dc = downtimeDcFromOptions(interaction, c.level ?? 1, ['bribe', 'forgedocuments'].includes(commandName) ? 'hard' : 'normal');
    const skill = getDowntimeSkillModifier(c, skillName);
    if (skill.error) return interaction.reply({ content: skill.error });

    const titleMap = {
      learnname: 'Learns a Name',
      subsist: 'Subsists',
      bribe: 'Bribes a Contact',
      forgedocuments: 'Forges Infiltration Documents',
      gaincontact: 'Gains a Contact',
      gossip: 'Gossips',
      scout: 'Scouts a Location',
      disguise: 'Secures Disguises',
      research: 'Performs Practical Research',
      study: 'Studies',
    };
    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, titleMap[commandName] ?? commandName);
    if (!spend.ok) return interaction.reply(spend.reply);
    const roll = downtimeRoll(skill.total, dc, bonus);
    saveDowntime(store);

    const guidance = {
      learnname: { criticalSuccess: 'You find private name information plus hidden fragments that may point toward a true name.', success: 'You find one private name or useful name clue.', failure: 'You find no useful name.', criticalFailure: 'You may alert the individual or uncover a dangerous/wrong name.' },
      subsist: { criticalSuccess: 'You provide for yourself and one extra creature, or improve your own living standard.', success: 'You find basic food and shelter.', failure: 'You are exposed and hungry, becoming fatigued until you get proper food and shelter.', criticalFailure: 'You attract trouble or worsen conditions; take a -2 penalty to Subsist for 1 week.' },
      bribe: { criticalSuccess: 'The contact accepts cleanly; GM may award 1 EP and extra leverage.', success: 'The contact accepts the bribe; gain 1 EP.', failure: 'You think it worked, but the contact informs the opposition; +1 AP.', criticalFailure: 'As failure, but the opposition gains +2 AP.' },
      forgedocuments: { criticalSuccess: 'Convincing paperwork; gain 1 paperwork-only EP, and GM may add extra confidence.', success: 'Convincing paperwork; gain 1 EP usable when presenting paperwork.', failure: 'Unconvincing documents; gain 1 false EP that secretly grants no benefit.', criticalFailure: 'A PC using this false EP treats the check as a critical failure.' },
      gaincontact: { criticalSuccess: 'You make an excellent contact; gain 1 EP and possible extra help.', success: 'You make contact and gain 1 EP.', failure: 'You fail to make contact.', criticalFailure: 'You insult or spook the contact; future attempts take a -2 penalty.' },
      gossip: { criticalSuccess: 'Inside information grants +2 to future prep checks for this infiltration.', success: 'You gain useful inside information.', failure: 'You learn nothing useful.', criticalFailure: 'Bad rumors give -2 to your next prep check and increase AP by 1.' },
      scout: { criticalSuccess: 'Strong observations; gain 1 EP and GM may provide extra detail.', success: 'Your observations provide 1 EP.', failure: 'You learn nothing noteworthy.', criticalFailure: 'You gain a false EP that causes a critical failure when used.' },
      disguise: { criticalSuccess: 'Excellent disguises; gain 1 cover-identity EP and GM may grant extra durability.', success: 'You get disguises; gain 1 EP usable to maintain a cover identity.', failure: 'The disguises are unusable.', criticalFailure: 'The disguises are flawed enough to create trouble when used.' },
      research: { criticalSuccess: 'You gain strong research results; GM may grant Study benefits and a unique opportunity.', success: 'You gain practical research results, usually including Study benefits.', failure: 'No meaningful research progress.', criticalFailure: 'You draw a bad conclusion or lose access to the opportunity.' },
      study: { criticalSuccess: 'Increase the chosen branch level by 2.', success: 'Increase the chosen branch level by 1.', failure: 'The branch level remains the same.', criticalFailure: 'You require remedial study and must skip the next opportunity.' },
    }[commandName]?.[roll.degree] ?? 'GM adjudicates the result.';

    const embed = new EmbedBuilder()
      .setColor(['criticalSuccess', 'success'].includes(roll.degree) ? 0x27AE60 : 0xC0392B)
      .setTitle(`${c.name ?? 'Character'} ${titleMap[commandName] ?? commandName}`)
      .setDescription(
        `**Skill:** ${skill.skill} (${skill.profRank})\n` +
        `**Roll:** d20 (${roll.die}) ${fmt(skill.total)}${bonus ? ` ${fmt(bonus)}` : ''} = **${roll.total}** vs DC **${dc}**\n` +
        `**Result:** ${downtimeDegreeLabel(roll.degree)}\n${guidance}\n` +
        `**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`
      );
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'cram' || commandName === 'retrain') {
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error });
    const c = charEntry.data ?? {};
    const days = interaction.options.getInteger('days') ?? (commandName === 'retrain' ? 7 : 1);
    const subject = commandName === 'cram' ? interaction.options.getString('branch') : interaction.options.getString('change');
    const store = loadDowntime();
    const spend = spendDowntimeDaysOrReply(store, interaction, userId, charKey, c.name ?? 'Character', days, commandName === 'cram' ? `Cram (${subject})` : `Retrain (${subject})`);
    if (!spend.ok) return interaction.reply(spend.reply);
    saveDowntime(store);
    const description = commandName === 'cram'
      ? `**Branch/topic:** ${subject}\nYou Study twice, but until your next Study downtime activity, each adventuring day starts with a DC 8 flat check or you are fatigued for that day.`
      : `**Change:** ${subject}\nMost feats, trained skills, and selected class features can be retrained with GM approval. You cannot normally retrain ancestry, heritage, background, class, or ability scores.`;
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x6f4e37)
        .setTitle(`${c.name ?? 'Character'} ${commandName === 'cram' ? 'Crams' : 'Retrains'}`)
        .setDescription(`${description}\n**Downtime bank:** ${spend.balance}/${downtime.MAX_BANK}`)],
    });
  }

  // PF2e downtime activity tracker. Real-life days advance activities
  // automatically; the GM can also award banked downtime days as quest
  // rewards. Currently supports Earn Income; more activities coming later.
  else if (commandName === 'downtime') {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const characters = loadCharacters();
    let store = loadDowntime();

    // Current downtime engine: a per-character bank of downtime days. The old
    // activity tracker code below is kept only as historical scaffolding, but
    // every registered downtime command is handled here and returns before it.
    if (['check', 'spend', 'grant', 'log', 'reset', 'on', 'off'].includes(sub)) {
      const charNameArg = interaction.options.getString('character');
      const { error, charKey, char: charEntry } = resolveChar(userId, charNameArg, characters);
      if (error) return interaction.reply({ content: error });

      const c = charEntry.data ?? {};
      const charName = c.name ?? charEntry.name ?? 'Character';

      if (sub === 'check') {
        const accrual = downtime.accrue(store, userId, charKey);
        const status = downtime.getStatus(store, userId, charKey);
        const recent = downtime.getLog(store, userId, charKey, 5);
        await saveDowntime(store);

        const accrualLine = accrual.added > 0
          ? `Added **${accrual.added}** day${accrual.added === 1 ? '' : 's'} since your last downtime check.`
          : 'No new downtime days accrued today.';
        const capLine = accrual.capped > 0
          ? `\n**${accrual.capped}** day${accrual.capped === 1 ? '' : 's'} hit the ${downtime.MAX_BANK}-day cap.`
          : '';
        const logLines = recent.length
          ? recent.map(e => {
              const sign = e.delta > 0 ? '+' : '';
              return `• ${sign}${e.delta} day${Math.abs(e.delta) === 1 ? '' : 's'} · ${e.kind} · balance ${e.balance} · ${e.reason ?? 'no reason'}`;
            }).join('\n')
          : '*No downtime history yet.*';

        const embed = new EmbedBuilder()
          .setColor(0x6f4e37)
          .setTitle(`🛠️ ${charName}'s Downtime`)
          .setDescription(
            `**Banked days:** ${status.bank}/${status.capacity}\n` +
            `**Automatic accrual:** ${status.autoAccrue ? 'On' : 'Off'}\n` +
            `${accrualLine}${capLine}\n\n` +
            `**Recent activity:**\n${logLines}`
          )
          .setFooter({ text: `Last accrual date: ${status.lastAccrualDate}` });
        if (charEntry.art) embed.setThumbnail(charEntry.art);
        return interaction.reply({ embeds: [embed] });
      }

      if (sub === 'on' || sub === 'off') {
        const enabled = sub === 'on';
        const result = downtime.setAutoAccrue(store, userId, charKey, enabled, userId);
        await saveDowntime(store);
        const accrualLine = result.accrual?.added > 0
          ? `\nCredited **${result.accrual.added}** pending day${result.accrual.added === 1 ? '' : 's'} while updating.`
          : '';
        const statusLine = result.changed
          ? `Automatic downtime accrual is now **${enabled ? 'ON' : 'OFF'}** for **${charName}**.`
          : `Automatic downtime accrual was already **${enabled ? 'ON' : 'OFF'}** for **${charName}**.`;
        return interaction.reply({
          content: `${statusLine}\nBank balance: **${result.balance}**/${downtime.MAX_BANK}.${accrualLine}`,
        });
      }

      if (sub === 'spend') {
        const days = interaction.options.getInteger('days');
        const reason = interaction.options.getString('reason');
        const result = downtime.spend(store, userId, charKey, days, reason, userId);
        if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
        await saveDowntime(store);
        return interaction.reply({
          content: `🪙 **${charName}** spent **${days}** downtime day${days === 1 ? '' : 's'} on **${reason}**.\nBank balance: **${result.balance}**/${downtime.MAX_BANK}.`,
        });
      }

      if (sub === 'grant') {
        const days = interaction.options.getInteger('days');
        const reason = interaction.options.getString('reason');
        const result = downtime.grant(store, userId, charKey, days, reason, userId);
        if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
        await saveDowntime(store);
        const capLine = result.capped > 0
          ? `\n${result.capped} day${result.capped === 1 ? '' : 's'} could not be added because the bank is capped at ${downtime.MAX_BANK}.`
          : '';
        return interaction.reply({
          content: `🪙 Added **${result.added}** downtime day${result.added === 1 ? '' : 's'} to **${charName}**: **${reason}**.\nBank balance: **${result.balance}**/${downtime.MAX_BANK}.${capLine}`,
        });
      }

      if (sub === 'log') {
        downtime.accrue(store, userId, charKey);
        const recent = downtime.getLog(store, userId, charKey, 10);
        await saveDowntime(store);
        const lines = recent.length
          ? recent.map(e => {
              const sign = e.delta > 0 ? '+' : '';
              const date = String(e.ts ?? '').slice(0, 10) || 'unknown date';
              return `• ${date} — ${sign}${e.delta} day${Math.abs(e.delta) === 1 ? '' : 's'} · ${e.kind} · balance ${e.balance} · ${e.reason ?? 'no reason'}`;
            }).join('\n')
          : '*No history yet.*';
        const embed = new EmbedBuilder()
          .setColor(0xF39C12)
          .setTitle(`🪙 ${charName}'s Downtime Log`)
          .setDescription(lines);
        return interaction.reply({ embeds: [embed] });
      }

      if (sub === 'reset') {
        const result = downtime.reset(store, userId, charKey, userId, 'manual reset');
        await saveDowntime(store);
        return interaction.reply({
          content: `🧹 Reset **${charName}**'s downtime bank from **${result.before}** to **0**.`,
        });
      }
    }

    return interaction.reply({
      content: `❌ This downtime subcommand is from an older command version. Try restarting Discord, then use \`/downtime check\`, \`/downtime spend\`, \`/downtime grant\`, \`/downtime log\`, or \`/downtime reset\`.`,
    });

    // ─── /downtime list — show available activities ───
    if (sub === 'list') {
      const lines = Object.entries(downtime.ACTIVITIES).map(([key, def]) =>
        `• **${def.name}** \`(${key})\` — ${def.summary} *(${def.source})*`
      );
      const embed = new EmbedBuilder()
        .setColor(0x6f4e37)
        .setTitle('🛠️ Available Downtime Activities')
        .setDescription(lines.join('\n') || 'No activities defined yet.')
        .setFooter({ text: 'Start with /downtime start' });
      return interaction.reply({ embeds: [embed] });
    }

    // For all other subcommands, we need the player's character.
    const charNameArg = interaction.options.getString('character');
    const { error, charKey, char: charEntry } = resolveChar(userId, charNameArg, characters);
    if (error) {
      return interaction.reply({ content: error });
    }
    const c = charEntry.data;

    // ─── /downtime start ──────────────────────────────
    if (sub === 'start') {
      const activityKey = interaction.options.getString('activity');
      const def = downtime.ACTIVITIES[activityKey];
      if (!def) {
        return interaction.reply({ content: `❌ Unknown activity "${activityKey}". Use \`/downtime list\` to see options.`, ephemeral: true });
      }

      // Currently only Earn Income — branch here when more activities exist.
      if (activityKey === 'earn-income') {
        const skillName = interaction.options.getString('skill');
        const taskLevel = interaction.options.getInteger('tasklevel');
        const plannedDays = interaction.options.getInteger('days');
        const extraBonus = interaction.options.getInteger('bonus') ?? 0;

        // Validate skill (use same map as /skill, plus Crafting/Lore-as-text)
        const skillMap = {
          acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
          deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
          nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
          society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
        };
        const lowerSkill = skillName.toLowerCase();
        if (!(lowerSkill in skillMap)) {
          return interaction.reply({ content: `❌ Unknown skill "${skillName}". Earn Income uses skills like Crafting, Performance, or any Lore.`, ephemeral: true });
        }

        // Compute character's modifier for the chosen skill
        const ab = c.abilities ?? {};
        const prof = c.proficiencies ?? {};
        const lvl = c.level ?? 1;
        const abilKey = skillMap[lowerSkill];
        const abilMod = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
        const profNum = prof[lowerSkill] ?? 0;
        const modifier = abilMod + calcProfNum(profNum, lvl);

        if (profNum === 0) {
          return interaction.reply({ content: `❌ **${c.name}** is not trained in ${skillName}. Earn Income generally requires being at least Trained.`, ephemeral: true });
        }

        // Roll the initial check
        const dieRoll = Math.floor(Math.random() * 20) + 1;
        const total = dieRoll + modifier + extraBonus;
        const dc = downtime.taskLevelDC(taskLevel);

        // Determine outcome
        let outcome;
        if (total >= dc + 10) outcome = 'crit-success';
        else if (total >= dc) outcome = 'success';
        else if (total <= dc - 10) outcome = 'crit-failure';
        else outcome = 'failure';
        // Nat 20 / Nat 1 shift the outcome by one step
        if (dieRoll === 20) {
          outcome = outcome === 'crit-failure' ? 'failure' : outcome === 'failure' ? 'success' : 'crit-success';
        } else if (dieRoll === 1) {
          outcome = outcome === 'crit-success' ? 'success' : outcome === 'success' ? 'failure' : 'crit-failure';
        }

        const dailyCp = downtime.dailyIncomeCopper({ taskLevel, profRank: profNum, outcome });

        // On a critical failure, the activity ends immediately (fired & reputation hit).
        if (outcome === 'crit-failure') {
          const embed = new EmbedBuilder()
            .setColor(0xC0392B)
            .setTitle(`💼 ${c.name} attempts Earn Income (${skillName})`)
            .setDescription(
              `🎲 **Rolled:** d20 (${dieRoll}) ${fmt(modifier)}${extraBonus ? ` ${fmt(extraBonus)}` : ''} = **${total}** vs DC **${dc}**\n` +
              `💥 **Critical Failure!**\n\n` +
              `*${c.name} is fired immediately and earns nothing. Their reputation in this community suffers — the GM may make future Earn Income harder here.*`
            )
            .setFooter({ text: `Task Level ${taskLevel} · ${downtime.profRankKey(profNum)}` });
          return interaction.reply({ embeds: [embed] });
        }

        // Start the entry
        const result = downtime.startEntry(store, userId, charKey, 'earn-income', {
          skill: skillName,
          taskLevel,
          profRank: profNum,
          modifier,
          dieRoll,
          rolledTotal: total,
          dc,
          outcome,
          dailyIncomeCp: dailyCp,
        }, plannedDays);

        if (!result.ok) {
          return interaction.reply({ content: `❌ Could not start activity: ${result.reason}`, ephemeral: true });
        }
        await saveDowntime(store);

        const outcomeEmoji = { 'crit-success': '🌟', success: '✅', failure: '⚠️' }[outcome];
        const outcomeLabel = { 'crit-success': 'Critical Success!', success: 'Success', failure: 'Failure (shoddy work)' }[outcome];
        const embed = new EmbedBuilder()
          .setColor(outcome === 'crit-success' ? 0xF1C40F : outcome === 'success' ? 0x27AE60 : 0xE67E22)
          .setTitle(`💼 ${c.name} starts Earn Income (${skillName})`)
          .setDescription(
            `🎲 **Initial Check:** d20 (${dieRoll}) ${fmt(modifier)}${extraBonus ? ` ${fmt(extraBonus)}` : ''} = **${total}** vs DC **${dc}**\n` +
            `${outcomeEmoji} **${outcomeLabel}**\n\n` +
            `**Daily payout:** ${downtime.formatCopper(dailyCp)}\n` +
            `**Planned duration:** ${plannedDays} day${plannedDays === 1 ? '' : 's'}\n` +
            `**Activity ID:** \`${result.entry.id}\`\n\n` +
            `Each real-life day will automatically credit a downtime day.\n` +
            `Use \`/downtime check\` to see progress, or \`/downtime complete activity:${result.entry.id}\` when done.`
          )
          .setFooter({ text: `Task Level ${taskLevel} · ${downtime.profRankKey(profNum)}` });
        if (charEntry.art) embed.setThumbnail(charEntry.art);
        return interaction.reply({ embeds: [embed] });
      }

      return interaction.reply({ content: `❌ Activity "${activityKey}" not yet implemented.`, ephemeral: true });
    }

    // ─── /downtime check — auto-advance and show status ───
    if (sub === 'check') {
      // Auto-advance everything for this character first
      const advances = downtime.autoAdvanceAll(store, userId, charKey);
      const active = downtime.listActiveEntries(store, userId, charKey);

      if (active.length === 0) {
        const bank = downtime.getBank(store, userId, charKey).bank;
        return interaction.reply({
          content: `**${c.name}** has no active downtime activities. Banked days: **${bank}**.\nStart one with \`/downtime start\`.`,
          ephemeral: true,
        });
      }

      await saveDowntime(store);

      const lines = active.map(entry => {
        const def = downtime.ACTIVITIES[entry.activity];
        const adv = advances.find(a => a.entry.id === entry.id);
        const advText = adv && adv.addedDays > 0
          ? ` *(+${adv.addedDays} day${adv.addedDays === 1 ? '' : 's'} since last check, +${downtime.formatCopper(adv.addedCp)})*`
          : '';
        const statusBadge = entry.status === 'ready-to-complete' ? ' ✅ **READY TO COMPLETE**' : '';
        const earnedText = entry.result?.totalEarnedCp != null
          ? `Earned: **${downtime.formatCopper(entry.result.totalEarnedCp)}**`
          : '';
        return `• **${def.name}** (${entry.params.skill ?? '?'}) — ID \`${entry.id}\`${statusBadge}\n` +
               `  Day ${entry.elapsedDays}/${entry.plannedDays} · ${earnedText}${advText}`;
      });

      const bank = downtime.getBank(store, userId, charKey).bank;
      const embed = new EmbedBuilder()
        .setColor(0x6f4e37)
        .setTitle(`🛠️ ${c.name}'s Downtime`)
        .setDescription(lines.join('\n\n'))
        .setFooter({ text: `Banked downtime days: ${bank}` });
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      return interaction.reply({ embeds: [embed] });
    }

    // ─── /downtime complete ───────────────────────────
    if (sub === 'complete') {
      const entryId = interaction.options.getString('activity');
      // Auto-advance first so we know if it's actually done
      downtime.autoAdvanceAll(store, userId, charKey);
      const entry = downtime.getEntry(store, userId, charKey, entryId);
      if (!entry) {
        return interaction.reply({ content: `❌ No downtime activity with ID \`${entryId}\` for ${c.name}.`, ephemeral: true });
      }
      if (entry.status === 'completed') {
        return interaction.reply({ content: `❌ Activity \`${entryId}\` is already completed.`, ephemeral: true });
      }
      if (entry.status === 'cancelled') {
        return interaction.reply({ content: `❌ Activity \`${entryId}\` was cancelled.`, ephemeral: true });
      }

      // Allow completing early — partial credit for partial days.
      const result = downtime.completeEntry(store, userId, charKey, entryId);
      if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
      await saveDowntime(store);

      const def = downtime.ACTIVITIES[entry.activity];
      const earned = entry.result?.totalEarnedCp ?? 0;
      const earlyNote = entry.elapsedDays < entry.plannedDays
        ? `\n*(Completed early at day ${entry.elapsedDays}/${entry.plannedDays}.)*`
        : '';
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`✅ ${c.name} completes ${def.name}`)
        .setDescription(
          `**Total earned:** ${downtime.formatCopper(earned)}\n` +
          `**Days worked:** ${entry.elapsedDays}\n` +
          `**Skill used:** ${entry.params.skill}${earlyNote}\n\n` +
          `*Add this to your character's coin pouch with \`/coin add\` (or however you track money).*`
        )
        .setFooter({ text: `Activity ID: ${entry.id}` });
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      return interaction.reply({ embeds: [embed] });
    }

    // ─── /downtime cancel ─────────────────────────────
    if (sub === 'cancel') {
      const entryId = interaction.options.getString('activity');
      const entry = downtime.getEntry(store, userId, charKey, entryId);
      if (!entry) {
        return interaction.reply({ content: `❌ No downtime activity with ID \`${entryId}\` for ${c.name}.`, ephemeral: true });
      }
      const result = downtime.cancelEntry(store, userId, charKey, entryId);
      if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
      await saveDowntime(store);

      const def = downtime.ACTIVITIES[entry.activity];
      return interaction.reply({
        content: `🚫 Cancelled **${def.name}** (\`${entry.id}\`). ${entry.result?.totalEarnedCp ? `Forfeited ${downtime.formatCopper(entry.result.totalEarnedCp)}.` : 'No earnings forfeited.'}`,
      });
    }

    // ─── /downtime spend — apply banked days to an activity ───
    if (sub === 'spend') {
      const entryId = interaction.options.getString('activity');
      const days = interaction.options.getInteger('days');
      const result = downtime.spendBankedDays(store, userId, charKey, entryId, days);
      if (!result.ok) return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
      await saveDowntime(store);

      const def = downtime.ACTIVITIES[result.entry.activity];
      const completedNote = result.entry.status === 'ready-to-complete'
        ? `\n✅ **Activity is now ready to complete!** Use \`/downtime complete activity:${result.entry.id}\`.`
        : '';
      return interaction.reply({
        content: `🪙 Applied **${result.daysApplied}** banked day${result.daysApplied === 1 ? '' : 's'} to ${def.name} (\`${result.entry.id}\`).\n` +
                 `Earned **+${downtime.formatCopper(result.addedCp)}** (total: ${downtime.formatCopper(result.entry.result?.totalEarnedCp ?? 0)}).\n` +
                 `Days now ${result.entry.elapsedDays}/${result.entry.plannedDays}. Bank balance: **${store[userId][charKey].bank}**.${completedNote}`,
      });
    }

    // ─── /downtime bank — show banked days + recent history ───
    if (sub === 'bank') {
      const { bank, history } = downtime.getBank(store, userId, charKey);
      const recent = history.slice(-10).reverse();
      const histLines = recent.length === 0
        ? '*No history yet.*'
        : recent.map(h => {
            const sign = h.delta > 0 ? '+' : '';
            const date = h.ts.slice(0, 10);
            return `${date} · **${sign}${h.delta}** — ${h.reason}`;
          }).join('\n');
      const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setTitle(`🪙 ${c.name}'s Downtime Bank`)
        .setDescription(`**Banked days:** ${bank}\n\n**Recent activity:**\n${histLines}`)
        .setFooter({ text: 'GMs award days with /downtime award' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ─── /downtime award — GM grants days to a player's character ───
    if (sub === 'award') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '🔒 Only GMs (Manage Server permission) can award downtime days.', ephemeral: true });
      }
      // The character we resolved above is the AWARDER's character.
      // The award target is a different player's character — read from options.
      const targetPlayer = interaction.options.getUser('player');
      const targetCharName = interaction.options.getString('targetcharacter');
      const days = interaction.options.getInteger('days');
      const reason = interaction.options.getString('reason') ?? 'GM award';

      if (!targetPlayer) {
        return interaction.reply({ content: '❌ Specify a `player:` (and `targetcharacter:` if they have multiple).', ephemeral: true });
      }
      if (days === 0) {
        return interaction.reply({ content: '❌ Award amount must be non-zero. Use a negative number to remove days.', ephemeral: true });
      }

      const targetCharacters = loadCharacters(); // re-read so we have fresh data
      const { error: terr, charKey: tCharKey, char: tCharEntry } = resolveChar(targetPlayer.id, targetCharName, targetCharacters);
      if (terr) return interaction.reply({ content: `❌ Couldn't find that character: ${terr}`, ephemeral: true });

      const newBalance = downtime.awardDays(store, targetPlayer.id, tCharKey, days, reason);
      await saveDowntime(store);

      const sign = days > 0 ? '+' : '';
      const verb = days > 0 ? 'awarded' : 'removed';
      return interaction.reply({
        content: `🪙 ${verb === 'awarded' ? 'Awarded' : 'Removed'} **${sign}${days}** downtime day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'to' : 'from'} <@${targetPlayer.id}>'s **${tCharEntry.data.name}**${reason ? `: *${reason}*` : ''}.\nNew balance: **${newBalance}**.`,
      });
    }
  }

  // ─── /weather ─────────────────────────────────────────────────────
  // PF2e weather tracker. Per-server scope, GM-controlled advancement.
  // All subcommand logic lives in commands/weather-cmd.js. We pass the
  // encounters module in so /weather apply can attach effects to combatants
  // in the active encounter.
  else if (commandName === 'weather') {
    return weatherFeatureCmd.execute(interaction);
  }

  // ─── /calendar ───────────────────────────────────────────────────
  // Golarion calendar. Per-server scope, GM-controlled advancement.
  // Pass the weather engine in so /calendar set and /calendar advance
  // automatically update the weather system's season when the month
  // boundary changes seasons (one-way integration).
  else if (commandName === 'calendar') {
    return calendarFeatureCmd.execute(interaction);
  }

  else {
    return interaction.reply({
      content: `This bot build does not have a handler for /${commandName}. Redeploy the latest code and run the command deploy script again.`,
      ephemeral: true,
    });
  }

});

client.login(TOKEN);
