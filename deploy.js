'use strict';

// deploy.js — single source of truth for slash-command registration.
//
// HOW TO USE
//   npm run deploy           → register globally (may take up to 1 hour to propagate)
//   npm run deploy:guild     → register to DEV_GUILD_ID only (appears instantly — great for testing)
//
// WHAT THIS DOES
//   This script registers (or re-registers) the commands listed below.
//   It fetches whatever commands Discord already has, swaps out any whose
//   names match the ones defined here, then PUTs the merged set back.
//   Commands NOT defined here are left completely untouched — you can't
//   accidentally wipe your other bot commands by running this.
//
// WHEN TO RE-RUN
//   Run this any time you add a new slash command or change a command's
//   options / subcommands. You don't need to re-run just because you changed
//   how a command responds — only the schema (name, description, options)
//   needs to be re-registered with Discord.
//
// ADDING A NEW COMMAND
//   1. Add the handler in index.js as usual.
//   2. Define its SlashCommandBuilder below (copy an existing one as a template).
//   3. Add it to the `commands` array at the bottom.
//   4. Run `npm run deploy:guild` to test, then `npm run deploy` when ready.
//
// BACKGROUND: WHY NOT JUST USE A SIMPLE PUT?
//   Discord's bulk PUT replaces ALL commands at once. If your deploy script
//   doesn't define every command, the ones you omit get deleted. This script
//   avoids that by merging with the existing command list instead of replacing it.

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID || null;
const useGuild = process.argv.includes('--guild');

if (!TOKEN || !CLIENT_ID) {
  console.error('❌  Missing required environment variables:');
  console.error('    TOKEN:', TOKEN ? '✓ set' : '✗ MISSING');
  console.error('    CLIENT_ID:', CLIENT_ID ? '✓ set' : '✗ MISSING');
  console.error('\nMake sure you have a .env file (copy .env.example and fill it in).');
  process.exit(1);
}

if (useGuild && !DEV_GUILD_ID) {
  console.error('❌  --guild flag used but DEV_GUILD_ID is not set in your .env.');
  console.error('    Add DEV_GUILD_ID=your-server-id to your .env and try again.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Command definitions
// Add each new command here as a SlashCommandBuilder, then include it in the
// `commands` array at the bottom of this file.
// ─────────────────────────────────────────────────────────────────────────────

// ── /hp ──────────────────────────────────────────────────────────────────────
const hpCommand = new SlashCommandBuilder()
  .setName('hp')
  .setDescription('Out-of-combat HP tracking')
  .addSubcommand(sub => sub
    .setName('view')
    .setDescription('Show current/max HP and status')
    .addStringOption(opt => opt.setName('character').setDescription('Character name (leave blank if you only have one)').setRequired(false).setAutocomplete(true)))
  .addSubcommand(sub => sub
    .setName('set')
    .setDescription('Set current HP to an exact value')
    .addIntegerOption(opt => opt.setName('value').setDescription('New current HP (clamped to [0, max])').setRequired(true).setMinValue(0).setMaxValue(9999))
    .addStringOption(opt => opt.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Heal (positive) or take damage (negative)')
    .addIntegerOption(opt => opt.setName('value').setDescription('Amount to add. Use a negative number for damage.').setRequired(true))
    .addStringOption(opt => opt.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(sub => sub
    .setName('reset')
    .setDescription('Fully heal to max HP')
    .addStringOption(opt => opt.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(sub => sub
    .setName('max')
    .setDescription('Override max HP permanently (when import is wrong)')
    .addIntegerOption(opt => opt.setName('value').setDescription('New max HP. Omit to clear the override.').setRequired(false).setMinValue(1).setMaxValue(9999))
    .addStringOption(opt => opt.setName('action').setDescription('Clear the override and use the computed max instead').setRequired(false).addChoices({ name: 'Clear override', value: 'clear' }))
    .addStringOption(opt => opt.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)));

// ── /monsterattack ────────────────────────────────────────────────────────────
const monsterAttackCommand = new SlashCommandBuilder()
  .setName('monsterattack')
  .setDescription('GM: save reusable attacks for monsters by name. Used by /init attack and /monsterattack use.')
  .addSubcommand(s => s.setName('add')
    .setDescription('Save a strike (melee/ranged) for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name (matches bestiary if possible).').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name (e.g. "Bite", "Longsword").').setRequired(true))
    .addIntegerOption(o => o.setName('bonus').setDescription('Attack bonus (e.g. 8 for +8).').setRequired(true))
    .addStringOption(o => o.setName('damage').setDescription('Damage expression (e.g. 1d8+3 or 2d6).').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. slashing, fire). Defaults to "damage".').setRequired(false))
    .addStringOption(o => o.setName('traits').setDescription('Comma-separated traits (agile, reach, finesse...).').setRequired(false))
    .addStringOption(o => o.setName('extra_damage').setDescription('Extra damage dice (e.g. 1d6 for fire).').setRequired(false))
    .addStringOption(o => o.setName('extra_type').setDescription('Type for extra damage (e.g. fire).').setRequired(false)))
  .addSubcommand(s => s.setName('addspell')
    .setDescription('Save a spell attack for a monster (no MAP applies).')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Spell name (e.g. "Magic Missile").').setRequired(true))
    .addIntegerOption(o => o.setName('bonus').setDescription('Spell attack bonus.').setRequired(true))
    .addStringOption(o => o.setName('damage').setDescription('Damage expression (e.g. 4d6).').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. force, fire).').setRequired(false)))
  .addSubcommand(s => s.setName('addsave')
    .setDescription('Save a save-based attack for a monster (e.g. dragon breath).')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name (e.g. "Breath Weapon").').setRequired(true))
    .addStringOption(o => o.setName('save').setDescription('Save type targets must roll.').setRequired(true)
      .addChoices({ name: 'Fortitude', value: 'Fortitude' }, { name: 'Reflex', value: 'Reflex' }, { name: 'Will', value: 'Will' }))
    .addIntegerOption(o => o.setName('dc').setDescription('Save DC.').setRequired(true))
    .addStringOption(o => o.setName('damage').setDescription('Damage expression (e.g. 6d6).').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. fire).').setRequired(false)))
  .addSubcommand(s => s.setName('remove')
    .setDescription('Remove a single saved attack from a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name to remove.').setRequired(true)))
  .addSubcommand(s => s.setName('clear')
    .setDescription('Remove ALL saved attacks for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true)))
  .addSubcommand(s => s.setName('list')
    .setDescription('List saved attacks. Provide a monster to see its attacks; omit to list all monsters.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name (omit for all).').setRequired(false)))
  .addSubcommand(s => s.setName('use')
    .setDescription('Roll a saved attack against a target.')
    .addStringOption(o => o.setName('attacker').setDescription('Combatant doing the attacking (must be in init).').setRequired(true))
    .addStringOption(o => o.setName('monster').setDescription('Which monster\'s attack to use (e.g. "Goblin Warrior").').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name (substring match OK).').setRequired(true))
    .addStringOption(o => o.setName('target').setDescription('Target combatant (required for strikes/spells, optional for saves).').setRequired(false))
    .addIntegerOption(o => o.setName('map').setDescription('Override MAP (0=first attack, 1=second, 2=third).').setRequired(false).setMinValue(0).setMaxValue(2)));

// ── /monsterroll ──────────────────────────────────────────────────────────────
const monsterRollCommand = new SlashCommandBuilder()
  .setName('monsterroll')
  .setDescription('GM: roll saves and skills for monsters (works in or out of initiative).')
  .addSubcommand(s => s.setName('save')
    .setDescription('Roll a save for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name (combatant in init OR bestiary entry).').setRequired(true))
    .addStringOption(o => o.setName('save').setDescription('Which save to roll.').setRequired(true)
      .addChoices(
        { name: 'Fortitude', value: 'fort' },
        { name: 'Reflex',    value: 'ref'  },
        { name: 'Will',      value: 'will' },
      ))
    .addIntegerOption(o => o.setName('dc').setDescription('DC to compare against (shows degree of success).').setRequired(false))
    .addBooleanOption(o => o.setName('public').setDescription('Show the result publicly instead of GM-only (default: false).').setRequired(false)))
  .addSubcommand(s => s.setName('skill')
    .setDescription('Roll a skill check for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('skill').setDescription('Skill name (e.g. Stealth, Athletics — partial match OK).').setRequired(true))
    .addIntegerOption(o => o.setName('dc').setDescription('DC to compare against (shows degree of success).').setRequired(false))
    .addBooleanOption(o => o.setName('public').setDescription('Show the result publicly instead of GM-only (default: false).').setRequired(false)));

// ── /r (quick alias for /roll) ────────────────────────────────────────────────
const rCommand = new SlashCommandBuilder()
  .setName('r')
  .setDescription('Quick alias for /roll. Roll dice with snippet expansion (e.g. /r 1d20+@hylia.athletics).')
  .addStringOption(o => o.setName('dice').setDescription('Dice expression. Supports @snippets and basic math.').setRequired(true))
  .addStringOption(o => o.setName('character').setDescription('Character whose snippets/portrait to use.').setRequired(false));

// ── /downtime ─────────────────────────────────────────────────────────────────
const downtimeCommand = new SlashCommandBuilder()
  .setName('downtime')
  .setDescription('Track and spend downtime days. Auto-accrues 1 day per IRL day.')
  .addSubcommand(s => s.setName('check')
    .setDescription('Show how many downtime days you have banked.')
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)))
  .addSubcommand(s => s.setName('spend')
    .setDescription('Spend banked downtime days.')
    .addIntegerOption(o => o.setName('days').setDescription('Days to spend.').setRequired(true).setMinValue(1).setMaxValue(200))
    .addStringOption(o => o.setName('reason').setDescription('What you spent them on (logged for audit).').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)))
  .addSubcommand(s => s.setName('grant')
    .setDescription('Manually add downtime days (quest reward, GM gift, etc.).')
    .addIntegerOption(o => o.setName('days').setDescription('Days to grant.').setRequired(true).setMinValue(1).setMaxValue(200))
    .addStringOption(o => o.setName('reason').setDescription('Why (logged for audit).').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)))
  .addSubcommand(s => s.setName('log')
    .setDescription('Show recent downtime activity (audit log).')
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)))
  .addSubcommand(s => s.setName('reset')
    .setDescription('Reset downtime to 0 (irreversible).')
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)));

// ── /calendar ─────────────────────────────────────────────────────────────────
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
  .addSubcommand(s => s.setName('next-holiday').setDescription('Show the next upcoming holiday.'))
  .addSubcommand(s => s.setName('moon')
    .setDescription('Show moon phase. (Eberron shows all 12 moons.)')
    .addIntegerOption(o => o.setName('year').setDescription('Year (defaults to current).').setRequired(false))
    .addIntegerOption(o => o.setName('month').setDescription('Month (defaults to current).').setRequired(false).setAutocomplete(true))
    .addIntegerOption(o => o.setName('day').setDescription('Day (defaults to current).').setRequired(false)))
  .addSubcommand(s => s.setName('clear').setDescription('GM: reset calendar state for this server.'))
  .addSubcommand(s => s.setName('setting')
    .setDescription('Switch this server between Golarion and Eberron (or view current).')
    .addStringOption(o => o.setName('choice').setDescription('Pick golarion or eberron (omit to view).').setRequired(false).setAutocomplete(true)));

// ── /weather ──────────────────────────────────────────────────────────────────
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
    .addStringOption(o => o.setName('value').setDescription('New value.').setRequired(true).setAutocomplete(true)))
  .addSubcommand(s => s.setName('roll').setDescription('GM: re-roll today\'s weather.'))
  .addSubcommand(s => s.setName('advance')
    .setDescription('GM: advance N days, rolling each.')
    .addIntegerOption(o => o.setName('days').setDescription('Number of days to advance (1-30).').setRequired(true).setMinValue(1).setMaxValue(30)))
  .addSubcommand(s => s.setName('forecast')
    .setDescription('Peek at the next N days without committing.')
    .addIntegerOption(o => o.setName('days').setDescription('Days to forecast (1-7).').setRequired(false).setMinValue(1).setMaxValue(7)))
  .addSubcommand(s => s.setName('apply')
    .setDescription('GM: apply current weather effects to all combatants in this channel\'s encounter.'))
  .addSubcommand(s => s.setName('clear').setDescription('GM: clear weather state for this server.'))
  .addSubcommand(s => s.setName('setting')
    .setDescription('Switch this server between Golarion and Eberron weather (or view current).')
    .addStringOption(o => o.setName('choice').setDescription('Pick golarion or eberron (omit to view).').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// Master command list — add new commands here after defining them above.
// ─────────────────────────────────────────────────────────────────────────────
const commands = [
  hpCommand,
  monsterAttackCommand,
  monsterRollCommand,
  rCommand,
  downtimeCommand,
  calendarCommand,
  weatherCommand,
].map(c => c.toJSON());

const commandNames = new Set(commands.map(c => c.name));

// ─────────────────────────────────────────────────────────────────────────────
// Deploy
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const route = (useGuild && DEV_GUILD_ID)
    ? Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  const target = (useGuild && DEV_GUILD_ID)
    ? `guild ${DEV_GUILD_ID} (instant)`
    : 'global (up to 1 hour to propagate)';

  console.log(`\nRegistering ${commands.length} command(s) → ${target}`);
  console.log('Commands:', commands.map(c => `/${c.name}`).join(', '));

  try {
    // Fetch what Discord currently has, filter out our commands, then PUT the merged set.
    // This is safe: commands not in this script are left completely untouched.
    const existing = await rest.get(route);
    const kept = existing.filter(c => !commandNames.has(c.name));
    const merged = [...kept, ...commands];
    await rest.put(route, { body: merged });

    console.log(`\n✅ Done! Registered ${commands.length} command(s). ${kept.length} existing command(s) left untouched.`);
    if (!useGuild) {
      console.log('   Global commands can take up to 1 hour to appear in all servers.');
      console.log('   For instant testing: npm run deploy:guild  (requires DEV_GUILD_ID in .env)');
    }
  } catch (err) {
    console.error('\n❌ Failed to register commands:');
    console.error(err.message ?? err);
    if (err.status === 401) console.error('   → Your TOKEN is invalid or expired. Check your .env file.');
    if (err.status === 403) console.error('   → Missing permissions. Make sure the bot has the applications.commands scope.');
    process.exit(1);
  }
}

main();
