import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/useAuth';
import { fetchCharacterBag } from './api';

export const bagKey = (userId: string | undefined, charKey: string) =>
  ['character-bag', userId, charKey] as const;

/**
 * Load one character's loot bag, kept live: the bot adds/removes items from
 * Discord, so we subscribe to Realtime on `bag_items` (and `bags` for renames)
 * and invalidate on any change to this character's rows. Skipped while signed out.
 */
export function useCharacterBag(charKey: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = Boolean(user && charKey);

  useEffect(() => {
    if (!enabled || !charKey) return;
    const supabase = requireSupabase();
    const invalidate = () => qc.invalidateQueries({ queryKey: bagKey(user?.id, charKey) });
    const channel = supabase
      .channel(`character-bag-${charKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bag_items', filter: `char_key=eq.${charKey}` },
        invalidate,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bags', filter: `char_key=eq.${charKey}` },
        invalidate,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, charKey, user?.id, qc]);

  return useQuery({
    queryKey: bagKey(user?.id, charKey ?? ''),
    queryFn: () => fetchCharacterBag(charKey!),
    enabled,
  });
}
