// ── commands/background/embed.js ────────────────────────────────────────────
// /background's result embed: ability boosts, rarity, PFS availability,
// trained skills, granted feats.

const { EmbedBuilder } = require('discord.js');

function buildBackgroundEmbed(bg) {
  const rarityColor = { Common: 0x4a90d9, Uncommon: 0xc45f00, Rare: 0x6b21a8, Unique: 0x8b0000 };
  const rarityEmoji = { Common: '⚪', Uncommon: '🟠', Rare: '🟣', Unique: '🔴' };
  const emoji = rarityEmoji[bg.rarity] ?? '📜';

  const boosts = bg.ability_boosts?.length
    ? bg.ability_boosts.join(' or ')
    : '*Choose any two (free)*';
  const skills = bg.trained_skills?.length
    ? bg.trained_skills.map(s => `• ${s}`).join('\n')
    : '*None specified*';
  const feats = bg.granted_feats?.length
    ? bg.granted_feats.map(f => `✨ ${f}`).join('\n')
    : '*None*';

  return new EmbedBuilder()
    .setColor(rarityColor[bg.rarity] ?? 0x4a90d9)
    .setTitle(`${emoji} ${bg.name}`)
    .setDescription(bg.summary || '*No summary available.*')
    .addFields(
      { name: '💪 Ability Boosts',  value: boosts, inline: true },
      { name: '🏅 Rarity',           value: bg.rarity ?? 'Common', inline: true },
      { name: '🎫 PFS',              value: bg.pfs_availability ?? 'Unknown', inline: true },
      { name: '🎓 Trained Skills',   value: skills, inline: false },
      { name: '🎯 Granted Feat',     value: feats,  inline: false },
    )
    .setFooter({ text: `Source: ${bg.source ?? 'Unknown'} • PF2e Background Lookup` });
}

module.exports = { buildBackgroundEmbed };
