import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { updateCharacterState, type CharacterStatePatch } from './api';
import { characterKey } from './useCharacter';
import type { CharacterRow } from './types';

/**
 * Edit a character's live state (HP / hero points / dying / wounded / XP /
 * notes) with optimistic updates so steppers feel instant.
 *
 * onMutate patches the cached character immediately; onError rolls back; the
 * Realtime subscription + onSettled invalidate reconcile with the server. The
 * `updated_at` bump also pushes the change to any other open sheet via
 * Realtime.
 */
export function useUpdateCharacterState(charKey: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = characterKey(user?.id, charKey);

  return useMutation<void, Error, CharacterStatePatch, { prev?: CharacterRow }>({
    // Serialize writes to the same character so overlapping optimistic updates
    // apply/roll back in order instead of clobbering each other's cache.
    scope: { id: `char-state:${key.join(':')}` },
    mutationFn: (patch) => {
      if (!user) throw new Error('You need to be signed in.');
      return updateCharacterState({ userId: user.id, charKey, patch });
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CharacterRow>(key);
      if (prev) qc.setQueryData<CharacterRow>(key, { ...prev, ...patch });
      return { prev };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}
