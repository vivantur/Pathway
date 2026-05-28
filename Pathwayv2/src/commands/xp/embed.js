// ── commands/xp/embed.js ────────────────────────────────────────────────────
// Embeds for /xp view, /xp award, /xp set, /xp reset, plus the celebratory
// level-up embed shown when an award crosses the 1000-XP threshold.

const { EmbedBuilder } = require('discord.js');
const { xpToNextLevel, renderXpBar } = require('../../lib/format');
const { getCharacterXp } = require('../../state/characters');

// Build the main XP status embed. `note` adds a contextual message; `showLog`
// includes the last 5 XP awards.
function buildXpEmbed(char, charEntry, { note, showLog } = {}) {
  const xp = getCharacterXp(charEntry);
  const cap = xpToNextLevel();
  const currentSheetLevel = charEntry.data?.level ?? 1;
  // "Levels earned" = number of 1000-XP thresholds crossed since the last
  // /char update. The bot doesn't auto-level the sheet — it just tracks XP
  // and prompts the player to level up in Pathbuilder.
  const levelsEarnedSinceUpdate = Math.floor(xp / cap);
  const progress = xp % cap;
  const bar = renderXpBar(xp);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`⭐ ${char.name}'s Experience`)
    .setDescription(
      `\`${bar}\` **${progress} / ${cap}** XP this level\n` +
      `**Sheet Level:** ${currentSheetLevel}` +
      (levelsEarnedSinceUpdate > 0
        ? `\n**Ready to level up:** ${levelsEarnedSinceUpdate} time${levelsEarnedSinceUpdate === 1 ? '' : 's'} — level up in Pathbuilder, then \`/char update\``
        : ''
      ),
    );

  if (note) embed.addFields({ name: '​', value: note, inline: false });

  if (showLog && Array.isArray(charEntry.xpLog) && charEntry.xpLog.length > 0) {
    const entries = charEntry.xpLog.slice(-5).reverse();
    const lines = entries.map(e => {
      const sign = e.amount >= 0 ? '+' : '';
      const date = e.at ? new Date(e.at).toLocaleDateString() : '';
      const reason = e.reason ? ` — ${e.reason}` : '';
      return `\`${sign}${e.amount} XP\` *(${date})*${reason}`;
    });
    embed.addFields({ name: '📜 Recent Awards', value: lines.join('\n').slice(0, 1024), inline: false });
  }

  embed.setFooter({ text: '/xp award to give XP · /xp view character:<name> · 1000 XP = level up' });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

// Celebratory embed shown after a level-up threshold crossing.
function buildLevelUpEmbed(char, charEntry, oldXp, newXp) {
  const cap = xpToNextLevel();
  const newLevel = (charEntry.data?.level ?? 1) + Math.floor(newXp / cap);
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(`🎉 ${char.name} leveled up!`)
    .setDescription(
      `**${char.name}** crossed ${cap} XP — they're ready to become **Level ${newLevel}**!\n\n` +
      `Level up in Pathbuilder, then run \`/char update\` to sync the new sheet. ` +
      `Use \`/xp set character:${char.name} amount:0\` once the update is imported to reset progress toward the next level.`,
    )
    .addFields({
      name: 'XP',
      value: `${oldXp} → **${newXp}**`,
      inline: true,
    });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

module.exports = { buildXpEmbed, buildLevelUpEmbed };
