import { useMemo, useState } from 'react';
import type { Feat, Recommendation } from '@/features/builder/data';
import { useApp } from '@/features/builder/appStore';
import { useBuilder } from './store';
import { plainText } from './contentText';
import { checkFeat, prereqContext, type PrereqCheck } from './prerequisites';
import { featThemes, THEMES, type Theme } from './featThemes';

/** Action-cost glyph for a feat's activation, if any. */
function ActionGlyph({ cost }: { cost?: string }) {
  if (!cost) return null;
  const label =
    cost === '1' ? '◆' : cost === '2' ? '◆◆' : cost === '3' ? '◆◆◆' : cost === 'reaction' ? '⤾' : cost === 'free' ? '◇' : cost;
  return (
    <span className="shrink-0 font-ui text-xs text-gold-400/80" title={`${cost} action${cost === '1' ? '' : 's'}`}>
      {label}
    </span>
  );
}

function FeatCard({
  feat,
  selected,
  reason,
  taken,
  prereq,
  onSelect,
}: {
  feat: Feat;
  selected: boolean;
  reason?: string;
  taken?: boolean;
  prereq?: PrereqCheck;
  onSelect: () => void;
}) {
  // Lock feats whose parseable prerequisites are confidently unmet (free-text
  // ones we can't parse stay selectable, shown as text for the player to judge).
  const locked = prereq?.status === 'unmet' && !selected;
  return (
    <button
      type="button"
      className="choice-card text-left disabled:cursor-not-allowed disabled:opacity-45"
      data-selected={selected}
      disabled={taken || locked}
      title={
        taken
          ? 'Already taken elsewhere in this build'
          : locked
            ? `Requires ${prereq!.unmet.join('; ')}`
            : undefined
      }
      onClick={onSelect}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-1.5 font-display text-lg text-parchment">
          {reason && (
            <span className="text-gold-400" aria-hidden>
              ★
            </span>
          )}
          {feat.name}
          <ActionGlyph cost={feat.actionCost} />
        </span>
        {taken ? (
          <span className="rounded bg-midnight-600/70 px-1.5 py-0.5 font-ui text-[10px] uppercase tracking-wider text-parchment/60">
            Taken
          </span>
        ) : locked ? (
          <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-ui text-[10px] uppercase tracking-wider text-red-300/90">
            Prereqs
          </span>
        ) : (
          feat.prerequisites && (
            <span className="font-ui text-[10px] uppercase tracking-wider text-parchment/50">
              {feat.prerequisites}
            </span>
          )
        )}
      </div>
      {feat.traits.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {feat.traits.slice(0, 5).map((t) => (
            <span
              key={t}
              className="rounded bg-midnight-700/60 px-1.5 py-0.5 font-ui text-[10px] uppercase tracking-wider text-parchment/55"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {locked ? (
        <p className="mt-1.5 font-ui text-sm leading-snug text-red-300/80">
          Requires {prereq!.unmet.join('; ')}
        </p>
      ) : reason ? (
        <p className="mt-1.5 font-ui text-sm leading-snug text-gold-400/90">{reason}</p>
      ) : (
        <p className="mt-1.5 line-clamp-4 font-ui text-sm leading-snug text-parchment/70">
          {plainText(feat.description)}
        </p>
      )}
    </button>
  );
}

/**
 * A newcomer-friendly feat chooser: curated recommendations first (with plain
 * reasons), a Beginner-Mode "Not sure?" nudge, and search + theme filters over
 * the full list. Reused for level-1 feats and every level-up feat choice.
 */
/** Rare/unique feats need GM permission and are hidden unless explicitly allowed. */
function isRareFeat(f: Feat): boolean {
  const r = f.rarity;
  return r === 'rare' || r === 'unique' || f.traits.includes('rare') || f.traits.includes('unique');
}

// Cap how many "other" feats render at once — some slots (archetype/class) draw
// from thousands of feats, and mounting them all would jank. Search narrows it.
const OTHERS_RENDER_CAP = 80;

export function FeatPicker({
  feats,
  recommendations = [],
  selectedId,
  onSelect,
  emptyLabel = 'No options in the current dataset.',
  takenIds,
  allowRare = false,
}: {
  feats: Feat[];
  recommendations?: Recommendation[];
  selectedId?: string;
  onSelect: (id: string) => void;
  emptyLabel?: string;
  /** Feat ids already chosen elsewhere in the build — shown as "Taken". */
  takenIds?: Set<string>;
  /** Show rare/unique feats (the "Display rare feats" option). Default hidden. */
  allowRare?: boolean;
}) {
  const beginner = useApp((s) => s.beginner);
  const isTaken = (id: string) => Boolean(takenIds?.has(id)) && id !== selectedId;
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<Theme | 'All'>('All');
  const state = useBuilder((s) => s.state);
  const ctx = useMemo(() => prereqContext(state), [state]);

  const reasonById = useMemo(
    () => new Map(recommendations.map((r) => [r.featId, r.reason])),
    [recommendations],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return feats.filter((f) => {
      // Rare feats stay hidden unless allowed — but never hide one already chosen.
      if (!allowRare && isRareFeat(f) && f.id !== selectedId) return false;
      if (theme !== 'All' && !featThemes(f).includes(theme)) return false;
      if (q && !`${f.name} ${f.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [feats, query, theme, allowRare, selectedId]);

  const recommended = filtered.filter((f) => reasonById.has(f.id));
  const allOthers = filtered.filter((f) => !reasonById.has(f.id));
  const others = allOthers.slice(0, OTHERS_RENDER_CAP);
  const hiddenCount = allOthers.length - others.length;

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
                prereq={checkFeat(ctx, f)}
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
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {others.map((f) => (
                <FeatCard
                  key={f.id}
                  feat={f}
                  selected={selectedId === f.id}
                  taken={isTaken(f.id)}
                  prereq={checkFeat(ctx, f)}
                  onSelect={() => onSelect(f.id)}
                />
              ))}
            </div>
            {hiddenCount > 0 && (
              <p className="font-ui text-xs text-parchment/50">
                +{hiddenCount} more — refine your search to narrow the list.
              </p>
            )}
          </>
        ) : (
          <p className="font-ui text-sm text-parchment/50">No feats match your search.</p>
        )}
      </div>
    </div>
  );
}
