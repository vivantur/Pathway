// systems/combatV2/state.js
// Combat v2 state model. This is intentionally isolated from the legacy
// encounter system so we can migrate commands one slice at a time.

const encounters = new Map();

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function nowIso() {
  return new Date().toISOString();
}

function createEncounter(channelId, { guildId = null, gmId, name = 'Encounter' } = {}) {
  const encounter = {
    version: 2,
    id: channelId,
    channelId,
    guildId,
    gmId,
    name,
    round: 1,
    turnIndex: 0,
    summaryMessageId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    combatants: [],
    log: [],
  };
  encounters.set(channelId, encounter);
  return encounter;
}

function getEncounter(channelId) {
  return encounters.get(channelId) ?? null;
}

function endEncounter(channelId) {
  return encounters.delete(channelId);
}

function sortCombatants(encounter) {
  const currentId = currentCombatant(encounter)?.id ?? null;
  encounter.combatants.sort((a, b) => {
    if (!!a.delayed !== !!b.delayed) return a.delayed ? 1 : -1;
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    if ((a.groupId ?? '') !== (b.groupId ?? '')) return String(a.groupId ?? '').localeCompare(String(b.groupId ?? ''));
    if (a.isNpc !== b.isNpc) return a.isNpc ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  if (currentId) {
    const newIndex = encounter.combatants.findIndex(c => c.id === currentId);
    if (newIndex >= 0) encounter.turnIndex = newIndex;
  }
  encounter.turnIndex = Math.max(0, Math.min(encounter.turnIndex, Math.max(0, encounter.combatants.length - 1)));
  encounter.updatedAt = nowIso();
  return encounter;
}

function makeCombatant(input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Combatant name is required.');
  const maxHp = Number.isFinite(input.maxHp) ? input.maxHp : (Number.isFinite(input.hp) ? input.hp : 1);
  const hp = Number.isFinite(input.hp) ? input.hp : maxHp;
  return {
    id: input.id ?? `${slug(name)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    type: input.type ?? (input.isNpc ? 'monster' : 'pc'),
    initiative: Number.isFinite(input.initiative) ? input.initiative : 0,
    groupId: input.groupId ?? null,
    ownerId: input.ownerId ?? null,
    isNpc: input.isNpc ?? !['pc', 'companion'].includes(input.type),
    hidden: input.hidden ?? input.isNpc ?? !['pc', 'companion'].includes(input.type),
    sourceKey: input.sourceKey ?? null,
    hp,
    maxHp,
    tempHp: input.tempHp ?? 0,
    ac: input.ac ?? null,
    saves: { fort: null, ref: null, will: null, ...(input.saves ?? {}) },
    skills: { ...(input.skills ?? {}) },
    attacks: Array.isArray(input.attacks) ? input.attacks : [],
    spells: Array.isArray(input.spells) ? input.spells : [],
    abilities: Array.isArray(input.abilities) ? input.abilities : [],
    resistances: { ...(input.resistances ?? {}) },
    weaknesses: { ...(input.weaknesses ?? {}) },
    immunities: Array.isArray(input.immunities) ? input.immunities : [],
    effects: Array.isArray(input.effects) ? input.effects : [],
    attacksThisTurn: input.attacksThisTurn ?? 0,
    reactionUsed: input.reactionUsed ?? false,
    hasReaction: input.hasReaction ?? true,
    delayed: input.delayed ?? false,
    notes: input.notes ?? '',
  };
}

function addCombatant(channelId, input) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = makeCombatant(input);
  if (encounter.combatants.some(c => c.name.toLowerCase() === combatant.name.toLowerCase())) {
    throw new Error(`A combatant named "${combatant.name}" already exists.`);
  }
  encounter.combatants.push(combatant);
  encounter.log.push({ at: nowIso(), kind: 'add', name: combatant.name });
  return { encounter: sortCombatants(encounter), combatant };
}

function findCombatant(encounter, query) {
  if (!encounter || !query) return null;
  const q = String(query).toLowerCase().trim();
  const exact = encounter.combatants.find(c => c.name.toLowerCase() === q || c.id === query);
  if (exact) return exact;
  const partial = encounter.combatants.filter(c => c.name.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0] : null;
}

function removeCombatant(channelId, query) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const index = encounter.combatants.findIndex(c => c.id === combatant.id);
  encounter.combatants.splice(index, 1);
  if (index < encounter.turnIndex) encounter.turnIndex -= 1;
  if (encounter.turnIndex >= encounter.combatants.length) encounter.turnIndex = 0;
  encounter.updatedAt = nowIso();
  encounter.log.push({ at: nowIso(), kind: 'remove', name: combatant.name });
  return { encounter, combatant };
}

function currentCombatant(encounter) {
  return encounter?.combatants?.[encounter.turnIndex] ?? null;
}

function resetTurnState(combatant) {
  if (!combatant) return;
  combatant.attacksThisTurn = 0;
  combatant.reactionUsed = false;
}

function advanceTurn(channelId, direction = 1) {
  const encounter = getEncounter(channelId);
  if (!encounter || encounter.combatants.length === 0) return null;
  const len = encounter.combatants.length;
  let wrapped = false;
  for (let steps = 0; steps < len; steps += 1) {
    encounter.turnIndex = (encounter.turnIndex + direction + len) % len;
    if (direction > 0 && encounter.turnIndex === 0) wrapped = true;
    if (direction < 0 && encounter.turnIndex === len - 1) wrapped = true;
    const candidate = currentCombatant(encounter);
    if (!candidate?.delayed) break;
  }
  if (direction > 0 && wrapped) encounter.round += 1;
  if (direction < 0 && wrapped && encounter.round > 1) encounter.round -= 1;
  resetTurnState(currentCombatant(encounter));
  encounter.updatedAt = nowIso();
  encounter.log.push({ at: nowIso(), kind: direction >= 0 ? 'next' : 'prev', current: currentCombatant(encounter)?.name ?? null });
  return { encounter, current: currentCombatant(encounter) };
}

function delayCombatant(channelId, query) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = query ? findCombatant(encounter, query) : currentCombatant(encounter);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const wasCurrent = currentCombatant(encounter)?.id === combatant.id;
  combatant.delayed = true;
  encounter.updatedAt = nowIso();
  encounter.log.push({ at: nowIso(), kind: 'delay', name: combatant.name });
  sortCombatants(encounter);
  if (wasCurrent) {
    const nextIndex = encounter.combatants.findIndex(c => !c.delayed);
    encounter.turnIndex = nextIndex >= 0 ? nextIndex : 0;
    resetTurnState(currentCombatant(encounter));
  }
  return { encounter, combatant, current: currentCombatant(encounter) };
}

function rejoinCombatant(channelId, query, targetQuery = null) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const target = targetQuery ? findCombatant(encounter, targetQuery) : currentCombatant(encounter);
  combatant.delayed = false;
  if (target && target.id !== combatant.id) {
    combatant.initiative = Number(target.initiative ?? 0) + 0.01;
  }
  encounter.updatedAt = nowIso();
  encounter.log.push({ at: nowIso(), kind: 'rejoin', name: combatant.name, before: target?.name ?? null });
  sortCombatants(encounter);
  const index = encounter.combatants.findIndex(c => c.id === combatant.id);
  if (index >= 0) encounter.turnIndex = index;
  resetTurnState(currentCombatant(encounter));
  return { encounter, combatant, current: currentCombatant(encounter) };
}

function applyHp(channelId, query, amount, { mode = 'delta' } = {}) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const before = { hp: combatant.hp, tempHp: combatant.tempHp };
  if (mode === 'set') {
    combatant.hp = Math.max(0, Math.min(combatant.maxHp, amount));
  } else if (amount < 0) {
    let damage = Math.abs(amount);
    const absorbed = Math.min(combatant.tempHp ?? 0, damage);
    combatant.tempHp = Math.max(0, (combatant.tempHp ?? 0) - absorbed);
    damage -= absorbed;
    combatant.hp = Math.max(0, combatant.hp - damage);
  } else {
    combatant.hp = Math.min(combatant.maxHp, combatant.hp + amount);
  }
  encounter.updatedAt = nowIso();
  encounter.log.push({ at: nowIso(), kind: 'hp', name: combatant.name, amount, mode, before, after: { hp: combatant.hp, tempHp: combatant.tempHp } });
  return { encounter, combatant, before };
}

function setTempHp(channelId, query, amount) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const before = combatant.tempHp ?? 0;
  combatant.tempHp = Math.max(before, amount);
  encounter.updatedAt = nowIso();
  encounter.log.push({ at: nowIso(), kind: 'tempHp', name: combatant.name, before, after: combatant.tempHp });
  return { encounter, combatant, before };
}

function addEffect(channelId, query, effect) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const key = slug(effect.name);
  const clean = {
    id: effect.id ?? key,
    name: effect.name,
    value: effect.value ?? null,
    duration: effect.duration ?? null,
    modifiers: { ...(effect.modifiers ?? {}) },
    hidden: effect.hidden ?? false,
    source: effect.source ?? null,
  };
  const existing = combatant.effects.findIndex(e => e.id === clean.id || slug(e.name) === key);
  if (existing >= 0) combatant.effects[existing] = clean;
  else combatant.effects.push(clean);
  encounter.updatedAt = nowIso();
  return { encounter, combatant, effect: clean, replaced: existing >= 0 };
}

function removeEffect(channelId, query, effectName) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const key = slug(effectName);
  const index = combatant.effects.findIndex(e => e.id === key || slug(e.name) === key);
  if (index < 0) throw new Error(`No effect named "${effectName}" on ${combatant.name}.`);
  const [effect] = combatant.effects.splice(index, 1);
  encounter.updatedAt = nowIso();
  return { encounter, combatant, effect };
}

function modifyCombatant(channelId, query, patch) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const allowed = ['name', 'initiative', 'hp', 'maxHp', 'tempHp', 'ac', 'hidden', 'groupId', 'resistances', 'weaknesses', 'immunities', 'saves', 'skills', 'delayed', 'notes'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) combatant[key] = patch[key];
  }
  encounter.updatedAt = nowIso();
  return { encounter: sortCombatants(encounter), combatant };
}

module.exports = {
  slug,
  createEncounter,
  getEncounter,
  endEncounter,
  addCombatant,
  removeCombatant,
  findCombatant,
  currentCombatant,
  advanceTurn,
  delayCombatant,
  rejoinCombatant,
  applyHp,
  setTempHp,
  addEffect,
  removeEffect,
  modifyCombatant,
  sortCombatants,
};
