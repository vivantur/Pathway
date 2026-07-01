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

/** The storage bucket that holds player-uploaded portraits. */
const PORTRAIT_BUCKET = 'portraits';

/** Accepted portrait types, keep in sync with the bucket's MIME allow-list. */
export const PORTRAIT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/** 5 MB cap to keep the CDN happy and avoid slow first-loads on mobile. */
export const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload a portrait image and update the character's `art` column to the
 * public URL. Storage path is `<user_id>/<char_key>-<timestamp>.<ext>` — the
 * timestamp busts cached URLs so a re-upload shows up immediately without
 * needing a browser hard-refresh, and the folder segment matches the storage
 * RLS policy (`(storage.foldername(name))[1] = auth.uid()::text`).
 *
 * Returns the new public URL so the caller can optimistically update UI
 * without a refetch.
 */
export async function uploadCharacterPortrait(input: {
  userId: string;
  charKey: string;
  file: File;
}): Promise<string> {
  const { userId, charKey, file } = input;

  if (!PORTRAIT_MIME_TYPES.includes(file.type as (typeof PORTRAIT_MIME_TYPES)[number])) {
    throw new Error(
      `Unsupported image type "${file.type || 'unknown'}". Use JPG, PNG, WebP, or GIF.`,
    );
  }
  if (file.size > PORTRAIT_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`Image is ${mb} MB. Portraits must be under 5 MB.`);
  }

  const supabase = requireSupabase();
  const ext = extensionFor(file);
  const path = `${userId}/${charKey}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PORTRAIT_BUCKET)
    .upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from(PORTRAIT_BUCKET).getPublicUrl(path);
  const publicUrl = pub.publicUrl;
  if (!publicUrl) throw new Error("Couldn't resolve the portrait's public URL.");

  const { error: updateError } = await supabase
    .from('characters')
    .update({ art: publicUrl })
    .eq('user_id', userId)
    .eq('char_key', charKey);
  if (updateError) throw updateError;

  return publicUrl;
}

/** Map a file's MIME type to a filesystem-friendly extension. */
function extensionFor(file: File): string {
  switch (file.type) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    default: {
      const fromName = file.name.split('.').pop();
      return fromName && fromName.length <= 5 ? fromName.toLowerCase() : 'img';
    }
  }
}
