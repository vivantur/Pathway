// ── commands/eberron/command.js ─────────────────────────────────────────────
// /eberron: campaign-setting lookups for an Eberron PF2e game.
//
// Two subcommands today:
//   • /eberron house  — the 13 Dragonmarked Houses
//   • /eberron deity  — the Sovereign Host, Dark Six, etc.
//
// /eberron deity reuses /deity's embed builder + match-line formatter
// because the data shape is identical. The cross-feature import lives at
// the top of this file so the contract between the two commands is visible
// at a glance.

const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const {
  eberronHouseDatabase,
  eberronDeityDatabase,
} = require('../../reference/databases');
const { findEberronHouse } = require('./houseLookup');
const { findEberronDeity } = require('./deityLookup');
const { buildEberronHouseEmbed, formatEberronHouseMatchLine } = require('./houseEmbed');
// /eberron deity rides on /deity's embed contract — same data shape.
const { buildDeityEmbed, formatDeityMatchLine } = require('../deity/embed');

async function executeHouseSub(interaction) {
  const input = interaction.options.getString('name');
  const { house, matches } = findEberronHouse(input);

  if (house) {
    return interaction.reply({ embeds: [buildEberronHouseEmbed(house)] });
  }

  if (matches && matches.length > 1) {
    const preview = matches
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20)
      .map(formatEberronHouseMatchLine)
      .join('\n');
    return interaction.reply({
      content: `Multiple Eberron houses match **"${input}"**. Did you mean one of these?\n${preview}`,
      ephemeral: true,
    });
  }

  const names = eberronHouseDatabase.map(h => h.name);
  const hint = didYouMeanLine(input, names);
  return interaction.reply({
    content: `No Eberron house found for **"${input}"**.${hint || ' Try a house name, dragonmark, or service.'}`,
    ephemeral: true,
  });
}

async function executeDeitySub(interaction) {
  const input = interaction.options.getString('name');
  const { deity, matches } = findEberronDeity(input);

  if (deity) {
    return interaction.reply({ embeds: [buildDeityEmbed(deity)] });
  }

  if (matches && matches.length > 1) {
    const preview = matches
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20)
      .map(formatDeityMatchLine)
      .join('\n');
    return interaction.reply({
      content: `Multiple Eberron deities or faiths match **"${input}"**. Did you mean one of these?\n${preview}`,
      ephemeral: true,
    });
  }

  const names = eberronDeityDatabase.map(d => d.name);
  const hint = didYouMeanLine(input, names);
  return interaction.reply({
    content: `No Eberron deity or faith found for **"${input}"**.${hint || ' Try a deity, faith, pantheon, or alias.'}`,
    ephemeral: true,
  });
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'house') return executeHouseSub(interaction);
  if (sub === 'deity') return executeDeitySub(interaction);
  return interaction.reply({
    content: 'Unknown Eberron lookup. Try `/eberron house` or `/eberron deity`.',
    ephemeral: true,
  });
}

module.exports = {
  name: 'eberron',
  execute,
};
