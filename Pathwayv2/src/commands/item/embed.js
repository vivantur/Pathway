// ── commands/item/embed.js ──────────────────────────────────────────────────
// Render an item as a single embed.
//
// Items have a wider variety of metadata than feats: bulk, price, usage,
// category, subcategory, PFS, campaign. We render whatever is present and
// skip anything that isn't. The "category" icon makes weapons-vs-armor-vs-
// consumables visually scannable at a glance.

const { EmbedBuilder } = require('discord.js');

const RARITY_COLOR = {
  Common:   0x4a90d9, // blue
  Uncommon: 0xf39c12, // orange
  Rare:     0xe74c3c, // red
  Unique:   0x9b59b6, // purple
};

const CATEGORY_ICONS = {
  'Weapons':          '⚔️',
  'Armor':            '🛡️',
  'Shields':          '🛡️',
  'Adventuring Gear': '🎒',
  'Alchemical Items': '⚗️',
  'Consumables':      '🧪',
  'Wands':            '🪄',
  'Staves':           '🪄',
  'Runes':            '✨',
  'Worn Items':       '💍',
  'Held Items':       '🤲',
  'Snares':           '🪤',
  'Vehicles':         '🚢',
  'Siege Weapons':    '🏹',
  'Materials':        '🪨',
  'Tattoos':          '🖋️',
  'Artifacts':        '👑',
  'Cursed Items':     '☠️',
};

function buildItemEmbed(item) {
  const color = RARITY_COLOR[item.rarity] ?? 0x4a90d9;
  const icon = CATEGORY_ICONS[item.category] ?? '📦';

  // Build traits line: include rarity if not Common, then traits
  const traitChips = [];
  if (item.rarity && item.rarity !== 'Common') traitChips.push(item.rarity);
  if (Array.isArray(item.traits)) traitChips.push(...item.traits);
  const traitsDisplay = traitChips.length ? `*${traitChips.join(', ')}*` : null;

  // Source line — items use either a plain string source or a
  // { source_text, book, page } object. Normalize both shapes.
  const sourceText = typeof item.source === 'string'
    ? item.source
    : item.source?.source_text
      ?? (item.source?.book ? `${item.source.book}${item.source.page ? ` pg. ${item.source.page}` : ''}` : null);

  const categoryLine = [item.category, item.subcategory].filter(Boolean).join(' · ');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${icon} ${item.name}`);

  // Items in this dataset don't carry prose descriptions, so the description
  // slot just holds the traits line.
  if (traitsDisplay) embed.setDescription(traitsDisplay);

  // Top row: Level / Price / Bulk
  embed.addFields(
    { name: '📊 Level', value: item.level != null ? String(item.level) : '—', inline: true },
    { name: '💰 Price', value: item.price_raw || '—',                         inline: true },
    { name: '⚖️ Bulk',  value: item.bulk_raw  || '—',                         inline: true },
  );

  if (item.usage) embed.addFields({ name: '✋ Usage', value: item.usage, inline: false });
  if (categoryLine) embed.addFields({ name: '📂 Category', value: categoryLine, inline: true });
  if (item.pfs_availability) embed.addFields({ name: '🎫 PFS', value: item.pfs_availability, inline: true });
  if (item.campaign) embed.addFields({ name: '📜 Campaign', value: item.campaign, inline: true });
  if (item.notes) embed.addFields({ name: '📝 Notes', value: String(item.notes).slice(0, 1000), inline: false });

  embed.setFooter({ text: `PF2e Item Lookup • ${sourceText ?? 'Archives of Nethys'}` });
  return embed;
}

module.exports = { buildItemEmbed };
