// ── commands/eberron/deityLookup.js ─────────────────────────────────────────
// Lookup against eberronDeityDatabase (the campaign-setting deity table —
// Sovereign Host, Dark Six, Cults of the Dragon Below, etc.).
//
// Cross-feature import: we reuse the comparable-string normalizers and the
// preferDeityRecord tiebreaker from /deity, since the Eberron deities share
// the same data shape — same fields, just a different source database.
//
// Resolution order:
//   1. Exact name (raw + comparable forms)
//   2. Exact alias match (Onatar = "Forge Father")
//   3. Starts-with on name
//   4. Contains across name/epithet/pantheon/areas_of_concern

const { eberronDeityDatabase } = require('../../reference/databases');
const {
  normalizeDeityQuery,
  deityComparable,
  deitySearchText,
  preferDeityRecord,
} = require('../deity/lookup');

function findEberronDeity(query) {
  const q = normalizeDeityQuery(query);
  const comparable = deityComparable(query);
  if (!q) return { deity: null, matches: [] };

  // 1. Exact name match
  const exact = eberronDeityDatabase.filter(d =>
    normalizeDeityQuery(d.name) === q || deityComparable(d.name) === comparable
  );
  if (exact.length === 1) return { deity: exact[0], matches: [] };
  if (exact.length > 1)   return { deity: preferDeityRecord(exact), matches: [] };

  // 2. Alias match (the Sovereign Host members all have multiple titles)
  const aliasExact = eberronDeityDatabase.filter(d =>
    (d.aliases ?? []).some(a => deityComparable(a) === comparable)
  );
  if (aliasExact.length === 1) return { deity: aliasExact[0], matches: [] };
  if (aliasExact.length > 1)   return { deity: preferDeityRecord(aliasExact), matches: [] };

  // 3. Starts-with
  const starts = eberronDeityDatabase.filter(d => deityComparable(d.name).startsWith(comparable));
  if (starts.length === 1) return { deity: starts[0], matches: [] };
  if (starts.length > 1)   return { deity: null, matches: starts };

  // 4. Contains across all searchable fields
  const contains = eberronDeityDatabase.filter(d =>
    deityComparable(deitySearchText(d)).includes(comparable)
  );
  if (contains.length === 1) return { deity: contains[0], matches: [] };
  if (contains.length > 1)   return { deity: null, matches: contains };

  return { deity: null, matches: [] };
}

/**
 * Autocomplete builder for /eberron deity. Simpler than the PF2e canon one
 * — only ~30 Eberron deities so we don't need fuzzy scoring; substring on
 * the combined searchable text covers it.
 */
function eberronDeityAutocompleteChoices(query) {
  const q = deityComparable(query);
  const sorted = [...eberronDeityDatabase]
    .filter(d => d?.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const source = q
    ? sorted.filter(d => deityComparable(deitySearchText(d)).includes(q))
    : sorted;
  const merged = [];
  for (const deity of [...source, ...sorted]) {
    if (merged.some(d => d.name === deity.name)) continue;
    merged.push(deity);
    if (merged.length >= 25) break;
  }
  return merged.map(d => {
    const suffix = d.epithet ? ` (${d.epithet})` : '';
    const label = `${d.name}${suffix}`;
    return {
      name: label.length > 100 ? `${label.slice(0, 97)}...` : label,
      value: d.name,
    };
  });
}

module.exports = { findEberronDeity, eberronDeityAutocompleteChoices };
