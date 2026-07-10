// ── rules/combatV2/state.js — DEPRECATED COMPATIBILITY FACADE ────────────────
//
// The combat v2 encounter store moved to `state/combat.js`, where it belongs:
// it owns an in-memory Map and writes to Supabase, and this app's CLAUDE.md says
// mutable cached state lives in `state/`, not `rules/`. The PF2e combat rules
// stayed behind in `rules/combatV2/model.js`, which is pure.
//
// This file exists only so the 13 existing consumers keep working while they are
// repointed one at a time. Do not add anything to it. New code should require
// `state/combat` (for the store) or `rules/combatV2/model` (for the rules).

module.exports = require('../../state/combat');
