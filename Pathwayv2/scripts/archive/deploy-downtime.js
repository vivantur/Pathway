// deploy-downtime.js
// Replaces the old activity-based /downtime command with a simple counter
// that auto-accrues 1 day per IRL calendar day (UTC), with manual grant/spend
// and an audit log.
//
// Subcommands:
//   /downtime check                            — show banked days + last accrual
//   /downtime spend days:N reason:X            — spend banked days
//   /downtime grant days:N reason:X            — manually add days (quest reward, etc.)
//   /downtime log                              — show last 10 audit entries
//   /downtime reset                            — wipe to 0 (acts of GM)
//
// Re-run this any time you change the subcommand schema. Discord deduplicates
// by command name, so it's safe to run repeatedly.

'use strict';

require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID || null;

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing TOKEN or CLIENT_ID in environment. Aborting.');
  console.error('  TOKEN:', TOKEN ? 'set' : 'MISSING');
  console.error('  CLIENT_ID:', CLIENT_ID ? 'set' : 'MISSING');
  process.exit(1);
}

const downtimeCommand = new SlashCommandBuilder()
  .setName('downtime')
  .setDescription('Track and spend downtime days. Auto-accrues 1 day per IRL day.')
  .addSubcommand(s => s.setName('check')
    .setDescription('Show how many downtime days you have banked.')
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)))
  .addSubcommand(s => s.setName('spend')
    .setDescription('Spend banked downtime days.')
    .addIntegerOption(o => o.setName('days').setDescription('Days to spend.').setRequired(true).setMinValue(1).setMaxValue(200))
    .addStringOption(o => o.setName('reason').setDescription('What you spent them on (logged for audit).').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)))
  .addSubcommand(s => s.setName('grant')
    .setDescription('Manually add downtime days (quest reward, GM gift, etc.).')
    .addIntegerOption(o => o.setName('days').setDescription('Days to grant.').setRequired(true).setMinValue(1).setMaxValue(200))
    .addStringOption(o => o.setName('reason').setDescription('Why (logged for audit — be honest!).').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)))
  .addSubcommand(s => s.setName('log')
    .setDescription('Show recent downtime activity (audit log).')
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)))
  .addSubcommand(s => s.setName('reset')
    .setDescription('Reset downtime to 0 (irreversible).')
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)));

async function main() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const commands = [downtimeCommand.toJSON()];

  try {
    if (DEV_GUILD_ID) {
      console.log(`[deploy] Registering /downtime to dev guild ${DEV_GUILD_ID}...`);
      const existing = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID));
      const filtered = existing.filter(c => c.name !== 'downtime');
      const merged = [...filtered, ...commands];
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID), { body: merged });
      console.log('[deploy] ✅ Registered /downtime to guild — should appear immediately.');
    } else {
      console.log('[deploy] Registering /downtime globally...');
      const existing = await rest.get(Routes.applicationCommands(CLIENT_ID));
      const filtered = existing.filter(c => c.name !== 'downtime');
      const merged = [...filtered, ...commands];
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: merged });
      console.log('[deploy] ✅ Registered /downtime globally.');
    }

    console.log('\n[deploy] Next steps:');
    console.log('  1. Replace commands/downtime.js with the new slim engine.');
    console.log('  2. Replace the /downtime handler block in index.js with the new snippet.');
    console.log('  3. Restart the bot (or push to git for Railway auto-deploy).');
    console.log('  4. Try: /downtime check, /downtime grant days:5 reason:test');
    console.log('\n  ⚠️  Old downtime.json data may have a different shape. If you see errors,');
    console.log('      rename the old file: mv data/downtime.json data/downtime.json.bak');
    console.log('      Players will start fresh from 0 — sorry, but the schema changed entirely.');
  } catch (err) {
    console.error('[deploy] ❌ Failed:', err);
    process.exit(1);
  }
}

main();