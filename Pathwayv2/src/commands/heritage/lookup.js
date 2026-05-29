// ── commands/heritage/lookup.js ─────────────────────────────────────────────
// Pure lookup against heritageDatabase.
//
// 322 heritages live in `heritageDatabase`, keyed by slug. Resolution order:
//   1. exact slug match              ("anvil-dwarf")
//   2. exact lowercase name match    ("anvil dwarf")
//   3. unique substring match        ("anvil" → only 1 result, return it)
//   4. dominant fuzzy match          ("nephlim" → "Nephilim" if it dominates)
//
// The "dominant fuzzy" step requires the top score ≥ 0.55 AND ≥ 0.15 ahead of
// the runner-up — without that gap, ambiguous queries like "Dragon" would
// silently return a wrong heritage. With it, single-typo queries still
// resolve cleanly while genuinely ambiguous input returns null.

const { score: fuzzyScore } = require('../../lib/fuzzyMatch');
const { heritageDatabase } = require('../../reference/databases');

function findHeritage(input) {
  if (!input || !heritageDatabase) return null;
  const slug = input.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // 1. exact slug
  if (heritageDatabase[slug]) return heritageDatabase[slug];

  // 2. exact name
  const lower = input.toLowerCase().trim();
  for (const h of Object.values(heritageDatabase)) {
    if (h?.name?.toLowerCase() === lower) return h;
  }

  // 3. unique substring
  const substringMatches = Object.values(heritageDatabase).filter(h =>
    h?.name?.toLowerCase().includes(lower)
  );
  if (substringMatches.length === 1) return substringMatches[0];

  // 4. dominant fuzzy match
  const scored = Object.values(heritageDatabase)
    .map(h => ({ heritage: h, s: fuzzyScore(input, h.name) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0) return null;
  const top = scored[0];
  const runnerUp = scored[1]?.s ?? 0;
  if (top.s >= 0.55 && (top.s - runnerUp) >= 0.15) {
    return top.heritage;
  }
  return null;
}

module.exports = { findHeritage };
