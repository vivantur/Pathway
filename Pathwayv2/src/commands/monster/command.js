const { bestiaryDatabase } = require('../../reference/databases');
const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { buildMonsterEmbed } = require('./embed');
const { findMonster } = require('./lookup');
const {
  lookupMonsterArt,
  getMonsterEdit,
  applyMonsterEdits,
  applyMonsterAttackLibrary,
} = require('./helpers');

async function execute(interaction) {
  const input = interaction.options.getString('name');
  const { monster, matches, total } = findMonster(input);

  if (monster) {
    const edits = getMonsterEdit(interaction.guildId, monster.name);
    const edited = applyMonsterEdits(monster, edits);
    const withLibrary = applyMonsterAttackLibrary(edited, interaction.guildId);
    const artUrl = lookupMonsterArt(interaction.guildId, monster);
    return interaction.reply({ embeds: [buildMonsterEmbed(withLibrary, artUrl)] });
  }

  if (matches && matches.length > 1) {
    const sorted = [...matches].sort((a, b) => a.localeCompare(b));
    const preview = sorted.slice(0, 20).map(name => `\u2022 **${name}**`).join('\n');
    const totalCount = total ?? matches.length;
    const extra = totalCount > 20 ? `\n*\u2026and ${totalCount - 20} more. Try narrowing your search.*` : '';
    return interaction.reply({
      content: `\ud83d\udd0d Multiple creatures match **"${input}"**. Did you mean one of these?\n${preview}${extra}`,
      ephemeral: true,
    });
  }

  const names = Object.values(bestiaryDatabase).map(creature => creature?.name).filter(Boolean);
  const hint = didYouMeanLine(input, names);
  return interaction.reply({
    content: `\u274c No creature found for **"${input}"**.${hint || ' Check your spelling or try another name.'}`,
    ephemeral: true,
  });
}

module.exports = {
  name: 'monster',
  execute,
};
