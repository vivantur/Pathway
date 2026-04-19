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
      { name: 'target', description: 'Combatant name to target (requires active encounter)', type: ApplicationCommandOptionType.String, required: false },
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
    name: 'background', description: 'Look up a PF2e background',
    options: [{ name: 'name', description: 'The background to look up (e.g. Acolyte, Acrobat, Warrior)', type: ApplicationCommandOptionType.String, required: true }]
  },
  {
    name: 'rule', description: 'Look up a PF2e condition, action, or trait',
    options: [{ name: 'name', description: 'What to look up (e.g. frightened, grapple, agile)', type: ApplicationCommandOptionType.String, required: true }]
  },
  {
    name: 'monster', description: 'Look up a PF2e monster/creature from the bestiary',
    options: [{ name: 'name', description: 'Name of the creature to look up (e.g. Goblin Warrior, Ancient Red Dragon)', type: ApplicationCommandOptionType.String, required: true }]
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
  },
  {
    name: 'init', description: 'Initiative tracker for combat',
    options: [
      { name: 'start', description: 'Start a new encounter in this channel', type: ApplicationCommandOptionType.Subcommand },
      {
        name: 'add', description: 'Add your loaded character to initiative',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'bonus', description: 'Override initiative bonus (defaults to Perception)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'result', description: 'Use this exact initiative result instead of rolling', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'addnpc', description: 'GM: add a monster/NPC to initiative',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true },
          { name: 'bonus', description: 'Initiative modifier', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'hp', description: 'Max HP', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'ac', description: 'AC (for hit/crit determination)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'result', description: 'Use exact initiative instead of rolling', type: ApplicationCommandOptionType.Integer, required: false }
        ]
      },
      { name: 'next', description: 'Advance to the next turn', type: ApplicationCommandOptionType.Subcommand },
      { name: 'list', description: 'Show current initiative order', type: ApplicationCommandOptionType.Subcommand },
      {
        name: 'hp', description: 'Modify a combatant\'s HP',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Combatant name', type: ApplicationCommandOptionType.String, required: true },
          { name: 'change', description: 'Positive to heal, negative to damage', type: ApplicationCommandOptionType.Integer, required: true }
        ]
      },
      {
        name: 'remove', description: 'Remove a combatant',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Combatant name', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'effect', description: 'Apply a status effect/condition to a combatant',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'target', description: 'Combatant to apply the effect to', type: ApplicationCommandOptionType.String, required: true },
          { name: 'name', description: 'Effect name (e.g. "frightened", "bless", or custom name)', type: ApplicationCommandOptionType.String, required: true },
          { name: 'value', description: 'Value for scaling conditions (Frightened 2, Heroism 3, etc.)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'duration', description: 'Duration in rounds (leave blank for permanent until removed)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'attack_bonus', description: 'Custom: bonus/penalty to attack rolls', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'damage_bonus', description: 'Custom: bonus/penalty to damage', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'ac_bonus', description: 'Custom: bonus/penalty to AC', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'save_bonus', description: 'Custom: bonus/penalty to saves', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'skill_bonus', description: 'Custom: bonus/penalty to skill checks', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'description', description: 'Custom: description of the effect', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'removeeffect', description: 'Remove a status effect from a combatant',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'target', description: 'Combatant to remove the effect from', type: ApplicationCommandOptionType.String, required: true },
          { name: 'name', description: 'Effect name to remove', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'effects', description: 'List all active effects on a combatant',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'target', description: 'Combatant name', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'conditions', description: 'Show the list of available PF2e condition presets',
        type: ApplicationCommandOptionType.Subcommand
      },
      { name: 'end', description: 'End the encounter', type: ApplicationCommandOptionType.Subcommand }
    ]
  },
  {
    name: 'attack', description: 'Roll an attack with one of your weapons',
    options: [
      { name: 'weapon', description: 'Weapon name (from your sheet)', type: ApplicationCommandOptionType.String, required: true },
      { name: 'target', description: 'Combatant name to attack (requires active encounter)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'bonus', description: 'Extra bonus or penalty to add (e.g. 2 or -1)', type: ApplicationCommandOptionType.Integer, required: false },
      { name: 'map', description: 'Multiple attack penalty (1 = -5, 2 = -10)', type: ApplicationCommandOptionType.Integer, required: false, choices: [
        { name: 'First attack (no penalty)', value: 0 },
        { name: 'Second attack (-5)', value: 1 },
        { name: 'Third attack (-10)', value: 2 }
      ]}
    ]
  },
  {
    name: 'mattack', description: 'GM: roll a monster attack against a target',
    options: [
      { name: 'attacker', description: 'Name of the NPC/monster attacking (must be in encounter)', type: ApplicationCommandOptionType.String, required: true },
      { name: 'name', description: 'Name of the attack (e.g. "Shortsword", "Fire Breath")', type: ApplicationCommandOptionType.String, required: true },
      { name: 'bonus', description: 'Attack roll bonus', type: ApplicationCommandOptionType.Integer, required: true },
      { name: 'damage', description: 'Damage dice expression (e.g. "1d6+2" or "2d8+4")', type: ApplicationCommandOptionType.String, required: true },
      { name: 'target', description: 'Combatant to attack', type: ApplicationCommandOptionType.String, required: true },
      { name: 'type', description: 'Damage type (piercing, slashing, bludgeoning, fire, etc.)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'map', description: 'Multiple attack penalty (1 = -5, 2 = -10)', type: ApplicationCommandOptionType.Integer, required: false, choices: [
        { name: 'First attack (no penalty)', value: 0 },
        { name: 'Second attack (-5)', value: 1 },
        { name: 'Third attack (-10)', value: 2 }
      ]},
      { name: 'agile', description: 'Is this an agile attack? (MAP is -4/-8 instead of -5/-10)', type: ApplicationCommandOptionType.Boolean, required: false }
    ]
  },
  {
    name: 'monsterattack', description: 'GM: save and use a library of monster attacks (shared per server)',
    options: [
      {
        name: 'add', description: 'Save a strike attack (attack roll vs AC)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name (e.g. "Goblin Warrior" or a custom name)', type: ApplicationCommandOptionType.String, required: true },
          { name: 'attack', description: 'Attack name (e.g. "Shortsword", "Claw", "Bite")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'bonus', description: 'Attack roll bonus', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'damage', description: 'Damage dice (e.g. "1d6+2" or "2d8+4")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'type', description: 'Damage type (piercing, slashing, fire, etc.)', type: ApplicationCommandOptionType.String, required: false },
          { name: 'traits', description: 'Comma-separated traits (e.g. "agile, reach, finesse")', type: ApplicationCommandOptionType.String, required: false },
          { name: 'extra_damage', description: 'Extra damage dice (e.g. "1d6")', type: ApplicationCommandOptionType.String, required: false },
          { name: 'extra_type', description: 'Extra damage type (e.g. "fire")', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'addspell', description: 'Save a spell attack (spell attack roll vs AC)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true },
          { name: 'attack', description: 'Spell attack name (e.g. "Eldritch Blast")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'bonus', description: 'Spell attack bonus', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'damage', description: 'Damage dice (e.g. "3d6")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'type', description: 'Damage type (e.g. "force", "fire")', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'addsave', description: 'Save a save-based attack (breath weapon, aura, AoE)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true },
          { name: 'attack', description: 'Attack name (e.g. "Fire Breath")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'save', description: 'Which save the target rolls', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Fortitude', value: 'fortitude' }, { name: 'Reflex', value: 'reflex' }, { name: 'Will', value: 'will' }
          ]},
          { name: 'dc', description: 'Save DC', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'damage', description: 'Damage dice (e.g. "6d6")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'type', description: 'Damage type (e.g. "fire")', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'remove', description: 'Remove one attack from a monster',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true },
          { name: 'attack', description: 'Attack name to remove', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'clear', description: 'Remove all attacks for a monster',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'list', description: 'Show saved attacks (for one monster, or all)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name (leave blank to list all monsters)', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'use', description: 'Roll a saved attack against a target in the current encounter',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'attacker', description: 'Combatant in the current encounter doing the attacking', type: ApplicationCommandOptionType.String, required: true },
          { name: 'monster', description: 'Monster name in the library to pull the attack from', type: ApplicationCommandOptionType.String, required: true },
          { name: 'attack', description: 'Saved attack name', type: ApplicationCommandOptionType.String, required: true },
          { name: 'target', description: 'Combatant to target (required for strike/spell, optional for save)', type: ApplicationCommandOptionType.String, required: false },
          { name: 'map', description: 'Multiple attack penalty (strike/spell only)', type: ApplicationCommandOptionType.Integer, required: false, choices: [
            { name: 'First attack (no penalty)', value: 0 },
            { name: 'Second attack (-5)', value: 1 },
            { name: 'Third attack (-10)', value: 2 }
          ]}
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
      Routes.applicationCommands('1484284107688116294'),
      { body: commands }
    );
    console.log('Done! Slash commands registered successfully.');
  } catch (err) {
    console.error(err);
  }
})();