// ── rules/effectTranslation.js ──────────────────────────────────────────────
//
// Translate core's `EffectTemplate` into the flat combatant effect the bot's
// combat tracker understands.
//
// This is an ADAPTER, not rules logic: it computes nothing, it re-expresses one
// representation in another. The two are very unequal, and that inequality is the
// whole design problem here.
//
//   core  — a `PassiveEffect[]`: per-selector, typed (status/circumstance/item),
//           optionally CONDITIONAL on a predicate, values as expressions.
//   bot   — five flat numbers: { attackBonus, damageBonus, acBonus, saveBonus,
//           skillBonus }. Untyped, unconditional, all-or-nothing.
//
// ═══ THE RULE THIS MODULE FOLLOWS ═══
//
// Never translate by dropping something the target shape cannot express. A +1 to
// Fortitude rendered as `saveBonus: 1` silently buffs Reflex and Will too — that
// is a WRONG combatant, and a wrong combatant is worse than an absent effect.
// Anything that cannot be expressed exactly comes back in `unsupported` with a
// reason, exactly as the Foundry mapper reports an element it cannot map.
//
// Consequence, stated plainly: coverage here is LOW and that is correct. The
// honest fix is not a looser mapper, it is giving combatants a richer effect
// model — at which point most of the `unsupported` reasons below disappear.
//
// KNOWN LOSS, deliberately accepted for now: the bot's five slots are UNTYPED, so
// a translated status bonus and a translated circumstance bonus are summed rather
// than resolved by PF2e's stacking rules. That is the bot's pre-existing untyped
// stacking bug, not one this module introduces — but every effect that comes
// through here inherits it. Fixing it is its own piece of work.

'use strict';

const { SKILL_SLUGS, SAVE_SELECTORS } = require('@pathway/core');

const SAVES = [...SAVE_SELECTORS];
const SKILLS = [...SKILL_SLUGS];

/** Selectors that map exactly onto one of the bot's flat slots. */
const DIRECT_SLOT = {
  ac: 'acBonus',
  attack: 'attackBonus',
  damage: 'damageBonus',
};

const EMPTY_MODIFIERS = {
  attackBonus: 0,
  damageBonus: 0,
  acBonus: 0,
  saveBonus: 0,
  skillBonus: 0,
};

/**
 * Map a core duration onto the tracker's convention: a round count that ticks
 * down, or null for "no automatic expiry".
 *
 * Only `rounds` and `unlimited` translate exactly. `sustained`, `until`, `time`,
 * and `dailyPreparations` all depend on turn structure or a wall clock the
 * tracker does not model, so they become null AND a note — the GM is told to end
 * it manually rather than being handed a number we invented.
 */
function translateDuration(duration) {
  switch (duration?.kind) {
    case 'rounds':
      return { duration: duration.count, note: null };
    case 'unlimited':
      return { duration: null, note: null };
    case 'sustained':
      return { duration: null, note: 'sustained: no automatic expiry — end it manually when it stops being sustained' };
    case 'until':
      return { duration: null, note: `"until ${duration.moment?.when ?? 'a turn moment'}": no automatic expiry — end it manually` };
    case 'time':
      return { duration: null, note: `${duration.amount} ${duration.unit}: a clock duration the tracker does not model — end it manually` };
    case 'dailyPreparations':
      return { duration: null, note: 'until daily preparations: no automatic expiry — end it manually' };
    default:
      return { duration: null, note: null };
  }
}

/** A modifier's value only translates if it is already a plain number. */
function literalValue(expr) {
  if (expr && expr.kind === 'lit' && typeof expr.value === 'number') return expr.value;
  return null;
}

/**
 * Collapse a group of same-slot selectors (the three saves, the sixteen skills)
 * into one flat number — but ONLY when every member is present with the same
 * value. A partial group cannot be expressed and is reported instead.
 */
function collapseGroup(group, buckets, slotName, unsupported) {
  const present = group.filter(sel => buckets.has(sel));
  if (present.length === 0) return 0;

  const values = present.map(sel => buckets.get(sel).value);
  const allPresent = present.length === group.length;
  const allEqual = values.every(v => v === values[0]);

  if (allPresent && allEqual) return values[0];

  for (const sel of present) {
    unsupported.push({
      what: `modifier to ${sel}`,
      reason: allPresent
        ? `the tracker has one ${slotName} for the whole group, so differing values cannot be represented`
        : `the tracker has one ${slotName} for the whole group — applying it would also affect ${group.filter(g => !present.includes(g)).join(', ')}`,
    });
  }
  return 0;
}

/**
 * Translate one `EffectTemplate`.
 *
 * Returns `{ effect, unsupported, notes }`. `effect` is null when nothing at all
 * survived translation — an effect with no representable part should not be
 * applied as an empty shell that looks active but does nothing.
 */
function translateEffect(template, { source = null } = {}) {
  const unsupported = [];
  const notes = [];

  if (!template || !template.name) {
    return { effect: null, unsupported: [{ what: 'effect', reason: 'no template or no name' }], notes };
  }

  const buckets = new Map();

  for (const passive of template.passives ?? []) {
    if (passive.kind !== 'modifier') {
      unsupported.push({
        what: `${passive.kind} effect`,
        reason: 'the tracker models only flat numeric modifiers',
      });
      continue;
    }
    // A conditional modifier is the named failure mode: shown unconditionally it
    // is a permanent bonus the creature has not earned.
    if (passive.when) {
      unsupported.push({
        what: `modifier to ${passive.target}`,
        reason: 'it is conditional, and the tracker cannot express a condition — showing it as permanent would be wrong',
      });
      continue;
    }
    const value = literalValue(passive.value);
    if (value === null) {
      unsupported.push({
        what: `modifier to ${passive.target}`,
        reason: 'its value is an expression, which needs a bearer context this translation does not have',
      });
      continue;
    }
    // Two modifiers to the same selector: sum them. Same-selector stacking is the
    // bot's untyped problem either way, and dropping one would be worse.
    const prior = buckets.get(passive.target);
    buckets.set(passive.target, { value: prior ? prior.value + value : value });
  }

  const modifiers = { ...EMPTY_MODIFIERS };

  for (const [selector, slot] of Object.entries(DIRECT_SLOT)) {
    if (buckets.has(selector)) modifiers[slot] = buckets.get(selector).value;
  }
  modifiers.saveBonus = collapseGroup(SAVES, buckets, 'saveBonus', unsupported);
  modifiers.skillBonus = collapseGroup(SKILLS, buckets, 'skillBonus', unsupported);

  // Everything the tracker has no slot for at all.
  const handled = new Set([...Object.keys(DIRECT_SLOT), ...SAVES, ...SKILLS]);
  for (const selector of buckets.keys()) {
    if (!handled.has(selector)) {
      unsupported.push({
        what: `modifier to ${selector}`,
        reason: 'the tracker has no field for this statistic',
      });
    }
  }

  const { duration, note } = translateDuration(template.duration);
  if (note) notes.push(note);

  // A held condition's value is what the tracker shows as "Frightened 2".
  const valued = (template.conditions ?? []).find(c => typeof c.value === 'number');

  const hasAnyModifier = Object.values(modifiers).some(v => v !== 0);
  if (!hasAnyModifier && !valued) {
    return { effect: null, unsupported, notes };
  }

  return {
    effect: {
      name: template.name,
      value: valued ? valued.value : null,
      duration,
      modifiers,
      source,
    },
    unsupported,
    notes,
  };
}

module.exports = {
  translateEffect,
  translateDuration,
};
