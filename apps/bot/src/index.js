require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');

// ── Persistent-data directory + JSON loader ─────────────────────────────────
// Moved to utils/storage.js. See that file for the full force-reseed and
// homebrew-preservation logic. On Railway, set DATA_DIR env var to your mounted
// volume path (e.g. /app/data) so user state survives redeploys.
const {
  DATA_DIR,
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
const xpLogState = require('./state/xpLog');
const feedbackNotifier = require('./notifiers/feedback');
const {
  computeCharMaxHp, getCharacterHp, setCharacterHp,
  getCharacterXp, setCharacterXp,
  getCharacterWeapons,
  splitCharacterDamage,
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
  characterProfValue,
  characterProfLabel,
  profIconForValue,
} = require('./rules/pf2eMath');

// ── Extracted command handlers (Phase 3) ───────────────────────────────────
// Per-command folders under src/commands/ own their handler + embed +
// any button/autocomplete logic. index.js shrinks by ~250 lines per
// command extracted. Helpers that still live in index.js are passed
// through a `ctx` object built at call-site.
const sheetCmd         = require('./commands/sheet/command');
const hpCmd            = require('./commands/hp/command');
const notesCmd         = require('./commands/notes/command');
const { NOTE_CATEGORIES, truncateNote } = require('./commands/notes/notebook');
const featsCmd         = require('./commands/feats/command');
const abilitiesCmd     = require('./commands/abilities/command');
const descriptionCmd   = require('./commands/description/command');
const brCmd            = require('./commands/br/command');
const pingCmd          = require('./commands/ping/command');
const snippetCmd       = require('./commands/snippet/command');
const serverSnippetCmd = require('./commands/serversnippet/command');
const portraitCmd      = require('./commands/portrait/command');
const heroCmd          = require('./commands/hero/command');
const recoveryCmd      = require('./commands/recovery/command');
const ccCmd            = require('./commands/cc/command');
const useCmd           = require('./commands/use/command');
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
const monsterCmd       = require('./commands/monster/command');
const monsterartCmd    = require('./commands/monsterart/command');
const monsterrollCmd   = require('./commands/monsterroll/command');
const monstereditCmd   = require('./commands/monsteredit/command');
const monsterattackCmd = require('./commands/monsterattack/command');
const monstercastCmd   = require('./commands/monstercast/command');
const monsterattacksCmd = require('./commands/monsterattacks/command');
const monsterabilityCmd = require('./commands/monsterability/command');
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
const classCmd         = require('./commands/class/command');
const classButtons     = require('./commands/class/buttons');
const companionCmd     = require('./commands/companion/command');
const weatherFeatureCmd = require('./commands/weather/command');
const calendarFeatureCmd = require('./commands/calendar/command');
const huntCmd          = require('./commands/hunt/command');
const harvestCmd       = require('./commands/harvest/command');
const downtimeActivityCmd = require('./commands/downtimeActivities/command');
const downtimeCmd      = require('./commands/downtimeCommand/command');
const mattackCmd       = require('./commands/mattack/command');
const iCmd             = require('./commands/i/command');
const initCmd          = require('./commands/init/command');
const charCmd          = require('./commands/char/command');
const charModals       = require('./commands/char/modals');
const { routeMonsterAlias } = require('./commands/m/router');
const { buildCharHpEmbed } = require('./commands/hp/embed');
// Notes autocomplete (still inline in index.js) reaches into note helpers.
const { noteKey, sortNotes } = require('./commands/notes/notebook');
const { findMonster } = require('./commands/monster/lookup');
const { buildMonsterEmbed } = require('./commands/monster/embed');

// Fuzzy matching for autocomplete dropdowns and "Did you mean?" fallback
// messages on lookup commands. fuzzyPick is a drop-in replacement for the
// old inline pick() helper that powered all autocomplete; didYouMeanLine
// is appended to "❌ No X found" messages on lookup commands.
const { fuzzyPick, didYouMeanLine } = require('./lib/fuzzyMatch');

console.log(`DATA_DIR: ${DATA_DIR}`);

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('Missing required environment variable: TOKEN or DISCORD_TOKEN');
  process.exit(1);
}

const { listPresets } = require('./rules/effects');
const downtime = require('./commands/downtime');
const charOverlay = require('./rules/characterOverlay');
const combatV2State = require('./state/combat');
const { updateCombatV2Summary } = require('./commands/init/combatV2Summary');
const combatV2Render = require('./rules/combatV2/render');
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
    // NOTE: MessageContent is a *privileged* intent. The bot does not read
    // message content (no messageCreate handler; the only `.content` use is
    // interaction.message.content on our own messages, which needs no intent),
    // so we deliberately do NOT request it. Requesting an unused privileged
    // intent makes login() fail with a disallowed-intents close (WS 4014) the
    // moment the Developer Portal toggle is off — which silently took the bot
    // offline once. Do not add it back unless a feature genuinely reads user
    // message content, and then only after enabling it in the portal.
  ]
});

process.on('unhandledRejection', error => {
  if (isDeadInteractionError(error)) {
    // [TEST-DIAG] Normally silent. Surfaced so we can see when a reply lands
    // after Discord's 3s window — the cause of "did not respond". Remove after diagnosis.
    console.warn('[TEST-DIAG] swallowed 10062 Unknown-interaction rejection — a reply arrived too late (>3s)');
    return;
  }
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

function loadBags() {
  return bagState.getAll();
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
// Merge personal + server snippets for a given user+guild. Personal wins
// on name collision. Returns { [name]: expansion }.
// ── Monster attack library helpers ────────────────────────────────────────────
// Shape: { [guildId]: { [monsterKey]: { displayName, attacks: [ {...} ] } } }
// Phase 2: state/monster owns the attacks cache + Realtime.
function loadMonsterAttacks() {
  return monsterState.getAllAttacks();
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
// ── Monster art library helpers ───────────────────────────────────────────────
// Shape: { [guildId]: { [monsterKey]: { displayName, url, setBy, setAt } } }
// Per-guild so a GM on one server can't affect another's art.
// Phase 2: state/monster owns the art cache + Realtime.
function loadMonsterArt() {
  return monsterState.getAllArt();
}
// Look up a saved art URL for a monster in a given guild. Returns null if none.
// The monster arg can be either a bestiary creature object (preferred) or a raw string name.
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

// Pull the saved monster attack library entries for this guild+monster and
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
// characterProfValue, characterProfLabel, usesRankProficiencies, profIconForValue)
// moved to src/rules/pf2eMath.js in Phase 3.4.
// All are imported at the top of this file so existing call sites resolve naturally.
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
// MAX_CHARACTERS_PER_USER moved to state/characters.js in Phase 3.7.

// mergeCharacterOverlay moved to lib/pathwayWebClient.js in Phase 3.7.

// saveImportedCharacter moved to lib/pathwayWebClient.js in Phase 3.7.





// Try to parse a JSON string that may have extra wrapping (code blocks,
// leading/trailing text, nested `{"success":true,"build":{...}}` wrapper).
// Returns { char } or { error }.



// ─── PDF STATBLOCK PARSER ─────────────────────────────────────────────
// Split on commas, keeping parenthesized groups together. Used for items
// and similar lists where entries contain internal commas inside parens.



// Fetch a character by Pathbuilder ID. Returns { char, id } or { error }.
// Centralizes the fetch/parse/error-handling so /char import and /char sync
// don't drift apart.


// fetchPathwayCharacter moved to lib/pathwayWebClient.js in Phase 3.7.

// fetchLinkedPathwayCharacter moved to lib/pathwayWebClient.js in Phase 3.7.

// resolveChar moved to state/characters.js in Phase 3.3.
// Imported via the destructure at the top of this file so all 87 call
// sites continue to resolve to the same function.

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

function combatV2PickActor(encounter, userId, actorName = null) {
  if (!encounter) return null;
  if (actorName) return combatV2State.findCombatant(encounter, actorName);
  const current = combatV2State.currentCombatant(encounter);
  if (current && (current.ownerId === userId || userId === encounter.gmId)) return current;
  const owned = encounter.combatants.filter(c => c.ownerId === userId && c.hp > 0);
  return owned.length === 1 ? owned[0] : null;
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
// Find a save bonus for a combatant. Checks in order:
//   1. Character-sheet data (PC combatants)
//   2. Bestiary data (NPC combatants matched by name to a monster)
//   3. Stored combatant overrides (from /init addnpc with manual stats)
// Returns { bonus, source } or null if no info.
// saveType must be one of 'fortitude' / 'reflex' / 'will' (case-insensitive).
// Roll a save and compute the degree of success vs the given DC.
// Returns { dieRoll, total, degree } — degree is 'crit-success' | 'success' |
// 'failure' | 'crit-failure'. Uses the same DoS table as attack rolls.
// Given a spell's damage and a basic-save degree of success, return the final
// damage amount. Per PF2e Remaster:
//   crit-success → 0 damage
//   success → half damage (rounded down)
//   failure → full damage
//   crit-failure → double damage (ALL dice and bonuses)
// Sum up all attack/damage/AC/save/skill modifiers from a combatant's effects.
// Build a human-readable line showing which effects contributed to a roll.
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

  try {
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
    xpLogState.subscribe(sb);
    guildStateModule.subscribe(sb);
    // Companions don't own their own cache — they patch the shared
    // characters cache (owned by state/characters as of Phase 2) in place.
    companionState.subscribe(sb, () => characterState.getAll());
    // Not a state cache: bridge new website feedback rows to a Discord
    // notification (channel or owner DM). Holds no cache, so it's outside the
    // subscribe-before-restore contract.
    feedbackNotifier.subscribe(sb, client);
  }

  const restored = await restoreAllFromSupabase();
  // Seed legacy caches directly from Supabase data (no JSON file reads).
  // notes / downtime / snippets / monster / bags / characters / companions
  // are omitted — their state modules already populated their own caches
  // inside restoreAllFromSupabase via *.restore().
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
  } catch (err) {
    console.error('FATAL: bot startup (clientReady) failed — cannot serve commands reliably. Exiting so the host restarts the process.', err);
    process.exit(1);
  }
});

// ── Interaction handler ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  return characterState.runWithResolveContext({ guildId: interaction.guildId }, async () => {
  // [TEST-DIAG] Confirms the handler is firing and what it received. If a command
  // shows "did not respond" but this never logs → interactions aren't reaching the
  // bot (gateway). If it logs but the reply still fails → the reply is stalling
  // (REST throttle / rate limit). Remove after diagnosis.
  console.log(`[interaction] received ${interaction.isChatInputCommand?.() ? '/' + interaction.commandName : interaction.isButton?.() ? 'button:' + interaction.customId : interaction.isModalSubmit?.() ? 'modal:' + interaction.customId : interaction.isAutocomplete?.() ? 'autocomplete:' + interaction.commandName : 'type:' + interaction.type} from ${interaction.user?.id ?? '?'}`);
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
      // Legacy initiative pages can no longer exist — the old combat engine
      // was removed. Stale pinned summaries may still carry these buttons.
      if (interaction.message.flags?.has?.('Ephemeral')) {
        return interaction.update({ content: '❌ The encounter has ended.', embeds: [], components: [] });
      }
      return interaction.reply({ content: '❌ The encounter has ended (retired combat tracker).', ephemeral: true });
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
      const enc = combatV2State.getEncounter(channelId);
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
        combatant.reactionUsed = true;
        const newContent = `${cleanedContent}\n⤾ **${combatant.name}** uses their reaction! *(GM: resolve the reaction now.)*`.trim();
        await interaction.update({ content: newContent, components: [] });
        await updateCombatV2Summary(interaction.channel, enc);
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
      const enc = combatV2State.getEncounter(channelId);
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
      const result = combatV2State.rerollRecoveryCheck(channelId, combatant.name, originalResult);
      if (!result) return interaction.update({ content: '❌ Could not reroll — combatant is no longer dying.', components: [] });
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
      await updateCombatV2Summary(interaction.channel, combatV2State.getEncounter(channelId) ?? enc);
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
      const enc = combatV2State.getEncounter(channelId);
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

      const stab = combatV2State.stabilizeWithHeroPoints(channelId, combatant.name);
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
      await updateCombatV2Summary(interaction.channel, combatV2State.getEncounter(interaction.channel.id) ?? enc);
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
        if (charModals.handles(interaction)) {
          return charModals.handle(interaction);
        }


        if (descriptionCmd.prefixes.some(prefix => interaction.customId.startsWith(prefix))) {
          return descriptionCmd.handleModal(interaction);
        }


        // /char identity modal: class, subclass, level, ancestry, heritage

        // /char misc modal: gender, age, size, alignment, keyability
      } catch (err) {
        console.error('Modal submit error:', err);
        try {
          if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Something went wrong saving your edits. Try again.', ephemeral: true });
          } else if (interaction.deferred && !interaction.replied) {
            await interaction.editReply('❌ Something went wrong saving your edits. Try again.');
          }
        } catch {}
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
        // ─── /use autocomplete ───
        // Owns its own search over the authored action catalog, so it does not
        // go through the pick() helper below.
        if (interaction.commandName === 'use') {
          return await useCmd.autocomplete(interaction);
        }

        const focused = interaction.options.getFocused(true); // { name, value }
        const q = String(focused.value ?? '').toLowerCase().trim();
        // /m subcommand groups are aliased back to the legacy commandName so
        // the existing autocomplete branches below work unchanged. Mirrors
        // the same rewrite in the main handler dispatcher above.
        let cmd = interaction.commandName;
        if (cmd === 'm') cmd = routeMonsterAlias(interaction);

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
        else if ((cmd === 'hp' || cmd === 'recovery' || cmd === 'perception' || cmd === 'portrait' || cmd === 'feats' || cmd === 'abilities' || cmd === 'description') && focused.name === 'character') {
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
        else if (cmd === 'char' && focused.name === 'character' && ['active', 'serveractive'].includes(interaction.options.getSubcommand(false))) {
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
          // "monster" on /init means a bestiary creature to add.
          suggestions = pick(Object.values(bestiaryDatabase).map(m => m?.name).filter(Boolean));
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
            if (v2 && targetName) {
              const target = combatV2State.findCombatant(v2, targetName);
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
          const enc = combatV2State.getEncounter(interaction.channel.id);
          if (enc) suggestions = pick(enc.combatants.map(c => c.name));
        }
        else if (cmd === 'init' && focused.name === 'name'
                 && ['hp', 'thp', 'remove', 'modify', 'reaction', 'damage', 'dying', 'recovery', 'move'].includes(interaction.options.getSubcommand(false))) {
          // Autocomplete combatants for any subcommand that takes a 'name' parameter
          // referring to a combatant in the encounter.
          const enc = combatV2State.getEncounter(interaction.channel.id);
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
        else if (cmd === 'skill') {
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
          if (focused.name === 'character') {
            const characters = loadCharacters();
            const own = Object.values(characters[interaction.user.id] ?? {}).filter(v => v && v.name).map(e => e.name);
            suggestions = pick(own);
          } else if (sub === 'add' && focused.name === 'item') {
            // Suggest from the full item database
            suggestions = pick(itemDatabase.map(i => i.name));
          } else if (sub === 'remove' && focused.name === 'item') {
            // Suggest only from the selected character's bag contents in that category (if they've picked one)
            const bags = loadBags();
            const characters = loadCharacters();
            const resolved = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
            const bagKey = resolved.error ? null : bagState.makeBagKey(interaction.user.id, resolved.charKey);
            const userBag = bagKey ? bags[bagKey] : null;
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
            const characters = loadCharacters();
            const resolved = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
            const bagKey = resolved.error ? null : bagState.makeBagKey(interaction.user.id, resolved.charKey);
            const userBag = bagKey ? bags[bagKey] : null;
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
            // Autocomplete Perception + PF2e's standard 16 skills.
            const pfSkills = [
              'Perception','Acrobatics','Arcana','Athletics','Crafting','Deception','Diplomacy',
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
  if (commandName === 'm') commandName = routeMonsterAlias(interaction);

  // Backstop: every button/modal/autocomplete branch above has its own
  // try/catch; the slash-command dispatch chain did not. Without this, any
  // command whose execute() throws leaves the interaction dead ("the
  // application did not respond") and surfaces only as an unhandled rejection.
  try {
  if (commandName === 'ping') {
    await pingCmd.execute(interaction);
  }

  else if (commandName === 'br' || commandName === 'break') {
    await brCmd.execute(interaction);
  }

  // ─── /char ───────────────────────────────────────────────────────
  else if (commandName === 'char') {
    await charCmd.execute(interaction);
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

  // ─── /use ────────────────────────────────────────────────────────
  // Run an authored automation tree through @pathway/core's Layer-2
  // interpreter. The rules live in core; this is only the entry point.
  else if (commandName === 'use') {
    await useCmd.execute(interaction);
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
    await mattackCmd.execute(interaction);
  }

  // ─── /roll ───────────────────────────────────────────────────────
  // Both /roll and /r (the alias) come through here. Same options, same logic.
  else if (commandName === 'monstercast') {
    await monstercastCmd.execute(interaction);
  }

  else if (commandName === 'monsterattacks') {
    await monsterattacksCmd.execute(interaction);
  }

  else if (commandName === 'monsterability') {
    await monsterabilityCmd.execute(interaction);
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
    await huntCmd.execute(interaction);
  }

  else if (commandName === 'harvest') {
    await harvestCmd.execute(interaction);
  }

  else if (commandName === 'monster') {
    await monsterCmd.execute(interaction);
  }


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
    await monsterartCmd.execute(interaction);
  }

  // ─── monsterroll (reached via /m save and /m skill) ──────────────
  // GM save/skill rolls for monsters. Not registered as a standalone slash
  // command; routeMonsterAlias rewrites /m subcommands to this handler.
  else if (commandName === 'monsterroll') {
    await monsterrollCmd.execute(interaction);
  }

  // ─── monsterattack (reached via the /m attack group) ─────────────
  // Saved per-guild monster attack library. Not registered standalone;
  // also exports normalizeAttackForRolling for /mattack and /init attack.
  else if (commandName === 'monsterattack') {
    await monsterattackCmd.execute(interaction);
  }

  // ─── /monsteredit ────────────────────────────────────────────────
  // Per-guild per-field overrides for bestiary entries. Each subcommand
  // touches ONE field; untouched fields fall through to the bestiary. This
  // lets you add a single custom ability to Lanks without rebuilding her
  // whole stat block. Use /monsteredit paste to drop in a full JSON block
  // (handy for homebrew creatures), and /monsteredit reset to wipe.
  else if (commandName === 'monsteredit') {
    await monstereditCmd.execute(interaction);
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
  else if (commandName === 'recovery') {
    await recoveryCmd.execute(interaction);
  }

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
    await iCmd.execute(interaction);
  }

  else if (commandName === 'init') {
    await initCmd.execute(interaction);
  }

  // ─── /downtime ────────────────────────────────────────────────────
  // Standalone PF2e downtime activity commands from Downtime Activities-2.pdf.
  else if (downtimeActivityCmd.handles(commandName)) {
    await downtimeActivityCmd.execute(interaction);
  }

  // PF2e downtime activity tracker. Real-life days advance activities
  // automatically; the GM can also award banked downtime days as quest
  // rewards. Currently supports Earn Income; more activities coming later.
  else if (commandName === 'downtime') {
    await downtimeCmd.execute(interaction);
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
  } catch (err) {
    console.error(`Command /${commandName} failed:`, err);
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Something went wrong running that command. Please try again.', ephemeral: true });
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply('❌ Something went wrong running that command. Please try again.');
      }
    } catch {}
  }

  });
});

// ── TEMPORARY LOGIN DIAGNOSTICS ─────────────────────────────────────────────
// The bot was hanging at login: neither `clientReady` ("Logged in as…") nor the
// .catch() below fired, so the gateway handshake was stalling with no error to
// see. These logs narrate the handshake so a deploy shows exactly where it dies.
// Remove once the stall is diagnosed.
console.log('Startup requires complete; attempting Discord gateway login…');
client.on('debug', (m) => console.log('[discord:debug]', m));
client.on('warn',  (m) => console.warn('[discord:warn]', m));
// [TEST-DIAG] REST-side visibility. If replies fail because Discord is throttling
// the bot's outbound requests, these fire: 'rateLimited' = a bucket/global limit
// was hit; 'invalidRequestWarning' = nearing Discord's Cloudflare ban for too many
// invalid requests. Remove after diagnosis.
client.rest.on('rateLimited', (info) => console.warn('[rest:rateLimited]', JSON.stringify({ global: info.global, method: info.method, route: info.route, url: info.url, timeToReset: info.timeToReset, limit: info.limit })));
client.rest.on('invalidRequestWarning', (info) => console.warn('[rest:invalidRequestWarning]', JSON.stringify(info)));

// TEMPORARY probe: the network flow logs show TCP to Discord succeeds, so egress
// works — yet the handshake stalls silently after "Preparing to connect to the
// gateway". That's the signature of Discord rate-limiting us (exhausted
// session_start_limit from repeated redeploys, or a 429), which makes discord.js
// wait out the reset with no error. Hit /gateway/bot directly to read the actual
// numbers. Uses Node's built-in fetch (separate HTTP path). Remove after diagnosis.
(async () => {
  try {
    const res = await fetch('https://discord.com/api/v10/gateway/bot', {
      headers: { Authorization: `Bot ${TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    console.log(`[net-probe] GET /gateway/bot → HTTP ${res.status}`);
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter) console.log(`[net-probe] retry-after: ${retryAfter}s`);
    const body = await res.json().catch(() => null);
    if (body) {
      if (body.url) console.log(`[net-probe] gateway url: ${body.url} | recommended shards: ${body.shards}`);
      if (body.session_start_limit) {
        console.log(`[net-probe] session_start_limit: ${JSON.stringify(body.session_start_limit)}`);
      } else {
        console.log(`[net-probe] body: ${JSON.stringify(body)}`);
      }
    }
  } catch (err) {
    console.error(`[net-probe] GET /gateway/bot failed: ${err.name}: ${err.message}`);
  }
})();

const readyWatchdog = setTimeout(() => {
  if (!client.isReady()) {
    console.error('[startup] 30s after login(), still not READY — gateway handshake stalled. See [discord:debug] above for the last step reached.');
  }
}, 30_000);
client.once('clientReady', () => clearTimeout(readyWatchdog));
// ────────────────────────────────────────────────────────────────────────────

// Surface login failures instead of swallowing them. This is fire-and-forget,
// so without a .catch() a rejected login (invalid/revoked token, disallowed
// intents, gateway unreachable) produces no clear log and the bot just sits
// offline behind a green deploy. Log the reason and exit so the host restarts.
client.login(TOKEN)
  .then(() => console.log('[startup] login() resolved — WS identified, awaiting READY…'))
  .catch((err) => {
    console.error('FATAL: Discord login failed —', err);
    process.exit(1);
  });
