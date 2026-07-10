// Minimal lint for the bot. Deliberately ONE rule: `no-undef`.
//
// The bot is ~39k lines of untyped CommonJS with no build step, so nothing
// catches a reference to an identifier that does not exist. `node --check` only
// parses; it happily accepts `foo()` where `foo` was never defined. Two real
// bugs of exactly that shape have already shipped here:
//
//   - index.js kept a `?? getEncounter(...)` fallback to the legacy combat
//     engine after that engine was deleted, throwing ReferenceError into a
//     catch-all that silently returned empty autocomplete results.
//   - state.js lost `makeCombatant` from scope during a refactor. The only
//     caller was `.map(makeCombatant)` in the Supabase restore path, which
//     swallows its own errors — every active encounter would have been dropped
//     on bot restart, with no test able to see it.
//
// Style rules are intentionally absent. This exists to catch bugs, not to argue
// about formatting; keeping the rule set at one means it stays green and useful.

import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'gamedata/**', 'scripts/archive/**'],
  },
  {
    // Bot source, scripts, and tools: CommonJS.
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { 'no-undef': 'error' },
  },
  {
    // The Vitest suite is ESM and loads the CommonJS modules via createRequire.
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-undef': 'error' },
  },
];
