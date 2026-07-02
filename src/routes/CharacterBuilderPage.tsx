import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRulesSearch } from '@/features/rules/useRulesSearch';
import type { RuleCategoryId, RuleEntry } from '@/features/rules/types';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Character Builder — guided, level-1-first creation wizard.
 *
 * PHASE B1 (this file): the flow shell + the data-driven selection steps
 * (Ancestry / Background / Class pull from the reference tables). The ability
 * engine (boosts / skills / feats) and persistence to the normalized
 * character_* tables land once the bot schema + RLS are wired — the "Finish"
 * button is intentionally disabled until then so we never write a half-formed
 * character.
 */

interface Pick {
  id: string;
  name: string;
}

interface BuilderDraft {
  name: string;
  ancestry: Pick | null;
  background: Pick | null;
  className: Pick | null;
}

const EMPTY_DRAFT: BuilderDraft = {
  name: '',
  ancestry: null,
  background: null,
  className: null,
};

type StepId = 'concept' | 'ancestry' | 'background' | 'class' | 'review';

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'concept', label: 'Concept' },
  { id: 'ancestry', label: 'Ancestry' },
  { id: 'background', label: 'Background' },
  { id: 'class', label: 'Class' },
  { id: 'review', label: 'Review' },
];

export function CharacterBuilderPage() {
  const [draft, setDraft] = useState<BuilderDraft>(EMPTY_DRAFT);
  const [stepIndex, setStepIndex] = useState(0);

  const step = STEPS[stepIndex];
  const patch = (p: Partial<BuilderDraft>) => setDraft((d) => ({ ...d, ...p }));

  const complete: Record<StepId, boolean> = {
    concept: draft.name.trim().length > 0,
    ancestry: draft.ancestry != null,
    background: draft.background != null,
    class: draft.className != null,
    review: false,
  };
  const canAdvance = complete[step.id] || step.id === 'review';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="font-display text-sm uppercase tracking-[0.3em] text-arcane/80">
          Character Builder
        </p>
        <h1 className="mt-2 font-display text-3xl text-gold">Forge a new hero</h1>
        <p className="mt-1 text-sm text-silver/60">
          A guided, level-1 creation flow. Choices are drawn from the Rules Library.
          <span className="ml-1 rounded border border-arcane/40 bg-arcane/10 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-widest text-arcane">
            Beta
          </span>
        </p>
      </header>

      {/* Progress rail */}
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => {
          const done = complete[s.id];
          const current = i === stepIndex;
          const reachable = i <= stepIndex || done;
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && setStepIndex(i)}
                className={`rounded-md border px-3 py-1.5 text-xs font-display uppercase tracking-widest transition-colors ${
                  current
                    ? 'border-gold/60 bg-gold/10 text-gold'
                    : done
                      ? 'border-emerald/40 bg-emerald/10 text-emerald-soft'
                      : reachable
                        ? 'border-gold/20 bg-midnight-900/50 text-silver/70 hover:border-gold/40'
                        : 'border-gold/10 bg-midnight-900/30 text-silver/30'
                }`}
              >
                {i + 1}. {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {/* Step body */}
      <div className="rounded-lg border border-gold/25 bg-midnight-900/60 p-6 shadow-gilded">
        {step.id === 'concept' && (
          <ConceptStep name={draft.name} onChange={(name) => patch({ name })} />
        )}
        {step.id === 'ancestry' && (
          <PickStep
            title="Choose an Ancestry"
            category="ancestries"
            selected={draft.ancestry}
            onSelect={(ancestry) => patch({ ancestry })}
          />
        )}
        {step.id === 'background' && (
          <PickStep
            title="Choose a Background"
            category="backgrounds"
            selected={draft.background}
            onSelect={(background) => patch({ background })}
          />
        )}
        {step.id === 'class' && (
          <PickStep
            title="Choose a Class"
            category="classes"
            selected={draft.className}
            onSelect={(className) => patch({ className })}
          />
        )}
        {step.id === 'review' && <ReviewStep draft={draft} />}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0}
          className="rounded-md border border-gold/25 px-4 py-2 text-sm text-silver/80 transition-colors hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40"
        >
          Back
        </button>
        {step.id !== 'review' ? (
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
            disabled={!canAdvance}
            className="rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm font-display uppercase tracking-widest text-gold transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            disabled
            title="Saving to your vault arrives once the builder's data layer is wired."
            className="cursor-not-allowed rounded-md border border-gold/30 bg-gold/5 px-5 py-2 text-sm font-display uppercase tracking-widest text-gold/50"
          >
            Finish (coming soon)
          </button>
        )}
      </div>
    </div>
  );
}

function ConceptStep({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-3">
      <h2 className="font-display text-xl text-gold">Name your character</h2>
      <p className="text-sm text-silver/60">
        Start with a name — you can change it any time. Everything else is chosen in
        the steps that follow.
      </p>
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Seravi Duskwarden"
        className="w-full rounded-md border border-gold/30 bg-midnight-800/80 px-3 py-2 text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none"
      />
    </div>
  );
}

function PickStep({
  title,
  category,
  selected,
  onSelect,
}: {
  title: string;
  category: RuleCategoryId;
  selected: Pick | null;
  onSelect: (p: Pick) => void;
}) {
  const [query, setQuery] = useState('');
  const { data, isLoading } = useRulesSearch(category, query);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl text-gold">{title}</h2>
        {selected && (
          <span className="text-sm text-emerald-soft">Selected: {selected.name}</span>
        )}
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${category}…`}
        className="w-full rounded-md border border-gold/25 bg-midnight-800/80 px-3 py-2 text-sm text-silver placeholder:text-silver/30 focus:border-gold/60 focus:outline-none"
      />
      {isLoading ? (
        <div className="py-6">
          <Spinner label="Consulting the archive…" />
        </div>
      ) : (
        <ul className="grid max-h-[22rem] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {(data ?? []).map((e: RuleEntry) => {
            const isSel = selected?.id === e.id;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ id: e.id, name: e.name })}
                  className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    isSel
                      ? 'border-gold/60 bg-gold/10 text-gold'
                      : 'border-gold/20 bg-midnight-900/50 text-silver/85 hover:border-gold/40 hover:text-gold/90'
                  }`}
                >
                  <span className="min-w-0 truncate">{e.name}</span>
                  {e.level != null && e.level > 0 && (
                    <span className="shrink-0 text-[0.6rem] uppercase tracking-widest text-silver/40">
                      Lvl {e.level}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ReviewStep({ draft }: { draft: BuilderDraft }) {
  const rows: Array<[string, string]> = [
    ['Name', draft.name || '—'],
    ['Ancestry', draft.ancestry?.name ?? '—'],
    ['Background', draft.background?.name ?? '—'],
    ['Class', draft.className?.name ?? '—'],
  ];
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl text-gold">Review</h2>
      <dl className="divide-y divide-gold/10 rounded-md border border-gold/15">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="text-[0.65rem] uppercase tracking-widest text-gold/70">{label}</dt>
            <dd className="font-display text-silver">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-md border border-arcane/25 bg-arcane/5 p-4 text-sm text-silver/70">
        <p>
          Next up in the builder: <strong className="text-silver/90">ability boosts,
          skills, and level-1 feats</strong>, with automatic calculation — then saving
          straight into your vault (and syncing to the Discord bot).
        </p>
        <Link to="/vault" className="mt-2 inline-block text-arcane hover:text-arcane-soft">
          ← Back to the Vault
        </Link>
      </div>
    </div>
  );
}
