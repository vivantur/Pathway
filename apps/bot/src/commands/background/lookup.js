// ── commands/background/lookup.js ───────────────────────────────────────────
// Pure lookup against the in-memory backgroundDatabase. No I/O, no Discord.

const { backgroundDatabase } = require('../../reference/databases');

// Returns `{ background, matches }`:
//   • background = the resolved background object, or null
//   • matches    = array of NAMES (strings) when the query was ambiguous
//                  (only populated if background is null AND >1 partial match)
function findBackground(query) {
  const normalize = str => String(str ?? '').toLowerCase().trim()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ');
  const q = normalize(query);
  const qSlug = q.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  // 1. Exact slug key match
  if (backgroundDatabase[qSlug]) return { background: backgroundDatabase[qSlug], matches: [] };

  // 2. Exact display-name match
  const entries = Object.entries(backgroundDatabase);
  const exactName = entries.find(([, b]) => normalize(b.name) === q);
  if (exactName) return { background: exactName[1], matches: [] };

  // 3. Partial match on key or name
  const partials = entries.filter(([key, b]) =>
    key.toLowerCase().includes(qSlug) || normalize(b.name).includes(q)
  );
  if (partials.length === 1) return { background: partials[0][1], matches: [] };
  if (partials.length > 1)   return { background: null, matches: partials.map(([, b]) => b.name) };
  return { background: null, matches: [] };
}

module.exports = { findBackground };
