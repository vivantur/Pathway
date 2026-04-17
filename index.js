require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fetch = require('node-fetch');
const fs = require('fs');
const {
  getEncounter,
  createEncounter,
  deleteEncounter,
  addCombatant,
  removeCombatant,
  advanceTurn,
  modifyHp,
} = require('./encounters');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});

process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

let spellDatabase = [];
try {
  spellDatabase = JSON.parse(fs.readFileSync('spells.json', 'utf8'));
  console.log(`Loaded ${spellDatabase.length} spells from database.`);
} catch (err) {
  console.error('Could not load spells.json:', err.message);
}

let ancestryDatabase = {};
try {
  ancestryDatabase = JSON.parse(fs.readFileSync('ancestries.json', 'utf8'));
  console.log(`Loaded ${Object.keys(ancestryDatabase).length} ancestries from database.`);
} catch (err) {
  console.error('Could not load ancestries.json:', err.message);
}

let archetypeDatabase = {};
try {
  archetypeDatabase = JSON.parse(fs.readFileSync('archetypes.json', 'utf8'));
  console.log(`Loaded ${Object.keys(archetypeDatabase).length} archetypes from database.`);
} catch (err) {
  console.error('Could not load archetypes.json:', err.message);
}

let rulesDatabase = {};
try {
  rulesDatabase = JSON.parse(fs.readFileSync('rules.json', 'utf8'));
  const total = Object.values(rulesDatabase).reduce((sum, cat) => sum + Object.keys(cat).length, 0);
  console.log(`Loaded ${total} rules entries from database.`);
} catch (err) {
  console.error('Could not load rules.json:', err.message);
}

function loadCharacters() {
  try { return JSON.parse(fs.readFileSync('characters.json', 'utf8')); }
  catch { return {}; }
}
function saveCharacters(data) {
  fs.writeFileSync('characters.json', JSON.stringify(data, null, 2));
}

// ── Bag helpers ───────────────────────────────────────────────────────────────
function loadBags() {
  try { return JSON.parse(fs.readFileSync('bags.json', 'utf8')); }
  catch { return {}; }
}
function saveBags(data) {
  fs.writeFileSync('bags.json', JSON.stringify(data, null, 2));
}

function getOrCreateBag(bags, userId) {
  if (!bags[userId]) {
    bags[userId] = { bagName: 'Bag 1', categories: {} };
  }
  return bags[userId];
}

function buildBagEmbed(userBag) {
  const embed = new EmbedBuilder()
    .setTitle(`🎒 ${userBag.bagName}`)
    .setColor(0x9B59B6)
    .setFooter({ text: '/bag add • /bag remove • /bag removecategory • /bag rename • /bag clear' });

  const cats = Object.entries(userBag.categories ?? {});

  if (cats.length === 0) {
    embed.setDescription('*Your bag is empty. Use `/bag add <category> <item>` to get started!*');
  } else {
    for (const [cat, items] of cats) {
      const value = items.length > 0 ? items.join('\n') : '*Empty*';
      embed.addFields({ name: `**${cat}**`, value, inline: true });
    }
  }

  return embed;
}

// ── Character helpers ─────────────────────────────────────────────────────────
function getMod(score) {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
function calcProfNum(profNum, level) {
  if (!profNum || profNum === 0) return 0;
  return profNum + level;
}
function fmt(n) { return n >= 0 ? `+${n}` : `${n}`; }
function xpToNextLevel() { return 1000; }

function resolveChar(userId, nameArg, characters) {
  if (!characters[userId] || Object.keys(characters[userId]).length === 0)
    return { error: 'You have no saved characters! Use `/char add` to add one.' };
  let charKey;
  if (!nameArg) {
    const keys = Object.keys(characters[userId]);
    if (keys.length === 1) { charKey = keys[0]; }
    else {
      const names = Object.values(characters[userId]).map(c => c.name).join(', ');
      return { error: `You have multiple characters! Specify one.\nYour characters: ${names}` };
    }
  } else {
    charKey = nameArg.toLowerCase().replace(/\s+/g, '-');
  }
  if (!characters[userId][charKey]) {
    const names = Object.values(characters[userId]).map(c => c.name).join(', ');
    return { error: `Couldn't find that character. Your characters: ${names}` };
  }
  return { charKey, char: characters[userId][charKey] };
}

function buildRollEmbed({ title, breakdown, charName, thumbnail }) {
  const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(title).setDescription(breakdown);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (charName) embed.setFooter({ text: charName });
  return embed;
}

function formatRollBreakdown(dieRoll, modifier, extraBonus, total, sides) {
  const isCrit = sides === 20 && dieRoll === 20;
  const isFumble = sides === 20 && dieRoll === 1;
  const modPart = modifier !== 0 ? ` + ${modifier}` : '';
  const extraPart = extraBonus && extraBonus !== 0 ? ` + ${extraBonus}` : '';
  let line = `1d20 (${dieRoll})${modPart}${extraPart} = **${total}**`;
  if (isCrit) line += '\n⭐ Natural 20!';
  if (isFumble) line += '\n💀 Natural 1!';
  return line;
}

// ── Initiative helpers ────────────────────────────────────────────────────────
function computeCharPerception(charEntry) {
  const c = charEntry.data;
  const lvl = c.level ?? 1;
  const wisMod = Math.floor(((c.abilities?.wis ?? 10) - 10) / 2);
  const profNum = c.proficiencies?.perception ?? 0;
  return wisMod + calcProfNum(profNum, lvl);
}

function computeCharMaxHp(charEntry) {
  const c = charEntry.data;
  const lvl = c.level ?? 1;
  const conMod = Math.floor(((c.abilities?.con ?? 10) - 10) / 2);
  return (c.attributes?.ancestryhp ?? 0) + (c.attributes?.classhp ?? 0) + ((c.attributes?.bonushp ?? 0) * lvl) + (conMod * lvl);
}

function buildInitiativeEmbed(enc) {
  const lines = enc.combatants.map((combatant, i) => {
    const marker = i === enc.turnIndex ? '▶️ ' : '   ';
    const hp = combatant.isNpc ? '(HP hidden)' : `${combatant.hp}/${combatant.maxHp} HP`;
    const dead = combatant.hp === 0 ? ' 💀' : '';
    return `${marker}**${combatant.initiative}** — ${combatant.name} ${hp}${dead}`;
  });
  return new EmbedBuilder()
    .setTitle(`⚔️ Initiative — Round ${enc.round}`)
    .setDescription(lines.join('\n') || '*No combatants yet*')
    .setColor(0xAA0000);
}

function rollD20Plus(modifier) {
  const roll = Math.floor(Math.random() * 20) + 1;
  return { total: roll + modifier, roll, mod: modifier };
}
// Parse a damage expression like "1d6+2", "2d8-1", "1d4"
// Returns { rolls, bonus, total, display } or null if invalid
function rollDamageExpression(expr) {
  if (!expr) return null;
  const cleaned = expr.toLowerCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!match) return null;
  const numDice = parseInt(match[1]) || 1;
  const numSides = parseInt(match[2]);
  const bonus = match[3] ? parseInt(match[3]) : 0;
  if (numDice < 1 || numDice > 100 || numSides < 1) return null;
  const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * numSides) + 1);
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + bonus;
  const bonusText = bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : '';
  const display = `${numDice}d${numSides}[${rolls.join(', ')}]${bonusText}`;
  return { rolls, bonus, numDice, numSides, sum, total, display };
}

// Determine PF2e degree of success for an attack
// Returns 'crit-success' | 'success' | 'failure' | 'crit-failure' | null (if no AC known)
function determineDegreeOfSuccess(attackTotal, dieRoll, targetAc) {
  if (targetAc === null || targetAc === undefined) return null;
  let degree;
  if (attackTotal >= targetAc + 10) degree = 'crit-success';
  else if (attackTotal >= targetAc) degree = 'success';
  else if (attackTotal <= targetAc - 10) degree = 'crit-failure';
  else degree = 'failure';
  // Nat 20 bumps up, nat 1 bumps down
  if (dieRoll === 20) {
    degree = degree === 'crit-failure' ? 'failure' : degree === 'failure' ? 'success' : 'crit-success';
  } else if (dieRoll === 1) {
    degree = degree === 'crit-success' ? 'success' : degree === 'success' ? 'failure' : 'crit-failure';
  }
  return degree;
}

// PF2e MAP calculation
function calculateMap(mapLevel, agile) {
  if (mapLevel === 0 || !mapLevel) return 0;
  if (mapLevel === 1) return agile ? -4 : -5;
  return agile ? -8 : -10;
}
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
// ── Spell lookup ──────────────────────────────────────────────────────────────
function findSpell(spellName) {
  const normalize = str => str.toLowerCase().trim()
    .replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"');
  const query = normalize(spellName);
  return spellDatabase.find(s => normalize(s.name ?? '') === query)
    || spellDatabase.find(s => normalize(s.name ?? '').startsWith(query))
    || spellDatabase.find(s => normalize(s.name ?? '').includes(query))
    || null;
}

// ── Rules lookup ──────────────────────────────────────────────────────────────
function findRule(query) {
  const q = query.toLowerCase().trim().replace(/\s+/g, '-');
  const qRaw = query.toLowerCase().trim();
  for (const category of Object.values(rulesDatabase)) {
    if (category[q]) return { rule: category[q], matches: [] };
    const exactName = Object.values(category).find(r => r.name.toLowerCase() === qRaw);
    if (exactName) return { rule: exactName, matches: [] };
  }
  const matches = [];
  for (const category of Object.values(rulesDatabase)) {
    for (const [key, rule] of Object.entries(category)) {
      if (rule.name.toLowerCase().includes(qRaw) || key.includes(q)) matches.push(rule);
    }
  }
  if (matches.length === 1) return { rule: matches[0], matches: [] };
  if (matches.length > 1)   return { rule: null, matches };
  return { rule: null, matches: [] };
}

function buildRuleEmbed(rule) {
  const colors  = { condition: 0xe74c3c, action: 0x2ecc71, trait: 0xf39c12 };
  const emojis  = { condition: '🩸', action: '⚡', trait: '🏷️' };
  const embed = new EmbedBuilder()
    .setColor(colors[rule.category] ?? 0x7289DA)
    .setTitle(`${emojis[rule.category] ?? '📖'} ${rule.name}`)
    .setDescription(rule.description);
  if (rule.action_cost) embed.addFields({ name: '⏱️ Action Cost', value: rule.action_cost, inline: true });
  if (rule.value_label) embed.addFields({ name: '📊 Format', value: rule.value_label, inline: true });
  if (rule.traits?.length) embed.addFields({ name: '🏷️ Traits', value: rule.traits.join(', '), inline: true });
  if (rule.trigger)      embed.addFields({ name: '🔔 Trigger', value: rule.trigger, inline: false });
  if (rule.requirements) embed.addFields({ name: '📋 Requirements', value: rule.requirements, inline: false });
  const cat = rule.category.charAt(0).toUpperCase() + rule.category.slice(1);
  embed.setFooter({ text: `${cat} • ${rule.source ?? 'Pathfinder 2e'}` });
  return embed;
}

// ── Archetype lookup ──────────────────────────────────────────────────────────
function findArchetype(query) {
  const q = query.toLowerCase().trim();
  for (const [key, archetype] of Object.entries(archetypeDatabase)) {
    if (key.toLowerCase() === q) return { archetype, matches: [] };
  }
  const matches = Object.entries(archetypeDatabase).filter(([key]) => key.toLowerCase().includes(q));
  if (matches.length === 1) return { archetype: matches[0][1], matches: [] };
  if (matches.length > 1)   return { archetype: null, matches: matches.map(([k]) => k) };
  return { archetype: null, matches: [] };
}

function buildArchetypeEmbed(archetype) {
  const rarityColor = { Common: 0x4a90d9, Uncommon: 0xc45f00, Rare: 0x6b21a8 };
  const typeEmoji = archetype.type === 'multiclass' ? '🔀' : '📖';
  const typeLabel = archetype.type === 'multiclass' ? 'Multiclass Archetype' : 'Archetype';
  const rarityLabel = archetype.rarity !== 'Common' ? ` • ${archetype.rarity}` : '';
  const embed = new EmbedBuilder()
    .setColor(rarityColor[archetype.rarity] ?? 0x4a90d9)
    .setTitle(`${typeEmoji} ${archetype.name}`)
    .setDescription(archetype.description || '*No description available.*')
    .addFields(
      { name: '📋 Type',            value: `${typeLabel}${rarityLabel}`, inline: true },
      { name: '🎯 Dedication Feat', value: `Feat ${archetype.dedication_level}`, inline: true },
      { name: '📚 Source',          value: archetype.source || 'Unknown', inline: true },
    );
  if (archetype.prerequisites)
    embed.addFields({ name: '⚠️ Prerequisites', value: archetype.prerequisites, inline: false });
  embed.setFooter({ text: 'Pathway • PF2e Archetype Lookup' });
  return embed;
}

// ── Currency helpers ──────────────────────────────────────────────────────────
const COPPER_VALUE = { cp: 1, sp: 10, gp: 100, pp: 1000 };

function walletToCopper(wallet) {
  return (wallet.cp ?? 0) + (wallet.sp ?? 0) * 10 + (wallet.gp ?? 0) * 100 + (wallet.pp ?? 0) * 1000;
}
function copperToWallet(total) {
  const pp = Math.floor(total / 1000); total %= 1000;
  const gp = Math.floor(total / 100);  total %= 100;
  const sp = Math.floor(total / 10);   total %= 10;
  return { pp, gp, sp, cp: total };
}
function formatWallet(wallet) {
  const parts = [];
  if (wallet.pp) parts.push(`${wallet.pp} pp`);
  if (wallet.gp) parts.push(`${wallet.gp} gp`);
  if (wallet.sp) parts.push(`${wallet.sp} sp`);
  if (wallet.cp || parts.length === 0) parts.push(`${wallet.cp ?? 0} cp`);
  return parts.join(', ');
}
function buildWalletEmbed(char, charEntry) {
  const wallet = charEntry.wallet ?? { pp: 0, gp: 0, sp: 0, cp: 0 };
  const totalGP = (walletToCopper(wallet) / 100).toFixed(2);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`💰 ${char.name}'s Wallet`)
    .addFields(
      { name: '🟣 Platinum (pp)', value: `${wallet.pp ?? 0}`, inline: true },
      { name: '🟡 Gold (gp)',     value: `${wallet.gp ?? 0}`, inline: true },
      { name: '⚪ Silver (sp)',   value: `${wallet.sp ?? 0}`, inline: true },
      { name: '🟤 Copper (cp)',   value: `${wallet.cp ?? 0}`, inline: true },
      { name: '💵 Total Value',   value: `${totalGP} gp`,     inline: true },
    )
    .setFooter({ text: 'Use /gold add, /gold spend, or /gold convert' });
  if (charEntry.art) embed.setThumbnail(charEntry.art);
  return embed;
}

// ── Normalize spell ───────────────────────────────────────────────────────────
function normalizeSpell(spell) {
  let level = spell.level;
  if (typeof level === 'string') level = parseInt(level) || 1;
  let traditions = spell.traditions ?? '';
  if (typeof traditions === 'string') traditions = traditions.split(',').map(t => t.trim()).filter(Boolean);
  if (!Array.isArray(traditions)) traditions = [];
  let traits = spell.traits ?? '';
  if (typeof traits === 'string') traits = traits.split(',').map(t => t.trim()).filter(Boolean);
  if (!Array.isArray(traits)) traits = [];
  let type = spell.type ?? 'Spell';
  if (traits.map(t => t.toLowerCase()).includes('cantrip')) type = 'Cantrip';
  if (level === 0) type = 'Cantrip';
  let savingThrow = null;
  if (spell.defense && spell.defense.trim()) savingThrow = spell.defense.replace(/^basic\s+/i, '').trim();
  const target = spell.target ?? spell.targets ?? null;
  let damage = spell.damage;
  if (damage && typeof damage === 'object') {
    const parts = [damage.base, damage.type].filter(Boolean).join(' ');
    damage = (parts + (damage.extra ? ` + ${damage.extra}` : '')).trim() || null;
  }
  if (!damage || (typeof damage === 'string' && !damage.trim())) damage = null;
  let description = spell.description?.trim() || spell.summary?.trim() || '*No description available.*';
  return { ...spell, level, traditions, traits, type, savingThrow, target, damage, description };
}

// ── Build spell embed ─────────────────────────────────────────────────────────
function buildSpellEmbed(rawSpell) {
  const spell = normalizeSpell(rawSpell);
  const isCantrip = spell.type === 'Cantrip';
  const levelDisplay = isCantrip ? `Cantrip ${spell.level}` : `Spell ${spell.level}`;
  const traditionsDisplay = spell.traditions.length > 0 ? spell.traditions.join(', ') : 'None';
  const traitsDisplay = spell.traits.length > 0 ? spell.traits.join(', ') : null;
  let description = spell.description && spell.description.trim() ? spell.description : '*No description available.*';
  if (description.length > 1500) description = description.slice(0, 1500) + '...\n*(description truncated)*';
  const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(spell.name).setDescription(description);
  const levelLine = [`**${levelDisplay}**`, spell.school ?? null].filter(Boolean).join(' · ');
  embed.addFields({ name: '\u200b', value: levelLine, inline: false });
  if (spell.source) embed.addFields({ name: 'Source', value: spell.source, inline: false });
  embed.addFields({ name: 'Traditions', value: traditionsDisplay, inline: false });
  if (traitsDisplay) embed.addFields({ name: 'Traits', value: traitsDisplay, inline: false });
  const metaLines = [
    spell.cast     ? `**Cast** ${spell.cast}`         : null,
    spell.range    ? `**Range** ${spell.range}`       : null,
    spell.area     ? `**Area** ${spell.area}`         : null,
    spell.target   ? `**Target** ${spell.target}`     : null,
    spell.duration ? `**Duration** ${spell.duration}` : null,
  ].filter(Boolean);
  if (metaLines.length > 0) embed.addFields({ name: 'Meta', value: metaLines.join('\n'), inline: false });
  if (spell.savingThrow) embed.addFields({ name: 'Saving Throw', value: spell.savingThrow, inline: false });
  if (spell.damage)      embed.addFields({ name: 'Damage', value: spell.damage, inline: false });
  if (spell.heightening && typeof spell.heightening === 'object') {
    let htText = '';
    if (spell.heightening.type === 'per_rank' && spell.heightening.damage_bonus)
      htText = `Each rank above ${spell.level}: +${spell.heightening.damage_bonus} damage`;
    else if (spell.heightening.type === 'fixed' && spell.heightening.levels)
      htText = Object.entries(spell.heightening.levels).map(([k, v]) => `**${k}:** ${v}`).join('\n');
    else htText = JSON.stringify(spell.heightening);
    if (htText) embed.addFields({ name: '⬆️ Heightened', value: htText, inline: false });
  } else if (spell.heightened?.trim()) {
    embed.addFields({ name: '⬆️ Heightened', value: spell.heightened, inline: false });
  }
  embed.setFooter({ text: `Pathfinder 2e · ${spell.source ?? 'Unknown source'}` });
  return embed;
}

// ── Ancestry embed builders ───────────────────────────────────────────────────
const ANCESTRY_COLORS = { main: 0x4B8B6F, heritage: 0x7B5EA7, feats: 0xC4862A };

function buildAncestryCorePage(ancestry) {
  const boosts = ancestry.attribute_boosts.join(', ');
  const flaws  = ancestry.attribute_flaws.length ? ancestry.attribute_flaws.join(', ') : 'None';
  const sensesText   = ancestry.senses.map(s => `**${s.name}** — ${s.description}`).join('\n');
  const languageText = `${ancestry.languages.base.join(', ')}\n*Plus additional languages equal to ${ancestry.languages.bonus_count}, chosen from: ${ancestry.languages.bonus_pool.join(', ')}.*`;
  return new EmbedBuilder()
    .setTitle(ancestry.name)
    .setDescription(`*${ancestry.traits.join(', ')}*\n\n${ancestry.description}`)
    .setColor(ANCESTRY_COLORS.main)
    .setFooter({ text: `Source: ${ancestry.source} • Page 1/3` })
    .addFields(
      { name: '❤️ Hit Points',       value: `${ancestry.hp}`,       inline: true },
      { name: '🏃 Speed',            value: `${ancestry.speed} ft.`, inline: true },
      { name: '📏 Size',             value: ancestry.size,           inline: true },
      { name: '📈 Attribute Boosts', value: boosts,                  inline: true },
      { name: '📉 Attribute Flaw',   value: flaws,                   inline: true },
      { name: '\u200B',              value: '\u200B',                inline: true },
      { name: '👁️ Senses',          value: sensesText || 'None',    inline: false },
      { name: '🗣️ Languages',       value: languageText,            inline: false },
    );
}

function buildAncestryHeritagesPage(ancestry) {
  const embed = new EmbedBuilder()
    .setTitle(`${ancestry.name} — Heritages`)
    .setDescription('Choose one heritage at character creation.')
    .setColor(ANCESTRY_COLORS.heritage)
    .setFooter({ text: `Source: ${ancestry.source} • Page 2/3` });
  for (const h of ancestry.heritages)
    embed.addFields({ name: `◈ ${h.name}`, value: h.description, inline: false });
  return embed;
}

function buildAncestryFeatsPage(ancestry) {
  const embed = new EmbedBuilder()
    .setTitle(`${ancestry.name} — Ancestry Feats`)
    .setDescription('You gain ancestry feats at 1st level and every 4 levels thereafter.')
    .setColor(ANCESTRY_COLORS.feats)
    .setFooter({ text: `Source: ${ancestry.source} • Page 3/3` });
  for (const group of ancestry.ancestry_feats) {
    embed.addFields({ name: `── Level ${group.level} ──`, value: '\u200B', inline: false });
    for (const feat of group.feats) {
      const prereqLine = feat.prerequisites ? `*Prerequisite: ${feat.prerequisites.join(', ')}*\n` : '';
      embed.addFields({ name: `✦ ${feat.name}`, value: `${prereqLine}${feat.description}`, inline: false });
    }
  }
  return embed;
}

function buildAncestryButtons(currentPage, ancestryKey) {
  const id = ancestryKey.toLowerCase();
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ancestry_${id}_0`).setLabel('◀ Core').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`ancestry_${id}_1`).setLabel('Heritages').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 1),
    new ButtonBuilder().setCustomId(`ancestry_${id}_2`).setLabel('Feats ▶').setStyle(ButtonStyle.Success).setDisabled(currentPage === 2),
  );
}

// ── Bot ready ─────────────────────────────────────────────────────────────────
client.once('clientReady', () => { console.log(`Logged in as ${client.user.tag}!`); });

// ── Interaction handler ───────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── Button handler ────────────────────────────────────────────────
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('ancestry_')) return;
    const parts = interaction.customId.split('_');
    const pageIndex = parseInt(parts[parts.length - 1], 10);
    const ancestryKey = parts.slice(1, parts.length - 1).join('_');
    const ancestry = ancestryDatabase[ancestryKey];
    if (!ancestry) return interaction.update({ content: '❌ Could not reload ancestry data.', components: [] });
    let newEmbed;
    if (pageIndex === 0) newEmbed = buildAncestryCorePage(ancestry);
    if (pageIndex === 1) newEmbed = buildAncestryHeritagesPage(ancestry);
    if (pageIndex === 2) newEmbed = buildAncestryFeatsPage(ancestry);
    return interaction.update({ embeds: [newEmbed], components: [buildAncestryButtons(pageIndex, ancestryKey)] });
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ─── /ping ───────────────────────────────────────────────────────
  if (commandName === 'ping') {
    await interaction.reply('Pong! 🏓 Bot is alive and running.');
  }

  // ─── /char ───────────────────────────────────────────────────────
  else if (commandName === 'char') {
    const sub = interaction.options.getSubcommand();

    // ADD
    if (sub === 'add') {
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('file');
      if (!attachment.name.endsWith('.json')) return interaction.editReply('Please attach a `.json` file exported from Pathbuilder.');
      try {
        const response = await fetch(attachment.url);
        const data = await response.json();
        const char = data.build ?? data;
        if (!char || !char.name) return interaction.editReply('Could not read that file.');
        const characters = loadCharacters();
        const userId = interaction.user.id;
        if (!characters[userId]) characters[userId] = {};
        const key = char.name.toLowerCase().replace(/\s+/g, '-');
        const existingArt    = characters[userId][key]?.art ?? null;
        const existingSenses = characters[userId][key]?.senses ?? null;
        characters[userId][key] = { name: char.name, data: char, art: existingArt, senses: existingSenses, saved: new Date().toISOString() };
        saveCharacters(characters);
        await interaction.editReply(`✅ **${char.name}** saved! Use \`/sheet\` to view them.`);
      } catch (err) { console.error(err); await interaction.editReply('Something went wrong reading that file. Try again!'); }
    }

    // UPDATE
    else if (sub === 'update') {
      await interaction.deferReply();
      const attachment = interaction.options.getAttachment('file');
      if (!attachment.name.endsWith('.json')) return interaction.editReply('Please attach a `.json` file exported from Pathbuilder.');
      try {
        const response = await fetch(attachment.url);
        const data = await response.json();
        const char = data.build ?? data;
        if (!char || !char.name) return interaction.editReply('Could not read that file.');
        const characters = loadCharacters();
        const userId = interaction.user.id;
        const key = char.name.toLowerCase().replace(/\s+/g, '-');
        if (!characters[userId]?.[key]) return interaction.editReply(`Couldn't find **${char.name}**. Use \`/char add\` first.`);
        const existingArt    = characters[userId][key].art ?? null;
        const existingSenses = characters[userId][key].senses ?? null;
        characters[userId][key] = { name: char.name, data: char, art: existingArt, senses: existingSenses, saved: new Date().toISOString() };
        saveCharacters(characters);
        await interaction.editReply(`✅ **${char.name}** updated to level ${char.level}!`);
      } catch (err) { console.error(err); await interaction.editReply('Something went wrong. Try again!'); }
    }

    // REMOVE
    else if (sub === 'remove') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      const charKey = interaction.options.getString('name').toLowerCase().replace(/\s+/g, '-');
      if (!characters[userId]?.[charKey]) {
        const names = Object.values(characters[userId] ?? {}).map(c => c.name).join(', ');
        return interaction.reply(`Couldn't find that character. Your characters: ${names}`);
      }
      const name = characters[userId][charKey].name;
      delete characters[userId][charKey];
      saveCharacters(characters);
      await interaction.reply(`✅ **${name}** has been removed.`);
    }

    // LIST
    else if (sub === 'list') {
      const userId = interaction.user.id;
      const characters = loadCharacters();
      if (!characters[userId] || Object.keys(characters[userId]).length === 0)
        return interaction.reply('You have no saved characters! Use `/char add` to add one.');
      const list = Object.values(characters[userId]).map(c => `• **${c.name}**${c.art ? ' 🖼️' : ''}`).join('\n');
      await interaction.reply(`Your characters:\n${list}`);
    }

    // FEATS
    else if (sub === 'feats') {
      await interaction.deferReply();
      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('name'), characters);
      if (error) return interaction.editReply(error);
      const c = charEntry.data;
      const allFeats = (c.feats ?? []).map(f => Array.isArray(f) ? f[0] : f).filter(Boolean);
      const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(`✨ ${c.name}'s Feats`).setDescription(allFeats.length > 0 ? allFeats.join('\n') : 'No feats found');
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      await interaction.editReply({ embeds: [embed] });
    }

    // ART
    else if (sub === 'art') {
      const url = interaction.options.getString('url');
      const characters = loadCharacters();
      const { error, charKey } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      if (!url.startsWith('http://') && !url.startsWith('https://')) return interaction.reply({ content: "That doesn't look like a valid URL.", ephemeral: true });
      characters[interaction.user.id][charKey].art = url;
      saveCharacters(characters);
      const charName = characters[interaction.user.id][charKey].name;
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x7289DA).setTitle(`✅ Art set for ${charName}`).setThumbnail(url).setDescription('Character art updated!')] });
    }

    // INFO
    else if (sub === 'info') {
      const field = interaction.options.getString('field');
      const value = interaction.options.getString('value');
      const nameArg = interaction.options.getString('character');
      const characters = loadCharacters();
      const { error, charKey } = resolveChar(interaction.user.id, nameArg, characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });
      const parsed = value.split(',').map(v => v.trim()).filter(Boolean);
      characters[interaction.user.id][charKey][field] = parsed;
      saveCharacters(characters);
      const charName = characters[interaction.user.id][charKey].name;
      const fieldLabel = field.charAt(0).toUpperCase() + field.slice(1);
      await interaction.reply({ content: `✅ **${fieldLabel}** updated for **${charName}**:\n${parsed.join(', ')}`, ephemeral: true });
    }
  }

  // ─── /sheet ──────────────────────────────────────────────────────
  else if (commandName === 'sheet') {
    await interaction.deferReply();
    const userId = interaction.user.id;
    const characters = loadCharacters();
    const nameArg = interaction.options.getString('name');
    const { error, charKey, char: charEntry } = resolveChar(userId, nameArg, characters);
    if (error) return interaction.editReply(error);
    try {
      const c = charEntry.data;
      const lvl = c.level ?? 1;
      const ab = c.abilities ?? {};
      const prof = c.proficiencies ?? {};
      const currentXP = c.xp ?? 0;
      const xpDisplay = `${currentXP} / ${xpToNextLevel(lvl)} XP`;
      const conMod = Math.floor(((ab.con ?? 10) - 10) / 2);
      const totalHP = (c.attributes?.ancestryhp ?? 0) + (c.attributes?.classhp ?? 0) + ((c.attributes?.bonushp ?? 0) * lvl) + (conMod * lvl);
      const profBonus = Math.floor(lvl / 4) + 2;
      const wisMod = Math.floor(((ab.wis ?? 10) - 10) / 2);
      const percMod = wisMod + calcProfNum(prof.perception ?? 0, lvl);
      let spellAttackBonus = null, spellDC = null;
      if (c.spellCasters?.length > 0) {
        const caster = c.spellCasters[0];
        const tradAbilMap = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
        const traditionProfMap = { arcane: 'castingArcane', divine: 'castingDivine', occult: 'castingOccult', primal: 'castingPrimal' };
        const tradKey = traditionProfMap[caster.magicTradition?.toLowerCase()] ?? 'castingArcane';
        const keyAbility = caster.ability?.toLowerCase() ?? tradAbilMap[caster.magicTradition?.toLowerCase()] ?? 'int';
        const keyMod = Math.floor(((ab[keyAbility] ?? 10) - 10) / 2);
        const spellProfMod = calcProfNum(prof[tradKey] ?? 0, lvl);
        spellAttackBonus = keyMod + spellProfMod;
        spellDC = 10 + keyMod + spellProfMod;
      }
      const fortMod   = Math.floor(((ab.con ?? 10) - 10) / 2) + calcProfNum(prof.fortitude ?? 0, lvl);
      const reflexMod = Math.floor(((ab.dex ?? 10) - 10) / 2) + calcProfNum(prof.reflex ?? 0, lvl);
      const willMod   = Math.floor(((ab.wis ?? 10) - 10) / 2) + calcProfNum(prof.will ?? 0, lvl);
      const skillMap = {
        acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
        deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
        nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
        society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
      };
      const profIcons = { 2: '◑', 4: '●', 6: '★', 8: '⭐' };
      const trainedSkills = Object.entries(prof)
        .filter(([skill, profNum]) => skillMap[skill] && profNum > 0)
        .map(([skill, profNum]) => {
          const abilMod = Math.floor(((ab[skillMap[skill]] ?? 10) - 10) / 2);
          const total = abilMod + calcProfNum(profNum, lvl);
          return `${profIcons[profNum] || '◑'} ${skill.charAt(0).toUpperCase() + skill.slice(1)} ${fmt(total)}`;
        });
      const loreSkills = (c.lores ?? []).map(([loreName, profNum]) => {
        const intMod = Math.floor(((ab.int ?? 10) - 10) / 2);
        const total = intMod + calcProfNum(profNum, lvl);
        return `${profIcons[profNum] || '◑'} Lore: ${loreName} ${fmt(total)}`;
      });
      const allTrainedSkills = [...trainedSkills, ...loreSkills];
      const half = Math.ceil(allTrainedSkills.length / 2);
      const col1 = allTrainedSkills.slice(0, half);
      const col2 = allTrainedSkills.slice(half);
      const skillCols = col1.map((s, i) => `${s.padEnd(24)}${col2[i] ?? ''}`).join('\n');
      let attackLines = '';
      if (c.weapons?.length > 0) {
        c.weapons.forEach(w => {
          const atkBonus = w.attack ?? 0;
          const dmgBonus = w.damageBonus > 0 ? `+${w.damageBonus}` : w.damageBonus < 0 ? `${w.damageBonus}` : '';
          const dmgType = w.damageType === 'P' ? 'Piercing' : w.damageType === 'S' ? 'Slashing' : w.damageType === 'B' ? 'Bludgeoning' : w.damageType ?? '';
          attackLines += `**${w.display ?? w.name}** ${fmt(atkBonus)} to hit · ${w.die ?? '1d4'}${dmgBonus} ${dmgType}\n`;
        });
      }
      const languages = charEntry.languages ?? c.languages ?? [];
      const senses = charEntry.senses ?? [];
      const ancestryDisplay = `${c.ancestry ?? ''} ${c.heritage ?? ''}`.trim();
      const classDisplay = c.class ?? 'Unknown';
      const dualClass = c.dualClass ? ` / ${c.dualClass}` : '';
      const embed = new EmbedBuilder()
        .setColor(0x7289DA)
        .setTitle(c.name)
        .setDescription(
          `*${ancestryDisplay} · ${classDisplay}${dualClass} · Level ${lvl}*\n` +
          `**Background:** ${c.background ?? 'Unknown'} · **Deity:** ${c.deity ?? 'None'}\n` +
          `**XP:** ${xpDisplay}`
        )
        .addFields(
          { name: '⚔️ Combat Stats', value: `**AC** ${c.acTotal?.acTotal ?? '?'} · **HP** ${totalHP} · **Speed** ${c.attributes?.speed ?? 30} ft · **Perception** ${fmt(percMod)}\n**Prof Bonus** +${profBonus}` + (spellAttackBonus !== null ? ` · **Spell Attack** ${fmt(spellAttackBonus)} · **Spell DC** ${spellDC}` : ''), inline: false },
          { name: '💪 Ability Scores', value: `**STR** ${ab.str ?? '?'} (${getMod(ab.str ?? 10)}) · **DEX** ${ab.dex ?? '?'} (${getMod(ab.dex ?? 10)}) · **CON** ${ab.con ?? '?'} (${getMod(ab.con ?? 10)})\n**INT** ${ab.int ?? '?'} (${getMod(ab.int ?? 10)}) · **WIS** ${ab.wis ?? '?'} (${getMod(ab.wis ?? 10)}) · **CHA** ${ab.cha ?? '?'} (${getMod(ab.cha ?? 10)})`, inline: false },
          { name: '🛡️ Saving Throws', value: `**Fort** ${fmt(fortMod)} · **Reflex** ${fmt(reflexMod)} · **Will** ${fmt(willMod)}`, inline: false },
          { name: '🎯 Trained Skills', value: allTrainedSkills.length > 0 ? `\`\`\`${skillCols}\`\`\`` : 'No trained skills', inline: false },
          ...(attackLines ? [{ name: '⚔️ Attacks', value: attackLines.trim(), inline: false }] : []),
          { name: '🌐 Languages', value: languages.length > 0 ? languages.join(', ') : 'None set — use `/char info`', inline: true },
          { name: '👁️ Senses', value: senses.length > 0 ? senses.join(', ') : 'None set — use `/char info`', inline: true },
        )
        .setFooter({ text: `Pathfinder 2e · Saved ${charEntry.saved?.split('T')[0] ?? ''}` });
      if (charEntry.art) embed.setThumbnail(charEntry.art);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      await interaction.editReply('Something went wrong. Check the terminal for details!');
    }
  }

  // ─── /spellbook ──────────────────────────────────────────────────
  else if (commandName === 'spellbook') {
    await interaction.deferReply();
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('name'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    if (!c.spellCasters?.length) return interaction.editReply(`**${c.name}** has no spellcasting!`);
    const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`🔮 ${c.name}'s Spellbook`);
    if (charEntry.art) embed.setThumbnail(charEntry.art);
    c.spellCasters.forEach(caster => {
      let casterText = '';
      (caster.spells ?? []).forEach(slotGroup => {
        const names = slotGroup.list?.map(s => s.name).filter(Boolean).join(', ');
        if (names) {
          const label = slotGroup.spellLevel === 0 ? 'Cantrips' : `Level ${slotGroup.spellLevel}`;
          casterText += `**${label}:** ${names}\n`;
        }
      });
      if (casterText) embed.addFields({ name: `${caster.name} (${caster.magicTradition} · ${caster.castingType})`, value: casterText.trim(), inline: false });
    });
    embed.setFooter({ text: 'Use /cast <spell> to cast · /spell <n> for spell details' });
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── /spell ──────────────────────────────────────────────────────
  else if (commandName === 'spell') {
    await interaction.deferReply();
    const spell = findSpell(interaction.options.getString('name'));
    if (!spell) return interaction.editReply(`Couldn't find that spell. Check the spelling and try again!`);
    await interaction.editReply({ embeds: [buildSpellEmbed(spell)] });
  }

  // ─── /cast ───────────────────────────────────────────────────────
  else if (commandName === 'cast') {
    await interaction.deferReply();
    const spellName = interaction.options.getString('spell');
    const nameArg   = interaction.options.getString('character');
    const castLevel = interaction.options.getInteger('level') ?? null;
    const targetName = interaction.options.getString('target');
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, nameArg, characters);
    if (error) return interaction.editReply(error);
    const rawSpell = findSpell(spellName);
    if (!rawSpell) return interaction.editReply(`Couldn't find a spell called **${spellName}**. Check the spelling and try again!`);
    const spell = normalizeSpell(rawSpell);
    const c = charEntry.data;
    const ab = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl = c.level ?? 1;
    const traditionProfMap = { arcane: 'castingArcane', divine: 'castingDivine', occult: 'castingOccult', primal: 'castingPrimal' };
    const tradAbilMap = { arcane: 'int', divine: 'wis', occult: 'cha', primal: 'wis' };
    let keyAbility = 'int', spellProfNum = 2;
    if (c.spellCasters?.length > 0) {
      const spellTraditions = spell.traditions.map(t => t.toLowerCase());
      const caster = c.spellCasters.find(sc => spellTraditions.includes(sc.magicTradition?.toLowerCase())) ?? c.spellCasters[0];
      const tradKey = traditionProfMap[caster.magicTradition?.toLowerCase()] ?? 'castingArcane';
      spellProfNum = prof[tradKey] ?? 2;
      keyAbility = caster.ability?.toLowerCase() ?? tradAbilMap[caster.magicTradition?.toLowerCase()] ?? 'int';
    }
    const keyMod = Math.floor(((ab[keyAbility] ?? 10) - 10) / 2);
    const spellAttackBonus = keyMod + calcProfNum(spellProfNum, lvl);
    const spellDC = 10 + keyMod + calcProfNum(spellProfNum, lvl);
    const isAttackSpell = !!spell.attack;
    const saveType = spell.savingThrow ?? null;
    const effectiveLevel = castLevel ?? spell.level ?? 1;
    const isCantrip = spell.type === 'Cantrip';
    const levelDisplay = isCantrip ? `Cantrip ${effectiveLevel}` : `Level ${effectiveLevel}`;
    const traditionDisplay = spell.traditions?.[0] ?? '';

    // Look up target if provided
    const channelId = interaction.channel.id;
    const enc = getEncounter(channelId);
    let target = null;
    if (targetName) {
      if (!enc) {
        return interaction.editReply('❌ Target specified but no active encounter in this channel. Start one with `/init start`.');
      }
      target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
      if (!target) {
        return interaction.editReply(`❌ No combatant named "${targetName}" in this encounter.`);
      }
    }

    const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`${c.name} casts ${spell.name}!`);
    if (charEntry.art) embed.setThumbnail(charEntry.art);

    let description = `*${levelDisplay}${traditionDisplay ? ` ${traditionDisplay}` : ''} spell*\n`;
    if (spell.cast)     description += `**Cast** ${spell.cast}\n`;
    if (spell.range)    description += `**Range** ${spell.range}\n`;
    if (spell.area)     description += `**Area** ${spell.area}\n`;
    if (spell.target)   description += `**Target** ${spell.target}\n`;
    if (spell.duration) description += `**Duration** ${spell.duration}\n`;
    description += '\n';

    // Handle attack spells with targeting
    let attackDegree = null;
    let attackDieRoll = null;
    let attackTotal = null;
    if (isAttackSpell) {
      attackDieRoll = Math.floor(Math.random() * 20) + 1;
      attackTotal = attackDieRoll + spellAttackBonus;
      description += `**Spell Attack Roll**\n1d20 (${attackDieRoll}) ${fmt(spellAttackBonus)} = **${attackTotal}**`;
      if (attackDieRoll === 20) description += ' ⭐ Natural 20!';
      if (attackDieRoll === 1)  description += ' 💀 Natural 1!';
      description += '\n\n';
      if (target) {
        attackDegree = determineDegreeOfSuccess(attackTotal, attackDieRoll, target.ac ?? null);
      }
    }

    // Save-based spells
    if (saveType) {
      if (target) {
        description += `**${saveType.charAt(0).toUpperCase() + saveType.slice(1)} Save DC: ${spellDC}** — ${target.name} must roll \`/save type:${saveType}\`\n\n`;
      } else {
        description += `**${saveType.charAt(0).toUpperCase() + saveType.slice(1)} Save DC: ${spellDC}**\n\n`;
      }
    }

    // Roll damage if the spell has a damage expression and either no target or target was hit
    let damageResult = null;
    let finalDamage = 0;
    let appliedDamage = false;
    if (spell.damage && typeof spell.damage === 'string') {
      damageResult = rollDamageExpression(spell.damage);
    }

    if (damageResult) {
      // If attack spell with target and we know the outcome:
      if (isAttackSpell && target && attackDegree) {
        if (attackDegree === 'crit-success') {
          finalDamage = damageResult.total * 2;
          description += `**Damage (CRIT × 2)**\n${damageResult.display} = ${damageResult.total} × 2 = **${finalDamage}**\n`;
        } else if (attackDegree === 'success') {
          finalDamage = damageResult.total;
          description += `**Damage**\n${damageResult.display} = **${finalDamage}**\n`;
        }
        // miss/crit miss: no damage shown
      } else {
        // No target or save-based spell: show damage, GM applies after save
        finalDamage = damageResult.total;
        description += `**Damage:** ${damageResult.display} = **${finalDamage}**\n`;
        if (saveType && target) {
          description += `*(On a failed save, apply ${finalDamage} damage. Crit fail = ${finalDamage * 2}, success = ${Math.floor(finalDamage / 2)}, crit success = 0)*\n`;
        }
      }
    } else if (spell.damage) {
      // Damage was non-parseable string (already in spell.damage as a pre-formatted string)
      description += `**Damage:** ${spell.damage}\n`;
    }

    // Attack outcome for targeted attack spells
    if (isAttackSpell && target) {
      if (attackDegree === 'crit-success')      description += `\n🎯 **Critical Hit on ${target.name}!** (AC ${target.ac})`;
      else if (attackDegree === 'success')      description += `\n✅ **Hit on ${target.name}!** (AC ${target.ac})`;
      else if (attackDegree === 'failure')      description += `\n❌ **Miss on ${target.name}.** (AC ${target.ac})`;
      else if (attackDegree === 'crit-failure') description += `\n💢 **Critical Miss on ${target.name}.** (AC ${target.ac})`;
      else                                       description += `\n🎯 Attack against **${target.name}** (AC unknown — GM decides)`;
    }

    // Apply damage to target automatically if it's an attack spell that hit
    if (target && isAttackSpell && (attackDegree === 'success' || attackDegree === 'crit-success') && finalDamage > 0) {
      modifyHp(channelId, target.name, -finalDamage);
      appliedDamage = true;
      const downed = target.hp === 0 ? ' 💀 **Down!**' : '';
      description += target.isNpc
        ? `\n❤️ **${target.name}** took ${finalDamage} damage${downed}`
        : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${downed}`;
    }

    // Short description from spell
    const shortDesc = spell.description ?? '';
    if (shortDesc && shortDesc !== '*No description available.*') {
      const desc = shortDesc.length > 300 ? shortDesc.slice(0, 300) + `...\n*Use \`/spell ${spell.name}\` for full details*` : shortDesc;
      description += `\n\n${desc}`;
    }

    embed.setDescription(description);
    embed.setFooter({ text: `${c.name} · Spell Attack ${fmt(spellAttackBonus)} · DC ${spellDC}` });

    // Mention target's owner if they're a player and got hit or targeted
    const payload = { embeds: [embed] };
    if (target && !target.isNpc && target.ownerId) {
      payload.content = `<@${target.ownerId}>`;
    }
    await interaction.editReply(payload);
  }
  // ─── /mattack ────────────────────────────────────────────────────
  else if (commandName === 'mattack') {
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;
    const enc = getEncounter(channelId);

    if (!enc) {
      return interaction.reply({ content: '❌ No active encounter in this channel. Start one with `/init start`.', ephemeral: true });
    }
    if (userId !== enc.gmId) {
      return interaction.reply({ content: '❌ Only the GM can use `/mattack`.', ephemeral: true });
    }

    const attackerName = interaction.options.getString('attacker');
    const attackName = interaction.options.getString('name');
    const attackBonus = interaction.options.getInteger('bonus');
    const damageExpr = interaction.options.getString('damage');
    const targetName = interaction.options.getString('target');
    const damageType = (interaction.options.getString('type') ?? 'damage').toLowerCase();
    const map = interaction.options.getInteger('map') ?? 0;
    const agile = interaction.options.getBoolean('agile') ?? false;

    // Find attacker in encounter
    const attacker = enc.combatants.find(x => x.name.toLowerCase() === attackerName.toLowerCase());
    if (!attacker) {
      return interaction.reply({ content: `❌ No combatant named "${attackerName}" in this encounter.`, ephemeral: true });
    }

    // Find target in encounter
    const target = enc.combatants.find(x => x.name.toLowerCase() === targetName.toLowerCase());
    if (!target) {
      return interaction.reply({ content: `❌ No combatant named "${targetName}" in this encounter.`, ephemeral: true });
    }

    // Validate damage expression
    const damageResult = rollDamageExpression(damageExpr);
    if (!damageResult) {
      return interaction.reply({ content: `❌ Couldn't parse damage expression "${damageExpr}". Use something like \`1d6+2\` or \`2d8\`.`, ephemeral: true });
    }

    // Calculate MAP and roll attack
    const mapPenalty = calculateMap(map, agile);
    const dieRoll = Math.floor(Math.random() * 20) + 1;
    const attackTotal = dieRoll + attackBonus + mapPenalty;

    // Determine outcome
    const degree = determineDegreeOfSuccess(attackTotal, dieRoll, target.ac ?? null);

    // Build attack roll line
    const mapText = mapPenalty !== 0 ? ` ${mapPenalty}` : '';
    let attackLine = `**Attack Roll**\n1d20 (${dieRoll}) ${fmt(attackBonus)}${mapText} = **${attackTotal}**`;
    if (dieRoll === 20) attackLine += ' ⭐ Natural 20!';
    if (dieRoll === 1)  attackLine += ' 💀 Natural 1!';

    // Damage (double on crit)
    let finalDamage = Math.max(1, damageResult.total);
    let damageLine;
    if (degree === 'crit-success') {
      finalDamage = finalDamage * 2;
      damageLine = `**Damage (CRIT × 2)**\n${damageResult.display} = ${damageResult.total} × 2 = **${finalDamage} ${damageType}**`;
    } else {
      damageLine = `**Damage**\n${damageResult.display} = **${finalDamage} ${damageType}**`;
    }

    // Outcome line
    let outcomeLine;
    if (degree === 'crit-success')      outcomeLine = `🎯 **Critical Hit on ${target.name}!** (AC ${target.ac})`;
    else if (degree === 'success')      outcomeLine = `✅ **Hit on ${target.name}!** (AC ${target.ac})`;
    else if (degree === 'failure')      outcomeLine = `❌ **Miss on ${target.name}.** (AC ${target.ac})`;
    else if (degree === 'crit-failure') outcomeLine = `💢 **Critical Miss on ${target.name}.** (AC ${target.ac})`;
    else                                outcomeLine = `🎯 Attack against **${target.name}** (AC unknown — GM decides)`;

    // Apply damage if hit
    let hpLine = '';
    let mentionLine = '';
    if (degree === 'success' || degree === 'crit-success') {
      modifyHp(channelId, target.name, -finalDamage);
      const downed = target.hp === 0 ? ' 💀 **Down!**' : '';
      hpLine = target.isNpc
        ? `\n❤️ **${target.name}** took ${finalDamage} damage${downed}`
        : `\n❤️ **${target.name}**: ${target.hp}/${target.maxHp} HP${downed}`;
    }
    // Always mention target's owner (if player) so they know they were attacked
    if (!target.isNpc && target.ownerId) {
      mentionLine = `<@${target.ownerId}>`;
    }

    // Assemble
    const showDamage = (degree === 'success' || degree === 'crit-success' || degree === null);
    const description = [
      attackLine,
      '',
      showDamage ? damageLine : null,
      outcomeLine,
      hpLine || null,
    ].filter(s => s !== null).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle(`👹 ${attacker.name} attacks with ${attackName}!`)
      .setDescription(description)
      .setFooter({ text: `GM attack · Attack ${fmt(attackBonus)} · ${damageExpr} ${damageType}` });

    const replyPayload = { embeds: [embed] };
    if (mentionLine) replyPayload.content = mentionLine;
    await interaction.reply(replyPayload);
  }
// ─── /roll ───────────────────────────────────────────────────────
  else if (commandName === 'roll') {
    try {
      const raw = interaction.options.getString('dice').toLowerCase().replace(/\s+/g, '');

      // Validate: only allow digits, d, +, -, *, /
      if (!/^[0-9d+\-*/]+$/.test(raw)) {
        return interaction.reply({ content: '❌ Invalid expression! Use dice like `2d6`, math like `10+5`, or mix them like `1d8+4`.', ephemeral: true });
      }

      // Tokenize into parts + operators
      const tokens = raw.split(/([+\-*/])/).filter(Boolean);
      const breakdownParts = [];
      const values = [];

      for (const token of tokens) {
        if (['+', '-', '*', '/'].includes(token)) {
          breakdownParts.push(token === '*' ? '×' : token === '/' ? '÷' : token);
          values.push(token);
          continue;
        }

        if (token.includes('d')) {
          const [numDiceStr, numSidesStr] = token.split('d');
          const numDice = parseInt(numDiceStr) || 1;
          const numSides = parseInt(numSidesStr);

          if (!numSides || numSides < 1 || numDice < 1 || numDice > 100) {
            return interaction.reply({ content: `❌ Invalid dice: \`${token}\`. Try something like \`2d6\` or \`1d20\`.`, ephemeral: true });
          }

          const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * numSides) + 1);
          const rollTotal = rolls.reduce((a, b) => a + b, 0);
          const rollDisplay = numDice > 1 ? `${numDice}d${numSides}[${rolls.join(', ')}]` : `${numDice}d${numSides}(${rolls[0]})`;

          breakdownParts.push(rollDisplay);
          values.push(rollTotal);
        } else {
          const num = parseInt(token);
          if (isNaN(num)) {
            return interaction.reply({ content: `❌ Couldn't parse \`${token}\`. Make sure your expression is valid.`, ephemeral: true });
          }
          breakdownParts.push(`${num}`);
          values.push(num);
        }
      }

      // First pass: handle * and /
      const pass1values = [];
      const pass1ops = [];
      let current = values[0];
      for (let i = 1; i < values.length; i += 2) {
        const op = values[i];
        const next = values[i + 1];
        if (op === '*') {
          current = current * next;
        } else if (op === '/') {
          if (next === 0) return interaction.reply({ content: '❌ Cannot divide by zero!', ephemeral: true });
          current = Math.floor(current / next);
        } else {
          pass1values.push(current);
          pass1ops.push(op);
          current = next;
        }
      }
      pass1values.push(current);

      // Second pass: handle + and -
      let total = pass1values[0];
      for (let i = 0; i < pass1ops.length; i++) {
        if (pass1ops[i] === '+') total += pass1values[i + 1];
        if (pass1ops[i] === '-') total -= pass1values[i + 1];
      }
      total = Math.floor(total);

      const breakdown = `${breakdownParts.join(' ')} = **${total}**`;

      const charNameArg = interaction.options.getString('character');
      let thumbnail = null;
      if (charNameArg) {
        const characters = loadCharacters();
        thumbnail = characters[interaction.user.id]?.[charNameArg.toLowerCase().replace(/\s+/g, '-')]?.art ?? null;
      }

      const embed = new EmbedBuilder()
        .setColor(0x7289DA)
        .setTitle(`🎲 ${raw}`)
        .setDescription(breakdown);
      if (thumbnail) embed.setThumbnail(thumbnail);
      embed.setFooter({ text: charNameArg ?? interaction.user.username });

      await interaction.reply({ embeds: [embed] });

    } catch (err) {
      console.error('Roll error:', err);
      await interaction.reply({ content: '❌ Something went wrong parsing that expression. Try again!', ephemeral: true });
    }
  }
  // ─── /skill ──────────────────────────────────────────────────────
  else if (commandName === 'skill') {
    await interaction.deferReply();
    const skillName  = interaction.options.getString('skill');
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    const ab = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl = c.level ?? 1;
    const skillMap = {
      acrobatics: 'dex', arcana: 'int', athletics: 'str', crafting: 'int',
      deception: 'cha', diplomacy: 'cha', intimidation: 'cha', medicine: 'wis',
      nature: 'wis', occultism: 'int', performance: 'cha', religion: 'wis',
      society: 'int', stealth: 'dex', survival: 'wis', thievery: 'dex',
    };
    const abilKey  = skillMap[skillName];
    const abilMod  = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
    const profNum  = prof[skillName] ?? 0;
    const modifier = abilMod + calcProfNum(profNum, lvl);
    const dieRoll  = Math.floor(Math.random() * 20) + 1;
    const total    = dieRoll + modifier + extraBonus;
    const profLabels = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
    const skillDisplay = skillName.charAt(0).toUpperCase() + skillName.slice(1);
    await interaction.editReply({ embeds: [buildRollEmbed({ title: `${c.name} makes a ${skillDisplay} check!`, breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20), charName: `${c.name} · ${profLabels[profNum] ?? 'Untrained'} (${fmt(modifier)})`, thumbnail: charEntry.art ?? null })] });
  }

  // ─── /save ───────────────────────────────────────────────────────
  else if (commandName === 'save') {
    await interaction.deferReply();
    const saveType   = interaction.options.getString('type');
    const extraBonus = interaction.options.getInteger('bonus') ?? 0;
    const characters = loadCharacters();
    const { error, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.editReply(error);
    const c = charEntry.data;
    const ab = c.abilities ?? {};
    const prof = c.proficiencies ?? {};
    const lvl = c.level ?? 1;
    const saveAbilMap = { fortitude: 'con', reflex: 'dex', will: 'wis' };
    const abilKey  = saveAbilMap[saveType];
    const abilMod  = Math.floor(((ab[abilKey] ?? 10) - 10) / 2);
    const profNum  = prof[saveType] ?? 0;
    const modifier = abilMod + calcProfNum(profNum, lvl);
    const dieRoll  = Math.floor(Math.random() * 20) + 1;
    const total    = dieRoll + modifier + extraBonus;
    const profLabels = { 0: 'Untrained', 2: 'Trained', 4: 'Expert', 6: 'Master', 8: 'Legendary' };
    const saveDisplay = saveType.charAt(0).toUpperCase() + saveType.slice(1);
    await interaction.editReply({ embeds: [buildRollEmbed({ title: `${c.name} makes a ${saveDisplay} save!`, breakdown: formatRollBreakdown(dieRoll, modifier, extraBonus, total, 20), charName: `${c.name} · ${profLabels[profNum] ?? 'Untrained'} (${fmt(modifier)})`, thumbnail: charEntry.art ?? null })] });
  }

  // ─── /ancestry ───────────────────────────────────────────────────
  else if (commandName === 'ancestry') {
    const input = interaction.options.getString('name');
    const key = input.toLowerCase().trim();
    const ancestry = ancestryDatabase[key];
    if (!ancestry) return interaction.reply({ content: `❌ No ancestry found for **"${input}"**. Available: ${Object.keys(ancestryDatabase).join(', ')}`, ephemeral: true });
    await interaction.reply({ embeds: [buildAncestryCorePage(ancestry)], components: [buildAncestryButtons(0, key)] });
  }

  // ─── /archetype ──────────────────────────────────────────────────
  else if (commandName === 'archetype') {
    const input = interaction.options.getString('name');
    const { archetype, matches } = findArchetype(input);
    if (!archetype && matches.length > 1)
      return interaction.reply({ content: `🔍 Multiple archetypes match **"${input}"**. Did you mean one of these?\n**${matches.sort().join(', ')}**`, ephemeral: true });
    if (!archetype)
      return interaction.reply({ content: `❌ No archetype found for **"${input}"**. Check your spelling or try another name.`, ephemeral: true });
    await interaction.reply({ embeds: [buildArchetypeEmbed(archetype)] });
  }

  // ─── /rule ───────────────────────────────────────────────────────
  else if (commandName === 'rule') {
    const input = interaction.options.getString('name');
    const { rule, matches } = findRule(input);
    if (!rule && matches.length > 1) {
      const nameList = matches.map(r => `${r.name} *(${r.category})*`).sort().join('\n');
      return interaction.reply({ content: `🔍 Multiple entries match **"${input}"**:\n${nameList}`, ephemeral: true });
    }
    if (!rule)
      return interaction.reply({ content: `❌ No rule found for **"${input}"**.\nTry a **condition** (e.g. frightened, prone), **action** (e.g. stride, grapple), or **trait** (e.g. agile, finesse).`, ephemeral: true });
    await interaction.reply({ embeds: [buildRuleEmbed(rule)] });
  }

  // ─── /bag ────────────────────────────────────────────────────────
  else if (commandName === 'bag') {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const bags = loadBags();
    const userBag = getOrCreateBag(bags, userId);

    if (sub === 'view') {
      return interaction.reply({ embeds: [buildBagEmbed(userBag)] });
    }
    if (sub === 'rename') {
      const newName = interaction.options.getString('name');
      userBag.bagName = newName;
      saveBags(bags);
      return interaction.reply({ content: `✅ Bag renamed to **${newName}**!`, ephemeral: true });
    }
    if (sub === 'add') {
      const category = interaction.options.getString('category').trim();
      const item = interaction.options.getString('item').trim();
      if (!userBag.categories[category]) userBag.categories[category] = [];
      userBag.categories[category].push(item);
      saveBags(bags);
      return interaction.reply({ content: `✅ Added **${item}** to **${category}**!`, ephemeral: true });
    }
    if (sub === 'remove') {
      const category = interaction.options.getString('category').trim();
      const item = interaction.options.getString('item').trim();
      if (!userBag.categories[category])
        return interaction.reply({ content: `❌ Category **"${category}"** doesn't exist in your bag.`, ephemeral: true });
      const index = userBag.categories[category].findIndex(i => i.toLowerCase() === item.toLowerCase());
      if (index === -1)
        return interaction.reply({ content: `❌ **${item}** not found in **${category}**.`, ephemeral: true });
      userBag.categories[category].splice(index, 1);
      if (userBag.categories[category].length === 0) delete userBag.categories[category];
      saveBags(bags);
      return interaction.reply({ content: `✅ Removed **${item}** from **${category}**!`, ephemeral: true });
    }
    if (sub === 'removecategory') {
      const category = interaction.options.getString('category').trim();
      if (!userBag.categories[category])
        return interaction.reply({ content: `❌ Category **"${category}"** doesn't exist.`, ephemeral: true });
      delete userBag.categories[category];
      saveBags(bags);
      return interaction.reply({ content: `🗑️ Removed category **${category}** from your bag.`, ephemeral: true });
    }
    if (sub === 'clear') {
      userBag.categories = {};
      saveBags(bags);
      return interaction.reply({ content: `🗑️ Your bag has been cleared!`, ephemeral: true });
    }
  }

  // ─── /gold ───────────────────────────────────────────────────────
  else if (commandName === 'gold') {
    const subcommand = interaction.options.getSubcommand();
    const characters = loadCharacters();
    const { error, charKey, char: charEntry } = resolveChar(interaction.user.id, interaction.options.getString('character'), characters);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    const char = charEntry.data;
    if (!charEntry.wallet) charEntry.wallet = { pp: 0, gp: 0, sp: 0, cp: 0 };
    const wallet = charEntry.wallet;

    if (subcommand === 'view') {
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry)] });
    }
    if (subcommand === 'add') {
      const pp = interaction.options.getInteger('pp') ?? 0;
      const gp = interaction.options.getInteger('gp') ?? 0;
      const sp = interaction.options.getInteger('sp') ?? 0;
      const cp = interaction.options.getInteger('cp') ?? 0;
      if (pp === 0 && gp === 0 && sp === 0 && cp === 0)
        return interaction.reply({ content: '❌ Specify at least one currency amount.', ephemeral: true });
      wallet.pp = (wallet.pp ?? 0) + pp;
      wallet.gp = (wallet.gp ?? 0) + gp;
      wallet.sp = (wallet.sp ?? 0) + sp;
      wallet.cp = (wallet.cp ?? 0) + cp;
      charEntry.wallet = wallet;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`💰 ${char.name}'s Wallet — Added ${formatWallet({ pp, gp, sp, cp })}`)] });
    }
    if (subcommand === 'spend') {
      const pp = interaction.options.getInteger('pp') ?? 0;
      const gp = interaction.options.getInteger('gp') ?? 0;
      const sp = interaction.options.getInteger('sp') ?? 0;
      const cp = interaction.options.getInteger('cp') ?? 0;
      if (pp === 0 && gp === 0 && sp === 0 && cp === 0)
        return interaction.reply({ content: '❌ Specify at least one currency amount.', ephemeral: true });
      const currentTotal = walletToCopper(wallet);
      const spendTotal = pp * 1000 + gp * 100 + sp * 10 + cp;
      if (spendTotal > currentTotal)
        return interaction.reply({ content: `❌ **${char.name}** can't afford that! They only have **${formatWallet(wallet)}**.`, ephemeral: true });
      charEntry.wallet = copperToWallet(currentTotal - spendTotal);
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`💸 ${char.name}'s Wallet — Spent ${formatWallet({ pp, gp, sp, cp })}`)] });
    }
    if (subcommand === 'convert') {
      const from   = interaction.options.getString('from');
      const to     = interaction.options.getString('to');
      const amount = interaction.options.getInteger('amount');
      if (from === to) return interaction.reply({ content: `❌ Can't convert ${from} to ${from}!`, ephemeral: true });
      const fromValue = COPPER_VALUE[from];
      const toValue   = COPPER_VALUE[to];
      const totalCopperToConvert = amount * fromValue;
      if ((wallet[from] ?? 0) < amount)
        return interaction.reply({ content: `❌ **${char.name}** only has **${wallet[from] ?? 0} ${from}**.`, ephemeral: true });
      if (fromValue < toValue && totalCopperToConvert < toValue)
        return interaction.reply({ content: `❌ ${amount} ${from} isn't worth even 1 ${to}.`, ephemeral: true });
      const converted = Math.floor(totalCopperToConvert / toValue);
      const remainder = totalCopperToConvert % toValue;
      wallet[from] = (wallet[from] ?? 0) - amount;
      wallet[to]   = (wallet[to]   ?? 0) + converted;
      wallet.cp    = (wallet.cp    ?? 0) + remainder;
      charEntry.wallet = wallet;
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      const remainderNote = remainder > 0 ? ` (+${remainder} cp remainder)` : '';
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`🔄 ${char.name}'s Wallet — Converted`).setDescription(`Converted **${amount} ${from}** → **${converted} ${to}**${remainderNote}`)] });
    }
    if (subcommand === 'set') {
      charEntry.wallet = {
        pp: interaction.options.getInteger('pp') ?? wallet.pp ?? 0,
        gp: interaction.options.getInteger('gp') ?? wallet.gp ?? 0,
        sp: interaction.options.getInteger('sp') ?? wallet.sp ?? 0,
        cp: interaction.options.getInteger('cp') ?? wallet.cp ?? 0,
      };
      characters[interaction.user.id][charKey] = charEntry;
      saveCharacters(characters);
      return interaction.reply({ embeds: [buildWalletEmbed(char, charEntry).setTitle(`✏️ ${char.name}'s Wallet — Updated`)] });
    }
  }

  // ─── /init ───────────────────────────────────────────────────────
  else if (commandName === 'init') {
    const sub = interaction.options.getSubcommand();
    const channelId = interaction.channel.id;
    const userId = interaction.user.id;

    // START
    if (sub === 'start') {
      if (getEncounter(channelId))
        return interaction.reply({ content: '⚠️ An encounter is already active here. Use `/init end` first.', ephemeral: true });
      createEncounter(channelId, userId);
      return interaction.reply(
        `⚔️ Combat started! <@${userId}> is the GM.\n` +
        `Players: use \`/init add\` to join. GM: use \`/init addnpc\` for monsters.\n` +
        `When everyone is in, the GM uses \`/init next\` to begin.`
      );
    }

    const enc = getEncounter(channelId);
    if (!enc)
      return interaction.reply({ content: '❌ No active encounter. Start one with `/init start`.', ephemeral: true });

    // ADD (player character)
    if (sub === 'add') {
      const characters = loadCharacters();
      const { error, char: charEntry } = resolveChar(userId, interaction.options.getString('character'), characters);
      if (error) return interaction.reply({ content: error, ephemeral: true });

      const charName = charEntry.name;
      if (enc.combatants.some(x => x.name.toLowerCase() === charName.toLowerCase()))
        return interaction.reply({ content: `❌ ${charName} is already in the encounter.`, ephemeral: true });

      const perception = computeCharPerception(charEntry);
      const maxHp = computeCharMaxHp(charEntry);
      const bonusOverride = interaction.options.getInteger('bonus');
      const resultOverride = interaction.options.getInteger('result');
      const bonus = bonusOverride ?? perception;

      let initiative, rollText;
      if (resultOverride !== null) {
        initiative = resultOverride;
        rollText = `(set to ${resultOverride})`;
      } else {
        const r = rollD20Plus(bonus);
        initiative = r.total;
        rollText = `(rolled ${r.roll} ${fmt(r.mod)})`;
      }

      addCombatant(channelId, {
        name: charName,
        initiative,
        hp: maxHp,
        maxHp,
        ownerId: userId,
        isNpc: false,
      });

      return interaction.reply(`✅ **${charName}** joined initiative at **${initiative}** ${rollText}.`);
    }

    // ADDNPC (GM only)
    if (sub === 'addnpc') {
      if (userId !== enc.gmId)
        return interaction.reply({ content: '❌ Only the GM can add NPCs.', ephemeral: true });

      const name = interaction.options.getString('name');
      const bonus = interaction.options.getInteger('bonus');
      const hp = interaction.options.getInteger('hp');
      const resultOverride = interaction.options.getInteger('result');

      if (enc.combatants.some(x => x.name.toLowerCase() === name.toLowerCase()))
        return interaction.reply({ content: `❌ A combatant named "${name}" already exists. Use a unique name (e.g. "Goblin 1").`, ephemeral: true });

      let initiative, rollText;
      if (resultOverride !== null) {
        initiative = resultOverride;
        rollText = `(set to ${resultOverride})`;
      } else {
        const r = rollD20Plus(bonus);
        initiative = r.total;
        rollText = `(rolled ${r.roll} ${fmt(r.mod)})`;
      }

      addCombatant(channelId, {
        name,
        initiative,
        hp,
        maxHp: hp,
        ownerId: userId,
        isNpc: true,
      });

      return interaction.reply(`👹 **${name}** joined initiative at **${initiative}** ${rollText}.`);
    }

    // NEXT
    if (sub === 'next') {
      if (userId !== enc.gmId)
        return interaction.reply({ content: '❌ Only the GM can advance turns.', ephemeral: true });
      if (enc.combatants.length === 0)
        return interaction.reply({ content: '❌ No combatants in the encounter yet.', ephemeral: true });

      advanceTurn(channelId);
      const current = enc.combatants[enc.turnIndex];
      const mention = current.isNpc ? `<@${enc.gmId}>` : `<@${current.ownerId}>`;
      return interaction.reply({
        content: `🎯 It's **${current.name}**'s turn! ${mention}`,
        embeds: [buildInitiativeEmbed(enc)],
      });
    }

    // LIST
    if (sub === 'list') {
      return interaction.reply({ embeds: [buildInitiativeEmbed(enc)] });
    }

    // HP
    if (sub === 'hp') {
      const name = interaction.options.getString('name');
      const change = interaction.options.getInteger('change');
      const combatant = enc.combatants.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!combatant)
        return interaction.reply({ content: `❌ No combatant named "${name}".`, ephemeral: true });
      if (combatant.ownerId !== userId && enc.gmId !== userId)
        return interaction.reply({ content: '❌ You can only modify HP for your own character (or any, if GM).', ephemeral: true });

      modifyHp(channelId, name, change);
      const verb = change >= 0 ? 'healed' : 'took';
      const amount = Math.abs(change);
      const downed = combatant.hp === 0 ? ' 💀 **Down!**' : '';
      return interaction.reply(`❤️ **${combatant.name}** ${verb} ${amount} → ${combatant.hp}/${combatant.maxHp} HP${downed}`);
    }

    // REMOVE
    if (sub === 'remove') {
      const name = interaction.options.getString('name');
      const result = removeCombatant(channelId, name);
      if (!result)
        return interaction.reply({ content: `❌ No combatant named "${name}".`, ephemeral: true });
      return interaction.reply(`🗑️ Removed **${name}** from initiative.`);
    }

    // END
    if (sub === 'end') {
      if (userId !== enc.gmId)
        return interaction.reply({ content: '❌ Only the GM can end the encounter.', ephemeral: true });
      deleteEncounter(channelId);
      return interaction.reply('🏁 Combat ended. Well fought!');
    }
  }

});

client.login(process.env.TOKEN);