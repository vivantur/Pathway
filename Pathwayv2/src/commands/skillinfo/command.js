// ── commands/skillinfo/command.js ───────────────────────────────────────────
// /skillinfo: 3-page reference lookup for the 16 core PF2e Remaster skills.
//
// Pages: Overview / Actions / DCs & Examples. The Overview page integrates
// the user's character (if loaded): shows their current skill modifier and
// proficiency rank inline with the reference text. That makes /skillinfo
// useful both as a "what is Athletics?" lookup and as a "what's my current
// Athletics?" quick check.

const { skillDatabase } = require('../../reference/databases');
const { computeCharSkillModifier } = require('../../rules/pf2eMath');
const { resolveChar } = require('../../state/characters');
const { loadCharacters } = require('../../lib/storage');
const { findSkill } = require('./lookup');
const { buildSkillOverviewPage } = require('./embed');
const { buildSkillButtons } = require('./buttons');

async function execute(interaction) {
  const input = interaction.options.getString('skill');
  const { skill, key: skillKey, matches } = findSkill(input);

  if (!skill && matches.length > 1) {
    const preview = matches.sort().join(', ');
    return interaction.reply({
      content: `🔍 Multiple skills match **"${input}"**. Did you mean one of these?\n**${preview}**`,
      ephemeral: true,
    });
  }

  if (!skill) {
    const allSkills = Object.values(skillDatabase).map(s => s.name).sort().join(', ');
    return interaction.reply({
      content: `❌ No skill found for **"${input}"**.\nAvailable: ${allSkills}`,
      ephemeral: true,
    });
  }

  // Optional: pull the user's current skill modifier from their character sheet
  let charMod = null;
  try {
    const characters = loadCharacters();
    const charNameArg = interaction.options.getString('character');
    const { char: charEntry } = resolveChar(interaction.user.id, charNameArg, characters);
    if (charEntry) {
      charMod = computeCharSkillModifier(charEntry, skillKey);
    }
  } catch { /* no character loaded, that's fine — just show the reference */ }

  const embed = buildSkillOverviewPage(skill, charMod);
  const row = buildSkillButtons(0, skillKey);
  await interaction.reply({ embeds: [embed], components: [row] });
}

module.exports = {
  name: 'skillinfo',
  execute,
};
