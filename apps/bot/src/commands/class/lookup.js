// ── commands/class/lookup.js ────────────────────────────────────────────────
// Pure lookup against classDatabase.
//
// Same exact → starts-with → contains ladder as the other reference lookups.
// Returns `{ cls, key, matches }`:
//   • cls     = the resolved class entry (or null)
//   • key     = the slug (e.g. "fighter") used for button customIds
//   • matches = list of display names when ambiguous

const { classDatabase } = require('../../reference/databases');

function findClass(query) {
  if (!query) return { cls: null, key: null, matches: [] };
  const q = String(query).toLowerCase().trim();
  const entries = Object.entries(classDatabase);

  // 1. Exact slug key match (the common case from autocomplete)
  if (classDatabase[q]) return { cls: classDatabase[q], key: q, matches: [] };

  // 2. Exact display-name match
  const exact = entries.find(([, c]) => c.name.toLowerCase() === q);
  if (exact) return { cls: exact[1], key: exact[0], matches: [] };

  // 3. Starts-with on display name
  const starts = entries.filter(([, c]) => c.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return { cls: starts[0][1], key: starts[0][0], matches: [] };
  if (starts.length > 1)   return { cls: null, key: null, matches: starts.map(([, c]) => c.name) };

  // 4. Substring on display name
  const contains = entries.filter(([, c]) => c.name.toLowerCase().includes(q));
  if (contains.length === 1) return { cls: contains[0][1], key: contains[0][0], matches: [] };
  return { cls: null, key: null, matches: contains.map(([, c]) => c.name) };
}

module.exports = { findClass };
