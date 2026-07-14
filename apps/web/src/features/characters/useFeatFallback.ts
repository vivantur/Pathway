import { useQuery } from '@tanstack/react-query';
import type { Ancestry, Feat, Heritage } from '@/features/builder/data';
import type { FeatRow } from './types';

/**
 * Fallback feat/heritage hydration from the app's own enriched builder dataset.
 *
 * The sheet's Feats tab hydrates each feat by name from the Supabase `feats`
 * reference table (an older scrape). When a name isn't in that table — legacy
 * content it never had, or a heritage exported into the feats list (Pathbuilder
 * lists the heritage there) — the card renders "no reference entry".
 *
 * The builder dataset (`data/*.json`) is the app's canonical, fully-enriched
 * corpus (every feat and heritage carries a description) and usually HAS those
 * definitions, so we fall back to it. Two lookups are provided:
 *
 *   - exact name (lowercased), and
 *   - BASE name — the Foundry corpus disambiguates same-named feats with a
 *     `(Class)`/`(Ancestry)` suffix ("Blessed Blood (Sorcerer)"), but Pathbuilder
 *     exports the bare name ("Blessed Blood"). We strip the suffix and, when more
 *     than one feat shares a base, disambiguate with the character's class /
 *     ancestry / heritage names.
 *
 * Only the feat chunk plus the (small) heritage sources are imported — not the
 * whole dataset — and only when there is at least one unmatched name, so most
 * sheet visits pay nothing. The index is built once and cached for the session.
 */

export interface FallbackIndex {
  /** Exact lowercased name → row. */
  byName: Map<string, FeatRow>;
  /** Suffix-stripped lowercased base name → all rows sharing it. */
  byBase: Map<string, FeatRow[]>;
}

let cached: FallbackIndex | null = null;

const stripSuffix = (name: string): string => name.replace(/\s*\([^)]+\)\s*$/, '').trim();
const suffixOf = (name: string): string | null => {
  const m = /\(([^)]+)\)\s*$/.exec(name);
  return m ? m[1]!.trim().toLowerCase() : null;
};

function featToRow(f: Feat): FeatRow {
  return {
    id: f.id,
    name: f.name,
    description: f.description ?? null,
    feat_type: f.type ?? null,
    level: f.level ?? null,
    traits: f.traits ?? null,
    prerequisites: f.prerequisites ?? null,
    action_cost: f.actionCost ?? null,
    trigger: null,
    rarity: f.rarity ?? null,
    source: f.source ?? null,
    aon_id: null,
    aon_url: null,
  };
}

function heritageToRow(h: Heritage): FeatRow {
  return {
    id: h.id,
    name: h.name,
    description: h.description ?? null,
    feat_type: 'heritage',
    level: 1,
    traits: null,
    prerequisites: null,
    action_cost: null,
    trigger: null,
    rarity: h.versatile ? 'uncommon' : null,
    source: h.source ?? null,
    aon_id: null,
    aon_url: null,
  };
}

/** Build the name/base indices from a set of feat + heritage rows. Pure; exported for tests. */
export function buildFallbackIndex(rows: FeatRow[]): FallbackIndex {
  const byName = new Map<string, FeatRow>();
  const byBase = new Map<string, FeatRow[]>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, r);
    const base = stripSuffix(key);
    if (base !== key) {
      const list = byBase.get(base);
      if (list) list.push(r);
      else byBase.set(base, [r]);
    }
  }
  return { byName, byBase };
}

/**
 * Resolve one feat name against the fallback index. Tries the exact name, then
 * the suffix-stripped base name, disambiguating a shared base by matching a
 * candidate's `(suffix)` to one of `hints` (the character's class / ancestry /
 * heritage). Falls back to the unsuffixed canonical variant, then the first
 * candidate. Pure; exported for tests.
 */
export function resolveFallbackRow(
  index: FallbackIndex,
  name: string,
  hints: string[] = [],
): FeatRow | null {
  const key = name.trim().toLowerCase();
  const exact = index.byName.get(key);
  if (exact) return exact;

  const candidates = index.byBase.get(stripSuffix(key));
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const hintSet = new Set(hints.map((h) => h.trim().toLowerCase()).filter(Boolean));
  const hinted = candidates.find((c) => {
    const suf = suffixOf(c.name);
    return suf != null && hintSet.has(suf);
  });
  if (hinted) return hinted;

  // No hint matched: prefer the canonical (unsuffixed) variant, else the first.
  return candidates.find((c) => suffixOf(c.name) == null) ?? candidates[0]!;
}

async function loadFallbackIndex(): Promise<FallbackIndex> {
  if (cached) return cached;
  const [feats, versatile, ancestries] = await Promise.all([
    import('@/features/builder/data/feats.json').then((m) => m.default as unknown as Feat[]),
    import('@/features/builder/data/versatile-heritages.json').then((m) => m.default as unknown as Heritage[]),
    import('@/features/builder/data/ancestries.json').then((m) => m.default as unknown as Ancestry[]),
  ]);
  const rows: FeatRow[] = feats.map(featToRow);
  const seen = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  const addHeritage = (h: Heritage) => {
    const key = h.name.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      rows.push(heritageToRow(h));
    }
  };
  for (const h of versatile) addHeritage(h);
  for (const a of ancestries) for (const h of a.heritages ?? []) addHeritage(h);
  cached = buildFallbackIndex(rows);
  return cached;
}

/**
 * Returns the fallback index for hydrating feats the `feats` table doesn't
 * cover. Disabled (no import) when nothing is unmatched.
 */
export function useFeatFallback(unmatchedNames: string[]) {
  return useQuery({
    queryKey: ['feat-fallback-dataset'],
    queryFn: loadFallbackIndex,
    enabled: unmatchedNames.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
