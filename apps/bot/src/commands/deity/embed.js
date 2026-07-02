// ── commands/deity/embed.js ─────────────────────────────────────────────────
// Render a deity as a single embed.
//
// Note: this embed is shared between /deity (PF2e canon deities) and
// /eberron deity (Eberron campaign-setting deities) — the data shape is
// identical even though they live in different databases.
//
// Color is keyed off PFS availability rather than rarity (deities don't
// carry rarity tags the way feats and items do): green for Standard,
// orange for Limited, red for Restricted, purple as the default.

const { EmbedBuilder } = require('discord.js');

const PFS_COLOR = {
  Standard:   0x2ecc71,
  Limited:    0xf39c12,
  Restricted: 0xe74c3c,
};

function buildDeityEmbed(deity) {
  const color = PFS_COLOR[deity.pfs_availability] ?? 0x9b59b6;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⛪ ${deity.name}`);

  // Subtitle line: PFS availability + pantheons
  const subtitleParts = [];
  if (deity.pfs_availability) subtitleParts.push(`PFS ${deity.pfs_availability}`);
  if (deity.pantheons?.length) subtitleParts.push(deity.pantheons.join(', '));
  if (subtitleParts.length) embed.setDescription(`*${subtitleParts.join(' · ')}*`);

  // Edicts / Anathemas — the core flavor content
  if (deity.edicts) {
    embed.addFields({ name: '✅ Edicts',    value: String(deity.edicts).slice(0, 1024),    inline: false });
  }
  if (deity.anathemas) {
    embed.addFields({ name: '🚫 Anathemas', value: String(deity.anathemas).slice(0, 1024), inline: false });
  }

  if (deity.domains?.length) {
    embed.addFields({ name: '🏛️ Domains', value: deity.domains.join(', '), inline: false });
  }

  // Mechanical stats (divine font, sanctification, attributes) — compact row
  const mechanicals = [];
  if (deity.divine_font)        mechanicals.push(`**Divine Font** ${deity.divine_font}`);
  if (deity.sanctification)     mechanicals.push(`**Sanctification** ${deity.sanctification}`);
  if (deity.attributes?.length) mechanicals.push(`**Attributes** ${deity.attributes.join(', ')}`);
  if (mechanicals.length) {
    embed.addFields({ name: '⚙️ Cleric Mechanics', value: mechanicals.join('\n'), inline: false });
  }

  // Divine skill + favored weapon
  const gearParts = [];
  if (deity.divine_skill)   gearParts.push(`**Skill** ${deity.divine_skill}`);
  if (deity.favored_weapon) gearParts.push(`**Favored Weapon** ${deity.favored_weapon}`);
  if (gearParts.length) {
    embed.addFields({ name: '🎯 Divine Gifts', value: gearParts.join(' · '), inline: false });
  }

  // Devotee benefits (can be long — truncate if needed)
  if (deity.devotee_benefits?.length) {
    const benefits = deity.devotee_benefits.join(', ');
    embed.addFields({
      name: '✨ Sanctifications / Devotee Benefits',
      value: benefits.length > 1024 ? benefits.slice(0, 1021) + '...' : benefits,
      inline: false,
    });
  }

  embed.setFooter({ text: `PF2e Deity Lookup • ${deity.source_text ?? 'Archives of Nethys'}` });
  return embed;
}

/**
 * One-line summary for the ambiguity list. Shows deity name and first
 * pantheon (e.g. "Sarenrae — Inner Sea"). Re-exported by /eberron deity.
 */
function formatDeityMatchLine(deity) {
  const pantheon = deity.pantheons?.[0] ? ` — ${deity.pantheons[0]}` : '';
  return `• **${deity.name}**${pantheon}`;
}

module.exports = { buildDeityEmbed, formatDeityMatchLine };
