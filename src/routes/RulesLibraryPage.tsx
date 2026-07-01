import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GrimoireMarkdown } from '@/components/ui/GrimoireMarkdown';
import { Spinner } from '@/components/ui/Spinner';
import { errorMessage } from '@/features/characters/errorMessage';
import { RULE_CATEGORIES } from '@/features/rules/api';
import { useRulesSearch } from '@/features/rules/useRulesSearch';
import type { RuleCategoryId, RuleEntry } from '@/features/rules/types';

/**
 * Rules Library — a public, searchable browser across the reference tables
 * (feats / spells / items / conditions / ancestries / backgrounds). No auth:
 * these are public reference data, useful to anonymous visitors. Category +
 * query live in the URL so a search is shareable/bookmarkable.
 */
export function RulesLibraryPage() {
  const [params, setParams] = useSearchParams();
  const category = (params.get('cat') as RuleCategoryId) || 'feats';
  const query = params.get('q') ?? '';

  const setCategory = (id: RuleCategoryId) => {
    const next = new URLSearchParams(params);
    next.set('cat', id);
    setParams(next, { replace: true });
  };
  const setQuery = (q: string) => {
    const next = new URLSearchParams(params);
    if (q) next.set('q', q);
    else next.delete('q');
    setParams(next, { replace: true });
  };

  const { data, isLoading, isError, error } = useRulesSearch(category, query);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl text-gold">Rules Library</h1>
        <p className="mt-1 text-sm text-silver/70">
          Search Pathfinder 2e feats, spells, items, and more. Data mirrors
          Archive of Nethys.
        </p>
      </header>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {RULE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className={`rounded-md border px-3 py-1.5 text-xs font-display uppercase tracking-widest transition-colors ${
              category === c.id
                ? 'border-gold/60 bg-gold/10 text-gold'
                : 'border-gold/20 bg-midnight-900/50 text-silver/70 hover:border-gold/40 hover:text-gold/90'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Search box */}
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${RULE_CATEGORIES.find((c) => c.id === category)?.label.toLowerCase() ?? ''}…`}
          className="w-full rounded-lg border border-gold/25 bg-midnight-900/60 px-4 py-2.5 font-serif text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
        />
      </div>

      {/* Results */}
      {isLoading && (
        <div className="py-10">
          <Spinner label="Consulting the archive…" />
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          Couldn&apos;t search: {errorMessage(error)}
        </div>
      )}

      {!isLoading && !isError && data && (
        <ResultsList entries={data} query={query} />
      )}
    </div>
  );
}

function ResultsList({ entries, query }: { entries: RuleEntry[]; query: string }) {
  if (entries.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-silver/50">
        {query
          ? `No matches for “${query}”.`
          : 'No entries found in this category.'}
      </p>
    );
  }

  return (
    <>
      <p className="text-xs uppercase tracking-widest text-silver/40">
        {entries.length === 60 ? 'Showing first 60' : `${entries.length} result${entries.length === 1 ? '' : 's'}`}
        {query ? '' : ' · refine with a search'}
      </p>
      <ul className="space-y-2">
        {entries.map((e) => (
          <RuleCard key={`${e.category}-${e.id}`} entry={e} />
        ))}
      </ul>
    </>
  );
}

function RuleCard({ entry }: { entry: RuleEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg border border-gold/15 bg-midnight-900/40 transition-colors hover:border-gold/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="font-display text-silver">{entry.name}</span>
        {entry.level != null && (
          <span className="rounded border border-arcane/40 bg-arcane/10 px-1.5 py-0.5 text-[0.6rem] font-display uppercase tracking-widest text-arcane">
            {entry.category === 'spells' && entry.level === 0 ? 'Cantrip' : `Lvl ${entry.level}`}
          </span>
        )}
        {entry.actionCost && (
          <span className="rounded border border-gold/20 bg-midnight-900/60 px-1.5 py-0.5 text-[0.6rem] uppercase text-silver/60">
            {entry.actionCost}
          </span>
        )}
        {entry.rarity && entry.rarity.toLowerCase() !== 'common' && (
          <RarityChip rarity={entry.rarity} />
        )}
        <span className="ml-auto text-silver/40">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="border-t border-gold/15 px-4 py-3">
          {entry.traits.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {entry.traits.slice(0, 10).map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center rounded border border-gold/20 bg-midnight-900/70 px-1.5 py-0 text-[0.6rem] uppercase tracking-widest text-silver/75"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {entry.meta.length > 0 && (
            <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              {entry.meta.map((m) => (
                <div key={m.label}>
                  <dt className="inline text-[0.6rem] uppercase tracking-widest text-gold/70">
                    {m.label}:{' '}
                  </dt>
                  <dd className="inline text-silver/85">{m.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {entry.prerequisites && (
            <p className="mb-1 text-xs italic text-silver/50">
              <span className="text-gold/70">Prerequisites:</span> {entry.prerequisites}
            </p>
          )}
          {entry.trigger && (
            <p className="mb-1 text-xs italic text-silver/50">
              <span className="text-gold/70">Trigger:</span> {entry.trigger}
            </p>
          )}

          {entry.description ? (
            <GrimoireMarkdown strip={['**Source**']}>{entry.description}</GrimoireMarkdown>
          ) : (
            <p className="text-xs italic text-silver/40">No description recorded.</p>
          )}

          {entry.aonUrl && (
            <a
              href={entry.aonUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-[0.65rem] uppercase tracking-widest text-arcane hover:text-arcane-soft"
            >
              View on Archive of Nethys ↗
            </a>
          )}
        </div>
      )}
    </li>
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
