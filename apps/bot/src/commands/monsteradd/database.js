const { bestiaryDatabase } = require('../../reference/databases');

function addMonsterToBestiary(entry, slug) {
  let finalSlug = slug;
  let counter = 2;
  while (bestiaryDatabase[finalSlug]) {
    finalSlug = `${slug}_${counter}`;
    counter++;
  }
  bestiaryDatabase[finalSlug] = entry;
  return finalSlug;
}

function removeMonsterFromBestiary(slugOrName) {
  if (bestiaryDatabase[slugOrName]) {
    const removed = bestiaryDatabase[slugOrName];
    delete bestiaryDatabase[slugOrName];
    return { removed: true, key: slugOrName, name: removed.name };
  }
  const normalize = s => String(s ?? '').toLowerCase().trim();
  const match = Object.entries(bestiaryDatabase).find(([, m]) => normalize(m.name) === normalize(slugOrName));
  if (match) {
    delete bestiaryDatabase[match[0]];
    return { removed: true, key: match[0], name: match[1].name };
  }
  return { removed: false };
}

module.exports = {
  addMonsterToBestiary,
  removeMonsterFromBestiary,
};
