import { useQuery } from '@tanstack/react-query';
import { searchSpellsForPicker, type SpellPickResult } from './api';

/**
 * Debounce-friendly spell name search for the sheet's "add a spell" picker.
 * Disabled until the query is at least 2 chars so we don't fire on every
 * keystroke; results are cached briefly since the archive is static.
 */
export function useSpellSearch(query: string) {
  const q = query.trim();
  return useQuery<SpellPickResult[]>({
    queryKey: ['spell-search', q.toLowerCase()],
    queryFn: () => searchSpellsForPicker(q),
    enabled: q.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
}
