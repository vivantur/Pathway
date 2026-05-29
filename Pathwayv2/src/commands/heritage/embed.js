// ── commands/heritage/embed.js ──────────────────────────────────────────────
// Render a heritage as a single embed. Versatile heritages get a prominent
// note at the top so users understand they apply to any ancestry, not just
// one. Color uses the ancestry palette so /heritage and /ancestry stay
// visually consistent.

const { EmbedBuilder } = require('discord.js');
const { ANCESTRY_COLORS } = require('../ancestry/colors');

function buildHeritageEmbed(heritage) {
  const embed = new EmbedBuilder()
    .setTitle(`◈ ${heritage.name}`)
    .setColor(ANCESTRY_COLORS?.heritage ?? 0x8B4513);

  // Top metadata line: versatile flag, ancestry tag, rarity, remaster.
  const metaParts = [];
  if (heritage.is_versatile) {
    metaParts.push('**Versatile Heritage** *(applies to any ancestry)*');
  } else if (heritage.ancestry_display) {
    metaParts.push(`**${heritage.ancestry_display}** heritage`);
  }
  if (heritage.rarity && heritage.rarity !== 'common') {
    metaParts.push(`*${heritage.rarity.charAt(0).toUpperCase() + heritage.rarity.slice(1)}*`);
  }
  if (heritage.remaster) metaParts.push('*Remastered*');

  // Description: discord embed body limit is 4096 chars. Heritages are
  // typically <500 chars, but truncate just in case.
  let desc = heritage.description || '*No description available.*';
  if (desc.length > 3800) desc = desc.slice(0, 3800) + '\n\n*…(truncated)*';
  const fullDesc = metaParts.length
    ? `${metaParts.join(' · ')}\n\n${desc}`
    : desc;
  embed.setDescription(fullDesc);

  // Traits chip-line — strip rarity tags since those are already in metaParts.
  const interestingTraits = (heritage.traits ?? []).filter(t =>
    t && !['common', 'uncommon', 'rare', 'unique'].includes(String(t).toLowerCase())
  );
  if (interestingTraits.length) {
    embed.addFields({
      name: 'Traits',
      value: interestingTraits.map(t => `\`${t}\``).join(' '),
      inline: false,
    });
  }

  embed.setFooter({ text: `Source: ${heritage.source}` });
  return embed;
}

module.exports = { buildHeritageEmbed };
