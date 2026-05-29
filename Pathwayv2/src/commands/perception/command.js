const { fmt } = require('../../lib/format');
const { characterProfLabel } = require('../../rules/pf2eMath');
const { computeCharPerception } = require('../../rules/characterChecks');
const characterState = require('../../state/characters');
const {
  buildRollEmbed,
  formatRollBreakdown,
  rollFallbackFiles,
} = require('../../discord/rollEmbeds');

async function execute(interaction) {
  await interaction.deferReply();

  const extraBonus = interaction.options.getInteger('bonus') ?? 0;
  const characters = characterState.getAll();
  const { error, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('character'),
    characters
  );

  if (error) return interaction.editReply(error);

  const c = charEntry.data;
  const modifier = computeCharPerception(charEntry);
  const profNum = c.proficiencies?.perception ?? 0;
  const dieRoll = Math.floor(Math.random() * 20) + 1;
  const total = dieRoll + modifier + extraBonus;
  const perceptionThumb = charEntry.art ?? null;

  return interaction.editReply({
    embeds: [buildRollEmbed({
      title: `\uD83D\uDC41\uFE0F ${c.name} rolls Perception!`,
      breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20),
      charName: `${c.name} · ${characterProfLabel(c, profNum)} Perception (${fmt(modifier)})`,
      thumbnail: perceptionThumb,
    })],
    files: rollFallbackFiles(perceptionThumb),
  });
}

module.exports = {
  name: 'perception',
  execute,
};
