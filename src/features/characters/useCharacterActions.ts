import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import {
  deleteCharacter,
  setCharacterPublic,
  updateCharacterFromBuild,
  type CreateCharacterResult,
  type SetPublicResult,
} from './api';
import { characterKey } from './useCharacter';
import { fetchPathbuilderBuild } from './pathbuilderImport';

/**
 * Re-fetch a character's build from Pathbuilder using its stored
 * `pathbuilder_id` and update the row while preserving all live state.
 * Invalidates the specific character cache + the vault list so both refresh.
 */
export function useUpdateFromPathbuilder() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation<
    CreateCharacterResult,
    Error,
    { charKey: string; pathbuilderId: number }
  >({
    mutationFn: async ({ charKey, pathbuilderId }) => {
      if (!user) throw new Error('You need to be signed in.');
      const build = await fetchPathbuilderBuild(pathbuilderId);
      return updateCharacterFromBuild({
        userId: user.id,
        charKey,
        build,
        pathbuilderId,
      });
    },
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: characterKey(user?.id, vars.charKey) });
      qc.invalidateQueries({ queryKey: ['characters'] });
    },
  });
}

/**
 * Delete one of the user's characters. Invalidates the vault list so the
 * card disappears; the CharacterPage caller should route away first (a
 * deleted character has nothing to render).
 */
export function useDeleteCharacter() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (charKey) => {
      if (!user) throw new Error('You need to be signed in.');
      await deleteCharacter({ userId: user.id, charKey });
    },
    onSuccess: (_result, charKey) => {
      qc.invalidateQueries({ queryKey: characterKey(user?.id, charKey) });
      qc.invalidateQueries({ queryKey: ['characters'] });
    },
  });
}

/** Toggle `is_public` on a character. Returns the updated row. */
export function useSetCharacterPublic(charKey: string) {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation<SetPublicResult, Error, boolean>({
    mutationFn: async (isPublic) => {
      if (!user) throw new Error('You need to be signed in.');
      return setCharacterPublic({ userId: user.id, charKey, isPublic });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: characterKey(user?.id, charKey) });
      qc.invalidateQueries({ queryKey: ['characters'] });
    },
  });
}
