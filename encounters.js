// src/encounters.js
// In-memory encounter store, keyed by channelId.
// Each encounter = { combatants: [], turnIndex: 0, round: 1, gmId: string, summaryMessageId: string|null }

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
    summaryMessageId: null, // ID of the pinned summary message
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
  // combatant = { name, initiative, hp, maxHp, ac, ownerId, isNpc }
  enc.combatants.push(combatant);
  // Sort descending by initiative; ties broken by higher maxHp, then name
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
  // If we're removing someone before or at the current turn, adjust turnIndex
  if (idx < enc.turnIndex) enc.turnIndex--;
  enc.combatants.splice(idx, 1);
  if (enc.turnIndex >= enc.combatants.length) enc.turnIndex = 0;
  return enc;
}

function advanceTurn(channelId) {
  const enc = encounters.get(channelId);
  if (!enc || enc.combatants.length === 0) return null;
  enc.turnIndex++;
  if (enc.turnIndex >= enc.combatants.length) {
    enc.turnIndex = 0;
    enc.round++;
  }
  return enc;
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

module.exports = {
  getEncounter,
  createEncounter,
  deleteEncounter,
  addCombatant,
  removeCombatant,
  advanceTurn,
  modifyHp,
  setSummaryMessageId,
};