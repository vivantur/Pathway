// ── commands/ancestry/buttons.js ────────────────────────────────────────────
// Three-page pager buttons for /ancestry, plus the dispatcher hook that
// handles incoming clicks.
//
// customId format: `ancestry_<key>_<pageIndex>` where <key> is the
// ancestry's slug (may itself contain underscores, e.g. `half_elf`) and
// <pageIndex> is 0|1|2. We reconstruct <key> by joining all parts between
// the leading "ancestry" tag and the trailing pageIndex.
//
// Button styles:
//   • Active page → disabled grey button (just a label)
//   • Pages with data → colored (Primary for heritages, Success for feats)
//   • Pages without data → Secondary so users can tell they'll get an
//     "view on AoN" placeholder instead of full content

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasHeritages, hasAncestryFeats } = require('../../lib/ancestryParser');
const { findAncestry, ancestryHeritageSlugs } = require('./lookup');
const {
  buildAncestryCorePage,
  buildAncestryHeritagesPage,
  buildAncestryFeatsPage,
} = require('./embed');

function buildAncestryButtons(currentPage, ancestryKey, ancestry) {
  const id = ancestryKey.toLowerCase();
  // For heritages: check both the embedded array AND the heritages.json index.
  // Most ancestries get heritage data from the central index since AoN imports
  // don't bake them in.
  const hasHeritageData = (ancestry && hasHeritages(ancestry))
    || (ancestryKey && ancestryHeritageSlugs(ancestryKey).length > 0);
  const heritagesStyle = hasHeritageData
    ? ButtonStyle.Primary
    : ButtonStyle.Secondary;
  const featsStyle = ancestry && hasAncestryFeats(ancestry)
    ? ButtonStyle.Success
    : ButtonStyle.Secondary;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ancestry_${id}_0`).setLabel('◀ Core').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`ancestry_${id}_1`).setLabel('Heritages').setStyle(heritagesStyle).setDisabled(currentPage === 1),
    new ButtonBuilder().setCustomId(`ancestry_${id}_2`).setLabel('Feats ▶').setStyle(featsStyle).setDisabled(currentPage === 2),
  );
}

/**
 * Dispatcher hook. The interactionCreate handler in index.js delegates any
 * button whose customId starts with one of `prefixes` to `handle`.
 */
async function handle(interaction) {
  const parts = interaction.customId.split('_');
  const pageIndex = parseInt(parts[parts.length - 1], 10);
  const ancestryKey = parts.slice(1, parts.length - 1).join('_');
  const resolvedAncestry = findAncestry(ancestryKey);
  const ancestry = resolvedAncestry?.ancestry;
  if (!ancestry) {
    return interaction.update({ content: '❌ Could not reload ancestry data.', components: [] });
  }
  let newEmbed;
  if (pageIndex === 0) newEmbed = buildAncestryCorePage(ancestry);
  if (pageIndex === 1) newEmbed = buildAncestryHeritagesPage(ancestry, resolvedAncestry.key);
  if (pageIndex === 2) newEmbed = buildAncestryFeatsPage(ancestry);
  return interaction.update({
    embeds: [newEmbed],
    components: [buildAncestryButtons(pageIndex, resolvedAncestry.key, ancestry)],
  });
}

module.exports = {
  prefixes: ['ancestry_'],
  buildAncestryButtons,
  handle,
};
