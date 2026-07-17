// ── notifiers/feedback.js ────────────────────────────────────────────────────
// Bridge new website Contact-form / feedback submissions to Discord.
//
// The web app inserts rows into the `feedback` table (see web migration
// 20260714010000_feedback.sql). This module subscribes to INSERTs on that table
// via Supabase Realtime — the same mechanism the state modules use — and posts
// an embed to Discord so the owner is actively notified.
//
// Destination, in priority order:
//   1. FEEDBACK_CHANNEL_ID — a text channel to post into (recommended for teams)
//   2. BOT_OWNER_ID        — DM the owner as a fallback
// If neither is set, notifications are disabled (logged once).
//
// This is a notifier, not a state cache: it holds no in-memory state and never
// writes back. Realtime for `feedback` is delivered because the bot connects
// with the service role (RLS-bypassing), and the migration publishes the table.

const { EmbedBuilder } = require('discord.js');

const KIND_LABEL = {
  bug: '🐛 Bug report',
  suggestion: '💡 Suggestion',
  concern: '⚠️ Concern',
  contact: '✉️ Contact',
  other: '📩 Feedback',
};

const KIND_COLOR = {
  bug: 0xe05252,
  suggestion: 0x52c41a,
  concern: 0xe0a527,
  contact: 0x5b8def,
  other: 0xc9a227,
};

/** Build the Discord embed for one feedback row. Pure — exported for tests. */
function buildEmbed(row) {
  const kind = (row && row.kind) || 'other';
  const subject = row && row.subject ? ` — ${String(row.subject).slice(0, 200)}` : '';
  const message = String((row && row.message) || '').slice(0, 4000) || '(no message)';
  const from = [row && row.name, row && row.email].filter(Boolean).join(' · ') || 'Anonymous';

  const embed = new EmbedBuilder()
    .setTitle(`${KIND_LABEL[kind] || KIND_LABEL.other}${subject}`)
    .setDescription(message)
    .setColor(KIND_COLOR[kind] ?? KIND_COLOR.other)
    .addFields({ name: 'From', value: from })
    .setFooter({ text: 'Pathway · website contact form' });

  if (row && row.page) embed.addFields({ name: 'Page', value: String(row.page).slice(0, 256) });
  if (row && row.created_at) {
    const ts = new Date(row.created_at);
    if (!Number.isNaN(ts.getTime())) embed.setTimestamp(ts);
  }
  return embed;
}

async function _notify(client, row) {
  if (!client || !row) return;
  const embed = buildEmbed(row);
  const channelId = process.env.FEEDBACK_CHANNEL_ID;
  const ownerId = process.env.BOT_OWNER_ID;

  // Prefer a configured channel; fall back to DMing the owner.
  if (channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && typeof channel.isTextBased === 'function' && channel.isTextBased()) {
      await channel.send({ embeds: [embed] });
      return;
    }
    console.warn('[notifiers/feedback] FEEDBACK_CHANNEL_ID not a sendable channel — falling back to owner DM');
  }
  if (ownerId) {
    const user = await client.users.fetch(ownerId).catch(() => null);
    if (user) {
      await user.send({ embeds: [embed] });
      return;
    }
    console.warn('[notifiers/feedback] could not DM BOT_OWNER_ID (DMs closed or bad id)');
  }
}

/** Subscribe to feedback INSERTs and notify Discord. Call in clientReady. */
function subscribe(sb, client) {
  if (!sb) {
    console.warn('[notifiers/feedback] Supabase not available — feedback notifications disabled');
    return;
  }
  if (!process.env.FEEDBACK_CHANNEL_ID && !process.env.BOT_OWNER_ID) {
    console.warn('[notifiers/feedback] neither FEEDBACK_CHANNEL_ID nor BOT_OWNER_ID set — feedback notifications disabled');
    return;
  }

  sb.channel('notify-feedback')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'feedback' }, (payload) => {
      _notify(client, payload && payload.new).catch((e) =>
        console.error('[notifiers/feedback] notify failed:', e.message),
      );
    })
    .subscribe((status, err) => {
      if (err) console.error('[notifiers/feedback] subscription error:', err.message);
      else console.log(`[notifiers/feedback] ${status}`);
    });
}

module.exports = { subscribe, buildEmbed };
