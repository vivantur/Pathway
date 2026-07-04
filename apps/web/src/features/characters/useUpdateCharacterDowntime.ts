import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { updateCharacterDowntime, DOWNTIME_MAX_BANK } from './api';
import { downtimeKey } from './useCharacterDowntime';
import type { DowntimeRecord } from './types';

/**
 * Grant or spend downtime days, with optimistic updates and the overlay's
 * anti-clobber discipline (a compare-and-swap server write, so a concurrent bot
 * grant/spend is never lost). Each op appends an audit-log entry matching the
 * bot's shape, and clamps to the bot's rules: bank never exceeds
 * DOWNTIME_MAX_BANK and never drops below 0.
 */
export function useUpdateCharacterDowntime(charKey: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = downtimeKey(user?.id, charKey);

  const mutation = useMutation<void, Error, (record: DowntimeRecord) => DowntimeRecord, { prev?: DowntimeRecord }>({
    scope: { id: `char-downtime:${key.join(':')}` },
    mutationFn: async (mutate) => {
      if (!user) throw new Error('You need to be signed in.');
      await updateCharacterDowntime({ userId: user.id, charKey, mutate });
    },
    onMutate: async (mutate) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<DowntimeRecord>(key);
      if (prev) qc.setQueryData<DowntimeRecord>(key, mutate(prev));
      return { prev };
    },
    onError: (_err, _mutate, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  /** Compute the applied delta against the freshest bank, clamped to bounds. */
  const apply = (kind: 'grant' | 'spend', days: number, reason: string, ts: string) =>
    mutation.mutate((record) => {
      const room = kind === 'grant' ? DOWNTIME_MAX_BANK - record.bank : record.bank;
      const magnitude = Math.min(Math.max(0, Math.floor(days)), Math.max(0, room));
      if (magnitude === 0) return record;
      const delta = kind === 'grant' ? magnitude : -magnitude;
      const balance = record.bank + delta;
      return {
        ...record,
        bank: balance,
        log: [
          ...record.log,
          { ts, kind, delta, balance, by: user?.id ?? null, reason: reason.trim() },
        ],
      };
    });

  return {
    // ts is stamped at call time so the optimistic and server passes agree.
    grant: (days: number, reason: string) => apply('grant', days, reason, new Date().toISOString()),
    spend: (days: number, reason: string) => apply('spend', days, reason, new Date().toISOString()),
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}
