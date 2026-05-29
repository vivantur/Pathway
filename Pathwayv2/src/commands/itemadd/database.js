// Item database mutation helpers for /itemadd.
const { itemDatabase } = require('../../reference/databases');
const { toSlug: itemSlug } = require('../../parsers/itemParser');

function addItemToDatabase(entry) {
  const normalize = s => String(s ?? '').toLowerCase().trim();
  let finalName = entry.name;
  let finalId = entry.id;
  let counter = 1;
  while (itemDatabase.some(i => normalize(i.name) === normalize(finalName) || i.id === finalId)) {
    counter++;
    finalName = counter === 2 ? `${entry.name} (Homebrew)` : `${entry.name} (Homebrew ${counter})`;
    finalId = `${entry.id}-homebrew${counter === 2 ? '' : '-' + counter}`;
  }
  entry.name = finalName;
  entry.id = finalId;
  entry.lookup_name = finalName.toLowerCase();
  itemDatabase.push(entry);
  return finalName;
}

function removeItemFromDatabase(nameOrSlug) {
  const normalize = s => String(s ?? '').toLowerCase().trim();
  const q = normalize(nameOrSlug);
  const idx = itemDatabase.findIndex(i =>
    normalize(i.name) === q || i.id === nameOrSlug || normalize(i.lookup_name) === q
  );
  if (idx < 0) return { removed: false };
  const removed = itemDatabase[idx];
  if (!removed._homebrew) {
    return { removed: false, protected: true, name: removed.name };
  }
  itemDatabase.splice(idx, 1);
  return { removed: true, name: removed.name, entryKey: removed.id || itemSlug(removed.name) };
}

module.exports = {
  addItemToDatabase,
  removeItemFromDatabase,
};
