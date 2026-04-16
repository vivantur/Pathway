require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const commands = [
  { name: 'ping', description: 'Check if the bot is alive' },
  {
    name: 'char', description: 'Character management',
    options: [
      {
        name: 'add', description: 'Add a character from a Pathbuilder JSON export',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'file', description: 'Your Pathbuilder JSON file', type: ApplicationCommandOptionType.Attachment, required: true }]
      },
      {
        name: 'update', description: 'Update an existing character with a fresh Pathbuilder JSON export',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'file', description: 'Your updated Pathbuilder JSON file', type: ApplicationCommandOptionType.Attachment, required: true }]
      },
      {
        name: 'remove', description: 'Remove a saved character',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'name', description: 'Name of the character to remove', type: ApplicationCommandOptionType.String, required: true }]
      },
      {
        name: 'list', description: 'List all your saved characters',
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: 'feats', description: 'Show all feats for your character',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'name', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }]
      },
      {
        name: 'art', description: 'Set character art for your character',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'url', description: 'Direct image URL for your character art', type: ApplicationCommandOptionType.String, required: true },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'info', description: 'Manually set senses or languages not in Pathbuilder JSON',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'field', description: 'What to set', type: ApplicationCommandOptionType.String, required: true, choices: [{ name: 'Senses', value: 'senses' }, { name: 'Languages', value: 'languages' }] },
          { name: 'value', description: 'Comma-separated values (e.g. "Low-light vision, Darkvision")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      }
    ]
  },
  {
    name: 'sheet', description: 'Display a character sheet',
    options: [{ name: 'name', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }]
  },
  {
    name: 'spellbook', description: 'Show all spells for your character',
    options: [{ name: 'name', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }]
  },
  {
    name: 'roll', description: 'Roll dice (e.g. 1d20+5)',
    options: [
      { name: 'dice', description: 'Dice expression e.g. 1d20+5 or 2d6', type: ApplicationCommandOptionType.String, required: true },
      { name: 'character', description: 'Character name to show on the result (optional)', type: ApplicationCommandOptionType.String, required: false }
    ]
  },
  {
    name: 'skill', description: 'Roll a skill check for your character',
    options: [
      { name: 'skill', description: 'The skill to roll', type: ApplicationCommandOptionType.String, required: true, choices: [
        { name: 'Acrobatics', value: 'acrobatics' }, { name: 'Arcana', value: 'arcana' },
        { name: 'Athletics', value: 'athletics' }, { name: 'Crafting', value: 'crafting' },
        { name: 'Deception', value: 'deception' }, { name: 'Diplomacy', value: 'diplomacy' },
        { name: 'Intimidation', value: 'intimidation' }, { name: 'Medicine', value: 'medicine' },
        { name: 'Nature', value: 'nature' }, { name: 'Occultism', value: 'occultism' },
        { name: 'Performance', value: 'performance' }, { name: 'Religion', value: 'religion' },
        { name: 'Society', value: 'society' }, { name: 'Stealth', value: 'stealth' },
        { name: 'Survival', value: 'survival' }, { name: 'Thievery', value: 'thievery' }
      ]},
      { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'bonus', description: 'Extra bonus or penalty to add (e.g. 2 or -1)', type: ApplicationCommandOptionType.Integer, required: false }
    ]
  },
  {
    name: 'save', description: 'Roll a saving throw for your character',
    options: [
      { name: 'type', description: 'The save to roll', type: ApplicationCommandOptionType.String, required: true, choices: [
        { name: 'Fortitude', value: 'fortitude' }, { name: 'Reflex', value: 'reflex' }, { name: 'Will', value: 'will' }
      ]},
      { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'bonus', description: 'Extra bonus or penalty to add (e.g. 2 or -1)', type: ApplicationCommandOptionType.Integer, required: false }
    ]
  },
  {
    name: 'spell', description: 'Look up a spell from the database',
    options: [{ name: 'name', description: 'Name of the spell to look up', type: ApplicationCommandOptionType.String, required: true }]
  },
  {
    name: 'cast', description: 'Cast a spell with your character',
    options: [
      { name: 'spell', description: 'Name of the spell to cast', type: ApplicationCommandOptionType.String, required: true },
      { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'level', description: 'Level to cast the spell at (for heightening)', type: ApplicationCommandOptionType.Integer, required: false }
    ]
  },
  {
    name: 'ancestry', description: 'Look up a PF2e ancestry',
    options: [{ name: 'name', description: 'The ancestry to look up (e.g. Elf, Dwarf, Gnome)', type: ApplicationCommandOptionType.String, required: true }]
  },
  {
    name: 'archetype', description: 'Look up a PF2e archetype',
    options: [{ name: 'name', description: 'The archetype to look up (e.g. Acrobat, Assassin, Fighter)', type: ApplicationCommandOptionType.String, required: true }]
  },
  {
    name: 'rule', description: 'Look up a PF2e condition, action, or trait',
    options: [{ name: 'name', description: 'What to look up (e.g. frightened, grapple, agile)', type: ApplicationCommandOptionType.String, required: true }]
  },
  {
    name: 'bag', description: 'Manage your inventory bag',
    options: [
      { name: 'view', description: 'View your bag', type: ApplicationCommandOptionType.Subcommand },
      {
        name: 'rename', description: 'Rename your bag',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'name', description: 'New name for your bag', type: ApplicationCommandOptionType.String, required: true }]
      },
      {
        name: 'add', description: 'Add an item (creates the category if it doesn\'t exist)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'category', description: 'Category name (e.g. Potions, Weapons, Trinkets)', type: ApplicationCommandOptionType.String, required: true },
          { name: 'item', description: 'Item to add', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'remove', description: 'Remove an item from your bag',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'category', description: 'Category name', type: ApplicationCommandOptionType.String, required: true },
          { name: 'item', description: 'Item to remove', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'removecategory', description: 'Remove an entire category from your bag',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'category', description: 'Category to delete', type: ApplicationCommandOptionType.String, required: true }]
      },
      { name: 'clear', description: 'Clear everything from your bag', type: ApplicationCommandOptionType.Subcommand }
    ]
  },
  {
    name: 'gold', description: 'Manage your character\'s currency',
    options: [
      {
        name: 'view', description: 'View your current wallet', type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }]
      },
      {
        name: 'add', description: 'Add currency to your wallet', type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'pp', description: 'Platinum pieces to add', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'gp', description: 'Gold pieces to add', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'sp', description: 'Silver pieces to add', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'cp', description: 'Copper pieces to add', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'spend', description: 'Spend currency from your wallet', type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'pp', description: 'Platinum pieces to spend', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'gp', description: 'Gold pieces to spend', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'sp', description: 'Silver pieces to spend', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'cp', description: 'Copper pieces to spend', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'convert', description: 'Convert between currency types', type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'from', description: 'Currency to convert from', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Copper (cp)', value: 'cp' }, { name: 'Silver (sp)', value: 'sp' },
            { name: 'Gold (gp)', value: 'gp' }, { name: 'Platinum (pp)', value: 'pp' }
          ]},
          { name: 'to', description: 'Currency to convert to', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Copper (cp)', value: 'cp' }, { name: 'Silver (sp)', value: 'sp' },
            { name: 'Gold (gp)', value: 'gp' }, { name: 'Platinum (pp)', value: 'pp' }
          ]},
          { name: 'amount', description: 'How many to convert', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'set', description: 'Set your wallet to exact amounts', type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'pp', description: 'Set platinum pieces', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'gp', description: 'Set gold pieces', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'sp', description: 'Set silver pieces', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'cp', description: 'Set copper pieces', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands('1484284107688116294', '1466843829343752417'),
      { body: commands }
    );
    console.log('Done! Slash commands registered successfully.');
  } catch (err) {
    console.error(err);
  }
})();