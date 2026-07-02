const { computeCharSkillModifier } = require('./pf2eMath');

function computeCharPerception(charEntry) {
  const statOverride = charEntry.edits?.stats?.perception;
  if (typeof statOverride === 'number') return statOverride;
  return computeCharSkillModifier(charEntry, 'perception')?.modifier ?? 0;
}

module.exports = {
  computeCharPerception,
};
