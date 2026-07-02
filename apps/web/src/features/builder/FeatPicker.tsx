import { useMemo, useState } from 'react';
import type { Feat, Recommendation } from '@/features/builder/data';
import { useApp } from '@/features/builder/appStore';
import { featThemes, THEMES, type Theme } from './featThemes';

function FeatCard({
  feat,
  selected,
  reason,
  taken,
  onSelect,
}: {
  feat: Feat;
  selected: boolean;
  reason?: string;
  taken?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="choice-card text-left disabled:cursor-not-allowed disabled:opacity-45"
      data-selected={selected}
      disabled={taken}
      title={taken ? 'Already taken elsewhere in this build' : undefined}
      onClick={onSelect}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-lg text-parchment">
          {reason && (
            <span className="mr-1 text-gold-400" aria-hidden>
              ★
            </span>
          )}
          {feat.name}
        </span>
        {taken ? (
          <span className="rounded bg-midnight-600/70 px-1.5 py-0.5 font-ui text-[10px] uppercase tracking-wider text-parchment/60">
            Taken
          </span>
        ) : (
          feat.prerequisites && (
            <span className="font-ui text-[10px] uppercase tracking-wider text-parchment/50">
              {feat.prerequisites}
            </span>
          )
        )}
      </div>
      {reason ? (
        <p className="mt-1 font-ui text-sm leading-snug text-gold-400/90">{reason}</p>
      ) : (
        <p className="mt-1 font-ui text-sm leading-snug text-parchment/70">{feat.description}</p>
      )}
    </button>
  );
}

/**
 * A newcomer-friendly feat chooser: curated recommendations first (with plain
 * reasons), a Beginner-Mode "Not sure?" nudge, and search + theme filters over
 * the full list. Reused for level-1 feats and every level-up feat choice.
 */
export function FeatPicker({
  feats,
  recommendations = [],
  selectedId,
  onSelect,
  emptyLabel = 'No options in the current dataset.',
  takenIds,
}: {
  feats: Feat[];
  recommendations?: Recommendation[];
  selectedId?: string;
  onSelect: (id: string) => void;
  emptyLabel?: string;
  /** Feat ids already chosen elsewhere in the build — shown as "Taken". */
  takenIds?: Set<string>;
}) {
  const beginner = useApp((s) => s.beginner);
  const isTaken = (id: string) => Boolean(takenIds?.has(id)) && id !== selectedId;
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<Theme | 'All'>('All');

  const reasonById = useMemo(
    () => new Map(recommendations.map((r) => [r.featId, r.reason])),
    [recommendations],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return feats.filter((f) => {
      if (theme !== 'All' && !featThemes(f).includes(theme)) return false;
      if (q && !`${f.name} ${f.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [feats, query, theme]);

  const recommended = filtered.filter((f) => reasonById.has(f.id));
  const others = filtered.filter((f) => !reasonById.has(f.id));

  if (!feats.length) {
    return <p className="font-ui text-sm text-parchment/50">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {beginner && !selectedId && recommendations.length > 0 && (
        <div className="rounded-xl border border-arcane-400/30 bg-arcane-500/10 p-4">
          <div className="mb-2 font-display text-arcane-400">Not sure? Try one of these</div>
          <div className="flex flex-col gap-2">
            {recommendations.slice(0, 3).map((r) => {
              const feat = feats.find((f) => f.id === r.featId);
              if (!feat || isTaken(feat.id)) return null;
              return (
                <div key={r.featId} className="flex items-center justify-between gap-3">
                  <span className="font-ui text-sm text-parchment/80">
                    <span className="font-display text-parchment">{feat.name}</span> — {r.reason}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary shrink-0 py-1 text-xs"
                    onClick={() => onSelect(feat.id)}
                  >
                    Choose
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search feats…"
          className="rounded-lg border border-gold-500/25 bg-midnight-950/50 px-3 py-2 font-ui text-sm text-parchment placeholder:text-parchment/40 focus:border-gold-400/60 focus:outline-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {(['All', ...THEMES] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className="rounded-full border px-3 py-1 font-ui text-xs transition"
              style={{
                borderColor: theme === t ? 'rgba(232,200,119,0.7)' : 'rgba(212,175,55,0.2)',
                background: theme === t ? 'rgba(212,175,55,0.15)' : 'transparent',
                color: theme === t ? '#e8c877' : 'rgba(239,230,208,0.6)',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {recommended.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="font-ui text-[10px] uppercase tracking-widest text-gold-400/80">
            ★ Recommended for beginners
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {recommended.map((f) => (
              <FeatCard
                key={f.id}
                feat={f}
                selected={selectedId === f.id}
                reason={reasonById.get(f.id)}
                taken={isTaken(f.id)}
                onSelect={() => onSelect(f.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {recommended.length > 0 && (
          <div className="font-ui text-[10px] uppercase tracking-widest text-parchment/50">
            All other feats
          </div>
        )}
        {others.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {others.map((f) => (
              <FeatCard
                key={f.id}
                feat={f}
                selected={selectedId === f.id}
                taken={isTaken(f.id)}
                onSelect={() => onSelect(f.id)}
              />
            ))}
          </div>
        ) : (
          <p className="font-ui text-sm text-parchment/50">No feats match your search.</p>
        )}
      </div>
    </div>
  );
}
