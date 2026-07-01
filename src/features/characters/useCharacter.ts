import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { fetchCharacterByKey } from './api';

export const characterKey = (userId: string | undefined, charKey: string) =>
  ['character', userId, charKey] as const;

/** Load one owned character by its char_key. Skips fetching while signed out. */
export function useCharacter(charKey: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: characterKey(user?.id, charKey ?? ''),
    queryFn: () => fetchCharacterByKey(charKey!, user!.id),
    enabled: Boolean(user && charKey),
  });
}
