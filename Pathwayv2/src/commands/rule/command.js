const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { rulesDatabase } = require('../../reference/databases');
const { findRule, buildRuleEmbed } = require('../../reference/rulesLookup');

function allRuleNames() {
  const names = [];
  for (const category of Object.values(rulesDatabase)) {
    if (category && typeof category === 'object' && !Array.isArray(category)) {
      for (const rule of Object.values(category)) {
        if (rule?.name) names.push(rule.name);
      }
    }
  }
  return names;
}

async function execute(interaction) {
  const input = interaction.options.getString('name');
  const { rule, matches } = findRule(input);

  if (!rule && matches.length > 1) {
    const nameList = matches.map(r => `${r.name} *(${r.category})*`).sort().join('\n');
    return interaction.reply({
      content: `\uD83D\uDD0D Multiple entries match **"${input}"**:\n${nameList}`,
      ephemeral: true,
    });
  }

  if (!rule) {
    const hint = didYouMeanLine(input, allRuleNames());
    return interaction.reply({
      content: `❌ No rule found for **"${input}"**.${hint}\nTry a **condition** (e.g. frightened, prone), **action** (e.g. stride, grapple), or **trait** (e.g. agile, finesse).`,
      ephemeral: true,
    });
  }

  return interaction.reply({ embeds: [buildRuleEmbed(rule)] });
}

module.exports = {
  name: 'rule',
  execute,
};
