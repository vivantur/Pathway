// ── commands/rest/command.js ────────────────────────────────────────────────
// /rest: long rest for a character. Shows a confirmation embed with Proceed
// and Cancel buttons; the actual rest mutation happens in buttons.js when
// the user clicks Proceed.
//
// This is the first extracted command with button interactions — the
// confirmation pattern is common enough (any destructive operation) that
// the embed builder is kept reusable.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { resolveChar, getAll: getAllCharacters } = require('../../state/characters');
const charOverlay = require('../../rules/characterOverlay');
const { buildRestConfirmEmbed } = require('./embed');

async function execute(interaction) {
  const nameArg = interaction.options.getString('character');
  const characters = getAllCharacters();
  const { error, char: charEntry, charKey } = resolveChar(interaction.user.id, nameArg, characters);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  charOverlay.ensureOverlay(charEntry);
  const overlay = charEntry.overlay;
  const preparedCount = Object.values(overlay.prepared_override || {}).reduce((a, list) => a + list.length, 0);

  const confirmEmbed = buildRestConfirmEmbed(charEntry, { preparedCount });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rest_confirm_${interaction.user.id}_${charKey}`).setLabel('Proceed').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rest_cancel_${interaction.user.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  return interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true });
}

module.exports = {
  name: 'rest',
  execute,
};
