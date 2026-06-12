// commands/item/embed.js
// Render an item as a single embed.

const { EmbedBuilder } = require('discord.js');

const RARITY_COLOR = {
  Common: 0x4a90d9,
  Uncommon: 0xf39c12,
  Rare: 0xe74c3c,
  Unique: 0x9b59b6,
};

const CATEGORY_LABELS = {
  weapon: 'Weapon',
  armor: 'Armor',
  shield: 'Shield',
  adventuring_gear: 'Adventuring Gear',
  alchemical: 'Alchemical Item',
  consumable: 'Consumable',
  held_item: 'Held Item',
  worn_item: 'Worn Item',
  rune: 'Rune',
  material: 'Material',
  treasure: 'Treasure',
  vehicle: 'Vehicle',
};

function displayValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return String(value);
}

function buildDetailLines(item) {
  return [
    ['Hands', item.hands],
    ['Damage', item.damage || [item.damage_die, item.damage_type].filter(Boolean).join(' ')],
    ['Weapon Category', item.weapon_category],
    ['Weapon Group', item.weapon_group],
    ['Armor Category', item.armor_category],
    ['Armor Group', item.armor_group],
    ['AC Bonus', item.ac_bonus],
    ['Dex Cap', item.dex_cap],
    ['Check Penalty', item.check_penalty],
    ['Speed Penalty', item.speed_penalty],
    ['Strength', item.strength],
    ['Hardness', item.hardness],
    ['HP', item.hp],
  ]
    .map(([label, value]) => {
      const text = displayValue(value);
      return text ? `**${label}:** ${text}` : null;
    })
    .filter(Boolean);
}

function sourceLine(item) {
  if (typeof item.source === 'string') return item.source;
  return item.source?.source_text
    ?? (item.source?.book ? `${item.source.book}${item.source.page ? ` pg. ${item.source.page}` : ''}` : null);
}

function buildItemEmbed(item) {
  const color = RARITY_COLOR[item.rarity] ?? 0x4a90d9;
  const traitChips = [];
  if (item.rarity && item.rarity !== 'Common') traitChips.push(item.rarity);
  if (Array.isArray(item.traits)) traitChips.push(...item.traits);
  const traitsDisplay = traitChips.length ? `*${traitChips.join(', ')}*` : null;

  const descriptionParts = [];
  if (traitsDisplay) descriptionParts.push(traitsDisplay);
  if (item.description) descriptionParts.push(String(item.description).slice(0, 1500));

  const category = CATEGORY_LABELS[item.item_type] ?? item.category;
  const categoryLine = [category, item.subcategory ?? item.item_subtype].filter(Boolean).join(' - ');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(item.name);

  if (descriptionParts.length) embed.setDescription(descriptionParts.join('\n\n'));

  embed.addFields(
    { name: 'Level', value: item.level != null ? String(item.level) : '-', inline: true },
    { name: 'Price', value: item.price_raw || item.price || (item.price_cp != null ? `${item.price_cp} cp` : '-'), inline: true },
    { name: 'Bulk', value: item.bulk_raw || item.bulk || '-', inline: true },
  );

  if (item.usage) embed.addFields({ name: 'Usage', value: String(item.usage).slice(0, 1024), inline: false });

  const detailLines = buildDetailLines(item);
  if (detailLines.length) {
    embed.addFields({ name: 'Details', value: detailLines.join('\n').slice(0, 1024), inline: false });
  }

  if (categoryLine) embed.addFields({ name: 'Category', value: categoryLine, inline: true });
  if (item.pfs_availability) embed.addFields({ name: 'PFS', value: item.pfs_availability, inline: true });
  if (item.campaign) embed.addFields({ name: 'Campaign', value: item.campaign, inline: true });
  if (item.notes) embed.addFields({ name: 'Notes', value: String(item.notes).slice(0, 1000), inline: false });

  embed.setFooter({ text: `PF2e Item Lookup - ${sourceLine(item) ?? 'Archives of Nethys'}` });
  return embed;
}

module.exports = { buildItemEmbed };
