import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { fetchMyCharacters } from './api';

export const charactersKey = (userId: string | undefined) =>
  ['characters', 'mine', userId] as const;

/**
 * Loads the signed-in user's characters via RLS. Disabled until there is a
 * user, so we never fire an unauthenticated query.
 */
export function useMyCharacters() {
  const { user } = useAuth();
  return useQuery({
    queryKey: charactersKey(user?.id),
    queryFn: fetchMyCharacters,
    enabled: Boolean(user),
  });
}
