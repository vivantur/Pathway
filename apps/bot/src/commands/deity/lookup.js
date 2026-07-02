// ── commands/deity/lookup.js ────────────────────────────────────────────────
// Pure lookup against deityDatabase + the autocomplete-choice builder.
//
// Several pieces here are exported so /eberron deity can reuse them — both
// commands share the deity data shape (name, epithet, areas_of_concern,
// pantheons, source). The split lookup files (this one for PF2e canon
// deities, eberron's deityLookup.js for the Eberron table) wrap the
// same primitives in their respective database queries.
//
// Resolution order:
//   1. Exact name (raw + simplified comparable forms)
//   2. Exact epithet/title match (Sarenrae → "The Dawnflower")
//   3. Starts-with on name
//   4. Contains across name, epithet, pantheon, areas_of_concern
//   5. Dominant fuzzy match for typos (top ≥0.55 AND ≥0.15 above runner-up)
//
// When step 1 or 2 produces multiple records (same deity from Player Core +
// legacy CRB, etc.), `preferDeityRecord` ranks them — Divine Mysteries wins,
// then Player Core / Player Core 2 / War of Immortals / Battlecry, then
// PFS-Standard, then AoN ID as a stable final tiebreaker.

const { score: fuzzyScore } = require('../../lib/fuzzyMatch');
const { deityDatabase } = require('../../reference/databases');

function normalizeDeityQuery(str) {
  return String(str ?? '').toLowerCase().trim()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ');
}

function deitySearchText(deity) {
  return [
    deity?.name,
    deity?.epithet,
    deity?.aon_id,
    deity?.source,
    deity?.source_text,
    ...(deity?.aliases ?? []),
    ...(deity?.areas_of_concern ?? []),
    ...(deity?.pantheons ?? []),
  ].filter(Boolean).join(' ');
}

/**
 * A more aggressive normalization than `normalizeDeityQuery`. Collapses
 * "and" / "&" into a single canonical form, strips all non-alphanumerics.
 * Used for resilient comparisons like "Erastil and Sarenrae" ≈ "Erastil &
 * Sarenrae" ≈ "Erastil-Sarenrae".
 */
function deityComparable(str) {
  return normalizeDeityQuery(str)
    .replace(/&amp;/g, '&')
    .replace(/\band\b/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Tiebreak when multiple deity records share a name. Higher score wins.
 * Divine Mysteries is the current canonical PF2e source for deity data,
 * so it gets the top weight. Player Core / WoI / Battlecry win the second
 * tier. Anything else falls back to AoN ID for stable ordering.
 */
function preferDeityRecord(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const scored = matches.map(d => {
    const source = String(d.source ?? d.source_text ?? '');
    let score = 0;
    if (/Divine Mysteries/i.test(source)) score += 100;
    if (/Player Core|Player Core 2|War of Immortals|Battlecry/i.test(source)) score += 50;
    if (d.pfs_availability === 'Standard') score += 10;
    if (d.aon_id) {
      const id = parseInt(String(d.aon_id).replace(/\D+/g, ''), 10);
      if (Number.isFinite(id)) score += Math.min(id / 1000, 1);
    }
    return { deity: d, score };
  });
  scored.sort((a, b) => b.score - a.score || String(a.deity.name).localeCompare(String(b.deity.name)));
  return scored[0].deity;
}

function findDeity(query) {
  const q = normalizeDeityQuery(query);
  const comparable = deityComparable(query);
  if (!q) return { deity: null, matches: [] };

  // 1. Exact name match
  const exact = deityDatabase.filter(d =>
    normalizeDeityQuery(d.name) === q || deityComparable(d.name) === comparable
  );
  if (exact.length === 1) return { deity: exact[0], matches: [] };
  if (exact.length > 1)   return { deity: preferDeityRecord(exact), matches: [] };

  // 2. Exact epithet/title match
  const epithetExact = deityDatabase.filter(d => d.epithet && deityComparable(d.epithet) === comparable);
  if (epithetExact.length === 1) return { deity: epithetExact[0], matches: [] };
  if (epithetExact.length > 1)   return { deity: preferDeityRecord(epithetExact), matches: [] };

  // 3. Starts-with
  const starts = deityDatabase.filter(d => deityComparable(d.name).startsWith(comparable));
  if (starts.length === 1) return { deity: starts[0], matches: [] };
  if (starts.length > 1)   return { deity: null, matches: starts };

  // 4. Contains across name, title, pantheon, and areas of concern
  const contains = deityDatabase.filter(d => deityComparable(deitySearchText(d)).includes(comparable));
  if (contains.length === 1) return { deity: contains[0], matches: [] };
  if (contains.length > 1)   return { deity: null, matches: contains };

  // 5. Fuzzy name/title match for minor typos
  const scored = deityDatabase
    .map(d => ({
      deity: d,
      s: Math.max(
        fuzzyScore(query, d.name),
        d.epithet ? fuzzyScore(query, d.epithet) * 0.95 : 0,
      ),
    }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.deity.name.localeCompare(b.deity.name));
  if (scored.length) {
    const top = scored[0];
    const runnerUp = scored[1];
    if (top.s >= 0.55 && (!runnerUp || top.s - runnerUp.s >= 0.15)) {
      return { deity: top.deity, matches: [] };
    }
  }

  return { deity: null, matches: [] };
}

/**
 * Build up to 25 autocomplete choices for /deity. Dedupes by canonicalized
 * name so we don't show the same deity twice when it appears in multiple
 * source books. Combines exact-substring matches with fuzzy-score matches,
 * preserving order: direct name hits → text-field hits → fuzzy → alphabetical.
 */
function deityAutocompleteChoices(query) {
  const q = String(query ?? '').trim();
  const seenNames = new Set();
  const sorted = [...deityDatabase]
    .filter(d => d?.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(d => {
      const key = normalizeDeityQuery(d.name);
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });

  const choice = (deity) => {
    const suffix = deity.epithet ? ` (${deity.epithet})` : '';
    const label = `${deity.name}${suffix}`;
    return {
      name: label.length > 100 ? `${label.slice(0, 97)}...` : label,
      value: deity.name,
    };
  };

  if (!q) return sorted.slice(0, 25).map(choice);

  const byName = sorted.filter(d => deityComparable(d.name).includes(deityComparable(q)));
  const byExtraText = sorted.filter(d =>
    !byName.includes(d) && deityComparable(deitySearchText(d)).includes(deityComparable(q))
  );
  const fuzzy = sorted
    .filter(d => !byName.includes(d) && !byExtraText.includes(d))
    .map(d => {
      const score = Math.max(
        fuzzyScore(q, d.name),
        d.epithet ? fuzzyScore(q, d.epithet) * 0.95 : 0,
      );
      return { deity: d, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.deity.name.localeCompare(b.deity.name))
    .map(x => x.deity);

  const merged = [];
  for (const deity of [...byName, ...byExtraText, ...fuzzy, ...sorted]) {
    if (merged.some(d => d.name === deity.name)) continue;
    merged.push(deity);
    if (merged.length >= 25) break;
  }
  return merged.map(choice);
}

module.exports = {
  normalizeDeityQuery,
  deitySearchText,
  deityComparable,
  preferDeityRecord,
  findDeity,
  deityAutocompleteChoices,
};
