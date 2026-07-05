import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import {
  createCharacterFromBuild,
  updateCharacterFromBuild,
  uploadCharacterPortrait,
  type CreateCharacterResult,
} from '@/features/characters/api';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { saveCompanion } from '@/features/companions/api';
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
      // Drafted companions are created for real below (they need a char_key),
      // so the embedded state carries an empty draft list — otherwise re-opening
      // the character would recreate them as duplicates.
      const embedded: BuilderState = { ...state, companionDrafts: [] };
      const build = { ...base, _pathwayBuild: embedded } as unknown as PathbuilderBuild;
      const result = editCharKey
        ? await updateCharacterFromBuild({ userId: user.id, charKey: editCharKey, build })
        : await createCharacterFromBuild({ userId: user.id, build });

      // Flush companion drafts into the companions table now that the character
      // exists. Best-effort per draft: one failure shouldn't lose the others or
      // the character save itself.
      for (const draft of state.companionDrafts ?? []) {
        try {
          await saveCompanion({ userId: user.id, charKey: result.char_key, ...draft });
        } catch (e) {
          console.error('companion draft save failed:', draft.displayName, e);
        }
      }

      // Persist the builder portrait to Storage → the character's `art`. This
      // is best-effort: the character is already saved, so a portrait failure
      // must not fail the whole save.
      if (state.portrait?.startsWith('data:')) {
        try {
          const blob = await (await fetch(state.portrait)).blob();
          const file = new File([blob], 'portrait.jpg', { type: blob.type || 'image/jpeg' });
          await uploadCharacterPortrait({ userId: user.id, charKey: result.char_key, file });
        } catch {
          /* portrait upload is optional — ignore */
        }
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['character'] });
      qc.invalidateQueries({ queryKey: ['companions'] });
    },
  });
}
