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

function cleanItemDescription(item) {
  const raw = String(item.description ?? '').trim();
  if (!raw) return '';

  const source = sourceLine(item);
  const price = displayValue(item.price_raw || item.price || (item.price_cp != null && item.price_cp > 0 ? `${item.price_cp} cp` : null));
  const bulk = displayValue(item.bulk_raw || item.bulk);
  let text = raw
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  // Parent AoN entries can include child variant blocks. Once a second Source
  // or Price block appears, it is no longer the selected item's prose.
  text = text.split(/\n\s*(?:Source|Price)\b/i)[0].trim();
  if (source) text = text.replace(new RegExp(`\\bSource\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), '').trim();
  if (price) text = text.replace(new RegExp(`\\bPrice\\s+${price.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), '').trim();
  if (bulk) text = text.replace(new RegExp(`\\bBulk\\s+${bulk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), '').trim();
  return text.replace(/\n{3,}/g, '\n\n').trim();
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
  const uniqueTraits = [];
  const seenTraits = new Set();
  for (const trait of traitChips) {
    const label = String(trait).trim();
    const key = label.toLowerCase();
    if (!label || seenTraits.has(key)) continue;
    seenTraits.add(key);
    uniqueTraits.push(label);
  }
  const traitsDisplay = uniqueTraits.length ? `*${uniqueTraits.join(', ')}*` : null;

  const descriptionParts = [];
  if (traitsDisplay) descriptionParts.push(traitsDisplay);
  const cleanedDescription = cleanItemDescription(item);
  if (cleanedDescription) descriptionParts.push(cleanedDescription.slice(0, 1200));

  const category = CATEGORY_LABELS[item.item_type] ?? item.category;
  const categoryLine = [category, item.subcategory ?? item.item_subtype].filter(Boolean).join(' - ');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(item.name);

  if (descriptionParts.length) embed.setDescription(descriptionParts.join('\n\n'));

  const summary = [
    `**Level:** ${item.level != null ? String(item.level) : '-'}`,
    `**Price:** ${item.price_raw || item.price || (item.price_cp != null && item.price_cp > 0 ? `${item.price_cp} cp` : '-')}`,
    `**Bulk:** ${item.bulk_raw || item.bulk || '-'}`,
    item.usage ? `**Usage:** ${item.usage}` : null,
    categoryLine ? `**Category:** ${categoryLine}` : null,
  ].filter(Boolean).join('\n');
  embed.addFields({ name: 'Item', value: summary, inline: false });

  const detailLines = buildDetailLines(item);
  if (detailLines.length) {
    embed.addFields({ name: 'Details', value: detailLines.join('\n').slice(0, 1024), inline: false });
  }

  if (item.pfs_availability) embed.addFields({ name: 'PFS', value: item.pfs_availability, inline: true });
  if (item.campaign) embed.addFields({ name: 'Campaign', value: item.campaign, inline: true });
  if (item.notes) embed.addFields({ name: 'Notes', value: String(item.notes).slice(0, 1000), inline: false });

  embed.setFooter({ text: `PF2e Item Lookup - ${sourceLine(item) ?? 'Archives of Nethys'}` });
  return embed;
}

module.exports = { buildItemEmbed };
