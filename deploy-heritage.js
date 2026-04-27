// deploy-heritage.js
// Registers /heritage as a top-level lookup command for PF2e ancestry-specific
// heritages (Wildwood Halfling, Cavern Elf, Greenblood Orc, etc.).
//
// /heritage takes:
//   name — required, autocomplete from your indexed heritages
//
// Heritages are pulled from the bot's existing ancestry data on startup, so no
// new gamedata sync is required. Versatile heritages (Tiefling, Aasimar, etc.)
// are NOT yet indexed — those need a separate AoN fetch.
//
// Run with: node deploy-heritage.js

'use strict';

require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const heritageCommand = {
  name: 'heritage',
  description: 'Look up a PF2e heritage (Wildwood Halfling, Cavern Elf, Greenblood Orc, etc.).',
  options: [
    {
      name: 'name',
      description: 'Heritage name. Autocomplete shows all indexed heritages.',
      type: ApplicationCommandOptionType.String, // 3
      required: true,
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
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  try {
    console.log(`Registering /heritage${guildId ? ` to guild ${guildId} (instant)` : ' globally (takes up to 1 hour)'}...`);
    await rest.post(route, { body: heritageCommand });
    console.log('✓ Registered /heritage successfully.');
    if (!guildId) {
      console.log('  Note: global commands can take up to 1 hour to appear in Discord.');
      console.log('  For instant testing, set DEV_GUILD_ID in your .env.');
    }
  } catch (err) {
    console.error('✗ Failed to register /heritage:', err);
    if (err.rawError?.errors) {
      console.error('   Discord error details:', JSON.stringify(err.rawError.errors, null, 2));
    }
    process.exit(1);
  }
}

main();