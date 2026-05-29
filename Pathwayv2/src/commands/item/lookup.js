// ── commands/item/lookup.js ─────────────────────────────────────────────────
// Pure lookup against itemDatabase.
//
// Resolution mirrors /feat's exact → starts-with → contains ladder, with one
// addition: when multiple items share the *exact* name (e.g. "Longsword"
// appears as both Player Core and legacy CRB entries), we auto-select the
// preferred edition via itemSourceRank rather than punting to the user.
// Player Core / GM Core wins; non-legacy wins; PFS-Standard wins; AoN ID
// breaks ties as a final stable sort.
//
// Returns `{ item, matches, exactDuplicates?, autoSelected? }`:
//   • item             = resolved entry, or null
//   • matches          = candidate list when ambiguous
//   • exactDuplicates  = true when matches all share the exact name
//   • autoSelected     = true when we picked from the exact-duplicates set

const { itemDatabase } = require('../../reference/databases');

function normalizeItemQuery(str) {
  return String(str ?? '').toLowerCase().trim()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ');
}

/**
 * Rank an item by source preference. Higher = preferred when multiple
 * editions of the same item exist. Weights are tuned to make Player Core
 * the default (it's the current canonical PF2e source), demote anything
 * tagged "legacy" or "core rulebook" (pre-Remaster CRB), and use the AoN
 * ID as a deterministic final tiebreaker.
 */
function itemSourceRank(item) {
  const source = String(item?.source ?? item?.source?.source_text ?? '').toLowerCase();
  const aon = String(item?.aon_url ?? '');
  let rank = 0;
  if (source.includes('player core') || source.includes('gm core')) rank += 100;
  if (source.includes('rage of elements') || source.includes('war of immortals')) rank += 80;
  if (!source.includes('legacy') && !source.includes('core rulebook')) rank += 10;
  if (item?.pfs_availability === 'Standard') rank += 5;
  const idMatch = aon.match(/ID=(\d+)/i);
  if (idMatch) rank += Math.min(Number(idMatch[1]) / 10000, 1);
  return rank;
}

function choosePreferredItem(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) =>
    itemSourceRank(b) - itemSourceRank(a) ||
    (b.level ?? -1) - (a.level ?? -1) ||
    String(a.source ?? '').localeCompare(String(b.source ?? '')) ||
    String(a.aon_url ?? '').localeCompare(String(b.aon_url ?? ''))
  );
  return sorted[0];
}

function findItem(query, levelFilter) {
  const q = normalizeItemQuery(query);
  if (!q) return { item: null, matches: [] };

  const pool = levelFilter != null
    ? itemDatabase.filter(i => i.level === levelFilter)
    : itemDatabase;

  // 1. Exact name match — prefer `lookup_name` (a canonicalized form like
  //    "longsword" for "Longsword +1"), fall back to display name.
  const exact = pool.filter(i =>
    (i.lookup_name ?? i.name).toLowerCase() === q ||
    i.name.toLowerCase() === q
  );
  if (exact.length === 1) return { item: exact[0], matches: [] };
  if (exact.length > 1)   return {
    item: choosePreferredItem(exact),
    matches: exact,
    exactDuplicates: true,
    autoSelected: true,
  };

  // 2. Starts-with match
  const starts = pool.filter(i => i.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return { item: starts[0], matches: [] };

  // 3. Contains match
  const contains = pool.filter(i => i.name.toLowerCase().includes(q));
  if (contains.length === 1) return { item: contains[0], matches: [] };
  if (contains.length > 1)   return { item: null, matches: contains };

  return { item: null, matches: [] };
}

module.exports = {
  normalizeItemQuery,
  itemSourceRank,
  choosePreferredItem,
  findItem,
};
