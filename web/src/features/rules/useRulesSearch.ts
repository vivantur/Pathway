import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchRules } from './api';
import type { RuleCategoryId } from './types';

/**
 * Debounced search of one reference category. The query is debounced ~250ms so
 * we don't fire a request per keystroke; react-query then caches per
 * (category, debounced query) with a long stale time since reference data is
 * effectively static.
 */
export function useRulesSearch(category: RuleCategoryId, query: string) {
  const debounced = useDebounced(query, 250);
  return useQuery({
    queryKey: ['rules', category, debounced.trim().toLowerCase()],
    queryFn: () => searchRules({ category, query: debounced }),
    staleTime: 10 * 60 * 1000,
  });
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
