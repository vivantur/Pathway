const { EmbedBuilder } = require('discord.js');

const characterState = require('../../state/characters');
const { buildCharacterAbilitiesFields } = require('../feats/fields');

async function execute(interaction) {
  const characters = characterState.getAll();
  const nameArg = interaction.options.getString('character');
  const { error, char: charEntry } = characterState.resolveChar(interaction.user.id, nameArg, characters);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const c = charEntry.data ?? {};
  const abilitiesView = buildCharacterAbilitiesFields(charEntry);
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`${c.name ?? charEntry.name}'s Abilities`)
    .setDescription(abilitiesView.description)
    .setFooter({ text: 'Pathway character abilities' });

  if (abilitiesView.fields.length > 0) {
    embed.addFields(abilitiesView.fields);
  } else {
    embed.addFields({ name: 'Special Abilities', value: 'No special abilities saved yet.', inline: false });
  }
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return interaction.reply({ embeds: [embed] });
}

module.exports = {
  name: 'abilities',
  execute,
};
