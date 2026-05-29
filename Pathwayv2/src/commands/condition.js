// commands/condition.js
// /condition slash command for Pathway — looks up PF2e conditions.
// Primary data source: Supabase reference data loaded at runtime.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Legacy local fallback only; the bot should use Supabase runtime data when available.
let conditions = {};
try {
  conditions = JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, '..', 'gamedata', 'conditions.json'), 'utf8'));
} catch (_) { /* file not present — conditions loaded from Supabase at runtime */ }

/**
 * Look up a condition by name. Handles:
 *   - exact key match ("grabbed")
 *   - case-insensitive match ("Grabbed", "GRABBED")
 *   - aliases ("flat-footed" -> "off-guard")
 *   - common typing variants ("off guard", "offguard" -> "off-guard")
 *   - partial / startsWith match ("frigh" -> "frightened")
 *
 * Returns the condition object (with its key attached as `_key`),
 * or null if nothing matches.
 */
function findCondition(query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();

  // Normalize the query: collapse spaces/underscores to dashes so users
  // can type "off guard", "off_guard", or "offguard" and still match "off-guard".
  const normalized = q.replace(/[\s_]+/g, '-');
  const compact = q.replace(/[\s_-]+/g, '');

  // 1. Exact key match (after normalizing).
  if (conditions[normalized] && !normalized.startsWith('_')) {
    return { ...conditions[normalized], _key: normalized };
  }

  // 2. Walk the entries for name/alias/compact matches.
  for (const [key, cond] of Object.entries(conditions)) {
    if (key.startsWith('_')) continue;

    if (cond.name.toLowerCase() === q) return { ...cond, _key: key };
    if (key.replace(/-/g, '') === compact) return { ...cond, _key: key };

    if (Array.isArray(cond.aliases)) {
      for (const alias of cond.aliases) {
        if (alias.toLowerCase() === q || alias.toLowerCase() === normalized) {
          return { ...cond, _key: key };
        }
      }
    }
  }

  // 3. Partial / startsWith match — last resort, prevents typo lockouts.
  for (const [key, cond] of Object.entries(conditions)) {
    if (key.startsWith('_')) continue;
    if (key.startsWith(normalized) || cond.name.toLowerCase().startsWith(q)) {
      return { ...cond, _key: key };
    }
  }

  return null;
}

/**
 * Build a Discord embed for a condition. Exported so /rule can reuse it.
 */
function buildConditionEmbed(cond) {
  const title = cond.hasValue ? `${cond.name} (value)` : cond.name;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x6B4FBB) // Pathfinder purple
    .setDescription(cond.description)
    .setFooter({ text: cond.source || 'Player Core' });

  if (cond.aon_url) {
    embed.setURL(cond.aon_url);
  }

  if (cond.hasValue) {
    embed.addFields({
      name: 'Note',
      value: 'This condition has a numeric value (e.g. *frightened 2*). The value scales the effect.',
    });
  }

  return embed;
}

/**
 * List all condition names — used for the "did you mean?" suggestion.
 */
function listConditionNames() {
  return Object.entries(conditions)
    .filter(([k]) => !k.startsWith('_'))
    .map(([, c]) => c.name)
    .sort();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('condition')
    .setDescription('Look up a PF2e condition (e.g. grabbed, frightened, off-guard)')
    .addStringOption(opt =>
      opt
        .setName('name')
        .setDescription('The name of the condition')
        .setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString('name');
    const cond = findCondition(query);

    if (!cond) {
      const all = listConditionNames();
      const suggestions = all
        .filter(n => n.toLowerCase().includes(query.toLowerCase().slice(0, 3)))
        .slice(0, 5);

      const hint = suggestions.length
        ? `\nDid you mean: ${suggestions.map(s => `**${s}**`).join(', ')}?`
        : `\nTry one of: ${all.slice(0, 8).join(', ')}, ...`;

      return interaction.reply({
        content: `❌ No condition found for **"${query}"**.${hint}`,
        ephemeral: true,
      });
    }

    return interaction.reply({ embeds: [buildConditionEmbed(cond)] });
  },

  // Exported for /rule integration.
  findCondition,
  buildConditionEmbed,
  listConditionNames,
};