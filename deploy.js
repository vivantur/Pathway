require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const commands = [
  { name: 'ping', description: 'Check if the bot is alive' },
  {
    name: 'help', description: 'Show a categorized list of all commands',
    options: [
      { name: 'topic', description: 'Jump straight to a specific category', type: ApplicationCommandOptionType.String, required: false, choices: [
        { name: '🧙 Character', value: 'character' },
        { name: '🔮 Spells', value: 'spells' },
        { name: '⚔️ Combat', value: 'combat' },
        { name: '📚 Lookup', value: 'lookup' },
        { name: '🎲 GM Tools', value: 'gm' },
      ]}
    ]
  },
  {
    name: 'char', description: 'Character management',
    options: [
      {
        name: 'add', description: 'Add a character from a Pathbuilder .json or .txt file',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'file', description: 'Your Pathbuilder JSON export (.json or .txt)', type: ApplicationCommandOptionType.Attachment, required: true }]
      },
      {
        name: 'update', description: 'Update an existing character with a fresh Pathbuilder export (keeps HP/XP/notes)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'file', description: 'Your updated Pathbuilder JSON (.json or .txt)', type: ApplicationCommandOptionType.Attachment, required: true }]
      },
      {
        name: 'pastemsg', description: 'Import by posting JSON as a chat message (best method on mobile)',
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: 'pastemsgupdate', description: 'Update by posting JSON as a chat message (keeps HP/XP/notes)',
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: 'pdf', description: 'Import a character from a Pathbuilder statblock PDF (partial import)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'file', description: 'Pathbuilder statblock PDF (Menu → Export → View Statblock → Save as PDF)', type: ApplicationCommandOptionType.Attachment, required: true }]
      },
      {
        name: 'edit', description: 'Edit your character: background, deity, languages, senses (opens a popup)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'character', description: 'Which character to edit (defaults to your active character)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
        ],
      },
      {
        name: 'skill', description: 'Set a skill\'s proficiency rank or flat total (for PDF imports or corrections)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Skill name (e.g. Athletics, Arcana)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'rank', description: 'Proficiency rank (optional — use this or total)', type: ApplicationCommandOptionType.String, required: false,
            choices: [
              { name: 'Untrained (clears override)', value: 'untrained' },
              { name: 'Trained', value: 'trained' },
              { name: 'Expert', value: 'expert' },
              { name: 'Master', value: 'master' },
              { name: 'Legendary', value: 'legendary' },
            ],
          },
          { name: 'total', description: 'Flat total bonus override (optional — wins over rank if both set)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'character', description: 'Which character (defaults to your active character)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
        ],
      },
      {
        name: 'lore', description: 'Add, edit, or remove a Lore skill (e.g. Lore: Dragon, Lore: Farming)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'topic', description: 'The lore topic (e.g. Dragon, Farming, Absalom). The "Lore:" prefix is added automatically.', type: ApplicationCommandOptionType.String, required: true },
          { name: 'rank', description: 'Proficiency rank', type: ApplicationCommandOptionType.String, required: false,
            choices: [
              { name: 'Trained', value: 'trained' },
              { name: 'Expert', value: 'expert' },
              { name: 'Master', value: 'master' },
              { name: 'Legendary', value: 'legendary' },
            ],
          },
          { name: 'total', description: 'Flat total bonus override (optional)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'remove', description: 'Remove this lore from the character (ignores rank/total)', type: ApplicationCommandOptionType.Boolean, required: false },
          { name: 'character', description: 'Which character (defaults to your active character)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
        ],
      },
      {
        name: 'template', description: 'Get a blank fill-in-the-blanks character template (.txt file) to build a character manually',
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: 'dump', description: 'Export your character as an editable .txt file (for heavy modifications)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'character', description: 'Which character to export (defaults to active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
        ],
      },
      {
        name: 'howto', description: 'Show platform-specific instructions for getting your character into the bot',
        type: ApplicationCommandOptionType.Subcommand
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
      },
      {
        name: 'active', description: 'Set a default character so commands don\'t prompt you every time',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'character', description: 'Character to make active (leave blank to view current)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'action', description: 'Other actions (clear removes the default)', type: ApplicationCommandOptionType.String, required: false, choices: [
            { name: 'Clear active character', value: 'clear' }
          ]}
        ]
      },
      {
        name: 'feat', description: 'Add, remove, or list feats that did not import from Pathbuilder',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'action', description: 'Add, remove, or list feats', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Add', value: 'add' },
            { name: 'Remove', value: 'remove' },
            { name: 'List', value: 'list' }
          ]},
          { name: 'name', description: 'Feat name (required for add/remove)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'level', description: 'Character level when feat was taken (default: current level)', type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 20 },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'sheet', description: 'Display a character sheet',
    options: [{ name: 'name', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }]
  },
  {
    name: 'portrait', description: 'Show your character\'s current portrait/art',
    options: [{ name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }]
  },
  {
    name: 'spellbook', description: 'Show all spells for your character',
    options: [{ name: 'name', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }]
  },
  {
    name: 'prepared', description: "Show today's prepared spells for your character (prepared casters only)",
    options: [{ name: 'name', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }]
  },
  {
    name: 'roll', description: 'Roll dice with modifiers: adv, dis, crit, rr1, 4#1d20 for iterations, plus your snippets',
    options: [
      { name: 'dice', description: 'e.g. 1d20+5 adv · 2d6+3 crit · 4#1d20+5 · 1d20+7 sneaky', type: ApplicationCommandOptionType.String, required: true },
      { name: 'character', description: 'Character name to show on the result (optional)', type: ApplicationCommandOptionType.String, required: false }
    ]
  },
  {
    name: 'snippet', description: 'Manage your personal roll snippets (shortcuts for /roll)',
    options: [
      {
        name: 'create', description: 'Create or update a personal snippet. Use %1, %2 for arguments.',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name',   description: 'Snippet name (letters, numbers, underscores; e.g. "sneaky")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'expand', description: 'Expansion text. Use %1, %2 for args; %1:2 sets default 2. e.g. "+%1:2d6[sneak]"', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'list', description: 'List all your snippets',
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: 'view', description: 'Show what a snippet expands to',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Snippet name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }
        ]
      },
      {
        name: 'delete', description: 'Delete a snippet you created',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Snippet name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'serversnippet', description: 'Manage server-wide roll snippets (anyone can use; GM-only to create/delete)',
    options: [
      {
        name: 'create', description: 'Create or update a server-wide snippet (requires Manage Server)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name',   description: 'Snippet name (letters, numbers, underscores)', type: ApplicationCommandOptionType.String, required: true },
          { name: 'expand', description: 'Expansion text. Use %1, %2 for args; %1:2 sets default 2. e.g. "+%1:2d6[sneak]"', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'list', description: 'List all server-wide snippets for this server',
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: 'view', description: 'Show what a server snippet expands to',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Snippet name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }
        ]
      },
      {
        name: 'delete', description: 'Delete a server-wide snippet (requires Manage Server)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Snippet name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }
        ]
      }
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
    name: 'perception', description: 'Roll a Perception check (Wis + proficiency)',
    options: [
      { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
      { name: 'bonus', description: 'Extra bonus or penalty to add (e.g. 2 or -1)', type: ApplicationCommandOptionType.Integer, required: false }
    ]
  },
  {
    name: 'initiative', description: 'Roll initiative (defaults to Perception; supports skill overrides for ambushes/social)',
    options: [
      { name: 'skill', description: 'Override skill (Stealth for ambush, Diplomacy for social, etc.) — defaults to Perception', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
      { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
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
    options: [{ name: 'name', description: 'Name of the spell to look up', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }]
  },
  {
    name: 'cast', description: 'Cast a spell with your character',
    options: [
      { name: 'spell', description: 'Name of the spell to cast', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
      { name: 'target', description: 'Combatant name to target (requires active encounter)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'level', description: 'Level to cast the spell at (for heightening)', type: ApplicationCommandOptionType.Integer, required: false }
    ]
  },
  {
    name: 'spells', description: 'Manage your character\'s spellbook, repertoire, and prepared spells',
    options: [
      {
        name: 'learn', description: 'Add a spell to your spellbook or repertoire (permanent)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'spell', description: 'Spell to learn (autocomplete from spell database)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'caster', description: 'Which caster (required if your character has multiple)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'forget', description: 'Remove a previously-learned spell from your overlay',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'spell', description: 'Spell to forget', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'caster', description: 'Which caster', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'prepare', description: 'Prepare a spell into a slot for today (prepared casters)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'spell', description: 'Spell to prepare', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'rank', description: 'Spell rank (the slot level to fill)', type: ApplicationCommandOptionType.Integer, required: true, min_value: 0, max_value: 10 },
          { name: 'caster', description: 'Which caster', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'unprepare', description: 'Remove a spell from today\'s prepared list',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'spell', description: 'Spell to unprepare', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'rank', description: 'Rank it was prepared at', type: ApplicationCommandOptionType.Integer, required: true, min_value: 0, max_value: 10 },
          { name: 'caster', description: 'Which caster', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'swap', description: 'Swap a known spell for a new one (spontaneous caster repertoire)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'remove', description: 'Spell to remove from the repertoire', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'add', description: 'Spell to add in its place', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'rank', description: 'Rank of both spells', type: ApplicationCommandOptionType.Integer, required: true, min_value: 0, max_value: 10 },
          { name: 'caster', description: 'Which caster', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'list', description: 'Show the full merged spellbook (same info as /spellbook)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'caster', description: 'Limit the list to one caster', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'rest', description: 'Long rest: refill slots, focus points, hero points, clear prepared list',
    options: [
      { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
    ]
  },
  {
    name: 'refocus', description: '10-minute refocus: regain 1 focus point',
    options: [
      { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
    ]
  },
  {
    name: 'resource', description: 'View or manually set daily resources (focus, hero points, spell slots)',
    options: [
      {
        name: 'show', description: 'Display current daily resources for a character',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'character', description: 'Character name', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'set', description: 'Manually override a daily resource value',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'resource', description: 'Which resource to set', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Focus points', value: 'focus' },
            { name: 'Hero points', value: 'hero' },
            { name: 'Spell slots (requires rank + caster)', value: 'slot' }
          ]},
          { name: 'value', description: 'New current value (not delta)', type: ApplicationCommandOptionType.Integer, required: true, min_value: 0 },
          { name: 'rank', description: 'Spell rank (only for resource:slot)', type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 10 },
          { name: 'caster', description: 'Which caster (only for resource:slot, or if character has multiple)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'ancestry', description: 'Look up a PF2e ancestry',
    options: [{ name: 'name', description: 'The ancestry to look up (e.g. Elf, Dwarf, Gnome)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }]
  },
  {
    name: 'archetype', description: 'Look up a PF2e archetype',
    options: [{ name: 'name', description: 'The archetype to look up (e.g. Acrobat, Assassin, Fighter)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }]
  },
  {
    name: 'background', description: 'Look up a PF2e background',
    options: [{ name: 'name', description: 'The background to look up (e.g. Acolyte, Acrobat, Warrior)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }]
  },
  {
    name: 'feat', description: 'Look up a PF2e feat',
    options: [
      { name: 'name', description: 'The feat to look up (e.g. Power Attack, Sudden Charge)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
      { name: 'level', description: 'Filter by level (useful for feats with duplicate names)', type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 20 }
    ]
  },
  {
    name: 'item', description: 'Look up a PF2e item, weapon, armor, or piece of gear',
    options: [
      { name: 'name',  description: 'The item to look up (e.g. Dwarven Thrower, Healing Potion, Snare Kit)', type: ApplicationCommandOptionType.String,  required: true, autocomplete: true },
      { name: 'level', description: 'Filter by item level (useful for items with tiered versions)',          type: ApplicationCommandOptionType.Integer, required: false, min_value: 0, max_value: 25 }
    ]
  },
  {
    name: 'rule', description: 'Look up a PF2e condition, action, or trait',
    options: [{ name: 'name', description: 'What to look up (e.g. frightened, grapple, agile)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }]
  },
  {
    name: 'monster', description: 'Look up a PF2e monster/creature from the bestiary',
    options: [{ name: 'name', description: 'Name of the creature to look up (e.g. Goblin Warrior, Ancient Red Dragon)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }]
  },
  {
    name: 'monsteradd', description: 'Bot owner: add a missing creature to the global bestiary from a pasted stat block',
    options: [
      {
        name: 'paste', description: 'Paste a full PF2e stat block as text (Archives of Nethys format)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'statblock', description: 'Full stat block text (name, traits, HP/AC, attacks, abilities, etc.)', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'file', description: 'Upload a .txt file containing the full stat block',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'file', description: 'Plain-text (.txt) file with the stat block', type: ApplicationCommandOptionType.Attachment, required: true }
        ]
      },
      {
        name: 'remove', description: 'Remove a user-added creature from the global bestiary',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Name or slug of the creature to remove', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'spelladd', description: 'Bot owner: add a homebrew spell to the global spell database',
    options: [
      {
        name: 'paste', description: 'Paste a full PF2e spell statblock as text (AoN format)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'statblock', description: 'Full statblock text (name, Spell/Cantrip N, traits, cast, range, description, heightened, etc.)', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'file', description: 'Upload a .txt file containing the full spell statblock',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'file', description: 'Plain-text (.txt) file with the spell statblock', type: ApplicationCommandOptionType.Attachment, required: true }
        ]
      },
      {
        name: 'remove', description: 'Remove a homebrew spell from the global database',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'spell', description: 'Name of the homebrew spell to remove', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'itemadd', description: 'Bot owner: add a homebrew item to the global item database',
    options: [
      {
        name: 'paste', description: 'Paste a full PF2e item statblock as text (AoN format)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'statblock', description: 'Full statblock text (name, Item N, traits, Price, Usage, Bulk, description, etc.)', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'file', description: 'Upload a .txt file containing the full item statblock',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'file', description: 'Plain-text (.txt) file with the item statblock', type: ApplicationCommandOptionType.Attachment, required: true }
        ]
      },
      {
        name: 'remove', description: 'Remove a homebrew item from the global database',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'item', description: 'Name of the homebrew item to remove', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'monsterart', description: 'GM: attach a custom image to a monster\'s stat block (per-server)',
    options: [
      {
        name: 'set', description: 'Set the image that appears on /monster lookups for this creature',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name (e.g. Goblin Warrior)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'url',     description: 'Direct image URL (must end in .png, .jpg, .gif, or .webp for best results)', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'remove', description: 'Remove the saved image for a monster',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }
        ]
      },
      {
        name: 'view', description: 'View saved art for one monster, or list all saved art on this server',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name (leave blank to list all)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'monsteredit', description: 'GM: override or add stat-block fields for a monster (per-server)',
    options: [
      {
        name: 'ability', description: 'Add or replace a named ability (e.g. Scoundrel\'s Feint)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'name', description: 'Ability name (e.g. "Scoundrel\'s Feint", "Recall Knowledge")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'description', description: 'What the ability does', type: ApplicationCommandOptionType.String, required: false },
          { name: 'action_cost', description: 'Action cost', type: ApplicationCommandOptionType.String, required: false, choices: [
            { name: '1 action', value: '1 action' },
            { name: '2 actions', value: '2 actions' },
            { name: '3 actions', value: '3 actions' },
            { name: 'Reaction', value: '1 reaction' },
            { name: 'Free action', value: '1 free' },
            { name: 'No action (passive)', value: 'none' }
          ]},
          { name: 'trigger', description: 'Trigger for reactions/free actions', type: ApplicationCommandOptionType.String, required: false },
          { name: 'traits', description: 'Comma-separated traits (e.g. "concentrate, manipulate")', type: ApplicationCommandOptionType.String, required: false },
          { name: 'slot', description: 'Where in the stat block to show it (default: mid)', type: ApplicationCommandOptionType.String, required: false, choices: [
            { name: 'Top (interaction/passive abilities)', value: 'top' },
            { name: 'Mid (general abilities)', value: 'mid' },
            { name: 'Bot (offensive/reactive, near attacks)', value: 'bot' }
          ]}
        ]
      },
      {
        name: 'item', description: 'Add an item to the monster\'s carried gear',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'item', description: 'Item to add (e.g. "shortsword", "potion of healing (lesser)")', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'language', description: 'Add a language the monster speaks',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'language', description: 'Language (e.g. Common, Draconic, Goblin)', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'skill', description: 'Set a skill modifier (useful for Recall Knowledge checks)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'skill', description: 'Skill name (e.g. Athletics, Stealth, Society)', type: ApplicationCommandOptionType.String, required: true },
          { name: 'modifier', description: 'Modifier value (e.g. 8 or -1)', type: ApplicationCommandOptionType.Integer, required: true }
        ]
      },
      {
        name: 'attack', description: 'Add a flavor attack to the stat block (use /monsterattack to roll)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'name', description: 'Attack name (e.g. "Shortsword", "Bite")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'to_hit', description: 'Attack bonus (e.g. 8 or -1)', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'damage', description: 'Damage text (e.g. "1d6+3 piercing")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'type', description: 'Attack type', type: ApplicationCommandOptionType.String, required: false, choices: [
            { name: 'Melee', value: 'melee' },
            { name: 'Ranged', value: 'ranged' }
          ]},
          { name: 'traits', description: 'Comma-separated traits (e.g. "agile, finesse, reach")', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'ability-score', description: 'Set an ability modifier (Str/Dex/Con/Int/Wis/Cha)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'score', description: 'Which ability score', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Strength', value: 'str' },
            { name: 'Dexterity', value: 'dex' },
            { name: 'Constitution', value: 'con' },
            { name: 'Intelligence', value: 'int' },
            { name: 'Wisdom', value: 'wis' },
            { name: 'Charisma', value: 'cha' }
          ]},
          { name: 'value', description: 'Modifier value (e.g. 3 or -1)', type: ApplicationCommandOptionType.Integer, required: true }
        ]
      },
      {
        name: 'description', description: 'Set flavor text shown under the monster\'s title',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'description', description: 'Flavor text (up to 600 chars will be shown)', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'paste', description: 'Bulk-set fields via a JSON blob (for homebrew or mass edits)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'json', description: 'JSON with any of: abilities, items, languages, skills, attacks, ability_modifiers, description', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'view', description: 'Show current edits for a monster, or list all edits',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name (leave blank to list all edits)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'remove', description: 'Remove one entry from a list field (ability, item, language, skill, attack)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'field', description: 'Which field to remove from', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Ability', value: 'ability' },
            { name: 'Item', value: 'item' },
            { name: 'Language', value: 'language' },
            { name: 'Skill', value: 'skill' },
            { name: 'Attack', value: 'attack' }
          ]},
          { name: 'value', description: 'Value to remove (name of the ability/item/etc.)', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'reset', description: 'Wipe ALL edits for a monster (back to bestiary defaults)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'deity', description: 'Look up a PF2e deity, philosophy, or pantheon',
    options: [{ name: 'name', description: 'Name of the deity to look up (e.g. Abadar, Desna, Asmodeus)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }]
  },
  {
    name: 'skillinfo', description: 'Look up how a PF2e skill works — uses, actions, and DC examples',
    options: [
      { name: 'skill', description: 'Skill name (e.g. Athletics, Arcana, Stealth)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
      { name: 'character', description: 'Character to show your modifier for (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
    ]
  },
  {
    name: 'class', description: 'Look up a PF2e class: overview, proficiencies, features, feats, subclasses',
    options: [
      { name: 'class', description: 'Class name (e.g. Fighter, Wizard) — leave blank to use your character\'s class', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
      { name: 'character', description: 'Character whose class to show (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
    ]
  },
  {
    name: 'companion', description: 'Look up and track PF2e animal/plant/undead companions',
    options: [
      {
        name: 'info', description: 'Show the full statblock for a companion',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'name', description: 'Companion name (e.g. Wolf, Bear, Ape)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }]
      },
      {
        name: 'list', description: 'Browse all companions, optionally filtered by category',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'category', description: 'Filter to one category', type: ApplicationCommandOptionType.String, required: false, choices: [
            { name: 'Animal', value: 'Animal' },
            { name: 'Plant', value: 'Plant' },
            { name: 'Undead', value: 'Undead' }
          ]}
        ]
      },
      {
        name: 'add', description: 'Add a companion to one of your characters',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Your name for this companion (e.g. "Scout", "Mr. Wigglesworth")', type: ApplicationCommandOptionType.String, required: true },
          { name: 'base', description: 'Companion type (or bestiary creature if custom:true)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'form', description: 'Current form (young, mature, nimble, savage)', type: ApplicationCommandOptionType.String, required: false, choices: [
            { name: 'Young (base)', value: 'young' },
            { name: 'Mature', value: 'mature' },
            { name: 'Nimble (Dex-focused)', value: 'nimble' },
            { name: 'Savage (Str-focused, bigger dice)', value: 'savage' }
          ]},
          { name: 'custom', description: 'Set true for homebrew companions (uses bestiary creature as base)', type: ApplicationCommandOptionType.Boolean, required: false },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'mine', description: "List your character's companions",
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }]
      },
      {
        name: 'sheet', description: "Show a companion's full sheet with scaled stats",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'swap', description: 'Set which companion is currently active',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'companion', description: 'Companion name to make active', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'form', description: "Advance a companion's form (young → mature → nimble/savage)",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'form', description: 'New form', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Young (base)', value: 'young' },
            { name: 'Mature', value: 'mature' },
            { name: 'Nimble (Dex-focused)', value: 'nimble' },
            { name: 'Savage (Str-focused, bigger dice)', value: 'savage' }
          ]},
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'hp', description: "Adjust a companion's HP",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'change', description: 'HP change (+ heals, - damages). Leave all blank to full-heal.', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'set', description: 'Set exact HP value', type: ApplicationCommandOptionType.Integer, required: false, min_value: 0 },
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'remove', description: 'Remove a companion from your character',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'companion', description: 'Companion name to remove', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'art', description: 'Set or clear a portrait image for your companion',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'url', description: 'Direct image URL (or "clear" to remove)', type: ApplicationCommandOptionType.String, required: true },
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'set', description: 'Override a companion stat (AC, HP, ability scores, saves, attack, damage, etc.)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'stat', description: 'Which stat to override', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Strength (mod)',  value: 'str' },
            { name: 'Dexterity (mod)', value: 'dex' },
            { name: 'Constitution (mod)', value: 'con' },
            { name: 'Intelligence (mod)', value: 'int' },
            { name: 'Wisdom (mod)',    value: 'wis' },
            { name: 'Charisma (mod)',  value: 'cha' },
            { name: 'AC',              value: 'ac' },
            { name: 'Max HP',          value: 'hp' },
            { name: 'Fortitude save',  value: 'fort' },
            { name: 'Reflex save',     value: 'ref' },
            { name: 'Will save',       value: 'will' },
            { name: 'Attack bonus',    value: 'attack' },
            { name: 'Damage dice (e.g. 2d6)', value: 'damage_dice' },
            { name: 'Damage bonus',    value: 'damage_bonus' },
            { name: 'Speed (text)',    value: 'speed' },
            { name: 'Size',            value: 'size' },
            { name: 'Perception',      value: 'perception' },
          ]},
          { name: 'value', description: 'Value to set (numbers: 3 or -1 · damage_dice: 2d6 · speed: 40 feet · size: Medium)', type: ApplicationCommandOptionType.String, required: true },
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'reset', description: 'Clear a single stat override so the value auto-scales again',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'stat', description: 'Which stat to clear', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Strength',     value: 'str' },
            { name: 'Dexterity',    value: 'dex' },
            { name: 'Constitution', value: 'con' },
            { name: 'Intelligence', value: 'int' },
            { name: 'Wisdom',       value: 'wis' },
            { name: 'Charisma',     value: 'cha' },
            { name: 'AC',           value: 'ac' },
            { name: 'Max HP',       value: 'hp' },
            { name: 'Fortitude',    value: 'fort' },
            { name: 'Reflex',       value: 'ref' },
            { name: 'Will',         value: 'will' },
            { name: 'Attack bonus', value: 'attack' },
            { name: 'Damage dice',  value: 'damage_dice' },
            { name: 'Damage bonus', value: 'damage_bonus' },
            { name: 'Speed',        value: 'speed' },
            { name: 'Size',         value: 'size' },
            { name: 'Perception',   value: 'perception' },
          ]},
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'resetall', description: 'Clear ALL stat overrides on a companion (keeps art and notes)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'attack', description: 'Add, remove, or list custom attacks on a companion',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'action', description: 'What to do', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Add',    value: 'add' },
            { name: 'Remove', value: 'remove' },
            { name: 'List',   value: 'list' },
          ]},
          { name: 'name', description: 'Attack name (required for add/remove)', type: ApplicationCommandOptionType.String, required: false },
          { name: 'bonus', description: 'Attack bonus (add only, e.g. 15)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'damage', description: 'Damage expression (add only, e.g. "2d8+5")', type: ApplicationCommandOptionType.String, required: false },
          { name: 'type',   description: 'Damage type (add only, e.g. "piercing", "fire")', type: ApplicationCommandOptionType.String, required: false },
          { name: 'traits', description: 'Comma-separated traits (add only, e.g. "agile, finesse, reach")', type: ApplicationCommandOptionType.String, required: false },
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'ability', description: 'Add, remove, or list custom abilities on a companion',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'action', description: 'What to do', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Add',    value: 'add' },
            { name: 'Remove', value: 'remove' },
            { name: 'List',   value: 'list' },
          ]},
          { name: 'name',        description: 'Ability name (required for add/remove)', type: ApplicationCommandOptionType.String, required: false },
          { name: 'description', description: 'Full description (add only)', type: ApplicationCommandOptionType.String, required: false },
          { name: 'action_cost', description: 'Optional action cost (makes it a structured action)', type: ApplicationCommandOptionType.String, required: false, choices: [
            { name: '1 Action',    value: 'one-action' },
            { name: '2 Actions',   value: 'two-actions' },
            { name: '3 Actions',   value: 'three-actions' },
            { name: 'Reaction',    value: 'reaction' },
            { name: 'Free Action', value: 'free-action' },
          ]},
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'skill', description: 'Set, clear, or list skills on a companion (override-only)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'action', description: 'What to do', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'Set',   value: 'set' },
            { name: 'Clear', value: 'clear' },
            { name: 'List',  value: 'list' },
          ]},
          { name: 'name',  description: 'Skill name (e.g. "Athletics", "Lore: Dragons")', type: ApplicationCommandOptionType.String, required: false },
          { name: 'bonus', description: 'Total skill bonus (set only, e.g. "8" or "-1")', type: ApplicationCommandOptionType.String, required: false },
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'notes', description: 'Set or clear free-form notes on a companion',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'text', description: 'Note text (or "clear" to remove). Leave blank to clear.', type: ApplicationCommandOptionType.String, required: false },
          { name: 'companion', description: 'Companion name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'character', description: 'Character name (leave blank for active)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'bag', description: 'Manage your inventory bag',
    options: [
      {
        name: 'view', description: 'View your bag',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'character', description: 'Character name for encumbrance (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }]
      },
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
          { name: 'item', description: 'Item to add (auto-fills price/bulk if found in the database)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'qty', description: 'Quantity to add (default 1)', type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 999 }
        ]
      },
      {
        name: 'remove', description: 'Remove an item from your bag',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'category', description: 'Category name', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'item', description: 'Item to remove', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'qty', description: 'Quantity to remove (leave blank to remove the whole stack)', type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 999 }
        ]
      },
      {
        name: 'removecategory', description: 'Remove an entire category from your bag',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'category', description: 'Category to delete', type: ApplicationCommandOptionType.String, required: true, autocomplete: true }]
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
    name: 'hero', description: 'Track and use Hero Points (PF2e: max 3, start with 1 per session)',
    options: [
      {
        name: 'view', description: 'View your current Hero Points',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }]
      },
      {
        name: 'add', description: 'Award Hero Points to your character (caps at 3)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'amount', description: 'How many to award (default 1)', type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 10 },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'spend', description: 'Spend Hero Points (manual — e.g. for avoiding death)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'amount', description: 'How many to spend (default 1)', type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 10 },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'set', description: 'Set Hero Points to an exact value (GM override — can go above 3)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'value', description: 'Exact number of Hero Points', type: ApplicationCommandOptionType.Integer, required: true, min_value: 0, max_value: 10 },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'reset', description: 'Reset to the session default (1 Hero Point)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }]
      },
      {
        name: 'reroll', description: 'Spend 1 Hero Point to reroll (keep the higher result)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'dice', description: 'The roll to reroll, e.g. `1d20+8` for an Athletics check', type: ApplicationCommandOptionType.String, required: true },
          { name: 'previous', description: 'Your previous total (optional — shows side-by-side with kept-higher result)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false }
        ]
      }
    ]
  },
  {
    name: 'hp', description: 'Track character HP outside of combat (use /init hp during combat)',
    options: [
      {
        name: 'view', description: 'Show current and max HP',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }]
      },
      {
        name: 'set', description: 'Set exact HP value (clamped to [0, max])',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'value', description: 'New HP value (0 to max)', type: ApplicationCommandOptionType.Integer, required: true, min_value: 0 },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'add', description: 'Heal (positive) or damage (negative) HP',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'value', description: 'Amount to change (e.g. 10 to heal, -5 to damage)', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'reset', description: 'Restore HP to max (like a full rest, without affecting other things)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }]
      }
    ]
  },
  {
    name: 'xp', description: 'Track experience points (per character) and level progression',
    options: [
      {
        name: 'view', description: 'Show current XP, level progress, and recent awards',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }]
      },
      {
        name: 'award', description: 'Award XP to a character (positive to give, negative to take away)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'amount', description: 'XP to award (e.g. 80 for a moderate encounter)', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'reason', description: 'Why (e.g. "Defeated goblin chief")', type: ApplicationCommandOptionType.String, required: false },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'set', description: 'Manually set exact XP value (overrides any tracked total)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'amount', description: 'New exact XP value (0+)', type: ApplicationCommandOptionType.Integer, required: true, min_value: 0 },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'reset', description: 'Zero out XP and clear the award log (use after leveling up + /char update)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }]
      }
    ]
  },
  {
    name: 'notes', description: 'Per-character session notebook (NPCs, Locations, Plot Threads, Influence, Items)',
    options: [
      {
        name: 'add', description: 'Add a note to your character\'s notebook',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'category', description: 'Which section this note belongs to', type: ApplicationCommandOptionType.String, required: true, choices: [
            { name: 'NPCs', value: 'npcs' },
            { name: 'Locations', value: 'locations' },
            { name: 'Plot Threads', value: 'plot-threads' },
            { name: 'Influence', value: 'influence' },
            { name: 'Items', value: 'items' },
          ]},
          { name: 'text', description: 'The note itself (up to 1800 chars)', type: ApplicationCommandOptionType.String, required: true },
          { name: 'pin', description: 'Pin this note to the top of its category', type: ApplicationCommandOptionType.Boolean, required: false },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'list', description: 'List notes in a character\'s notebook (public-read)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'character', description: 'Character whose notebook to view', type: ApplicationCommandOptionType.String, required: false, autocomplete: true },
          { name: 'category', description: 'Filter to one category', type: ApplicationCommandOptionType.String, required: false, choices: [
            { name: 'NPCs', value: 'npcs' },
            { name: 'Locations', value: 'locations' },
            { name: 'Plot Threads', value: 'plot-threads' },
            { name: 'Influence', value: 'influence' },
            { name: 'Items', value: 'items' },
          ]},
          { name: 'pinned', description: 'Show only pinned notes', type: ApplicationCommandOptionType.Boolean, required: false }
        ]
      },
      {
        name: 'view', description: 'Show full detail of a single note',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'id', description: 'Note ID (use /notes list to find it)', type: ApplicationCommandOptionType.Integer, required: true, autocomplete: true },
          { name: 'character', description: 'Character whose notebook it\'s in', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'search', description: 'Search notes by keyword',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'query', description: 'Text to search for', type: ApplicationCommandOptionType.String, required: true },
          { name: 'character', description: 'Character whose notebook to search', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'edit', description: 'Edit the text of a note you wrote',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'id', description: 'Note ID to edit', type: ApplicationCommandOptionType.Integer, required: true, autocomplete: true },
          { name: 'text', description: 'New note text (up to 1800 chars)', type: ApplicationCommandOptionType.String, required: true },
          { name: 'character', description: 'Character whose notebook it\'s in', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'remove', description: 'Remove a note you wrote',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'id', description: 'Note ID to remove', type: ApplicationCommandOptionType.Integer, required: true, autocomplete: true },
          { name: 'character', description: 'Character whose notebook it\'s in', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'pin', description: 'Pin or unpin a note (toggle)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'id', description: 'Note ID to pin/unpin', type: ApplicationCommandOptionType.Integer, required: true, autocomplete: true },
          { name: 'character', description: 'Character whose notebook it\'s in', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      }
    ]
  },
  {
    name: 'init', description: 'Initiative tracker for combat',
    options: [
      { name: 'start', description: 'Start a new encounter in this channel', type: ApplicationCommandOptionType.Subcommand },
      {
        name: 'add', description: 'Add your loaded character (or companion) to initiative',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'bonus', description: 'Override initiative bonus (defaults to Perception)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'result', description: 'Use this exact initiative result instead of rolling', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'character', description: 'Character name (leave blank if you only have one)', type: ApplicationCommandOptionType.String, required: false },
          { name: 'companion', description: 'Add a companion instead of your character (name, or "active" for the active one)', type: ApplicationCommandOptionType.String, required: false, autocomplete: true }
        ]
      },
      {
        name: 'addnpc', description: 'GM: add a custom NPC to initiative (for homebrew or ad-hoc monsters)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Monster name', type: ApplicationCommandOptionType.String, required: true },
          { name: 'bonus', description: 'Initiative modifier', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'hp', description: 'Max HP', type: ApplicationCommandOptionType.Integer, required: true },
          { name: 'ac', description: 'AC (for hit/crit determination)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'result', description: 'Use exact initiative instead of rolling', type: ApplicationCommandOptionType.Integer, required: false }
        ]
      },
      {
        name: 'addmonster', description: 'GM: add a bestiary monster (auto-fills HP, AC, perception)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'monster', description: 'Monster name from the bestiary (e.g. Goblin Warrior)', type: ApplicationCommandOptionType.String, required: true, autocomplete: true },
          { name: 'count', description: 'How many copies to add (default 1, max 20)', type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 20 },
          { name: 'init_mode', description: 'Initiative rolling: shared (one roll for all) or per copy', type: ApplicationCommandOptionType.String, required: false, choices: [
            { name: 'Per copy (each rolls separately, default)', value: 'per_copy' },
            { name: 'Shared (one roll, all copies use it)', value: 'shared' },
          ]},
          { name: 'hp_mode', description: 'HP: fixed (published number) or varied (±5 wiggle)', type: ApplicationCommandOptionType.String, required: false, choices: [
            { name: 'Fixed (default, matches the book)', value: 'fixed' },
            { name: 'Varied (±5 wiggle for variety)', value: 'varied' },
          ]},
          { name: 'bonus', description: 'Override initiative modifier (defaults to perception)', type: ApplicationCommandOptionType.Integer, required: false },
          { name: 'result', description: 'Use exact initiative instead of rolling (applies to all copies)', type: ApplicationCommandOptionType.Integer, required: false }
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
      {
        name: 'move', description: 'Declare a combatant moves — prompts AoO from anyone with a reaction available',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Combatant who is moving', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'reaction', description: 'Manually prompt a specific combatant for a reaction (Shield Block, etc.)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Combatant who might react', type: ApplicationCommandOptionType.String, required: true },
          { name: 'reason', description: 'What just happened (shown in the prompt)', type: ApplicationCommandOptionType.String, required: false }
        ]
      },
      {
        name: 'damage', description: 'Manually roll persistent damage on a combatant (outside the normal turn-tick)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Combatant to roll persistent damage on', type: ApplicationCommandOptionType.String, required: true }
        ]
      },
      {
        name: 'dying', description: 'GM: manually set a combatant\'s Dying value (0–4)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Combatant name', type: ApplicationCommandOptionType.String, required: true },
          { name: 'value', description: 'New Dying value (0 = recover, 4 = dead)', type: ApplicationCommandOptionType.Integer, required: true, min_value: 0, max_value: 4 }
        ]
      },
      {
        name: 'recovery', description: 'Manually roll a recovery check for a dying combatant (backup if auto-roll did not fire)',
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: 'name', description: 'Combatant who is dying and needs to roll recovery', type: ApplicationCommandOptionType.String, required: true }
        ]
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
      { name: 'map', description: 'Override the auto-tracked MAP penalty for this attack', type: ApplicationCommandOptionType.Integer, required: false, choices: [
        { name: 'First attack (no penalty)', value: 0 },
        { name: 'Second attack (-5)', value: 1 },
        { name: 'Third attack (-10)', value: 2 }
      ]},
      { name: 'no_map', description: 'Skip MAP entirely (e.g. Flurry of Blows, free Strike)', type: ApplicationCommandOptionType.Boolean, required: false }
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
      { name: 'map', description: 'Override the auto-tracked MAP penalty for this attack', type: ApplicationCommandOptionType.Integer, required: false, choices: [
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
          { name: 'map', description: 'Override the auto-tracked MAP penalty (strike/spell only)', type: ApplicationCommandOptionType.Integer, required: false, choices: [
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