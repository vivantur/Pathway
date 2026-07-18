// ── commands/use/embed.js ───────────────────────────────────────────────────
//
// Presentation for /use. All the text is built by rules/automation.js's two pure
// renderers; this only arranges it.
//
// The arrangement carries one opinion worth stating: NARRATION AND BOOKKEEPING
// ARE SEPARATE, and anything that did not happen is shown, not hidden. An
// automation that silently drops half of what it did is worse than one that
// admits the gap — the same principle the ingest mapper runs on.

const { EmbedBuilder } = require('discord.js');

const COLOR = 0x9b59b6;
const MAX_DESCRIPTION = 4000;

function clamp(text, limit = MAX_DESCRIPTION) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function buildUseEmbed({ charEntry, action, costLabel, narration, applied, seed }) {
  const name = charEntry?.data?.name || charEntry?.name || 'Character';

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`${action.name}${costLabel ? ` ${costLabel}` : ''}`);

  const body = narration.lines.length > 0
    ? narration.lines.join('\n')
    : '_No narration._';
  embed.setDescription(clamp(body));

  if (applied.lines.length > 0) {
    embed.addFields({ name: 'What changed', value: clamp(applied.lines.join('\n'), 1024) });
  }

  // Everything below is the honesty surface: a run that aborted, a warning the
  // interpreter raised, or a mutation with nowhere to land.
  if (narration.aborted) {
    embed.addFields({ name: '⛔ Aborted', value: 'The run stopped early; some of this action did not happen.' });
  }
  if (narration.warnings.length > 0) {
    embed.addFields({ name: '⚠️ Warnings', value: clamp(narration.warnings.map(w => `• ${w}`).join('\n'), 1024) });
  }
  if (applied.skipped.length > 0) {
    embed.addFields({
      name: '↪️ Not applied',
      value: clamp(applied.skipped.map(s => `• ${s}`).join('\n'), 1024),
    });
  }

  // The seed is shown so any result here can be reproduced exactly.
  embed.setFooter({ text: `${name} · seed ${seed}` });
  if (charEntry?.art) embed.setThumbnail(charEntry.art);

  return embed;
}

module.exports = { buildUseEmbed };
