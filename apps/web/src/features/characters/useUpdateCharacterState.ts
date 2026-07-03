import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { updateCharacterState, type CharacterStatePatch } from './api';
import { characterKey } from './useCharacter';
import type { CharacterRow } from './types';

/**
 * A live-state write. Either a direct patch (absolute values — text entry,
 * currency, etc.) or a RESOLVER that computes the patch from the freshest
 * cached row. Steppers must use a resolver: computing `current - 1` from a
 * captured render prop means a fast double-tap sends the same absolute value
 * twice and drops a step. A resolver runs inside `onMutate` against the cache
 * (which already reflects the previous, serialized optimistic update), so
 * successive clicks compose correctly.
 */
export type StateWrite = CharacterStatePatch | StateResolver;

interface StateResolver {
  resolve: (prev: CharacterRow | undefined) => CharacterStatePatch;
  /** Filled in by onMutate so mutationFn writes the same value it optimistically applied. */
  _resolved?: CharacterStatePatch;
}

function isResolver(write: StateWrite): write is StateResolver {
  return typeof (write as StateResolver).resolve === 'function';
}

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

  return useMutation<void, Error, StateWrite, { prev?: CharacterRow }>({
    // Serialize writes to the same character so overlapping optimistic updates
    // apply/roll back in order instead of clobbering each other's cache.
    scope: { id: `char-state:${key.join(':')}` },
    mutationFn: (write) => {
      if (!user) throw new Error('You need to be signed in.');
      const patch = isResolver(write)
        ? (write._resolved ?? write.resolve(qc.getQueryData<CharacterRow>(key)))
        : write;
      return updateCharacterState({ userId: user.id, charKey, patch });
    },
    onMutate: async (write) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CharacterRow>(key);
      const patch = isResolver(write) ? write.resolve(prev) : write;
      if (isResolver(write)) write._resolved = patch;
      if (prev) qc.setQueryData<CharacterRow>(key, { ...prev, ...patch });
      return { prev };
    },
    onError: (_err, _write, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}
