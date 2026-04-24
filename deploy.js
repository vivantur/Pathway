// deploy.js
// Slash-command registration script.
//
// WHY THIS FILE IS BASICALLY EMPTY RIGHT NOW:
// The previous deploy.js was a near-verbatim copy of index.js (~11,500 lines).
// It had no actual slash-command registration code — running it just started
// a second copy of the bot briefly. Your commands are registered server-side
// at Discord already (probably from an earlier script or via the dev portal),
// so that's why the bot has been working despite deploy.js doing nothing.
//
// HOW TO ADD NEW COMMANDS GOING FORWARD:
// 1. Add the command handler in index.js as usual.
// 2. Register the command's schema with Discord, either:
//    a) Manually via https://discord.com/developers/applications
//       → your app → "Bot" or "Installation" → slash commands, OR
//    b) Write the SlashCommandBuilder for that one command here and run
//       `node deploy.js` — the script below is a template.
//
// LONG-TERM PLAN:
// Phase 3 of the cleanup will turn each command handler into its own file
// under commands/ with its own SlashCommandBuilder exported alongside it.
// Then this deploy script will auto-load all of them and push to Discord in
// one call. For now, keep doing what's been working.

'use strict';

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// ── Example template (uncomment and edit to register a single new command) ──
// const commands = [
//   new SlashCommandBuilder()
//     .setName('mynewcommand')
//     .setDescription('Short description of what it does')
//     .addStringOption(opt => opt
//       .setName('name')
//       .setDescription('The thing to look up')
//       .setRequired(true)
//       .setAutocomplete(true))
//     .toJSON(),
// ];

const commands = []; // nothing to register by default — edit above

async function main() {
  if (commands.length === 0) {
    console.log('deploy.js has no commands configured. See the comment at the top of this file.');
    return;
  }
  const token = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (!token || !clientId) {
    console.error('TOKEN and CLIENT_ID must be set in your environment (.env file).');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  // Guild-scoped registration (instant, for development):
  //   rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  // Global registration (takes up to 1 hour to propagate, for production):
  const guildId = process.env.DEV_GUILD_ID;
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  try {
    console.log(`Registering ${commands.length} command(s)${guildId ? ` to guild ${guildId}` : ' globally'}...`);
    await rest.put(route, { body: commands });
    console.log('Registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
}

main();