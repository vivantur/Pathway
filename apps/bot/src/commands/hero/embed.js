const { EmbedBuilder } = require('discord.js');

const HERO_POINTS_MAX = 3;
const HERO_POINTS_DEFAULT = 1;

function getHeroPoints(charEntry) {
  return charEntry.heroPoints ?? HERO_POINTS_DEFAULT;
}

function renderHeroPointsBar(points) {
  const filled = Math.min(points, HERO_POINTS_MAX);
  const empty = Math.max(0, HERO_POINTS_MAX - points);
  const overflow = points > HERO_POINTS_MAX ? ` **+${points - HERO_POINTS_MAX}**` : '';
  return '\u25C6'.repeat(filled) + '\u25C7'.repeat(empty) + overflow;
}

function buildHeroPointsEmbed(char, charEntry, note = null) {
  const points = getHeroPoints(charEntry);
  const bar = renderHeroPointsBar(points);
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`\u2B50 ${char.name}'s Hero Points`)
    .setDescription(`${bar}\n**${points}** / ${HERO_POINTS_MAX}${points > HERO_POINTS_MAX ? ' *(over cap)*' : ''}`)
    .setFooter({ text: 'Spend 1 to reroll (keep higher) · Spend all to avoid death · Max 3' });

  if (note) embed.addFields({ name: '\u200b', value: note, inline: false });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

module.exports = {
  HERO_POINTS_MAX,
  HERO_POINTS_DEFAULT,
  getHeroPoints,
  renderHeroPointsBar,
  buildHeroPointsEmbed,
};
