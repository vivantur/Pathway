import { requireSupabase } from '@/lib/supabase';
import { preferRemaster } from '@/features/characters/pf2eData/sourcePreference';
import {
  coerceSpellRow,
  formatActionCost,
  formatDefenses,
} from '@/features/characters/pf2eData/spellFromRow';
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
  /**
   * When set, this category is backed by the generic `gamedata` table filtered
   * to this `category` value (rather than its own typed table). The row shape
   * is `{ id, category, slug, name, data }` with the payload inside `data`.
   */
  gamedataCategory?: string;
  map: (row: Record<string, unknown>) => RuleEntry;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v : typeof v === 'number' ? String(v) : null;

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter((s) => s.trim().length > 0) : [];

/** Like `arr`, but also accepts a plain string (wrapped as a single item). */
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map(String).map((s) => s.trim()).filter(Boolean)
    : typeof v === 'string' && v.trim().length > 0
      ? [v.trim()]
      : [];

const num = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;

/** Read a number out of a jsonb object by trying several key spellings. */
function jnum(obj: unknown, ...keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const n = num(rec[k]);
    if (n != null) return n;
  }
  return null;
}

const fmtMod = (n: number | null): string | null => (n == null ? null : n >= 0 ? `+${n}` : `${n}`);

/** Format the monster `speed` jsonb — number, string, or {land/fly/swim: n}. */
function formatSpeed(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number') return `${v} ft.`;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, val] of Object.entries(rec)) {
      const n = num(val);
      if (n == null) continue;
      const key = k.toLowerCase();
      parts.push(key === 'land' || key === 'walk' ? `${n} ft.` : `${k} ${n} ft.`);
    }
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

/** Extract STR…CHA modifiers from the monster `ability_modifiers` jsonb. */
function abilityMods(v: unknown): Array<{ label: string; value: string }> {
  const order: Array<[string, string]> = [
    ['STR', 'str'], ['DEX', 'dex'], ['CON', 'con'],
    ['INT', 'int'], ['WIS', 'wis'], ['CHA', 'cha'],
  ];
  const out: Array<{ label: string; value: string }> = [];
  for (const [label, key] of order) {
    const mod = fmtMod(jnum(v, key, key.toUpperCase()));
    if (mod != null) out.push({ label, value: mod });
  }
  return out;
}

const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Strip AoN's markdown italic underscores from a name (`_dagger_` → `dagger`). */
const cleanName = (s: string): string => s.replace(/^_+/, '').replace(/_+$/, '').trim();

/** Turn a broken markdown-link trait (`[auditory](/Traits…`) into its label. */
const cleanTrait = (t: string): string => {
  const m = t.match(/^\[([^\]]+)\]/);
  return (m ? m[1] : t).trim();
};

/**
 * The AoN import concatenates the *next* stat-block section into an ability's
 * description (Insightful's text bleeds into Items/AC/HP; Objection! bleeds
 * into Speed/Melee). Truncate at the earliest bleed marker to recover just
 * the ability text.
 */
function cleanAbilityDescription(s: string): string {
  if (!s) return s;
  const markers = [
    '\n\n---', '\n\nItems\n', '\n\nItems ', '\n\nSpeed ', '\n\nSpeed\n',
    '\n\nMelee\n', '\n\nMelee ', '\n\nRanged\n', '\n\nRanged ', '\n\nAC ', '\n\nHP ',
  ];
  let cut = s.length;
  for (const m of markers) {
    const idx = s.indexOf(m);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  return s.slice(0, cut).trim();
}

/** Skills jsonb ({ Deception: 20, … }) → sorted [{label, value:"+20"}]. */
function monsterSkills(v: unknown): Array<{ label: string; value: string }> {
  return Object.entries(asObj(v))
    .map(([label, val]) => ({ label, value: fmtMod(num(val)) }))
    .filter((s): s is { label: string; value: string } => s.value != null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Attacks jsonb → typed attack rows. */
function monsterAttacks(v: unknown): import('./types').MonsterAttack[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const a = asObj(raw);
    return {
      name: cleanName(str(a.name) ?? ''),
      kind: capitalize(str(a.type) ?? ''),
      toHit: fmtMod(num(a.to_hit)),
      damage: str(a.damage),
      traits: arr(a.traits).map(cleanTrait),
    };
  });
}

/** `abilities.{top,mid,bot}` groups → a flat, cleaned list of special abilities. */
function monsterAbilities(v: unknown): import('./types').MonsterAbility[] {
  const groups = asObj(v);
  const out: import('./types').MonsterAbility[] = [];
  for (const key of ['top', 'mid', 'bot']) {
    const list = groups[key];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const a = asObj(raw);
      const name = str(a.name);
      if (!name) continue;
      out.push({
        name,
        actionCost: str(a.action_cost),
        traits: arr(a.traits).map(cleanTrait),
        description: cleanAbilityDescription(str(a.description) ?? ''),
      });
    }
  }
  return out;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

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
    // Interpretation runs through @pathway/core's coerceSpell (one reader shared
    // with the bot), leaving only display passthroughs (trigger, aon_url) as raw
    // reads. An uncoercible row still shows name + description via the fallback.
    map: (r) => {
      const spell = coerceSpellRow(r);
      if (!spell) {
        return {
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
          meta: [],
        };
      }
      const save = formatDefenses(spell.defenses);
      const source = spell.source.page
        ? `${spell.source.title} pg. ${spell.source.page}`
        : spell.source.title;
      return {
        id: String(r.id),
        name: spell.name,
        category: 'spells',
        level: spell.rank,
        rarity: spell.rarity,
        traits: spell.traits,
        actionCost: formatActionCost(spell.actionCost),
        prerequisites: null,
        trigger: str(r.trigger),
        description: spell.description,
        aonUrl: str(r.aon_url),
        meta: [
          spell.range ? { label: 'Range', value: spell.range } : null,
          spell.area ? { label: 'Area', value: spell.area } : null,
          spell.targets ? { label: 'Targets', value: spell.targets } : null,
          save ? { label: 'Defense', value: save } : null,
          spell.duration ? { label: 'Duration', value: spell.duration } : null,
          { label: 'Source', value: source },
        ].filter(Boolean) as RuleEntry['meta'],
      };
    },
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
    id: 'monsters',
    label: 'Monsters',
    table: 'monsters',
    hasLevel: true,
    map: (r) => {
      // The richest, cleanest data lives in monster_metadata.rich for
      // AoN-imported monsters; fall back to the top-level columns for
      // homebrew that may only have those. Image + AoN url live only in
      // monster_metadata.
      const md = asObj(r.monster_metadata);
      const rich = asObj(md.rich);
      const richDef = asObj(rich.defenses);
      const savesSrc = asObj(richDef.saves ?? r.saving_throws);
      const pick = <T,>(a: T, b: T): T =>
        a != null && !(Array.isArray(a) && a.length === 0) ? a : b;

      const attacksSrc = pick(rich.attacks, r.attacks);
      const abilitiesSrc = pick(rich.abilities, r.abilities);
      const abilityModSrc = pick(rich.ability_modifiers, r.ability_modifiers);

      return {
        id: String(r.id),
        name: str(r.name) ?? 'Unknown',
        category: 'monsters',
        level: num(r.level) ?? jnum(md, 'level'),
        rarity: str(r.rarity),
        traits: arr(r.traits),
        actionCost: null,
        prerequisites: null,
        trigger: null,
        description: str(r.description) ?? str(rich.description),
        aonUrl: str(md.aon_url),
        meta: [
          str(r.creature_type) ? { label: 'Type', value: str(r.creature_type)! } : null,
          str(md.family) ? { label: 'Family', value: str(md.family)! } : null,
          str(md.source) ?? str(r.source)
            ? { label: 'Source', value: (str(md.source) ?? str(r.source))! }
            : null,
        ].filter(Boolean) as RuleEntry['meta'],
        statBlock: {
          imageUrl: str(md.image),
          aonUrl: str(md.aon_url),
          ac: num(r.ac) != null ? String(num(r.ac)) : jnum(richDef, 'ac') != null ? String(jnum(richDef, 'ac')) : null,
          hp: num(r.hp) != null ? String(num(r.hp)) : jnum(richDef, 'hp') != null ? String(jnum(richDef, 'hp')) : null,
          fort: fmtMod(jnum(savesSrc, 'fortitude', 'fort')),
          ref: fmtMod(jnum(savesSrc, 'reflex', 'ref')),
          will: fmtMod(jnum(savesSrc, 'will')),
          perception: fmtMod(num(r.perception) ?? jnum(rich, 'perception')),
          immunities: pick(arr(richDef.immunities), arr(r.immunities)),
          resistances: pick(arr(richDef.resistances), arr(r.resistances)),
          weaknesses: pick(arr(richDef.weaknesses), arr(r.weaknesses)),
          speed: formatSpeed(pick(rich.speed, r.speed)),
          size: str(r.size),
          senses: arr(rich.senses),
          languages: pick(arr(rich.languages), arr(r.languages)),
          abilities: abilityMods(abilityModSrc),
          skills: monsterSkills(rich.skills),
          items: arr(rich.items),
          attacks: monsterAttacks(attacksSrc),
          specialAbilities: monsterAbilities(abilitiesSrc),
        },
      };
    },
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
  // ---- gamedata-backed categories (generic AoN import keyed by `category`) ----
  { id: 'classes', label: 'Classes', table: 'gamedata', gamedataCategory: 'classes', hasLevel: false, map: gamedataMap('classes') },
  { id: 'archetypes', label: 'Archetypes', table: 'gamedata', gamedataCategory: 'archetypes', hasLevel: false, map: gamedataMap('archetypes') },
  { id: 'heritages', label: 'Heritages', table: 'gamedata', gamedataCategory: 'heritages', hasLevel: false, map: gamedataMap('heritages') },
  { id: 'actions', label: 'Actions', table: 'gamedata', gamedataCategory: 'actions', hasLevel: false, map: gamedataMap('actions') },
  { id: 'rituals', label: 'Rituals', table: 'gamedata', gamedataCategory: 'rituals', hasLevel: false, map: gamedataMap('rituals') },
  { id: 'hazards', label: 'Hazards', table: 'gamedata', gamedataCategory: 'hazards', hasLevel: false, map: gamedataMap('hazards') },
  { id: 'afflictions', label: 'Afflictions', table: 'gamedata', gamedataCategory: 'afflictions', hasLevel: false, map: gamedataMap('afflictions') },
  { id: 'deities', label: 'Deities', table: 'gamedata', gamedataCategory: 'deities', hasLevel: false, map: deityMap },
  { id: 'domains', label: 'Domains', table: 'gamedata', gamedataCategory: 'domains', hasLevel: false, map: gamedataMap('domains') },
  { id: 'familiars', label: 'Familiars', table: 'gamedata', gamedataCategory: 'familiars', hasLevel: false, map: gamedataMap('familiars') },
  { id: 'relics', label: 'Relics', table: 'gamedata', gamedataCategory: 'relics', hasLevel: false, map: gamedataMap('relics') },
  { id: 'planes', label: 'Planes', table: 'gamedata', gamedataCategory: 'planes', hasLevel: false, map: gamedataMap('planes') },
  { id: 'languages', label: 'Languages', table: 'gamedata', gamedataCategory: 'languages', hasLevel: false, map: gamedataMap('languages') },
  { id: 'skills', label: 'Skills', table: 'gamedata', gamedataCategory: 'skills', hasLevel: false, map: gamedataMap('skills') },
  { id: 'traits', label: 'Traits', table: 'gamedata', gamedataCategory: 'traits', hasLevel: false, map: gamedataMap('traits') },
  { id: 'rules', label: 'Rules', table: 'gamedata', gamedataCategory: 'rules', hasLevel: false, map: gamedataMap('rules') },
  { id: 'sources', label: 'Source Books', table: 'gamedata', gamedataCategory: 'sources', hasLevel: false, map: gamedataMap('sources') },
];

/**
 * Shared mapper for gamedata-backed categories. The payload lives in `data`
 * with a fairly uniform AoN shape across categories (name, description/summary,
 * level, traits, rarity, source, aon_url, plus action/prereq/trigger extras),
 * so one defensive mapper covers them all.
 */
function gamedataMap(category: RuleCategoryId): CategoryConfig['map'] {
  return (row) => {
    const d = asObj(row.data);
    return {
      id: String(row.id),
      name: str(row.name) ?? str(d.name) ?? 'Unknown',
      category,
      level: num(d.level),
      rarity: str(d.rarity),
      traits: arr(d.traits),
      actionCost: str(d.actions) ?? str(d.action_type),
      prerequisites: str(d.prerequisites) ?? str(d.prerequisite),
      trigger: str(d.trigger),
      description: str(d.description) ?? str(d.summary),
      aonUrl: str(d.aon_url),
      meta: [
        str(d.frequency) ? { label: 'Frequency', value: str(d.frequency)! } : null,
        str(d.requirements) ? { label: 'Requirements', value: str(d.requirements)! } : null,
        str(d.source) ? { label: 'Source', value: str(d.source)! } : null,
      ].filter(Boolean) as RuleEntry['meta'],
    };
  };
}

/** Deity mapper — surfaces the structured devotee fields as a deityBlock. */
function deityMap(row: Record<string, unknown>): RuleEntry {
  const d = asObj(row.data);
  return {
    id: String(row.id),
    name: str(row.name) ?? str(d.name) ?? 'Unknown',
    category: 'deities',
    level: num(d.level),
    rarity: str(d.rarity),
    traits: arr(d.traits),
    actionCost: null,
    prerequisites: null,
    trigger: null,
    description: str(d.description) ?? str(d.summary),
    aonUrl: str(d.aon_url),
    meta: [
      str(d.epithet) ? { label: 'Epithet', value: str(d.epithet)! } : null,
      list(d.pantheons).length ? { label: 'Pantheon', value: list(d.pantheons).join(', ') } : null,
      str(d.source) ? { label: 'Source', value: str(d.source)! } : null,
    ].filter(Boolean) as RuleEntry['meta'],
    deityBlock: {
      imageUrl: str(d.image),
      edicts: list(d.edicts),
      anathema: list(d.anathemas),
      areasOfConcern: list(d.areas_of_concern).join(', ') || null,
      followerAlignments: list(d.follower_alignments),
      alignment: str(d.alignment),
      sanctification: str(d.sanctification),
      divineFont: str(d.divine_font),
      divineSkill: str(d.divine_skill),
      divineAttributes: list(d.attributes),
      favoredWeapon: str(d.favored_weapon),
      domains: list(d.domains),
      alternateDomains: list(d.alternate_domains),
      clericSpells: list(d.cleric_spells).join(', ') || null,
    },
  };
}

export function categoryById(id: RuleCategoryId): CategoryConfig {
  return RULE_CATEGORIES.find((c) => c.id === id) ?? RULE_CATEGORIES[0];
}

/**
 * Category groupings for the library's picker, so 24 sections read as a few
 * scannable clusters instead of one long wrapping row. Every category id
 * appears in exactly one group.
 */
export const RULE_CATEGORY_GROUPS: Array<{ label: string; ids: RuleCategoryId[] }> = [
  {
    label: 'Character Options',
    ids: ['ancestries', 'heritages', 'backgrounds', 'classes', 'archetypes', 'feats'],
  },
  { label: 'Spells & Rituals', ids: ['spells', 'rituals', 'domains'] },
  { label: 'Equipment', ids: ['items', 'relics'] },
  {
    label: 'Actions & Rules',
    ids: ['actions', 'conditions', 'traits', 'skills', 'rules', 'languages'],
  },
  { label: 'Bestiary', ids: ['monsters', 'hazards', 'afflictions', 'familiars'] },
  { label: 'World & Lore', ids: ['deities', 'planes', 'sources'] },
];

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

  let builder = cfg.gamedataCategory
    ? supabase
        .from('gamedata')
        .select('id, category, slug, name, data')
        .eq('category', cfg.gamedataCategory)
    : supabase.from(cfg.table).select('*');
  // Escape LIKE wildcards (% _ \) in the user's query so they match literally
  // instead of acting as pattern metacharacters.
  if (q.length > 0) builder = builder.ilike('name', `%${q.replace(/[\\%_]/g, '\\$&')}%`);
  // gamedata keeps `level` inside the jsonb payload, so we can only order by
  // the top-level name column there; typed tables can also sort by level.
  if (cfg.hasLevel && !cfg.gamedataCategory) builder = builder.order('level', { ascending: true });
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
