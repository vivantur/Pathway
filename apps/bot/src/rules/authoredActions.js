// ── rules/authoredActions.js ────────────────────────────────────────────────
//
// A small, hand-authored catalog of runnable actions, so `/use` has something to
// execute before the content pipeline can supply trees on its own.
//
// WHY THIS EXISTS AND WHY IT IS TEMPORARY: no content in the repo carries a
// Layer-2 automation tree. The ingested corpus is all Layer-1 passives, and
// `scripts/remap-effects.mjs` only emits those. So the interpreter had data to
// run only if somebody wrote it by hand. When the review UI's decisions fold into
// `feat.effects`, actions will come from CONTENT and this file should shrink to
// nothing and be deleted. Do not build on it.
//
// THE SHAPE IS NOT BESPOKE. Entries are core's `GrantedAction` — the same schema a
// granted action carries on an `EffectTemplate` — and every one is validated
// against `grantedActionSchema` at load. That is deliberate: authoring here is
// practice for the format content will arrive in, so nothing has to be migrated
// later, and a malformed entry fails loudly at boot instead of at play.
//
// ═══ THESE SAMPLES MAKE NO PATHFINDER RULES CLAIMS ═══
//
// The rules-from-source rule is non-negotiable, and no rules text was supplied for
// this slice. So every entry below is a deliberately GENERIC demonstration —
// flat numbers chosen to exercise the interpreter (a roll, a counter spend, a
// heal), named so no one mistakes them for real content. Implementing Heal or
// Treat Wounds from memory is exactly the failure mode that rule exists to
// prevent. Real actions get added when their rules text is provided.

'use strict';

const { grantedActionSchema } = require('@pathway/core');

/** @type {import('@pathway/core').GrantedAction[]} */
const AUTHORED = [
  {
    id: 'demo-roll',
    name: 'Demo: Roll Dice',
    actionCost: { kind: 'actions', min: 1, max: 1 },
    description: 'Demonstration only — rolls 2d6+3 and narrates the result. Not a Pathfinder action.',
    automation: [
      { kind: 'text', title: 'Demo: Roll Dice', body: 'A demonstration of the automation interpreter.' },
      { kind: 'roll', notation: '2d6 + 3', name: 'Demo roll' },
    ],
  },
  {
    id: 'demo-stat-roll',
    name: 'Demo: Roll With A Stat',
    actionCost: { kind: 'actions', min: 1, max: 1 },
    description:
      "Demonstration only — rolls 1d20 plus the character's own Wisdom modifier, showing that a tree can read resolved stats. Not a Pathfinder action.",
    automation: [
      { kind: 'text', body: 'Rolling 1d20 + your Wisdom modifier.' },
      { kind: 'roll', notation: '1d20 + wisdomMod', name: 'Demo stat roll' },
    ],
  },
  {
    id: 'demo-spend-focus',
    name: 'Demo: Spend Focus',
    actionCost: { kind: 'actions', min: 2, max: 2 },
    description:
      'Demonstration only — spends 1 focus point and restores a flat 5 HP, to show a counter spend and a healing mutation landing together. The numbers are arbitrary, not a Pathfinder rule.',
    automation: [
      { kind: 'text', title: 'Demo: Spend Focus', body: 'Spending a focus point.' },
      // `raise`, not the host's default `warn`: this is a COST. If the pool is
      // empty the action must not proceed to its effect — healing for free
      // because the payment failed is a wrong result, not a warning.
      {
        kind: 'counter',
        counter: 'focus',
        amount: { kind: 'lit', value: 1 },
        requireAvailable: true,
        onError: { on: 'raise' },
      },
      { kind: 'damage', healing: true, target: 'self', components: [{ formula: '5' }] },
    ],
  },
  {
    id: 'demo-strike-target',
    name: 'Demo: Hit A Target',
    actionCost: { kind: 'actions', min: 1, max: 1 },
    description:
      'Demonstration only — deals a flat 4 damage to the targeted combatant and applies a demo condition to them. Requires an encounter and a target. The numbers are arbitrary, not a Pathfinder rule.',
    automation: [
      { kind: 'text', title: 'Demo: Hit A Target', body: 'Striking the target.' },
      { kind: 'damage', target: 'target', components: [{ formula: '4' }] },
      {
        kind: 'applyEffect',
        target: 'target',
        effect: {
          name: 'Demo Rattled',
          duration: { kind: 'rounds', count: 2 },
          // One modifier per slot the tracker can hold exactly. A save- or
          // skill-specific penalty would be reported as unsupported instead —
          // see rules/effectTranslation.js for why that is the correct outcome.
          passives: [
            { kind: 'modifier', target: 'ac', bonusType: 'circumstance', value: { kind: 'lit', value: -1 } },
            { kind: 'modifier', target: 'attack', bonusType: 'circumstance', value: { kind: 'lit', value: -1 } },
          ],
        },
      },
    ],
  },
];

/**
 * Validate at load: a malformed entry is an authoring bug, and it should surface
 * when the module is required (boot, or the test suite) rather than when a player
 * runs the action mid-session.
 */
const ACTIONS = AUTHORED.map((action) => {
  const parsed = grantedActionSchema.safeParse(action);
  if (!parsed.success) {
    throw new Error(
      `authoredActions: "${action.id ?? '(no id)'}" does not match core's GrantedAction schema: ${parsed.error.message}`,
    );
  }
  return parsed.data;
});

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/** Every authored action, in catalog order. */
function listActions() {
  return ACTIONS.slice();
}

/** Look one up by id, or by exact (case-insensitive) name. Null when absent. */
function findAction(query) {
  const q = String(query ?? '').trim();
  if (!q) return null;
  const byId = BY_ID.get(q);
  if (byId) return byId;
  const lower = q.toLowerCase();
  return ACTIONS.find((a) => a.name.toLowerCase() === lower) ?? null;
}

/** Substring search over id and name, for autocomplete. Capped at `limit`. */
function searchActions(query, limit = 25) {
  const q = String(query ?? '').trim().toLowerCase();
  const matches = q
    ? ACTIONS.filter((a) => a.name.toLowerCase().includes(q) || a.id.includes(q))
    : ACTIONS;
  return matches.slice(0, limit);
}

/**
 * Does this action need a target to work?
 *
 * Read off the tree rather than declared, so it cannot drift from what the
 * automation actually does: any node aimed at `target`, or a `target` node that
 * scopes to something other than self, needs one. Lets the command refuse up
 * front with a clear message instead of running and reporting "damage failed".
 */
function requiresTarget(action) {
  const walk = (nodes) => (nodes ?? []).some((node) => {
    if (node.target === 'target') return true;
    if (node.kind === 'target' && node.mode !== 'self') return true;
    return (
      walk(node.children) ||
      walk(node.onTrue) ||
      walk(node.onFalse) ||
      (node.entries ?? []).some(e => walk(e.children)) ||
      Object.values(node.degrees ?? {}).some(walk)
    );
  });
  return walk(action?.automation);
}

/** `[1 action]`, `[reaction]`, … for display. Empty when the action has no cost. */
function formatActionCost(cost) {
  if (!cost) return '';
  switch (cost.kind) {
    case 'actions':
      return cost.min === cost.max
        ? `[${cost.min} action${cost.min === 1 ? '' : 's'}]`
        : `[${cost.min}–${cost.max} actions]`;
    case 'reaction':
      return '[reaction]';
    case 'free':
      return '[free action]';
    case 'time':
      return `[${cost.text}]`;
    default:
      return '';
  }
}

module.exports = {
  listActions,
  findAction,
  searchActions,
  requiresTarget,
  formatActionCost,
};
