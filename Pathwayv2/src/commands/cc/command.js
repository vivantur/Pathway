const { EmbedBuilder } = require('discord.js');

const charOverlay = require('../../rules/characterOverlay');
const characterState = require('../../state/characters');
const { renderCounterLine } = require('./counterView');

async function saveCharacters(characters) {
  await characterState.saveAll(characters);
}

function counterEntries(charEntry) {
  const counters = charOverlay.listCounters(charEntry);
  return Object.entries(counters).sort(([a], [b]) => a.localeCompare(b));
}

function buildCountersEmbed(charEntry, { footer } = {}) {
  const entries = counterEntries(charEntry);
  const description = entries.map(([key, counter]) => renderCounterLine(key, counter, { withHint: true })).join('\n\n');
  const embed = new EmbedBuilder()
    .setColor(0x7289DA)
    .setTitle(`📊 ${charEntry.data.name} - counters (${entries.length}/30)`)
    .setDescription(description.slice(0, 4000))
    .setFooter({ text: footer ?? 'Use /cc use, /cc restore, /cc set to manage. /rest auto-resets daily counters.' });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

async function resolveCharacter(interaction) {
  const characters = characterState.getAll();
  const { error, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('character'),
    characters
  );
  if (error) return { error, characters };
  charOverlay.ensureOverlay(charEntry);
  return { characters, charEntry };
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const { error, characters, charEntry } = await resolveCharacter(interaction);
  if (error) return interaction.reply({ content: `❌ ${error}`, ephemeral: true });

  if (sub === 'add') {
    const name = interaction.options.getString('name').trim();
    const max = interaction.options.getInteger('max');
    const reset = interaction.options.getString('reset') ?? 'none';
    const display = interaction.options.getString('display') ?? 'diamond';
    const label = interaction.options.getString('label');
    const initial = interaction.options.getInteger('initial');
    const result = charOverlay.addCounter(charEntry, name, { max, reset, label, initial, display });
    if (!result.ok) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    await saveCharacters(characters);
    return interaction.reply({
      content: `${result.existed ? '✏️ Updated' : '✅ Created'} counter on **${charEntry.data.name}**:\n${renderCounterLine(name.toLowerCase(), result.counter, { withHint: true })}`,
      ephemeral: true,
    });
  }

  if (sub === 'set') {
    const name = interaction.options.getString('name').trim();
    const value = interaction.options.getInteger('value');
    const result = charOverlay.setCounter(charEntry, name, value);
    if (!result.ok) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    await saveCharacters(characters);
    return interaction.reply({
      content: `🔧 Set on **${charEntry.data.name}**:\n${renderCounterLine(name.toLowerCase(), result.counter)}`,
    });
  }

  if (sub === 'use') {
    const name = interaction.options.getString('name').trim();
    const amount = interaction.options.getInteger('amount') ?? 1;
    const result = charOverlay.useCounter(charEntry, name, amount);
    if (!result.ok) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    await saveCharacters(characters);
    return interaction.reply({
      content: `🔻 **${charEntry.data.name}** spends ${amount} from **${result.counter.label || name.toLowerCase()}**:\n${renderCounterLine(name.toLowerCase(), result.counter)}`,
    });
  }

  if (sub === 'restore') {
    const name = interaction.options.getString('name').trim();
    const amount = interaction.options.getInteger('amount') ?? 1;
    const result = charOverlay.restoreCounter(charEntry, name, amount);
    if (!result.ok) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    await saveCharacters(characters);
    return interaction.reply({
      content: `🔺 **${charEntry.data.name}** restores ${amount} to **${result.counter.label || name.toLowerCase()}**:\n${renderCounterLine(name.toLowerCase(), result.counter)}`,
    });
  }

  if (sub === 'reset') {
    const name = interaction.options.getString('name').trim();
    const result = charOverlay.resetCounter(charEntry, name);
    if (!result.ok) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    await saveCharacters(characters);
    if (result.all) {
      return interaction.reply({
        content: `♻️ Reset all ${result.count} counter(s) on **${charEntry.data.name}** to their max.`,
        ephemeral: true,
      });
    }
    return interaction.reply({
      content: `♻️ Reset on **${charEntry.data.name}**:\n${renderCounterLine(name.toLowerCase(), result.counter)}`,
      ephemeral: true,
    });
  }

  if (sub === 'list') {
    const entries = counterEntries(charEntry);
    if (entries.length === 0) {
      return interaction.reply({
        content: `📭 **${charEntry.data.name}** has no custom counters yet. Create one with \`/cc add\`.\n\nExamples:\n• \`/cc add name:reagents max:8 reset:daily label:"Infused Reagents"\`\n• \`/cc add name:panache max:1 reset:none label:"Swashbuckler Panache"\`\n• \`/cc add name:stratagem max:1 reset:daily label:"Devise a Stratagem"\``,
        ephemeral: true,
      });
    }
    return interaction.reply({ embeds: [buildCountersEmbed(charEntry)], ephemeral: true });
  }

  if (sub === 'remove') {
    const name = interaction.options.getString('name').trim();
    const result = charOverlay.removeCounter(charEntry, name);
    if (!result.ok) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
    await saveCharacters(characters);
    return interaction.reply({ content: `🗑️ Deleted counter **${name.toLowerCase()}** on **${charEntry.data.name}**.`, ephemeral: true });
  }

  return interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
}

async function executeCounters(interaction) {
  const { error, charEntry } = await resolveCharacter(interaction);
  if (error) return interaction.reply({ content: `❌ ${error}`, ephemeral: true });

  const entries = counterEntries(charEntry);
  if (entries.length === 0) {
    return interaction.reply({
      content: `📭 **${charEntry.data.name}** has no custom counters yet. Create one with \`/cc add\`.`,
      ephemeral: true,
    });
  }

  return interaction.reply({
    embeds: [buildCountersEmbed(charEntry, {
      footer: '/cc add to create · /cc use|restore|set to manage · /rest auto-resets daily counters',
    })],
  });
}

module.exports = {
  name: 'cc',
  execute,
  executeCounters,
  renderCounterLine,
};
