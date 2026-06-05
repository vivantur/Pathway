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
const { findSkill } = require('../skillinfo/lookup');

const SKILL_ABILITIES = {
  acrobatics: 'dex',
  arcana: 'int',
  athletics: 'str',
  crafting: 'int',
  deception: 'cha',
  diplomacy: 'cha',
  intimidation: 'cha',
  medicine: 'wis',
  nature: 'wis',
  occultism: 'int',
  performance: 'cha',
  religion: 'wis',
  society: 'int',
  stealth: 'dex',
  survival: 'wis',
  thievery: 'dex',
};

function titleCase(value) {
  return String(value ?? '').charAt(0).toUpperCase() + String(value ?? '').slice(1);
}

async function execute(interaction) {
  await interaction.deferReply();

  const skillName = interaction.options.getString('skill');
  const { skill, key: skillKey, matches } = findSkill(skillName);
  if (!skill || !skillKey || !SKILL_ABILITIES[skillKey]) {
    const matchText = matches.length ? ` Did you mean: ${matches.slice(0, 10).join(', ')}?` : '';
    return interaction.editReply(`I couldn't find a skill named "${skillName}".${matchText}`);
  }

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
  const abilKey = SKILL_ABILITIES[skillKey];
  const abilMod = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
  const profNum = prof[skillKey] ?? 0;
  const modifier = abilMod + calcCharacterProfNum(c, profNum, lvl);
  const dieRoll = Math.floor(Math.random() * 20) + 1;
  const total = dieRoll + modifier + extraBonus;
  const skillDisplay = skill.name ?? titleCase(skillKey);
  const skillThumb = charEntry.art ?? null;

  return interaction.editReply({
    embeds: [buildRollEmbed({
      title: `${c.name} makes a ${skillDisplay} check!`,
      breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20),
      charName: `${c.name} · ${characterProfLabel(c, profNum)} (${fmt(modifier)})`,
      thumbnail: skillThumb,
    })],
    files: rollFallbackFiles(skillThumb),
  });
}

module.exports = {
  name: 'skill',
  execute,
};
