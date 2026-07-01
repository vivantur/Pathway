import { useQuery } from '@tanstack/react-query';
import { fetchClassBundle } from './api';

/**
 * Class-tab data: the class row from gamedata + level-eligible class
 * features + level-eligible class feats. One bundled query so the tab
 * renders in a single shot.
 */
export function useClassBundle(input: {
  className: string | null | undefined;
  characterLevel: number | null | undefined;
}) {
  const name = (input.className ?? '').trim();
  const level = input.characterLevel ?? 1;

  return useQuery({
    queryKey: ['class-bundle', name.toLowerCase(), level],
    queryFn: () => fetchClassBundle({ className: name, characterLevel: level }),
    enabled: name.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
