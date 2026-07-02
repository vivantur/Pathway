import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RULE_CATEGORIES, searchRules } from '@/features/rules/api';
import type { RuleEntry } from '@/features/rules/types';
import { useMyCharacters } from '@/features/characters/useCharacters';
import type { CharacterSummary } from '@/features/characters/types';

export interface SearchHit {
  key: string;
  group: string;
  name: string;
  subtitle?: string;
  to: string;
}

export interface SearchGroup {
  group: string;
  hits: SearchHit[];
}

const PER_CATEGORY = 5;
const MIN_CHARS = 2;

/**
 * Fan-out global search: queries every Rules-Library category in parallel and
 * filters the signed-in user's own characters, then merges the results into
 * ordered groups (Characters first, then rule categories). Campaigns, homebrew,
 * organizations, etc. slot in here as those systems land.
 */
export function useGlobalSearch(query: string) {
  const q = query.trim();
  const enabled = q.length >= MIN_CHARS;

  const rulesQuery = useQuery<SearchHit[]>({
    queryKey: ['global-search', 'rules', q.toLowerCase()],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const perCategory = await Promise.all(
        RULE_CATEGORIES.map(async (c) => {
          try {
            const entries = await searchRules({ category: c.id, query: q });
            return entries.slice(0, PER_CATEGORY).map(
              (e): SearchHit => ({
                key: `${c.id}-${e.id}`,
                group: c.label,
                name: e.name,
                subtitle: ruleSubtitle(e),
                to: `/rules?cat=${c.id}&q=${encodeURIComponent(e.name)}`,
              }),
            );
          } catch {
            return [];
          }
        }),
      );
      return perCategory.flat();
    },
  });

  const { data: characters } = useMyCharacters();
  const characterHits = useMemo<SearchHit[]>(() => {
    if (!enabled || !characters) return [];
    const ql = q.toLowerCase();
    return characters
      .filter((c: CharacterSummary) => (c.name ?? '').toLowerCase().includes(ql))
      .slice(0, 6)
      .map((c: CharacterSummary) => ({
        key: `char-${c.char_key}`,
        group: 'Characters',
        name: c.name,
        subtitle:
          [c.class_name, c.level != null ? `Lvl ${c.level}` : null]
            .filter(Boolean)
            .join(' · ') || undefined,
        to: `/vault/${encodeURIComponent(c.char_key)}`,
      }));
  }, [characters, q, enabled]);

  const grouped = useMemo<SearchGroup[]>(() => {
    const hits = [...characterHits, ...(rulesQuery.data ?? [])];
    const order = ['Characters', ...RULE_CATEGORIES.map((c) => c.label)];
    const byGroup = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const list = byGroup.get(h.group) ?? [];
      list.push(h);
      byGroup.set(h.group, list);
    }
    return order
      .filter((g) => byGroup.has(g))
      .map((g) => ({ group: g, hits: byGroup.get(g)! }));
  }, [characterHits, rulesQuery.data]);

  const flat = useMemo(() => grouped.flatMap((g) => g.hits), [grouped]);

  return { grouped, flat, isLoading: enabled && rulesQuery.isFetching, enabled };
}

function ruleSubtitle(e: RuleEntry): string | undefined {
  const parts: string[] = [];
  if (e.level != null) {
    parts.push(e.category === 'spells' && e.level === 0 ? 'Cantrip' : `Lvl ${e.level}`);
  }
  if (e.traits[0]) parts.push(e.traits[0]);
  return parts.join(' · ') || undefined;
}
