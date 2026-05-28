// ── lib/userMap.js ───────────────────────────────────────────────────────────
// Shared helper: given a set of Discord snowflakes, fetch the corresponding
// Supabase user UUIDs from the users table.
//
// Used by every batch sync that needs to translate discord_id (the snowflake
// the bot knows) → user_id (the UUID Supabase's foreign keys reference).
//
// Extracted from lib/storage.js in Phase 1 so state modules can import a
// single small helper instead of pulling all of storage.js into their
// dependency graph.

async function buildDiscordToUserMap(sb, discordIds) {
  if (!discordIds || discordIds.length === 0) return {};
  const { data: rows, error } = await sb
    .from('users')
    .select('id, discord_id')
    .in('discord_id', discordIds);
  if (error) throw error;
  return Object.fromEntries((rows ?? []).map(u => [u.discord_id, u.id]));
}

module.exports = { buildDiscordToUserMap };
