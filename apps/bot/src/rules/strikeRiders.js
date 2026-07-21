// ── rules/strikeRiders.js ────────────────────────────────────────────────────
//
// A TEMPORARY hand-authored catalog of Strike RIDERS in core's `StrikeRider` shape
// (validated against `strikeRiderSchema` at load) — the analogue of
// `authoredActions.js`, for `/strike … rider:<keyword>`.
//
// It exists only because no CONTENT carries a rider tree yet; the step-5 authoring
// pass (docs/action-feats-handoff.md) will supply them from the 349 classified
// riders and this catalog should then be deleted. UNLIKE authoredActions.js's
// generic demos, these entries make REAL Pathfinder rules claims, so each is
// authored strictly from the feat's own text in feats.json (rules-from-source) —
// never model memory — and only the parts the engine can stand behind are encoded;
// positional caveats ("until it's no longer within reach") are left to the table.
//
// The rider MECHANICS come from core: a condition's modifiers are expanded with
// `conditionPassives`, so an applied Frightened actually carries its penalty rather
// than being a bare label. No rules math lives here.

'use strict';

const core = require('@pathway/core');

/** An applyEffect node imposing a condition on the TARGET, with its real modifiers. */
function condition(name, held, duration, traits) {
  return {
    kind: 'applyEffect',
    target: 'target',
    effect: {
      name,
      ...(traits ? { traits } : {}),
      conditions: [held],
      // Expand the condition to the typed modifiers it imposes, from core — so the
      // tracker applies the penalty, not just the label.
      passives: core.conditionPassives([held]),
      duration,
    },
  };
}

// Frightened has no fixed clock (it decreases by 1 at the end of each turn by its own
// rule); `unlimited` = it persists on the tracker until reduced, which the GM does.
const FRIGHTENED_DURATION = { kind: 'unlimited' };
// Off-Guard from Snagging Strike lasts "until the start of YOUR next turn" — your =
// the striker (the effect's origin), not the target who bears it.
const UNTIL_YOUR_NEXT_TURN = { kind: 'until', moment: { whose: 'origin', when: 'start' }, next: true };

const RIDERS = [
  {
    id: 'intimidating-strike',
    name: 'Intimidating Strike',
    keyword: 'intimidating',
    actionCost: { kind: 'actions', min: 2, max: 2 },
    // "Make a melee Strike. If you hit and deal damage, the target is Frightened 1,
    //  or Frightened 2 on a critical hit."
    onSuccess: [condition('Frightened', { slug: 'frightened', value: 1 }, FRIGHTENED_DURATION, ['emotion', 'fear', 'mental'])],
    onCriticalSuccess: [condition('Frightened', { slug: 'frightened', value: 2 }, FRIGHTENED_DURATION, ['emotion', 'fear', 'mental'])],
  },
  {
    id: 'snagging-strike',
    name: 'Snagging Strike',
    keyword: 'snagging',
    actionCost: { kind: 'actions', min: 1, max: 1 },
    // "Make a Strike while keeping one hand free. If this Strike hits, the target is
    //  Off-Guard until the start of your next turn…" (reach caveat left to the table)
    onHit: [condition('Off-Guard', { slug: 'off-guard' }, UNTIL_YOUR_NEXT_TURN)],
  },
];

// Validate every entry against core's schema at load — a bad rider is a load-time
// crash here, not a silent wrong composition at the table.
const { strikeRiderSchema } = core;
for (const r of RIDERS) {
  const parsed = strikeRiderSchema.safeParse(r);
  if (!parsed.success) {
    throw new Error(`strikeRiders: "${r.id}" is not a valid StrikeRider — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
}

const byKeyword = new Map(RIDERS.map((r) => [r.keyword.toLowerCase(), r]));

/** Resolve a rider by keyword or id (case-insensitive). */
function findRider(query) {
  const q = String(query ?? '').toLowerCase().trim();
  if (!q) return null;
  return byKeyword.get(q) ?? RIDERS.find((r) => r.id === q) ?? RIDERS.find((r) => r.name.toLowerCase() === q) ?? null;
}

/** The catalog, for autocomplete/listing. */
function listRiders() {
  return RIDERS.slice();
}

module.exports = { findRider, listRiders };
