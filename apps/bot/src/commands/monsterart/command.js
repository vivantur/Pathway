const { EmbedBuilder } = require('discord.js');

const monsterState = require('../../state/monster');
const { findMonster } = require('../monster/lookup');
const { monsterKey, getGuildArt } = require('../monster/helpers');

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  if (!guildId) return interaction.reply({ content: '\u274c `/monsterart` only works in a server, not in DMs.', ephemeral: true });

  if (sub === 'set') {
    const monsterInput = interaction.options.getString('monster');
    const url = interaction.options.getString('url').trim();
    if (!/^https?:\/\//i.test(url)) {
      return interaction.reply({ content: '\u274c That doesn\'t look like a valid image URL. Make sure it starts with `http://` or `https://`.', ephemeral: true });
    }
    const looksLikeImage = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
    const found = findMonster(monsterInput);
    const displayName = found.monster?.name ?? monsterInput;
    const key = monsterKey(displayName);

    const store = monsterState.getAllArt();
    const guild = getGuildArt(store, guildId);
    guild[key] = {
      displayName,
      url,
      setBy: interaction.user.id,
      setAt: new Date().toISOString(),
    };
    await monsterState.saveAllArt(store);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`\ud83d\uddbc\ufe0f Art set for ${displayName}`)
      .setDescription(`Future \`/monster\` lookups for **${displayName}** on this server will display this image.${looksLikeImage ? '' : '\n\n\u26a0\ufe0f *This URL doesn\'t end in a typical image extension - if it doesn\'t render, try a direct image link (right-click -> Copy Image Address).*'}`)
      .setImage(url)
      .setFooter({ text: `Set by ${interaction.user.username} - /monsterart remove to undo` });
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'remove') {
    const monsterInput = interaction.options.getString('monster');
    const found = findMonster(monsterInput);
    const displayName = found.monster?.name ?? monsterInput;
    const key = monsterKey(displayName);

    const store = monsterState.getAllArt();
    const guild = store[guildId] ?? {};
    if (!guild[key]) {
      return interaction.reply({ content: `\u274c No saved art for **${displayName}** on this server.`, ephemeral: true });
    }
    delete guild[key];
    if (Object.keys(guild).length === 0) delete store[guildId];
    else store[guildId] = guild;
    await monsterState.saveAllArt(store);
    return interaction.reply({ content: `\ud83d\uddd1\ufe0f Removed art for **${displayName}**.`, ephemeral: true });
  }

  if (sub === 'view') {
    const monsterInput = interaction.options.getString('monster');
    if (monsterInput) {
      const found = findMonster(monsterInput);
      const displayName = found.monster?.name ?? monsterInput;
      const key = monsterKey(displayName);
      const store = monsterState.getAllArt();
      const entry = store[guildId]?.[key];
      if (!entry) return interaction.reply({ content: `\u274c No saved art for **${displayName}** on this server.`, ephemeral: true });
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle(`\ud83d\uddbc\ufe0f ${entry.displayName}`)
        .setImage(entry.url)
        .setFooter({ text: `Set by user ${entry.setBy} - /monsterart remove to delete` });
      return interaction.reply({ embeds: [embed] });
    }

    const store = monsterState.getAllArt();
    const guild = store[guildId] ?? {};
    const entries = Object.values(guild);
    if (entries.length === 0) {
      return interaction.reply({ content: '\ud83d\udcd6 No monster art saved for this server yet. Use `/monsterart set` to add some.', ephemeral: true });
    }
    entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
    const lines = entries.map(entry => `\u2022 **${entry.displayName}**`);
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle(`\ud83d\uddbc\ufe0f Saved Monster Art (${entries.length})`)
      .setDescription(lines.join('\n').slice(0, 4000))
      .setFooter({ text: '/monsterart view monster:<name> to see the image - /monsterart remove to delete' });
    return interaction.reply({ embeds: [embed] });
  }

  return interaction.reply({ content: '\u274c Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'monsterart',
  execute,
};
