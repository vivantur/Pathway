// ── commands/eberron/houseEmbed.js ──────────────────────────────────────────
// Render a Dragonmarked House as a single embed.
//
// Houses have a *lot* of optional fields (guilds, services, common skills,
// campaign uses, NPC roles, complications). The embed renders only the
// ones that are populated, so smaller houses with sparse data don't show
// a wall of "None listed" placeholders.

const { EmbedBuilder } = require('discord.js');
const { truncateField } = require('../../lib/format');

function formatHouseList(values) {
  return (values ?? []).length ? values.join(', ') : 'None listed';
}

function bulletHouseList(values) {
  return (values ?? []).length ? values.map(v => `- ${v}`).join('\n') : 'None listed';
}

function buildEberronHouseEmbed(house) {
  const embed = new EmbedBuilder()
    .setColor(0x8f6b2f) // bronze/amber — the Khorvaire-imperial palette
    .setTitle(house.name)
    .setDescription(truncateField(house.summary || 'No summary available.', 3900))
    .setFooter({ text: 'Eberron Dragonmarked House Lookup' });

  // Identity block — collapsed into one field rather than three so the
  // embed stays compact for houses with only one or two of these set.
  const identity = [];
  if (house.mark)              identity.push(`Mark: ${house.mark}`);
  if (house.associated_people) identity.push(`Associated people: ${house.associated_people}`);
  if (house.headquarters)      identity.push(`Headquarters: ${house.headquarters}`);
  if (identity.length) {
    embed.addFields({ name: 'Identity', value: truncateField(identity.join('\n')), inline: false });
  }

  if (house.guilds?.length)        embed.addFields({ name: 'Guilds',           value: truncateField(formatHouseList(house.guilds)),        inline: false });
  if (house.services?.length)      embed.addFields({ name: 'Services',         value: truncateField(formatHouseList(house.services)),      inline: false });
  if (house.common_skills?.length) embed.addFields({ name: 'Useful PF2e Skills', value: truncateField(formatHouseList(house.common_skills)), inline: false });
  if (house.campaign_uses?.length) embed.addFields({ name: 'Campaign Uses',    value: truncateField(bulletHouseList(house.campaign_uses)),  inline: false });
  if (house.npc_roles?.length)     embed.addFields({ name: 'NPC Roles',        value: truncateField(formatHouseList(house.npc_roles)),     inline: false });
  if (house.complications?.length) embed.addFields({ name: 'Complications',    value: truncateField(bulletHouseList(house.complications)), inline: false });

  return embed;
}

function formatEberronHouseMatchLine(house) {
  return `- **${house.name}**${house.mark ? ` - ${house.mark}` : ''}`;
}

module.exports = {
  buildEberronHouseEmbed,
  formatEberronHouseMatchLine,
};
