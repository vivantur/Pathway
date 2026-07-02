import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { fetchCharacterNotes } from './api';

export const notesKey = (userId: string | undefined, charKey: string) =>
  ['character-notes', userId, charKey] as const;

/** Load the note list for one character. Skipped while signed out. */
export function useCharacterNotes(charKey: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: notesKey(user?.id, charKey ?? ''),
    queryFn: () => fetchCharacterNotes(charKey!),
    enabled: Boolean(user && charKey),
  });
}
