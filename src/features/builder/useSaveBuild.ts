import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import {
  createCharacterFromBuild,
  updateCharacterFromBuild,
  type CreateCharacterResult,
} from '@/features/characters/api';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { toPathbuilder } from './pathbuilder';
import type { BuilderState } from './types';

export interface SaveBuildInput {
  state: BuilderState;
  /** When set, update this existing character instead of creating a new one. */
  editCharKey?: string;
}

/**
 * Save a web-built character to the Supabase vault (create) or update an
 * existing one (edit / level-up). The builder emits Pathbuilder-compatible
 * JSON, which is what the vault stores and the bot reads; we also embed the
 * full BuilderState under `_pathwayBuild` so re-opening the character in the
 * builder is lossless (the bot ignores the extra key).
 */
export function useSaveBuild() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation<CreateCharacterResult, Error, SaveBuildInput>({
    mutationFn: async ({ state, editCharKey }) => {
      if (!user) throw new Error('Sign in to save to your vault.');
      const base = toPathbuilder(state).build;
      const build = { ...base, _pathwayBuild: state } as unknown as PathbuilderBuild;
      return editCharKey
        ? updateCharacterFromBuild({ userId: user.id, charKey: editCharKey, build })
        : createCharacterFromBuild({ userId: user.id, build });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['character'] });
    },
  });
}
