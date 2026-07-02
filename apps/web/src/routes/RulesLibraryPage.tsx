import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GrimoireMarkdown } from '@/components/ui/GrimoireMarkdown';
import { Spinner } from '@/components/ui/Spinner';
import { errorMessage } from '@/features/characters/errorMessage';
import { RULE_CATEGORIES, RULE_CATEGORY_GROUPS, categoryById } from '@/features/rules/api';
import { useRulesSearch } from '@/features/rules/useRulesSearch';
import type { DeityBlock, MonsterStatBlock, RuleCategoryId, RuleEntry } from '@/features/rules/types';

/** Categories whose descriptions are long AoN lore prose worth sectioning. */
const structuredCategories = new Set<RuleCategoryId>([
  'ancestries',
  'backgrounds',
  'classes',
  'archetypes',
  'deities',
  'rules',
  'hazards',
]);

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
          Search Pathfinder 2e feats, spells, items, rules, and more. We draw on
          Archive of Nethys and Paizo&apos;s official Pathfinder Second Edition
          material as our primary sources.
        </p>
      </header>

      {/* Category picker — grouped into scannable clusters */}
      <div className="space-y-3">
        {RULE_CATEGORY_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 text-[0.6rem] font-display uppercase tracking-widest text-gold/50">
              {g.label}
            </div>
            <div className="flex flex-wrap gap-2">
              {g.ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCategory(id)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-display uppercase tracking-widest transition-colors ${
                    category === id
                      ? 'border-gold/60 bg-gold/10 text-gold'
                      : 'border-gold/20 bg-midnight-900/50 text-silver/70 hover:border-gold/40 hover:text-gold/90'
                  }`}
                >
                  {categoryById(id).label}
                </button>
              ))}
            </div>
          </div>
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

      <RulesAttribution />
    </div>
  );
}

/**
 * Rules-specific sourcing note. The full Paizo Community Use / ORC notice lives
 * in the site-wide footer, so here we just credit the descriptive source.
 */
function RulesAttribution() {
  return (
    <p className="mt-8 border-t border-gold/15 pt-4 text-[0.7rem] leading-relaxed text-silver/45">
      Descriptions and reference data are aggregated with attribution from{' '}
      <a
        href="https://2e.aonprd.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-arcane/80 underline decoration-arcane/30 underline-offset-2 hover:decoration-arcane/70"
      >
        Archive of Nethys
      </a>
      , the official Pathfinder 2e SRD. See the footer for the full Paizo
      Community Use and ORC License notice.
    </p>
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
            {entry.category === 'spells'
              ? (entry.level === 0 ? 'Cantrip' : `Rank ${entry.level}`)
              : `Lvl ${entry.level}`}
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

          {entry.statBlock && <StatBlock block={entry.statBlock} />}
          {entry.deityBlock && <DeityBlockView block={entry.deityBlock} />}

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
            <GrimoireMarkdown
              strip={['**Source**']}
              structure={structuredCategories.has(entry.category)}
              name={entry.name}
            >
              {entry.description}
            </GrimoireMarkdown>
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

function StatBlock({ block }: { block: MonsterStatBlock }) {
  return (
    <div className="mb-3 space-y-3 rounded-md border border-gold/25 bg-midnight-900/50 p-4">
      {block.imageUrl && (
        <img
          src={block.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mx-auto max-h-56 w-auto rounded border border-gold/25 object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}

      {/* Top band — senses / languages / skills / abilities / items */}
      <div className="space-y-1 text-sm">
        {block.perception && (
          <SbLine label="Perception">
            {block.perception}
            {block.senses.length > 0 && `; ${block.senses.join(', ')}`}
          </SbLine>
        )}
        {block.languages.length > 0 && (
          <SbLine label="Languages">{block.languages.join(', ')}</SbLine>
        )}
        {block.skills.length > 0 && (
          <SbLine label="Skills">
            {block.skills.map((s) => `${s.label} ${s.value}`).join(', ')}
          </SbLine>
        )}
        {block.abilities.length > 0 && (
          <SbLine label="Abilities">
            {block.abilities.map((a) => `${a.label} ${a.value}`).join(', ')}
          </SbLine>
        )}
        {block.items.length > 0 && <SbLine label="Items">{block.items.join(', ')}</SbLine>}
      </div>

      <SbRule />

      {/* Defense band */}
      <div className="space-y-1 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {block.ac && <SbStat label="AC" value={block.ac} />}
          {block.fort && <SbStat label="Fort" value={block.fort} />}
          {block.ref && <SbStat label="Ref" value={block.ref} />}
          {block.will && <SbStat label="Will" value={block.will} />}
          {block.hp && <SbStat label="HP" value={block.hp} />}
        </div>
        {block.immunities.length > 0 && (
          <SbLine label="Immunities">{block.immunities.join(', ')}</SbLine>
        )}
        {block.resistances.length > 0 && (
          <SbLine label="Resistances">{block.resistances.join(', ')}</SbLine>
        )}
        {block.weaknesses.length > 0 && (
          <SbLine label="Weaknesses">{block.weaknesses.join(', ')}</SbLine>
        )}
      </div>

      {(block.speed || block.attacks.length > 0 || block.specialAbilities.length > 0) && <SbRule />}

      {/* Offense band */}
      <div className="space-y-2 text-sm">
        {block.speed && <SbLine label="Speed">{block.speed}</SbLine>}

        {block.attacks.map((atk, i) => (
          <div key={`atk-${i}`} className="leading-relaxed">
            <span className="font-display text-gold/90">{atk.kind}</span>{' '}
            <span className="italic text-silver">{atk.name}</span>{' '}
            {atk.toHit && <span className="text-arcane">{atk.toHit}</span>}
            {atk.traits.length > 0 && (
              <span className="text-silver/55"> ({atk.traits.join(', ')})</span>
            )}
            {atk.damage && (
              <span className="text-silver/85">
                , <span className="text-gold/70">Damage</span> {atk.damage}
              </span>
            )}
          </div>
        ))}

        {block.specialAbilities.map((ab, i) => (
          <div key={`ab-${i}`}>
            <span className="font-display text-gold">{ab.name}</span>
            {ab.actionCost && (
              <span className="ml-1 text-xs uppercase tracking-wider text-silver/60">
                [{ab.actionCost}]
              </span>
            )}
            {ab.traits.length > 0 && (
              <span className="ml-1 text-xs text-silver/50">({ab.traits.join(', ')})</span>
            )}
            {ab.description && (
              <div className="mt-0.5 text-silver/80">
                <GrimoireMarkdown strip={['**Source**']}>{ab.description}</GrimoireMarkdown>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DeityBlockView({ block }: { block: DeityBlock }) {
  const devotee = [
    block.divineFont ? { label: 'Divine Font', value: block.divineFont } : null,
    block.sanctification ? { label: 'Sanctification', value: block.sanctification } : null,
    block.divineSkill ? { label: 'Divine Skill', value: block.divineSkill } : null,
    block.divineAttributes.length
      ? { label: 'Divine Attribute', value: block.divineAttributes.join(' or ') }
      : null,
    block.favoredWeapon ? { label: 'Favored Weapon', value: block.favoredWeapon } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const domains = [...block.domains];
  const domainsLabel =
    domains.join(', ') +
    (block.alternateDomains.length ? ` (alternate: ${block.alternateDomains.join(', ')})` : '');

  return (
    <div className="mb-3 space-y-3 rounded-md border border-gold/25 bg-midnight-900/50 p-4">
      {block.imageUrl && (
        <img
          src={block.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mx-auto max-h-48 w-auto rounded border border-gold/25 object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}

      {(block.edicts.length > 0 || block.anathema.length > 0 || block.areasOfConcern) && (
        <div className="space-y-1 text-sm">
          {block.edicts.length > 0 && (
            <SbLine label="Edicts">{block.edicts.join('; ')}</SbLine>
          )}
          {block.anathema.length > 0 && (
            <SbLine label="Anathema">{block.anathema.join('; ')}</SbLine>
          )}
          {block.areasOfConcern && (
            <SbLine label="Areas of Concern">{block.areasOfConcern}</SbLine>
          )}
        </div>
      )}

      {devotee.length > 0 && (
        <>
          <SbRule />
          <div className="space-y-1 text-sm">
            <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">
              Devotee Benefits
            </div>
            {devotee.map((d) => (
              <SbLine key={d.label} label={d.label}>
                {d.value}
              </SbLine>
            ))}
          </div>
        </>
      )}

      {(domains.length > 0 || block.clericSpells) && (
        <>
          <SbRule />
          <div className="space-y-1 text-sm">
            {domains.length > 0 && <SbLine label="Domains">{domainsLabel}</SbLine>}
            {block.clericSpells && <SbLine label="Cleric Spells">{block.clericSpells}</SbLine>}
          </div>
        </>
      )}
    </div>
  );
}

function SbLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="leading-relaxed text-silver/85">
      <span className="font-display text-gold/80">{label}</span> {children}
    </p>
  );
}

function SbStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="font-display text-gold/80">{label}</span>{' '}
      <span className="text-silver">{value}</span>
    </span>
  );
}

function SbRule() {
  return <div className="h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />;
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
