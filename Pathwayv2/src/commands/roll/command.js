const { EmbedBuilder } = require('discord.js');

const characterState = require('../../state/characters');
const snippetState = require('../../state/snippets');
const { rollAdvanced } = require('../../rules/advancedRoll');

function mergedSnippetsFor(userId, guildId) {
  const personal = snippetState.getAllUser()[userId] ?? {};
  const server = guildId ? (snippetState.getAllGuild()[guildId] ?? {}) : {};
  return { ...server, ...personal };
}

async function execute(interaction) {
  const raw = interaction.options.getString('dice');
  const snippets = mergedSnippetsFor(interaction.user.id, interaction.guildId);

  const charNameArg = interaction.options.getString('character');
  const characters = characterState.getAll();
  let charEntry = null;
  const userChars = characters[interaction.user.id] ?? {};
  if (Object.keys(userChars).filter(key => !key.startsWith('_')).length > 0) {
    const resolved = characterState.resolveChar(interaction.user.id, charNameArg, characters);
    if (!resolved.error) charEntry = resolved.char;
  }

  const result = rollAdvanced(raw, snippets, charEntry);
  if (result.error) return interaction.reply({ content: `\u274c ${result.error}`, ephemeral: true });

  const lines = result.iterations.map((iter, index) =>
    result.iterations.length > 1
      ? `**${index + 1}.** ${iter.breakdown} = **${iter.total}**`
      : `${iter.breakdown} = **${iter.total}**`
  );
  let description = lines.join('\n');
  if (result.summary) description += `\n\n${result.summary}`;
  if (result.warnings?.length) {
    description += '\n\n\u26a0\ufe0f ' + result.warnings.join('\n\u26a0\ufe0f ');
  }

  const expandedChanged = result.expanded.trim() !== raw.trim();
  const embed = new EmbedBuilder()
    .setColor(0x7289DA)
    .setTitle(`\ud83c\udfb2 ${raw}`)
    .setDescription(description);

  if (charEntry?.art) embed.setThumbnail(charEntry.art);
  const footerParts = [charEntry?.data?.name ?? charEntry?.name ?? charNameArg ?? interaction.user.username];
  if (expandedChanged) footerParts.push(`Expanded: ${result.expanded}`);
  embed.setFooter({ text: footerParts.join(' \u00b7 ') });

  return interaction.reply({ embeds: [embed] });
}

module.exports = {
  name: 'roll',
  execute,
};
