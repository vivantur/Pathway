// ── commands/snippet/validation.js ──────────────────────────────────────────
// Validation for snippet names and expansions.
//
// Snippets are user-defined macros expanded inline in /roll. They have:
//   • a `name`       — short identifier the user types ("sneaky")
//   • an `expansion` — the dice/math substituted in ("+2d6[sneak]")
//
// Expansions can contain numbered placeholders (`%1`, `%2:default`) that
// take args from the /roll command line. The validators here enforce
// shape rules so user input can't break the roll parser or shadow built-in
// roll modifiers.
//
// Shared with /serversnippet (when extracted) since both apply the same
// rules to user input.

// Reserved names that conflict with built-in /roll modifiers. Trying to
// create a snippet with one of these would silently override the modifier.
const RESERVED_SNIPPET_NAMES = new Set([
  'adv', 'advantage', 'dis', 'disadvantage', 'disadv',
  'crit', 'critical', 'rr1', 'rr2', 'rr3', 'rr4', 'rr5',
  'kh1', 'kh2', 'kh3', 'kh4', 'kl1', 'kl2', 'kl3', 'd',
]);

// Returns null on success, or an error message string.
function validateSnippetName(name) {
  if (!name || typeof name !== 'string') return 'Name is required.';
  if (name.length < 1 || name.length > 24) return 'Name must be 1-24 characters.';
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) return 'Name must start with a letter and contain only letters, numbers, and underscores.';
  if (RESERVED_SNIPPET_NAMES.has(name.toLowerCase())) return `\`${name}\` is a reserved roll modifier keyword.`;
  return null;
}

// Returns null on success, or an error message string. Allows dice
// expressions, math, [labels], and %N placeholders (1-9, sequential).
function validateSnippetExpansion(expansion) {
  if (!expansion || typeof expansion !== 'string') return 'Expansion is required.';
  if (expansion.length > 200) return 'Expansion must be 200 characters or fewer.';

  // Strip brackets (labels), placeholders like %1 or %1:default, whitespace.
  // What's left must be dice-expression characters only.
  const stripped = expansion
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, '')
    .replace(/%\d+(?::[0-9.]+)?/g, '0')
    .replace(/\s+/g, '');
  if (!/^[0-9dkhlb+\-*/().]*$/.test(stripped)) {
    return 'Expansion contains invalid characters. Use dice, numbers, +/-/*//, `%N` placeholders, and optional [labels].';
  }

  // Placeholder numbers must be sequential starting from 1 (no gaps).
  const placeholders = [...expansion.matchAll(/%(\d+)(?::([0-9.]+))?/g)];
  if (placeholders.length > 0) {
    const nums = placeholders.map(m => parseInt(m[1]));
    const maxArg = Math.max(...nums);
    if (maxArg > 9) return 'Placeholder numbers must be between 1 and 9 (e.g. %1, %2).';
    for (let i = 1; i <= maxArg; i++) {
      if (!nums.includes(i)) return `Placeholders must be sequential. You used %${maxArg} but no %${i}.`;
    }
  }
  return null;
}

module.exports = {
  RESERVED_SNIPPET_NAMES,
  validateSnippetName,
  validateSnippetExpansion,
};
