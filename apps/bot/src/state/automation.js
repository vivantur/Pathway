// ── state/automation.js ─────────────────────────────────────────────────────
//
// The impure half of the automation host: seed generation, and writing an
// outcome's INTENDED mutations into the character's actual state.
//
// Core is emphatic that `Outcome.mutations` are intentions — it computes them
// and never applies them. This is where they land. The split matters because the
// interpreter and the context builder stay replayable and unit-testable, while
// everything that touches persistent state is confined here.
//
// WHAT THIS DOES NOT DO: it does not save. It mutates the in-memory `charEntry`
// exactly as `/hp` and `/cc` do, and the calling command is responsible for the
// follow-up `characters.saveAll()`.
//
// WHERE MUTATIONS CAN LAND TODAY: the bot keeps character state and combat state
// in two different places. HP and counters live on the CHARACTER; temporary HP
// and conditions live on a COMBATANT inside an encounter (rules/combatV2). So a
// character-scoped apply can honor damage, healing, and counters, and genuinely
// cannot honor temp HP or effects. Those are REPORTED AS SKIPPED WITH A REASON
// rather than dropped — an automation that silently loses half of what it did is
// worse than one that admits the gap. Combatant-scoped application lands with
// targeting.

'use strict';

const { ensureOverlay } = require('../rules/characterOverlay');
const { FOCUS_COUNTER } = require('../rules/automation');
const { translateEffect } = require('../rules/effectTranslation');
const { getCharacterHp, setCharacterHp } = require('./characters');
const combat = require('./combat');

/**
 * A fresh 32-bit seed for a run. Kept out of `rules/` so that module stays
 * deterministic; persist the value with whatever you log and the exact same
 * rolls can be reproduced later.
 */
function randomSeed() {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/** Mutations aimed at anyone but the acting character need combat targeting. */
function isSelf(target) {
  return !target || target.kind === 'self';
}

function applyDamage(charEntry, m, report) {
  if (!isSelf(m.target)) {
    report.skipped.push({
      kind: m.kind,
      reason: 'targets another creature; character-scoped apply can only affect the actor',
    });
    return;
  }
  const before = getCharacterHp(charEntry);
  const after = setCharacterHp(charEntry, m.healing ? before + m.amount : before - m.amount);
  report.applied.push({
    kind: m.healing ? 'healing' : 'damage',
    amount: m.amount,
    before,
    after,
    // Reaching 0 does NOT start the dying rules here: /hp and the combat tracker
    // own those transitions, and this apply deliberately mirrors /hp's plain
    // damage path rather than growing a second implementation of dying.
    atZero: after === 0,
  });
}

function applyCounter(charEntry, m, report) {
  const overlay = ensureOverlay(charEntry);
  const name = String(m.counter ?? '').toLowerCase();

  // Focus lives in its own overlay slot, not `overlay.counters`.
  if (name === FOCUS_COUNTER && !(name in overlay.counters)) {
    const before = Number(overlay.daily.focus_spent ?? 0);
    // The interpreter already clamped against the snapshot we gave it, so the
    // spend is re-derived from its reported result rather than re-clamped here.
    overlay.daily.focus_spent = Math.max(0, before + m.spent);
    report.applied.push({ kind: 'counter', counter: name, spent: m.spent, remaining: m.remaining });
    return;
  }

  const ctr = overlay.counters[name];
  if (!ctr) {
    report.skipped.push({ kind: m.kind, reason: `no counter named \`${name}\` on this character` });
    return;
  }
  // Write the interpreter's computed result straight in. Going through
  // useCounter/restoreCounter would clamp a second time against slightly
  // different bounds — one clamp, in core, is the whole point of counter.ts.
  ctr.current = m.remaining;
  report.applied.push({ kind: 'counter', counter: name, spent: m.spent, remaining: m.remaining });
}

const NO_HOME = {
  temphp: 'temporary HP lives on a combatant — run this in a channel with an encounter and a target',
  applyEffect: 'conditions live on a combatant — run this in a channel with an encounter and a target',
  removeEffect: 'conditions live on a combatant — run this in a channel with an encounter and a target',
};

// ── combatant-scoped application ────────────────────────────────────────────
//
// Temp HP and conditions only exist on a combatant, and damage to anyone but the
// actor needs one too. When `/use` is run in a channel with a live encounter, a
// `combat` scope resolves each mutation target to a tracker query.
//
// Damage deliberately goes through the tracker's own `applyHp` rather than a
// second HP path: that function already absorbs temp HP and runs the dying rules,
// both of which are tested. Re-implementing either here is how a third dying
// implementation gets born.

/** Resolve a mutation's target to a tracker query, or null if none is bound. */
function queryFor(target, scope) {
  if (!scope) return null;
  if (!target || target.kind === 'self') return scope.self ?? null;
  return scope.target ?? null;
}

function applyToCombatant(m, scope, report) {
  const query = queryFor(m.target, scope);
  if (!query) {
    report.skipped.push({
      kind: m.kind,
      reason: m.target && m.target.kind !== 'self'
        ? 'no target combatant was named'
        : 'the acting character is not in this encounter',
    });
    return true;
  }

  try {
    switch (m.kind) {
      case 'damage': {
        const result = combat.applyHp(scope.channelId, query, m.healing ? m.amount : -m.amount);
        const c = result?.combatant;
        // Temp HP soaks damage before real HP does, so the HP delta alone
        // understates the hit. Report the absorption rather than letting
        // "took 4 damage — 20 → 19" read as a contradiction.
        const tempBefore = result?.before?.tempHp ?? 0;
        const absorbed = Math.max(0, tempBefore - (c?.tempHp ?? 0));
        report.applied.push({
          kind: m.healing ? 'healing' : 'damage',
          who: c?.name ?? query,
          amount: m.amount,
          before: result?.before?.hp,
          after: c?.hp,
          absorbed: m.healing ? 0 : absorbed,
          atZero: c?.hp === 0,
        });
        return true;
      }
      case 'temphp': {
        const result = combat.setTempHp(scope.channelId, query, m.amount);
        report.applied.push({ kind: 'temphp', who: result?.combatant?.name ?? query, amount: m.amount });
        return true;
      }
      case 'applyEffect': {
        // The translation is where honesty lives: anything core's template can
        // express and the tracker cannot comes back named, not dropped.
        const { effect, unsupported, notes } = translateEffect(m.effect, { source: 'automation' });
        for (const u of unsupported) {
          report.skipped.push({ kind: 'applyEffect', reason: `${m.effect?.name ?? 'effect'} — ${u.what}: ${u.reason}` });
        }
        if (!effect) {
          report.skipped.push({
            kind: 'applyEffect',
            reason: `${m.effect?.name ?? 'effect'} had nothing the tracker can represent, so it was not applied`,
          });
          return true;
        }
        const result = combat.addEffect(scope.channelId, query, effect);
        report.applied.push({
          kind: 'applyEffect',
          who: result?.combatant?.name ?? query,
          effect: effect.name,
          value: effect.value,
          duration: effect.duration,
          notes,
        });
        return true;
      }
      case 'removeEffect': {
        const result = combat.removeEffect(scope.channelId, query, m.name);
        report.applied.push({ kind: 'removeEffect', who: result?.combatant?.name ?? query, effect: m.name });
        return true;
      }
      default:
        return false;
    }
  } catch (err) {
    // requireCombatant throws when the query matches nothing or is ambiguous.
    report.skipped.push({ kind: m.kind, reason: `could not resolve "${query}" in this encounter: ${err.message}` });
    return true;
  }
}

/**
 * Apply an outcome's mutations, in order.
 *
 * `combatScope` — `{ channelId, self, target }` — binds mutation targets to
 * combatants in a live encounter. Without it, only what a character can hold
 * (HP, counters) lands, and the rest is reported as skipped.
 *
 * Returns `{ applied, skipped }`. Everything that could not land is in `skipped`
 * with a reason. The character entry is mutated in place; the caller saves.
 */
function applyOutcome(charEntry, outcome, combatScope = null) {
  const report = { applied: [], skipped: [] };
  const scope = combatScope?.channelId ? combatScope : null;

  for (const m of outcome?.mutations ?? []) {
    switch (m.kind) {
      case 'damage':
        // Damage to the actor stays on the character sheet unless the actor is
        // also in the encounter — the tracker's copy is the one in play then.
        if (isSelf(m.target) && !(scope && scope.self)) applyDamage(charEntry, m, report);
        else applyToCombatant(m, scope, report);
        break;
      case 'counter':
        // Counters are always the character's: a combatant has none.
        applyCounter(charEntry, m, report);
        break;
      case 'temphp':
      case 'applyEffect':
      case 'removeEffect':
        if (scope) applyToCombatant(m, scope, report);
        else report.skipped.push({ kind: m.kind, reason: NO_HOME[m.kind] });
        break;
      default:
        report.skipped.push({ kind: m.kind, reason: 'unrecognized mutation kind' });
    }
  }

  return report;
}

module.exports = {
  randomSeed,
  applyOutcome,
};
