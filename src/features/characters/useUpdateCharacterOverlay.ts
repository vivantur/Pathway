import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { updateCharacterOverlay } from './api';
import { characterKey } from './useCharacter';
import type { CharacterOverlay, CharacterRow } from './types';

/**
 * Edit a character's `overlay` blob with optimistic updates.
 *
 * The bot owns the overlay's shape, so the CALLER performs the read-modify-
 * write: read `character.overlay`, compute the new overlay, and pass the whole
 * object to `mutate`. This hook writes it and optimistically patches the cache;
 * the Realtime subscription + onSettled invalidate reconcile with the server.
 * Passing the already-merged overlay (rather than a mutator run here) avoids
 * double-applying against the optimistic cache.
 */
export function useUpdateCharacterOverlay(charKey: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = characterKey(user?.id, charKey);

  return useMutation<void, Error, CharacterOverlay, { prev?: CharacterRow }>({
    mutationFn: (overlay) => {
      if (!user) throw new Error('You need to be signed in.');
      return updateCharacterOverlay({ userId: user.id, charKey, overlay });
    },
    onMutate: async (overlay) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CharacterRow>(key);
      if (prev) qc.setQueryData<CharacterRow>(key, { ...prev, overlay });
      return { prev };
    },
    onError: (_err, _overlay, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}
