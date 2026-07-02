import { useQuery } from '@tanstack/react-query';
import { fetchSpellsByNames } from './api';

/**
 * Hydrate a list of spell names into their reference rows. Skipped when the
 * list is empty. Cache key is the sorted deduped name list so different
 * characters with different spell repertoires each get their own entry.
 */
export function useSpellsByNames(names: string[]) {
  const sorted = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort();
  return useQuery({
    queryKey: ['spells-by-names', sorted],
    queryFn: () => fetchSpellsByNames(sorted),
    enabled: sorted.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
