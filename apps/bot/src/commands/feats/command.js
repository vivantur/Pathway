const { EmbedBuilder } = require('discord.js');

const characterState = require('../../state/characters');
const { buildCharacterFeatsFields } = require('./fields');

async function execute(interaction) {
  const characters = characterState.getAll();
  const nameArg = interaction.options.getString('character');
  const { error, char: charEntry } = characterState.resolveChar(interaction.user.id, nameArg, characters);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const c = charEntry.data ?? {};
  const featsView = buildCharacterFeatsFields(charEntry);
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`${c.name ?? charEntry.name}'s Feats`)
    .setDescription(featsView.description)
    .addFields(featsView.fields)
    .setFooter({ text: 'Pathway character feats' });

  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return interaction.reply({ embeds: [embed] });
}

module.exports = {
  name: 'feats',
  execute,
};
