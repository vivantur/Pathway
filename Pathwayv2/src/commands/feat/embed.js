// ── commands/feat/embed.js ──────────────────────────────────────────────────
// Render a feat as a single embed.
//
// Color priority: rarity → pfs_access → default blue. Older entries only
// carry `pfs_access`; newer AoN-imported entries carry `rarity`. We honor
// whichever is set and fall back when both are absent.
//
// Action icons: feats that double as activities (e.g. Sudden Charge) carry
// an `action_tag_full` like "two_actions". We map that to a glyph (◆◆) so
// the embed reads at a glance.

const { EmbedBuilder } = require('discord.js');

const RARITY_COLOR = {
  Common:   0x4a90d9, // blue
  Uncommon: 0xf39c12, // orange
  Rare:     0xe74c3c, // red
  Unique:   0x9b59b6, // purple
};
const PFS_COLOR = {
  Standard:   0x2ecc71,
  Limited:    0xf39c12,
  Restricted: 0xe74c3c,
};
const ACTION_ICONS = {
  one_action:    '◆ 1 action',
  two_actions:   '◆◆ 2 actions',
  three_actions: '◆◆◆ 3 actions',
  reaction:      '⤾ Reaction',
  free_action:   '◇ Free Action',
};

function buildFeatEmbed(feat) {
  const color = RARITY_COLOR[feat.rarity] ?? PFS_COLOR[feat.pfs_access] ?? 0x4a90d9;
  const actionText = feat.action_tag_full
    ? (ACTION_ICONS[feat.action_tag_full] ?? feat.action_tag_full)
    : null;

  // Build a traits line for the description (shown above the summary text)
  const traitChips = [];
  if (feat.rarity && feat.rarity !== 'Common') traitChips.push(feat.rarity);
  if (Array.isArray(feat.traits)) traitChips.push(...feat.traits);
  const traitsLine = traitChips.length ? `*${traitChips.join(', ')}*` : null;

  const desc = feat.description || '*No description available.*';
  const fullDesc = traitsLine ? `${traitsLine}\n\n${desc}` : desc;

  // Build field list (level always present; rest conditional)
  const fields = [
    { name: '📊 Level', value: feat.level != null ? String(feat.level) : 'Unknown', inline: true },
  ];
  if (actionText) fields.push({ name: '⚡ Activity', value: actionText, inline: true });
  if (feat.pfs_access) fields.push({ name: '🎫 PFS', value: feat.pfs_access, inline: true });
  if (feat.prerequisites) {
    const prereq = String(feat.prerequisites).slice(0, 1024);
    fields.push({ name: '📋 Prerequisites', value: prereq, inline: false });
  }
  if (feat.notes) {
    fields.push({ name: '📝 Notes', value: String(feat.notes).slice(0, 1024), inline: false });
  }

  // Footer: source citation — prefer pre-formatted `source`, fall back to
  // assembling from source_book + source_page.
  const sourceText = feat.source
    ?? (feat.source_book ? `${feat.source_book}${feat.source_page ? ` pg. ${feat.source_page}` : ''}` : null);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`🪄 ${feat.name}`)
    .setDescription(fullDesc.slice(0, 4000))
    .addFields(fields)
    .setFooter({ text: `PF2e Feat Lookup • ${sourceText ?? 'Archives of Nethys'}` });
}

module.exports = { buildFeatEmbed };
