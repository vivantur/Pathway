import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { updateCharacterOverlay } from './api';
import { characterKey } from './useCharacter';
import type { CharacterOverlay, CharacterRow } from './types';

/** A pure transform of the overlay: `(current) => next`, touching only its own slice. */
export type OverlayMutator = (current: CharacterOverlay) => CharacterOverlay;

/**
 * Edit a character's `overlay` blob with optimistic updates.
 *
 * The overlay is co-owned with the bot, so the caller passes a MUTATOR rather
 * than a finished blob. The server-side write (see `updateCharacterOverlay`)
 * applies that mutator to the freshest overlay under compare-and-swap, so a
 * concurrent bot write is never clobbered. Here we apply the same mutator to
 * the cached overlay for the optimistic patch; the Realtime subscription +
 * onSettled invalidate reconcile with the server. Because the optimistic patch
 * derives from the cache and rapid edits are serialized by `scope`, successive
 * clicks compose (each reads the previous optimistic result) instead of all
 * writing the same stale absolute value.
 */
export function useUpdateCharacterOverlay(charKey: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = characterKey(user?.id, charKey);

  return useMutation<void, Error, OverlayMutator, { prev?: CharacterRow }>({
    // Serialize overlay writes to the same character so concurrent focus/
    // condition/counter edits apply in order rather than clobbering each other.
    scope: { id: `char-overlay:${key.join(':')}` },
    mutationFn: async (mutate) => {
      if (!user) throw new Error('You need to be signed in.');
      await updateCharacterOverlay({ userId: user.id, charKey, mutate });
    },
    onMutate: async (mutate) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CharacterRow>(key);
      if (prev) {
        const nextOverlay = mutate((prev.overlay ?? {}) as CharacterOverlay);
        qc.setQueryData<CharacterRow>(key, { ...prev, overlay: nextOverlay });
      }
      return { prev };
    },
    onError: (_err, _mutate, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}
