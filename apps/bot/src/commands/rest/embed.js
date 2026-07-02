// ── commands/rest/embed.js ──────────────────────────────────────────────────
// Embed builders for /rest: the pre-rest confirmation and the post-rest
// completion summary.

const { EmbedBuilder } = require('discord.js');

// Pre-rest confirmation, shown with Proceed/Cancel buttons.
function buildRestConfirmEmbed(charEntry, { preparedCount = 0 } = {}) {
  const lines = [
    `Resting will refill all spell slots, refresh focus points to max, and reset hero points to 1.`,
  ];
  if (preparedCount > 0) {
    lines.push(`⚠️ This will also **clear ${preparedCount} prepared spell(s)** from today's prep list.`);
  }
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`🌙 Rest — ${charEntry.data.name}?`)
    .setDescription(lines.join('\n'));
}

// Post-rest completion summary, shown after the user clicks Proceed.
function buildRestCompleteEmbed(charEntry, { maxHp, focus, dailyCounterCount }) {
  const counterLine = dailyCounterCount > 0
    ? ` ${dailyCounterCount} daily counter${dailyCounterCount === 1 ? '' : 's'} reset.`
    : '';
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🌙 ${charEntry.data.name} rests and recovers`)
    .setDescription(
      `HP restored to **${maxHp}/${maxHp}**. ` +
      `All spell slots refilled. ` +
      `Focus points: ${focus.current}/${focus.max}. ` +
      `Hero points reset to 1. ` +
      `Prepared spells cleared.${counterLine}`
    );
}

module.exports = {
  buildRestConfirmEmbed,
  buildRestCompleteEmbed,
};
