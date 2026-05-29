const { EmbedBuilder } = require('discord.js');

const { isDeadInteractionError } = require('../../lib/discordErrors');

async function execute(interaction) {
  try {
    await interaction.deferReply();
    const title = interaction.options.getString('title');
    if (!title) {
      return interaction.editReply('```\n\u200b\n```');
    }

    const pageHolder = new EmbedBuilder()
      .setColor(0x1f1d36)
      .setDescription(`**${title}**`);

    return interaction.editReply({ embeds: [pageHolder] });
  } catch (err) {
    if (!isDeadInteractionError(err)) {
      console.error('/br error:', err);
    }

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('\u274c Something went wrong with /br. Try again.');
      }
    } catch {}
  }
}

module.exports = {
  name: 'br',
  execute,
};
