// ── commands/strike/embed.js ────────────────────────────────────────────────
//
// Presentation for /strike. The narration and bookkeeping come from
// rules/automation.js's pure renderers; this arranges them and adds the one thing
// those cannot know — the DAMAGE ROLLED for an ac-only Strike, where nothing was
// applied so `describeApplied` has nothing to report.
//
// Same opinion as /use: narration and bookkeeping are separate, and anything that
// did not land is shown, not hidden.

const { EmbedBuilder } = require('discord.js');

const COLOR = 0xc0392b; // a weapon red, to read apart from /use's purple
const MAX_DESCRIPTION = 4000;

function clamp(text, limit = MAX_DESCRIPTION) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** Sum the damage an outcome would deal (non-healing), for the ac-only path. */
function rolledDamage(outcome) {
  let total = 0;
  for (const m of outcome?.mutations ?? []) {
    if (m.kind === 'damage' && !m.healing && Number.isFinite(m.amount)) total += m.amount;
  }
  return total;
}

function signed(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

const ACTION_GLYPH = { 1: '(1 action)', 2: '(2 actions)', 3: '(3 actions)' };
function riderCostLabel(rider) {
  const c = rider?.actionCost;
  if (!c) return '';
  if (c.kind === 'actions') return ACTION_GLYPH[c.min] ?? `(${c.min}–${c.max} actions)`;
  if (c.kind === 'reaction') return '(reaction)';
  if (c.kind === 'free') return '(free)';
  return '';
}

function buildStrikeEmbed({ charEntry, weapon, built, outcome, narration, applied, targetName, targetApplied, rider, seed }) {
  const name = charEntry?.data?.name || charEntry?.name || 'Character';
  const weaponName = weapon?.display || weapon?.name || 'Strike';
  // With a rider, the ACTIVITY is the headline (Intimidating Strike), the weapon a subtitle.
  const title = rider
    ? `${rider.name} ${riderCostLabel(rider)}`.trim()
    : `${weaponName} ${signed(built.strike.attack)}${targetName ? ` vs ${targetName}` : ''}`;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title);
  if (rider) {
    embed.addFields({ name: 'Strike', value: `${weaponName} ${signed(built.strike.attack)}${targetName ? ` vs ${targetName}` : ''}` });
  }

  const body = narration.lines.length > 0 ? narration.lines.join('\n') : '_No roll._';
  embed.setDescription(clamp(body));

  // The strike's own damage is "skipped" on the ac-only path because there is no
  // combatant behind the phantom AC — but we explain that with the "Damage rolled"
  // field below, so drop it from the honesty list rather than say it twice.
  let skipped = applied.skipped;
  if (applied.lines.length > 0) {
    // The flagship path: damage landed on a tracked combatant, with the before/after.
    embed.addFields({ name: 'What changed', value: clamp(applied.lines.join('\n'), 1024) });
  } else {
    // The ac-only path: the attack resolved but there is no one to apply damage to,
    // so show what it WOULD deal (0 on a miss — no damage mutation is emitted).
    const dmg = rolledDamage(outcome);
    if (dmg > 0) {
      embed.addFields({
        name: 'Damage rolled',
        value: `🗡️ **${dmg}** — not applied (add \`target:<combatant>\` in an encounter to deal it).`,
      });
    }
    skipped = applied.skipped.filter(s => !s.startsWith('damage:'));
  }

  // A rider that "counts as N attacks" for MAP — surfaced, not applied (the bot has
  // no turn tracker; the player picks `map:` for their next Strike themselves).
  const mult = rider?.strikeMods?.mapMultiplier;
  if (mult && mult > 1) {
    embed.addFields({ name: 'Multiple attack penalty', value: `This counts as **${mult}** attacks — set \`map:\` accordingly on your next Strike this turn.` });
  }

  // Honesty surface. The adapter's warnings (no traits → MAP/crit caveats) ride
  // alongside the interpreter's own, since both bear on whether to trust the number.
  const warnings = [...(built.warnings ?? []), ...narration.warnings];
  if (narration.aborted) {
    embed.addFields({ name: '⛔ Aborted', value: 'The Strike stopped early; some of it did not happen.' });
  }
  if (warnings.length > 0) {
    embed.addFields({ name: '⚠️ Warnings', value: clamp(warnings.map(w => `• ${w}`).join('\n'), 1024) });
  }
  if (skipped.length > 0) {
    embed.addFields({ name: '↪️ Not applied', value: clamp(skipped.map(s => `• ${s}`).join('\n'), 1024) });
  }

  embed.setFooter({ text: `${name} · seed ${seed}` });
  if (charEntry?.art) embed.setThumbnail(charEntry.art);
  return embed;
}

module.exports = { buildStrikeEmbed, rolledDamage };
