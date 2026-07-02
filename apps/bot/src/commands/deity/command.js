// ── commands/deity/command.js ───────────────────────────────────────────────
// /deity: look up a PF2e canonical deity by name, epithet, or area of concern.
//
// The lookup tries name → epithet → starts-with → contains → fuzzy in
// order. When multiple records match (e.g. Sarenrae from both Player Core
// and legacy CRB), `findDeity` already auto-picks the preferred edition.
//
// For ambiguous matches we render the candidate list with the same shape as
// /feat and /item — preview 20, "...and N more" if it overflows.

const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { deityDatabase } = require('../../reference/databases');
const { findDeity } = require('./lookup');
const { buildDeityEmbed, formatDeityMatchLine } = require('./embed');

async function execute(interaction) {
  const input = interaction.options.getString('name');
  const { deity, matches, exactDuplicates } = findDeity(input);

  if (deity) {
    return interaction.reply({ embeds: [buildDeityEmbed(deity)] });
  }

  if (matches && matches.length > 1) {
    const sorted = [...matches].sort((a, b) => a.name.localeCompare(b.name));
    const preview = sorted.slice(0, 20).map(formatDeityMatchLine).join('\n');
    const extra = sorted.length > 20 ? `\n*…and ${sorted.length - 20} more. Try narrowing your search.*` : '';
    const header = exactDuplicates
      ? `🔍 Multiple deities share the exact name **"${input}"**:`
      : `🔍 Multiple deities match **"${input}"**. Did you mean one of these?`;
    return interaction.reply({ content: `${header}\n${preview}${extra}`, ephemeral: true });
  }

  const names = Object.values(deityDatabase).map(d => d?.name).filter(Boolean);
  const hint = didYouMeanLine(input, names);
  return interaction.reply({
    content: `❌ No deity found for **"${input}"**.${hint || ' Check your spelling or try another name.'}`,
    ephemeral: true,
  });
}

module.exports = {
  name: 'deity',
  execute,
};
