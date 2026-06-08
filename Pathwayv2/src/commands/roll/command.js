const { EmbedBuilder } = require('discord.js');

const snippetState = require('../../state/snippets');
const { rollAdvanced } = require('../../rules/advancedRoll');
const {
  PATHWAY_DICE_REF,
  PATHWAY_DICE_BUFFER,
  rollFallbackFiles,
} = require('../../discord/rollEmbeds');

function mergedSnippetsFor(userId, guildId) {
  const personal = snippetState.getAllUser()[userId] ?? {};
  const server = guildId ? (snippetState.getAllGuild()[guildId] ?? {}) : {};
  return { ...server, ...personal };
}

async function execute(interaction) {
  const raw = interaction.options.getString('dice');
  const snippets = mergedSnippetsFor(interaction.user.id, interaction.guildId);

  const result = rollAdvanced(raw, snippets, null);
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

  if (PATHWAY_DICE_BUFFER) embed.setThumbnail(PATHWAY_DICE_REF);
  if (expandedChanged) embed.setFooter({ text: `Expanded: ${result.expanded}` });

  return interaction.reply({ embeds: [embed], files: rollFallbackFiles(null) });
}

module.exports = {
  name: 'roll',
  execute,
};
