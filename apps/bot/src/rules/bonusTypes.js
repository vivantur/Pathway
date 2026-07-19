// ── rules/bonusTypes.js ─────────────────────────────────────────────────────
//
// Which BONUS TYPE (circumstance / status / item / untyped) each of the combat
// tracker's five flat modifier slots carries, for a given PF2e condition.
//
// WHY THIS IS DERIVED AND NOT A TABLE: the tracker's effects have always been
// untyped, so `sumEffectModifiers` added every modifier together — which gets the
// stacking rules wrong for every same-typed pair (Frightened 2 and Sickened 2
// each give a −2 STATUS penalty to AC; only −2 applies, not −4). Fixing that
// needs a type on each modifier, and the honest source for those types is core's
// condition data, which was built from owner-supplied rules text. Hand-typing a
// table here would be implementing rules from memory — and it would drift.
//
// The bot's own preset descriptions are NOT a source: `prone` there reads "-2
// status penalty to attack rolls" while core has prone as CIRCUMSTANCE. That
// string was written from memory and is exactly the kind of thing this indirection
// stops us inheriting.
//
// WHAT IT REFUSES TO DECIDE. A slot gets a type only when core is unambiguous
// about it. Two cases stay `untyped`, which is precisely the tracker's existing
// behavior, so nothing silently changes where we lack an answer:
//
//   • core models no modifier for that slot. The tracker's slots are coarse
//     ("attackBonus"), core's selectors are precise ("athletics"). Enfeebled
//     penalizes Strength-based attacks — which core cannot yet express, so it
//     models only the athletics part. The tracker's blanket attack penalty is an
//     approximation core deliberately does not make, and typing it would be
//     asserting something core does not say.
//   • core is ambiguous for that slot — Unconscious contributes BOTH a status and
//     a circumstance penalty that land on AC. One flat slot cannot hold two types.
//
// PURE: reads core, returns a plain object. Computed once at load.

'use strict';

const core = require('@pathway/core');

/** Core selector → the tracker's flat slot. Selectors absent here have no slot. */
const SLOT_OF = {
  ac: 'acBonus',
  attack: 'attackBonus',
  damage: 'damageBonus',
  fortitude: 'saveBonus',
  reflex: 'saveBonus',
  will: 'saveBonus',
};

function slotForSelector(selector) {
  if (SLOT_OF[selector]) return SLOT_OF[selector];
  return core.SKILL_SLUGS.includes(selector) ? 'skillBonus' : null;
}

/**
 * Types that CANNOT be derived, because the preset is not a condition and core's
 * condition data therefore has nothing to say about it.
 *
 * OWNER-SUPPLIED (2026-07-18), through the authorized channel: Bless grants a
 * status bonus; Heroism grants a status bonus. DO NOT EXTEND THIS TABLE FROM
 * MEMORY — an entry here is a rules claim, and the whole reason the rest of this
 * module derives rather than declares is that claims written from memory turned
 * out to be wrong (see prone). A preset absent from this table stays untyped,
 * which is the tracker's historical behavior and asserts nothing.
 */
const OWNER_SUPPLIED = {
  bless: { attackBonus: 'status' },
  heroism: { attackBonus: 'status', saveBonus: 'status', skillBonus: 'status' },
};

/**
 * The unambiguous bonus type per slot for one condition slug, e.g.
 * `{ acBonus: 'circumstance', attackBonus: 'circumstance' }` for Prone.
 * Slots core cannot speak to unambiguously are simply absent.
 */
function deriveSlotTypes(slug) {
  if (OWNER_SUPPLIED[slug]) return { ...OWNER_SUPPLIED[slug] };
  if (!core.isConditionSlug(slug)) return {};

  // A representative value for valued conditions — the VALUE is irrelevant here,
  // only which selectors are touched and with what type, and neither varies by it.
  const def = core.CONDITIONS[slug];
  const passives = core.conditionPassives([{ slug, value: def.valued ? 2 : undefined }]);

  const seen = {};
  for (const p of passives) {
    if (p.kind !== 'modifier') continue;
    const slot = slotForSelector(p.target);
    if (!slot) continue;
    (seen[slot] ??= new Set()).add(p.bonusType);
  }

  const out = {};
  for (const [slot, types] of Object.entries(seen)) {
    // Exactly one type, or we decline to guess.
    if (types.size === 1) out[slot] = [...types][0];
  }
  return out;
}

// Computed once: the condition list is static.
const CACHE = new Map();

function slotBonusTypes(slug) {
  const key = String(slug ?? '').toLowerCase();
  if (!CACHE.has(key)) CACHE.set(key, deriveSlotTypes(key));
  return CACHE.get(key);
}

/** The type for one slot, defaulting to `untyped` — the tracker's historical behavior. */
function typeForSlot(bonusTypes, slot) {
  return bonusTypes?.[slot] ?? 'untyped';
}

module.exports = {
  slotBonusTypes,
  typeForSlot,
  slotForSelector,
};
