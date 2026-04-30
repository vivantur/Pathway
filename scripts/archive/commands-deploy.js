// deploy.js
// Slash-command registration script.
//
// HOW THIS WORKS:
// This script POSTs each command in `commands` individually to Discord. POST
// to applicationCommands UPDATES a command if it exists (matched by name) or
// CREATES it if it doesn't. Other commands you didn't list here are left
// alone. This is the safe single-command update pattern.
//
// DO NOT switch this to rest.put(applicationCommands, { body: commands }) —
// that's a bulk overwrite. It deletes every command not in the array. Since
// most of your commands (/sheet, /init, /spell, etc.) were registered by
// earlier scripts and aren't defined in this file, a bulk PUT would wipe them.
//
// HOW TO ADD/UPDATE A COMMAND:
// 1. Add the handler in index.js as usual.
// 2. Define (or redefine) its SlashCommandBuilder in the `commands` array
//    below. You only need to include commands you're adding or changing.
// 3. Run `node deploy.js`.
// 4. Wait a minute or two (global commands propagate in ~minutes, occasionally
//    longer). Restart Discord client if you don't see the change.
//
// LONG-TERM PLAN:
// Phase 3 of the cleanup will turn each command handler into its own file
// under commands/ with its SlashCommandBuilder exported. Then this script
// will auto-load all of them. Until then, just edit the `commands` array
// when you change a command's schema.

'use strict';

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// ── /hp registration ────────────────────────────────────────────────────────
// We re-register the entire /hp command (all 5 subcommands) so Discord has
// the up-to-date schema. The new subcommand is `max`, for permanently
// overriding the computed max HP when the Pathbuilder import is wrong.
const commands = [
  new SlashCommandBuilder()
    .setName('hp')
    .setDescription('Out-of-combat HP tracking')
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('Show current/max HP and status')
      .addStringOption(opt => opt
        .setName('character')
        .setDescription('Character name (leave blank if you only have one)')
        .setRequired(false)
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set current HP to an exact value')
      .addIntegerOption(opt => opt
        .setName('value')
        .setDescription('New current HP (clamped to [0, max])')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(9999))
      .addStringOption(opt => opt
        .setName('character')
        .setDescription('Character name (leave blank if you only have one)')
        .setRequired(false)
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Heal (positive) or take damage (negative)')
      .addIntegerOption(opt => opt
        .setName('value')
        .setDescription('Amount to add. Use a negative number for damage.')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('character')
        .setDescription('Character name (leave blank if you only have one)')
        .setRequired(false)
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('reset')
      .setDescription('Fully heal to max HP')
      .addStringOption(opt => opt
        .setName('character')
        .setDescription('Character name (leave blank if you only have one)')
        .setRequired(false)
        .setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('max')
      .setDescription('Override max HP permanently (when import is wrong)')
      .addIntegerOption(opt => opt
        .setName('value')
        .setDescription('New max HP. Omit if using action:Clear override.')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(9999))
      .addStringOption(opt => opt
        .setName('action')
        .setDescription('Clear the override and use the computed max instead')
        .setRequired(false)
        .addChoices({ name: 'Clear override', value: 'clear' }))
      .addStringOption(opt => opt
        .setName('character')
        .setDescription('Character name (leave blank if you only have one)')
        .setRequired(false)
        .setAutocomplete(true)))
    .toJSON(),
];

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

  // IMPORTANT: We POST each command individually instead of doing a bulk PUT.
  //
  // Why: rest.put(applicationCommands, { body: commands }) is a BULK OVERWRITE
  // — Discord deletes any commands not in the body. Since this script only
  // contains the /hp definition (the rest of your commands were registered
  // earlier and we don't have their schemas in this file), a PUT would wipe
  // /sheet, /init, /spell, /xp, /char, /companion, /notes, /bag, /gold, etc.
  //
  // POST to applicationCommands with a single command UPDATES IN PLACE: if a
  // command with the same name already exists, Discord replaces it. If it
  // doesn't exist, it creates it. Either way, no other commands are touched.
  //
  // Per Discord docs:
  //   "Creating a command with the same name as an existing command for your
  //    application will overwrite the old command. Returns 201 if a command
  //    with the same name does not already exist, or a 200 if it does (in
  //    which case the previous command will be overwritten)."
  const guildId = process.env.DEV_GUILD_ID;
  const baseRoute = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  try {
    console.log(`Registering ${commands.length} command(s) individually${guildId ? ` to guild ${guildId}` : ' globally'}...`);
    for (const cmd of commands) {
      await rest.post(baseRoute, { body: cmd });
      console.log(`  ✓ /${cmd.name}`);
    }
    console.log('Done. Existing commands not in this script were left untouched.');
    if (!guildId) {
      console.log('Note: global commands can take up to 1 hour to propagate. Usually a few minutes.');
    }
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
}

main();