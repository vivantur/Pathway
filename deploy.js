'use strict';

// deploy.js — single source of truth for slash-command registration.
//
// HOW TO USE
//   npm run deploy           → register globally (may take up to 1 hour to propagate)
//   npm run deploy:guild     → register to DEV_GUILD_ID only (appears instantly — great for testing)
//
// WHAT THIS DOES
//   This script registers (or re-registers) the commands listed below.
//   It fetches whatever commands Discord already has, swaps out any whose
//   names match the ones defined here, then PUTs the merged set back.
//   Commands NOT defined here are left completely untouched — you can't
//   accidentally wipe your other bot commands by running this.
//
// WHEN TO RE-RUN
//   Run this any time you add a new slash command or change a command's
//   options / subcommands. You don't need to re-run just because you changed
//   how a command responds — only the schema (name, description, options)
//   needs to be re-registered with Discord.
//
// ADDING A NEW COMMAND
//   1. Add the handler in index.js as usual.
//   2. Define its SlashCommandBuilder below (copy an existing one as a template).
//   3. Add it to the `commands` array at the bottom.
//   4. Run `npm run deploy:guild` to test, then `npm run deploy` when ready.

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DEV_GUILD_ID = process.env.DEV_GUILD_ID || null;
const useGuild = process.argv.includes('--guild');

if (!TOKEN || !CLIENT_ID) {
  console.error('❌  Missing required environment variables:');
  console.error('    TOKEN:', TOKEN ? '✓ set' : '✗ MISSING');
  console.error('    CLIENT_ID:', CLIENT_ID ? '✓ set' : '✗ MISSING');
  console.error('\nMake sure you have a .env file (copy .env.example and fill it in).');
  process.exit(1);
}

if (useGuild && !DEV_GUILD_ID) {
  console.error('❌  --guild flag used but DEV_GUILD_ID is not set in your .env.');
  console.error('    Add DEV_GUILD_ID=your-server-id to your .env and try again.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared option helpers
// ─────────────────────────────────────────────────────────────────────────────
const charOpt = (cmd) => cmd.addStringOption(o => o.setName('character').setDescription('Character name (leave blank to use your active character)').setRequired(false).setAutocomplete(true));
const rankChoices = (o) => o.addChoices(
  { name: 'Untrained', value: 'untrained' },
  { name: 'Trained', value: 'trained' },
  { name: 'Expert', value: 'expert' },
  { name: 'Master', value: 'master' },
  { name: 'Legendary', value: 'legendary' },
);

// ─────────────────────────────────────────────────────────────────────────────
// /ping
// ─────────────────────────────────────────────────────────────────────────────
const pingCommand = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check if the bot is online.');

// ─────────────────────────────────────────────────────────────────────────────
// /br
// ─────────────────────────────────────────────────────────────────────────────
const brCommand = new SlashCommandBuilder()
  .setName('br')
  .setDescription('Post a visual scene-break divider (Avrae-style).')
  .addStringOption(o => o.setName('title').setDescription('Optional scene title to embed in the divider.').setRequired(false));

const breakCommand = new SlashCommandBuilder()
  .setName('break')
  .setDescription('Post a visual scene-break divider (Avrae-style).')
  .addStringOption(o => o.setName('title').setDescription('Optional scene title to embed in the divider.').setRequired(false));

// ─────────────────────────────────────────────────────────────────────────────
// /char
// ─────────────────────────────────────────────────────────────────────────────
const charCommand = new SlashCommandBuilder()
  .setName('char')
  .setDescription('Import and manage your character sheets.')
  // Import subcommands
  .addSubcommand(s => s.setName('add').setDescription('Import a new character from a Pathbuilder JSON file (.json or .txt).')
    .addAttachmentOption(o => o.setName('file').setDescription('Pathbuilder JSON file (.json or .txt)').setRequired(true)))
  .addSubcommand(s => s.setName('update').setDescription('Re-import from a Pathbuilder JSON file or ID, keeping HP/XP/overlay.')
    .addAttachmentOption(o => o.setName('file').setDescription('Updated Pathbuilder JSON file').setRequired(false))
    .addStringOption(o => o.setName('id').setDescription('Pathbuilder JSON ID or export URL').setRequired(false)))
  .addSubcommand(s => s.setName('import').setDescription('Import directly from your Pathbuilder JSON ID (requires bot to be whitelisted).')
    .addIntegerOption(o => o.setName('id').setDescription('Your 6-digit Pathbuilder share ID').setRequired(true).setMinValue(1).setMaxValue(99999999)))
  // View / management
  .addSubcommand(s => s.setName('list').setDescription('List all characters saved under your account.'))
  .addSubcommand(s => s.setName('active')
    .setDescription('Set or view your active (default) character.')
    .addStringOption(o => o.setName('character').setDescription('Character to make active (omit to view current)').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('action').setDescription('clear — remove active character setting').setRequired(false).addChoices({ name: 'Clear', value: 'clear' })))
  .addSubcommand(s => s.setName('remove').setDescription('Permanently delete a saved character.')
    .addStringOption(o => o.setName('name').setDescription('Exact character name to remove').setRequired(true)))
  .addSubcommand(s => s.setName('art')
    .setDescription('Set (or update) the portrait image URL for a character.')
    .addStringOption(o => o.setName('url').setDescription('Direct image URL (https://...)').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  // Editing subcommands
  .addSubcommand(s => s.setName('edit')
    .setDescription('Open a form to edit basic character info (name, portrait URL, notes).')
    .addStringOption(o => o.setName('character').setDescription('Character to edit').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('identity')
    .setDescription('Edit class, level, ancestry, and heritage via popup.')
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('misc')
    .setDescription('Edit gender, age, alignment, and key ability via popup.')
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('ability')
    .setDescription('Override one ability score (stored as score, not modifier).')
    .addStringOption(o => o.setName('field').setDescription('Which ability to set').setRequired(true).addChoices(
      { name: 'Strength', value: 'str' }, { name: 'Dexterity', value: 'dex' },
      { name: 'Constitution', value: 'con' }, { name: 'Intelligence', value: 'int' },
      { name: 'Wisdom', value: 'wis' }, { name: 'Charisma', value: 'cha' },
    ))
    .addStringOption(o => o.setName('action').setDescription('set (default) or clear the override').setRequired(false).addChoices({ name: 'Set', value: 'set' }, { name: 'Clear', value: 'clear' }))
    .addIntegerOption(o => o.setName('value').setDescription('Ability score (8–20 typical; modifier = (score−10)÷2)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('stat')
    .setDescription('Override a combat stat (AC, HP max, saves, etc.) shown on /sheet.')
    .addStringOption(o => o.setName('field').setDescription('Which stat to override').setRequired(true).addChoices(
      { name: 'AC', value: 'ac' }, { name: 'HP max', value: 'hpMax' },
      { name: 'Fortitude save', value: 'fortitude' }, { name: 'Reflex save', value: 'reflex' },
      { name: 'Will save', value: 'will' }, { name: 'Perception', value: 'perception' },
      { name: 'Speed', value: 'speed' },
    ))
    .addStringOption(o => o.setName('action').setDescription('set (default) or clear the override').setRequired(false).addChoices({ name: 'Set', value: 'set' }, { name: 'Clear', value: 'clear' }))
    .addIntegerOption(o => o.setName('value').setDescription('New value').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('skill')
    .setDescription('Override a skill proficiency rank (or set a flat total).')
    .addStringOption(o => o.setName('name').setDescription('Skill name (e.g. Stealth, Athletics)').setRequired(true))
    .addStringOption(o => rankChoices(o.setName('rank').setDescription('New proficiency rank').setRequired(false)))
    .addIntegerOption(o => o.setName('total').setDescription('Flat total bonus (overrides rank calculation if provided)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('lore')
    .setDescription('Add, edit, or remove a Lore skill (e.g. Lore: Farming).')
    .addStringOption(o => o.setName('topic').setDescription('Lore topic (e.g. Dragon, Farming, Absalom)').setRequired(true))
    .addStringOption(o => rankChoices(o.setName('rank').setDescription('Proficiency rank').setRequired(false)))
    .addIntegerOption(o => o.setName('total').setDescription('Flat total bonus').setRequired(false))
    .addBooleanOption(o => o.setName('remove').setDescription('Remove this lore skill instead').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('weapon')
    .setDescription('Add, edit, or remove a weapon / strike.')
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Edit', value: 'edit' }, { name: 'Remove', value: 'remove' }))
    .addStringOption(o => o.setName('name').setDescription('Weapon name (e.g. Longsword, Shortbow)').setRequired(true))
    .addIntegerOption(o => o.setName('attack').setDescription('Attack bonus (e.g. 8 for +8). Required when adding.').setRequired(false))
    .addStringOption(o => o.setName('damage').setDescription('Damage die expression (e.g. 1d8). Required when adding.').setRequired(false))
    .addStringOption(o => o.setName('type').setDescription('Damage type abbreviation: B, P, or S (or a word like slashing). Required when adding.').setRequired(false))
    .addStringOption(o => o.setName('traits').setDescription('Comma-separated traits (e.g. agile, reach, finesse)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('item')
    .setDescription('Add, edit, or remove an inventory item.')
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Edit', value: 'edit' }, { name: 'Remove', value: 'remove' }))
    .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true))
    .addIntegerOption(o => o.setName('quantity').setDescription('Quantity (default: 1)').setRequired(false).setMinValue(1))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('spellcasting')
    .setDescription('Override a spellcasting field (DC, attack bonus, tradition, key ability).')
    .addStringOption(o => o.setName('field').setDescription('Which field to set').setRequired(true).addChoices(
      { name: 'Spell DC', value: 'dc' }, { name: 'Spell attack', value: 'attack' },
      { name: 'Tradition', value: 'tradition' }, { name: 'Key ability', value: 'keyAbility' },
    ))
    .addStringOption(o => o.setName('action').setDescription('set (default) or clear the override').setRequired(false).addChoices({ name: 'Set', value: 'set' }, { name: 'Clear', value: 'clear' }))
    .addIntegerOption(o => o.setName('value').setDescription('Numeric value (for DC or attack)').setRequired(false))
    .addStringOption(o => o.setName('text_value').setDescription('Text value (for tradition or keyAbility)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('feat')
    .setDescription('Add or remove a feat on the character sheet.')
    .addStringOption(o => o.setName('action').setDescription('Add or remove').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }))
    .addStringOption(o => o.setName('name').setDescription('Feat name').setRequired(true))
    .addIntegerOption(o => o.setName('level').setDescription('Level at which the feat was taken (default: character level)').setRequired(false).setMinValue(1))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('hp')
    .setDescription('View, set current HP, or override max HP on the character sheet.')
    .addStringOption(o => o.setName('max').setDescription('New max HP, or "reset" to clear override').setRequired(false))
    .addIntegerOption(o => o.setName('current').setDescription('New current HP').setRequired(false).setMinValue(0))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('template').setDescription('Download a blank character template (.txt) to fill in manually.'));

// ─────────────────────────────────────────────────────────────────────────────
// /sheet
// ─────────────────────────────────────────────────────────────────────────────
const sheetCommand = new SlashCommandBuilder()
  .setName('sheet')
  .setDescription('Display your full character sheet.')
  .addStringOption(o => o.setName('name').setDescription('Character name (leave blank for active)').setRequired(false).setAutocomplete(true));

// ─────────────────────────────────────────────────────────────────────────────
// /portrait
// ─────────────────────────────────────────────────────────────────────────────
const portraitCommand = new SlashCommandBuilder()
  .setName('portrait')
  .setDescription('Show the current portrait art for a character.')
  .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true));

// ─────────────────────────────────────────────────────────────────────────────
// /snippet  /serversnippet
// ─────────────────────────────────────────────────────────────────────────────
const snippetCommand = new SlashCommandBuilder()
  .setName('snippet')
  .setDescription('Manage personal dice/text snippets used in /roll expressions.')
  .addSubcommand(s => s.setName('create').setDescription('Create or overwrite a snippet.')
    .addStringOption(o => o.setName('name').setDescription('Snippet name (e.g. "athletics")').setRequired(true))
    .addStringOption(o => o.setName('expand').setDescription('What it expands to (e.g. "1d20+8")').setRequired(true)))
  .addSubcommand(s => s.setName('list').setDescription('List all your snippets.'))
  .addSubcommand(s => s.setName('view').setDescription('View a single snippet.')
    .addStringOption(o => o.setName('name').setDescription('Snippet name').setRequired(true)))
  .addSubcommand(s => s.setName('delete').setDescription('Delete a snippet.')
    .addStringOption(o => o.setName('name').setDescription('Snippet name').setRequired(true)));

const serversnippetCommand = new SlashCommandBuilder()
  .setName('serversnippet')
  .setDescription('Manage server-wide snippets (GM/admin-level).')
  .addSubcommand(s => s.setName('create').setDescription('Create or overwrite a server snippet.')
    .addStringOption(o => o.setName('name').setDescription('Snippet name').setRequired(true))
    .addStringOption(o => o.setName('expand').setDescription('What it expands to').setRequired(true)))
  .addSubcommand(s => s.setName('list').setDescription('List all server snippets.'))
  .addSubcommand(s => s.setName('view').setDescription('View a single server snippet.')
    .addStringOption(o => o.setName('name').setDescription('Snippet name').setRequired(true)))
  .addSubcommand(s => s.setName('delete').setDescription('Delete a server snippet.')
    .addStringOption(o => o.setName('name').setDescription('Snippet name').setRequired(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /spellbook  /prepared
// ─────────────────────────────────────────────────────────────────────────────
const spellbookCommand = new SlashCommandBuilder()
  .setName('spellbook')
  .setDescription("View a character's full spell list.")
  .addStringOption(o => o.setName('name').setDescription('Character name').setRequired(false).setAutocomplete(true));

const preparedCommand = new SlashCommandBuilder()
  .setName('prepared')
  .setDescription("View a prepared-caster's today-prep list.")
  .addStringOption(o => o.setName('name').setDescription('Character name').setRequired(false).setAutocomplete(true));

// ─────────────────────────────────────────────────────────────────────────────
// /spell
// ─────────────────────────────────────────────────────────────────────────────
const spellCommand = new SlashCommandBuilder()
  .setName('spell')
  .setDescription('Look up a spell from the database.')
  .addStringOption(o => o.setName('name').setDescription('Spell name (partial match OK)').setRequired(true).setAutocomplete(true));

// ─────────────────────────────────────────────────────────────────────────────
// /cast
// ─────────────────────────────────────────────────────────────────────────────
const castCommand = new SlashCommandBuilder()
  .setName('cast')
  .setDescription('Cast a spell: rolls attack/save, applies damage, tracks slot usage.')
  .addStringOption(o => o.setName('spell').setDescription('Spell name').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('character').setDescription('Caster (default: active character)').setRequired(false).setAutocomplete(true))
  .addIntegerOption(o => o.setName('level').setDescription('Cast at this rank (for heightening; default: base rank)').setRequired(false).setMinValue(1).setMaxValue(10))
  .addStringOption(o => o.setName('target').setDescription('Single target combatant name').setRequired(false))
  .addStringOption(o => o.setName('targets').setDescription('Comma-separated list of target names (multi-target; overrides target:)').setRequired(false));

// ─────────────────────────────────────────────────────────────────────────────
// /help
// ─────────────────────────────────────────────────────────────────────────────
const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Get help on a command or topic.')
  .addStringOption(o => o.setName('topic').setDescription('Command or topic to get help on').setRequired(false).setAutocomplete(true));

// ─────────────────────────────────────────────────────────────────────────────
// /spells
// ─────────────────────────────────────────────────────────────────────────────
const spellsCommand = new SlashCommandBuilder()
  .setName('spells')
  .setDescription('Manage learned and prepared spells for a character.')
  .addSubcommand(s => s.setName('learn').setDescription('Add a spell to the known/cantrip list.')
    .addStringOption(o => o.setName('spell').setDescription('Spell name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('caster').setDescription('Which caster (if character has multiple)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('forget').setDescription('Remove a spell from the known list.')
    .addStringOption(o => o.setName('spell').setDescription('Spell name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('caster').setDescription('Which caster').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('prepare').setDescription('Mark a spell as prepared today (prepared casters).')
    .addStringOption(o => o.setName('spell').setDescription('Spell name').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('rank').setDescription('Rank to prepare at').setRequired(true).setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName('caster').setDescription('Which caster').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('unprepare').setDescription('Remove a prepared spell from today\'s list.')
    .addStringOption(o => o.setName('spell').setDescription('Spell name').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('rank').setDescription('Rank to unprepare').setRequired(true).setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName('caster').setDescription('Which caster').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('swap').setDescription('Replace one prepared spell with another (prepared casters).')
    .addStringOption(o => o.setName('remove').setDescription('Spell to remove from prep list').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('add').setDescription('Spell to prepare instead').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('rank').setDescription('Rank slot to swap').setRequired(true).setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName('caster').setDescription('Which caster').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /rest  /refocus  /resource
// ─────────────────────────────────────────────────────────────────────────────
const restCommand = new SlashCommandBuilder()
  .setName('rest')
  .setDescription('Take a full rest: refill spell slots, focus, and reset hero points to 1.')
  .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true));

const refocusCommand = new SlashCommandBuilder()
  .setName('refocus')
  .setDescription('Spend 10 minutes refocusing: restore 1 focus point.')
  .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true));

const resourceCommand = new SlashCommandBuilder()
  .setName('resource')
  .setDescription('View or manually set daily resources (spell slots, focus, hero points).')
  .addSubcommand(s => s.setName('show').setDescription('Display all current daily resources.')
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('set').setDescription('Manually set a specific resource.')
    .addStringOption(o => o.setName('resource').setDescription('Which resource to set').setRequired(true).addChoices(
      { name: 'Focus points', value: 'focus' },
      { name: 'Hero points', value: 'hero' },
      { name: 'Spell slot rank', value: 'slot' },
    ))
    .addIntegerOption(o => o.setName('value').setDescription('New value').setRequired(true).setMinValue(0))
    .addIntegerOption(o => o.setName('rank').setDescription('Spell slot rank (required when resource=slot)').setRequired(false).setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName('caster').setDescription('Caster name (required when character has multiple casters)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /diagnose
// ─────────────────────────────────────────────────────────────────────────────
const diagnoseCommand = new SlashCommandBuilder()
  .setName('diagnose')
  .setDescription('Show a diagnostic dump of your saved character data.')
  .addBooleanOption(o => o.setName('download').setDescription('(Bot owner only) Download the full characters.json as an attachment.').setRequired(false));

// ─────────────────────────────────────────────────────────────────────────────
// /mattack
// ─────────────────────────────────────────────────────────────────────────────
const mattackCommand = new SlashCommandBuilder()
  .setName('mattack')
  .setDescription('GM: manually roll an attack for a combatant in initiative.')
  .addStringOption(o => o.setName('attacker').setDescription('Combatant doing the attacking').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('name').setDescription('Attack name').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('target').setDescription('Target combatant name').setRequired(true).setAutocomplete(true))
  .addIntegerOption(o => o.setName('bonus').setDescription('Manual attack bonus; optional when using a saved attack.').setRequired(false))
  .addStringOption(o => o.setName('damage').setDescription('Manual damage expression; optional when using a saved attack.').setRequired(false))
  .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. slashing, fire). Default: damage').setRequired(false))
  .addIntegerOption(o => o.setName('map').setDescription('Override MAP (0=first, 1=second, 2=third attack)').setRequired(false).setMinValue(0).setMaxValue(2))
  .addBooleanOption(o => o.setName('agile').setDescription('Is the weapon agile? (MAP is −4/−8 instead of −5/−10)').setRequired(false));

// ─────────────────────────────────────────────────────────────────────────────
// /roll
// ─────────────────────────────────────────────────────────────────────────────
const rollCommand = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Roll dice with snippet expansion (e.g. /roll 1d20+@hylia.athletics).')
  .addStringOption(o => o.setName('dice').setDescription('Dice expression (supports @snippets and basic math)').setRequired(true))
  .addStringOption(o => o.setName('character').setDescription('Character whose snippets/portrait to use').setRequired(false).setAutocomplete(true));

// ─────────────────────────────────────────────────────────────────────────────
// /skill  /perception  /initiative  /save
// ─────────────────────────────────────────────────────────────────────────────
const skillCommand = new SlashCommandBuilder()
  .setName('skill')
  .setDescription('Roll a skill check using your character\'s proficiency.')
  .addStringOption(o => o.setName('skill').setDescription('Skill name (e.g. Athletics, Stealth)').setRequired(true).setAutocomplete(true))
  .addIntegerOption(o => o.setName('bonus').setDescription('Extra bonus/penalty (e.g. 2 for Bless, -1 for Sickened)').setRequired(false))
  .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true));

const perceptionCommand = new SlashCommandBuilder()
  .setName('perception')
  .setDescription('Roll a Perception check.')
  .addIntegerOption(o => o.setName('bonus').setDescription('Extra bonus or penalty').setRequired(false))
  .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true));

const initiativeCommand = new SlashCommandBuilder()
  .setName('initiative')
  .setDescription('Roll initiative (defaults to Perception; use skill: to override).')
  .addStringOption(o => o.setName('skill').setDescription('Override with a different skill (e.g. Stealth for an ambush)').setRequired(false).setAutocomplete(true))
  .addIntegerOption(o => o.setName('bonus').setDescription('Extra bonus or penalty').setRequired(false))
  .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true));

const saveCommand = new SlashCommandBuilder()
  .setName('save')
  .setDescription('Roll a saving throw using your character\'s proficiency.')
  .addStringOption(o => o.setName('type').setDescription('Save type').setRequired(true).addChoices(
    { name: 'Fortitude', value: 'fortitude' },
    { name: 'Reflex', value: 'reflex' },
    { name: 'Will', value: 'will' },
  ))
  .addIntegerOption(o => o.setName('bonus').setDescription('Extra bonus or penalty').setRequired(false))
  .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true));

// ─────────────────────────────────────────────────────────────────────────────
// Lookup commands
// ─────────────────────────────────────────────────────────────────────────────
const ancestryCommand = new SlashCommandBuilder()
  .setName('ancestry')
  .setDescription('Look up an ancestry from the game database.')
  .addStringOption(o => o.setName('name').setDescription('Ancestry name (e.g. Elf, Human, Gnome)').setRequired(true).setAutocomplete(true));

const archetypeCommand = new SlashCommandBuilder()
  .setName('archetype')
  .setDescription('Look up an archetype from the game database.')
  .addStringOption(o => o.setName('name').setDescription('Archetype name (partial match OK)').setRequired(true).setAutocomplete(true));

const backgroundCommand = new SlashCommandBuilder()
  .setName('background')
  .setDescription('Look up a background from the game database.')
  .addStringOption(o => o.setName('name').setDescription('Background name (partial match OK)').setRequired(true).setAutocomplete(true));

const featCommand = new SlashCommandBuilder()
  .setName('feat')
  .setDescription('Look up a feat from the game database.')
  .addStringOption(o => o.setName('name').setDescription('Feat name (partial match OK)').setRequired(true).setAutocomplete(true))
  .addIntegerOption(o => o.setName('level').setDescription('Filter by level (useful when multiple feats share a name)').setRequired(false).setMinValue(1).setMaxValue(20));

const itemCommand = new SlashCommandBuilder()
  .setName('item')
  .setDescription('Look up an item from the game database.')
  .addStringOption(o => o.setName('name').setDescription('Item name (partial match OK)').setRequired(true).setAutocomplete(true))
  .addIntegerOption(o => o.setName('level').setDescription('Filter by item level').setRequired(false).setMinValue(0).setMaxValue(25));

const ruleCommand = new SlashCommandBuilder()
  .setName('rule')
  .setDescription('Look up a rule entry from the game database.')
  .addStringOption(o => o.setName('name').setDescription('Rule name (partial match OK)').setRequired(true).setAutocomplete(true));

const conditionCommand = new SlashCommandBuilder()
  .setName('condition')
  .setDescription('Look up a PF2e condition (e.g. grabbed, frightened, off-guard).')
  .addStringOption(o => o.setName('name').setDescription('Condition name (partial match OK)').setRequired(true).setAutocomplete(true));

const heritageCommand = new SlashCommandBuilder()
  .setName('heritage')
  .setDescription('Look up a heritage (Anvil Dwarf, Aiuvarin, Dhampir, etc.) — 322 in the database.')
  .addStringOption(o => o.setName('name').setDescription('Heritage name (partial match OK)').setRequired(true).setAutocomplete(true));

const deityCommand = new SlashCommandBuilder()
  .setName('deity')
  .setDescription('Look up a deity from the game database.')
  .addStringOption(o => o.setName('name').setDescription('Deity name (partial match OK)').setRequired(true).setAutocomplete(true));

const skillinfoCommand = new SlashCommandBuilder()
  .setName('skillinfo')
  .setDescription('Look up full details on a skill (actions, DCs, uses).')
  .addStringOption(o => o.setName('skill').setDescription('Skill name').setRequired(true).setAutocomplete(true));

const referenceCommand = (name, description, optionDescription = 'Name to look up') => new SlashCommandBuilder()
  .setName(name)
  .setDescription(description)
  .addStringOption(o => o.setName('name').setDescription(optionDescription).setRequired(true).setAutocomplete(true));

const actionCommand = referenceCommand('action', 'Look up a PF2e action or activity.', 'Action or activity name');
const hazardCommand = referenceCommand('hazard', 'Look up a PF2e hazard.', 'Hazard name');
const ritualCommand = referenceCommand('ritual', 'Look up a PF2e ritual.', 'Ritual name');
const traitCommand = referenceCommand('trait', 'Look up a PF2e trait.', 'Trait name');
const afflictionCommand = referenceCommand('affliction', 'Look up a PF2e curse or disease.', 'Affliction name');
const languageCommand = referenceCommand('language', 'Look up a PF2e language.', 'Language name');
const domainCommand = referenceCommand('domain', 'Look up a PF2e deity domain.', 'Domain name');
const planeCommand = referenceCommand('plane', 'Look up a PF2e plane.', 'Plane name');
const relicCommand = referenceCommand('relic', 'Look up a PF2e relic or relic gift.', 'Relic or gift name');
const familiarCommand = referenceCommand('familiar', 'Look up familiar abilities and specific familiars.', 'Familiar entry name');
const vehicleCommand = referenceCommand('vehicle', 'Look up a PF2e vehicle.', 'Vehicle name');
const siegeCommand = referenceCommand('siege', 'Look up a PF2e siege weapon.', 'Siege weapon name');
const kingdomCommand = referenceCommand('kingdom', 'Look up kingdom structures and events.', 'Kingdom entry name');
const classfeatureCommand = referenceCommand('classfeature', 'Look up class features and class options.', 'Class feature or option name');
const creatureextraCommand = referenceCommand('creatureextra', 'Look up creature abilities and adjustments.', 'Creature ability or adjustment name');
const sourcebookCommand = referenceCommand('sourcebook', 'Look up PF2e source books and products.', 'Source name');

const classCommand = new SlashCommandBuilder()
  .setName('class')
  .setDescription('Look up a class from the game database.')
  .addStringOption(o => o.setName('name').setDescription('Class name (e.g. Fighter, Wizard)').setRequired(true).setAutocomplete(true));

// ─────────────────────────────────────────────────────────────────────────────
// /companion
// ─────────────────────────────────────────────────────────────────────────────
const companionCommand = new SlashCommandBuilder()
  .setName('companion')
  .setDescription('Manage animal companions and eidolons.')
  .addSubcommand(s => s.setName('info').setDescription('Look up a companion type from the database.')
    .addStringOption(o => o.setName('name').setDescription('Companion type (e.g. "cat", "wolf")').setRequired(true).setAutocomplete(true)))
  .addSubcommand(s => s.setName('list').setDescription('List all available companion types.')
    .addStringOption(o => o.setName('category').setDescription('Filter by category (e.g. "Animal Companion", "Eidolon")').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('add').setDescription("Add a companion to a character's tracker.")
    .addStringOption(o => o.setName('name').setDescription('Display name for this companion (e.g. "Shadow" or "Fluffy")').setRequired(true))
    .addStringOption(o => o.setName('base').setDescription('Companion type or bestiary name (e.g. "wolf", "horse")').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('form').setDescription('Companion form/stage').setRequired(false).addChoices({ name: 'Young', value: 'young' }, { name: 'Mature', value: 'mature' }, { name: 'Nimble', value: 'nimble' }, { name: 'Savage', value: 'savage' }))
    .addBooleanOption(o => o.setName('custom').setDescription('Use a bestiary creature as a custom homebrew companion base').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character this companion belongs to').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('mine').setDescription("List your character's tracked companions.")
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('sheet').setDescription("Display a companion's stat block.")
    .addStringOption(o => o.setName('name').setDescription('Companion display name (leave blank for active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('active').setDescription("Set which companion is currently active.")
    .addStringOption(o => o.setName('name').setDescription('Companion display name').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('remove').setDescription("Remove a companion from tracking.")
    .addStringOption(o => o.setName('name').setDescription('Companion display name').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('use').setDescription("Use the active companion in this encounter (same as /init add companion:name).")
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  // ── Editing ──────────────────────────────────────────────────────────────
  // The following subcommands let you fix or customize companion stats. Most
  // come from the bestiary scale automatically, but bestiary entries can be
  // wrong, missing, or you may want a homebrew tweak. Every override is
  // remembered across re-imports (we preserve companions on /char update now).

  .addSubcommand(s => s.setName('set').setDescription('Override a single stat (HP, AC, ability score, save, attack, etc.).')
    .addStringOption(o => o.setName('stat').setDescription('Which stat to override').setRequired(true).addChoices(
      { name: 'HP (max)',       value: 'hp' },
      { name: 'AC',             value: 'ac' },
      { name: 'Perception',     value: 'perception' },
      { name: 'Speed',          value: 'speed' },
      { name: 'Size',           value: 'size' },
      { name: 'Strength',       value: 'str' },
      { name: 'Dexterity',      value: 'dex' },
      { name: 'Constitution',   value: 'con' },
      { name: 'Intelligence',   value: 'int' },
      { name: 'Wisdom',         value: 'wis' },
      { name: 'Charisma',       value: 'cha' },
      { name: 'Fortitude save', value: 'fort' },
      { name: 'Reflex save',    value: 'ref' },
      { name: 'Will save',      value: 'will' },
      { name: 'Attack bonus',   value: 'attack' },
      { name: 'Damage dice',    value: 'damage_dice' },
      { name: 'Damage bonus',   value: 'damage_bonus' },
    ))
    .addStringOption(o => o.setName('value').setDescription('New value (number for most; e.g. "1d8" for damage_dice; "Medium" for size)').setRequired(true))
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  .addSubcommand(s => s.setName('reset').setDescription('Clear one stat override (revert to auto-calculated).')
    .addStringOption(o => o.setName('stat').setDescription('Which stat to reset').setRequired(true).addChoices(
      { name: 'HP',           value: 'hp' },
      { name: 'AC',           value: 'ac' },
      { name: 'Perception',   value: 'perception' },
      { name: 'Speed',        value: 'speed' },
      { name: 'Size',         value: 'size' },
      { name: 'Strength',     value: 'str' },
      { name: 'Dexterity',    value: 'dex' },
      { name: 'Constitution', value: 'con' },
      { name: 'Intelligence', value: 'int' },
      { name: 'Wisdom',       value: 'wis' },
      { name: 'Charisma',     value: 'cha' },
      { name: 'Fortitude',    value: 'fort' },
      { name: 'Reflex',       value: 'ref' },
      { name: 'Will',         value: 'will' },
      { name: 'Attack bonus', value: 'attack' },
      { name: 'Damage dice',  value: 'damage_dice' },
      { name: 'Damage bonus', value: 'damage_bonus' },
    ))
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  .addSubcommand(s => s.setName('resetall').setDescription('Clear ALL stat overrides on a companion.')
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  .addSubcommand(s => s.setName('attack').setDescription('Add, remove, or list custom attacks (e.g. a wyvern\'s stinger alongside its jaws).')
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true).addChoices(
      { name: 'Add an attack',    value: 'add' },
      { name: 'Remove an attack', value: 'remove' },
      { name: 'List attacks',     value: 'list' },
    ))
    .addStringOption(o => o.setName('name').setDescription('Attack name (e.g. "Stinger", "Tail Slap")').setRequired(false))
    .addIntegerOption(o => o.setName('bonus').setDescription('To-hit bonus (e.g. 6 for +6). Required when adding.').setRequired(false))
    .addStringOption(o => o.setName('damage').setDescription('Damage expression (e.g. "1d6+2"). Required when adding.').setRequired(false))
    .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. piercing, slashing, B/P/S, fire)').setRequired(false))
    .addStringOption(o => o.setName('traits').setDescription('Comma-separated traits (e.g. "agile, finesse, reach")').setRequired(false))
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  .addSubcommand(s => s.setName('ability').setDescription('Add, remove, or list special abilities (Support Benefit, Unsteady Mount, etc.).')
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true).addChoices(
      { name: 'Add an ability',    value: 'add' },
      { name: 'Remove an ability', value: 'remove' },
      { name: 'List abilities',    value: 'list' },
    ))
    .addStringOption(o => o.setName('name').setDescription('Ability name (e.g. "Support Benefit", "Pounce")').setRequired(false))
    .addStringOption(o => o.setName('description').setDescription('Description of what it does (required when adding)').setRequired(false))
    .addStringOption(o => o.setName('action_cost').setDescription('Action cost').setRequired(false).addChoices(
      { name: '◆ One Action',     value: 'one-action' },
      { name: '◆◆ Two Actions',   value: 'two-actions' },
      { name: '◆◆◆ Three Actions', value: 'three-actions' },
      { name: '⤾ Reaction',        value: 'reaction' },
      { name: '◇ Free Action',     value: 'free-action' },
    ))
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  .addSubcommand(s => s.setName('skill').setDescription('Set, clear, or list trained skills (Acrobatics, Stealth, etc.).')
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true).addChoices(
      { name: 'Set a skill bonus', value: 'set' },
      { name: 'Clear a skill',     value: 'clear' },
      { name: 'List skills',       value: 'list' },
    ))
    .addStringOption(o => o.setName('name').setDescription('Skill name (e.g. "Athletics", "Stealth")').setRequired(false))
    .addStringOption(o => o.setName('bonus').setDescription('Total skill bonus (e.g. "8" or "-1"). Required for set.').setRequired(false))
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  .addSubcommand(s => s.setName('notes').setDescription('Set or clear free-form notes (use for senses, languages, items, etc.).')
    .addStringOption(o => o.setName('text').setDescription('Note text (or "clear" to remove)').setRequired(true))
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  .addSubcommand(s => s.setName('hp').setDescription('Adjust the companion\'s current HP.')
    .addIntegerOption(o => o.setName('change').setDescription('Damage (negative) or healing (positive). E.g. -5 or 10.').setRequired(false))
    .addIntegerOption(o => o.setName('set').setDescription('Set current HP to a specific value (overrides change).').setRequired(false))
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  .addSubcommand(s => s.setName('form').setDescription('Change the companion\'s form (Young / Mature / Nimble / Savage).')
    .addStringOption(o => o.setName('form').setDescription('New form').setRequired(true).addChoices(
      { name: 'Young',  value: 'young' },
      { name: 'Mature', value: 'mature' },
      { name: 'Nimble', value: 'nimble' },
      { name: 'Savage', value: 'savage' },
    ))
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  .addSubcommand(s => s.setName('art').setDescription('Set or clear a companion\'s portrait image.')
    .addStringOption(o => o.setName('url').setDescription('Direct image URL (https://...) or "clear" to remove').setRequired(true))
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))

  .addSubcommand(s => s.setName('roll').setDescription('Roll an attack, skill check, save, or Perception with the companion.')
    .addStringOption(o => o.setName('action').setDescription('What kind of roll').setRequired(true).addChoices(
      { name: '⚔️ Attack',           value: 'attack' },
      { name: '🎯 Skill check',       value: 'skill' },
      { name: '🛡️ Saving throw',      value: 'save' },
      { name: '👁️ Perception',        value: 'perception' },
    ))
    .addStringOption(o => o.setName('name').setDescription('For attack: which attack. For skill: which skill (e.g. Athletics).').setRequired(false))
    .addStringOption(o => o.setName('save_type').setDescription('For save: fortitude, reflex, or will').setRequired(false).addChoices(
      { name: 'Fortitude', value: 'fortitude' },
      { name: 'Reflex',    value: 'reflex' },
      { name: 'Will',      value: 'will' },
    ))
    .addStringOption(o => o.setName('target').setDescription('For attack: target combatant in the current encounter (auto-resolves hit + damage).').setRequired(false))
    .addIntegerOption(o => o.setName('dc').setDescription('For skill/save/perception: DC to compare against (shows degree of success).').setRequired(false))
    .addIntegerOption(o => o.setName('bonus').setDescription('Extra circumstance bonus to add (e.g. flanking +2)').setRequired(false))
    .addIntegerOption(o => o.setName('map').setDescription('For attack: MAP step. 0=first, 1=second (-5/-4 agile), 2=third (-10/-8 agile).').setRequired(false).setMinValue(0).setMaxValue(2))
    .addBooleanOption(o => o.setName('agile').setDescription('For attack: treat as agile weapon (override auto-detection from traits).').setRequired(false))
    .addStringOption(o => o.setName('companion').setDescription('Companion display name (default: active)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /monster  /monsteradd  /monsterart  /monsteredit
// ─────────────────────────────────────────────────────────────────────────────
const monsterCommand = new SlashCommandBuilder()
  .setName('monster')
  .setDescription('Look up a creature from the bestiary.')
  .addStringOption(o => o.setName('name').setDescription('Creature name (partial match OK)').setRequired(true).setAutocomplete(true));

const monsteraddCommand = new SlashCommandBuilder()
  .setName('monsteradd')
  .setDescription('(Bot owner) Add a homebrew creature to the global bestiary.')
  .addSubcommand(s => s.setName('paste').setDescription('Parse a stat block pasted as text.')
    .addStringOption(o => o.setName('statblock').setDescription('The full stat block text').setRequired(true)))
  .addSubcommand(s => s.setName('file').setDescription('Parse a stat block from a .txt file attachment.')
    .addAttachmentOption(o => o.setName('file').setDescription('Plain-text stat block file (.txt)').setRequired(true)))
  .addSubcommand(s => s.setName('remove').setDescription('Remove a homebrew creature from the bestiary.')
    .addStringOption(o => o.setName('monster').setDescription('Creature name to remove').setRequired(true)));

const monsterartCommand = new SlashCommandBuilder()
  .setName('monsterart')
  .setDescription('Set or remove a custom portrait for a monster on this server.')
  .addSubcommand(s => s.setName('set').setDescription('Set a portrait image URL for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name').setRequired(true))
    .addStringOption(o => o.setName('url').setDescription('Direct image URL (https://...)').setRequired(true)))
  .addSubcommand(s => s.setName('remove').setDescription('Remove the saved portrait for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name').setRequired(true)));

const monstereditCommand = new SlashCommandBuilder()
  .setName('monsteredit')
  .setDescription('Add abilities, items, languages, or skill overrides to a bestiary creature on this server.')
  .addSubcommand(s => s.setName('ability').setDescription('Add or replace a named ability on a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name').setRequired(true))
    .addStringOption(o => o.setName('name').setDescription('Ability name').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Ability text').setRequired(false))
    .addStringOption(o => o.setName('action_cost').setDescription('Action cost symbol (e.g. 1, 2, reaction, free)').setRequired(false))
    .addStringOption(o => o.setName('trigger').setDescription('Reaction/free-action trigger text').setRequired(false))
    .addStringOption(o => o.setName('traits').setDescription('Comma-separated traits').setRequired(false))
    .addStringOption(o => o.setName('slot').setDescription('Where to insert (default: mid)').setRequired(false).addChoices({ name: 'Top', value: 'top' }, { name: 'Middle', value: 'mid' }, { name: 'Bottom', value: 'bot' })))
  .addSubcommand(s => s.setName('item').setDescription('Add a carried item to a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true)))
  .addSubcommand(s => s.setName('language').setDescription('Add a language to a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name').setRequired(true))
    .addStringOption(o => o.setName('language').setDescription('Language name').setRequired(true)))
  .addSubcommand(s => s.setName('skill').setDescription('Override a skill bonus on a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name').setRequired(true))
    .addStringOption(o => o.setName('skill').setDescription('Skill name').setRequired(true))
    .addIntegerOption(o => o.setName('bonus').setDescription('New bonus (e.g. 8 for +8)').setRequired(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /spelladd  /itemadd
// ─────────────────────────────────────────────────────────────────────────────
const spelladdCommand = new SlashCommandBuilder()
  .setName('spelladd')
  .setDescription('(Bot owner) Add or remove a homebrew spell in the global database.')
  .addSubcommand(s => s.setName('paste').setDescription('Parse a spell stat block pasted as text.')
    .addStringOption(o => o.setName('statblock').setDescription('Full spell stat block text').setRequired(true)))
  .addSubcommand(s => s.setName('file').setDescription('Parse a spell stat block from a .txt file.')
    .addAttachmentOption(o => o.setName('file').setDescription('Plain-text stat block file').setRequired(true)))
  .addSubcommand(s => s.setName('remove').setDescription('Remove a homebrew spell.')
    .addStringOption(o => o.setName('spell').setDescription('Spell name to remove').setRequired(true)));

const itemaddCommand = new SlashCommandBuilder()
  .setName('itemadd')
  .setDescription('(Bot owner) Add or remove a homebrew item in the global database.')
  .addSubcommand(s => s.setName('paste').setDescription('Parse an item stat block pasted as text.')
    .addStringOption(o => o.setName('statblock').setDescription('Full item stat block text').setRequired(true)))
  .addSubcommand(s => s.setName('file').setDescription('Parse an item stat block from a .txt file.')
    .addAttachmentOption(o => o.setName('file').setDescription('Plain-text stat block file').setRequired(true)))
  .addSubcommand(s => s.setName('remove').setDescription('Remove a homebrew item.')
    .addStringOption(o => o.setName('item').setDescription('Item name to remove').setRequired(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /bag
// ─────────────────────────────────────────────────────────────────────────────
const bagCommand = new SlashCommandBuilder()
  .setName('bag')
  .setDescription('Manage your inventory bag (shared across characters).')
  .addSubcommand(s => s.setName('view').setDescription('Show everything in your bag.'))
  .addSubcommand(s => s.setName('rename').setDescription('Give your bag a custom name.')
    .addStringOption(o => o.setName('name').setDescription('New bag name').setRequired(true)))
  .addSubcommand(s => s.setName('add').setDescription('Add an item to the bag.')
    .addStringOption(o => o.setName('category').setDescription('Category (e.g. Weapons, Consumables, Gear)').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true))
    .addIntegerOption(o => o.setName('qty').setDescription('Quantity (default: 1)').setRequired(false).setMinValue(1)))
  .addSubcommand(s => s.setName('remove').setDescription('Remove an item from the bag.')
    .addStringOption(o => o.setName('category').setDescription('Category the item is in').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true))
    .addIntegerOption(o => o.setName('qty').setDescription('Quantity to remove (omit to remove whole stack)').setRequired(false).setMinValue(1)))
  .addSubcommand(s => s.setName('removecategory').setDescription('Remove an entire category from the bag.')
    .addStringOption(o => o.setName('category').setDescription('Category to remove').setRequired(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /gold
// ─────────────────────────────────────────────────────────────────────────────
const goldCommand = new SlashCommandBuilder()
  .setName('gold')
  .setDescription('Track currency (platinum, gold, silver, copper) for a character.')
  .addSubcommand(s => s.setName('view').setDescription('Show current wallet.')
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('add').setDescription('Add currency (use negative values to subtract).')
    .addIntegerOption(o => o.setName('pp').setDescription('Platinum pieces').setRequired(false))
    .addIntegerOption(o => o.setName('gp').setDescription('Gold pieces').setRequired(false))
    .addIntegerOption(o => o.setName('sp').setDescription('Silver pieces').setRequired(false))
    .addIntegerOption(o => o.setName('cp').setDescription('Copper pieces').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('spend').setDescription('Spend currency (checks you can afford it).')
    .addIntegerOption(o => o.setName('pp').setDescription('Platinum pieces').setRequired(false))
    .addIntegerOption(o => o.setName('gp').setDescription('Gold pieces').setRequired(false))
    .addIntegerOption(o => o.setName('sp').setDescription('Silver pieces').setRequired(false))
    .addIntegerOption(o => o.setName('cp').setDescription('Copper pieces').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('convert').setDescription('Convert between denominations.')
    .addStringOption(o => o.setName('from').setDescription('Currency to convert from').setRequired(true).addChoices(
      { name: 'Platinum (pp)', value: 'pp' }, { name: 'Gold (gp)', value: 'gp' },
      { name: 'Silver (sp)', value: 'sp' }, { name: 'Copper (cp)', value: 'cp' },
    ))
    .addStringOption(o => o.setName('to').setDescription('Currency to convert to').setRequired(true).addChoices(
      { name: 'Platinum (pp)', value: 'pp' }, { name: 'Gold (gp)', value: 'gp' },
      { name: 'Silver (sp)', value: 'sp' }, { name: 'Copper (cp)', value: 'cp' },
    ))
    .addIntegerOption(o => o.setName('amount').setDescription('How many to convert').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('set').setDescription('Set exact coin amounts (overwrites current values).')
    .addIntegerOption(o => o.setName('pp').setDescription('Platinum pieces').setRequired(false))
    .addIntegerOption(o => o.setName('gp').setDescription('Gold pieces').setRequired(false))
    .addIntegerOption(o => o.setName('sp').setDescription('Silver pieces').setRequired(false))
    .addIntegerOption(o => o.setName('cp').setDescription('Copper pieces').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /hero
// ─────────────────────────────────────────────────────────────────────────────
const heroCommand = new SlashCommandBuilder()
  .setName('hero')
  .setDescription('Track and spend Hero Points (max 3 per session).')
  .addSubcommand(s => s.setName('view').setDescription('Show current hero points.')
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('add').setDescription('Award hero points (GM).')
    .addIntegerOption(o => o.setName('amount').setDescription('How many to award (default: 1)').setRequired(false).setMinValue(1))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('spend').setDescription('Spend hero points.')
    .addIntegerOption(o => o.setName('amount').setDescription('How many to spend (default: 1)').setRequired(false).setMinValue(1))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('set').setDescription('Set hero points to a specific value.')
    .addIntegerOption(o => o.setName('value').setDescription('New hero point total').setRequired(true).setMinValue(0))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('reset').setDescription('Reset to 1 (for a new session).')
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('reroll').setDescription('Spend 1 hero point to reroll a check (keep higher).')
    .addStringOption(o => o.setName('dice').setDescription('Dice expression to reroll (e.g. 1d20+8)').setRequired(true))
    .addIntegerOption(o => o.setName('previous').setDescription('Your original roll total (to compare and keep higher)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /xp
// ─────────────────────────────────────────────────────────────────────────────
const xpCommand = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('Track experience points (1000 XP = level up).')
  .addSubcommand(s => s.setName('view').setDescription('Show current XP and log.')
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('award').setDescription('Award (or deduct) XP.')
    .addIntegerOption(o => o.setName('amount').setDescription('XP to award (negative to deduct)').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('What this XP is for (saved in log)').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('set').setDescription('Set XP to an exact value.')
    .addIntegerOption(o => o.setName('amount').setDescription('New XP total (0–999)').setRequired(true).setMinValue(0))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('reset').setDescription('Reset XP to 0 and clear the log (after leveling up).')
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /notes
// ─────────────────────────────────────────────────────────────────────────────
const notesCommand = new SlashCommandBuilder()
  .setName('notes')
  .setDescription('Per-character session notebook (NPCs, locations, plot threads, etc.).')
  .addSubcommand(s => s.setName('add').setDescription('Add a note.')
    .addStringOption(o => o.setName('category').setDescription('Category (e.g. NPCs, Locations, Plot Threads, Items)').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('text').setDescription('Note content').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('list').setDescription('List all notes, grouped by category.')
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('view').setDescription('View a specific note by ID.')
    .addIntegerOption(o => o.setName('id').setDescription('Note ID (shown in /notes list)').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('search').setDescription('Search notes by keyword.')
    .addStringOption(o => o.setName('query').setDescription('Search term').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('edit').setDescription('Edit a note.')
    .addIntegerOption(o => o.setName('id').setDescription('Note ID').setRequired(true))
    .addStringOption(o => o.setName('text').setDescription('New note text').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('remove').setDescription('Delete a note.')
    .addIntegerOption(o => o.setName('id').setDescription('Note ID').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('pin').setDescription('Pin or unpin a note (pinned notes appear at the top).')
    .addIntegerOption(o => o.setName('id').setDescription('Note ID').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /hp
// ─────────────────────────────────────────────────────────────────────────────
const hpCommand = new SlashCommandBuilder()
  .setName('hp')
  .setDescription('Out-of-combat HP tracking')
  .addSubcommand(sub => sub
    .setName('view')
    .setDescription('Show current/max HP and status')
    .addStringOption(opt => opt.setName('character').setDescription('Character name (leave blank if you only have one)').setRequired(false).setAutocomplete(true)))
  .addSubcommand(sub => sub
    .setName('set')
    .setDescription('Set current HP to an exact value')
    .addIntegerOption(opt => opt.setName('value').setDescription('New current HP (clamped to [0, max])').setRequired(true).setMinValue(0).setMaxValue(9999))
    .addStringOption(opt => opt.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Heal (positive) or take damage (negative)')
    .addIntegerOption(opt => opt.setName('value').setDescription('Amount to add. Use a negative number for damage.').setRequired(true))
    .addStringOption(opt => opt.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(sub => sub
    .setName('reset')
    .setDescription('Fully heal to max HP')
    .addStringOption(opt => opt.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)))
  .addSubcommand(sub => sub
    .setName('max')
    .setDescription('Override max HP permanently (when import is wrong)')
    .addIntegerOption(opt => opt.setName('value').setDescription('New max HP. Omit to clear the override.').setRequired(false).setMinValue(1).setMaxValue(9999))
    .addStringOption(opt => opt.setName('action').setDescription('Clear the override and use the computed max instead').setRequired(false).addChoices({ name: 'Clear override', value: 'clear' }))
    .addStringOption(opt => opt.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /monsterattack
// ─────────────────────────────────────────────────────────────────────────────
const monsterAttackCommand = new SlashCommandBuilder()
  .setName('monsterattack')
  .setDescription('GM: save reusable attacks for monsters by name. Used by /init attack and /monsterattack use.')
  .addSubcommand(s => s.setName('add')
    .setDescription('Save a strike (melee/ranged) for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name (matches bestiary if possible).').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name (e.g. "Bite", "Longsword").').setRequired(true))
    .addIntegerOption(o => o.setName('bonus').setDescription('Attack bonus (e.g. 8 for +8).').setRequired(true))
    .addStringOption(o => o.setName('damage').setDescription('Damage expression (e.g. 1d8+3 or 2d6).').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. slashing, fire). Defaults to "damage".').setRequired(false))
    .addStringOption(o => o.setName('traits').setDescription('Comma-separated traits (agile, reach, finesse...).').setRequired(false))
    .addStringOption(o => o.setName('extra_damage').setDescription('Extra damage dice (e.g. 1d6 for fire).').setRequired(false))
    .addStringOption(o => o.setName('extra_type').setDescription('Type for extra damage (e.g. fire).').setRequired(false)))
  .addSubcommand(s => s.setName('addspell')
    .setDescription('Save a spell attack for a monster (no MAP applies).')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Spell name (e.g. "Magic Missile").').setRequired(true))
    .addIntegerOption(o => o.setName('bonus').setDescription('Spell attack bonus.').setRequired(true))
    .addStringOption(o => o.setName('damage').setDescription('Damage expression (e.g. 4d6).').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. force, fire).').setRequired(false)))
  .addSubcommand(s => s.setName('addsave')
    .setDescription('Save a save-based attack for a monster (e.g. dragon breath).')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name (e.g. "Breath Weapon").').setRequired(true))
    .addStringOption(o => o.setName('save').setDescription('Save type targets must roll.').setRequired(true)
      .addChoices({ name: 'Fortitude', value: 'Fortitude' }, { name: 'Reflex', value: 'Reflex' }, { name: 'Will', value: 'Will' }))
    .addIntegerOption(o => o.setName('dc').setDescription('Save DC.').setRequired(true))
    .addStringOption(o => o.setName('damage').setDescription('Damage expression (e.g. 6d6).').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Damage type (e.g. fire).').setRequired(false)))
  .addSubcommand(s => s.setName('remove')
    .setDescription('Remove a single saved attack from a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name to remove.').setRequired(true)))
  .addSubcommand(s => s.setName('clear')
    .setDescription('Remove ALL saved attacks for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true)))
  .addSubcommand(s => s.setName('list')
    .setDescription('List saved attacks. Provide a monster to see its attacks; omit to list all monsters.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name (omit for all).').setRequired(false)))
  .addSubcommand(s => s.setName('use')
    .setDescription('Roll a saved attack against a target.')
    .addStringOption(o => o.setName('attacker').setDescription('Combatant doing the attacking (must be in init).').setRequired(true))
    .addStringOption(o => o.setName('monster').setDescription('Which monster\'s attack to use (e.g. "Goblin Warrior").').setRequired(true))
    .addStringOption(o => o.setName('attack').setDescription('Attack name (substring match OK).').setRequired(true))
    .addStringOption(o => o.setName('target').setDescription('Target combatant (required for strikes/spells, optional for saves).').setRequired(false))
    .addIntegerOption(o => o.setName('map').setDescription('Override MAP (0=first attack, 1=second, 2=third).').setRequired(false).setMinValue(0).setMaxValue(2)));

// ─────────────────────────────────────────────────────────────────────────────
// /monsterroll
// ─────────────────────────────────────────────────────────────────────────────
const monsterRollCommand = new SlashCommandBuilder()
  .setName('monsterroll')
  .setDescription('GM: roll saves and skills for monsters (works in or out of initiative).')
  .addSubcommand(s => s.setName('save')
    .setDescription('Roll a save for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name (combatant in init OR bestiary entry).').setRequired(true))
    .addStringOption(o => o.setName('save').setDescription('Which save to roll.').setRequired(true)
      .addChoices(
        { name: 'Fortitude', value: 'fort' },
        { name: 'Reflex',    value: 'ref'  },
        { name: 'Will',      value: 'will' },
      ))
    .addIntegerOption(o => o.setName('dc').setDescription('DC to compare against (shows degree of success).').setRequired(false))
    .addBooleanOption(o => o.setName('public').setDescription('Set to false to keep this roll GM-only (default: true, visible to all).').setRequired(false)))
  .addSubcommand(s => s.setName('skill')
    .setDescription('Roll a skill check for a monster.')
    .addStringOption(o => o.setName('monster').setDescription('Monster name.').setRequired(true))
    .addStringOption(o => o.setName('skill').setDescription('Skill name (e.g. Stealth, Athletics — partial match OK).').setRequired(true))
    .addIntegerOption(o => o.setName('dc').setDescription('DC to compare against (shows degree of success).').setRequired(false))
    .addBooleanOption(o => o.setName('public').setDescription('Set to false to keep this roll GM-only (default: true, visible to all).').setRequired(false)));

// ─────────────────────────────────────────────────────────────────────────────
// /r (quick alias for /roll)
// ─────────────────────────────────────────────────────────────────────────────
const mCommand = new SlashCommandBuilder()
  .setName('m')
  .setDescription('GM: quick monster actions.')
  .addSubcommand(s => s.setName('save')
    .setDescription('Roll a save for a monster or v2 combatant.')
    .addStringOption(o => o.setName('monster').setDescription('Monster/combatant name.').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('save').setDescription('Which save to roll.').setRequired(true)
      .addChoices(
        { name: 'Fortitude', value: 'fort' },
        { name: 'Reflex', value: 'ref' },
        { name: 'Will', value: 'will' },
      ))
    .addIntegerOption(o => o.setName('dc').setDescription('DC to compare against.').setRequired(false))
    .addBooleanOption(o => o.setName('public').setDescription('Set false for GM-only. Default true.').setRequired(false)))
  .addSubcommand(s => s.setName('skill')
    .setDescription('Roll a skill check for a monster or v2 combatant.')
    .addStringOption(o => o.setName('monster').setDescription('Monster/combatant name.').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('skill').setDescription('Skill name.').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('dc').setDescription('DC to compare against.').setRequired(false))
    .addBooleanOption(o => o.setName('public').setDescription('Set false for GM-only. Default true.').setRequired(false)))
  .addSubcommand(s => s.setName('cast')
    .setDescription('Cast a monster spell or save-based ability in combat v2.')
    .addStringOption(o => o.setName('monster').setDescription('Casting combatant.').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('spell').setDescription('Spell or ability name.').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('target').setDescription('Target combatant.').setRequired(false).setAutocomplete(true))
    .addIntegerOption(o => o.setName('level').setDescription('Cast at this rank.').setRequired(false).setMinValue(1).setMaxValue(10))
    .addIntegerOption(o => o.setName('dc').setDescription('Override spell/ability DC.').setRequired(false))
    .addIntegerOption(o => o.setName('attack_bonus').setDescription('Override spell attack bonus.').setRequired(false))
    .addStringOption(o => o.setName('damage').setDescription('Manual damage expression, e.g. 4d6.').setRequired(false))
    .addStringOption(o => o.setName('save').setDescription('Manual save type for abilities.').setRequired(false)
      .addChoices(
        { name: 'Fortitude', value: 'fort' },
        { name: 'Reflex', value: 'ref' },
        { name: 'Will', value: 'will' },
      ))
    .addBooleanOption(o => o.setName('public').setDescription('Set false for GM-only. Default true.').setRequired(false)))
  .addSubcommand(s => s.setName('ability')
    .setDescription('Use a monster ability that calls for a target save.')
    .addStringOption(o => o.setName('monster').setDescription('Acting combatant.').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('name').setDescription('Ability name, e.g. Vitality Drain.').setRequired(true))
    .addStringOption(o => o.setName('target').setDescription('Target combatant.').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('save').setDescription('Target save.').setRequired(true)
      .addChoices(
        { name: 'Fortitude', value: 'fort' },
        { name: 'Reflex', value: 'ref' },
        { name: 'Will', value: 'will' },
      ))
    .addIntegerOption(o => o.setName('dc').setDescription('Save DC.').setRequired(true))
    .addStringOption(o => o.setName('damage').setDescription('Optional damage expression, e.g. 4d6.').setRequired(false))
    .addStringOption(o => o.setName('type').setDescription('Damage type, e.g. void, mental, poison.').setRequired(false))
    .addBooleanOption(o => o.setName('basic').setDescription('Apply basic-save damage scaling. Default true if damage is present.').setRequired(false))
    .addStringOption(o => o.setName('notes').setDescription('Effect reminder shown after the save.').setRequired(false))
    .addBooleanOption(o => o.setName('public').setDescription('Set false for GM-only. Default true.').setRequired(false)))
  .addSubcommand(s => s.setName('attacks')
    .setDescription('List a monster combatant\'s attacks and spells.')
    .addStringOption(o => o.setName('monster').setDescription('Monster/combatant name.').setRequired(true).setAutocomplete(true))
    .addBooleanOption(o => o.setName('public').setDescription('Set false for GM-only. Default true.').setRequired(false)));

const rCommand = new SlashCommandBuilder()
  .setName('r')
  .setDescription('Quick alias for /roll. Roll dice with snippet expansion (e.g. /r 1d20+@hylia.athletics).')
  .addStringOption(o => o.setName('dice').setDescription('Dice expression. Supports @snippets and basic math.').setRequired(true))
  .addStringOption(o => o.setName('character').setDescription('Character whose snippets/portrait to use.').setRequired(false).setAutocomplete(true));

// ─────────────────────────────────────────────────────────────────────────────
// /attack
// ─────────────────────────────────────────────────────────────────────────────
const attackCommand = new SlashCommandBuilder()
  .setName('attack')
  .setDescription('Roll a weapon strike for your character (auto-MAP, effect modifiers, damage on hit).')
  .addStringOption(o => o.setName('weapon').setDescription('Weapon name (partial match OK)').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('target').setDescription('Target combatant name (required to apply damage)').setRequired(false))
  .addIntegerOption(o => o.setName('bonus').setDescription('Extra attack bonus or penalty').setRequired(false))
  .addIntegerOption(o => o.setName('map').setDescription('Override MAP (0=first, 1=second, 2=third attack)').setRequired(false).setMinValue(0).setMaxValue(2))
  .addBooleanOption(o => o.setName('no_map').setDescription('Skip MAP entirely (e.g. Flurry of Blows)').setRequired(false))
  .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(false).setAutocomplete(true));

// ─────────────────────────────────────────────────────────────────────────────
// /init
// ─────────────────────────────────────────────────────────────────────────────
const initCommand = new SlashCommandBuilder()
  .setName('init')
  .setDescription('Initiative and combat tracker.')
  // ── Encounter management ──
  .addSubcommand(s => s.setName('start').setDescription('Start a new encounter in this channel.'))
  .addSubcommand(s => s.setName('end').setDescription('End the current encounter and clear the tracker.'))
  .addSubcommand(s => s.setName('next').setDescription('Advance to the next combatant\'s turn.'))
  .addSubcommand(s => s.setName('prev').setDescription('Move back to the previous combatant\'s turn.'))
  .addSubcommand(s => s.setName('view').setDescription('Show the current combat tracker.'))
  .addSubcommand(s => s.setName('list').setDescription('Show the current initiative order and HP.'))
  // ── Adding combatants ──
  .addSubcommand(s => s.setName('add')
    .setDescription('Add yourself, a PC, companion, NPC, or monster to initiative.')
    .addStringOption(o => o.setName('kind').setDescription('Combatant type for combat v2.').setRequired(false).addChoices(
      { name: 'Player', value: 'pc' },
      { name: 'Companion', value: 'companion' },
      { name: 'Monster', value: 'monster' },
      { name: 'NPC', value: 'npc' },
    ))
    .addStringOption(o => o.setName('name').setDescription('Name or lookup query for combat v2.').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('companion').setDescription('Add a companion instead (e.g. "Shadow")').setRequired(false))
    .addIntegerOption(o => o.setName('bonus').setDescription('Override initiative bonus (default: your Perception)').setRequired(false))
    .addIntegerOption(o => o.setName('result').setDescription('Use this exact initiative result instead of rolling').setRequired(false))
    .addIntegerOption(o => o.setName('hp').setDescription('HP for NPCs/custom combatants.').setRequired(false).setMinValue(1))
    .addIntegerOption(o => o.setName('ac').setDescription('AC for NPCs/custom combatants.').setRequired(false))
    .addIntegerOption(o => o.setName('count').setDescription('How many copies to add for monsters/NPCs.').setRequired(false).setMinValue(1).setMaxValue(50))
    .addStringOption(o => o.setName('group').setDescription('Shared group label for same-initiative creatures.').setRequired(false))
    .addStringOption(o => o.setName('character').setDescription('Character to add (default: active)').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('addnpc')
    .setDescription('GM: add a custom NPC/monster to initiative.')
    .addStringOption(o => o.setName('name').setDescription('NPC name (must be unique in this encounter)').setRequired(true))
    .addIntegerOption(o => o.setName('hp').setDescription('HP').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('ac').setDescription('AC').setRequired(false))
    .addIntegerOption(o => o.setName('bonus').setDescription('Initiative bonus (default 0)').setRequired(false))
    .addIntegerOption(o => o.setName('result').setDescription('Use this exact initiative result instead of rolling').setRequired(false)))
  .addSubcommand(s => s.setName('addmonster')
    .setDescription('GM: add a bestiary creature to initiative (auto-fills HP/AC/perception).')
    .addStringOption(o => o.setName('monster').setDescription('Monster name (partial match OK)').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('count').setDescription('How many to add (auto-numbered; default 1)').setRequired(false).setMinValue(1).setMaxValue(20))
    .addStringOption(o => o.setName('init_mode').setDescription('Initiative mode (default: per_copy)').setRequired(false).addChoices({ name: 'One roll shared by all copies', value: 'shared' }, { name: 'One roll per copy', value: 'per_copy' }))
    .addStringOption(o => o.setName('hp_mode').setDescription('HP mode (default: fixed)').setRequired(false).addChoices({ name: 'Published HP exactly', value: 'fixed' }, { name: '±5 random variation', value: 'varied' }))
    .addIntegerOption(o => o.setName('bonus').setDescription('Override initiative bonus (default: creature perception)').setRequired(false))
    .addIntegerOption(o => o.setName('result').setDescription('Use this exact initiative result instead of rolling').setRequired(false)))
  .addSubcommand(s => s.setName('remove')
    .setDescription('Remove a combatant from the encounter.')
    .addStringOption(o => o.setName('name').setDescription('Combatant name').setRequired(true)))
  .addSubcommand(s => s.setName('modify')
    .setDescription('GM: modify a combat v2 combatant.')
    .addStringOption(o => o.setName('name').setDescription('Combatant to modify').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('new_name').setDescription('Rename this combatant').setRequired(false))
    .addIntegerOption(o => o.setName('initiative').setDescription('Set initiative count').setRequired(false))
    .addIntegerOption(o => o.setName('hp').setDescription('Set current HP').setRequired(false).setMinValue(0))
    .addIntegerOption(o => o.setName('max_hp').setDescription('Set max HP').setRequired(false).setMinValue(1))
    .addIntegerOption(o => o.setName('ac').setDescription('Set AC').setRequired(false))
    .addBooleanOption(o => o.setName('hidden').setDescription('Hide stats from players').setRequired(false))
    .addStringOption(o => o.setName('group').setDescription('Set group/horde label; blank clears it').setRequired(false))
    .addIntegerOption(o => o.setName('fort').setDescription('Set Fortitude modifier').setRequired(false))
    .addIntegerOption(o => o.setName('ref').setDescription('Set Reflex modifier').setRequired(false))
    .addIntegerOption(o => o.setName('will').setDescription('Set Will modifier').setRequired(false))
    .addStringOption(o => o.setName('resistances').setDescription('Comma list like fire 5, cold 10, all 2').setRequired(false))
    .addStringOption(o => o.setName('weaknesses').setDescription('Comma list like vitality 5, fire 10').setRequired(false))
    .addStringOption(o => o.setName('immunities').setDescription('Comma list like poison, paralyzed').setRequired(false))
    .addStringOption(o => o.setName('notes').setDescription('GM notes shown in combatant details').setRequired(false)))
  // ── GM attack ──
  .addSubcommand(s => s.setName('attack')
    .setDescription('Roll the current combatant\'s attack with smart defaults.')
    .addStringOption(o => o.setName('monster').setDescription('Attacker override (defaults to your/current combatant)').setRequired(false))
    .addStringOption(o => o.setName('attack').setDescription('Attack override (defaults to first/primary attack)').setRequired(false))
    .addStringOption(o => o.setName('target').setDescription('Target override (defaults to first opposing combatant)').setRequired(false))
    .addIntegerOption(o => o.setName('bonus').setDescription('Extra attack bonus or penalty').setRequired(false))
    .addIntegerOption(o => o.setName('map').setDescription('Override MAP (0=first, 1=second, 2=third attack)').setRequired(false).setMinValue(0).setMaxValue(2)))
  // ── HP in combat ──
  .addSubcommand(s => s.setName('hp')
    .setDescription('Apply HP change to a combatant (positive = heal, negative = damage).')
    .addStringOption(o => o.setName('name').setDescription('Combatant name').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('change').setDescription('HP change (positive to heal, negative to damage)').setRequired(true)))
  .addSubcommand(s => s.setName('thp')
    .setDescription('Set temporary HP on a combatant.')
    .addStringOption(o => o.setName('name').setDescription('Combatant name').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Temporary HP amount').setRequired(true).setMinValue(0)))
  // ── Effects / conditions ──
  .addSubcommand(s => s.setName('effect')
    .setDescription('Apply an effect or condition to a combatant.')
    .addStringOption(o => o.setName('target').setDescription('Combatant name').setRequired(true))
    .addStringOption(o => o.setName('name').setDescription('Effect/condition name (preset or custom — see /init conditions)').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('value').setDescription('Scaling value (e.g. Frightened 2 → value: 2)').setRequired(false))
    .addIntegerOption(o => o.setName('duration').setDescription('Duration in rounds (omit for permanent)').setRequired(false).setMinValue(1))
    .addIntegerOption(o => o.setName('attack_bonus').setDescription('Custom attack modifier').setRequired(false))
    .addIntegerOption(o => o.setName('damage_bonus').setDescription('Custom damage modifier').setRequired(false))
    .addIntegerOption(o => o.setName('ac_bonus').setDescription('Custom AC modifier').setRequired(false))
    .addIntegerOption(o => o.setName('save_bonus').setDescription('Custom save modifier').setRequired(false))
    .addIntegerOption(o => o.setName('skill_bonus').setDescription('Custom skill modifier').setRequired(false))
    .addStringOption(o => o.setName('description').setDescription('Description for custom effects').setRequired(false)))
  .addSubcommand(s => s.setName('removeeffect')
    .setDescription('Remove a specific effect from a combatant.')
    .addStringOption(o => o.setName('target').setDescription('Combatant name').setRequired(true))
    .addStringOption(o => o.setName('name').setDescription('Effect name to remove').setRequired(true).setAutocomplete(true)))
  .addSubcommand(s => s.setName('effects')
    .setDescription('Show all active effects on a combatant.')
    .addStringOption(o => o.setName('target').setDescription('Combatant name').setRequired(true)))
  .addSubcommand(s => s.setName('conditions')
    .setDescription('List all available PF2e preset conditions you can apply with /init effect.'))
  // ── Movement / reactions ──
  .addSubcommand(s => s.setName('move')
    .setDescription('Declare a combatant moved — prompts anyone with a reaction to respond.')
    .addStringOption(o => o.setName('name').setDescription('Combatant moving').setRequired(true)))
  .addSubcommand(s => s.setName('reaction')
    .setDescription('Prompt a specific combatant to use their reaction.')
    .addStringOption(o => o.setName('name').setDescription('Combatant to prompt').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('What triggered the reaction').setRequired(false)))
  // ── Death / dying ──
  .addSubcommand(s => s.setName('dying')
    .setDescription('GM: manually set a combatant\'s dying value (0–4).')
    .addStringOption(o => o.setName('name').setDescription('Combatant name').setRequired(true))
    .addIntegerOption(o => o.setName('value').setDescription('New dying value (0 = stable)').setRequired(true).setMinValue(0).setMaxValue(4)))
  .addSubcommand(s => s.setName('recovery')
    .setDescription('Manually roll a recovery check for a dying combatant.')
    .addStringOption(o => o.setName('name').setDescription('Dying combatant name').setRequired(true)))
  // ── Persistent damage ──
  .addSubcommand(s => s.setName('damage')
    .setDescription('Manually roll persistent damage for a combatant outside the normal turn tick.')
    .addStringOption(o => o.setName('name').setDescription('Combatant name').setRequired(true)))
  // ── Delay / rejoin ──
  .addSubcommand(s => s.setName('delay')
    .setDescription('Delay your turn (PF2e Delay action — rejoin later with /init rejoin).'))
  .addSubcommand(s => s.setName('rejoin')
    .setDescription('Rejoin initiative after delaying.')
    .addStringOption(o => o.setName('name').setDescription('Delayed combatant name').setRequired(true))
    .addStringOption(o => o.setName('target').setDescription('Rejoin just before this combatant (omit to act now)').setRequired(false)));

const iCommand = new SlashCommandBuilder()
  .setName('i')
  .setDescription('Combat v2 player actions.')
  .addSubcommand(s => s.setName('join')
    .setDescription('Join the active combat v2 encounter.')
    .addStringOption(o => o.setName('character').setDescription('Character to join with; defaults to active.').setRequired(false).setAutocomplete(true))
    .addIntegerOption(o => o.setName('bonus').setDescription('Override initiative bonus.').setRequired(false))
    .addIntegerOption(o => o.setName('result').setDescription('Use this exact initiative result instead of rolling.').setRequired(false)))
  .addSubcommand(s => s.setName('attack')
    .setDescription('Attack in or out of initiative.')
    .addStringOption(o => o.setName('name').setDescription('Attack name; omit for first/primary attack.').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('target').setDescription('Target combatant; omit for first opposing target.').setRequired(false).setAutocomplete(true))
    .addIntegerOption(o => o.setName('n').setDescription('Number of attack rolls.').setRequired(false).setMinValue(1).setMaxValue(10))
    .addIntegerOption(o => o.setName('bonus').setDescription('Extra attack bonus or penalty.').setRequired(false))
    .addIntegerOption(o => o.setName('map').setDescription('Override MAP step. 0=first, 1=second, 2=third.').setRequired(false).setMinValue(0).setMaxValue(2)))
  .addSubcommand(s => s.setName('save')
    .setDescription('Roll a saving throw in or out of initiative.')
    .addStringOption(o => o.setName('name').setDescription('Save type.').setRequired(true)
      .addChoices(
        { name: 'Fortitude', value: 'fort' },
        { name: 'Reflex', value: 'ref' },
        { name: 'Will', value: 'will' },
      ))
    .addIntegerOption(o => o.setName('dc').setDescription('Optional DC.').setRequired(false))
    .addIntegerOption(o => o.setName('bonus').setDescription('Extra bonus or penalty.').setRequired(false)))
  .addSubcommand(s => s.setName('skill')
    .setDescription('Roll a skill check in or out of initiative.')
    .addStringOption(o => o.setName('name').setDescription('Skill name.').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('dc').setDescription('Optional DC.').setRequired(false))
    .addIntegerOption(o => o.setName('bonus').setDescription('Extra bonus or penalty.').setRequired(false)))
  .addSubcommand(s => s.setName('cast')
    .setDescription('Cast a spell in or out of initiative.')
    .addStringOption(o => o.setName('spell').setDescription('Spell name.').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('level').setDescription('Cast at this rank.').setRequired(false).setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName('target').setDescription('Target combatant; omit for first opposing target.').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('caster').setDescription('Which spellcaster entry to use.').setRequired(false).setAutocomplete(true))
    .addIntegerOption(o => o.setName('bonus').setDescription('Extra spell attack bonus or penalty.').setRequired(false)))
  .addSubcommand(s => s.setName('reaction')
    .setDescription('Mark your combatant reaction as used.')
    .addStringOption(o => o.setName('actor').setDescription('Your combatant; omit for current/only owned combatant.').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('reason').setDescription('Reaction used, e.g. Reactive Strike or Shield Block.').setRequired(false)))
  .addSubcommand(s => s.setName('hp')
    .setDescription('Adjust your HP in or out of initiative.')
    .addIntegerOption(o => o.setName('change').setDescription('HP change; positive heals, negative damages.').setRequired(false))
    .addIntegerOption(o => o.setName('set').setDescription('Set HP exactly.').setRequired(false).setMinValue(0))
    .addStringOption(o => o.setName('actor').setDescription('Your combatant; omit for current/only owned combatant.').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('thp')
    .setDescription('Set temporary HP on your combatant.')
    .addIntegerOption(o => o.setName('amount').setDescription('Temporary HP amount.').setRequired(true).setMinValue(0))
    .addStringOption(o => o.setName('actor').setDescription('Your combatant; omit for current/only owned combatant.').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('effect')
    .setDescription('Show your combatant\'s active effects.')
    .addStringOption(o => o.setName('actor').setDescription('Your combatant; omit for current/only owned combatant.').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('remove')
    .setDescription('Remove your combatant from combat v2.')
    .addStringOption(o => o.setName('actor').setDescription('Your combatant; omit for current/only owned combatant.').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('attacks')
    .setDescription('List available attacks for yourself or a combatant.')
    .addStringOption(o => o.setName('actor').setDescription('Combatant name; omit for current/your actor.').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /downtime
// ─────────────────────────────────────────────────────────────────────────────
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
    .addStringOption(o => o.setName('reason').setDescription('Why (logged for audit).').setRequired(true))
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)))
  .addSubcommand(s => s.setName('log')
    .setDescription('Show recent downtime activity (audit log).')
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)))
  .addSubcommand(s => s.setName('reset')
    .setDescription('Reset downtime to 0 (irreversible).')
    .addStringOption(o => o.setName('character').setDescription('Defaults to your active character.').setRequired(false)));

// ─────────────────────────────────────────────────────────────────────────────
// /calendar
// ─────────────────────────────────────────────────────────────────────────────
const calendarCommand = new SlashCommandBuilder()
  .setName('calendar')
  .setDescription('In-game calendar (Golarion or Eberron — set per server).')
  .addSubcommand(s => s.setName('today').setDescription('Show the current in-game date.'))
  .addSubcommand(s => s.setName('set')
    .setDescription('GM: set the in-game date.')
    .addIntegerOption(o => o.setName('year').setDescription('Year (4712 AR or 998 YK by default).').setRequired(true))
    .addIntegerOption(o => o.setName('month').setDescription('Month (1-12).').setRequired(true).setAutocomplete(true))
    .addIntegerOption(o => o.setName('day').setDescription('Day of the month.').setRequired(true)))
  .addSubcommand(s => s.setName('advance')
    .setDescription('GM: advance (or rewind) days.')
    .addIntegerOption(o => o.setName('days').setDescription('Number of days (negative to rewind).').setRequired(true)))
  .addSubcommand(s => s.setName('month')
    .setDescription('Show the calendar grid for a month.')
    .addIntegerOption(o => o.setName('year').setDescription('Year (defaults to current).').setRequired(false))
    .addIntegerOption(o => o.setName('month').setDescription('Month 1-12 (defaults to current).').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('holidays')
    .setDescription('List holidays.')
    .addIntegerOption(o => o.setName('month').setDescription('Month 1-12 (omit for all year).').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('next-holiday').setDescription('Show the next upcoming holiday.'))
  .addSubcommand(s => s.setName('moon')
    .setDescription('Show moon phase. (Eberron shows all 12 moons.)')
    .addIntegerOption(o => o.setName('year').setDescription('Year (defaults to current).').setRequired(false))
    .addIntegerOption(o => o.setName('month').setDescription('Month (defaults to current).').setRequired(false).setAutocomplete(true))
    .addIntegerOption(o => o.setName('day').setDescription('Day (defaults to current).').setRequired(false)))
  .addSubcommand(s => s.setName('clear').setDescription('GM: reset calendar state for this server.'))
  .addSubcommand(s => s.setName('setting')
    .setDescription('Switch this server between Golarion and Eberron (or view current).')
    .addStringOption(o => o.setName('choice').setDescription('Pick golarion or eberron (omit to view).').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// /weather
// ─────────────────────────────────────────────────────────────────────────────
const weatherCommand = new SlashCommandBuilder()
  .setName('weather')
  .setDescription('In-game weather (Golarion or Eberron — set per server).')
  .addSubcommand(s => s.setName('current').setDescription('Show today\'s weather and active effects.'))
  .addSubcommand(s => s.setName('climate')
    .setDescription('GM: set the climate and season.')
    .addStringOption(o => o.setName('climate').setDescription('Climate region.').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('season').setDescription('Season (spring/summer/autumn/winter).').setRequired(false).setAutocomplete(true)))
  .addSubcommand(s => s.setName('set')
    .setDescription('GM: override one weather component.')
    .addStringOption(o => o.setName('component').setDescription('Which component to set.').setRequired(true)
      .addChoices(
        { name: 'Temperature', value: 'temperature' },
        { name: 'Precipitation', value: 'precipitation' },
        { name: 'Wind', value: 'wind' },
        { name: 'Fog', value: 'fog' },
      ))
    .addStringOption(o => o.setName('value').setDescription('New value.').setRequired(true).setAutocomplete(true)))
  .addSubcommand(s => s.setName('roll').setDescription('GM: re-roll today\'s weather.'))
  .addSubcommand(s => s.setName('advance')
    .setDescription('GM: advance N days, rolling each.')
    .addIntegerOption(o => o.setName('days').setDescription('Number of days to advance (1-30).').setRequired(true).setMinValue(1).setMaxValue(30)))
  .addSubcommand(s => s.setName('forecast')
    .setDescription('Peek at the next N days without committing.')
    .addIntegerOption(o => o.setName('days').setDescription('Days to forecast (1-7).').setRequired(false).setMinValue(1).setMaxValue(7)))
  .addSubcommand(s => s.setName('apply')
    .setDescription('GM: apply current weather effects to all combatants in this channel\'s encounter.'))
  .addSubcommand(s => s.setName('clear').setDescription('GM: clear weather state for this server.'))
  .addSubcommand(s => s.setName('setting')
    .setDescription('Switch this server between Golarion and Eberron weather (or view current).')
    .addStringOption(o => o.setName('choice').setDescription('Pick golarion or eberron (omit to view).').setRequired(false).setAutocomplete(true)));

// ─────────────────────────────────────────────────────────────────────────────
// Master command list
// ─────────────────────────────────────────────────────────────────────────────
const eberronCommand = new SlashCommandBuilder()
  .setName('eberron')
  .setDescription('Eberron campaign reference lookups.')
  .addSubcommand(s => s.setName('house')
    .setDescription('Look up a Dragonmarked House.')
    .addStringOption(o => o.setName('name').setDescription('House name, dragonmark, or service').setRequired(true).setAutocomplete(true)));

const commands = [
  // Utility
  pingCommand,
  brCommand,
  breakCommand,
  helpCommand,
  diagnoseCommand,
  // Character management
  charCommand,
  sheetCommand,
  portraitCommand,
  snippetCommand,
  serversnippetCommand,
  // Combat & rolls
  initCommand,
  iCommand,
  mattackCommand,
  rollCommand,
  rCommand,
  skillCommand,
  perceptionCommand,
  saveCommand,
  // Spells
  spellCommand,
  castCommand,
  spellbookCommand,
  preparedCommand,
  spellsCommand,
  // Character resources
  hpCommand,
  heroCommand,
  xpCommand,
  resourceCommand,
  restCommand,
  refocusCommand,
  // Inventory & wealth
  bagCommand,
  goldCommand,
  // Notes & misc
  notesCommand,
  // Downtime
  downtimeCommand,
  // Lookup commands
  ancestryCommand,
  archetypeCommand,
  backgroundCommand,
  classCommand,
  companionCommand,
  conditionCommand,
  actionCommand,
  hazardCommand,
  ritualCommand,
  traitCommand,
  afflictionCommand,
  languageCommand,
  domainCommand,
  planeCommand,
  relicCommand,
  familiarCommand,
  vehicleCommand,
  siegeCommand,
  kingdomCommand,
  classfeatureCommand,
  creatureextraCommand,
  sourcebookCommand,
  deityCommand,
  featCommand,
  heritageCommand,
  itemCommand,
  monsterCommand,
  ruleCommand,
  skillinfoCommand,
  // Monster tools
  mCommand,
  monsteraddCommand,
  monsterartCommand,
  monstereditCommand,
  // Data tools (bot owner only)
  spelladdCommand,
  itemaddCommand,
  // Calendar & weather
  calendarCommand,
  weatherCommand,
  eberronCommand,
].map(c => c.toJSON());

const retiredCombatCommandNames = new Set([
  'attack',
  'initiative',
  'monsterattack',
  'monsterroll',
]);
const commandNames = new Set([
  ...commands.map(c => c.name),
  ...retiredCombatCommandNames,
]);

// ─────────────────────────────────────────────────────────────────────────────
// Deploy
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  const route = (useGuild && DEV_GUILD_ID)
    ? Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  const target = (useGuild && DEV_GUILD_ID)
    ? `guild ${DEV_GUILD_ID} (instant)`
    : 'global (up to 1 hour to propagate)';

  console.log(`\nRegistering ${commands.length} command(s) → ${target}`);
  console.log('Commands:', commands.map(c => `/${c.name}`).join(', '));

  try {
    const existing = await rest.get(route);
    const kept = existing.filter(c => !commandNames.has(c.name));
    const merged = [...kept, ...commands];
    await rest.put(route, { body: merged });

    console.log(`\n✅ Done! Registered ${commands.length} command(s). ${kept.length} existing command(s) left untouched.`);
    if (!useGuild) {
      console.log('   Global commands can take up to 1 hour to appear in all servers.');
      console.log('   For instant testing: npm run deploy:guild  (requires DEV_GUILD_ID in .env)');
    }
  } catch (err) {
    console.error('\n❌ Failed to register commands:');
    console.error(err.message ?? err);
    if (err.status === 401) console.error('   → Your TOKEN is invalid or expired. Check your .env file.');
    if (err.status === 403) console.error('   → Missing permissions. Make sure the bot has the applications.commands scope.');
    if (err.status === 400) {
      console.error('   → Validation error. One of the command definitions may have an invalid option.');
      console.error('   → Check the full error for details:');
      console.error(JSON.stringify(err.rawError ?? err, null, 2));
    }
    process.exit(1);
  }
}

main();
