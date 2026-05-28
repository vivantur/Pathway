// ── commands/condition/command.js ───────────────────────────────────────────
// /condition: look up a PF2e condition by name.
//
// Conditions live in `rulesDatabase.Conditions` (loaded at startup from
// Supabase gamedata). This command filters findRule's results to only
// `category === 'condition'` so a query like "grabbed" doesn't surface
// other matching rules. The "did you mean?" hint pulls from just the
// Conditions namespace.

const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { findRule, buildRuleEmbed } = require('../../reference/rulesLookup');
const { rulesDatabase } = require('../../reference/databases');

async function execute(interaction) {
  const input = interaction.options.getString('name');
  const { rule, matches } = findRule(input);
  const isCondition = r => r?.category === 'condition';

  if (rule && isCondition(rule)) {
    return interaction.reply({ embeds: [buildRuleEmbed(rule)] });
  }

  // Filter ambiguous matches down to just conditions.
  const conditionMatches = matches.filter(isCondition);
  if (conditionMatches.length === 1) {
    return interaction.reply({ embeds: [buildRuleEmbed(conditionMatches[0])] });
  }
  if (conditionMatches.length > 1) {
    const nameList = conditionMatches.map(r => r.name).sort().join(', ');
    return interaction.reply({ content: `🔍 Multiple conditions match **"${input}"**: ${nameList}`, ephemeral: true });
  }

  // Build a "did you mean?" hint from just the Conditions category.
  const allConditions = Object.values(rulesDatabase.Conditions ?? {})
    .map(c => c.name)
    .filter(Boolean)
    .sort();
  const hint = didYouMeanLine(input, allConditions) ||
    `\nTry one of: ${allConditions.slice(0, 8).join(', ')}, ...`;

  return interaction.reply({
    content: `❌ No condition found for **"${input}"**.${hint}`,
    ephemeral: true,
  });
}

module.exports = {
  name: 'condition',
  execute,
};
