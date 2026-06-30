import { requireSupabase } from '@/lib/supabase';
import type { CharacterSummary } from './types';

const SUMMARY_COLUMNS =
  'id, char_key, name, source, current_hp, hero_points, experience, updated_at';

/**
 * Fetch the signed-in user's characters.
 *
 * No `user_id` filter is needed: RLS scopes `authenticated` reads to
 * `user_id = auth.uid()` (data-model.md §6). The anon key plus the user's
 * session is what makes this safe — the same query run by another user returns
 * only *their* rows.
 */
export async function fetchMyCharacters(): Promise<CharacterSummary[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('characters')
    .select(SUMMARY_COLUMNS)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as CharacterSummary[];
}
