// deploy-diagnose.js
// One-off slash-command registration: adds /diagnose as a top-level command.
//
// Originally tried to add this as /char debug but /char already has Discord's
// max of 25 subcommands. So /diagnose is a standalone command that does the
// same thing — shows you the bot's view of YOUR character data so you can see
// any name mismatches.
//
// Run with: node deploy-diagnose.js

'use strict';

require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const diagnoseCommand = {
  name: 'diagnose',
  description: 'Show how the bot sees your character data — helps fix lookup issues like wrong character on /sheet.',
  options: [
    {
      name: 'fix',
      description: 'Auto-repair name mismatches (defaults to false — preview only).',
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
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  try {
    console.log(`Registering /diagnose${guildId ? ` to guild ${guildId} (instant)` : ' globally (takes up to 1 hour)'}...`);
    // POST adds a single command without touching others.
    await rest.post(route, { body: diagnoseCommand });
    console.log('✓ Registered /diagnose successfully.');
    if (!guildId) {
      console.log('  Note: global commands can take up to 1 hour to appear in Discord.');
      console.log('  For instant testing, set DEV_GUILD_ID in your .env.');
    }
  } catch (err) {
    console.error('✗ Failed to register /diagnose:', err);
    process.exit(1);
  }
}

main();