// ── commands/background/command.js ──────────────────────────────────────────
// /background: look up a PF2e background by name.
//
// Backgrounds are stored in `backgroundDatabase` keyed by slug; the lookup
// matches on slug, exact name, or partial substring. Ambiguous matches
// return a list of candidates the user can disambiguate.

const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { backgroundDatabase } = require('../../reference/databases');
const { findBackground } = require('./lookup');
const { buildBackgroundEmbed } = require('./embed');

async function execute(interaction) {
  const input = interaction.options.getString('name');
  const { background, matches } = findBackground(input);
  if (!background && matches.length > 1) {
    const preview = matches.sort().slice(0, 25).join(', ');
    const extra = matches.length > 25 ? ` *(+${matches.length - 25} more)*` : '';
    return interaction.reply({ content: `🔍 Multiple backgrounds match **"${input}"**. Did you mean one of these?\n**${preview}**${extra}`, ephemeral: true });
  }
  if (!background) {
    const names = Object.values(backgroundDatabase).map(b => b?.name).filter(Boolean);
    const hint = didYouMeanLine(input, names);
    return interaction.reply({
      content: `❌ No background found for **"${input}"**.${hint || ' Check your spelling or try another name.'}`,
      ephemeral: true,
    });
  }
  return interaction.reply({ embeds: [buildBackgroundEmbed(background)] });
}

module.exports = {
  name: 'background',
  execute,
};
