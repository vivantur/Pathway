import { useQuery } from '@tanstack/react-query';
import { fetchPublicCharacterByShareId } from './api';

/**
 * Load a character by its public share UUID. Public — no auth required. RLS
 * scopes to `is_public = true` so revoked shares silently return null.
 */
export function usePublicCharacter(shareId: string | undefined) {
  const cleaned = (shareId ?? '').trim();
  return useQuery({
    queryKey: ['public-character', cleaned],
    queryFn: () => fetchPublicCharacterByShareId(cleaned),
    enabled: cleaned.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
