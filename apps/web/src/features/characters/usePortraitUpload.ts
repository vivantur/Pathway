import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadCharacterPortrait } from './api';
import { characterKey } from './useCharacter';
import { useAuth } from '@/features/auth/useAuth';

/**
 * Upload a portrait for one character. On success, invalidates the character
 * cache so the sheet re-fetches and picks up the new `art` URL (and the vault
 * card, if it ever ends up rendering portraits).
 */
export function usePortraitUpload(charKey: string) {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error('You need to be signed in.');
      return uploadCharacterPortrait({ userId: user.id, charKey, file });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: characterKey(user?.id, charKey) });
      qc.invalidateQueries({ queryKey: ['characters'] });
    },
  });
}
