const { calcCharacterProfNum } = require('./pf2eMath');

function computeCharPerception(charEntry) {
  const c = charEntry.data;
  const lvl = c.level ?? 1;
  const wisMod = Math.floor(((c.abilities?.wis ?? 10) - 10) / 2);
  const profNum = c.proficiencies?.perception ?? 0;
  return wisMod + calcCharacterProfNum(c, profNum, lvl);
}

module.exports = {
  computeCharPerception,
};
