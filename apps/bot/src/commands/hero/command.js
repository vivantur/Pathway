const { EmbedBuilder } = require('discord.js');

const { rollDiceExpression } = require('../../lib/diceExpression');
const characterState = require('../../state/characters');
const {
  HERO_POINTS_MAX,
  HERO_POINTS_DEFAULT,
  getHeroPoints,
  renderHeroPointsBar,
  buildHeroPointsEmbed,
} = require('./embed');

async function saveCharacters(characters) {
  await characterState.saveAll(characters);
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const characters = characterState.getAll();
  const { error, charKey, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('character'),
    characters
  );

  if (error) return interaction.reply({ content: error, ephemeral: true });

  const char = charEntry.data;
  const current = getHeroPoints(charEntry);

  if (sub === 'view') {
    return interaction.reply({ embeds: [buildHeroPointsEmbed(char, charEntry)] });
  }

  if (sub === 'add') {
    const amount = interaction.options.getInteger('amount') ?? 1;
    if (amount < 1) return interaction.reply({ content: '❌ Amount must be at least 1.', ephemeral: true });

    const raw = current + amount;
    const capped = Math.min(raw, HERO_POINTS_MAX);
    charEntry.heroPoints = capped;
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);

    const actuallyAdded = capped - current;
    const wasted = amount - actuallyAdded;
    let note;
    if (actuallyAdded === 0) note = `⚠️ **${char.name}** already has the max of ${HERO_POINTS_MAX}. No points added.`;
    else if (wasted > 0) note = `✨ Awarded **+${amount}**, but ${wasted} exceeded the cap. Now at **${capped}/${HERO_POINTS_MAX}**.`;
    else note = `✨ Awarded **+${amount}**. Now at **${capped}/${HERO_POINTS_MAX}**.`;
    return interaction.reply({ embeds: [buildHeroPointsEmbed(char, charEntry, note)] });
  }

  if (sub === 'spend') {
    const amount = interaction.options.getInteger('amount') ?? 1;
    if (amount < 1) return interaction.reply({ content: '❌ Amount must be at least 1.', ephemeral: true });
    if (amount > current) {
      return interaction.reply({
        content: `❌ **${char.name}** only has **${current}** Hero Point${current === 1 ? '' : 's'}.`,
        ephemeral: true,
      });
    }

    charEntry.heroPoints = current - amount;
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);

    const note = amount === current && amount >= 3
      ? `💫 **${char.name}** spent all **${amount}** Hero Points! *(Enough to avoid death and stabilize.)*`
      : `🎲 **${char.name}** spent **${amount}** Hero Point${amount === 1 ? '' : 's'}. **${charEntry.heroPoints}** remaining.`;
    return interaction.reply({ embeds: [buildHeroPointsEmbed(char, charEntry, note)] });
  }

  if (sub === 'set') {
    const value = interaction.options.getInteger('value');
    if (value < 0) return interaction.reply({ content: "❌ Hero Points can't be negative.", ephemeral: true });

    charEntry.heroPoints = value;
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);

    const overflow = value > HERO_POINTS_MAX ? ` *(above normal max of ${HERO_POINTS_MAX} - GM override)*` : '';
    const note = `✏️ Set to **${value}**${overflow}.`;
    return interaction.reply({ embeds: [buildHeroPointsEmbed(char, charEntry, note)] });
  }

  if (sub === 'reset') {
    charEntry.heroPoints = HERO_POINTS_DEFAULT;
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);

    const note = `🌅 Reset for a new session. **${char.name}** starts with **${HERO_POINTS_DEFAULT}**.`;
    return interaction.reply({ embeds: [buildHeroPointsEmbed(char, charEntry, note)] });
  }

  if (sub === 'reroll') {
    if (current < 1) {
      return interaction.reply({
        content: `❌ **${char.name}** has no Hero Points to spend. Use \`/hero add\` if the GM just awarded one.`,
        ephemeral: true,
      });
    }

    const dice = interaction.options.getString('dice');
    const previous = interaction.options.getInteger('previous');
    const result = rollDiceExpression(dice);
    if (result.error) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });

    charEntry.heroPoints = current - 1;
    characters[interaction.user.id][charKey] = charEntry;
    await saveCharacters(characters);

    let keepLine;
    if (previous !== null && previous !== undefined) {
      const kept = Math.max(previous, result.total);
      if (result.total > previous) keepLine = `**Kept: ${kept}** ✨ *(rerolled higher!)*`;
      else if (result.total === previous) keepLine = `**Kept: ${kept}** *(tied)*`;
      else keepLine = `**Kept: ${kept}** *(previous roll was better)*`;
    } else {
      keepLine = `**Result: ${result.total}**\n*Keep the higher of your original roll and this one.*`;
    }

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle(`⭐ ${char.name} spends a Hero Point to reroll!`)
      .setDescription(
        (previous !== null && previous !== undefined ? `**Previous:** ${previous}\n` : '') +
        `**Reroll:** ${result.breakdown} = **${result.total}**\n\n` +
        keepLine + '\n\n' +
        `*Hero Points: ${renderHeroPointsBar(charEntry.heroPoints)} (${charEntry.heroPoints}/${HERO_POINTS_MAX})*`
      )
      .setFooter({ text: `${char.name} · 1 Hero Point spent` });
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    return interaction.reply({ embeds: [embed] });
  }

  return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'hero',
  execute,
};
