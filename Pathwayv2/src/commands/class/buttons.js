// ── commands/class/buttons.js ───────────────────────────────────────────────
// Five-page pager + click handler for /class.
//
// customId format: `class_<key>_<pageIndex>` where <key> is the class slug
// (may contain underscores for multi-word names like "magus" or future
// homebrew classes) and <pageIndex> is 0-4.
//
// The Overview page (index 0) re-resolves the user's character name on
// click — if the user has a character of this class loaded, the embed
// surfaces "Your character: X". We accept that other pages don't show
// that data; only Overview surfaces it.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { classDatabase } = require('../../reference/databases');
const { resolveChar } = require('../../state/characters');
const { loadCharacters } = require('../../lib/storage');
const {
  buildClassOverviewPage,
  buildClassProficienciesPage,
  buildClassFeaturesPage,
  buildClassFeatsPage,
  buildClassSubclassPage,
} = require('./embed');

function buildClassButtons(currentPage, classKey) {
  const id = classKey.toLowerCase();
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`class_${id}_0`).setLabel('Overview').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`class_${id}_1`).setLabel('Proficiencies').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 1),
    new ButtonBuilder().setCustomId(`class_${id}_2`).setLabel('Features').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 2),
    new ButtonBuilder().setCustomId(`class_${id}_3`).setLabel('Class Feats').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 3),
    new ButtonBuilder().setCustomId(`class_${id}_4`).setLabel('Subclasses').setStyle(ButtonStyle.Success).setDisabled(currentPage === 4),
  );
}

async function handle(interaction) {
  const parts = interaction.customId.split('_');
  const pageIndex = parseInt(parts[parts.length - 1], 10);
  const classKey = parts.slice(1, parts.length - 1).join('_');
  const cls = classDatabase[classKey];
  if (!cls) return interaction.update({ content: '❌ Could not reload class data.', components: [] });

  // On the Overview page only, surface the user's character name if they
  // have a character of this class loaded. Other pages don't show this.
  let userCharName = null;
  if (pageIndex === 0) {
    try {
      const characters = loadCharacters();
      const { char: charEntry } = resolveChar(interaction.user.id, null, characters);
      if (charEntry?.data?.class?.toLowerCase() === cls.name.toLowerCase()) {
        userCharName = charEntry.data.name;
      }
    } catch { /* skip */ }
  }

  let newEmbed;
  if (pageIndex === 0)      newEmbed = buildClassOverviewPage(cls, userCharName);
  else if (pageIndex === 1) newEmbed = buildClassProficienciesPage(cls);
  else if (pageIndex === 2) newEmbed = buildClassFeaturesPage(cls);
  else if (pageIndex === 3) newEmbed = buildClassFeatsPage(cls);
  else if (pageIndex === 4) newEmbed = buildClassSubclassPage(cls);
  else return interaction.update({ content: '❌ Unknown class page.', components: [] });

  return interaction.update({
    embeds: [newEmbed],
    components: [buildClassButtons(pageIndex, classKey)],
  });
}

module.exports = {
  prefixes: ['class_'],
  buildClassButtons,
  handle,
};
