const { EmbedBuilder } = require('discord.js');

const charOverlay = require('../../rules/characterOverlay');
const { resolveVariable } = require('../../rules/variables');
const characterState = require('../../state/characters');

const BUILTIN_GROUPS = [
  '**Core:** `{{level}}` `{{name}}` `{{ac}}` `{{hp}}` `{{maxhp}}` `{{speed}}` `{{hero}}` `{{classdc}}`',
  '**Ability mods:** `{{str}}` `{{dex}}` `{{con}}` `{{int}}` `{{wis}}` `{{cha}}` `{{key}}`',
  '**Saves & Perception:** `{{fort}}` `{{ref}}` `{{will}}` `{{perception}}`',
  '**Skill totals:** `{{athletics}}` `{{stealth}}` `{{deception}}` `{{arcana}}` \u2026 (any of the 16)',
  '**Skill rank only:** `{{rank.athletics}}` etc.',
  '**Counters:** `{{counter.<name>}}` (current) and `{{counter.<name>.max}}`',
];

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const characters = characterState.getAll();
  const { error, char: charEntry } = characterState.resolveChar(
    interaction.user.id,
    interaction.options.getString('character'),
    characters,
  );

  if (error) return interaction.reply({ content: `\u274c ${error}`, ephemeral: true });
  charOverlay.ensureOverlay(charEntry);

  if (sub === 'set') {
    const name = interaction.options.getString('name').trim();
    const value = interaction.options.getString('value');
    const lowerName = name.toLowerCase();
    const existed = Object.prototype.hasOwnProperty.call(charEntry.overlay.cvars, lowerName);
    const result = charOverlay.setCvar(charEntry, name, value);
    if (!result.ok) return interaction.reply({ content: `\u274c ${result.error}`, ephemeral: true });

    await characterState.saveAll(characters);
    const resolved = resolveVariable(name, charEntry);
    const resolvedLine = (resolved !== undefined && String(resolved) !== value)
      ? `\nResolves to: \`${resolved}\``
      : '';

    return interaction.reply({
      content: `${existed ? '\u270f\ufe0f Updated' : '\u2705 Created'} cvar **${lowerName}** = \`${value}\` on **${charEntry.data.name}**.${resolvedLine}\nUse it in \`/roll\` like \`{{${lowerName}}}\`.`,
      ephemeral: true,
    });
  }

  if (sub === 'list') {
    const cvars = charOverlay.listCvars(charEntry);
    const entries = Object.entries(cvars).sort(([a], [b]) => a.localeCompare(b));
    const userLines = entries.length === 0
      ? ['*No cvars set on this character yet. Use `/cvar set` to create one.*']
      : entries.map(([name, value]) => `\u2022 \`{{${name}}}\` \u2192 \`${value}\``);

    const embed = new EmbedBuilder()
      .setColor(0x7289DA)
      .setTitle(`\ud83d\udd27 ${charEntry.data.name} \u2014 cvars (${entries.length}/50)`)
      .setDescription(userLines.join('\n'))
      .addFields({ name: 'Built-in variables (always available)', value: BUILTIN_GROUPS.join('\n') })
      .setFooter({ text: 'Use {{name}} inside any /roll expression. User cvars override built-ins.' });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'show') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    const cvarValue = charOverlay.getCvar(charEntry, name);
    const resolved = resolveVariable(name, charEntry);
    if (cvarValue === undefined && resolved === undefined) {
      return interaction.reply({ content: `\u274c \`{{${name}}}\` is not a defined cvar or built-in on **${charEntry.data.name}**.`, ephemeral: true });
    }

    const lines = [];
    if (cvarValue !== undefined) lines.push(`Cvar value: \`${cvarValue}\``);
    else lines.push(`Built-in variable on **${charEntry.data.name}**.`);
    if (resolved !== undefined) lines.push(`Resolves to: **${resolved}**`);
    return interaction.reply({ content: `\`{{${name}}}\`\n${lines.join('\n')}`, ephemeral: true });
  }

  if (sub === 'delete') {
    const name = interaction.options.getString('name').trim().toLowerCase();
    const result = charOverlay.deleteCvar(charEntry, name);
    if (!result.ok) return interaction.reply({ content: `\u274c ${result.error}`, ephemeral: true });
    await characterState.saveAll(characters);
    return interaction.reply({ content: `\ud83d\uddd1\ufe0f Deleted cvar **${name}** on **${charEntry.data.name}**.`, ephemeral: true });
  }

  return interaction.reply({ content: '\u274c Unknown subcommand.', ephemeral: true });
}

module.exports = {
  name: 'cvar',
  execute,
};
