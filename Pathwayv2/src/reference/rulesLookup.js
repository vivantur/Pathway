// ── reference/rulesLookup.js ────────────────────────────────────────────────
// Generic lookup + rendering for entries in `rulesDatabase` — conditions,
// actions, traits, languages, domains, etc. Each entry has the shape:
//
//   { name, description, category, action_cost?, value_label?,
//     traits?, trigger?, requirements?, source? }
//
// The category field gates which subset a command surfaces (/condition only
// shows category='condition', /action shows category='action', etc.).
//
// Lives in reference/ rather than rules/ because it operates on the
// in-memory reference databases (read-only) and is consumed by multiple
// commands. Pure functions, no I/O.

const { EmbedBuilder } = require('discord.js');
const { rulesDatabase } = require('./databases');

// Resolve a user query string against the rules database.
// Returns `{ rule, matches }`:
//   • rule = the single resolved entry, or null
//   • matches = the ambiguous match list (only populated if rule is null
//     AND >1 entry matched)
function findRule(query) {
  if (typeof query !== 'string' || !query.trim()) return { rule: null, matches: [] };
  const q = query.toLowerCase().trim().replace(/\s+/g, '-');
  const qRaw = query.toLowerCase().trim();
  for (const category of Object.values(rulesDatabase)) {
    if (category[q]) return { rule: category[q], matches: [] };
    // Defensive: some entries may be missing a `name` field (malformed
    // JSON, partial homebrew). Skip those instead of crashing.
    const exactName = Object.values(category).find(r => typeof r?.name === 'string' && r.name.toLowerCase() === qRaw);
    if (exactName) return { rule: exactName, matches: [] };
  }
  const matches = [];
  for (const category of Object.values(rulesDatabase)) {
    for (const [key, rule] of Object.entries(category)) {
      const nameMatches = typeof rule?.name === 'string' && rule.name.toLowerCase().includes(qRaw);
      const keyMatches  = typeof key === 'string' && key.includes(q);
      if (nameMatches || keyMatches) matches.push(rule);
    }
  }
  if (matches.length === 1) return { rule: matches[0], matches: [] };
  if (matches.length > 1)   return { rule: null, matches };
  return { rule: null, matches: [] };
}

// Build the standard rule embed used by /condition, /action, /trait, etc.
function buildRuleEmbed(rule) {
  const colors = { condition: 0xe74c3c, action: 0x2ecc71, trait: 0xf39c12 };
  const emojis = { condition: '🩸', action: '⚡', trait: '🏷️' };
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

module.exports = { findRule, buildRuleEmbed };
