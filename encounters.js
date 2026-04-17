// encounters.js
// In-memory encounter store, keyed by channelId.
// Each encounter = { combatants: [], turnIndex: 0, round: 1, gmId, summaryMessageId }
// Each combatant = { name, initiative, hp, maxHp, ac, ownerId, isNpc, effects: [] }
// Each effect = { name, value, duration, modifiers: {...}, isPreset, presetKey, appliedBy }

const encounters = new Map();

function getEncounter(channelId) {
  return encounters.get(channelId) || null;
}

function createEncounter(channelId, gmId) {
  const encounter = {
    combatants: [],
    turnIndex: 0,
    round: 1,
    gmId,
    summaryMessageId: null,
  };
  encounters.set(channelId, encounter);
  return encounter;
}

function deleteEncounter(channelId) {
  encounters.delete(channelId);
}

function addCombatant(channelId, combatant) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  // Ensure every combatant has an effects array
  if (!combatant.effects) combatant.effects = [];
  enc.combatants.push(combatant);
  enc.combatants.sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    if (b.maxHp !== a.maxHp) return b.maxHp - a.maxHp;
    return a.name.localeCompare(b.name);
  });
  return enc;
}

function removeCombatant(channelId, name) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  const idx = enc.combatants.findIndex(
    c => c.name.toLowerCase() === name.toLowerCase()
  );
  if (idx === -1) return null;
  if (idx < enc.turnIndex) enc.turnIndex--;
  enc.combatants.splice(idx, 1);
  if (enc.turnIndex >= enc.combatants.length) enc.turnIndex = 0;
  return enc;
}

// Advance the turn. Tick down effects on the NEW current combatant (start-of-turn timing).
// Returns { enc, current, expiredEffects } where expiredEffects is an array of effects that just ended.
function advanceTurn(channelId) {
  const enc = encounters.get(channelId);
  if (!enc || enc.combatants.length === 0) return null;
  enc.turnIndex++;
  if (enc.turnIndex >= enc.combatants.length) {
    enc.turnIndex = 0;
    enc.round++;
  }
  const current = enc.combatants[enc.turnIndex];
  const expiredEffects = [];

  // Tick down effects on the current combatant (their turn is starting)
  if (current.effects && current.effects.length > 0) {
    current.effects = current.effects.filter(effect => {
      // Effects with duration null/undefined are "permanent until removed"
      if (effect.duration === null || effect.duration === undefined) return true;
      effect.duration -= 1;
      if (effect.duration <= 0) {
        expiredEffects.push({ combatantName: current.name, effect });
        return false;
      }
      return true;
    });
  }

  return { enc, current, expiredEffects };
}

function modifyHp(channelId, name, delta) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  const c = enc.combatants.find(
    c => c.name.toLowerCase() === name.toLowerCase()
  );
  if (!c) return null;
  c.hp = Math.max(0, Math.min(c.maxHp, c.hp + delta));
  return c;
}

function setSummaryMessageId(channelId, messageId) {
  const enc = encounters.get(channelId);
  if (!enc) return;
  enc.summaryMessageId = messageId;
}

// ── Effect helpers ────────────────────────────────────────────────────────

// Find a combatant in an encounter (case-insensitive match)
function findCombatant(enc, name) {
  if (!enc || !name) return null;
  return enc.combatants.find(c => c.name.toLowerCase() === name.toLowerCase()) || null;
}

// Add an effect to a combatant. If an effect with the same name already exists,
// replaces it (new version overrides old). Returns { combatant, effect, replaced }.
function addEffect(channelId, combatantName, effect) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  const combatant = findCombatant(enc, combatantName);
  if (!combatant) return null;
  if (!combatant.effects) combatant.effects = [];

  // Check for existing effect with same name
  const existingIdx = combatant.effects.findIndex(
    e => e.name.toLowerCase() === effect.name.toLowerCase()
  );
  let replaced = false;
  if (existingIdx >= 0) {
    combatant.effects.splice(existingIdx, 1);
    replaced = true;
  }
  combatant.effects.push(effect);
  return { combatant, effect, replaced };
}

// Remove an effect from a combatant by effect name. Returns the removed effect or null.
function removeEffect(channelId, combatantName, effectName) {
  const enc = encounters.get(channelId);
  if (!enc) return null;
  const combatant = findCombatant(enc, combatantName);
  if (!combatant || !combatant.effects) return null;
  const idx = combatant.effects.findIndex(
    e => e.name.toLowerCase() === effectName.toLowerCase()
  );
  if (idx === -1) return null;
  const [removed] = combatant.effects.splice(idx, 1);
  return { combatant, effect: removed };
}

// Remove ALL effects from a combatant. Returns count removed.
function clearEffects(channelId, combatantName) {
  const enc = encounters.get(channelId);
  if (!enc) return 0;
  const combatant = findCombatant(enc, combatantName);
  if (!combatant || !combatant.effects) return 0;
  const count = combatant.effects.length;
  combatant.effects = [];
  return count;
}

module.exports = {
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
};