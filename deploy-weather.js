// deploy-weather.js
// One-off slash-command registration for /weather.
//
// Run with: node deploy-weather.js
//
// Same pattern as deploy-downtime.js: registers ONLY /weather, leaves your
// other commands untouched. Set DEV_GUILD_ID in .env to register to a single
// server (instant); without it, registers globally (up to 1 hour to propagate).

'use strict';

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// Climates and seasons are listed in autocomplete (handled by the command
// module), but we also need static choices for /weather set's `component`.
const COMPONENT_CHOICES = [
  { name: 'Temperature (°F)', value: 'temperature' },
  { name: 'Precipitation', value: 'precipitation' },
  { name: 'Wind', value: 'wind' },
  { name: 'Fog', value: 'fog' },
];

const weatherCommand = new SlashCommandBuilder()
  .setName('weather')
  .setDescription('PF2e weather tracker — climate, conditions, forecasts, and combat effects.')

  // ── /weather current ──
  .addSubcommand(sub => sub
    .setName('current')
    .setDescription('Show today\'s weather and any mechanical effects.'))

  // ── /weather climate ──
  .addSubcommand(sub => sub
    .setName('climate')
    .setDescription('Set the climate (and optionally season) for this server.')
    .addStringOption(opt => opt
      .setName('climate')
      .setDescription('Climate type')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(opt => opt
      .setName('season')
      .setDescription('Season (defaults to spring on first set)')
      .setRequired(false)
      .setAutocomplete(true)))

  // ── /weather set ──
  .addSubcommand(sub => sub
    .setName('set')
    .setDescription('Override one weather component without re-rolling the rest.')
    .addStringOption(opt => opt
      .setName('component')
      .setDescription('Which part of the weather to set')
      .setRequired(true)
      .addChoices(...COMPONENT_CHOICES))
    .addStringOption(opt => opt
      .setName('value')
      .setDescription('For temperature: a number in °F. For others: pick from autocomplete.')
      .setRequired(true)
      .setAutocomplete(true)))

  // ── /weather roll ──
  .addSubcommand(sub => sub
    .setName('roll')
    .setDescription('Re-roll today\'s weather using the current climate\'s tables.'))

  // ── /weather advance ──
  .addSubcommand(sub => sub
    .setName('advance')
    .setDescription('Step forward N in-game days, rolling weather for each.')
    .addIntegerOption(opt => opt
      .setName('days')
      .setDescription('Days to advance (1-30)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(30)))

  // ── /weather forecast ──
  .addSubcommand(sub => sub
    .setName('forecast')
    .setDescription('Peek at the next few days without committing.')
    .addIntegerOption(opt => opt
      .setName('days')
      .setDescription('How many days ahead (1-7, default 3)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(7)))

  // ── /weather apply ──
  .addSubcommand(sub => sub
    .setName('apply')
    .setDescription('Apply the current weather\'s effects to all combatants in this channel\'s encounter.'))

  // ── /weather clear ──
  .addSubcommand(sub => sub
    .setName('clear')
    .setDescription('Wipe weather state for this server (resets to no weather).'))

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
    console.log(`Registering /weather${guildId ? ` to guild ${guildId} (instant)` : ' globally (takes up to 1 hour)'}...`);
    await rest.post(route, { body: weatherCommand });
    console.log('✓ Registered /weather successfully.');
  } catch (err) {
    console.error('✗ Failed to register /weather:', err);
    process.exit(1);
  }
}

main();