require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');
 
const commands = [
  {
    name: 'ping',
    description: 'Check if the bot is alive'
  },
  {
    name: 'addchar',
    description: 'Add a character from a Pathbuilder JSON export',
    options: [
      {
        name: 'file',
        description: 'Your Pathbuilder JSON file',
        type: ApplicationCommandOptionType.Attachment,
        required: true
      }
    ]
  },
  {
    name: 'updatechar',
    description: 'Update an existing character with a fresh Pathbuilder JSON export',
    options: [
      {
        name: 'file',
        description: 'Your updated Pathbuilder JSON file',
        type: ApplicationCommandOptionType.Attachment,
        required: true
      }
    ]
  },
  {
    name: 'setart',
    description: 'Set character art for your character',
    options: [
      {
        name: 'url',
        description: 'Direct image URL for your character art',
        type: ApplicationCommandOptionType.String,
        required: true
      },
      {
        name: 'character',
        description: 'Character name (leave blank if you only have one)',
        type: ApplicationCommandOptionType.String,
        required: false
      }
    ]
  },
  {
    name: 'setinfo',
    description: 'Manually set senses or other info not in Pathbuilder JSON',
    options: [
      {
        name: 'field',
        description: 'What to set',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Senses', value: 'senses' },
          { name: 'Languages', value: 'languages' },
        ]
      },
      {
        name: 'value',
        description: 'The value to set (comma separated for multiple, e.g. "Low-light vision, Darkvision")',
        type: ApplicationCommandOptionType.String,
        required: true
      },
      {
        name: 'character',
        description: 'Character name (leave blank if you only have one)',
        type: ApplicationCommandOptionType.String,
        required: false
      }
    ]
  },
  {
    name: 'sheet',
    description: 'Display a character sheet',
    options: [
      {
        name: 'name',
        description: 'Character name (leave blank if you only have one)',
        type: ApplicationCommandOptionType.String,
        required: false
      }
    ]
  },
  {
    name: 'spellbook',
    description: 'Show all spells for your character',
    options: [
      {
        name: 'name',
        description: 'Character name (leave blank if you only have one)',
        type: ApplicationCommandOptionType.String,
        required: false
      }
    ]
  },
  {
    name: 'charfeats',
    description: 'Show all feats for your character',
    options: [
      {
        name: 'name',
        description: 'Character name (leave blank if you only have one)',
        type: ApplicationCommandOptionType.String,
        required: false
      }
    ]
  },
  {
    name: 'mychars',
    description: 'List all your saved characters'
  },
  {
    name: 'removechar',
    description: 'Remove a saved character',
    options: [
      {
        name: 'name',
        description: 'Name of the character to remove',
        type: ApplicationCommandOptionType.String,
        required: true
      }
    ]
  },
  {
    name: 'roll',
    description: 'Roll dice (e.g. 1d20+5)',
    options: [
      {
        name: 'dice',
        description: 'Dice expression e.g. 1d20+5 or 2d6',
        type: ApplicationCommandOptionType.String,
        required: true
      },
      {
        name: 'character',
        description: 'Character name to show on the result (optional)',
        type: ApplicationCommandOptionType.String,
        required: false
      }
    ]
  },
  {
    name: 'skill',
    description: 'Roll a skill check for your character',
    options: [
      {
        name: 'skill',
        description: 'The skill to roll',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Acrobatics', value: 'acrobatics' },
          { name: 'Arcana', value: 'arcana' },
          { name: 'Athletics', value: 'athletics' },
          { name: 'Crafting', value: 'crafting' },
          { name: 'Deception', value: 'deception' },
          { name: 'Diplomacy', value: 'diplomacy' },
          { name: 'Intimidation', value: 'intimidation' },
          { name: 'Medicine', value: 'medicine' },
          { name: 'Nature', value: 'nature' },
          { name: 'Occultism', value: 'occultism' },
          { name: 'Performance', value: 'performance' },
          { name: 'Religion', value: 'religion' },
          { name: 'Society', value: 'society' },
          { name: 'Stealth', value: 'stealth' },
          { name: 'Survival', value: 'survival' },
          { name: 'Thievery', value: 'thievery' }
        ]
      },
      {
        name: 'character',
        description: 'Character name (leave blank if you only have one)',
        type: ApplicationCommandOptionType.String,
        required: false
      },
      {
        name: 'bonus',
        description: 'Extra bonus or penalty to add (e.g. 2 or -1)',
        type: ApplicationCommandOptionType.Integer,
        required: false
      }
    ]
  },
  {
    name: 'save',
    description: 'Roll a saving throw for your character',
    options: [
      {
        name: 'type',
        description: 'The save to roll',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'Fortitude', value: 'fortitude' },
          { name: 'Reflex', value: 'reflex' },
          { name: 'Will', value: 'will' }
        ]
      },
      {
        name: 'character',
        description: 'Character name (leave blank if you only have one)',
        type: ApplicationCommandOptionType.String,
        required: false
      },
      {
        name: 'bonus',
        description: 'Extra bonus or penalty to add (e.g. 2 or -1)',
        type: ApplicationCommandOptionType.Integer,
        required: false
      }
    ]
  },
  {
    name: 'spell',
    description: 'Look up a spell from the database',
    options: [
      {
        name: 'name',
        description: 'Name of the spell to look up',
        type: ApplicationCommandOptionType.String,
        required: true
      }
    ]
  },
  {
    name: 'cast',
    description: 'Cast a spell with your character',
    options: [
      {
        name: 'spell',
        description: 'Name of the spell to cast',
        type: ApplicationCommandOptionType.String,
        required: true
      },
      {
        name: 'character',
        description: 'Character name (leave blank if you only have one)',
        type: ApplicationCommandOptionType.String,
        required: false
      },
      {
        name: 'level',
        description: 'Level to cast the spell at (for heightening)',
        type: ApplicationCommandOptionType.Integer,
        required: false
      }
    ]
  },
  {
    name: 'ancestry',
    description: 'Look up a PF2e ancestry (Elf, Dwarf, Gnome, etc.)',
    options: [
      {
        name: 'name',
        description: 'The ancestry to look up (e.g. Elf, Dwarf, Gnome)',
        type: ApplicationCommandOptionType.String,
        required: true
      }
    ]
  },
  {
    name: 'archetype',
    description: 'Look up a PF2e archetype (Acrobat, Assassin, Fighter, etc.)',
    options: [
      {
        name: 'name',
        description: 'The archetype to look up (e.g. Acrobat, Assassin, Fighter)',
        type: ApplicationCommandOptionType.String,
        required: true
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