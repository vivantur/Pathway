const { findMonster } = require('../monster/lookup');
const {
  HUNT_CREATURE_SKILLS,
  rollD20Plus,
  huntDcByLevel,
  huntMonsterLevel,
  huntMonsterTraits,
  huntDegree,
  buildHarvestEmbed,
} = require('../hunt/helpers');

async function execute(interaction) {
    const input = interaction.options.getString('creature');
    const modifier = interaction.options.getInteger('bonus');
    const { monster, matches, total } = findMonster(input);
    if (!monster) {
      if (matches?.length) {
        const preview = matches.slice(0, 20).map(n => `• **${n}**`).join('\n');
        const extra = (total ?? matches.length) > 20 ? `\n*...and ${(total ?? matches.length) - 20} more. Try narrowing your search.*` : '';
        return interaction.reply({ content: `Multiple creatures match **"${input}"**:\n${preview}${extra}`, ephemeral: true });
      }
      return interaction.reply({ content: `No creature found for **${input}**.`, ephemeral: true });
    }
    const traits = huntMonsterTraits(monster);
    const trait = traits.find(t => HUNT_CREATURE_SKILLS[t]) ?? 'animal';
    const allowedSkills = HUNT_CREATURE_SKILLS[trait] ?? ['Nature'];
    const skill = interaction.options.getString('skill') ?? allowedSkills[0];
    if (!allowedSkills.includes(skill)) {
      return interaction.reply({ content: `For **${trait}** harvesting, use: ${allowedSkills.join(', ')}.`, ephemeral: true });
    }
    const level = huntMonsterLevel(monster) ?? 0;
    const dc = huntDcByLevel(level);
    const roll = rollD20Plus(modifier);
    const degree = huntDegree(roll.total, roll.roll, dc);
    return interaction.reply({
      embeds: [buildHarvestEmbed({ monster, trait, skill, modifier, roll, total: roll.total, dc, degree })],
    });
}

module.exports = {
  name: 'harvest',
  execute,
};
