// ── commands/feat/lookup.js ─────────────────────────────────────────────────
// Pure lookup against the in-memory `featDatabase` array.
//
// Resolution order (with optional level filter applied first):
//   1. exact name (case-insensitive) — single hit returns; multiple hits
//      surface with `exactDuplicates: true` so the command can prompt the
//      user to add a level (Power Attack exists at multiple levels, etc.)
//   2. starts-with — single hit returns
//   3. substring   — single hit returns, multiple hits return as matches
//
// Returns `{ feat, matches, exactDuplicates? }`. `feat` is the resolved
// entry (or null); `matches` is the candidate list when ambiguous.

const { featDatabase } = require('../../reference/databases');

function normalizeFeatQuery(str) {
  return String(str ?? '').toLowerCase().trim()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ');
}

function findFeat(query, levelFilter) {
  const q = normalizeFeatQuery(query);
  if (!q) return { feat: null, matches: [] };

  // Narrow by level if provided
  const pool = levelFilter != null
    ? featDatabase.filter(f => f.level === levelFilter)
    : featDatabase;

  // 1. Exact name match (case-insensitive)
  const exact = pool.filter(f => f.name.toLowerCase() === q);
  if (exact.length === 1) return { feat: exact[0], matches: [] };
  if (exact.length > 1)   return { feat: null, matches: exact, exactDuplicates: true };

  // 2. Starts-with match
  const starts = pool.filter(f => f.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return { feat: starts[0], matches: [] };

  // 3. Contains match
  const contains = pool.filter(f => f.name.toLowerCase().includes(q));
  if (contains.length === 1) return { feat: contains[0], matches: [] };
  if (contains.length > 1)   return { feat: null, matches: contains };

  return { feat: null, matches: [] };
}

module.exports = { normalizeFeatQuery, findFeat };
