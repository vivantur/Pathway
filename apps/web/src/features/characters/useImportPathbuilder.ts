import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { createCharacterFromBuild } from './api';
import type { CreateCharacterResult } from './api';
import { fetchPathbuilderBuild } from './pathbuilderImport';

/**
 * Full "import from Pathbuilder" flow: fetch the build by id, insert a new
 * character row, invalidate the vault list so the new character shows up.
 * Errors from either step bubble up so the caller can render them inline.
 */
export function useImportPathbuilder() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation<CreateCharacterResult, Error, number>({
    mutationFn: async (pathbuilderId: number) => {
      if (!user) throw new Error('You need to be signed in.');
      const build = await fetchPathbuilderBuild(pathbuilderId);
      return createCharacterFromBuild({
        userId: user.id,
        build,
        pathbuilderId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['character'] });
    },
  });
}
