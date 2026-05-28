// deploy-bigpatch.js
// Omnibus deploy for the patch session. Registers/refreshes:
//
//   /m              — NEW. GM-friendly umbrella for monster admin.
//                      /m attack add/list/use/...   (was /monsterattack)
//                      /m roll save/skill           (was /monsterroll)
//   /monsterattack  — refreshed (its handler exists in index.js but was never
//                      registered before — the OG bug behind "There are no
//                      saved attacks"). Kept as alias for back-compat.
//   /monsterroll    — registered properly this round. Kept as alias.
//   /r              — alias for /roll. Same options.
//
// Existing /monster, /monsteredit, /monsteradd are NOT touched here — they
// already work and are deployed elsewhere.

'use strict';

require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID || null;

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing TOKEN or CLIENT_ID in environment.');
  console.error('  TOKEN:', TOKEN ? 'set' : 'MISSING');
  console.error('  CLIENT_ID:', CLIENT_ID ? 'set' : 'MISSING');
  process.exit(1);
}

// ── Shared option builders ──────────────────────────────────────────────────
// These match the option names used by the legacy handlers in index.js so the
// existing handlers work unchanged whether the user invoked /m attack add or
// the old /monsterattack add.

function buildAttackAddSub(s) {
  return s.setName('add')
    .setDescription('Save a strike (melee/ranged) for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name (matches bestiary if possible).').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name (e.g. "Bite", "Longsword").').setRequired(true))
    .addIntegerOption(o => o.setName('bonus').setDescription('Attack bonus (e.g. 8 for +8).').setRequired(true))
    .addStringOption(o => o.setName('damage').setDescription('Damage expression (e.g. 1d8+3 or 2d6).').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. slashing, fire). Defaults to "damage".').setRequired(false))
    .addStringOption(o => o.setName('traits').setDescription('Comma-separated traits (agile, reach, finesse...).').setRequired(false))
    .addStringOption(o => o.setName('extra_damage').setDescription('Extra damage dice (e.g. 1d6 for fire).').setRequired(false))
    .addStringOption(o => o.setName('extra_type').setDescription('Type for extra damage (e.g. fire).').setRequired(false));
}

function buildAttackAddSpellSub(s) {
  return s.setName('addspell')
    .setDescription('Save a spell attack for a monster (no MAP applies).')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Spell name (e.g. "Magic Missile").').setRequired(true))
    .addIntegerOption(o => o.setName('bonus').setDescription('Spell attack bonus.').setRequired(true))
    .addStringOption(o => o.setName('damage').setDescription('Damage expression (e.g. 4d6).').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. force, fire).').setRequired(false));
}

function buildAttackAddSaveSub(s) {
  return s.setName('addsave')
    .setDescription('Save a save-based attack for a monster (e.g. dragon breath).')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name (e.g. "Breath Weapon").').setRequired(true))
    .addStringOption(o => o.setName('save').setDescription('Save type targets must roll.').setRequired(true)
      .addChoices({ name: 'Fortitude', value: 'Fortitude' }, { name: 'Reflex', value: 'Reflex' }, { name: 'Will', value: 'Will' }))
    .addIntegerOption(o => o.setName('dc').setDescription('Save DC.').setRequired(true))
    .addStringOption(o => o.setName('damage').setDescription('Damage expression (e.g. 6d6).').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. fire).').setRequired(false));
}

function buildAttackRemoveSub(s) {
  return s.setName('remove')
    .setDescription('Remove a single saved attack from a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name to remove.').setRequired(true));
}

function buildAttackClearSub(s) {
  return s.setName('clear')
    .setDescription('Remove ALL saved attacks for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true));
}

function buildAttackListSub(s) {
  return s.setName('list')
    .setDescription('List saved attacks. Provide a monster to see its attacks; omit to list all monsters.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name (omit for all).').setRequired(false));
}

function buildAttackUseSub(s) {
  return s.setName('use')
    .setDescription('Roll a saved attack against a target.')
    .addStringOption(o => o.setName('attacker').setDescription('Combatant doing the attacking (must be in init).').setRequired(true))
    .addStringOption(o => o.setName('monster').setDescription('Which monster\'s attack to use (e.g. "Goblin Warrior").').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name (substring match OK).').setRequired(true))
    .addStringOption(o => o.setName('target').setDescription('Target combatant (required for strikes/spells, optional for saves).').setRequired(false))
    .addIntegerOption(o => o.setName('map').setDescription('Override MAP (0=first, 1=second, 2=third).').setRequired(false).setMinValue(0).setMaxValue(2));
}

function buildRollSaveSub(s) {
  return s.setName('save')
    .setDescription('Roll a save for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name (combatant in init OR bestiary entry).').setRequired(true))
    .addStringOption(o => o.setName('save').setDescription('Which save to roll.').setRequired(true)
      .addChoices(
        { name: 'Fortitude', value: 'fort' },
        { name: 'Reflex',    value: 'ref'  },
        { name: 'Will',      value: 'will' },
      ))
    .addIntegerOption(o => o.setName('dc').setDescription('DC to compare against (shows degree of success).').setRequired(false))
    .addBooleanOption(o => o.setName('public').setDescription('Show the result publicly instead of GM-only (default: false).').setRequired(false));
}

function buildRollSkillSub(s) {
  return s.setName('skill')
    .setDescription('Roll a skill check for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('skill').setDescription('Skill name (e.g. Stealth, Athletics — partial match OK).').setRequired(true))
    .addIntegerOption(o => o.setName('dc').setDescription('DC to compare against (shows degree of success).').setRequired(false))
    .addBooleanOption(o => o.setName('public').setDescription('Show the result publicly instead of GM-only (default: false).').setRequired(false));
}

// ── /m — umbrella command ──────────────────────────────────────────────────
const mCommand = new SlashCommandBuilder()
  .setName('m')
  .setDescription('GM monster admin. Try /m attack add, /m roll save, etc.')
  .addSubcommandGroup(g => g.setName('attack')
    .setDescription('Save and use reusable monster attacks.')
    .addSubcommand(buildAttackAddSub)
    .addSubcommand(buildAttackAddSpellSub)
    .addSubcommand(buildAttackAddSaveSub)
    .addSubcommand(buildAttackRemoveSub)
    .addSubcommand(buildAttackClearSub)
    .addSubcommand(buildAttackListSub)
    .addSubcommand(buildAttackUseSub))
  .addSubcommandGroup(g => g.setName('roll')
    .setDescription('Roll saves and skills for a monster.')
    .addSubcommand(buildRollSaveSub)
    .addSubcommand(buildRollSkillSub));

// ── /monsterattack — same options as /m attack, kept for back-compat ───────
const monsterAttackCommand = new SlashCommandBuilder()
  .setName('monsterattack')
  .setDescription('GM: save reusable attacks for monsters by name. (Alias: /m attack)')
  .addSubcommand(buildAttackAddSub)
  .addSubcommand(buildAttackAddSpellSub)
  .addSubcommand(buildAttackAddSaveSub)
  .addSubcommand(buildAttackRemoveSub)
  .addSubcommand(buildAttackClearSub)
  .addSubcommand(buildAttackListSub)
  .addSubcommand(buildAttackUseSub);

// ── /monsterroll — alias for /m roll ────────────────────────────────────────
const monsterRollCommand = new SlashCommandBuilder()
  .setName('monsterroll')
  .setDescription('GM: roll saves and skills for monsters. (Alias: /m roll)')
  .addSubcommand(buildRollSaveSub)
  .addSubcommand(buildRollSkillSub);

// ── /r — alias for /roll ────────────────────────────────────────────────────
const rCommand = new SlashCommandBuilder()
  .setName('r')
  .setDescription('Quick alias for /roll.')
  .addStringOption(o => o.setName('dice').setDescription('Dice expression. Supports @snippets and basic math.').setRequired(true))
  .addStringOption(o => o.setName('character').setDescription('Character whose snippets/portrait to use.').setRequired(false));

async function main() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const commands = [
    mCommand.toJSON(),
    monsterAttackCommand.toJSON(),
    monsterRollCommand.toJSON(),
    rCommand.toJSON(),
  ];
  const ourNames = new Set(commands.map(c => c.name));

  try {
    if (DEV_GUILD_ID) {
      console.log(`[deploy] Registering ${commands.length} commands to dev guild ${DEV_GUILD_ID}...`);
      const existing = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID));
      const filtered = existing.filter(c => !ourNames.has(c.name));
      const merged = [...filtered, ...commands];
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID), { body: merged });
      console.log('[deploy] ✅ Registered guild-locally — should appear immediately.');
    } else {
      console.log(`[deploy] Registering ${commands.length} commands globally...`);
      const existing = await rest.get(Routes.applicationCommands(CLIENT_ID));
      const filtered = existing.filter(c => !ourNames.has(c.name));
      const merged = [...filtered, ...commands];
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: merged });
      console.log('[deploy] ✅ Registered globally. Up to 1 hour for propagation; usually faster.');
    }

    console.log('\n[deploy] Registered:');
    console.log('  /m              — NEW umbrella for monster admin');
    console.log('  /monsterattack  — refreshed (was MISSING from any deploy before)');
    console.log('  /monsterroll    — refreshed');
    console.log('  /r              — alias for /roll');

    console.log('\n[deploy] Try in Discord:');
    console.log('  /m attack add monster:Goblin attack:Bite bonus:8 damage:1d6+3 type:slashing');
    console.log('  /m roll save monster:Goblin save:Reflex dc:18');
    console.log('  /m roll skill monster:Goblin skill:Stealth');
    console.log('  /r 1d20+5');
    console.log('\n  Old commands still work as aliases:');
    console.log('  /monsterattack add ...');
    console.log('  /monsterroll save ...');
  } catch (err) {
    console.error('[deploy] ❌ Failed:', err);
    process.exit(1);
  }
}

main();