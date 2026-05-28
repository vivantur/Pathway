// ── commands/skillinfo/buttons.js ───────────────────────────────────────────
// Three-page pager + click handler for /skillinfo.
//
// customId format: `skill_<key>_<pageIndex>` where <key> is the skill slug
// (always a single word here, no underscores to worry about, but we use
// the same `slice(1, parts.length-1).join('_')` decode for symmetry with
// /ancestry, /class). <pageIndex> is 0|1|2.
//
// On click, we recompute the character's skill modifier — the user might
// have leveled up since the original embed was posted, and the live value
// is the right answer.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { skillDatabase } = require('../../reference/databases');
const { computeCharSkillModifier } = require('../../rules/pf2eMath');
const { resolveChar } = require('../../state/characters');
const { loadCharacters } = require('../../lib/storage');
const {
  buildSkillOverviewPage,
  buildSkillActionsPage,
  buildSkillDcsPage,
} = require('./embed');

function buildSkillButtons(currentPage, skillKey) {
  const id = skillKey.toLowerCase();
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`skill_${id}_0`).setLabel('◀ Overview').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`skill_${id}_1`).setLabel('Actions').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 1),
    new ButtonBuilder().setCustomId(`skill_${id}_2`).setLabel('DCs & Examples ▶').setStyle(ButtonStyle.Success).setDisabled(currentPage === 2),
  );
}

async function handle(interaction) {
  const parts = interaction.customId.split('_');
  const pageIndex = parseInt(parts[parts.length - 1], 10);
  const skillKey = parts.slice(1, parts.length - 1).join('_');
  const skill = skillDatabase[skillKey];
  if (!skill) return interaction.update({ content: '❌ Could not reload skill data.', components: [] });

  // Recompute the character's modifier for the Overview page — the user
  // might have leveled up or added a character since this was first posted.
  let charMod = null;
  if (pageIndex === 0) {
    try {
      const characters = loadCharacters();
      const { char: charEntry } = resolveChar(interaction.user.id, null, characters);
      if (charEntry) charMod = computeCharSkillModifier(charEntry, skillKey);
    } catch { /* no character, skip */ }
  }

  let newEmbed;
  if (pageIndex === 0)      newEmbed = buildSkillOverviewPage(skill, charMod);
  else if (pageIndex === 1) newEmbed = buildSkillActionsPage(skill);
  else if (pageIndex === 2) newEmbed = buildSkillDcsPage(skill);
  else return interaction.update({ content: '❌ Unknown skill page.', components: [] });

  return interaction.update({
    embeds: [newEmbed],
    components: [buildSkillButtons(pageIndex, skillKey)],
  });
}

module.exports = {
  prefixes: ['skill_'],
  buildSkillButtons,
  handle,
};
