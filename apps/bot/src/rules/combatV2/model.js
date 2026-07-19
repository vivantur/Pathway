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
// Discord module. Its ONLY dependency is ./rolls, which is itself pure.
// `test/combatV2Model.test.js` enforces that.
//
// `Date`/`Math.random` are used for ids, log timestamps, and dice. Those are
// nondeterminism, not I/O; the test suite controls them by stubbing
// `Math.random`, matching how `rolls.js` is already treated.

'use strict';

const { rollDamage, applyDefenses } = require('./rolls');

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

/**
 * Build an in-memory encounter from a stored `encounters` row. Pure, so the
 * restore path can be tested without Supabase — a bare `makeCombatant` reference
 * in here once went out of scope and would have silently dropped every active
 * encounter on bot restart, because restore swallows its own errors.
 */
function encounterFromRow(row) {
  const combatants = Array.isArray(row.combatants) ? row.combatants.map(makeCombatant) : [];
  return {
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
  };
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

// ── HP, dying, recovery ──────────────────────────────────────────────────────

/**
 * Damage or heal. `mode: 'set'` writes an absolute HP value; otherwise `amount`
 * is a delta (negative = damage). Temporary HP absorbs damage first.
 *
 * PF2e Player Core p. 411: knocked to 0 by a critical hit (or a crit-failed
 * save) starts you at Dying 2 rather than Dying 1; taking damage while already
 * dying adds 2 on a crit instead of 1. Wounded always adds to the initial value.
 * Reaching max dying (4, lowered by doomed) is death, and removes the combatant.
 */
function applyHp(encounter, query, amount, { mode = 'delta', isCrit = false } = {}) {
  const combatant = requireCombatant(encounter, query);
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
      combatant.dying = 1 + (combatant.wounded ?? 0) + (isCrit ? 1 : 0);
    } else if (wasDying) {
      dyingIncreased = true;
      combatant.dying += isCrit ? 2 : 1;
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
  if (died) removed = removeCombatant(encounter, combatant.name).combatant;

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

/**
 * Recovery flat check: DC 10 + dying value. Success reduces dying by 1, a crit
 * success by 2; failure raises it by 1, a crit failure by 2. Wounded is added on
 * any increase. Nat 20/1 shift one degree. Returns null when not dying.
 */
function rollRecoveryCheck(encounter, query) {
  const combatant = requireCombatant(encounter, query);
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
    removeCombatant(encounter, combatant.name);
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

// Hero-point reroll of a recovery check (the re-resolve step; the caller is
// responsible for having already spent the hero point). Undoes the original
// result, rolls again, keeps whichever leaves the combatant better off.
function rerollRecoveryCheck(encounter, query, originalResult) {
  const combatant = findCombatant(encounter, query);
  if (!combatant || !originalResult) return null;

  // Undo the original result
  combatant.dying = originalResult.dyingBefore;
  if (originalResult.awoke) {
    combatant.wounded = Math.max(0, (combatant.wounded ?? 0) - 1);
    // HP stays at 0 — recovery never restores HP (PF2e RAW).
  }

  const second = rollRecoveryCheck(encounter, combatant.id);
  if (!second) return null;

  const firstIsBetter = originalResult.dyingAfter < second.dyingAfter
    || (originalResult.awoke && !second.awoke);

  if (firstIsBetter && !second.died) {
    // Undo the second roll, reapply the first.
    combatant.dying = originalResult.dyingAfter;
    if (originalResult.awoke) {
      combatant.wounded = (combatant.wounded ?? 0) + 1;
      combatant.unconscious = (combatant.hp ?? 0) <= 0;
    }
    return {
      ...originalResult,
      originalRoll: originalResult.roll,
      rerollRoll: second.roll,
      keptOriginal: true,
      narration: `Hero Point reroll: ${second.roll} vs original ${originalResult.roll} — kept original.\n${originalResult.narration}`,
    };
  }
  return {
    ...second,
    originalRoll: originalResult.roll,
    rerollRoll: second.roll,
    keptOriginal: false,
    narration: `Hero Point reroll: ${second.roll} vs original ${originalResult.roll} — kept reroll.\n${second.narration}`,
  };
}

// Spend ALL remaining hero points to escape death (PF2e Player Core p. 411):
// lose the dying condition entirely, stabilize at 0 HP, wounded unchanged.
// The caller validates and zeroes the player's hero points.
function stabilizeWithHeroPoints(encounter, query) {
  const combatant = findCombatant(encounter, query);
  if (!combatant) return null;
  const dyingBefore = combatant.dying ?? 0;
  if (dyingBefore <= 0) return { ok: false, reason: 'not-dying' };

  combatant.dying = 0;
  combatant.unconscious = (combatant.hp ?? 0) <= 0;
  encounter.log.push({ at: nowIso(), kind: 'hero-stabilize', name: combatant.name, dyingBefore });

  return {
    ok: true,
    combatant,
    dyingBefore,
    woundedKept: combatant.wounded ?? 0,
    narration: `**${combatant.name}** spends all remaining Hero Points to escape death — stabilized at 0 HP, dying cleared. Wounded ${combatant.wounded ?? 0} unchanged.`,
  };
}

// GM override of a combatant's dying value (0–4). PF2e RAW semantics match
// the automated paths: manually clearing dying grants Wounded +1 and does NOT
// restore HP (unconscious at 0 HP until healed); reaching the max dying value
// (4, lowered by doomed) is death and removes the combatant.
function setDying(encounter, query, value) {
  const combatant = requireCombatant(encounter, query);
  const before = combatant.dying ?? 0;
  const maxDying = Math.max(1, 4 - (combatant.doomed ?? 0));
  let died = false;
  let recovered = false;
  let removed = null;

  encounter.log.push({ at: nowIso(), kind: 'set-dying', name: combatant.name, before, value });

  if (value >= maxDying) {
    combatant.dying = maxDying;
    died = true;
    removed = removeCombatant(encounter, combatant.name).combatant;
  } else if (value === 0 && before > 0) {
    combatant.dying = 0;
    combatant.wounded = (combatant.wounded ?? 0) + 1;
    combatant.unconscious = (combatant.hp ?? 0) <= 0;
    recovered = true;
  } else {
    combatant.dying = Math.max(0, value);
    if (combatant.dying > 0) combatant.unconscious = true;
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
    // Which bonus type each modifier slot carries, so stacking can resolve
    // same-typed penalties instead of adding them. Absent = untyped, which is
    // how every effect stored before this existed keeps its old behavior.
    bonusTypes: { ...(effect.bonusTypes ?? {}) },
    hidden: effect.hidden ?? false,
    source: effect.source ?? null,
  };
  const existing = combatant.effects.findIndex(e => e.id === clean.id || slug(e.name) === key);

  // Persistent damage of the SAME type does not replace by recency: the rules
  // keep the HIGHER one. (Different damage types coexist, which they already do
  // — each type is its own preset with its own name, so they never collide here.)
  if (existing >= 0 && isPersistentDamage(combatant.effects[existing]) && isPersistentDamage(clean)) {
    const prior = combatant.effects[existing];
    const verdict = comparePersistentDamage(prior, clean);
    if (verdict !== 'incoming') {
      return {
        encounter,
        combatant,
        effect: prior,
        replaced: false,
        declined: true,
        // `ambiguous` is the DM's call, not ours: 3 versus 1d4 has no answer a
        // system should invent. We keep what is in play and say so.
        reason: verdict === 'ambiguous'
          ? `${combatant.name} already has ${describeDamage(prior)}; ${describeDamage(clean)} is not comparable to it, so the higher one is the GM's call. Nothing changed — swap it with /init removeeffect then /init addeffect.`
          : `${combatant.name} already has ${describeDamage(prior)}, which is at least as high as ${describeDamage(clean)}. The higher persistent damage is kept.`,
      };
    }
  }

  if (existing >= 0) combatant.effects[existing] = clean;
  else combatant.effects.push(clean);
  return { encounter, combatant, effect: clean, replaced: existing >= 0 };
}

/** Is this effect persistent damage? Same test `getPersistentDamageEffects` uses. */
function isPersistentDamage(effect) {
  const kind = effect?.kind ?? effect?.modifiers?.kind;
  return kind === 'persistent-damage' || effectKey(effect).startsWith('persistent-');
}

/** `1d6` / `3` → a comparable form; null when the notation is something else. */
function parseDamageAmount(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (/^\d+$/.test(s)) return { kind: 'flat', count: Number(s) };
  const m = /^(\d+)d(\d+)$/.exec(s);
  return m ? { kind: 'dice', count: Number(m[1]), sides: Number(m[2]) } : null;
}

function describeDamage(effect) {
  const { damageDice, damageType } = persistentDamageConfig(effect);
  return `${damageDice} persistent ${damageType} damage`;
}

/**
 * Which of two same-type persistent damages is higher: `'incoming'`, `'existing'`,
 * or `'ambiguous'`.
 *
 * Deliberately conservative. Only two comparisons are unambiguous enough for a
 * system to make on its own: two flat amounts, and two dice pools of the SAME die
 * size (2d6 beats 1d6 on every measure). Anything else — 3 versus 1d4, or 1d4
 * versus 1d6 — is a judgement call, and the owner's rule is explicit that it
 * belongs to the GM rather than to us.
 */
function comparePersistentDamage(existing, incoming) {
  const a = parseDamageAmount(persistentDamageConfig(existing).damageDice);
  const b = parseDamageAmount(persistentDamageConfig(incoming).damageDice);
  if (!a || !b) return 'ambiguous';
  if (a.kind !== b.kind) return 'ambiguous';
  if (a.kind === 'dice' && a.sides !== b.sides) return 'ambiguous';
  if (b.count > a.count) return 'incoming';
  return 'existing';
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

// ── Persistent damage & the turn pipeline ────────────────────────────────────

/**
 * Roll each persistent-damage effect on `query`: damage, then a flat check to
 * end it. Stops early if the combatant dies. Returns one result per effect;
 * `[]` (and no mutation) when there is nothing to tick.
 */
function tickPersistentDamage(encounter, query) {
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
      ? applyHp(encounter, combatant.id, -defended.finalDamage)
      : null;
    const flatRoll = Math.floor(Math.random() * 20) + 1;
    const ended = flatRoll >= flatDc;
    // applyHp may have removed the combatant (death), so re-resolve.
    const stillPresent = findCombatant(encounter, combatant.id);

    if (ended && stillPresent?.effects?.length) {
      stillPresent.effects = stillPresent.effects.filter(e => e !== effect);
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
  return results;
}

/**
 * One full turn boundary: tick the outgoing combatant's persistent damage,
 * advance the cursor, expire durations, resolve action economy, then roll the
 * incoming combatant's recovery check if they are dying. Returns null when the
 * encounter is empty.
 */
function processTurnTransition(encounter, direction = 1) {
  if (!encounter || encounter.combatants.length === 0) return null;

  const outgoing = currentCombatant(encounter);
  const outgoingIndex = encounter.turnIndex;
  const persistentResults = direction > 0 && outgoing
    ? tickPersistentDamage(encounter, outgoing.id)
    : [];

  // Persistent damage can empty the encounter (last combatant dies).
  if (encounter.combatants.length === 0) {
    return {
      encounter,
      current: null,
      expiredEffects: [],
      persistentResults,
      recoveryCheck: null,
      newRound: false,
      actionEconomy: null,
    };
  }
  if (direction > 0 && persistentResults.some(result => result.died)) {
    encounter.turnIndex = outgoingIndex - 1;
  }

  const roundBefore = encounter.round;
  const advanceResult = advanceTurn(encounter, direction);
  if (!advanceResult) return null;

  let { current } = advanceResult;
  const newRound = encounter.round > roundBefore;
  const expiredEffects = direction > 0 && current ? tickEffectDurations(current) : [];
  const actionEconomy = direction > 0 && current ? processActionEconomy(current) : null;
  const currentIndexBeforeRecovery = encounter.turnIndex;
  const recoveryCheck = direction > 0 && (current?.dying ?? 0) > 0
    ? rollRecoveryCheck(encounter, current.id)
    : null;
  if (recoveryCheck?.died && encounter.combatants.length > 0) {
    encounter.turnIndex = currentIndexBeforeRecovery - 1;
    current = advanceTurn(encounter, 1)?.current ?? null;
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

module.exports = {
  slug,
  nowIso,
  isCombatV2Snapshot,
  makeCombatant,
  encounterFromRow,
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
  applyHp,
  rollRecoveryCheck,
  rerollRecoveryCheck,
  stabilizeWithHeroPoints,
  setDying,
  addEffect,
  removeEffect,
  effectKey,
  effectValue,
  tickEffectDurations,
  getPersistentDamageEffects,
  persistentDamageConfig,
  processActionEconomy,
  tickPersistentDamage,
  processTurnTransition,
};
