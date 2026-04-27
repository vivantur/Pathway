// deploy-init-attack.js
// One-off slash-command registration: adds the new /init attack subcommand
// to your existing /init command WITHOUT touching its other subcommands.
//
// Run with: node deploy-init-attack.js
//
// HOW IT WORKS:
// Discord's slash-command system registers entire commands at once — you can't
// add a subcommand without re-uploading the whole /init command's structure.
// Since /init has many subcommands (start, add, addnpc, addmonster, next, list,
// hp, remove, effect, etc.) we don't want to redefine them all here and risk
// breaking something.
//
// Instead, this script:
//   1. Fetches your CURRENT /init command from Discord
//   2. Appends the new "attack" subcommand to its options array
//   3. Re-uploads the modified /init command (a partial update)
//
// This preserves every existing subcommand exactly as-is.
//
// Set DEV_GUILD_ID in your .env to register only to a specific server (instant).
// Without it, the command registers globally (takes up to 1 hour to propagate).

'use strict';

require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

// ── The new /init attack subcommand definition ──────────────────────────────
// This matches what /init's command handler in index.js expects:
//   monster (string, required, autocomplete) — combatant name in encounter
//   attack  (string, required, autocomplete) — attack name (e.g. "dogslicer")
//   target  (string, required, autocomplete) — combatant name to hit
//   bonus   (integer, optional)              — extra to-hit bonus (e.g. flanking)
//   map     (integer, optional, choice)      — multiple-attack penalty step
const newAttackSubcommand = {
  name: 'attack',
  description: 'Roll an NPC monster\'s bestiary attack against a target (GM only).',
  type: ApplicationCommandOptionType.Subcommand, // 1
  options: [
    {
      name: 'monster',
      description: 'Which NPC combatant in the encounter is attacking',
      type: ApplicationCommandOptionType.String, // 3
      required: true,
      autocomplete: true,
    },
    {
      name: 'attack',
      description: 'Which attack to use (e.g. "dogslicer", "jaws", "shortbow")',
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
    {
      name: 'target',
      description: 'Combatant being attacked',
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    },
    {
      name: 'bonus',
      description: 'Extra to-hit bonus (e.g. +2 from flanking)',
      type: ApplicationCommandOptionType.Integer, // 4
      required: false,
    },
    {
      name: 'map',
      description: 'Multiple-attack penalty step (auto-detected if not set)',
      type: ApplicationCommandOptionType.Integer,
      required: false,
      choices: [
        { name: '0 — first attack (no penalty)',          value: 0 },
        { name: '1 — second attack (-5, or -4 if Agile)', value: 1 },
        { name: '2 — third attack (-10, or -8 if Agile)', value: 2 },
      ],
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

    // 2. Find the /init command
    const initCommand = commands.find(c => c.name === 'init');
    if (!initCommand) {
      console.error('❌ Could not find /init command. Has it been deployed yet?');
      console.error('   This script PATCHES the existing /init — it cannot create one from scratch.');
      console.error('   You\'ll need to deploy the /init command first using your main deploy script.');
      process.exit(1);
    }

    console.log(`✓ Found /init with ${initCommand.options?.length ?? 0} existing subcommand(s).`);

    // 3. Check if 'attack' subcommand already exists — if so, replace it (idempotent)
    const existingOptions = Array.isArray(initCommand.options) ? [...initCommand.options] : [];
    const existingIdx = existingOptions.findIndex(o => o.name === 'attack');
    if (existingIdx >= 0) {
      console.log(`  ↺ /init attack already exists — updating it.`);
      existingOptions[existingIdx] = newAttackSubcommand;
    } else {
      console.log(`  + Adding /init attack as a new subcommand.`);
      existingOptions.push(newAttackSubcommand);
    }

    // 4. Re-upload the /init command with the modified options array.
    //    PATCH preserves the command id and merges the changes; we only send
    //    the fields we want to update (name, description, options).
    const updateRoute = guildId
      ? Routes.applicationGuildCommand(clientId, guildId, initCommand.id)
      : Routes.applicationCommand(clientId, initCommand.id);

    const patchBody = {
      name: initCommand.name,
      description: initCommand.description,
      options: existingOptions,
    };

    await rest.patch(updateRoute, { body: patchBody });
    console.log(`✓ Successfully ${existingIdx >= 0 ? 'updated' : 'added'} /init attack.`);
    console.log(`  /init now has ${existingOptions.length} subcommand(s).`);
    if (!guildId) {
      console.log('  Note: global commands can take up to 1 hour to appear in Discord.');
      console.log('  For instant testing, set DEV_GUILD_ID in your .env.');
    }
  } catch (err) {
    console.error('✗ Failed to register /init attack:', err);
    process.exit(1);
  }
}

main();