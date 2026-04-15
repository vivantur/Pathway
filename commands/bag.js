const { EmbedBuilder } = require('discord.js');
const Bag = require('../models/Bag');

const CATEGORIES = [
  ['Pack',           'pack'],
  ['Potions',        'potions'],
  ['Attunement',     'attunement'],
  ['MPs',            'mps'],
  ['Weapons & Armor','weapons_armor'],
  ['Trinkets',       'trinkets'],
  ['Fish',           'fish'],
  ['Uncrafted',      'uncrafted'],
  ['Mount',          'mount'],
  ['Special',        'special'],
  ['Components',     'components'],
  ['Dump',           'dump'],
  ['Crafted',        'crafted'],
  ['Consumables',    'consumables'],
];

// Valid category keywords the user can type
const CATEGORY_ALIASES = {
  pack: 'pack', potions: 'potions', potion: 'potions',
  attunement: 'attunement', attuned: 'attunement',
  mps: 'mps', mp: 'mps',
  weapons: 'weapons_armor', armor: 'weapons_armor', weapons_armor: 'weapons_armor',
  trinkets: 'trinkets', trinket: 'trinkets',
  fish: 'fish',
  uncrafted: 'uncrafted',
  mount: 'mount', mounts: 'mount',
  special: 'special',
  components: 'components', component: 'components',
  dump: 'dump',
  crafted: 'crafted',
  consumables: 'consumables', consumable: 'consumables',
};

function buildBagEmbed(bagData) {
  const embed = new EmbedBuilder()
    .setTitle(`🎒 ${bagData.characterName}'s Bags`)
    .setColor(0x9B59B6)
    .setFooter({ text: 'Use /bag add • /bag remove • /bag clear • /bag setname' });

  for (const [label, key] of CATEGORIES) {
    const items = bagData.bags[key];
    const value = items?.length > 0 ? items.join('\n') : '*This bag is empty.*';
    embed.addFields({ name: `**${label}**`, value, inline: true });
  }

  return embed;
}

module.exports = {
  name: 'bag',
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // Get or create bag
    let bag = await Bag.findOne({ userId });
    if (!bag) {
      bag = await Bag.create({ userId });
    }

    // --- VIEW ---
    if (sub === 'view') {
      return interaction.reply({ embeds: [buildBagEmbed(bag)] });
    }

    // --- SETNAME ---
    if (sub === 'setname') {
      const name = interaction.options.getString('name');
      bag.characterName = name;
      await bag.save();
      return interaction.reply({ content: `✅ Character name set to **${name}**!`, ephemeral: true });
    }

    // --- ADD ---
    if (sub === 'add') {
      const categoryInput = interaction.options.getString('category').toLowerCase().trim();
      const item = interaction.options.getString('item').trim();
      const category = CATEGORY_ALIASES[categoryInput];

      if (!category) {
        return interaction.reply({
          content: `❌ Unknown category **"${categoryInput}"**. Valid options: ${Object.keys(CATEGORY_ALIASES).join(', ')}`,
          ephemeral: true
        });
      }

      bag.bags[category].push(item);
      bag.markModified('bags');
      await bag.save();
      return interaction.reply({ content: `✅ Added **${item}** to **${categoryInput}**!`, ephemeral: true });
    }

    // --- REMOVE ---
    if (sub === 'remove') {
      const categoryInput = interaction.options.getString('category').toLowerCase().trim();
      const item = interaction.options.getString('item').trim();
      const category = CATEGORY_ALIASES[categoryInput];

      if (!category) {
        return interaction.reply({
          content: `❌ Unknown category **"${categoryInput}"**.`,
          ephemeral: true
        });
      }

      const index = bag.bags[category].findIndex(
        i => i.toLowerCase() === item.toLowerCase()
      );

      if (index === -1) {
        return interaction.reply({
          content: `❌ **${item}** not found in **${categoryInput}**.`,
          ephemeral: true
        });
      }

      bag.bags[category].splice(index, 1);
      bag.markModified('bags');
      await bag.save();
      return interaction.reply({ content: `✅ Removed **${item}** from **${categoryInput}**!`, ephemeral: true });
    }

    // --- CLEAR ---
    if (sub === 'clear') {
      const categoryInput = interaction.options.getString('category').toLowerCase().trim();
      const category = CATEGORY_ALIASES[categoryInput];

      if (!category) {
        return interaction.reply({
          content: `❌ Unknown category **"${categoryInput}"**.`,
          ephemeral: true
        });
      }

      bag.bags[category] = [];
      bag.markModified('bags');
      await bag.save();
      return interaction.reply({ content: `🗑️ Cleared all items from **${categoryInput}**!`, ephemeral: true });
    }
  }
};