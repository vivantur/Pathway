import { useQuery } from '@tanstack/react-query';
import { fetchFeatsByNames } from './api';

/**
 * Hydrate a list of feat names into their reference rows. Skipped when the
 * list is empty. React-query key includes the sorted name list so different
 * characters' feat sets each get their own cache entry.
 */
export function useFeatsByNames(names: string[]) {
  const sorted = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort();
  return useQuery({
    queryKey: ['feats-by-names', sorted],
    queryFn: () => fetchFeatsByNames(sorted),
    enabled: sorted.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
