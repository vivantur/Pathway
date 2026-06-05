const { fmt } = require('../../lib/format');
const {
  calcCharacterProfNum,
  characterProfLabel,
} = require('../../rules/pf2eMath');
const { computeCharPerception } = require('../../rules/characterChecks');
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

  const skillOverride = interaction.options.getString('skill');
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
  let modifier;
  let profNum;
  let sourceLabel;

  const { skill, key: skillKey } = findSkill(skillOverride);
  if (skillKey && skillKey !== 'perception' && SKILL_ABILITIES[skillKey]) {
    const abilKey = SKILL_ABILITIES[skillKey];
    const abilMod = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
    profNum = prof[skillKey] ?? 0;
    modifier = abilMod + calcCharacterProfNum(c, profNum, lvl);
    sourceLabel = skill?.name ?? titleCase(skillKey);
  } else {
    modifier = computeCharPerception(charEntry);
    profNum = prof.perception ?? 0;
    sourceLabel = 'Perception';
  }

  const dieRoll = Math.floor(Math.random() * 20) + 1;
  const total = dieRoll + modifier + extraBonus;
  const initThumb = charEntry.art ?? null;

  return interaction.editReply({
    embeds: [buildRollEmbed({
      title: `\u2694\uFE0F ${c.name} rolls Initiative!`,
      breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20),
      charName: `${c.name} · ${sourceLabel} (${fmt(modifier)}) · ${characterProfLabel(c, profNum)}`,
      thumbnail: initThumb,
    })],
    files: rollFallbackFiles(initThumb),
  });
}

module.exports = {
  name: 'initiative',
  execute,
};
