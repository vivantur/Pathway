const { fmt } = require('../../lib/format');
const {
  calcCharacterProfNum,
  characterProfLabel,
} = require('../../rules/pf2eMath');
const characterState = require('../../state/characters');
const {
  buildRollEmbed,
  formatRollBreakdown,
  rollFallbackFiles,
} = require('../../discord/rollEmbeds');

const SAVE_ABILITIES = {
  fortitude: 'con',
  reflex: 'dex',
  will: 'wis',
};

function titleCase(value) {
  return String(value ?? '').charAt(0).toUpperCase() + String(value ?? '').slice(1);
}

async function execute(interaction) {
  await interaction.deferReply();

  const saveType = interaction.options.getString('type');
  const extraBonus = interaction.options.getInteger('bonus') ?? 0;
  const characters = characterState.getAll();
  const { error, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('character'),
    characters
  );

  if (error) return interaction.editReply(error);

  const c = charEntry.data;
  const ab = c.abilities ?? {};
  const prof = c.proficiencies ?? {};
  const lvl = c.level ?? 1;
  const abilKey = SAVE_ABILITIES[saveType];
  const abilMod = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
  const profNum = prof[saveType] ?? 0;
  const modifier = abilMod + calcCharacterProfNum(c, profNum, lvl);
  const dieRoll = Math.floor(Math.random() * 20) + 1;
  const total = dieRoll + modifier + extraBonus;
  const saveDisplay = titleCase(saveType);
  const saveThumb = charEntry.art ?? null;

  return interaction.editReply({
    embeds: [buildRollEmbed({
      title: `${c.name} makes a ${saveDisplay} save!`,
      breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20),
      charName: `${c.name} · ${characterProfLabel(c, profNum)} (${fmt(modifier)})`,
      thumbnail: saveThumb,
    })],
    files: rollFallbackFiles(saveThumb),
  });
}

module.exports = {
  name: 'save',
  execute,
};
