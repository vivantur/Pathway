import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/useAuth';
import { characterKey } from './useCharacter';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'error';

export interface RealtimeState {
  status: LiveStatus;
  /** Epoch ms of the last update pushed by the bot, or null. */
  lastUpdateAt: number | null;
}

/**
 * Subscribe to bot-side changes on one character row via Supabase Realtime.
 *
 * When the bot writes to this character (HP/XP/hero points/dying/wounded/
 * overlay — anything), Postgres emits a change event and we invalidate the
 * character query, so react-query refetches the full fresh row through our
 * normal RLS-scoped select. We deliberately refetch rather than merge
 * `payload.new`: the refetch guarantees every column (and correct types)
 * without depending on the table's REPLICA IDENTITY.
 *
 * Only runs for the owner's live sheet — disabled on public share views and
 * while signed out. Requires `public.characters` to be in the
 * `supabase_realtime` publication (one-time SQL, see docs).
 */
export function useCharacterRealtime(input: {
  characterId: string | undefined;
  charKey: string | undefined;
  enabled: boolean;
}): RealtimeState {
  const { characterId, charKey, enabled } = input;
  const { user } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('off');
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !characterId || !charKey || !user) {
      setStatus('off');
      return;
    }

    const supabase = requireSupabase();
    setStatus('connecting');

    const channel = supabase
      .channel(`character-${characterId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'characters',
          filter: `id=eq.${characterId}`,
        },
        () => {
          setLastUpdateAt(Date.now());
          qc.invalidateQueries({ queryKey: characterKey(user.id, charKey) });
        },
      )
      .subscribe((channelStatus) => {
        // 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'
        if (channelStatus === 'SUBSCRIBED') setStatus('live');
        else if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
          setStatus('error');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // Depend on user?.id, NOT the whole `user` object — Supabase hands back a
    // new user reference on every token refresh, which would otherwise tear down
    // and re-create the Realtime channel (dropping events) roughly hourly.
  }, [enabled, characterId, charKey, user?.id, qc]);

  return { status, lastUpdateAt };
}
