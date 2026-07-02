const { EmbedBuilder } = require('discord.js');

const charOverlay = require('../../rules/characterOverlay');
const characterState = require('../../state/characters');

async function saveCharacters(characters) {
  await characterState.saveAll(characters);
}

function resourceLines(charEntry) {
  const c = charEntry.data;
  const focus = charOverlay.getCurrentFocus(charEntry);
  const hero = charOverlay.getHeroPoints(charEntry);
  const lines = [
    `**\uD83C\uDF1F Focus points:** ${focus.current}/${focus.max}`,
    `**\u2B50 Hero points:** ${hero}/3`,
  ];

  for (const caster of charOverlay.getCasters(c)) {
    const rankLines = [];
    for (let rank = 1; rank <= 10; rank++) {
      const max = Number(caster.perDay?.[rank] ?? 0);
      if (max === 0) continue;
      const { current } = charOverlay.getSlotsRemaining(charEntry, caster.name, rank);
      rankLines.push(`  Rank ${rank}: ${current}/${max}`);
    }
    if (rankLines.length) {
      lines.push(`**${caster.name} slots:**\n${rankLines.join('\n')}`);
    }
  }

  return lines;
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const nameArg = interaction.options.getString('character');
  const characters = characterState.getAll();
  const { error, char: charEntry } = characterState.resolveChar(interaction.user.id, nameArg, characters);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const c = charEntry.data;
  charOverlay.ensureOverlay(charEntry);

  if (sub === 'show') {
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`${c.name}'s Daily Resources`)
      .setDescription(resourceLines(charEntry).join('\n'))
      .setFooter({ text: 'Use /rest to refill · /refocus for 1 focus point · /resource set to override' });

    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'set') {
    const resource = interaction.options.getString('resource');
    const value = interaction.options.getInteger('value');
    const rank = interaction.options.getInteger('rank');
    const explicitCaster = interaction.options.getString('caster');

    if (resource === 'focus') {
      const max = charOverlay.getMaxFocus(c);
      const clamped = Math.max(0, Math.min(max, value));
      charEntry.overlay.daily.focus_spent = max - clamped;
      await saveCharacters(characters);
      return interaction.reply({ content: `\uD83C\uDF1F Focus points set to ${clamped}/${max}.` });
    }

    if (resource === 'hero') {
      const heroPoints = charOverlay.setHeroPoints(charEntry, value);
      await saveCharacters(characters);
      return interaction.reply({ content: `\u2B50 Hero points set to ${heroPoints}/3.` });
    }

    if (resource === 'slot') {
      if (rank === null || rank === undefined) {
        return interaction.reply({ content: '❌ The `rank` option is required when setting spell slots.', ephemeral: true });
      }

      const casters = charOverlay.getCasters(c);
      const caster = explicitCaster
        ? charOverlay.findCaster(c, explicitCaster)
        : (casters.length === 1 ? casters[0] : null);

      if (!caster) {
        return interaction.reply({
          content: `❌ Specify which caster with the \`caster\` option. Available: ${casters.map(x => x.name).join(', ')}`,
          ephemeral: true,
        });
      }

      const max = Number(caster.perDay?.[rank] ?? 0);
      const clamped = Math.max(0, Math.min(max, value));
      if (!charEntry.overlay.daily.slots_used[caster.name]) charEntry.overlay.daily.slots_used[caster.name] = {};
      charEntry.overlay.daily.slots_used[caster.name][rank] = max - clamped;
      await saveCharacters(characters);
      return interaction.reply({ content: `✨ ${caster.name} rank ${rank} slots set to ${clamped}/${max}.` });
    }

    return interaction.reply({ content: '❌ Unknown resource.', ephemeral: true });
  }

  return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'resource',
  execute,
};
