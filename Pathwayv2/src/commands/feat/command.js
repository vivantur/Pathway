// ── commands/feat/command.js ────────────────────────────────────────────────
// /feat: look up a PF2e feat by name, optionally constrained to a level.
//
// Resolution lives in ./lookup. When the query is ambiguous (multiple feats
// match), we render a candidate list — preview 20 entries, then "…and N more"
// if the list overflows. If the matches all share an exact name (Power Attack
// exists at level 1 and as Greater Power Attack at higher levels), the header
// nudges the user to add `level:` rather than re-typing the name.

const { didYouMeanLine } = require('../../lib/fuzzyMatch');
const { featDatabase } = require('../../reference/databases');
const { findFeat } = require('./lookup');
const { buildFeatEmbed } = require('./embed');

// Pure formatter for one row of the ambiguity-list — kept local because it's
// only used inside this orchestrator and isn't part of the main embed.
function formatFeatMatchLine(feat) {
  const lvl = feat.level != null ? ` *(Lvl ${feat.level})*` : '';
  return `• **${feat.name}**${lvl}`;
}

async function execute(interaction) {
  const input = interaction.options.getString('name');
  const levelFilter = interaction.options.getInteger('level') ?? null;
  const { feat, matches, exactDuplicates } = findFeat(input, levelFilter);

  if (feat) {
    return interaction.reply({ embeds: [buildFeatEmbed(feat)] });
  }

  if (matches && matches.length > 1) {
    // Sort alphabetically, then by level so duplicates cluster correctly.
    const sorted = [...matches].sort((a, b) =>
      a.name.localeCompare(b.name) || (a.level ?? 0) - (b.level ?? 0)
    );
    const preview = sorted.slice(0, 20).map(formatFeatMatchLine).join('\n');
    const extra = sorted.length > 20 ? `\n*…and ${sorted.length - 20} more. Try narrowing your search.*` : '';
    const header = exactDuplicates
      ? `🔍 Multiple feats share the exact name **"${input}"**. Add a level to narrow it down:`
      : `🔍 Multiple feats match **"${input}"**. Did you mean one of these?`;
    return interaction.reply({ content: `${header}\n${preview}${extra}`, ephemeral: true });
  }

  const levelMsg = levelFilter != null ? ` at level ${levelFilter}` : '';
  const names = featDatabase.map(f => f?.name).filter(Boolean);
  const hint = didYouMeanLine(input, names);
  return interaction.reply({
    content: `❌ No feat found for **"${input}"**${levelMsg}.${hint || ' Check your spelling or try another name.'}`,
    ephemeral: true,
  });
}

module.exports = {
  name: 'feat',
  execute,
};
