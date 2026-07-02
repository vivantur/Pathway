const {
  HUNT_CREATURE_SKILLS,
  rollD20Plus,
  huntDcByLevel,
  huntMonsterLevel,
  findHuntCandidates,
  huntDegree,
  buildHuntEmbed,
} = require('./helpers');

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') {
      const trait = interaction.options.getString('trait');
      const partyLevel = interaction.options.getInteger('level');
      const players = interaction.options.getInteger('players');
      const difficulty = interaction.options.getString('difficulty') ?? 'moderate';
      const allowedSkills = HUNT_CREATURE_SKILLS[trait] ?? ['Nature'];
      const skill = interaction.options.getString('skill') ?? allowedSkills[0];
      if (!allowedSkills.includes(skill)) {
        return interaction.reply({ content: `For **${trait}** hunts, use: ${allowedSkills.join(', ')}.`, ephemeral: true });
      }
      const modifier = interaction.options.getInteger('bonus');
      const { candidates, targetLevel } = findHuntCandidates({ trait, partyLevel, players, difficulty });
      if (!candidates.length) {
        return interaction.reply({
          content: `No ${trait} creatures found around creature level ${targetLevel}. Try a different trait, party level, or difficulty.`,
          ephemeral: true,
        });
      }
      const monster = candidates[Math.floor(Math.random() * candidates.length)];
      const level = huntMonsterLevel(monster) ?? targetLevel;
      const dc = huntDcByLevel(level);
      const roll = rollD20Plus(modifier);
      const degree = huntDegree(roll.total, roll.roll, dc);
      return interaction.reply({
        embeds: [buildHuntEmbed({
          monster, trait, skill, modifier, roll, total: roll.total, dc, degree,
          targetLevel: partyLevel, players, difficulty,
        })],
      });
    }
}

module.exports = {
  name: 'hunt',
  execute,
};
