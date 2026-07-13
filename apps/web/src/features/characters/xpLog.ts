import { requireSupabase } from '@/lib/supabase';

/**
 * A row of `public.character_xp_log` — the bot's canonical XP-award history
 * (apps/bot/src/state/xpLog.js). Both the bot and the website read/write this
 * table; the bot has a Realtime subscription that reflects web writes.
 */
export interface XpLogRow {
  id: string;
  user_id: string;
  char_key: string;
  amount: number;
  reason: string | null;
  old_xp: number;
  new_xp: number;
  awarded_by_discord_id: string | null;
  entry_type: 'award' | 'set' | 'reset';
  created_at: string;
}

const COLUMNS =
  'id, user_id, char_key, amount, reason, old_xp, new_xp, awarded_by_discord_id, entry_type, created_at';

/** All XP-log entries for a character, oldest first (as the bot stores them). */
export async function listXpLog(userId: string, charKey: string): Promise<XpLogRow[]> {
  const { data, error } = await requireSupabase()
    .from('character_xp_log')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('char_key', charKey)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as XpLogRow[];
}

export interface AddXpEntryInput {
  userId: string;
  charKey: string;
  /** Signed delta (negative to deduct). */
  amount: number;
  reason?: string | null;
  /** The character's XP total BEFORE this entry (for the snapshot columns). */
  currentXp: number;
}

/**
 * Append an XP-award entry — the website equivalent of `/xp award`. Stamps the
 * before/after snapshots the bot's history renders. `entry_type` is always
 * 'award' from the web (the bot owns the 'set'/'reset' cases).
 */
export async function addXpEntry(input: AddXpEntryInput): Promise<XpLogRow> {
  const oldXp = Math.max(0, Math.floor(input.currentXp));
  const newXp = Math.max(0, oldXp + Math.floor(input.amount));
  const { data, error } = await requireSupabase()
    .from('character_xp_log')
    .insert({
      user_id: input.userId,
      char_key: input.charKey,
      amount: Math.floor(input.amount),
      reason: input.reason?.trim() || null,
      old_xp: oldXp,
      new_xp: newXp,
      awarded_by_discord_id: null, // web-created; the bot shows no "by <@…>"
      entry_type: 'award',
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as XpLogRow;
}

export interface UpdateXpEntryInput {
  id: string;
  amount: number;
  reason?: string | null;
}

/** Edit an existing entry's amount/reason in place (keeps its snapshots coherent). */
export async function updateXpEntry(input: UpdateXpEntryInput): Promise<XpLogRow> {
  const { data, error } = await requireSupabase()
    .from('character_xp_log')
    .update({
      amount: Math.floor(input.amount),
      reason: input.reason?.trim() || null,
    })
    .eq('id', input.id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  // Keep this entry's after-snapshot consistent with its (possibly new) amount.
  const row = data as XpLogRow;
  if (row.new_xp !== row.old_xp + row.amount) {
    const fixed = { ...row, new_xp: Math.max(0, row.old_xp + row.amount) };
    await requireSupabase().from('character_xp_log').update({ new_xp: fixed.new_xp }).eq('id', row.id);
    return fixed;
  }
  return row;
}

export async function deleteXpEntry(id: string): Promise<void> {
  const { error } = await requireSupabase().from('character_xp_log').delete().eq('id', id);
  if (error) throw error;
}
