const { spellDatabase } = require('../../reference/databases');

function addSpellToDatabase(entry) {
  const normalize = s => String(s ?? '').toLowerCase().trim();
  let finalName = entry.name;
  let counter = 1;
  while (spellDatabase.some(s => normalize(s.name) === normalize(finalName))) {
    counter++;
    finalName = counter === 2 ? `${entry.name} (Homebrew)` : `${entry.name} (Homebrew ${counter})`;
  }
  entry.name = finalName;
  spellDatabase.push(entry);
  return finalName;
}

function removeSpellFromDatabase(nameOrSlug) {
  const normalize = s => String(s ?? '').toLowerCase().trim();
  const q = normalize(nameOrSlug);
  const idx = spellDatabase.findIndex(s => normalize(s.name) === q);
  if (idx < 0) return { removed: false };
  const removed = spellDatabase[idx];
  if (!removed._homebrew) {
    return { removed: false, protected: true, name: removed.name };
  }
  spellDatabase.splice(idx, 1);
  return { removed: true, name: removed.name };
}

module.exports = {
  addSpellToDatabase,
  removeSpellFromDatabase,
};
