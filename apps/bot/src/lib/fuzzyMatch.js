// utils/fuzzyMatch.js
// Shared fuzzy-matching utilities for autocomplete dropdowns and "Did you mean?"
// fallback messages across every lookup command in Pathway.
//
// Three exported functions:
//   - score(query, candidate)   -> number 0..1 (higher = better match)
//   - fuzzyPick(query, names)   -> [{name, value}] for Discord autocomplete (≤25)
//   - didYouMean(query, names)  -> [string, ...] top suggestions, or [] if hopeless
//
// Design choices:
//   - Empty query returns the first 25 alphabetically, matching the existing
//     Pathway behavior so the dropdown isn't blank when users open it.
//   - Exact and prefix matches always rank above fuzzy matches. A user who types
//     the start of a word correctly should get prefix-style behavior, not have
//     "fireball" outranked by "fire bolt" because of a closer Levenshtein score.
//   - Fuzzy threshold is ~0.55. Below that, results are usually unrelated noise.
//     Tune in TUNING_THRESHOLD if you want it stricter/looser.
//   - Levenshtein is O(n*m) per pair, but our `n` and `m` are short strings
//     (≤30 chars typically) so even a 5,000-entry list resolves in a few ms.

const TUNING_THRESHOLD = 0.55;

/**
 * Levenshtein edit distance between two strings.
 * Iterative two-row implementation — no recursion, no allocs beyond two rows.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,         // insertion
        prev[j] + 1,             // deletion
        prev[j - 1] + cost,      // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Normalize for matching: lowercase, collapse whitespace and underscores to
 * single spaces, drop apostrophes/curly quotes. Keeps spaces intact so
 * multi-word queries can still match.
 */
function normalize(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc']/g, '')
    .replace(/[_\-\s]+/g, ' ')
    .trim();
}

/**
 * Score how well `query` matches `candidate`. Returns a value in [0, 1] where:
 *   1.0   = exact match (case/whitespace insensitive)
 *   0.95  = candidate starts with query
 *   0.85  = candidate contains query as substring
 *   ≤0.80 = fuzzy (Levenshtein-based) match
 *   0.0   = no plausible relationship
 */
function score(query, candidate) {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q) return 0;
  if (q === c) return 1.0;
  if (c.startsWith(q)) return 0.95;
  if (c.includes(q)) return 0.85;

  // Word-prefix match: did any word in the candidate start with the query?
  // Catches cases like query "fire" -> "Wall of Fire" (word "Fire" starts with "fire").
  const words = c.split(' ');
  if (words.some(w => w.startsWith(q))) return 0.80;

  // Fuzzy: Levenshtein normalized to length, biased so that shorter candidates
  // that "absorb" most of the query still score reasonably.
  const dist = levenshtein(q, c);
  const maxLen = Math.max(q.length, c.length);
  if (maxLen === 0) return 0;
  let fuzzy = 1 - dist / maxLen;

  // Compare query against the closest individual word too — catches
  // "grabed" -> "Grabbed" (one-word entry) without penalizing for length
  // when the candidate is multi-word like "Grabbed Object".
  if (words.length > 1) {
    let bestWord = 0;
    for (const w of words) {
      if (!w) continue;
      const wDist = levenshtein(q, w);
      const wScore = 1 - wDist / Math.max(q.length, w.length);
      if (wScore > bestWord) bestWord = wScore;
    }
    // Word match counts for 90% of full-string match (slight preference for
    // matching the whole candidate).
    fuzzy = Math.max(fuzzy, bestWord * 0.9);
  }

  // Cap fuzzy at 0.80 so an exact-substring match always beats it.
  return Math.min(fuzzy, 0.80);
}

/**
 * Given a query and a list of candidate names, return a Discord-autocomplete-
 * compatible array of choices, sorted best-match first, capped at 25.
 *
 * Drop-in replacement for the `pick()` helper that used to live inline in
 * index.js. Same input/output contract, smarter ranking.
 */
function fuzzyPick(query, names) {
  const seen = new Set();
  const out = [];
  const push = (n) => {
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    // Discord caps autocomplete name/value at 100 chars
    const display = n.length > 100 ? n.slice(0, 97) + '...' : n;
    out.push({ name: display, value: display });
  };

  if (!query || !query.trim()) {
    // Empty query: first 25 alphabetically (matches old behavior)
    [...names].sort((a, b) => a.localeCompare(b)).slice(0, 25).forEach(push);
    return out;
  }

  // Score every candidate. Cheap to compute since names are short.
  const scored = [];
  for (const n of names) {
    if (!n) continue;
    const s = score(query, n);
    if (s > 0) scored.push({ name: n, s });
  }

  // Sort by score (desc), then alphabetical to make ties stable.
  scored.sort((a, b) => (b.s - a.s) || a.name.localeCompare(b.name));

  for (const { name } of scored) {
    if (out.length >= 25) break;
    push(name);
  }
  return out;
}

/**
 * Return the top suggestions for a "Did you mean?" message. Different from
 * fuzzyPick because:
 *   - We want the very best 1-3 matches, not a 25-deep dropdown
 *   - We filter below the noise threshold so "xyzzy" doesn't suggest "Xenoglossia"
 *   - We never include exact matches (if it was exact, you wouldn't be here)
 *
 * Returns up to `limit` strings, ordered best-first. Empty array if nothing
 * cleared the threshold.
 */
function didYouMean(query, names, limit = 3) {
  if (!query || !query.trim() || !names?.length) return [];

  const scored = [];
  for (const n of names) {
    if (!n) continue;
    const s = score(query, n);
    if (s >= TUNING_THRESHOLD && s < 1.0) {
      scored.push({ name: n, s });
    }
  }
  scored.sort((a, b) => (b.s - a.s) || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(x => x.name);
}

/**
 * Convenience formatter for "Did you mean?" — returns either a markdown-
 * formatted suggestion line or empty string. Designed to be appended to
 * existing "❌ No X found" messages.
 *
 * Example output:  "\nDid you mean: **Grabbed**, **Grappled**, or **Restrained**?"
 */
function didYouMeanLine(query, names, limit = 3) {
  const suggestions = didYouMean(query, names, limit);
  if (!suggestions.length) return '';
  if (suggestions.length === 1) {
    return `\nDid you mean **${suggestions[0]}**?`;
  }
  if (suggestions.length === 2) {
    return `\nDid you mean **${suggestions[0]}** or **${suggestions[1]}**?`;
  }
  const last = suggestions.pop();
  return `\nDid you mean ${suggestions.map(s => `**${s}**`).join(', ')}, or **${last}**?`;
}

module.exports = {
  score,
  fuzzyPick,
  didYouMean,
  didYouMeanLine,
  // Exposed for tests/tuning
  levenshtein,
  normalize,
  TUNING_THRESHOLD,
};