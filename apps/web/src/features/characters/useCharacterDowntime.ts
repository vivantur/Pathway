import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/useAuth';
import { fetchCharacterDowntime } from './api';

export const downtimeKey = (userId: string | undefined, charKey: string) =>
  ['character-downtime', userId, charKey] as const;

/**
 * Load one character's downtime bank, kept live: the bot grants/spends/accrues
 * downtime from Discord, so we subscribe to Realtime on the `downtime` row and
 * invalidate on any change. Skipped while signed out.
 */
export function useCharacterDowntime(charKey: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const enabled = Boolean(user && charKey);

  useEffect(() => {
    if (!enabled || !charKey) return;
    const supabase = requireSupabase();
    const channel = supabase
      .channel(`character-downtime-${charKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'downtime', filter: `char_key=eq.${charKey}` },
        () => qc.invalidateQueries({ queryKey: downtimeKey(user?.id, charKey) }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, charKey, user?.id, qc]);

  return useQuery({
    queryKey: downtimeKey(user?.id, charKey ?? ''),
    queryFn: () => fetchCharacterDowntime(charKey!),
    enabled,
  });
}
