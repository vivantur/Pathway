// deploy-mattack-remove.js
// One-off slash-command surgery: removes /mattack from Discord entirely.
// /mattack was redundant with /init attack (which auto-pulls bestiary data).
//
// Run with: node deploy-mattack-remove.js
//
// Set DEV_GUILD_ID in your .env to remove from a specific guild only (instant).
// Without it, the deletion applies globally (takes up to 1 hour to propagate).

'use strict';

require('dotenv').config();
const { REST, Routes } = require('discord.js');

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

    const mattackCommand = commands.find(c => c.name === 'mattack');
    if (!mattackCommand) {
      console.log('ℹ️  /mattack is not registered. Nothing to remove.');
      return;
    }

    console.log(`Found /mattack (id: ${mattackCommand.id}). Deleting…`);

    const deleteRoute = guildId
      ? Routes.applicationGuildCommand(clientId, guildId, mattackCommand.id)
      : Routes.applicationCommand(clientId, mattackCommand.id);

    await rest.delete(deleteRoute);
    console.log('✓ Successfully removed /mattack from Discord.');
    if (!guildId) {
      console.log('  Note: global command deletions can take up to 1 hour to propagate.');
    }
  } catch (err) {
    console.error('✗ Failed to remove /mattack:', err);
    if (err.rawError?.errors) {
      console.error('   Discord error details:', JSON.stringify(err.rawError.errors, null, 2));
    }
    process.exit(1);
  }
}

main();