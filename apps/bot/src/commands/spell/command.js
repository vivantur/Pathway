const { findSpell, spellAmbiguityMessage } = require('./lookup');
const { buildSpellEmbed } = require('./embed');

async function execute(interaction) {
  await interaction.deferReply();
  const spell = findSpell(interaction.options.getString('name'));
  if (spell?.ambiguous) return interaction.editReply(spellAmbiguityMessage(spell));
  if (!spell) return interaction.editReply('Couldn\'t find that spell. Check the spelling and try again!');
  return interaction.editReply({ embeds: [buildSpellEmbed(spell)] });
}

module.exports = {
  name: 'spell',
  execute,
};
