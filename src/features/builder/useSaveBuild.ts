import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { createCharacterFromBuild, type CreateCharacterResult } from '@/features/characters/api';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { toPathbuilder } from './pathbuilder';
import type { BuilderState } from './types';

/**
 * Save a web-built character into the Supabase vault. The builder emits
 * Pathbuilder-compatible JSON, which is exactly what `createCharacterFromBuild`
 * stores (and what the bot reads via `pathbuilder_data`), so a web build lands
 * in the vault and syncs to Discord the same as a Pathbuilder import.
 */
export function useSaveBuild() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation<CreateCharacterResult, Error, BuilderState>({
    mutationFn: async (state) => {
      if (!user) throw new Error('Sign in to save to your vault.');
      // Our PathbuilderBuild is structurally compatible with main's; the cast
      // bridges the two independently-declared types.
      const build = toPathbuilder(state).build as unknown as PathbuilderBuild;
      return createCharacterFromBuild({ userId: user.id, build });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] });
    },
  });
}
