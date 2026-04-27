// deploy-break-rename.js
// Renames /br to /break on Discord:
//   1. Registers /break (new name)
//   2. Removes /br (old name)
//
// /break is a visual scene divider — renders as a flat dark bar to separate
// scenes, rounds, encounters, etc. Optional title for labeled breaks.
//
// Run with: node deploy-break-rename.js
//
// Set DEV_GUILD_ID in your .env to register/remove only in a specific guild
// (instant). Without it, it applies globally (up to 1 hour to propagate).

'use strict';

require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const breakCommand = {
  name: 'break',
  description: 'Insert a visual scene break (flat bar) into chat. Optional title for labeled breaks.',
  options: [
    {
      name: 'title',
      description: 'Optional label shown in the middle of the break (e.g. "Round 2", "Long Rest").',
      type: ApplicationCommandOptionType.String, // 3
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
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  try {
    // Step 1: register /break
    console.log(`Registering /break${guildId ? ` to guild ${guildId} (instant)` : ' globally (takes up to 1 hour)'}...`);
    await rest.post(route, { body: breakCommand });
    console.log('✓ Registered /break successfully.');

    // Step 2: remove /br
    console.log('\nLooking for /br to remove...');
    const commands = await rest.get(route);
    const oldBr = Array.isArray(commands) ? commands.find(c => c.name === 'br') : null;
    if (oldBr) {
      const deleteRoute = guildId
        ? Routes.applicationGuildCommand(clientId, guildId, oldBr.id)
        : Routes.applicationCommand(clientId, oldBr.id);
      await rest.delete(deleteRoute);
      console.log('✓ Removed old /br successfully.');
    } else {
      console.log('ℹ️  /br was not registered — nothing to remove.');
    }

    if (!guildId) {
      console.log('\nNote: global commands can take up to 1 hour to appear/disappear in Discord.');
      console.log('For instant testing, set DEV_GUILD_ID in your .env.');
    }
  } catch (err) {
    console.error('✗ Failed:', err);
    if (err.rawError?.errors) {
      console.error('   Discord error details:', JSON.stringify(err.rawError.errors, null, 2));
    }
    process.exit(1);
  }
}

main();