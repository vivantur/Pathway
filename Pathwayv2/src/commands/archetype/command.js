// ── commands/archetype/command.js ───────────────────────────────────────────
// /archetype: look up a PF2e archetype by slug or substring.
//
// Ambiguous matches return slugs (the object keys), not display names. We
// surface them comma-joined so the user can copy/paste the exact one they
// want. The "did you mean?" hint pulls from display names — a different
// surface than the ambiguity list, but the right one for typo correction.

const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { archetypeDatabase } = require('../../reference/databases');
const { findArchetype } = require('./lookup');
const { buildArchetypeEmbed } = require('./embed');

async function execute(interaction) {
  const input = interaction.options.getString('name');
  const { archetype, matches } = findArchetype(input);

  if (!archetype && matches.length > 1) {
    return interaction.reply({
      content: `🔍 Multiple archetypes match **"${input}"**. Did you mean one of these?\n**${matches.sort().join(', ')}**`,
      ephemeral: true,
    });
  }
  if (!archetype) {
    const names = Object.values(archetypeDatabase).map(a => a?.name).filter(Boolean);
    const hint = didYouMeanLine(input, names);
    return interaction.reply({
      content: `❌ No archetype found for **"${input}"**.${hint || ' Check your spelling or try another name.'}`,
      ephemeral: true,
    });
  }

  return interaction.reply({ embeds: [buildArchetypeEmbed(archetype)] });
}

module.exports = {
  name: 'archetype',
  execute,
};
