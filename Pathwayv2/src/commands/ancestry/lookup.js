// ── commands/ancestry/lookup.js ─────────────────────────────────────────────
// Pure lookup against ancestryDatabase + the heritages-by-ancestry index.
//
// Two functions live here:
//   • findAncestry — resolve user input → `{ key, ancestry }` or null
//   • ancestryHeritageSlugs — get the heritage-slug list for an ancestry
//     (used by buildAncestryHeritagesPage and buildAncestryButtons to
//     decide whether the Heritages page has data)
//
// Resolution order mirrors /heritage's:
//   1. exact slug variants (raw/dash/underscore)
//   2. exact name (case-insensitive)
//   3. unique substring
//   4. dominant fuzzy match (top score ≥0.55 and ≥0.15 above runner-up)

const { score: fuzzyScore } = require('../../lib/fuzzyMatch');
const { ancestryDatabase, heritagesByAncestry } = require('../../reference/databases');

function ancestrySlugVariants(input) {
  const raw = String(input ?? '').toLowerCase().trim();
  const dash = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const underscore = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return [...new Set([raw, underscore, dash].filter(Boolean))];
}

function findAncestry(input) {
  if (!input || !ancestryDatabase) return null;
  const variants = ancestrySlugVariants(input);

  for (const key of variants) {
    if (ancestryDatabase[key]) return { key, ancestry: ancestryDatabase[key] };
  }

  const lower = String(input).toLowerCase().trim();
  for (const [key, ancestry] of Object.entries(ancestryDatabase)) {
    if (ancestry?.name?.toLowerCase() === lower) return { key, ancestry };
  }

  const substringMatches = Object.entries(ancestryDatabase).filter(([, ancestry]) =>
    ancestry?.name?.toLowerCase().includes(lower)
  );
  if (substringMatches.length === 1) {
    const [key, ancestry] = substringMatches[0];
    return { key, ancestry };
  }

  const scored = Object.entries(ancestryDatabase)
    .map(([key, ancestry]) => ({ key, ancestry, s: fuzzyScore(input, ancestry?.name ?? key) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0) return null;
  const top = scored[0];
  const runnerUp = scored[1];
  if (top.s >= 0.55 && (!runnerUp || top.s - runnerUp.s >= 0.15)) {
    return { key: top.key, ancestry: top.ancestry };
  }
  return null;
}

function ancestryHeritageSlugs(ancestrySlug) {
  for (const key of ancestrySlugVariants(ancestrySlug)) {
    if (heritagesByAncestry[key]?.length) return heritagesByAncestry[key];
  }
  return [];
}

module.exports = { ancestrySlugVariants, findAncestry, ancestryHeritageSlugs };
