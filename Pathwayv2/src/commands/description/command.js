const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const characterState = require('../../state/characters');
const {
  cleanDescriptionText,
  getCharacterDescriptionParts,
  buildCharacterDescriptionEmbed,
} = require('./embed');

const prefixes = ['description_modal:'];

async function saveCharacters(characters) {
  await characterState.saveAll(characters);
}

function makeInput(customId, label, value, placeholder) {
  return new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder(placeholder)
    .setValue(String(value ?? '').slice(0, 1000));
}

async function execute(interaction) {
  const characters = characterState.getAll();
  const nameArg = interaction.options.getString('character');
  const { error, charKey, char: charEntry } = characterState.resolveChar(interaction.user.id, nameArg, characters);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const action = interaction.options.getString('action') ?? 'view';
  if (action === 'edit') {
    const c = charEntry.data ?? {};
    const parts = getCharacterDescriptionParts(charEntry);
    const modal = new ModalBuilder()
      .setCustomId(`description_modal:${charKey}`)
      .setTitle(`Description: ${c.name ?? charEntry.name ?? 'Character'}`.slice(0, 45));

    modal.addComponents(
      new ActionRowBuilder().addComponents(makeInput('description', 'Description / Appearance', parts.description, 'What do they look like? Any notable details?')),
      new ActionRowBuilder().addComponents(makeInput('personalityTraits', 'Personality Traits', parts.personalityTraits, 'How do they act, speak, or carry themself?')),
      new ActionRowBuilder().addComponents(makeInput('ideals', 'Ideals', parts.ideals, 'What beliefs or goals drive them?')),
      new ActionRowBuilder().addComponents(makeInput('bonds', 'Bonds', parts.bonds, 'People, places, promises, or causes they are tied to.')),
      new ActionRowBuilder().addComponents(makeInput('flaws', 'Flaws', parts.flaws, 'Weaknesses, fears, habits, or complications.')),
    );

    return interaction.showModal(modal);
  }

  return interaction.reply({ embeds: [buildCharacterDescriptionEmbed(charEntry)] });
}

async function handleModal(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const charKey = interaction.customId.slice('description_modal:'.length);
  const characters = characterState.getAll();
  const userChars = characters[interaction.user.id] ?? {};
  const charEntry = userChars[charKey];
  if (!charEntry) {
    return interaction.editReply('❌ Character not found. Did you delete them while the popup was open?');
  }

  const nextDescription = {
    description: cleanDescriptionText(interaction.fields.getTextInputValue('description')),
    personalityTraits: cleanDescriptionText(interaction.fields.getTextInputValue('personalityTraits')),
    ideals: cleanDescriptionText(interaction.fields.getTextInputValue('ideals')),
    bonds: cleanDescriptionText(interaction.fields.getTextInputValue('bonds')),
    flaws: cleanDescriptionText(interaction.fields.getTextInputValue('flaws')),
  };

  if (!charEntry.edits) charEntry.edits = {};
  const hasAny = Object.values(nextDescription).some(Boolean);
  if (hasAny) charEntry.edits.description = nextDescription;
  else delete charEntry.edits.description;

  await saveCharacters(characters);
  return interaction.editReply(`✅ Updated **${charEntry.name ?? charEntry.data?.name ?? 'character'}**. Use \`/description\` to view it.`);
}

module.exports = {
  name: 'description',
  prefixes,
  execute,
  handleModal,
};
