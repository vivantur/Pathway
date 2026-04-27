// deploy-char-cleanup.js
// One-off slash-command surgery: removes /char pdf, /char pastemsg, and
// /char pastemsgupdate from Discord, and updates /char update to accept
// either an `id:` (preferred, fetched from Pathbuilder) or `file:` parameter.
//
// HOW IT WORKS
// Discord registers slash commands as a single object per top-level command
// (/char), with subcommands as nested options. To remove subcommands you have
// to PATCH the entire /char definition. This script:
//   1. Fetches your CURRENT /char definition from Discord
//   2. Removes the three deleted subcommands from its options array
//   3. Replaces the `update` subcommand's options with new ones (id + file)
//   4. PATCHes /char back to Discord
//
// Run with: node deploy-char-cleanup.js
//
// Set DEV_GUILD_ID in your .env to register only to a specific server (instant).
// Without it, the change registers globally (takes up to 1 hour to propagate).

'use strict';

require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

// Subcommands we want to REMOVE entirely from /char
const SUBCOMMANDS_TO_REMOVE = ['pdf', 'pastemsg', 'pastemsgupdate'];

// New definition for /char update (replacing the file-only version)
const UPDATED_UPDATE_SUBCOMMAND = {
  name: 'update',
  description: 'Refresh an existing character. Pass id: to re-fetch from Pathbuilder, or file: as a fallback.',
  type: ApplicationCommandOptionType.Subcommand, // 1
  options: [
    {
      name: 'id',
      description: 'Pathbuilder character ID (6-digit number, e.g. 122550) — preferred path.',
      type: ApplicationCommandOptionType.Integer, // 4
      required: false,
    },
    {
      name: 'file',
      description: 'Pathbuilder .json or .txt export — used if no id is provided.',
      type: ApplicationCommandOptionType.Attachment, // 11
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
    // 1. Fetch all currently-registered commands
    console.log(`Fetching existing commands${guildId ? ` for guild ${guildId}` : ' (global)'}...`);
    const commands = await rest.get(listRoute);
    if (!Array.isArray(commands)) {
      console.error('Unexpected response from Discord (expected an array):', commands);
      process.exit(1);
    }

    // 2. Find the /char command
    const charCommand = commands.find(c => c.name === 'char');
    if (!charCommand) {
      console.error('❌ Could not find /char command. Has it been deployed yet?');
      console.error('   This script PATCHES the existing /char — it cannot create one from scratch.');
      process.exit(1);
    }

    console.log(`✓ Found /char with ${charCommand.options?.length ?? 0} existing subcommand(s).`);

    // 3. Filter out the three removed subcommands
    const existingOptions = Array.isArray(charCommand.options) ? [...charCommand.options] : [];
    const removedNames = [];
    let filtered = existingOptions.filter(o => {
      if (SUBCOMMANDS_TO_REMOVE.includes(o.name)) {
        removedNames.push(o.name);
        return false;
      }
      return true;
    });

    // 4. Replace the `update` subcommand with the new id+file version
    const updateIdx = filtered.findIndex(o => o.name === 'update');
    if (updateIdx >= 0) {
      console.log(`  ↺ Replacing /char update with new id+file definition.`);
      filtered[updateIdx] = UPDATED_UPDATE_SUBCOMMAND;
    } else {
      console.log(`  + /char update was missing — adding fresh.`);
      filtered.push(UPDATED_UPDATE_SUBCOMMAND);
    }

    // 5. Report what we're doing
    if (removedNames.length > 0) {
      console.log(`  - Removing: ${removedNames.map(n => `/char ${n}`).join(', ')}`);
    } else {
      console.log(`  · No subcommands to remove (already cleaned up?).`);
    }

    // 6. PATCH /char with the new options array
    const updateRoute = guildId
      ? Routes.applicationGuildCommand(clientId, guildId, charCommand.id)
      : Routes.applicationCommand(clientId, charCommand.id);

    const patchBody = {
      name: charCommand.name,
      description: charCommand.description,
      options: filtered,
    };

    await rest.patch(updateRoute, { body: patchBody });
    console.log(`✓ /char now has ${filtered.length} subcommand(s).`);
    console.log(`✓ Successfully cleaned up /char.`);
    if (!guildId) {
      console.log('  Note: global commands can take up to 1 hour to appear in Discord.');
      console.log('  For instant testing, set DEV_GUILD_ID in your .env.');
    }
  } catch (err) {
    console.error('✗ Failed to clean up /char:', err);
    if (err.rawError?.errors) {
      console.error('   Discord error details:', JSON.stringify(err.rawError.errors, null, 2));
    }
    process.exit(1);
  }
}

main();