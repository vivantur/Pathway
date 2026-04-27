// deploy-r.js
// Registers /r as a top-level shortcut alias for /roll. Same syntax, fewer
// keystrokes — for fast ad-hoc dice rolls during play.
//
// /r takes the same options as /roll:
//   dice     — required, the dice expression (e.g. 1d20+7, 4d6kh3, 2#1d20+5)
//   character — optional, applies the character's portrait to the embed
//
// Run with: node deploy-r.js

'use strict';

require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const rCommand = {
  name: 'r',
  description: 'Quick dice roller (shortcut for /roll). Supports adv, dis, crit, rr1, iterations, snippets.',
  options: [
    {
      name: 'dice',
      description: 'Dice expression. e.g. 1d20+7, 4d6kh3, 2#1d20, 1d20 adv, 2d6 crit.',
      type: ApplicationCommandOptionType.String, // 3
      required: true,
    },
    {
      name: 'character',
      description: 'Optional: name a character to attach their portrait to the result.',
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
    console.log(`Registering /r${guildId ? ` to guild ${guildId} (instant)` : ' globally (takes up to 1 hour)'}...`);
    await rest.post(route, { body: rCommand });
    console.log('✓ Registered /r successfully.');
    if (!guildId) {
      console.log('  Note: global commands can take up to 1 hour to appear in Discord.');
      console.log('  For instant testing, set DEV_GUILD_ID in your .env.');
    }
  } catch (err) {
    console.error('✗ Failed to register /r:', err);
    if (err.rawError?.errors) {
      console.error('   Discord error details:', JSON.stringify(err.rawError.errors, null, 2));
    }
    process.exit(1);
  }
}

main();