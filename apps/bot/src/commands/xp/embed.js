// commands/xp/embed.js
// Embeds for /xp view, /xp history, /xp award, /xp set, and /xp reset.

const { EmbedBuilder } = require('discord.js');
const { xpToNextLevel, renderXpBar } = require('../../lib/format');
const { getCharacterXp } = require('../../state/characters');

function formatXpLogEntry(entry) {
  const amount = Number(entry?.amount ?? 0);
  const sign = amount >= 0 ? '+' : '';
  const date = entry?.at ? new Date(entry.at).toLocaleDateString() : 'unknown date';
  const reason = entry?.reason ? ` - ${entry.reason}` : '';
  const total = Number.isFinite(entry?.oldXp) && Number.isFinite(entry?.newXp)
    ? ` (${entry.oldXp} -> ${entry.newXp})`
    : '';
  const awarder = entry?.awardedBy ? ` by <@${entry.awardedBy}>` : '';
  return `\`${sign}${amount} XP\` *${date}*${total}${awarder}${reason}`;
}

// Build the main XP status embed. `note` adds a contextual message; `showLog`
// includes the last few XP awards.
function buildXpEmbed(char, charEntry, { note, showLog } = {}) {
  const xp = getCharacterXp(charEntry);
  const cap = xpToNextLevel();
  const currentSheetLevel = charEntry.data?.level ?? 1;
  const levelsEarnedSinceUpdate = Math.floor(xp / cap);
  const progress = xp % cap;
  const bar = renderXpBar(xp);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${char.name}'s Experience`)
    .setDescription(
      `\`${bar}\` **${progress} / ${cap}** XP this level\n` +
      `**Sheet Level:** ${currentSheetLevel}` +
      (levelsEarnedSinceUpdate > 0
        ? `\n**Ready to level up:** ${levelsEarnedSinceUpdate} time${levelsEarnedSinceUpdate === 1 ? '' : 's'} - level up in Pathbuilder, then \`/char update\``
        : ''
      ),
    );

  if (note) embed.addFields({ name: '\u200b', value: note, inline: false });

  if (showLog && Array.isArray(charEntry.xpLog) && charEntry.xpLog.length > 0) {
    const entries = charEntry.xpLog.slice(-5).reverse();
    const lines = entries.map(formatXpLogEntry);
    embed.addFields({ name: 'Recent Awards', value: lines.join('\n').slice(0, 1024), inline: false });
  }

  embed.setFooter({ text: '/xp award to add XP - /xp history for the full log - 1000 XP = level up' });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

function buildXpHistoryEmbed(char, charEntry) {
  const xp = getCharacterXp(charEntry);
  const cap = xpToNextLevel();
  const log = Array.isArray(charEntry.xpLog) ? charEntry.xpLog : [];
  const entries = log.slice(-25).reverse();
  const progress = xp % cap;
  const readyCount = Math.floor(xp / cap);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${char.name}'s XP History`)
    .setDescription(
      `Current XP: **${xp}** total, **${progress} / ${cap}** toward the next level` +
      (readyCount > 0 ? `\nReady to level up: **${readyCount}** time${readyCount === 1 ? '' : 's'}` : ''),
    );

  if (entries.length > 0) {
    embed.addFields({
      name: `Last ${entries.length} Award${entries.length === 1 ? '' : 's'}`,
      value: entries.map(formatXpLogEntry).join('\n').slice(0, 1024),
      inline: false,
    });
  } else {
    embed.addFields({ name: 'No XP awards logged yet', value: 'Use `/xp award` when this character earns XP.', inline: false });
  }

  embed.setFooter({ text: `Stored log entries: ${log.length} / 100` });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

function buildLevelUpEmbed(char, charEntry, oldXp, newXp) {
  const cap = xpToNextLevel();
  const newLevel = (charEntry.data?.level ?? 1) + Math.floor(newXp / cap);
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(`${char.name} leveled up!`)
    .setDescription(
      `**${char.name}** crossed ${cap} XP - they're ready to become **Level ${newLevel}**!\n\n` +
      `Level up in Pathbuilder, then run \`/char update\` to sync the new sheet. ` +
      `Use \`/xp reset character:${char.name}\` once the update is imported to reset progress toward the next level.`,
    )
    .addFields({
      name: 'XP',
      value: `${oldXp} -> **${newXp}**`,
      inline: true,
    });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

module.exports = { buildXpEmbed, buildXpHistoryEmbed, buildLevelUpEmbed };
