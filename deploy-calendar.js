// deploy-calendar.js
// Slash-command registration for /calendar.
//
// Run with: node deploy-calendar.js
//
// Registers ONLY /calendar; other commands stay untouched (POST not PUT).
// Set DEV_GUILD_ID in .env for instant guild-only registration; without it,
// global registration takes up to 1 hour.

'use strict';

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// Month is required as integer 1-12 with autocomplete suggestions in some
// places. Using setMinValue/setMaxValue lets Discord client-side-validate it.
const calendarCommand = new SlashCommandBuilder()
  .setName('calendar')
  .setDescription('Golarion calendar — track in-game dates, holidays, weekdays, seasons, and moon phases.')

  // ── /calendar today ──
  .addSubcommand(sub => sub
    .setName('today')
    .setDescription('Show today\'s in-game date with weekday, season, moon, and holidays.'))

  // ── /calendar set ──
  .addSubcommand(sub => sub
    .setName('set')
    .setDescription('Set the in-game date directly (GM).')
    .addIntegerOption(opt => opt
      .setName('year').setDescription('AR year (e.g. 4712)').setRequired(true))
    .addIntegerOption(opt => opt
      .setName('month').setDescription('Month 1-12 (Abadius=1)').setRequired(true)
      .setMinValue(1).setMaxValue(12).setAutocomplete(true))
    .addIntegerOption(opt => opt
      .setName('day').setDescription('Day 1-31').setRequired(true)
      .setMinValue(1).setMaxValue(31)))

  // ── /calendar advance ──
  .addSubcommand(sub => sub
    .setName('advance')
    .setDescription('Move forward (positive) or backward (negative) N days (GM).')
    .addIntegerOption(opt => opt
      .setName('days').setDescription('Days to advance, e.g. 7 or -3').setRequired(true)))

  // ── /calendar month ──
  .addSubcommand(sub => sub
    .setName('month')
    .setDescription('Show a month grid with today highlighted and holidays marked.')
    .addIntegerOption(opt => opt
      .setName('month').setDescription('Month 1-12 (defaults to current)').setRequired(false)
      .setMinValue(1).setMaxValue(12).setAutocomplete(true))
    .addIntegerOption(opt => opt
      .setName('year').setDescription('AR year (defaults to current)').setRequired(false)))

  // ── /calendar holidays ──
  .addSubcommand(sub => sub
    .setName('holidays')
    .setDescription('List holidays for a month (or all months if omitted).')
    .addIntegerOption(opt => opt
      .setName('month').setDescription('Month 1-12 (omit for all)').setRequired(false)
      .setMinValue(1).setMaxValue(12).setAutocomplete(true)))

  // ── /calendar next-holiday ──
  .addSubcommand(sub => sub
    .setName('next-holiday')
    .setDescription('Show the next upcoming holiday and how many days away it is.'))

  // ── /calendar moon ──
  .addSubcommand(sub => sub
    .setName('moon')
    .setDescription('Show the moon phase for a date (defaults to today).')
    .addIntegerOption(opt => opt
      .setName('year').setDescription('AR year').setRequired(false))
    .addIntegerOption(opt => opt
      .setName('month').setDescription('Month 1-12').setRequired(false)
      .setMinValue(1).setMaxValue(12).setAutocomplete(true))
    .addIntegerOption(opt => opt
      .setName('day').setDescription('Day 1-31').setRequired(false)
      .setMinValue(1).setMaxValue(31)))

  // ── /calendar clear ──
  .addSubcommand(sub => sub
    .setName('clear')
    .setDescription('Reset the calendar state for this server (GM).'))

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
    console.log(`Registering /calendar${guildId ? ` to guild ${guildId} (instant)` : ' globally (takes up to 1 hour)'}...`);
    await rest.post(route, { body: calendarCommand });
    console.log('✓ Registered /calendar successfully.');
  } catch (err) {
    console.error('✗ Failed to register /calendar:', err);
    process.exit(1);
  }
}

main();