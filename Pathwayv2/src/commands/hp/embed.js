// ── commands/hp/embed.js ────────────────────────────────────────────────────
// The HP-status embed used by /hp view / set / add / reset / max.
//
// Renders a colored 10-segment bar plus a status emoji (Healthy / Injured /
// Bloodied / Critical / Down) sized to current/max ratio. An optional `note`
// argument is appended as an embed field — handlers use it to describe what
// just happened ("Took 5 damage", "Cleared max HP override", etc.).
//
// Imported by /hp and by the other commands that render an HP card (/rest,
// /init hp, and some inline status notifications in index.js).

const { EmbedBuilder } = require('discord.js');
const { getCharacterHp, computeCharMaxHp } = require('../../state/characters');

function buildCharHpEmbed(char, charEntry, note = null) {
  const maxHp = computeCharMaxHp(charEntry);
  const currentHp = getCharacterHp(charEntry);
  const pct = maxHp > 0 ? currentHp / maxHp : 0;
  // 10-segment HP bar
  const segments = 10;
  const filled = Math.max(currentHp > 0 ? 1 : 0, Math.round(pct * segments));
  const bar = '█'.repeat(filled) + '░'.repeat(segments - filled);
  // Pick a color based on how hurt they are
  const color = pct <= 0 ? 0x8B0000 : pct <= 0.25 ? 0xe74c3c : pct <= 0.5 ? 0xe67e22 : pct < 1 ? 0xf1c40f : 0x2ecc71;
  const status = pct <= 0 ? '💀 Down!' : pct <= 0.25 ? '🔴 Critical' : pct <= 0.5 ? '🟠 Bloodied' : pct < 1 ? '🟡 Injured' : '🟢 Healthy';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`❤️ ${char.name}'s Hit Points`)
    .setDescription(`\`${bar}\`\n**${currentHp} / ${maxHp}** HP · *${status}*`);
  if (note) embed.addFields({ name: '​', value: note, inline: false });
  embed.setFooter({ text: '/hp set, /hp add, /hp max, /rest to restore · Combat uses /init hp' });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

module.exports = { buildCharHpEmbed };
