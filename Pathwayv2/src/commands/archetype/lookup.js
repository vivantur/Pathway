// ── commands/archetype/lookup.js ────────────────────────────────────────────
// Pure lookup against archetypeDatabase. Unlike most reference lookups, this
// one keys against the *slug* (the object key) rather than the display name.
//
// Returns `{ archetype, matches }`:
//   • archetype = the resolved entry, or null
//   • matches   = list of NAMES (strings) when ambiguous. Note these are the
//                 object KEYS (slugs), not display names — preserved for
//                 compatibility with the existing user-facing message that
//                 prints them comma-separated.

const { archetypeDatabase } = require('../../reference/databases');

function findArchetype(query) {
  const q = String(query ?? '').toLowerCase().trim();
  // 1. Exact key match
  for (const [key, archetype] of Object.entries(archetypeDatabase)) {
    if (key.toLowerCase() === q) return { archetype, matches: [] };
  }
  // 2. Substring on key
  const matches = Object.entries(archetypeDatabase).filter(([key]) =>
    key.toLowerCase().includes(q)
  );
  if (matches.length === 1) return { archetype: matches[0][1], matches: [] };
  if (matches.length > 1)   return { archetype: null, matches: matches.map(([k]) => k) };
  return { archetype: null, matches: [] };
}

module.exports = { findArchetype };
