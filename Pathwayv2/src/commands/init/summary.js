const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const { setSummaryMessageId } = require('../encounters');

// proper PF2e conditions managed by combatAutomation.js.
function hpStatus(current, max, dying = 0, doomed = 0, unconscious = false) {
  if (!max || max <= 0) return { label: 'Unknown', emoji: '⚪' };
  const maxDying = Math.max(1, 4 - doomed);
  if (dying >= maxDying)    return { label: 'Dead',     emoji: '☠️' };
  if (dying > 0)            return { label: `Dying ${dying}`, emoji: '💀' };
  if (current <= 0 && unconscious) return { label: 'Unconscious', emoji: '😴' };
  if (current <= 0)         return { label: 'Down',     emoji: '💤' };
  const pct = current / max;
  if (pct <= 0.25)          return { label: 'Critical', emoji: '🔴' };
  if (pct <= 0.5)           return { label: 'Bloodied', emoji: '🟠' };
  if (pct < 1.0)            return { label: 'Injured',  emoji: '🟡' };
  return                           { label: 'Healthy',  emoji: '🟢' };
}

// Render an 8-segment HP bar. Uses filled/empty blocks so it lines up across
// combatants regardless of HP totals. At 0 HP shows an all-empty bar with skull.
function hpBar(current, max, segments = 8) {
  if (!max || max <= 0) return '░'.repeat(segments);
  if (current <= 0)     return '░'.repeat(segments);
  const pct = Math.max(0, Math.min(1, current / max));
  // Always show at least one filled block if the combatant isn't dead — a
  // 1-HP-out-of-200 combatant still gets one pip, not a visually-empty bar.
  const filled = Math.max(1, Math.round(pct * segments));
  return '█'.repeat(filled) + '░'.repeat(segments - filled);
}

// Format a single effect for the initiative embed line. Handles persistent
// damage specially so it shows the dice and damage type, not just the name.
function formatEffectForEmbed(e) {
  if (e.kind === 'persistent-damage' || e.modifiers?.kind === 'persistent-damage') {
    const dice = e.modifiers?.dice ?? e.dice ?? '?';
    const dtype = e.modifiers?.damageType ?? e.damageType ?? 'damage';
    return `🩸 ${dice} ${dtype}`;
  }
  let text = e.name;
  if (e.value !== null && e.value !== undefined) text += ` ${e.value}`;
  if (e.duration !== null && e.duration !== undefined) text += ` (${e.duration}r)`;
  return text;
}

// ── Initiative display: hybrid pagination ────────────────────────────────────
// Layout strategy by combatant count:
//   1-4  combatants → all detailed (HP bar + effects sub-line per entry)
//   5+   combatants → current turn detailed, everyone else compact one-liners
//   >5   combatants → paginated, 5 per page, ◀ ▶ buttons; current turn's
//                    page is always shown by default (cursor follows the turn)
//
// PAGE_SIZE controls page break for compact mode. Picked 5 because compact
// lines now include HP bars (one per line) plus a blank line between each
// entry, so 5 fits comfortably on screen without scrolling. Crossing 5
// combatants is the most common encounter scale, so buttons appear when
// they matter.
const INIT_PAGE_SIZE = 5;
const INIT_COMPACT_THRESHOLD = 5; // 5+ combatants triggers compact mode

// Render ONE combatant in DETAILED form (HP bar, effects sub-line, all the trim).
// This is the "headline" rendering used for current turn and small encounters.
function renderCombatantDetailed(combatant, isCurrent) {
  const marker = isCurrent ? '🎯' : '▫️';
  const status = hpStatus(
    combatant.hp,
    combatant.maxHp,
    combatant.dying ?? 0,
    combatant.doomed ?? 0,
    combatant.unconscious === true,
  );

  // PCs see actual HP + bar; NPCs see status only (HP hidden from players).
  let hpInline;
  if (combatant.isNpc) {
    hpInline = status.label;
  } else {
    const bar = hpBar(combatant.hp, combatant.maxHp);
    hpInline = `\`${bar}\` ${combatant.hp}/${combatant.maxHp}`;
  }

  const acPart      = combatant.ac != null ? ` · AC ${combatant.ac}` : '';
  const woundedPart = (combatant.wounded ?? 0) > 0 ? ` · Wounded ${combatant.wounded}` : '';
  const doomedPart  = (combatant.doomed  ?? 0) > 0 ? ` · Doomed ${combatant.doomed}`   : '';
  const delayedPart = combatant.delayed ? ' · *Delayed*' : '';

  // Reaction indicator: ⤾ available, ⌀ used. Cross-platform-safe glyphs.
  let reactionPart = '';
  if (combatant.hasReaction !== false && (combatant.dying ?? 0) === 0 && !combatant.delayed) {
    reactionPart = combatant.reactionUsed ? ' · ⌀' : ' · ⤾';
  }

  // Active effects (excluding the dying/wounded/doomed pips, which already
  // surface in their own slots above).
  let effectLine = '';
  if (combatant.effects?.length) {
    const visible = combatant.effects.filter(e => {
      const k = e.presetKey;
      return k !== 'dying' && k !== 'wounded' && k !== 'doomed' && k !== 'unconscious';
    });
    if (visible.length) {
      const effectTexts = visible.map(formatEffectForEmbed);
      effectLine = `\n      *${effectTexts.join(', ')}*`;
    }
  }

  // Current turn gets a thick highlight: a separator line above and below,
  // and the name is wrapped in __underline__ + **bold** so it pops even on
  // mobile where the marker emoji might shrink. Non-current combatants get
  // a quieter, simpler line.
  const mainLine = `${marker} **${combatant.initiative}** — ${combatant.name} · ${hpInline}${acPart}${woundedPart}${doomedPart}${delayedPart}${reactionPart}${effectLine}`;
  if (isCurrent) {
    return `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n🎯 **__${combatant.initiative} — ${combatant.name}__** · ${hpInline}${acPart}${woundedPart}${doomedPart}${delayedPart}${reactionPart}${effectLine}\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`;
  }
  return mainLine;
}

// Render ONE combatant in COMPACT form (single line with HP bar, no effects).
// Used for everyone except the current turn when there are 5+ combatants.
function renderCombatantCompact(combatant, isCurrent) {
  const marker = isCurrent ? '🎯' : '▫️';
  const status = hpStatus(
    combatant.hp,
    combatant.maxHp,
    combatant.dying ?? 0,
    combatant.doomed ?? 0,
    combatant.unconscious === true,
  );

  // Compact HP: PCs show bar + HP/MAX; NPCs show qualitative status only
  // (still hides numeric HP from players, just like detailed mode).
  let hpPart;
  if (combatant.isNpc) {
    hpPart = status.label;
  } else {
    const bar = hpBar(combatant.hp, combatant.maxHp, 6); // shorter bar for compact
    hpPart = `\`${bar}\` ${combatant.hp}/${combatant.maxHp}`;
  }

  // Compact mode drops AC and reaction state to keep lines short. Doomed/
  // Wounded/Delayed still surface as terse keywords because they affect
  // tactical decisions ("oh that goblin's wounded, finish it").
  const tags = [];
  if ((combatant.wounded ?? 0) > 0) tags.push(`W${combatant.wounded}`);
  if ((combatant.doomed  ?? 0) > 0) tags.push(`D${combatant.doomed}`);
  if (combatant.delayed) tags.push('Delayed');
  if ((combatant.dying  ?? 0) > 0) tags.push(`Dying ${combatant.dying}`);
  const tagPart = tags.length ? ` · ${tags.join('/')}` : '';

  const nameDisplay = isCurrent ? `**__${combatant.name}__**` : combatant.name;
  return `${marker} **${combatant.initiative}** — ${nameDisplay} · ${hpPart}${tagPart}`;
}

// Compute which page (0-indexed) contains the given combatant index.
function pageForIndex(idx, pageSize) {
  return Math.floor(idx / pageSize);
}

// Build the initiative embed. Optional `pageOverride` lets the button handler
// jump to an arbitrary page (private/ephemeral); default is the page that
// contains the current turn so the cursor naturally follows.
function buildInitiativeEmbed(enc, { pageOverride = null } = {}) {
  const total = enc.combatants.length;
  if (total === 0) {
    return {
      embed: new EmbedBuilder()
        .setTitle(`Initiative — Round ${enc.round}`)
        .setDescription('*No combatants yet*')
        .setColor(0xAA0000),
      page: 0,
      totalPages: 1,
    };
  }

  // ── Mode A: Tiny encounter (1-4) — render everyone detailed, no pagination
  if (total < INIT_COMPACT_THRESHOLD) {
    const lines = enc.combatants.map((c, i) =>
      renderCombatantDetailed(c, i === enc.turnIndex)
    );
    return {
      embed: new EmbedBuilder()
        .setTitle(`Initiative — Round ${enc.round}`)
        .setDescription(lines.join('\n\n'))
        .setColor(0xAA0000),
      page: 0,
      totalPages: 1,
    };
  }

  // ── Mode B: 5+ combatants — compact list, current turn detailed
  // Pagination kicks in only when total > PAGE_SIZE. Default page is the
  // one containing the current turn so the embed always shows whoever's up.
  const pageSize = INIT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const naturalPage = pageForIndex(enc.turnIndex, pageSize);
  const page = pageOverride != null
    ? Math.max(0, Math.min(totalPages - 1, pageOverride))
    : naturalPage;

  const start = page * pageSize;
  const end = Math.min(total, start + pageSize);

  // Build the page's combatant lines. The current turn is detailed only if
  // they're ON this page; otherwise we show them in compact form like
  // everyone else and add a "Current turn elsewhere" note at the top.
  const lines = [];
  const currentOnThisPage = enc.turnIndex >= start && enc.turnIndex < end;
  if (!currentOnThisPage) {
    const cur = enc.combatants[enc.turnIndex];
    if (cur) {
      lines.push(`*Current turn (page ${naturalPage + 1}):* ${renderCombatantCompact(cur, true)}`);
      lines.push(''); // visual gap before page contents
    }
  }
  for (let i = start; i < end; i++) {
    const c = enc.combatants[i];
    const isCurrent = i === enc.turnIndex;
    if (isCurrent) {
      lines.push(renderCombatantDetailed(c, true));
    } else {
      lines.push(renderCombatantCompact(c, false));
    }
  }

  const pageSuffix = totalPages > 1 ? ` — Page ${page + 1}/${totalPages}` : '';
  const embed = new EmbedBuilder()
    .setTitle(`Initiative — Round ${enc.round}${pageSuffix}`)
    .setDescription(lines.join('\n\n'))
    .setColor(0xAA0000);

  if (totalPages > 1) {
    embed.setFooter({ text: `${total} combatants · ◀ ▶ for more (private view)` });
  }

  return { embed, page, totalPages };
}

// Build the action row of pagination buttons. Returns null when there's
// only one page so we don't post empty button rows.
function buildInitiativeButtons(channelId, page, totalPages) {
  if (totalPages <= 1) return null;
  // Compute prev/next with wrap-around. CRITICAL: when totalPages === 2 and
  // wrap-around is on, both prev and next would point to the SAME other page,
  // and Discord rejects duplicate custom_ids on a single message. So we DON'T
  // wrap — at the boundaries we just disable the button instead. Keeps the
  // UX honest (no surprise wrap) and dodges the duplicate-id error.
  const prevPage = page - 1;  // -1 means "no prev"
  const nextPage = page + 1;  // === totalPages means "no next"
  const hasPrev = prevPage >= 0;
  const hasNext = nextPage < totalPages;

  // Use a unique id per button position even when disabled, so Discord still
  // sees two distinct components. Disabled ids never fire so collisions
  // don't matter, but we keep them distinct for cleanliness.
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(hasPrev ? `init_page_${channelId}_${prevPage}` : `init_page_${channelId}_disabled_prev`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrev),
    new ButtonBuilder()
      .setCustomId(hasNext ? `init_page_${channelId}_${nextPage}` : `init_page_${channelId}_disabled_next`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasNext),
  );
}

async function updateSummary(channel, enc) {
  if (!enc) return;
  // Always render the summary at the natural page (the one containing the
  // current turn) so the cursor follows along automatically as /init next
  // rotates through combatants. Players who want to peek at later pages use
  // the buttons, which give them a private/ephemeral view.
  const { embed, page, totalPages } = buildInitiativeEmbed(enc);
  const buttons = buildInitiativeButtons(channel.id, page, totalPages);
  const components = buttons ? [buttons] : [];
  const payload = { embeds: [embed], components };

  if (enc.summaryMessageId) {
    try {
      const existing = await channel.messages.fetch(enc.summaryMessageId);
      await existing.edit(payload);
      return;
    } catch {}
  }
  try {
    const msg = await channel.send(payload);
    setSummaryMessageId(channel.id, msg.id);
    try {
      await msg.pin();
    } catch (err) {
      console.warn('Could not pin summary message (missing Manage Messages permission?):', err.message);
    }
  } catch (err) {
    console.error('Failed to post summary:', err);
  }
}

async function clearSummary(channel, enc) {
  if (!enc?.summaryMessageId) return;
  try {
    const msg = await channel.messages.fetch(enc.summaryMessageId);
    try { await msg.unpin(); } catch {}
  } catch {}
}

module.exports = {
  buildInitiativeEmbed,
  buildInitiativeButtons,
  updateSummary,
  clearSummary,
};
