// ── commands/archetype/embed.js ─────────────────────────────────────────────
// Render an archetype as a single embed.
//
// Two archetype "types" exist in PF2e: regular archetypes and multiclass
// archetypes (which grant abilities from another class). We surface that
// with a different glyph and label, but everything else renders identically.

const { EmbedBuilder } = require('discord.js');

const RARITY_COLOR = {
  Common:   0x4a90d9, // blue
  Uncommon: 0xc45f00, // orange-brown
  Rare:     0x6b21a8, // purple
};

function buildArchetypeEmbed(archetype) {
  const isMulticlass = archetype.type === 'multiclass';
  const typeEmoji = isMulticlass ? '🔀' : '📖';
  const typeLabel = isMulticlass ? 'Multiclass Archetype' : 'Archetype';
  const rarityLabel = archetype.rarity && archetype.rarity !== 'Common' ? ` • ${archetype.rarity}` : '';

  const embed = new EmbedBuilder()
    .setColor(RARITY_COLOR[archetype.rarity] ?? 0x4a90d9)
    .setTitle(`${typeEmoji} ${archetype.name}`)
    .setDescription(archetype.description || '*No description available.*')
    .addFields(
      { name: '📋 Type',            value: `${typeLabel}${rarityLabel}`, inline: true },
      { name: '🎯 Dedication Feat', value: `Feat ${archetype.dedication_level}`, inline: true },
      { name: '📚 Source',          value: archetype.source || 'Unknown', inline: true },
    );

  if (archetype.prerequisites) {
    embed.addFields({ name: '⚠️ Prerequisites', value: archetype.prerequisites, inline: false });
  }

  embed.setFooter({ text: 'Pathway • PF2e Archetype Lookup' });
  return embed;
}

module.exports = { buildArchetypeEmbed };
