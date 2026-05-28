// ── commands/heritage/command.js ────────────────────────────────────────────
// /heritage: look up one of the 322 PF2e heritages by name.
//
// Includes ancestry-specific heritages (Anvil Dwarf, Tundra Halfling) and
// versatile/planar heritages (Aiuvarin, Nephilim, Dhampir) that apply on
// top of any ancestry. The "did you mean?" hint pulls from all heritage
// names; the not-found message also reminds the user that autocomplete is
// the easiest way to browse 322 entries.

const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { heritageDatabase } = require('../../reference/databases');
const { findHeritage } = require('./lookup');
const { buildHeritageEmbed } = require('./embed');

async function execute(interaction) {
  const input = interaction.options.getString('name');
  const heritage = findHeritage(input);
  if (!heritage) {
    const allNames = Object.values(heritageDatabase).map(h => h?.name).filter(Boolean);
    const hint = didYouMeanLine(input, allNames);
    return interaction.reply({
      content: `❌ No heritage found for **"${input}"**.${hint || ''}\n*Tip: there are 322 heritages, including 17 versatile (planar) heritages like Aiuvarin or Dhampir. Use autocomplete to browse.*`,
      ephemeral: true,
    });
  }
  return interaction.reply({ embeds: [buildHeritageEmbed(heritage)] });
}

module.exports = {
  name: 'heritage',
  execute,
};
