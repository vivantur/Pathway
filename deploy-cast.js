// deploy-cast.js
// One-off slash-command registration to update the /cast command's schema
// to add the new `targets` (plural) option, alongside the existing `target`
// singular option.
//
// Run with: node deploy-cast.js
//
// Same POST-not-PUT pattern as your other deploy-* scripts: this updates the
// /cast command in place. Your other commands stay untouched.
//
// What's new in this schema:
//   • `targets` — comma-separated list of combatant names to apply effects to.
//                 The bot rolls saves for each (when applicable), applies
//                 spell-mapped conditions per save degree, and reports a
//                 multi-target summary embed.
//   • `target` — kept for backwards compat (single-target spells with the
//                 old auto-resolve path still work the same).

'use strict';

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const castCommand = new SlashCommandBuilder()
  .setName('cast')
  .setDescription('Cast a spell. Auto-rolls attack/save/damage and applies effects to targets.')
  .addStringOption(opt => opt
    .setName('spell')
    .setDescription('Spell name (autocompletes)')
    .setRequired(true)
    .setAutocomplete(true))
  .addStringOption(opt => opt
    .setName('character')
    .setDescription('Which character is casting (if you have multiple)')
    .setRequired(false)
    .setAutocomplete(true))
  .addIntegerOption(opt => opt
    .setName('level')
    .setDescription('Cast level (defaults to spell\'s base rank). Heightens automatically.')
    .setRequired(false)
    .setMinValue(1)
    .setMaxValue(10))
  .addStringOption(opt => opt
    .setName('target')
    .setDescription('Single target (a combatant in this channel\'s encounter)')
    .setRequired(false)
    .setAutocomplete(true))
  .addStringOption(opt => opt
    .setName('targets')
    .setDescription('Multiple targets, comma-separated (e.g. "Goblin1, Goblin2, Bandit"). Overrides target.')
    .setRequired(false)
    .setAutocomplete(true))
  .toJSON();

async function main() {
  const token = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (!token || !clientId) {
    console.error('TOKEN and CLIENT_ID must be set in your .env file.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const guildId = process.env.DEV_GUILD_ID;
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  try {
    console.log(`Updating /cast schema${guildId ? ` in guild ${guildId} (instant)` : ' globally (takes up to 1 hour)'}...`);
    await rest.post(route, { body: castCommand });
    console.log('✓ Updated /cast successfully. The new `targets` option is now available.');
  } catch (err) {
    console.error('✗ Failed to update /cast:', err);
    process.exit(1);
  }
}

main();