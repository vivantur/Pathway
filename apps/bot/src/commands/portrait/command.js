// ── commands/portrait/command.js ────────────────────────────────────────────
// /portrait: display a character's portrait image, large.
//
// Defaults to the caller's active character; takes an optional `character:`
// arg to pick one by name. If no art is set, points the user at /char art.
//
// Single-file zero-ctx command — too small to need an embed.js split.

const { EmbedBuilder } = require('discord.js');
const { resolveChar, getAll: getAllCharacters } = require('../../state/characters');

async function execute(interaction) {
  const characters = getAllCharacters();
  const nameArg = interaction.options.getString('character');
  const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const c = charEntry.data ?? {};
  const charName = charEntry.name || c.name || 'Unknown';

  if (!charEntry.art) {
    return interaction.reply({
      content: `🖼️ **${charName}** doesn't have a portrait set yet. Use \`/char art url:<image-url> character:${charName}\` to add one.`,
      ephemeral: true,
    });
  }

  const lvl = c.level ?? '?';
  const ancestryDisplay = `${c.ancestry ?? ''} ${c.heritage ?? ''}`.trim();
  const classDisplay = c.class ?? '';
  const dualClass = c.dualClass ? ` / ${c.dualClass}` : '';
  const subtitleParts = [
    ancestryDisplay || null,
    classDisplay ? `${classDisplay}${dualClass}` : null,
    lvl !== '?' ? `Level ${lvl}` : null,
  ].filter(Boolean);
  const subtitle = subtitleParts.length ? `*${subtitleParts.join(' · ')}*` : null;

  const embed = new EmbedBuilder()
    .setColor(0x7289DA)
    .setTitle(`🖼️ ${charName}`)
    .setImage(charEntry.art);
  if (subtitle) embed.setDescription(subtitle);
  embed.setFooter({ text: 'Update with /char art · Showing current portrait' });

  return interaction.reply({ embeds: [embed] });
}

module.exports = {
  name: 'portrait',
  execute,
};
