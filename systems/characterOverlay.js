// Character overlay: persistent per-character additions/overrides that survive
// Pathbuilder re-imports. Stored as char.overlay on the character entry.
//
// Shape:
//   overlay: {
//     spellbook: [                          // /spells learn
//       { caster: "Oracle", spell: "Fireball", rank: 3, added_at: "..." }
//     ],
//     repertoire_swaps: [                   // /spells swap (spontaneous casters)
//       { caster: "Sorcerer", rank: 2, remove: "Glitterdust", add: "Web" }
//     ],
//     prepared_override: {                  // /spells prepare — today's prep
//       // map of casterName -> array of { rank, spell, slot_index }
//       "Wizard": [ { rank: 1, spell: "Magic Missile", slot_index: 0 }, ... ]
//     },
//     daily: {
//       focus_spent: 0,                     // subtract from max focus pool
//       hero_points: 1,                     // current value (not delta)
//       slots_used: {                       // per-caster, per-rank slot usage
//         "Oracle": { "1": 1, "2": 0, ... }
//       },
//       last_rest_at: "ISO timestamp"
//     },
//     cvars: {                              // /cvar — user-defined variables
//       // name (lowercase) -> stringified value, used by {{name}} substitution
//       "rage_bonus": "+2",
//       "atk":        "1d20+8"
//     },
//     counters: {                           // /cc — user-defined custom counters
//       // name (lowercase) -> { current, max, reset, label }
//       // reset: 'daily' (cleared on /rest) | 'none' (manual only)
//       "reagents": { current: 8, max: 8, reset: "daily", label: "Infused Reagents" }
//     }
//   }

'use strict';

function blankOverlay() {
  return {
    spellbook: [],
    repertoire_swaps: [],
    prepared_override: {},
    daily: {
      focus_spent: 0,
      hero_points: 1,
      slots_used: {},
      last_rest_at: null,
    },
    cvars: {},
    counters: {},
  };
}

// Call this before reading/writing char.overlay. Mutates charEntry in place so
// the caller can then saveCharacters(). Returns the overlay.
function ensureOverlay(charEntry) {
  if (!charEntry.overlay) charEntry.overlay = blankOverlay();
  // Backfill any missing nested fields from older saves
  if (!charEntry.overlay.spellbook) charEntry.overlay.spellbook = [];
  if (!charEntry.overlay.repertoire_swaps) charEntry.overlay.repertoire_swaps = [];
  if (!charEntry.overlay.prepared_override) charEntry.overlay.prepared_override = {};
  if (!charEntry.overlay.daily) charEntry.overlay.daily = { focus_spent: 0, hero_points: 1, slots_used: {}, last_rest_at: null };
  if (charEntry.overlay.daily.slots_used === undefined) charEntry.overlay.daily.slots_used = {};
  if (charEntry.overlay.daily.focus_spent === undefined) charEntry.overlay.daily.focus_spent = 0;
  if (charEntry.overlay.daily.hero_points === undefined) charEntry.overlay.daily.hero_points = 1;
  if (!charEntry.overlay.cvars || typeof charEntry.overlay.cvars !== 'object') charEntry.overlay.cvars = {};
  if (!charEntry.overlay.counters || typeof charEntry.overlay.counters !== 'object') charEntry.overlay.counters = {};
  return charEntry.overlay;
}

// ─── Spellcaster helpers ─────────────────────────────────────────────────────
// Pathbuilder format:
//   spellCasters: [
//     { name: "Oracle", magicTradition: "divine", spellcastingType: "spontaneous",
//       ability: "cha", proficiency: 2, focusPoints: 0, innate: false,
//       perDay: [cantrips, r1, r2, ...], // r0 slot is cantrip count but cantrips
//                                        // are at-will, so perDay[0] is mostly cosmetic
//       spells: [ { spellLevel: 0, list: ["Light","Shield"] }, ... ],
//       prepared: [], blendedSpells: [] }
//   ]

function getCasters(charData) {
  return Array.isArray(charData?.spellCasters) ? charData.spellCasters : [];
}

function findCaster(charData, casterName) {
  const casters = getCasters(charData);
  if (!casterName) return casters[0] ?? null;
  const target = casterName.toLowerCase().trim();
  return casters.find(c => (c.name || '').toLowerCase() === target) ?? null;
}

// Returns the effective spellbook for a caster, merging Pathbuilder + overlay.
// Shape: { cantrips: ["Light", ...], ranks: { 1: ["Magic Missile", ...], ... },
//          overlayNames: Set of spell names added via /spells learn }
function getMergedSpellbook(charEntry, casterName) {
  const caster = findCaster(charEntry.data, casterName);
  if (!caster) return null;
  const overlay = ensureOverlay(charEntry);

  const cantrips = new Set();
  const ranks = {}; // rank -> Set of names
  const overlayNames = new Set();

  // Pathbuilder base
  for (const slot of caster.spells ?? []) {
    const rank = Number(slot.spellLevel ?? 0);
    const list = slot.list ?? [];
    if (rank === 0) {
      for (const s of list) cantrips.add(typeof s === 'string' ? s : s?.name);
    } else {
      if (!ranks[rank]) ranks[rank] = new Set();
      for (const s of list) ranks[rank].add(typeof s === 'string' ? s : s?.name);
    }
  }

  // Overlay additions (only for this caster)
  for (const entry of overlay.spellbook) {
    if ((entry.caster || '').toLowerCase() !== (caster.name || '').toLowerCase()) continue;
    const name = entry.spell;
    overlayNames.add(name);
    if (entry.rank === 0) cantrips.add(name);
    else {
      if (!ranks[entry.rank]) ranks[entry.rank] = new Set();
      ranks[entry.rank].add(name);
    }
  }

  // Apply repertoire swaps (remove one, add the other at same rank)
  for (const swap of overlay.repertoire_swaps) {
    if ((swap.caster || '').toLowerCase() !== (caster.name || '').toLowerCase()) continue;
    const rank = Number(swap.rank);
    if (rank === 0) {
      if (swap.remove) cantrips.delete(swap.remove);
      if (swap.add) { cantrips.add(swap.add); overlayNames.add(swap.add); }
    } else {
      if (!ranks[rank]) ranks[rank] = new Set();
      if (swap.remove) ranks[rank].delete(swap.remove);
      if (swap.add) { ranks[rank].add(swap.add); overlayNames.add(swap.add); }
    }
  }

  // Convert sets to sorted arrays for stable rendering
  const rankOut = {};
  for (const r of Object.keys(ranks).sort((a, b) => Number(a) - Number(b))) {
    rankOut[r] = [...ranks[r]].sort((a, b) => a.localeCompare(b));
  }

  return {
    caster,
    cantrips: [...cantrips].sort((a, b) => a.localeCompare(b)),
    ranks: rankOut,
    overlayNames,
  };
}

// ─── Mutation helpers ────────────────────────────────────────────────────────
function learnSpell(charEntry, casterName, spellName, rank) {
  const overlay = ensureOverlay(charEntry);
  const caster = findCaster(charEntry.data, casterName);
  if (!caster) return { ok: false, error: `No caster named "${casterName}" on this character.` };
  // Dedup: already known in Pathbuilder base?
  const existing = getMergedSpellbook(charEntry, casterName);
  const nameL = spellName.toLowerCase();
  const cantripHit = existing.cantrips.some(n => n.toLowerCase() === nameL);
  const rankHit = Object.values(existing.ranks).some(list => list.some(n => n.toLowerCase() === nameL));
  if (cantripHit || rankHit) return { ok: false, error: `**${caster.name}** already knows **${spellName}**.` };
  overlay.spellbook.push({
    caster: caster.name,
    spell: spellName,
    rank: Number(rank),
    added_at: new Date().toISOString(),
  });
  return { ok: true, casterName: caster.name };
}

function forgetSpell(charEntry, casterName, spellName) {
  const overlay = ensureOverlay(charEntry);
  const caster = findCaster(charEntry.data, casterName);
  if (!caster) return { ok: false, error: `No caster named "${casterName}" on this character.` };
  const before = overlay.spellbook.length;
  const nameL = spellName.toLowerCase();
  const casterL = (caster.name || '').toLowerCase();
  overlay.spellbook = overlay.spellbook.filter(e =>
    !(e.caster?.toLowerCase() === casterL && (e.spell || '').toLowerCase() === nameL)
  );
  if (overlay.spellbook.length === before) {
    return { ok: false, error: `**${spellName}** isn't in the overlay spellbook for **${caster.name}**. (Pathbuilder-imported spells can't be forgotten from here — edit them in Pathbuilder.)` };
  }
  return { ok: true, casterName: caster.name };
}

function swapRepertoire(charEntry, casterName, rank, removeName, addName) {
  const overlay = ensureOverlay(charEntry);
  const caster = findCaster(charEntry.data, casterName);
  if (!caster) return { ok: false, error: `No caster named "${casterName}" on this character.` };
  if (caster.spellcastingType !== 'spontaneous') {
    return { ok: false, error: `**${caster.name}** is not a spontaneous caster. Use \`/spells prepare\` or \`/spells learn\` instead.` };
  }
  const merged = getMergedSpellbook(charEntry, casterName);
  const rankList = rank === 0 ? merged.cantrips : (merged.ranks[rank] ?? []);
  const knownL = rankList.map(n => n.toLowerCase());
  if (!knownL.includes(removeName.toLowerCase())) {
    return { ok: false, error: `**${caster.name}** doesn't know **${removeName}** at rank ${rank}. Use \`/spells list\` to see current repertoire.` };
  }
  if (knownL.includes(addName.toLowerCase())) {
    return { ok: false, error: `**${caster.name}** already knows **${addName}** at rank ${rank}.` };
  }
  overlay.repertoire_swaps.push({
    caster: caster.name,
    rank: Number(rank),
    remove: removeName,
    add: addName,
    added_at: new Date().toISOString(),
  });
  return { ok: true, casterName: caster.name };
}

function prepareSpell(charEntry, casterName, spellName, rank) {
  const overlay = ensureOverlay(charEntry);
  const caster = findCaster(charEntry.data, casterName);
  if (!caster) return { ok: false, error: `No caster named "${casterName}" on this character.` };
  if (caster.spellcastingType !== 'prepared') {
    return { ok: false, error: `**${caster.name}** is not a prepared caster. Use \`/spells learn\` or \`/spells swap\` instead.` };
  }
  // Confirm caster knows (or has access to) the spell. For prepared casters
  // like clerics/druids, their "spells" list in Pathbuilder is the prep list;
  // the full known list is the whole tradition. So we don't strictly validate
  // here — we trust the caster to prepare what their class lets them.
  // Slot capacity check: don't allow preparing more spells at a rank than
  // perDay allows.
  const perDayAt = Number(caster.perDay?.[rank] ?? 0);
  if (!overlay.prepared_override[caster.name]) overlay.prepared_override[caster.name] = [];
  const alreadyAtRank = overlay.prepared_override[caster.name].filter(p => Number(p.rank) === Number(rank)).length;
  if (perDayAt > 0 && alreadyAtRank >= perDayAt) {
    return { ok: false, error: `**${caster.name}** has no more rank ${rank} slots to prepare (${alreadyAtRank}/${perDayAt} filled). Use \`/spells unprepare\` to free one first.` };
  }
  overlay.prepared_override[caster.name].push({
    rank: Number(rank),
    spell: spellName,
    slot_index: alreadyAtRank,
    prepared_at: new Date().toISOString(),
  });
  return { ok: true, casterName: caster.name, slot_index: alreadyAtRank };
}

function unprepareSpell(charEntry, casterName, spellName, rank) {
  const overlay = ensureOverlay(charEntry);
  const caster = findCaster(charEntry.data, casterName);
  if (!caster) return { ok: false, error: `No caster named "${casterName}" on this character.` };
  const list = overlay.prepared_override[caster.name] ?? [];
  const nameL = spellName.toLowerCase();
  const idx = list.findIndex(p => Number(p.rank) === Number(rank) && (p.spell || '').toLowerCase() === nameL);
  if (idx === -1) return { ok: false, error: `**${spellName}** is not prepared at rank ${rank} for **${caster.name}**.` };
  list.splice(idx, 1);
  // Renumber slot indexes at this rank so they stay contiguous
  let i = 0;
  for (const entry of list) {
    if (Number(entry.rank) === Number(rank)) { entry.slot_index = i++; }
  }
  return { ok: true, casterName: caster.name };
}

// ─── Daily resources ─────────────────────────────────────────────────────────
// Max focus points from Pathbuilder data.
function getMaxFocus(charData) {
  const top = Number(charData?.focusPoints ?? 0);
  if (top > 0) return top;
  // Fallback: sum caster focus points if per-caster (some exports use it)
  const perCaster = getCasters(charData).reduce((a, c) => a + Number(c.focusPoints ?? 0), 0);
  return Math.min(3, perCaster); // PF2e caps focus pool at 3
}

function getCurrentFocus(charEntry) {
  const overlay = ensureOverlay(charEntry);
  const max = getMaxFocus(charEntry.data);
  const spent = Number(overlay.daily.focus_spent ?? 0);
  return { current: Math.max(0, max - spent), max };
}

function spendFocus(charEntry, amount = 1) {
  const overlay = ensureOverlay(charEntry);
  const { current, max } = getCurrentFocus(charEntry);
  if (current < amount) return { ok: false, error: `Only ${current}/${max} focus points remaining.` };
  overlay.daily.focus_spent += amount;
  return { ok: true, current: current - amount, max };
}

function refocus(charEntry, amount = 1) {
  const overlay = ensureOverlay(charEntry);
  const spent = Number(overlay.daily.focus_spent ?? 0);
  const newSpent = Math.max(0, spent - amount);
  overlay.daily.focus_spent = newSpent;
  return getCurrentFocus(charEntry);
}

function getHeroPoints(charEntry) {
  const overlay = ensureOverlay(charEntry);
  return Math.max(0, Math.min(3, Number(overlay.daily.hero_points ?? 1)));
}

function setHeroPoints(charEntry, n) {
  const overlay = ensureOverlay(charEntry);
  overlay.daily.hero_points = Math.max(0, Math.min(3, Number(n)));
  return overlay.daily.hero_points;
}

// Slot usage. slots_used[casterName][rank] = number of slots spent today.
function getSlotsRemaining(charEntry, casterName, rank) {
  const overlay = ensureOverlay(charEntry);
  const caster = findCaster(charEntry.data, casterName);
  if (!caster) return null;
  const max = Number(caster.perDay?.[rank] ?? 0);
  const used = Number(overlay.daily.slots_used?.[caster.name]?.[rank] ?? 0);
  return { current: Math.max(0, max - used), max };
}

function spendSlot(charEntry, casterName, rank) {
  const overlay = ensureOverlay(charEntry);
  const caster = findCaster(charEntry.data, casterName);
  if (!caster) return { ok: false, error: `No caster named "${casterName}".` };
  const slots = getSlotsRemaining(charEntry, caster.name, rank);
  if (slots.current <= 0) return { ok: false, error: `No rank ${rank} slots remaining for ${caster.name}.`, current: 0, max: slots.max };
  if (!overlay.daily.slots_used[caster.name]) overlay.daily.slots_used[caster.name] = {};
  overlay.daily.slots_used[caster.name][rank] = Number(overlay.daily.slots_used[caster.name][rank] ?? 0) + 1;
  return { ok: true, current: slots.current - 1, max: slots.max };
}

function refundSlot(charEntry, casterName, rank) {
  const overlay = ensureOverlay(charEntry);
  const caster = findCaster(charEntry.data, casterName);
  if (!caster) return;
  const used = Number(overlay.daily.slots_used?.[caster.name]?.[rank] ?? 0);
  if (used > 0) {
    overlay.daily.slots_used[caster.name][rank] = used - 1;
  }
}

// Long rest: resets slots, focus, hero points → 1, clears prepared_override,
// and resets every counter whose reset policy is 'daily' to its max.
function longRest(charEntry) {
  const overlay = ensureOverlay(charEntry);
  overlay.daily.slots_used = {};
  overlay.daily.focus_spent = 0;
  overlay.daily.hero_points = 1;
  overlay.prepared_override = {};
  overlay.daily.last_rest_at = new Date().toISOString();
  // Reset daily counters
  for (const [name, ctr] of Object.entries(overlay.counters || {})) {
    if (ctr && ctr.reset === 'daily') {
      ctr.current = Number(ctr.max ?? 0);
    }
  }
}

// ─── Cvars (user-defined character variables) ────────────────────────────────
// Stored at overlay.cvars[lowercase-name] = string. Values are returned as
// strings; the resolver in index.js decides whether to use them directly
// (if pure numeric) or splice them in literally (e.g. "1d20+8").
//
// Names: 1-32 chars, must start with a letter, then letters/digits/underscore.
// We reject names that collide with built-in variable names so users can't
// accidentally shadow them (the resolver puts cvars first, so a shadow would
// silently change the meaning of {{level}} etc.).

const CVAR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const RESERVED_CVAR_NAMES = new Set([
  // Core
  'level', 'name', 'ac', 'hp', 'maxhp', 'speed', 'hero', 'classdc',
  // Ability mods
  'str', 'dex', 'con', 'int', 'wis', 'cha', 'key',
  // Saves + perception
  'fort', 'fortitude', 'ref', 'reflex', 'will', 'perception',
  // Skill totals
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception',
  'diplomacy', 'intimidation', 'medicine', 'nature', 'occultism',
  'performance', 'religion', 'society', 'stealth', 'survival', 'thievery',
]);

function validateCvarName(name) {
  if (!name || typeof name !== 'string') return 'Name is required.';
  if (!CVAR_NAME_RE.test(name)) return 'Name must start with a letter and contain only letters, numbers, and underscores (1-32 chars).';
  if (RESERVED_CVAR_NAMES.has(name.toLowerCase())) return `\`${name}\` is a reserved built-in variable. Pick a different name.`;
  return null;
}

function setCvar(charEntry, name, value) {
  const overlay = ensureOverlay(charEntry);
  const err = validateCvarName(name);
  if (err) return { ok: false, error: err };
  if (typeof value !== 'string') value = String(value);
  if (value.length === 0) return { ok: false, error: 'Value cannot be empty.' };
  if (value.length > 200) return { ok: false, error: 'Value must be 200 characters or fewer.' };
  if (Object.keys(overlay.cvars).length >= 50 && !overlay.cvars[name.toLowerCase()]) {
    return { ok: false, error: 'You have reached the 50-cvar limit on this character. Delete one with `/cvar delete` to make room.' };
  }
  overlay.cvars[name.toLowerCase()] = value;
  return { ok: true };
}

function getCvar(charEntry, name) {
  const overlay = ensureOverlay(charEntry);
  return overlay.cvars[String(name || '').toLowerCase()];
}

function deleteCvar(charEntry, name) {
  const overlay = ensureOverlay(charEntry);
  const key = String(name || '').toLowerCase();
  if (!(key in overlay.cvars)) return { ok: false, error: `No cvar named \`${key}\`.` };
  delete overlay.cvars[key];
  return { ok: true };
}

function listCvars(charEntry) {
  const overlay = ensureOverlay(charEntry);
  return { ...overlay.cvars };
}

// ─── Custom counters ─────────────────────────────────────────────────────────
// Stored at overlay.counters[lowercase-name] = { current, max, reset, label }.
// reset: 'daily' (cleared on /rest) | 'none' (manual only)

const COUNTER_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const COUNTER_RESET_MODES = new Set(['daily', 'none']);

function validateCounterName(name) {
  if (!name || typeof name !== 'string') return 'Name is required.';
  if (!COUNTER_NAME_RE.test(name)) return 'Name must start with a letter and contain only letters, numbers, and underscores (1-32 chars).';
  return null;
}

function addCounter(charEntry, name, { max, reset = 'none', label = null, initial = null } = {}) {
  const overlay = ensureOverlay(charEntry);
  const err = validateCounterName(name);
  if (err) return { ok: false, error: err };
  if (!COUNTER_RESET_MODES.has(reset)) return { ok: false, error: 'reset must be one of: daily, none.' };
  const maxN = Number(max);
  if (!Number.isFinite(maxN) || maxN < 0 || maxN > 9999) {
    return { ok: false, error: 'max must be a number between 0 and 9999.' };
  }
  const key = name.toLowerCase();
  const existed = !!overlay.counters[key];
  if (!existed && Object.keys(overlay.counters).length >= 30) {
    return { ok: false, error: 'You have reached the 30-counter limit on this character. Remove one with `/cc remove` to make room.' };
  }
  const initN = initial == null ? maxN : Number(initial);
  if (!Number.isFinite(initN) || initN < 0 || initN > maxN) {
    return { ok: false, error: `initial must be a number between 0 and max (${maxN}).` };
  }
  overlay.counters[key] = {
    current: initN,
    max: maxN,
    reset,
    label: label ? String(label).slice(0, 60) : null,
  };
  return { ok: true, existed, counter: overlay.counters[key] };
}

function getCounter(charEntry, name) {
  const overlay = ensureOverlay(charEntry);
  return overlay.counters[String(name || '').toLowerCase()] ?? null;
}

function setCounter(charEntry, name, value) {
  const overlay = ensureOverlay(charEntry);
  const key = String(name || '').toLowerCase();
  const ctr = overlay.counters[key];
  if (!ctr) return { ok: false, error: `No counter named \`${key}\`. Create it with \`/cc add\`.` };
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0 || v > ctr.max) {
    return { ok: false, error: `Value must be between 0 and ${ctr.max}.` };
  }
  ctr.current = v;
  return { ok: true, counter: ctr };
}

function useCounter(charEntry, name, amount = 1) {
  const overlay = ensureOverlay(charEntry);
  const key = String(name || '').toLowerCase();
  const ctr = overlay.counters[key];
  if (!ctr) return { ok: false, error: `No counter named \`${key}\`. Create it with \`/cc add\`.` };
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'amount must be a positive number.' };
  if (ctr.current < n) return { ok: false, error: `Only ${ctr.current}/${ctr.max} remaining on \`${key}\`.`, counter: ctr };
  ctr.current -= n;
  return { ok: true, counter: ctr };
}

function restoreCounter(charEntry, name, amount = 1) {
  const overlay = ensureOverlay(charEntry);
  const key = String(name || '').toLowerCase();
  const ctr = overlay.counters[key];
  if (!ctr) return { ok: false, error: `No counter named \`${key}\`.` };
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'amount must be a positive number.' };
  ctr.current = Math.min(ctr.max, ctr.current + n);
  return { ok: true, counter: ctr };
}

function resetCounter(charEntry, name) {
  const overlay = ensureOverlay(charEntry);
  if (name === 'all' || name === '*') {
    let count = 0;
    for (const ctr of Object.values(overlay.counters)) {
      ctr.current = Number(ctr.max ?? 0);
      count++;
    }
    return { ok: true, all: true, count };
  }
  const key = String(name || '').toLowerCase();
  const ctr = overlay.counters[key];
  if (!ctr) return { ok: false, error: `No counter named \`${key}\`.` };
  ctr.current = Number(ctr.max ?? 0);
  return { ok: true, counter: ctr };
}

function removeCounter(charEntry, name) {
  const overlay = ensureOverlay(charEntry);
  const key = String(name || '').toLowerCase();
  if (!(key in overlay.counters)) return { ok: false, error: `No counter named \`${key}\`.` };
  delete overlay.counters[key];
  return { ok: true };
}

function listCounters(charEntry) {
  const overlay = ensureOverlay(charEntry);
  return { ...overlay.counters };
}

module.exports = {
  blankOverlay,
  ensureOverlay,
  getCasters,
  findCaster,
  getMergedSpellbook,
  learnSpell,
  forgetSpell,
  swapRepertoire,
  prepareSpell,
  unprepareSpell,
  getMaxFocus,
  getCurrentFocus,
  spendFocus,
  refocus,
  getHeroPoints,
  setHeroPoints,
  getSlotsRemaining,
  spendSlot,
  refundSlot,
  longRest,
  // cvars
  validateCvarName,
  setCvar,
  getCvar,
  deleteCvar,
  listCvars,
  RESERVED_CVAR_NAMES,
  // counters
  validateCounterName,
  addCounter,
  getCounter,
  setCounter,
  useCounter,
  restoreCounter,
  resetCounter,
  removeCounter,
  listCounters,
  COUNTER_RESET_MODES,
};