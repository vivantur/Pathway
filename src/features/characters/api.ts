import { requireSupabase } from '@/lib/supabase';
import type { CharacterNoteEntry, CharacterRow, CharacterSummary } from './types';

const SUMMARY_COLUMNS =
  'id, char_key, name, source, current_hp, hero_points, experience, updated_at';

const FULL_COLUMNS = [
  'id', 'user_id', 'char_key', 'name', 'source',
  'pathbuilder_data', 'pathbuilder_id',
  'ancestry_name', 'heritage_name', 'class_name', 'background_name', 'level',
  'current_hp', 'hero_points', 'dying', 'wounded', 'experience',
  'currency', 'overlay',
  'status', 'notes', 'art',
  'is_public', 'public_share_id',
  'updated_at',
].join(', ');

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

/**
 * Fetch one character by its stable per-user slug (`char_key`).
 *
 * RLS filters by owner automatically. Returns null when there's no match, so
 * "not found" (either doesn't exist or isn't yours) is a clean 404, not an
 * error that bubbles up as a red panel.
 */
export async function fetchCharacterByKey(charKey: string): Promise<CharacterRow | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('characters')
    .select(FULL_COLUMNS)
    .eq('char_key', charKey)
    .maybeSingle();

  if (error) throw error;
  return (data as CharacterRow | null) ?? null;
}

/**
 * Load the note list for one character. `character_notes` is keyed by
 * `(user_id, char_key)`, not `character_id` — a bot-side artifact from before
 * characters had UUIDs. RLS already scopes reads to the owner.
 *
 * Notes come back as the raw JSONB array from the `notes` column; each entry
 * has at least `{id, ...}` but the "content" field name varies (text/body/
 * title) between the bot's early and current schemas, so callers should
 * normalize with `noteText()`.
 */
export async function fetchCharacterNotes(charKey: string): Promise<CharacterNoteEntry[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('character_notes')
    .select('notes')
    .eq('char_key', charKey)
    .maybeSingle();

  if (error) throw error;
  const raw = (data as { notes: unknown } | null)?.notes;
  return Array.isArray(raw) ? (raw as CharacterNoteEntry[]) : [];
}

/** Best-effort content extraction — the bot changed schemas mid-life. */
export function noteText(n: CharacterNoteEntry): string {
  return String(n.text ?? n.body ?? n.title ?? '').trim();
}
