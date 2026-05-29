// ── commands/refocus/command.js ─────────────────────────────────────────────
// /refocus: spend 10 minutes of focused concentration to recover 1 focus point.
// PF2e characters with focus pools cap at 3 points; /refocus increments by 1.
// (Long rest restores to max via /rest.)

const characterState = require('../../state/characters');
const { resolveChar } = characterState;
const charOverlay = require('../../rules/characterOverlay');

async function execute(interaction) {
  const nameArg = interaction.options.getString('character');
  const characters = characterState.getAll();
  const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const before = charOverlay.getCurrentFocus(charEntry);
  if (before.max === 0) {
    return interaction.reply({ content: `**${charEntry.data.name}** has no focus pool.`, ephemeral: true });
  }
  if (before.current >= before.max) {
    return interaction.reply({ content: `**${charEntry.data.name}**'s focus pool is already full (${before.current}/${before.max}).`, ephemeral: true });
  }

  const after = charOverlay.refocus(charEntry, 1);
  await characterState.saveAll(characters);
  return interaction.reply({ content: `🌀 **${charEntry.data.name}** refocuses. Focus points: ${after.current}/${after.max}.` });
}

module.exports = {
  name: 'refocus',
  execute,
};
