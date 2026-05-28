// ── commands/item/command.js ────────────────────────────────────────────────
// /item: look up a PF2e item by name, optionally constrained to a level.
//
// Mirrors /feat's flow with one nuance: when the dataset has multiple
// editions of the same item (Player Core vs legacy CRB), `findItem` already
// picked the preferred edition for us. We just render it — the user gets
// the canonical version without an extra disambiguation step.
//
// When matches are genuinely ambiguous (different items, not just editions
// of the same one), we show the candidate list — preview 20, "...and N more"
// for the rest.

const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { itemDatabase } = require('../../reference/databases');
const { findItem } = require('./lookup');
const { buildItemEmbed } = require('./embed');

// Pure formatter for one row of the ambiguity-list. Local because it's
// only used here and isn't part of the main embed.
function formatItemMatchLine(item) {
  const lvl = item.level != null ? ` *(Lvl ${item.level})*` : '';
  const cat = item.category ? ` — ${item.category}` : '';
  return `• **${item.name}**${lvl}${cat}`;
}

async function execute(interaction) {
  const input = interaction.options.getString('name');
  const levelFilter = interaction.options.getInteger('level') ?? null;
  const { item, matches, exactDuplicates } = findItem(input, levelFilter);

  if (item) {
    return interaction.reply({ embeds: [buildItemEmbed(item)] });
  }

  if (matches && matches.length > 1) {
    const sorted = [...matches].sort((a, b) =>
      a.name.localeCompare(b.name) || (a.level ?? 0) - (b.level ?? 0)
    );
    const preview = sorted.slice(0, 20).map(formatItemMatchLine).join('\n');
    const extra = sorted.length > 20 ? `\n*…and ${sorted.length - 20} more. Try narrowing your search.*` : '';
    const header = exactDuplicates
      ? `🔍 Multiple items share the exact name **"${input}"**. Add a level to narrow it down:`
      : `🔍 Multiple items match **"${input}"**. Did you mean one of these?`;
    return interaction.reply({ content: `${header}\n${preview}${extra}`, ephemeral: true });
  }

  const levelMsg = levelFilter != null ? ` at level ${levelFilter}` : '';
  const names = itemDatabase.map(i => i?.name).filter(Boolean);
  const hint = didYouMeanLine(input, names);
  return interaction.reply({
    content: `❌ No item found for **"${input}"**${levelMsg}.${hint || ' Check your spelling or try another name.'}`,
    ephemeral: true,
  });
}

module.exports = {
  name: 'item',
  execute,
};
