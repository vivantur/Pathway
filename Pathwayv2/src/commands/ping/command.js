async function execute(interaction) {
  return interaction.reply('Pong! \ud83c\udfd3 Bot is alive and running.');
}

module.exports = {
  name: 'ping',
  execute,
};
