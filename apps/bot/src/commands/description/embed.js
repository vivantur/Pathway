const { EmbedBuilder } = require('discord.js');

function cleanDescriptionText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function firstDescriptionValue(...values) {
  for (const value of values) {
    const cleaned = cleanDescriptionText(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function getCharacterDescriptionParts(charEntry) {
  const c = charEntry?.data ?? {};
  const edits = charEntry?.edits?.description ?? {};
  const personality = c.personality && typeof c.personality === 'object' ? c.personality : {};
  const details = c.details && typeof c.details === 'object' ? c.details : {};

  return {
    description: firstDescriptionValue(
      edits.description,
      c.description,
      c.physicalDescription,
      c.appearance,
      details.description,
      details.appearance,
      c.bio,
    ),
    personalityTraits: firstDescriptionValue(
      edits.personalityTraits,
      c.personalityTraits,
      personality.traits,
      personality.personalityTraits,
      c.traitsText,
    ),
    ideals: firstDescriptionValue(edits.ideals, c.ideals, personality.ideals),
    bonds: firstDescriptionValue(edits.bonds, c.bonds, personality.bonds),
    flaws: firstDescriptionValue(edits.flaws, c.flaws, personality.flaws),
    backstory: firstDescriptionValue(edits.backstory, c.backstory, details.backstory, personality.backstory),
  };
}

function buildCharacterDescriptionEmbed(charEntry) {
  const c = charEntry?.data ?? {};
  const charName = c.name ?? charEntry?.name ?? 'Character';
  const parts = getCharacterDescriptionParts(charEntry);
  const subtitle = [
    c.ancestry,
    c.heritage,
    c.class ? `Level ${c.level ?? '?'} ${c.class}` : null,
  ].filter(Boolean).join(' - ');

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`${charName}'s Description`)
    .setFooter({ text: 'Pathway character description' });

  if (subtitle) embed.setDescription(`*${subtitle}*`);
  if (charEntry?.art) embed.setThumbnail(charEntry.art);

  const fields = [
    ['Description', parts.description],
    ['Personality Traits', parts.personalityTraits],
    ['Ideals', parts.ideals],
    ['Bonds', parts.bonds],
    ['Flaws', parts.flaws],
    ['Backstory', parts.backstory],
  ]
    .filter(([, value]) => value)
    .map(([fieldName, value]) => ({
      name: fieldName,
      value: value.length > 1024 ? `${value.slice(0, 1021)}...` : value,
      inline: false,
    }));

  if (fields.length) {
    embed.addFields(fields.slice(0, 25));
  } else {
    embed.addFields({
      name: 'No description saved',
      value: 'Use `/description action:edit` to add appearance and personality notes.',
      inline: false,
    });
  }

  return embed;
}

module.exports = {
  cleanDescriptionText,
  getCharacterDescriptionParts,
  buildCharacterDescriptionEmbed,
};
