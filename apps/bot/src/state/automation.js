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
const { getCharacterHp, setCharacterHp } = require('./characters');

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
  temphp: 'temporary HP lives on a combatant, not a character — needs an encounter',
  applyEffect: 'conditions live on a combatant, not a character — needs an encounter',
  removeEffect: 'conditions live on a combatant, not a character — needs an encounter',
};

/**
 * Apply an outcome's mutations to `charEntry`, in order.
 *
 * Returns `{ applied, skipped }`. Everything that could not land is in `skipped`
 * with a reason, so a caller can show the player what did and did not happen.
 * The entry is mutated in place; the caller saves.
 */
function applyOutcome(charEntry, outcome) {
  const report = { applied: [], skipped: [] };

  for (const m of outcome?.mutations ?? []) {
    switch (m.kind) {
      case 'damage':
        applyDamage(charEntry, m, report);
        break;
      case 'counter':
        applyCounter(charEntry, m, report);
        break;
      case 'temphp':
      case 'applyEffect':
      case 'removeEffect':
        report.skipped.push({ kind: m.kind, reason: NO_HOME[m.kind] });
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
