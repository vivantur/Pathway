// deploy-downtime.js
// One-off slash-command registration for /downtime.
//
// Run with: node deploy-downtime.js
//
// This script ONLY registers the /downtime command — it doesn't touch any
// of your other commands. Existing commands stay registered as-is.
//
// Set DEV_GUILD_ID in your .env to register only to a specific server (instant).
// Without it, the command registers globally (takes up to 1 hour to propagate).

'use strict';

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const downtimeCommand = new SlashCommandBuilder()
  .setName('downtime')
  .setDescription('Manage PF2e downtime activities — Earn Income, Long-Term Rest, Crafting, etc.')
  .addSubcommand(sub => sub
    .setName('on')
    .setDescription('Turn on true automatic downtime accrual for your character')
    .addStringOption(opt => opt
      .setName('character')
      .setDescription('Which character (if you have multiple)')))
  .addSubcommand(sub => sub
    .setName('off')
    .setDescription('Turn off true automatic downtime accrual for your character')
    .addStringOption(opt => opt
      .setName('character')
      .setDescription('Which character (if you have multiple)')))
  // ── /downtime list ──
  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('List available downtime activities'))
  // ── /downtime start ──
  .addSubcommand(sub => sub
    .setName('start')
    .setDescription('Begin a downtime activity')
    .addStringOption(opt => opt
      .setName('activity')
      .setDescription('Which activity to start')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(opt => opt
      .setName('skill')
      .setDescription('Skill to use (Crafting, Performance, etc.)')
      .setRequired(true)
      .setAutocomplete(true))
    .addIntegerOption(opt => opt
      .setName('tasklevel')
      .setDescription('Task level (0-20) — sets the DC and payout tier')
      .setRequired(true)
      .setMinValue(0)
      .setMaxValue(20))
    .addIntegerOption(opt => opt
      .setName('days')
      .setDescription('How many in-game days to plan for the activity')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(60))
    .addIntegerOption(opt => opt
      .setName('bonus')
      .setDescription('Optional extra circumstance/status bonus to the initial check'))
    .addStringOption(opt => opt
      .setName('character')
      .setDescription('Which character (if you have multiple)')))
  // ── /downtime check ──
  .addSubcommand(sub => sub
    .setName('check')
    .setDescription('See your in-progress downtime activities and progress')
    .addStringOption(opt => opt
      .setName('character')
      .setDescription('Which character (if you have multiple)')))
  // ── /downtime complete ──
  .addSubcommand(sub => sub
    .setName('complete')
    .setDescription('Finish an activity and claim the rewards')
    .addStringOption(opt => opt
      .setName('activity')
      .setDescription('Which activity (pick from autocomplete)')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(opt => opt
      .setName('character')
      .setDescription('Which character (if you have multiple)')))
  // ── /downtime cancel ──
  .addSubcommand(sub => sub
    .setName('cancel')
    .setDescription('Abandon an in-progress activity (no rewards)')
    .addStringOption(opt => opt
      .setName('activity')
      .setDescription('Which activity (pick from autocomplete)')
      .setRequired(true)
      .setAutocomplete(true))
    .addStringOption(opt => opt
      .setName('character')
      .setDescription('Which character (if you have multiple)')))
  // ── /downtime spend ──
  .addSubcommand(sub => sub
    .setName('spend')
    .setDescription('Apply banked downtime days to an activity')
    .addStringOption(opt => opt
      .setName('activity')
      .setDescription('Which activity (pick from autocomplete)')
      .setRequired(true)
      .setAutocomplete(true))
    .addIntegerOption(opt => opt
      .setName('days')
      .setDescription('How many banked days to spend')
      .setRequired(true)
      .setMinValue(1))
    .addStringOption(opt => opt
      .setName('character')
      .setDescription('Which character (if you have multiple)')))
  // ── /downtime bank ──
  .addSubcommand(sub => sub
    .setName('bank')
    .setDescription('See your banked downtime days and history')
    .addStringOption(opt => opt
      .setName('character')
      .setDescription('Which character (if you have multiple)')))
  // ── /downtime award ──
  .addSubcommand(sub => sub
    .setName('award')
    .setDescription('Grant downtime days to a player as a quest reward (GM use)')
    .addUserOption(opt => opt
      .setName('player')
      .setDescription('The player to award days to')
      .setRequired(true))
    .addIntegerOption(opt => opt
      .setName('days')
      .setDescription('Number of days to award (negative to remove)')
      .setRequired(true))
    .addStringOption(opt => opt
      .setName('reason')
      .setDescription('Why are these days being awarded? (shown in the player\'s history)'))
    .addStringOption(opt => opt
      .setName('targetcharacter')
      .setDescription('Which of the player\'s characters (if they have multiple)'))
    .addStringOption(opt => opt
      .setName('character')
      .setDescription('Your own character (only used to identify you, not required)')))
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
    console.log(`Registering /downtime${guildId ? ` to guild ${guildId} (instant)` : ' globally (takes up to 1 hour)'}...`);
    // Use POST (which adds the single command) rather than PUT (which would
    // overwrite ALL commands with just this one — bad).
    await rest.post(route, { body: downtimeCommand });
    console.log('✓ Registered /downtime successfully.');
  } catch (err) {
    console.error('✗ Failed to register /downtime:', err);
    process.exit(1);
  }
}

main();
