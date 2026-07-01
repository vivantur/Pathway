import { requireSupabase } from '@/lib/supabase';
import { preferRemaster } from '@/features/characters/pf2eData/sourcePreference';
import type { RuleCategoryId, RuleEntry } from './types';

/**
 * Registry of searchable reference categories. Each entry knows its table, a
 * human label, and a mapper from a raw row → the normalized RuleEntry. All
 * mappers read defensively (tables have different, partly-unaudited shapes),
 * so a missing column just yields null/empty rather than breaking.
 *
 * These tables are public reference data (RLS disabled or a public-read
 * policy), so the Rules Library works for anonymous visitors too.
 */
interface CategoryConfig {
  id: RuleCategoryId;
  label: string;
  table: string;
  /** Whether rows carry a meaningful `level` we can sort/show. */
  hasLevel: boolean;
  map: (row: Record<string, unknown>) => RuleEntry;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v : typeof v === 'number' ? String(v) : null;

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter((s) => s.trim().length > 0) : [];

const num = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;

export const RULE_CATEGORIES: CategoryConfig[] = [
  {
    id: 'feats',
    label: 'Feats',
    table: 'feats',
    hasLevel: true,
    map: (r) => ({
      id: String(r.id),
      name: str(r.name) ?? 'Unknown',
      category: 'feats',
      level: num(r.level),
      rarity: str(r.rarity),
      traits: arr(r.traits),
      actionCost: str(r.action_cost),
      prerequisites: str(r.prerequisites),
      trigger: str(r.trigger),
      description: str(r.description),
      aonUrl: str(r.aon_url),
      meta: [
        str(r.feat_type) ? { label: 'Type', value: str(r.feat_type)! } : null,
        str(r.source) ? { label: 'Source', value: str(r.source)! } : null,
      ].filter(Boolean) as RuleEntry['meta'],
    }),
  },
  {
    id: 'spells',
    label: 'Spells',
    table: 'spells',
    hasLevel: true,
    map: (r) => ({
      id: String(r.id),
      name: str(r.name) ?? 'Unknown',
      category: 'spells',
      level: num(r.rank) ?? num(r.level) ?? num(r.spell_level),
      rarity: str(r.rarity),
      traits: arr(r.traits),
      actionCost: str(r.actions) ?? str(r.action_cost),
      prerequisites: null,
      trigger: str(r.trigger),
      description: str(r.description),
      aonUrl: str(r.aon_url),
      meta: [
        str(r.range) ? { label: 'Range', value: str(r.range)! } : null,
        str(r.area) ? { label: 'Area', value: str(r.area)! } : null,
        str(r.targets) ? { label: 'Targets', value: str(r.targets)! } : null,
        str(r.saving_throw) ?? str(r.save) ? { label: 'Save', value: (str(r.saving_throw) ?? str(r.save))! } : null,
        str(r.duration) ? { label: 'Duration', value: str(r.duration)! } : null,
        str(r.source) ? { label: 'Source', value: str(r.source)! } : null,
      ].filter(Boolean) as RuleEntry['meta'],
    }),
  },
  {
    id: 'items',
    label: 'Items',
    table: 'items',
    hasLevel: true,
    map: (r) => ({
      id: String(r.id),
      name: str(r.name) ?? 'Unknown',
      category: 'items',
      level: num(r.level),
      rarity: str(r.rarity),
      traits: arr(r.traits),
      actionCost: null,
      prerequisites: null,
      trigger: null,
      description: str(r.description),
      aonUrl: str(r.aon_url),
      meta: [
        str(r.price) ? { label: 'Price', value: str(r.price)! } : null,
        str(r.bulk) ? { label: 'Bulk', value: str(r.bulk)! } : null,
        str(r.usage) ? { label: 'Usage', value: str(r.usage)! } : null,
        str(r.item_type) ?? str(r.category) ? { label: 'Type', value: (str(r.item_type) ?? str(r.category))! } : null,
        str(r.source) ? { label: 'Source', value: str(r.source)! } : null,
      ].filter(Boolean) as RuleEntry['meta'],
    }),
  },
  {
    id: 'conditions',
    label: 'Conditions',
    table: 'conditions',
    hasLevel: false,
    map: (r) => ({
      id: String(r.id),
      name: str(r.name) ?? 'Unknown',
      category: 'conditions',
      level: null,
      rarity: str(r.rarity),
      traits: arr(r.traits),
      actionCost: null,
      prerequisites: null,
      trigger: null,
      description: str(r.description),
      aonUrl: str(r.aon_url),
      meta: [str(r.source) ? { label: 'Source', value: str(r.source)! } : null].filter(
        Boolean,
      ) as RuleEntry['meta'],
    }),
  },
  {
    id: 'ancestries',
    label: 'Ancestries',
    table: 'ancestries',
    hasLevel: false,
    map: (r) => ({
      id: String(r.id),
      name: str(r.name) ?? 'Unknown',
      category: 'ancestries',
      level: null,
      rarity: str(r.rarity),
      traits: arr(r.traits),
      actionCost: null,
      prerequisites: null,
      trigger: null,
      description: str(r.description),
      aonUrl: str(r.aon_url),
      meta: [
        num(r.hp) != null ? { label: 'HP', value: String(num(r.hp)) } : null,
        str(r.size) ? { label: 'Size', value: str(r.size)! } : null,
        num(r.speed) != null ? { label: 'Speed', value: `${num(r.speed)} ft.` } : null,
        str(r.source) ? { label: 'Source', value: str(r.source)! } : null,
      ].filter(Boolean) as RuleEntry['meta'],
    }),
  },
  {
    id: 'backgrounds',
    label: 'Backgrounds',
    table: 'backgrounds',
    hasLevel: false,
    map: (r) => ({
      id: String(r.id),
      name: str(r.name) ?? 'Unknown',
      category: 'backgrounds',
      level: null,
      rarity: str(r.rarity),
      traits: arr(r.traits),
      actionCost: null,
      prerequisites: null,
      trigger: null,
      description: str(r.description),
      aonUrl: str(r.aon_url),
      meta: [str(r.source) ? { label: 'Source', value: str(r.source)! } : null].filter(
        Boolean,
      ) as RuleEntry['meta'],
    }),
  },
];

export function categoryById(id: RuleCategoryId): CategoryConfig {
  return RULE_CATEGORIES.find((c) => c.id === id) ?? RULE_CATEGORIES[0];
}

const PAGE_SIZE = 60;

/**
 * Search (or browse) one reference category. Empty query → browse the first
 * page ordered by level then name (or just name for level-less categories).
 * Non-empty query → case-insensitive name match. Results run through
 * preferRemaster so Legacy/Remaster twins collapse.
 */
export async function searchRules(input: {
  category: RuleCategoryId;
  query: string;
}): Promise<RuleEntry[]> {
  const cfg = categoryById(input.category);
  const supabase = requireSupabase();
  const q = input.query.trim();

  let builder = supabase.from(cfg.table).select('*');
  if (q.length > 0) builder = builder.ilike('name', `%${q}%`);
  if (cfg.hasLevel) builder = builder.order('level', { ascending: true });
  builder = builder.order('name', { ascending: true }).limit(PAGE_SIZE);

  const { data, error } = await builder;
  if (error) throw error;

  const mapped = ((data ?? []) as Array<Record<string, unknown>>).map(cfg.map);
  return preferRemaster(
    mapped.map((m) => ({ ...m, source: sourceFromMeta(m) })),
  ).map(stripSourceHelper);
}

/** preferRemaster needs a `source` field; pull it from meta for the dedupe. */
function sourceFromMeta(entry: RuleEntry): string | null {
  return entry.meta.find((m) => m.label === 'Source')?.value ?? null;
}
function stripSourceHelper(entry: RuleEntry & { source?: string | null }): RuleEntry {
  const { source: _source, ...rest } = entry;
  void _source;
  return rest;
}
