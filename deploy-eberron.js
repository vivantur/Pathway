// deploy-eberron.js
// One-time deploy script that adds the `setting` subcommand to /calendar
// and /weather so users can switch their server between Golarion and Eberron.
//
// This script PATCHES existing commands by re-registering both /calendar and
// /weather in full with their existing subcommands plus the new `setting` one.
// Re-running it is safe — Discord deduplicates by command name.
//
// Usage:
//   1. Make sure DISCORD_TOKEN and CLIENT_ID are in your .env (same as your
//      other deploy scripts use).
//   2. Run: node deploy-eberron.js
//   3. Wait ~5-10 seconds for Discord to acknowledge.
//   4. Try: /calendar setting choice:eberron in your server.
//
// If you want guild-scoped (instant) registration during testing, set
// DEV_GUILD_ID in your .env. Otherwise it deploys globally (may take an hour
// for new options to appear in the client).

'use strict';

require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID || null;

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing TOKEN or CLIENT_ID in environment. Aborting.');
  console.error('  TOKEN:', TOKEN ? 'set' : 'MISSING');
  console.error('  CLIENT_ID:', CLIENT_ID ? 'set' : 'MISSING');
  process.exit(1);
}

// ── /calendar (full re-registration with setting subcommand added) ─────────
const calendarCommand = new SlashCommandBuilder()
  .setName('calendar')
  .setDescription('In-game calendar (Golarion or Eberron — set per server).')
  .addSubcommand(s => s.setName('today').setDescription('Show the current in-game date.'))
  .addSubcommand(s => s.setName('set')
    .setDescription('GM: set the in-game date.')
    .addIntegerOption(o => o.setName('year').setDescription('Year (4712 AR or 998 YK by default).').setRequired(true))
    .addIntegerOption(o => o.setName('month').setDescription('Month (1-12).').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('day').setDescription('Day of the month.').setRequired(true)))
  .addSubcommand(s => s.setName('advance')
    .setDescription('GM: advance (or rewind) days.')
    .addIntegerOption(o => o.setName('days').setDescription('Number of days (negative to rewind).').setRequired(true)))
  .addSubcommand(s => s.setName('month')
    .setDescription('Show the calendar grid for a month.')
    .addIntegerOption(o => o.setName('year').setDescription('Year (defaults to current).').setRequired(false))
    .addIntegerOption(o => o.setName('month').setDescription('Month 1-12 (defaults to current).').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('holidays')
    .setDescription('List holidays.')
    .addIntegerOption(o => o.setName('month').setDescription('Month 1-12 (omit for all year).').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('next-holiday')
    .setDescription('Show the next upcoming holiday.'))
  .addSubcommand(s => s.setName('moon')
    .setDescription('Show moon phase. (Eberron shows all 12 moons.)')
    .addIntegerOption(o => o.setName('year').setDescription('Year (defaults to current).').setRequired(false))
    .addIntegerOption(o => o.setName('month').setDescription('Month (defaults to current).').setRequired(false).setAutocomplete(true))
    .addIntegerOption(o => o.setName('day').setDescription('Day (defaults to current).').setRequired(false)))
  .addSubcommand(s => s.setName('clear')
    .setDescription('GM: reset calendar state for this server.'))
  .addSubcommand(s => s.setName('setting')
    .setDescription('Switch this server between Golarion and Eberron (or view current).')
    .addStringOption(o => o.setName('choice').setDescription('Pick golarion or eberron (omit to view).').setRequired(false).setAutocomplete(true)));

// ── /weather (full re-registration with setting subcommand added) ──────────
const weatherCommand = new SlashCommandBuilder()
  .setName('weather')
  .setDescription('In-game weather (Golarion or Eberron — set per server).')
  .addSubcommand(s => s.setName('current').setDescription('Show today\'s weather and active effects.'))
  .addSubcommand(s => s.setName('climate')
    .setDescription('GM: set the climate and season.')
    .addStringOption(o => o.setName('climate').setDescription('Climate region.').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('season').setDescription('Season (spring/summer/autumn/winter).').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('set')
    .setDescription('GM: override one weather component.')
    .addStringOption(o => o.setName('component').setDescription('Which component to set.').setRequired(true)
      .addChoices(
        { name: 'Temperature', value: 'temperature' },
        { name: 'Precipitation', value: 'precipitation' },
        { name: 'Wind', value: 'wind' },
        { name: 'Fog', value: 'fog' },
      ))
    .addStringOption(o => o.setName('value').setDescription('New value (number for temp, key for others).').setRequired(true).setAutocomplete(true)))
  .addSubcommand(s => s.setName('roll')
    .setDescription('GM: re-roll today\'s weather.'))
  .addSubcommand(s => s.setName('advance')
    .setDescription('GM: advance N days, rolling each.')
    .addIntegerOption(o => o.setName('days').setDescription('Number of days to advance (1-30).').setRequired(true).setMinValue(1).setMaxValue(30)))
  .addSubcommand(s => s.setName('forecast')
    .setDescription('Peek at the next N days without committing.')
    .addIntegerOption(o => o.setName('days').setDescription('Days to forecast (1-7).').setRequired(false).setMinValue(1).setMaxValue(7)))
  .addSubcommand(s => s.setName('apply')
    .setDescription('GM: apply current weather effects to all combatants in this channel\'s encounter.'))
  .addSubcommand(s => s.setName('clear')
    .setDescription('GM: clear weather state for this server.'))
  .addSubcommand(s => s.setName('setting')
    .setDescription('Switch this server between Golarion and Eberron weather (or view current).')
    .addStringOption(o => o.setName('choice').setDescription('Pick golarion or eberron (omit to view).').setRequired(false).setAutocomplete(true)));

// ── Deploy ──────────────────────────────────────────────────────────────────
async function main() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const commands = [calendarCommand.toJSON(), weatherCommand.toJSON()];

  try {
    if (DEV_GUILD_ID) {
      console.log(`[deploy] Registering /calendar and /weather to dev guild ${DEV_GUILD_ID}...`);
      // Guild scope: load existing guild commands, merge with our two updated
      // ones (replacing same-name entries), then PUT the merged set.
      const existing = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID));
      const filtered = existing.filter(c => c.name !== 'calendar' && c.name !== 'weather');
      const merged = [...filtered, ...commands];
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID), { body: merged });
      console.log(`[deploy] ✅ Registered ${commands.length} commands to guild. Try /calendar setting in Discord — should appear immediately.`);
    } else {
      console.log('[deploy] Registering /calendar and /weather globally...');
      const existing = await rest.get(Routes.applicationCommands(CLIENT_ID));
      const filtered = existing.filter(c => c.name !== 'calendar' && c.name !== 'weather');
      const merged = [...filtered, ...commands];
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: merged });
      console.log(`[deploy] ✅ Registered ${commands.length} commands globally. May take up to an hour to fully propagate to all servers.`);
    }
    console.log('\n[deploy] Next steps:');
    console.log('  1. Make sure your bot has restarted to pick up the new files in commands/ and systems/.');
    console.log('  2. In Discord: /calendar setting choice:eberron');
    console.log('  3. Try /calendar today and /weather climate to see the new options.');
    console.log('  4. /calendar setting choice:golarion to switch back at any time.');
  } catch (err) {
    console.error('[deploy] ❌ Failed:', err);
    process.exit(1);
  }
}

main();