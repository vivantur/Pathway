// ── commands/ancestry/command.js ────────────────────────────────────────────
// /ancestry: three-page lookup for a PF2e ancestry.
//
// The initial reply renders the Core page (stats + parsed description) with a
// three-button pager underneath. Subsequent clicks go through the button
// handler in ./buttons.js, which updates the same message in-place.

const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { ancestryDatabase } = require('../../reference/databases');
const { findAncestry } = require('./lookup');
const { buildAncestryCorePage } = require('./embed');
const { buildAncestryButtons } = require('./buttons');

async function execute(interaction) {
  const input = interaction.options.getString('name');
  const resolved = findAncestry(input);
  const key = resolved?.key;
  const ancestry = resolved?.ancestry;
  if (!ancestry) {
    const names = Object.values(ancestryDatabase).map(a => a?.name).filter(Boolean);
    const hint = didYouMeanLine(input, names);
    const available = Object.entries(ancestryDatabase)
      .filter(([, a]) => a?.name)
      .map(([key]) => key)
      .join(', ');
    return interaction.reply({
      content: `❌ No ancestry found for **"${input}"**.${hint || ` Available: ${available}`}`,
      ephemeral: true,
    });
  }
  return interaction.reply({
    embeds: [buildAncestryCorePage(ancestry)],
    components: [buildAncestryButtons(0, key, ancestry)],
  });
}

module.exports = {
  name: 'ancestry',
  execute,
};
