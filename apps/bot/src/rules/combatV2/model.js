// ── rules/combatV2/model.js ──────────────────────────────────────────────────
// The PURE combat v2 model. No I/O, no database, no Discord, no module state.
//
// Every function here operates on the plain `encounter` / `combatant` objects it
// is handed and returns a result. Nothing in this file knows where an encounter
// is stored or how it is persisted — that is the adapter's job (see
// `state/combat.js`). Keeping the two apart is what lets the combat rules be
// tested without a database, and is the precondition for ever moving them into
// `packages/core`.
//
// RULE: this module must never require `lib/storage`, `lib/supabase`, or any
// Discord module. `test/combatV2Model.test.js` enforces that.
//
// `Date`/`Math.random` are used for ids, log timestamps, and dice. Those are
// nondeterminism, not I/O; the test suite controls them by stubbing
// `Math.random`, matching how `rolls.js` is already treated.

'use strict';

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

/**
 * Does this stored combatant array look like a combat v2 snapshot (rather than
 * a row written by the retired legacy engine)? An empty encounter counts as v2.
 */
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

/** Build a fully-defaulted combatant from partial input. Throws on a blank name. */
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

/** Exact name/id match first, then a unique partial name match. */
function findCombatant(encounter, query) {
  if (!encounter || !query) return null;
  const q = String(query).toLowerCase().trim();
  const exact = encounter.combatants.find(c => c.name.toLowerCase() === q || c.id === query);
  if (exact) return exact;
  const partial = encounter.combatants.filter(c => c.name.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0] : null;
}

/** findCombatant, but throws the caller-facing error when there's no match. */
function requireCombatant(encounter, query) {
  const combatant = findCombatant(encounter, query);
  if (!combatant) throw new Error(`No combatant matching "${query}".`);
  return combatant;
}

function currentCombatant(encounter) {
  return encounter?.combatants?.[encounter.turnIndex] ?? null;
}

function resetTurnState(combatant) {
  if (!combatant) return;
  combatant.attacksThisTurn = 0;
  combatant.reactionUsed = false;
}

/**
 * Order combatants by initiative (delayed last), keeping the current combatant
 * under the turn cursor. Mutates and returns the encounter. Persisting the
 * result is the caller's business.
 */
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
  return encounter;
}

// ── Combatant lifecycle ──────────────────────────────────────────────────────
//
// Each of these mutates `encounter` and returns a result. None of them persist:
// the adapter writes once per public call. (state.js used to persist inside
// these, and again in sortCombatants, so a single add cost two writes.)

function addCombatant(encounter, input) {
  const combatant = makeCombatant(input);
  if (encounter.combatants.some(c => c.name.toLowerCase() === combatant.name.toLowerCase())) {
    throw new Error(`A combatant named "${combatant.name}" already exists.`);
  }
  encounter.combatants.push(combatant);
  encounter.log.push({ at: nowIso(), kind: 'add', name: combatant.name });
  sortCombatants(encounter);
  return { encounter, combatant };
}

function removeCombatant(encounter, query) {
  const combatant = requireCombatant(encounter, query);
  const index = encounter.combatants.findIndex(c => c.id === combatant.id);
  encounter.combatants.splice(index, 1);
  // Keep the turn cursor pointing at the same combatant it was on.
  if (index < encounter.turnIndex) encounter.turnIndex -= 1;
  if (encounter.turnIndex >= encounter.combatants.length) encounter.turnIndex = 0;
  encounter.log.push({ at: nowIso(), kind: 'remove', name: combatant.name });
  return { encounter, combatant };
}

/** Temporary HP does not stack — the larger pool wins (PF2e Player Core). */
function setTempHp(encounter, query, amount) {
  const combatant = requireCombatant(encounter, query);
  const before = combatant.tempHp ?? 0;
  combatant.tempHp = Math.max(before, amount);
  encounter.log.push({ at: nowIso(), kind: 'tempHp', name: combatant.name, before, after: combatant.tempHp });
  return { encounter, combatant, before };
}

const MODIFIABLE_FIELDS = [
  'name', 'initiative', 'hp', 'maxHp', 'tempHp', 'ac', 'hidden', 'groupId',
  'resistances', 'weaknesses', 'immunities', 'saves', 'skills', 'delayed', 'notes',
];

function modifyCombatant(encounter, query, patch) {
  const combatant = requireCombatant(encounter, query);
  for (const key of MODIFIABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) combatant[key] = patch[key];
  }
  sortCombatants(encounter);
  return { encounter, combatant };
}

// ── Turn flow ────────────────────────────────────────────────────────────────

/**
 * Step the turn cursor, skipping delayed combatants, wrapping the round.
 * Returns null (and changes nothing) when there is nobody in the encounter.
 */
function advanceTurn(encounter, direction = 1) {
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
  return { encounter, current: currentCombatant(encounter) };
}

/** Delay: drop to the back of the order. If it was your turn, the next one starts. */
function delayCombatant(encounter, query) {
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
  return { encounter, combatant, current: currentCombatant(encounter) };
}

/** Rejoin ahead of `targetQuery` (default: the current combatant). */
function rejoinCombatant(encounter, query, targetQuery = null) {
  const combatant = requireCombatant(encounter, query);
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
  return { encounter, combatant, current: currentCombatant(encounter) };
}

// ── Effects ──────────────────────────────────────────────────────────────────

/** Add an effect, replacing any existing one with the same id or slugged name. */
function addEffect(encounter, query, effect) {
  const combatant = requireCombatant(encounter, query);
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
  return { encounter, combatant, effect: clean, replaced: existing >= 0 };
}

function removeEffect(encounter, query, effectName) {
  const combatant = requireCombatant(encounter, query);
  const key = slug(effectName);
  const index = combatant.effects.findIndex(e => e.id === key || slug(e.name) === key);
  if (index < 0) throw new Error(`No effect named "${effectName}" on ${combatant.name}.`);
  const [effect] = combatant.effects.splice(index, 1);
  return { encounter, combatant, effect };
}

function effectKey(effect) {
  return slug(effect?.id ?? effect?.presetKey ?? effect?.name);
}

function effectValue(effect) {
  const value = Number(effect?.value ?? effect?.modifiers?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** Decrement finite durations; return the effects that expired this tick. */
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

/**
 * Net actions for a combatant's turn given slowed/stunned/quickened, applying
 * the PF2e rule that stunned is consumed by the actions it removes. Mutates the
 * combatant's effects (stunned decrements or clears). Returns null when no
 * action-economy effect is present.
 */
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

module.exports = {
  slug,
  nowIso,
  isCombatV2Snapshot,
  makeCombatant,
  findCombatant,
  requireCombatant,
  currentCombatant,
  resetTurnState,
  sortCombatants,
  addCombatant,
  removeCombatant,
  setTempHp,
  modifyCombatant,
  advanceTurn,
  delayCombatant,
  rejoinCombatant,
  addEffect,
  removeEffect,
  effectKey,
  effectValue,
  tickEffectDurations,
  getPersistentDamageEffects,
  persistentDamageConfig,
  processActionEconomy,
};
