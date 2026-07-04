import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/useAuth';
import { fetchCharacterNotes } from './api';

export const notesKey = (userId: string | undefined, charKey: string) =>
  ['character-notes', userId, charKey] as const;

/**
 * Load the note list for one character, and keep it live: the bot writes
 * `character_notes` from Discord, so we subscribe to Realtime and invalidate on
 * any change to this character's row. Skipped while signed out. Requires
 * `character_notes` to be in the `supabase_realtime` publication (Phase 2
 * migrations added it for every user-state table).
 */
export function useCharacterNotes(charKey: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = Boolean(user && charKey);

  useEffect(() => {
    if (!enabled || !charKey) return;
    const supabase = requireSupabase();
    const channel = supabase
      .channel(`character-notes-${charKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'character_notes', filter: `char_key=eq.${charKey}` },
        () => qc.invalidateQueries({ queryKey: notesKey(user?.id, charKey) }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, charKey, user?.id, qc]);

  return useQuery({
    queryKey: notesKey(user?.id, charKey ?? ''),
    queryFn: () => fetchCharacterNotes(charKey!),
    enabled,
  });
}
