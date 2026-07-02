import { useQuery } from '@tanstack/react-query';
import { fetchAncestryBundle } from './api';

/**
 * Ancestry tab data: the ancestry row + its heritages + level-eligible
 * ancestry feats. One bundled query so the tab renders in one shot.
 */
export function useAncestryBundle(input: {
  ancestryName: string | null | undefined;
  characterLevel: number | null | undefined;
}) {
  const name = (input.ancestryName ?? '').trim();
  const level = input.characterLevel ?? 1;

  return useQuery({
    queryKey: ['ancestry-bundle', name.toLowerCase(), level],
    queryFn: () => fetchAncestryBundle({ ancestryName: name, characterLevel: level }),
    enabled: name.length > 0,
    staleTime: 5 * 60 * 1000, // reference data doesn't move
  });
}
