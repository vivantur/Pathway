// ── commands/rest/buttons.js ────────────────────────────────────────────────
// Button handlers for /rest: Proceed (rest_confirm_*) does the actual rest
// mutation; Cancel (rest_cancel_*) bails out without changing state.
//
// This file establishes the **button-extraction pattern** used by future
// commands with interactive components (/sheet, /init, etc.):
//
//   1. The command's command.js creates buttons with `customId = '<cmd>_<action>_<args>'`
//   2. A buttons.js module in the same folder exports `prefixes` + `handle(interaction)`
//   3. index.js's button dispatcher checks `prefixes` and delegates
//
// `prefixes` is the list of customId prefixes this module owns. Lets the
// dispatcher do an O(1) lookup instead of branching per command.

const characterState = require('../../state/characters');
const { computeCharMaxHp } = characterState;
const charOverlay = require('../../rules/characterOverlay');
const { buildRestCompleteEmbed } = require('./embed');

const PREFIXES = ['rest_confirm_', 'rest_cancel_'];

async function handle(interaction) {
  if (interaction.customId.startsWith('rest_confirm_')) return _confirm(interaction);
  if (interaction.customId.startsWith('rest_cancel_'))  return _cancel(interaction);
}

async function _confirm(interaction) {
  // customId: rest_confirm_<userId>_<charKey>
  const rest = interaction.customId.slice('rest_confirm_'.length);
  const underscoreIdx = rest.indexOf('_');
  const ownerId = rest.slice(0, underscoreIdx);
  const charKey = rest.slice(underscoreIdx + 1);

  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: '❌ Only the person who used `/rest` can confirm.', ephemeral: true });
  }
  const characters = characterState.getAll();
  const charEntry = characters[ownerId]?.[charKey];
  if (!charEntry) {
    return interaction.update({ content: '❌ Could not find that character anymore.', embeds: [], components: [] });
  }

  charOverlay.ensureOverlay(charEntry);
  const dailyCounterCount = Object.values(charEntry.overlay.counters ?? {})
    .filter(c => c && c.reset === 'daily').length;
  charOverlay.longRest(charEntry);
  // Restore HP to max as part of a full rest
  const maxHp = computeCharMaxHp(charEntry);
  charEntry.hp = maxHp;
  await characterState.saveAll(characters);
  const focus = charOverlay.getCurrentFocus(charEntry);

  const doneEmbed = buildRestCompleteEmbed(charEntry, { maxHp, focus, dailyCounterCount });
  return interaction.update({ embeds: [doneEmbed], components: [] });
}

async function _cancel(interaction) {
  // customId: rest_cancel_<userId>
  const ownerId = interaction.customId.slice('rest_cancel_'.length);
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: '❌ Only the person who used `/rest` can cancel.', ephemeral: true });
  }
  return interaction.update({ content: '🚫 Rest cancelled. Nothing changed.', embeds: [], components: [] });
}

module.exports = {
  prefixes: PREFIXES,
  handle,
};
