// deploy-lore.js
// Registers /lore as a NEW top-level command for rolling Lore skill checks.
//
// /lore takes:
//   topic     — required, autocomplete from your character's known lores
//   bonus     — optional flat bonus to add (circumstance/status/etc.)
//   character — optional, defaults to your active character
//
// Lore checks roll 1d20 + Int mod + proficiency bonus + extraBonus, with the
// proficiency rank coming from the character's stored lore data (Pathbuilder
// JSON's c.lores plus charEntry.edits.lores from /char lore).
//
// Run with: node deploy-lore.js

'use strict';

require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const loreCommand = {
  name: 'lore',
  description: 'Roll a Lore skill check (Int-based). Autocomplete shows your character\'s known lores.',
  options: [
    {
      name: 'topic',
      description: 'Which Lore skill to roll (e.g. Dragon, Sailing, Underworld). Autocomplete shows your known lores.',
      type: ApplicationCommandOptionType.String, // 3
      required: true,
      autocomplete: true,
    },
    {
      name: 'bonus',
      description: 'Optional flat bonus (circumstance, status, item).',
      type: ApplicationCommandOptionType.Integer, // 4
      required: false,
    },
    {
      name: 'character',
      description: 'Which character to roll for (default: your active character).',
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
    console.log(`Registering /lore${guildId ? ` to guild ${guildId} (instant)` : ' globally (takes up to 1 hour)'}...`);
    await rest.post(route, { body: loreCommand });
    console.log('✓ Registered /lore successfully.');
    if (!guildId) {
      console.log('  Note: global commands can take up to 1 hour to appear in Discord.');
      console.log('  For instant testing, set DEV_GUILD_ID in your .env.');
    }
  } catch (err) {
    console.error('✗ Failed to register /lore:', err);
    if (err.rawError?.errors) {
      console.error('   Discord error details:', JSON.stringify(err.rawError.errors, null, 2));
    }
    process.exit(1);
  }
}

main();