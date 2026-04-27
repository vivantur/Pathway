// deploy-char-debug.js
// One-off slash-command registration: adds the new /char debug subcommand
// to your existing /char command WITHOUT touching its other subcommands.
//
// Run with: node deploy-char-debug.js
//
// Same approach as deploy-init-attack.js — fetches the existing /char
// command from Discord, appends the debug subcommand, and PATCHes it back.

'use strict';

require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const newDebugSubcommand = {
  name: 'debug',
  description: 'Diagnostic: shows the bot\'s view of your character data (helps fix lookup issues).',
  type: ApplicationCommandOptionType.Subcommand,
  options: [
    {
      name: 'fix',
      description: 'Automatically repair any name mismatches (defaults to false — preview only).',
      type: ApplicationCommandOptionType.Boolean,
      required: false,
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
      console.error('Unexpected response from Discord:', commands);
      process.exit(1);
    }

    const charCommand = commands.find(c => c.name === 'char');
    if (!charCommand) {
      console.error('❌ Could not find /char command. Has it been deployed yet?');
      process.exit(1);
    }

    console.log(`✓ Found /char with ${charCommand.options?.length ?? 0} existing subcommand(s).`);

    const existingOptions = Array.isArray(charCommand.options) ? [...charCommand.options] : [];
    const existingIdx = existingOptions.findIndex(o => o.name === 'debug');
    if (existingIdx >= 0) {
      console.log(`  ↺ /char debug already exists — updating it.`);
      existingOptions[existingIdx] = newDebugSubcommand;
    } else {
      console.log(`  + Adding /char debug as a new subcommand.`);
      existingOptions.push(newDebugSubcommand);
    }

    const updateRoute = guildId
      ? Routes.applicationGuildCommand(clientId, guildId, charCommand.id)
      : Routes.applicationCommand(clientId, charCommand.id);

    await rest.patch(updateRoute, {
      body: {
        name: charCommand.name,
        description: charCommand.description,
        options: existingOptions,
      },
    });

    console.log(`✓ Successfully ${existingIdx >= 0 ? 'updated' : 'added'} /char debug.`);
    if (!guildId) {
      console.log('  Note: global commands can take up to 1 hour to appear in Discord.');
      console.log('  For instant testing, set DEV_GUILD_ID in your .env.');
    }
  } catch (err) {
    console.error('✗ Failed to register /char debug:', err);
    process.exit(1);
  }
}

main();