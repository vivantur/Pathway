// systems/combatV2/state.js
// Combat v2 state model. This is intentionally isolated from the legacy
// encounter system so we can migrate commands one slice at a time.

const { syncEncounterToSupabase, endEncounterInSupabase, getSupabase } = require('../../lib/storage');
const { rollDamage, applyDefenses } = require('./rolls');

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

function isCombatV2Snapshot(combatants) {
  if (!Array.isArray(combatants) || combatants.length === 0) return true;
  return combatants.some(c => c && (
    c.type != null
    || c.sourceKey != null
    || c.attacksThisTurn != null
    || c.reactionUsed != null
    || Array.isArray(c.attacks)
    || Array.isArray(c.spells)
    || c.resistances != null
    || c.weaknesses != null
  ));
}

function touchEncounter(encounter) {
  if (!encounter) return encounter;
  encounter.updatedAt = nowIso();
  syncEncounterToSupabase(encounter.channelId, encounter);
  return encounter;
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
  return touchEncounter(encounter);
}

function getEncounter(channelId) {
  return encounters.get(channelId) ?? null;
}

function endEncounter(channelId) {
  const encounter = encounters.get(channelId);
  if (encounter) endEncounterInSupabase(encounter);
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
  return touchEncounter(encounter);
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
    dying: input.dying ?? 0,
    wounded: input.wounded ?? 0,
    doomed: input.doomed ?? 0,
    unconscious: input.unconscious ?? false,
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
  touchEncounter(encounter);
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

function rollRecoveryCheck(channelId, query) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  if ((combatant.dying ?? 0) <= 0) return null;

  if (typeof combatant.dying !== 'number') combatant.dying = 0;
  if (typeof combatant.wounded !== 'number') combatant.wounded = 0;
  if (typeof combatant.doomed !== 'number') combatant.doomed = 0;

  const dyingBefore = combatant.dying;
  const wounded = combatant.wounded ?? 0;
  const doomed = combatant.doomed ?? 0;
  const maxDying = Math.max(1, 4 - doomed);
  const dc = 10 + dyingBefore;
  const roll = Math.floor(Math.random() * 20) + 1;

  let outcome;
  let baseDelta;
  if (roll === 20) {
    outcome = 'crit-success';
    baseDelta = -2;
  } else if (roll === 1) {
    outcome = 'crit-failure';
    baseDelta = 2;
  } else if (roll >= dc + 10) {
    outcome = 'crit-success';
    baseDelta = -2;
  } else if (roll >= dc) {
    outcome = 'success';
    baseDelta = -1;
  } else if (roll <= dc - 10) {
    outcome = 'crit-failure';
    baseDelta = 2;
  } else {
    outcome = 'failure';
    baseDelta = 1;
  }

  const woundedAdded = baseDelta > 0 ? wounded : 0;
  const delta = baseDelta + woundedAdded;
  let dyingAfter = dyingBefore + delta;
  let died = false;
  let awoke = false;
  let removed = null;

  if (dyingAfter >= maxDying) {
    died = true;
    dyingAfter = maxDying;
    combatant.dying = maxDying;
    removed = { ...combatant };
    removeCombatant(channelId, combatant.name);
  } else if (dyingAfter <= 0) {
    awoke = true;
    dyingAfter = 0;
    combatant.dying = 0;
    combatant.wounded = (combatant.wounded ?? 0) + 1;
    combatant.unconscious = (combatant.hp ?? 0) <= 0;
  } else {
    combatant.dying = dyingAfter;
    combatant.unconscious = true;
  }

  encounter.log.push({
    at: nowIso(),
    kind: died ? 'recovery-death' : 'recovery',
    name: removed?.name ?? combatant.name,
    roll,
    dc,
    outcome,
    dyingBefore,
    dyingAfter,
  });
  touchEncounter(encounter);

  const name = removed?.name ?? combatant.name;
  let narration;
  if (died) {
    narration = doomed > 0
      ? `${name} has died. (Doomed ${doomed} means death at Dying ${maxDying}.)`
      : `${name} has died.`;
  } else if (awoke) {
    narration = `${name} stabilizes at 0 HP. (Now Wounded ${combatant.wounded}, still unconscious until healed.)`;
  } else if (delta < 0) {
    narration = `Dying reduced: ${dyingBefore} -> ${dyingAfter}`;
  } else if (delta > 0) {
    const woundedNote = woundedAdded > 0 ? ` (+${baseDelta} base, +${woundedAdded} from Wounded ${wounded})` : '';
    narration = `Dying increased: ${dyingBefore} -> ${dyingAfter}${woundedNote}`;
  } else {
    narration = `Dying unchanged at ${dyingAfter}`;
  }

  return {
    encounter,
    combatant,
    removed,
    name,
    roll,
    dc,
    outcome,
    delta,
    baseDelta,
    dyingBefore,
    dyingAfter,
    dying: dyingAfter,
    wounded: combatant.wounded ?? wounded,
    woundedAdded,
    doomed,
    maxDying,
    died,
    awoke,
    narration,
  };
}

// GM override of a combatant's dying value (0–4). PF2e RAW semantics match
// the automated paths: manually clearing dying grants Wounded +1 and does NOT
// restore HP (unconscious at 0 HP until healed); reaching the max dying value
// (4, lowered by doomed) is death and removes the combatant.
function setDying(channelId, query, value) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const before = combatant.dying ?? 0;
  const maxDying = Math.max(1, 4 - (combatant.doomed ?? 0));
  let died = false;
  let recovered = false;
  let removed = null;

  encounter.log.push({ at: nowIso(), kind: 'set-dying', name: combatant.name, before, value });

  if (value >= maxDying) {
    combatant.dying = maxDying;
    died = true;
    removed = removeCombatant(channelId, combatant.name).combatant;
  } else if (value === 0 && before > 0) {
    combatant.dying = 0;
    combatant.wounded = (combatant.wounded ?? 0) + 1;
    combatant.unconscious = (combatant.hp ?? 0) <= 0;
    recovered = true;
    touchEncounter(encounter);
  } else {
    combatant.dying = Math.max(0, value);
    if (combatant.dying > 0) combatant.unconscious = true;
    touchEncounter(encounter);
  }

  return {
    encounter,
    combatant,
    before,
    value: died ? maxDying : Math.max(0, value),
    maxDying,
    died,
    recovered,
    removed,
    wounded: combatant.wounded ?? 0,
    doomed: combatant.doomed ?? 0,
  };
}

function advanceTurn(channelId, direction = 1) {
  const encounter = getEncounter(channelId);
  if (!encounter || encounter.combatants.length === 0) return null;
  const len = encounter.combatants.length;
  let wrapped = false;
  for (let steps = 0; steps < len; steps += 1) {
    const previousIndex = encounter.turnIndex;
    encounter.turnIndex = (encounter.turnIndex + direction + len) % len;
    if (direction > 0 && previousIndex >= 0 && encounter.turnIndex <= previousIndex) wrapped = true;
    if (direction < 0 && encounter.turnIndex > previousIndex) wrapped = true;
    const candidate = currentCombatant(encounter);
    if (!candidate?.delayed) break;
  }
  if (direction > 0 && wrapped) encounter.round += 1;
  if (direction < 0 && wrapped && encounter.round > 1) encounter.round -= 1;
  resetTurnState(currentCombatant(encounter));
  encounter.log.push({ at: nowIso(), kind: direction >= 0 ? 'next' : 'prev', current: currentCombatant(encounter)?.name ?? null });
  touchEncounter(encounter);
  return { encounter, current: currentCombatant(encounter) };
}

function delayCombatant(channelId, query) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = query ? findCombatant(encounter, query) : currentCombatant(encounter);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const wasCurrent = currentCombatant(encounter)?.id === combatant.id;
  combatant.delayed = true;
  encounter.log.push({ at: nowIso(), kind: 'delay', name: combatant.name });
  sortCombatants(encounter);
  if (wasCurrent) {
    const nextIndex = encounter.combatants.findIndex(c => !c.delayed);
    encounter.turnIndex = nextIndex >= 0 ? nextIndex : 0;
    resetTurnState(currentCombatant(encounter));
  }
  touchEncounter(encounter);
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
  encounter.log.push({ at: nowIso(), kind: 'rejoin', name: combatant.name, before: target?.name ?? null });
  sortCombatants(encounter);
  const index = encounter.combatants.findIndex(c => c.id === combatant.id);
  if (index >= 0) encounter.turnIndex = index;
  resetTurnState(currentCombatant(encounter));
  touchEncounter(encounter);
  return { encounter, combatant, current: currentCombatant(encounter) };
}

function applyHp(channelId, query, amount, { mode = 'delta' } = {}) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const before = {
    hp: combatant.hp,
    tempHp: combatant.tempHp,
    dying: combatant.dying ?? 0,
    wounded: combatant.wounded ?? 0,
  };
  if (typeof combatant.dying !== 'number') combatant.dying = 0;
  if (typeof combatant.wounded !== 'number') combatant.wounded = 0;
  if (typeof combatant.doomed !== 'number') combatant.doomed = 0;

  const hpBefore = combatant.hp;
  const wasDying = combatant.dying > 0;
  let effectiveDamage = 0;
  if (mode === 'set') {
    combatant.hp = Math.max(0, Math.min(combatant.maxHp, amount));
    if (combatant.hp < hpBefore) effectiveDamage = hpBefore - combatant.hp;
  } else if (amount < 0) {
    let damage = Math.abs(amount);
    const absorbed = Math.min(combatant.tempHp ?? 0, damage);
    combatant.tempHp = Math.max(0, (combatant.tempHp ?? 0) - absorbed);
    damage -= absorbed;
    effectiveDamage = damage;
    combatant.hp = Math.max(0, combatant.hp - damage);
  } else {
    combatant.hp = Math.min(combatant.maxHp, combatant.hp + amount);
  }

  const maxDying = Math.max(1, 4 - (combatant.doomed ?? 0));
  let wentDown = false;
  let dyingIncreased = false;
  let wokeUp = false;
  let died = false;

  if (amount > 0 && wasDying && combatant.hp > 0) {
    combatant.dying = 0;
    combatant.wounded = (combatant.wounded ?? 0) + 1;
    combatant.unconscious = false;
    wokeUp = true;
  } else if (amount > 0 && combatant.unconscious && combatant.hp > 0) {
    combatant.unconscious = false;
    wokeUp = true;
  }

  if ((mode === 'set' || amount < 0) && effectiveDamage > 0 && combatant.hp === 0) {
    if (hpBefore > 0) {
      wentDown = true;
      combatant.dying = 1 + (combatant.wounded ?? 0);
    } else if (wasDying) {
      dyingIncreased = true;
      combatant.dying += 1;
    }
    combatant.unconscious = true;
    if (combatant.dying >= maxDying) {
      combatant.dying = maxDying;
      died = true;
    }
  }

  encounter.log.push({
    at: nowIso(),
    kind: died ? 'death' : 'hp',
    name: combatant.name,
    amount,
    mode,
    before,
    after: { hp: combatant.hp, tempHp: combatant.tempHp, dying: combatant.dying, wounded: combatant.wounded },
  });

  let removed = null;
  if (died) {
    removed = removeCombatant(channelId, combatant.name).combatant;
  } else {
    touchEncounter(encounter);
  }

  return {
    encounter,
    combatant,
    before,
    wentDown,
    dyingIncreased,
    wokeUp,
    died,
    removed,
    dying: combatant.dying,
    wounded: combatant.wounded,
    maxDying,
  };
}

function setTempHp(channelId, query, amount) {
  const encounter = getEncounter(channelId);
  if (!encounter) throw new Error('No active encounter.');
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  const before = combatant.tempHp ?? 0;
  combatant.tempHp = Math.max(before, amount);
  encounter.log.push({ at: nowIso(), kind: 'tempHp', name: combatant.name, before, after: combatant.tempHp });
  touchEncounter(encounter);
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
  touchEncounter(encounter);
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
  touchEncounter(encounter);
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
  return { encounter: sortCombatants(encounter), combatant };
}

function effectKey(effect) {
  return slug(effect?.id ?? effect?.presetKey ?? effect?.name);
}

function effectValue(effect) {
  const value = Number(effect?.value ?? effect?.modifiers?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function tickEffectDurations(combatant) {
  const expiredEffects = [];
  if (!combatant?.effects?.length) return expiredEffects;
  combatant.effects = combatant.effects.filter(effect => {
    if (effect.duration === null || effect.duration === undefined) return true;
    effect.duration -= 1;
    if (effect.duration <= 0) {
      expiredEffects.push({ combatantName: combatant.name, effect });
      return false;
    }
    return true;
  });
  return expiredEffects;
}

function getPersistentDamageEffects(combatant) {
  if (!combatant?.effects?.length) return [];
  return combatant.effects.filter(effect => {
    const kind = effect?.kind ?? effect?.modifiers?.kind;
    return kind === 'persistent-damage' || effectKey(effect).startsWith('persistent-');
  });
}

function persistentDamageConfig(effect) {
  const modifiers = effect?.modifiers ?? {};
  const key = effectKey(effect);
  let damageType = effect.damageType ?? modifiers.damageType ?? modifiers.type ?? null;
  if (!damageType && key.startsWith('persistent-')) damageType = key.replace(/^persistent-/, '');
  return {
    damageDice: effect.dice ?? modifiers.dice ?? modifiers.damageDice ?? modifiers.damage ?? `${Math.max(1, effectValue(effect) || 1)}d6`,
    damageType: damageType || 'untyped',
    flatDc: Number(effect.dc ?? modifiers.dc ?? 15) || 15,
  };
}

function tickPersistentDamage(channelId, query) {
  const encounter = getEncounter(channelId);
  if (!encounter) return [];
  const combatant = findCombatant(encounter, query);
  if (!combatant) return [];
  const effects = getPersistentDamageEffects(combatant);
  if (!effects.length) return [];

  const results = [];
  for (const effect of [...effects]) {
    const { damageDice, damageType, flatDc } = persistentDamageConfig(effect);
    const damageRoll = rollDamage(damageDice);
    if (!damageRoll) continue;
    const hpBefore = combatant.hp;
    const defended = applyDefenses(damageRoll.total, damageType, combatant);
    const hpResult = defended.finalDamage > 0
      ? applyHp(channelId, combatant.id, -defended.finalDamage)
      : null;
    const flatRoll = Math.floor(Math.random() * 20) + 1;
    const ended = flatRoll >= flatDc;
    const stillPresent = findCombatant(getEncounter(channelId), combatant.id);

    if (ended && stillPresent?.effects?.length) {
      stillPresent.effects = stillPresent.effects.filter(e => e !== effect);
      touchEncounter(encounter);
    }

    results.push({
      name: combatant.name,
      effectName: effect.name,
      damageType,
      damageDice,
      damageRolls: damageRoll.rolls,
      damage: damageRoll.total,
      finalDamage: defended.finalDamage,
      defenseNotes: defended.notes,
      flatRoll,
      flatDc,
      ended,
      hpBefore,
      hpAfter: stillPresent?.hp ?? hpResult?.combatant?.hp ?? 0,
      wentDown: hpResult?.wentDown ?? false,
      died: hpResult?.died ?? false,
      dying: hpResult?.dying ?? combatant.dying ?? 0,
      removed: hpResult?.removed ?? null,
    });

    if (hpResult?.died) break;
  }
  touchEncounter(encounter);
  return results;
}

function processActionEconomy(combatant) {
  if (!combatant?.effects?.length) return null;
  const slowed = combatant.effects.find(e => effectKey(e) === 'slowed');
  const quickened = combatant.effects.find(e => effectKey(e) === 'quickened');
  const stunned = combatant.effects.find(e => effectKey(e) === 'stunned');

  const actionNotes = [];
  let netActions = 3;
  const slowedValue = effectValue(slowed);
  const stunnedValue = effectValue(stunned);

  if (slowedValue) {
    netActions -= slowedValue;
    actionNotes.push(`Slowed ${slowedValue}`);
  }
  if (stunnedValue) {
    const lost = Math.min(stunnedValue, Math.max(0, netActions));
    netActions -= lost;
    const stunnedRemaining = Math.max(0, stunnedValue - lost);
    if (stunnedRemaining === 0) {
      combatant.effects = combatant.effects.filter(e => e !== stunned);
      actionNotes.push(`Stunned ${stunnedValue} (lost ${lost} actions; Stunned cleared)`);
    } else {
      stunned.value = stunnedRemaining;
      actionNotes.push(`Stunned ${stunnedValue} -> ${stunnedRemaining} (lost ${lost} actions)`);
    }
  }
  if (quickened) {
    netActions += 1;
    actionNotes.push('Quickened (+1 action)');
  }
  if (!actionNotes.length) return null;
  return {
    netActions: Math.max(0, netActions),
    notes: actionNotes,
    text: `${combatant.name} has ${Math.max(0, netActions)} action${Math.max(0, netActions) === 1 ? '' : 's'} this turn: ${actionNotes.join(', ')}`,
  };
}

function processTurnTransition(channelId, direction = 1) {
  const encounter = getEncounter(channelId);
  if (!encounter || encounter.combatants.length === 0) return null;

  const outgoing = currentCombatant(encounter);
  const outgoingIndex = encounter.turnIndex;
  const persistentResults = direction > 0 && outgoing
    ? tickPersistentDamage(channelId, outgoing.id)
    : [];
  const encounterAfterPersistent = getEncounter(channelId);
  if (!encounterAfterPersistent || encounterAfterPersistent.combatants.length === 0) {
    return {
      encounter: encounterAfterPersistent ?? encounter,
      current: null,
      expiredEffects: [],
      persistentResults,
      recoveryCheck: null,
      newRound: false,
      actionEconomy: null,
    };
  }
  if (direction > 0 && persistentResults.some(result => result.died)) {
    encounterAfterPersistent.turnIndex = outgoingIndex - 1;
  }

  const roundBefore = encounter.round;
  const advanceResult = advanceTurn(channelId, direction);
  if (!advanceResult) return null;

  let { current } = advanceResult;
  const newRound = encounter.round > roundBefore;
  const expiredEffects = direction > 0 && current ? tickEffectDurations(current) : [];
  const actionEconomy = direction > 0 && current ? processActionEconomy(current) : null;
  const currentIndexBeforeRecovery = encounter.turnIndex;
  const recoveryCheck = direction > 0 && (current?.dying ?? 0) > 0
    ? rollRecoveryCheck(channelId, current.id)
    : null;
  if (recoveryCheck?.died && encounter.combatants.length > 0) {
    encounter.turnIndex = currentIndexBeforeRecovery - 1;
    current = advanceTurn(channelId, 1)?.current ?? null;
  }

  encounter.log.push({
    at: nowIso(),
    kind: 'turn-transition',
    current: current?.name ?? null,
    round: encounter.round,
    persistentCount: persistentResults.length,
    expiredCount: expiredEffects.length,
    recovery: recoveryCheck?.outcome ?? null,
  });
  touchEncounter(encounter);

  return {
    encounter,
    current,
    expiredEffects,
    persistentResults,
    recoveryCheck,
    newRound,
    actionEconomy,
  };
}

async function restoreEncountersFromSupabase() {
  try {
    const sb = getSupabase();
    if (!sb) return 0;
    const { data: rows, error } = await sb
      .from('encounters')
      .select('*')
      .eq('status', 'active');
    if (error) throw error;
    let count = 0;
    for (const row of rows ?? []) {
      if (!isCombatV2Snapshot(row.combatants)) continue;
      if (encounters.has(row.channel_id)) continue;
      const combatants = Array.isArray(row.combatants) ? row.combatants.map(makeCombatant) : [];
      encounters.set(row.channel_id, {
        version: 2,
        id: row.channel_id,
        channelId: row.channel_id,
        guildId: row.discord_guild_id,
        gmId: row.gm_discord_id ?? null,
        name: `Combat in #${row.channel_id}`,
        round: row.round ?? 1,
        turnIndex: Math.max(0, Math.min(row.turn_index ?? 0, Math.max(0, combatants.length - 1))),
        summaryMessageId: null,
        supabaseId: row.id,
        createdAt: row.created_at ?? nowIso(),
        updatedAt: row.updated_at ?? nowIso(),
        combatants,
        log: [],
      });
      count++;
    }
    if (count > 0) console.log(`[Supabase] Restored ${count} active combat v2 encounter(s) from Supabase`);
    return count;
  } catch (err) {
    console.error('[Supabase] combat v2 encounter restore failed:', err.message);
    return 0;
  }
}

module.exports = {
  slug,
  isCombatV2Snapshot,
  createEncounter,
  getEncounter,
  endEncounter,
  addCombatant,
  removeCombatant,
  findCombatant,
  currentCombatant,
  advanceTurn,
  rollRecoveryCheck,
  setDying,
  delayCombatant,
  rejoinCombatant,
  applyHp,
  setTempHp,
  addEffect,
  removeEffect,
  modifyCombatant,
  sortCombatants,
  tickPersistentDamage,
  processTurnTransition,
  restoreEncountersFromSupabase,
};
