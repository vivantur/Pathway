import { useEffect, useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/useAuth';
import { updateCharacterState } from './api';
import { characterKey } from './useCharacter';
import type { CharacterRow } from './types';
import {
  addXpEntry,
  deleteXpEntry,
  listXpLog,
  updateXpEntry,
  type XpLogRow,
} from './xpLog';

export const xpLogKey = (userId: string | undefined, charKey: string) =>
  ['xp-log', userId, charKey] as const;

/**
 * The character's XP log (the shared `character_xp_log` table), newest first.
 * Also subscribes to that table via Realtime so a bot `/xp` award shows up live.
 */
export function useXpLog(charKey: string | undefined, enabled = true) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const instanceId = useId(); // unique channel name so multiple consumers can subscribe

  const query = useQuery({
    queryKey: xpLogKey(user?.id, charKey ?? ''),
    queryFn: () => listXpLog(user!.id, charKey!),
    enabled: Boolean(user && charKey && enabled),
    select: (rows: XpLogRow[]) => [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  });

  useEffect(() => {
    if (!user || !charKey || !enabled) return;
    const supabase = requireSupabase();
    const channel = supabase
      .channel(`xp-log-${user.id}-${charKey}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'character_xp_log', filter: `char_key=eq.${charKey}` },
        () => qc.invalidateQueries({ queryKey: xpLogKey(user.id, charKey) }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, charKey, enabled, qc, user, instanceId]);

  return query;
}

/** Current XP total from the cached character row (the authoritative value). */
function useCurrentXp(charKey: string): () => number {
  const { user } = useAuth();
  const qc = useQueryClient();
  return () => qc.getQueryData<CharacterRow>(characterKey(user?.id, charKey))?.experience ?? 0;
}

/**
 * XP-log mutations. Each one also adjusts the character's XP TOTAL
 * (`characters.experience`) by the entry's delta — the total stays authoritative
 * and is never re-derived from the log, so an incomplete log can't clobber it.
 * Both the log query and the character query are invalidated so the header and
 * the modal update together (and the bot sees the change via Realtime).
 */
export function useXpLogMutations(charKey: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const getXp = useCurrentXp(charKey);

  const bumpExperience = async (delta: number) => {
    if (!user || delta === 0) return;
    const next = Math.max(0, getXp() + delta);
    await updateCharacterState({ userId: user.id, charKey, patch: { experience: next } });
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: xpLogKey(user?.id, charKey) });
    qc.invalidateQueries({ queryKey: characterKey(user?.id, charKey) });
  };

  const add = useMutation({
    mutationFn: async (input: { amount: number; reason?: string | null }) => {
      if (!user) throw new Error('You need to be signed in.');
      await addXpEntry({ userId: user.id, charKey, amount: input.amount, reason: input.reason, currentXp: getXp() });
      await bumpExperience(input.amount);
    },
    onSuccess: invalidate,
  });

  const edit = useMutation({
    mutationFn: async (input: { entry: XpLogRow; amount: number; reason?: string | null }) => {
      if (!user) throw new Error('You need to be signed in.');
      const delta = Math.floor(input.amount) - input.entry.amount;
      await updateXpEntry({ id: input.entry.id, amount: input.amount, reason: input.reason });
      await bumpExperience(delta);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (entry: XpLogRow) => {
      if (!user) throw new Error('You need to be signed in.');
      await deleteXpEntry(entry.id);
      // Removing an entry undoes its contribution to the running total.
      await bumpExperience(-entry.amount);
    },
    onSuccess: invalidate,
  });

  return { add, edit, remove };
}
