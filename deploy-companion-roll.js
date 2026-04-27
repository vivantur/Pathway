// deploy-companion-roll.js
// Adds the /companion roll subcommand to the existing /companion command on
// Discord. /companion roll lets users roll companion attacks, skills, saves,
// and perception checks — works in or out of /init combat.
//
// HOW THIS WORKS
// /companion is one slash command with many subcommands as nested options.
// To add a subcommand we have to PATCH the entire /companion definition. This
// script:
//   1. Fetches your CURRENT /companion definition from Discord
//   2. Adds (or replaces) the `roll` subcommand
//   3. PATCHes /companion back
//
// /companion roll options:
//   type (required)    — attack | skill | save | perception
//   name               — autocomplete; meaning depends on type:
//                          attack → companion's attacks
//                          skill  → companion's stored skills
//                          save   → fort, ref, will
//                          perception → unused
//   target             — free-text (e.g. "Goblin")
//   bonus              — extra integer bonus (status, circumstance, etc.)
//   companion          — which companion (defaults to active one)
//   character          — which character owns the companion
//
// Run with: node deploy-companion-roll.js
//
// Set DEV_GUILD_ID in your .env to register only to a specific server (instant).

'use strict';

require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const ROLL_SUBCOMMAND = {
  name: 'roll',
  description: 'Roll a companion attack, skill, save, or perception check.',
  type: ApplicationCommandOptionType.Subcommand, // 1
  options: [
    {
      name: 'type',
      description: 'What to roll.',
      type: ApplicationCommandOptionType.String, // 3
      required: true,
      choices: [
        { name: 'Attack',     value: 'attack' },
        { name: 'Skill',      value: 'skill' },
        { name: 'Save',       value: 'save' },
        { name: 'Perception', value: 'perception' },
      ],
    },
    {
      name: 'name',
      description: 'For attack: attack name. For skill: skill name. For save: fort/ref/will.',
      type: ApplicationCommandOptionType.String, // 3
      required: false,
      autocomplete: true,
    },
    {
      name: 'target',
      description: 'Optional target name (for flavor — not auto-applied).',
      type: ApplicationCommandOptionType.String, // 3
      required: false,
    },
    {
      name: 'bonus',
      description: 'Optional flat bonus (circumstance, status, item).',
      type: ApplicationCommandOptionType.Integer, // 4
      required: false,
    },
    {
      name: 'companion',
      description: 'Which companion (default: your active companion).',
      type: ApplicationCommandOptionType.String, // 3
      required: false,
      autocomplete: true,
    },
    {
      name: 'character',
      description: 'Which character owns this companion (default: your active character).',
      type: ApplicationCommandOptionType.String, // 3
      required: false,
      autocomplete: true,
    },
  ],
};

async function main() {
  const token = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (!token || !clientId) {
    console.error('TOKEN and CLIENT_ID must be set in your .env file.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  const guildId = process.env.DEV_GUILD_ID;
  const listRoute = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  try {
    console.log(`Fetching existing commands${guildId ? ` for guild ${guildId}` : ' (global)'}...`);
    const commands = await rest.get(listRoute);
    if (!Array.isArray(commands)) {
      console.error('Unexpected response from Discord (expected an array):', commands);
      process.exit(1);
    }

    const companionCommand = commands.find(c => c.name === 'companion');
    if (!companionCommand) {
      console.error('❌ Could not find /companion command. Has it been deployed yet?');
      console.error('   This script PATCHES the existing /companion — it cannot create one from scratch.');
      process.exit(1);
    }

    console.log(`✓ Found /companion with ${companionCommand.options?.length ?? 0} existing subcommand(s).`);
    if ((companionCommand.options?.length ?? 0) >= 25) {
      console.error('❌ /companion already has 25 subcommands (Discord max). Remove one before adding /companion roll.');
      process.exit(1);
    }

    const existingOptions = Array.isArray(companionCommand.options) ? [...companionCommand.options] : [];
    const rollIdx = existingOptions.findIndex(o => o.name === 'roll');
    if (rollIdx >= 0) {
      console.log('  ↺ Replacing existing /companion roll definition.');
      existingOptions[rollIdx] = ROLL_SUBCOMMAND;
    } else {
      console.log('  + Adding /companion roll subcommand.');
      existingOptions.push(ROLL_SUBCOMMAND);
    }

    const updateRoute = guildId
      ? Routes.applicationGuildCommand(clientId, guildId, companionCommand.id)
      : Routes.applicationCommand(clientId, companionCommand.id);

    const patchBody = {
      name: companionCommand.name,
      description: companionCommand.description,
      options: existingOptions,
    };

    await rest.patch(updateRoute, { body: patchBody });
    console.log(`✓ /companion now has ${existingOptions.length} subcommand(s).`);
    console.log(`✓ Successfully registered /companion roll.`);
    if (!guildId) {
      console.log('  Note: global commands can take up to 1 hour to appear in Discord.');
      console.log('  For instant testing, set DEV_GUILD_ID in your .env.');
    }
  } catch (err) {
    console.error('✗ Failed to add /companion roll:', err);
    if (err.rawError?.errors) {
      console.error('   Discord error details:', JSON.stringify(err.rawError.errors, null, 2));
    }
    process.exit(1);
  }
}

main();