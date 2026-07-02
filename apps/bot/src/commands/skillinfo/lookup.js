// ── commands/skillinfo/lookup.js ────────────────────────────────────────────
// Pure lookup against skillDatabase.
//
// Same exact → starts-with → contains ladder as the other reference lookups.
// Returns `{ skill, key, matches }`:
//   • skill   = the resolved skill entry (or null)
//   • key     = the slug (e.g. "athletics") needed downstream for the button
//               customIds and for `computeCharSkillModifier`
//   • matches = list of display names when ambiguous

const { skillDatabase } = require('../../reference/databases');

function findSkill(query) {
  if (!query) return { skill: null, key: null, matches: [] };
  const q = String(query).toLowerCase().trim();
  const entries = Object.entries(skillDatabase);
  if (entries.length === 0) return { skill: null, key: null, matches: [] };

  // 1. Exact slug key match (the common path: autocomplete passes "athletics")
  if (skillDatabase[q]) return { skill: skillDatabase[q], key: q, matches: [] };

  // 2. Exact display-name match
  const exactName = entries.find(([, s]) => s.name.toLowerCase() === q);
  if (exactName) return { skill: exactName[1], key: exactName[0], matches: [] };

  // 3. Starts-with on display name
  const startsWith = entries.filter(([, s]) => s.name.toLowerCase().startsWith(q));
  if (startsWith.length === 1) return { skill: startsWith[0][1], key: startsWith[0][0], matches: [] };
  if (startsWith.length > 1)   return { skill: null, key: null, matches: startsWith.map(([, s]) => s.name) };

  // 4. Substring on display name
  const contains = entries.filter(([, s]) => s.name.toLowerCase().includes(q));
  if (contains.length === 1) return { skill: contains[0][1], key: contains[0][0], matches: [] };
  if (contains.length > 1)   return { skill: null, key: null, matches: contains.map(([, s]) => s.name) };

  return { skill: null, key: null, matches: [] };
}

module.exports = { findSkill };
