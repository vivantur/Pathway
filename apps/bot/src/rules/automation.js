// ── rules/automation.js ─────────────────────────────────────────────────────
//
// The bot's HOST for core's Layer-2 automation interpreter — the piece that was
// missing for `runAutomation` to be reachable from Discord at all.
//
// Core owns the interpreter and every rule inside it. This module owns only the
// three adapter concerns a host must supply:
//
//   1. the ACTOR — a `ResolvedCharacter`, built from the Pathbuilder JSON the bot
//      already stores, via core's `resolvedFromPathbuilder`;
//   2. the COUNTERS — a read-only snapshot of the character's spendable pools
//      (`/cc` counters, plus focus points under a reserved name);
//   3. NARRATION — turning the returned log into plain strings.
//
// It computes NO rules. Every number in an outcome came out of core.
//
// PURE, in the sense `rules/` means it: no I/O, no Supabase, no discord.js, and
// no reads of anything but the entry it is handed. It is also DETERMINISTIC —
// the seed is an argument, never generated here, so a run can be replayed
// exactly. Seed generation and the writing-back of mutations live in
// `state/automation.js`, which is the impure half.

'use strict';

const core = require('@pathway/core');
const { getMaxFocus } = require('./characterOverlay');

// Focus points are a spendable pool like any `/cc` counter, but they live in
// their own overlay slot (`daily.focus_spent`) rather than `overlay.counters`.
// Exposing them under a reserved counter name lets an authored tree spend focus
// with the same `counter` node it uses for anything else.
const FOCUS_COUNTER = 'focus';

/**
 * A read-only snapshot of everything the character can spend, in core's
 * `Counter` shape (`{ current, max }`).
 *
 * Read directly off the entry rather than through characterOverlay's accessors:
 * those call `ensureOverlay`, which initializes missing slots and would mutate
 * the entry we were only asked to read.
 */
function readCounters(charEntry) {
  const counters = {};

  const stored = charEntry?.overlay?.counters ?? {};
  for (const [name, ctr] of Object.entries(stored)) {
    const current = Number(ctr?.current);
    if (!Number.isFinite(current)) continue;
    const max = Number(ctr?.max);
    counters[name] = Number.isFinite(max) ? { current, max } : { current };
  }

  // Focus, under its reserved name — unless a `/cc` counter already claimed it,
  // in which case the character's own counter wins (it is the one they can see).
  if (!(FOCUS_COUNTER in counters)) {
    const max = getMaxFocus(charEntry?.data);
    if (max > 0) {
      const spent = Number(charEntry?.overlay?.daily?.focus_spent ?? 0);
      counters[FOCUS_COUNTER] = {
        current: Math.max(0, max - (Number.isFinite(spent) ? spent : 0)),
        max,
      };
    }
  }

  return counters;
}

/**
 * Build the `ExecutionContext` core's interpreter reads.
 *
 * `seed` is REQUIRED and not defaulted: a silently-random seed would make runs
 * unreplayable, which defeats the point of core threading a seeded RNG through
 * every roll. Callers get one from `state/automation.js`'s `randomSeed()` and
 * persist it alongside whatever they log.
 *
 * `targets` are other character entries; each is resolved the same way the actor
 * is. Area geometry — who is in range — is the caller's concern, exactly as core
 * documents.
 */
function buildContext(charEntry, opts = {}) {
  const { seed, targets = [], spell, vars, onError } = opts;

  if (!Number.isFinite(seed)) {
    throw new TypeError('buildContext requires a numeric `seed` so the run can be replayed.');
  }

  const ctx = {
    actor: core.resolvedFromPathbuilder(charEntry?.data ?? {}),
    counters: readCounters(charEntry),
    rng: core.makeRng(seed),
    // Core defaults an unhandled node failure to `ignore` — right for a library,
    // wrong for a host that shows results to a person. Ignored means a spell
    // whose focus cost silently failed still heals, and nobody is told. A HOST
    // narrating to a player defaults to `warn` so every failure reaches the
    // embed; an authored node that genuinely must not proceed carries its own
    // `raise` (see the cost node in authoredActions.js).
    onError: { on: 'warn' },
  };

  if (targets.length > 0) {
    ctx.targets = targets.map(t => core.resolvedFromPathbuilder(t?.data ?? {}));
  }
  if (spell) ctx.spell = spell;
  if (vars) ctx.vars = vars;
  if (onError) ctx.onError = onError;

  return ctx;
}

/** Run an automation tree against a prepared context. A pass-through to core. */
function runTree(tree, ctx) {
  return core.runAutomation(tree ?? [], ctx);
}

/**
 * Build a context for `charEntry` and run `tree` against it — the one-call form.
 * Returns core's `Outcome` untouched: `{ log, mutations, warnings, aborted }`.
 * Nothing is applied; `state/automation.js` does that.
 */
function run(charEntry, tree, opts = {}) {
  return runTree(tree, buildContext(charEntry, opts));
}

/** `2d6 (4, 3)` — the individual dice behind a roll, for transparency. */
function formatDice(dice) {
  if (!Array.isArray(dice) || dice.length === 0) return '';
  return ` (${dice.map(d => d?.result).filter(r => Number.isFinite(r)).join(', ')})`;
}

const DEGREE_LABEL = {
  criticalSuccess: 'Critical Success',
  success: 'Success',
  failure: 'Failure',
  criticalFailure: 'Critical Failure',
};

/**
 * Render an outcome's log as plain strings — no discord.js, so this stays
 * testable and the command layer decides what an embed looks like.
 *
 * Returns `{ lines, warnings, aborted }`. Warnings are kept SEPARATE rather than
 * folded into the narration: a run that half-worked should say so out loud
 * instead of quietly presenting a shorter story as if it were the whole thing.
 *
 * THIS IS THE LOG ONLY, AND THE LOG IS NOT THE WHOLE STORY. Core's `damage`,
 * `temphp`, and `counter` nodes emit a MUTATION and no log entry — so a healing
 * tree rendered through this function narrates "Heal" without ever saying 6. The
 * numbers are in `outcome.mutations`, and better still in the `applied` report
 * from `state/automation.js`, which knows the before/after after clamping. A
 * command should render both: this for the story, the report for what landed.
 */
function describeOutcome(outcome) {
  const lines = [];

  for (const entry of outcome?.log ?? []) {
    switch (entry.kind) {
      case 'text':
        lines.push(entry.title ? `**${entry.title}**\n${entry.body}` : entry.body);
        break;
      case 'roll':
        lines.push(
          `🎲 ${entry.name ? `${entry.name}: ` : ''}\`${entry.notation}\` → **${entry.total}**${formatDice(entry.dice)}`,
        );
        break;
      case 'check': {
        const degree = DEGREE_LABEL[entry.degree] ?? entry.degree;
        lines.push(
          `🎯 ${entry.name ? `${entry.name}: ` : ''}d20 ${entry.die} → **${entry.total}** vs DC ${entry.dc} — **${degree}**`,
        );
        break;
      }
      default:
        // An unknown log kind means core grew its vocabulary and this renderer
        // has not caught up. Say so rather than dropping the entry silently.
        lines.push(`_(unrenderable log entry: ${entry.kind})_`);
    }
  }

  return {
    lines,
    warnings: [...(outcome?.warnings ?? [])],
    aborted: !!outcome?.aborted,
  };
}

/**
 * Render what an apply actually DID — the other half of the story, from
 * `state/automation.js`'s report.
 *
 * Reads the report rather than the mutations on purpose: a mutation is an
 * intention, and the report knows what survived clamping. "Healed 6" is a lie if
 * the character was 2 HP below full, and the report is what knows that.
 *
 * Returns `{ lines, skipped }`, both plain strings. Skipped entries stay separate
 * so a caller cannot accidentally present a partial apply as a complete one.
 */
function describeApplied(report) {
  const lines = [];

  for (const a of report?.applied ?? []) {
    switch (a.kind) {
      case 'damage':
        lines.push(`💔 Took **${a.amount}** damage — ${a.before} → **${a.after}** HP${a.atZero ? ' (at 0)' : ''}`);
        break;
      case 'healing': {
        // Report the real delta: healing past max is clamped, and saying
        // otherwise would misreport the character's own sheet back to them.
        const gained = a.after - a.before;
        const capped = gained < a.amount ? ` _(${a.amount} rolled, capped at max HP)_` : '';
        lines.push(`💚 Healed **${gained}** — ${a.before} → **${a.after}** HP${capped}`);
        break;
      }
      case 'counter':
        lines.push(`🔸 Spent **${a.spent}** ${a.counter} — **${a.remaining}** remaining`);
        break;
      default:
        lines.push(`• ${a.kind}`);
    }
  }

  return {
    lines,
    skipped: (report?.skipped ?? []).map(s => `${s.kind}: ${s.reason}`),
  };
}

module.exports = {
  FOCUS_COUNTER,
  readCounters,
  buildContext,
  runTree,
  run,
  describeOutcome,
  describeApplied,
};
