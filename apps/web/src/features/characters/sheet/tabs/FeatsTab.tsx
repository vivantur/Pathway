import { useMemo, useState } from 'react';
import { safeHttpUrl } from "@/lib/safeUrl";
import type { ReactNode } from 'react';
import { GrimoireMarkdown } from '@/components/ui/GrimoireMarkdown';
import { Spinner } from '@/components/ui/Spinner';
import { useFeatsByNames } from '@/features/characters/useFeatsByNames';
import { useFeatFallback, resolveFallbackRow } from '@/features/characters/useFeatFallback';
import type { FeatRow } from '@/features/characters/types';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { Panel } from '../Sheet';
import { GrantedActions } from '../GrantedActions';
import { FeatsIcon } from '../icons';

/**
 * Feats tab — every feat the character has, hydrated with the reference
 * table so each card carries the full description, prereqs, traits, and
 * an Archive of Nethys link.
 *
 * Data flow:
 * 1. `build.feats` is a `[name, sourcebookRef, category, levelAcquired]`
 *    tuple array (Pathbuilder's shape). We turn it into one FeatEntry per
 *    tuple.
 * 2. All the names get batched into `useFeatsByNames`, one query.
 * 3. Merge: for each entry, find the FeatRow with the matching name
 *    (case-insensitive) and attach it. Entries without a match keep the
 *    name + level + category and render as a minimal card ("no reference
 *    entry found").
 * 4. Group by category (Ancestry / Class / General / Skill / Bonus /
 *    Archetype / Other). Category tabs at the top filter the list;
 *    "All" shows everything.
 */

type Entry = [name: string, sourceRef: string | null, category: string, levelAcquired: number];

interface FeatEntry {
  name: string;
  category: string;
  categoryKey: string;
  levelAcquired: number;
  row: FeatRow | null;
}

const CATEGORY_ORDER = ['Class', 'Ancestry', 'General', 'Skill', 'Archetype', 'Bonus', 'Heritage', 'Background', 'Other'] as const;

export function FeatsTab({ build }: { build: PathbuilderBuild }) {
  // Memoize so a new empty array on every render doesn't invalidate the
  // downstream useMemo dependencies (and their queries).
  const entries: Entry[] = useMemo(
    () => (build.feats ?? []) as unknown as Entry[],
    [build.feats],
  );

  const names = useMemo(() => entries.map((e) => e[0]).filter(Boolean), [entries]);
  const { data: rows, isLoading } = useFeatsByNames(names);

  // Names the reference table didn't cover — hydrate those from the app's own
  // enriched builder dataset (legacy feats it lacks, heritages exported into the
  // feats list, …). Only loads the dataset chunk when something is unmatched.
  const dbByLowerName = useMemo(() => {
    const m = new Map<string, FeatRow>();
    for (const r of rows ?? []) m.set(r.name.toLowerCase(), r);
    return m;
  }, [rows]);
  const unmatched = useMemo(
    () => names.filter((n) => !dbByLowerName.has(n.trim().toLowerCase())),
    [names, dbByLowerName],
  );
  const { data: fallback, isLoading: fallbackLoading } = useFeatFallback(unmatched);

  // Disambiguation hints for suffixed feats ("Blessed Blood (Sorcerer)").
  const hints = useMemo(
    () => [build.class, build.ancestry, build.heritage].filter((s): s is string => !!s),
    [build.class, build.ancestry, build.heritage],
  );

  const merged: FeatEntry[] = useMemo(() => {
    return entries.map(([name, , categoryRaw, levelAcquired]) => {
      const category = normalizeCategory(categoryRaw);
      const key = name.trim().toLowerCase();
      const row =
        dbByLowerName.get(key) ??
        (fallback ? resolveFallbackRow(fallback, name, hints) : null);
      return {
        name,
        category,
        categoryKey: category.toLowerCase(),
        levelAcquired: levelAcquired ?? 1,
        row,
      };
    });
  }, [entries, dbByLowerName, fallback, hints]);

  const [activeCategory, setActiveCategory] = useState<string>('All');

  const filtered = useMemo(() => {
    if (activeCategory === 'All') return merged;
    return merged.filter((m) => m.category === activeCategory);
  }, [merged, activeCategory]);

  const categoriesPresent = useMemo(() => {
    const set = new Set(merged.map((m) => m.category));
    return CATEGORY_ORDER.filter((c) => set.has(c));
  }, [merged]);

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <Panel title="Feats" icon={<FeatsIcon />}>
          <p className="py-8 text-center text-sm text-silver/50">
            This character has no feats recorded in their Pathbuilder build.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category filter row */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gold/20 bg-midnight-900/50 p-3">
        <span className="mr-1 text-[0.65rem] uppercase tracking-widest text-gold/70">
          Filter
        </span>
        <CategoryChip
          label="All"
          count={merged.length}
          active={activeCategory === 'All'}
          onClick={() => setActiveCategory('All')}
        />
        {categoriesPresent.map((c) => (
          <CategoryChip
            key={c}
            label={c}
            count={merged.filter((m) => m.category === c).length}
            active={activeCategory === c}
            onClick={() => setActiveCategory(c)}
          />
        ))}
      </div>

      {(isLoading || fallbackLoading) && (
        <div className="py-6">
          <Spinner label="Fetching feat details…" />
        </div>
      )}

      {/* Grouped list */}
      {activeCategory === 'All'
        ? categoriesPresent.map((c) => (
            <CategoryPanel
              key={c}
              category={c}
              entries={merged.filter((m) => m.category === c)}
            />
          ))
        : (
          <CategoryPanel category={activeCategory} entries={filtered} />
        )}

      {/* Runnable activities the chosen feats grant. Renders nothing unless the
          character was built on the site AND a feat actually carries one — which
          no content does yet. Deliberately outside the category filter: it is a
          different axis (what you can DO) from the feat list itself. */}
      <GrantedActions build={build} />
    </div>
  );
}

// ---------------------------------------------------------------
// Grouped panel
// ---------------------------------------------------------------

function CategoryPanel({
  category,
  entries,
}: {
  category: string;
  entries: FeatEntry[];
}) {
  if (entries.length === 0) return null;
  const byLevel = new Map<number, FeatEntry[]>();
  for (const e of entries) {
    const arr = byLevel.get(e.levelAcquired) ?? [];
    arr.push(e);
    byLevel.set(e.levelAcquired, arr);
  }
  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);

  return (
    <Panel title={`${category} Feats (${entries.length})`} icon={<FeatsIcon />}>
      <div className="space-y-4">
        {levels.map((lvl) => (
          <div key={lvl} className="border-l-2 border-gold/25 pl-3">
            <div className="mb-2 text-[0.65rem] font-display uppercase tracking-widest text-gold/80">
              Level {lvl}
            </div>
            <ul className="space-y-2">
              {byLevel
                .get(lvl)!
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((e, i) => (
                  <FeatCard key={`${e.name}-${i}`} entry={e} />
                ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------
// One feat
// ---------------------------------------------------------------

function FeatCard({ entry }: { entry: FeatEntry }) {
  const { row } = entry;
  const traits = (row?.traits ?? []).map(String);

  return (
    <li className="rounded border border-gold/15 bg-midnight-900/40 p-3">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-sm text-silver">{entry.name}</span>
          {row?.action_cost && (
            <span className="rounded border border-gold/20 bg-midnight-900/60 px-1.5 py-0.5 text-[0.6rem] uppercase text-silver/60">
              {row.action_cost}
            </span>
          )}
          {row?.rarity && row.rarity.toLowerCase() !== 'common' && (
            <RarityChip rarity={row.rarity} />
          )}
        </div>
        {row?.aon_url && (
          <a
            href={safeHttpUrl(row.aon_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[0.65rem] uppercase tracking-widest text-arcane hover:text-arcane-soft"
          >
            AoN ↗
          </a>
        )}
      </div>

      {traits.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {traits.slice(0, 6).map((t) => (
            <TraitChip key={t} trait={t} />
          ))}
        </div>
      )}

      {row?.prerequisites && (
        <p className="mb-1 text-xs italic text-silver/50">
          <span className="text-gold/70">Prerequisites:</span> {row.prerequisites}
        </p>
      )}
      {row?.trigger && (
        <p className="mb-1 text-xs italic text-silver/50">
          <span className="text-gold/70">Trigger:</span> {row.trigger}
        </p>
      )}

      {row?.description ? (
        <GrimoireMarkdown strip={['**Source**']}>{row.description}</GrimoireMarkdown>
      ) : (
        <p className="text-xs italic text-silver/40">
          No reference entry in the archive — description unavailable.
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[0.65rem] font-display uppercase tracking-widest transition-colors ${
        active
          ? 'border-gold/60 bg-gold/10 text-gold'
          : 'border-gold/20 bg-midnight-900/60 text-silver/70 hover:border-gold/40 hover:text-gold/90'
      }`}
    >
      {label}
      <span className="text-[0.6rem] text-silver/60">{count}</span>
    </button>
  );
}

function RarityChip({ rarity }: { rarity: string }) {
  const r = rarity.toLowerCase();
  const cls =
    r === 'uncommon'
      ? 'border-arcane/40 bg-arcane/10 text-arcane'
      : r === 'rare'
      ? 'border-gold/50 bg-gold/10 text-gold'
      : r === 'unique'
      ? 'border-brass/60 bg-brass/15 text-gold-soft'
      : 'border-gold/20 bg-midnight-900/60 text-silver/70';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[0.6rem] font-display uppercase tracking-widest ${cls}`}
    >
      {rarity}
    </span>
  );
}

function TraitChip({ trait }: { trait: string }): ReactNode {
  return (
    <span className="inline-flex items-center rounded border border-gold/20 bg-midnight-900/70 px-1.5 py-0 text-[0.6rem] uppercase tracking-widest text-silver/75">
      {trait}
    </span>
  );
}

/**
 * Pathbuilder puts the category tag in slot [2] of each feat tuple. Values
 * come in slightly different forms (title case vs lowercase, occasionally
 * more granular tags). Fold them onto the canonical CATEGORY_ORDER set so
 * grouping is predictable; unrecognized tags collapse to "Other".
 */
function normalizeCategory(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'Other';
  const lower = s.toLowerCase();

  if (lower.includes('ancestry')) return 'Ancestry';
  if (lower.includes('class')) return 'Class';
  if (lower.includes('general')) return 'General';
  if (lower.includes('skill')) return 'Skill';
  if (lower.includes('bonus')) return 'Bonus';
  if (lower.includes('archetype') || lower.includes('multiclass')) return 'Archetype';
  if (lower.includes('heritage')) return 'Heritage';
  if (lower.includes('background')) return 'Background';

  // Fallback: return the raw tag with first letter capitalized so at least
  // it renders readably (e.g. some homebrew categories).
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
