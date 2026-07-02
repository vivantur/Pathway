const { bestiaryDatabase } = require('../../reference/databases');

function findMonster(query) {
  const normalize = str => String(str ?? '').toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ');
  const q = normalize(query);
  const qSlug = q.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  const entries = Object.entries(bestiaryDatabase);
  if (entries.length === 0) return { monster: null, matches: [] };

  if (bestiaryDatabase[qSlug]) return { monster: bestiaryDatabase[qSlug], matches: [] };

  const exactName = entries.find(([, m]) => normalize(m.name) === q);
  if (exactName) return { monster: exactName[1], matches: [] };

  const startsWith = entries.filter(([, m]) => normalize(m.name).startsWith(q));
  if (startsWith.length === 1) return { monster: startsWith[0][1], matches: [] };
  if (startsWith.length > 1 && startsWith.length <= 25) {
    return { monster: null, matches: startsWith.map(([, m]) => m.name) };
  }

  const contains = entries.filter(([, m]) => normalize(m.name).includes(q));
  if (contains.length === 1) return { monster: contains[0][1], matches: [] };
  if (contains.length > 1) {
    const names = contains.map(([, m]) => m.name).sort();
    return { monster: null, matches: names.slice(0, 25), total: names.length };
  }

  return { monster: null, matches: [] };
}

module.exports = {
  findMonster,
};
