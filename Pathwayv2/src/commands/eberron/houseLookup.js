// ── commands/eberron/houseLookup.js ─────────────────────────────────────────
// Lookup against eberronHouseDatabase (the 13 Dragonmarked Houses of
// Eberron — Cannith, Deneith, Phiarlan, etc.).
//
// Houses have a different shape than deities — they carry `mark`,
// `short_name`, `aliases`, `guilds`, `services`, `common_skills`,
// `associated_people`, `headquarters`. So the normalizer and search-text
// builder are distinct from the deity ones, even though the overall
// shape (exact → starts → contains → fuzzy) mirrors /deity.

const { fuzzyPick, score: fuzzyScore } = require('../../lib/fuzzyMatch');
const { eberronHouseDatabase } = require('../../reference/databases');

/**
 * House-specific normalizer. More aggressive than the deity version:
 * also strips backticks and turns "&" into "and" before collapsing
 * non-alphanumerics. The single-key normalizer makes substring matches
 * resilient to query forms like "house cannith" vs "House Cannith"
 * vs "cannith-house".
 */
function normalizeEberronQuery(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function eberronHouseSearchText(house) {
  return [
    house?.name,
    house?.short_name,
    house?.mark,
    house?.associated_people,
    house?.headquarters,
    ...(house?.aliases ?? []),
    ...(house?.guilds ?? []),
    ...(house?.services ?? []),
    ...(house?.common_skills ?? []),
  ].filter(Boolean).join(' ');
}

function findEberronHouse(query) {
  const q = normalizeEberronQuery(query);
  if (!q) return { house: null, matches: [] };

  // 1. Exact match on name, short name, mark, or any alias
  const exact = eberronHouseDatabase.filter(h =>
    normalizeEberronQuery(h.name) === q ||
    normalizeEberronQuery(h.short_name) === q ||
    normalizeEberronQuery(h.mark) === q ||
    (h.aliases ?? []).some(a => normalizeEberronQuery(a) === q)
  );
  if (exact.length === 1) return { house: exact[0], matches: [] };
  if (exact.length > 1)   return { house: null, matches: exact };

  // 2. Starts-with on name, short name, or mark
  const starts = eberronHouseDatabase.filter(h =>
    normalizeEberronQuery(h.name).startsWith(q) ||
    normalizeEberronQuery(h.short_name).startsWith(q) ||
    normalizeEberronQuery(h.mark).startsWith(q)
  );
  if (starts.length === 1) return { house: starts[0], matches: [] };
  if (starts.length > 1)   return { house: null, matches: starts };

  // 3. Contains across all searchable text
  const contains = eberronHouseDatabase.filter(h =>
    normalizeEberronQuery(eberronHouseSearchText(h)).includes(q)
  );
  if (contains.length === 1) return { house: contains[0], matches: [] };
  if (contains.length > 1)   return { house: null, matches: contains };

  // 4. Fuzzy match. Threshold ≥0.55 for inclusion, top must score ≥0.72
  //    to auto-pick (or be the only one above the floor).
  const scored = eberronHouseDatabase
    .map(h => ({ house: h, score: fuzzyScore(q, normalizeEberronQuery(eberronHouseSearchText(h))) }))
    .filter(x => x.score >= 0.55)
    .sort((a, b) => b.score - a.score || a.house.name.localeCompare(b.house.name));
  if (scored.length === 1 || (scored[0] && scored[0].score >= 0.72)) {
    return { house: scored[0].house, matches: [] };
  }
  if (scored.length > 1) return { house: null, matches: scored.slice(0, 10).map(x => x.house) };

  return { house: null, matches: [] };
}

/**
 * Autocomplete for /eberron house. With only 13 houses, exhaustive listing
 * is cheap; we just bias toward whatever matches the user's input as a
 * substring, then fall back to fuzzy, then alphabetical.
 */
function eberronHouseAutocompleteChoices(query) {
  const q = normalizeEberronQuery(query);
  const sorted = [...eberronHouseDatabase].sort((a, b) => a.name.localeCompare(b.name));
  const source = q
    ? sorted.filter(h => normalizeEberronQuery(eberronHouseSearchText(h)).includes(q))
    : sorted;
  const fallback = fuzzyPick(String(query ?? ''), sorted.map(h => h.name))
    .map(choice => sorted.find(h => h.name === choice.value))
    .filter(Boolean);
  const merged = [];
  for (const house of [...source, ...fallback, ...sorted]) {
    if (merged.some(h => h.name === house.name)) continue;
    merged.push(house);
    if (merged.length >= 25) break;
  }
  return merged.map(h => ({
    name: `${h.name}${h.mark ? ` (${h.mark})` : ''}`.slice(0, 100),
    value: h.name,
  }));
}

module.exports = {
  normalizeEberronQuery,
  eberronHouseSearchText,
  findEberronHouse,
  eberronHouseAutocompleteChoices,
};
