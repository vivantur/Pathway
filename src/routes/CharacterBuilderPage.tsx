import { Suspense, lazy } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Character Builder route. Handles both:
 *  - /vault/create           → build a new character
 *  - /vault/:charKey/edit    → edit or level-up an existing one (?levelup=1)
 *
 * The builder (and its bundled PF2e dataset) is a big chunk, so it's lazy-loaded
 * — the data only downloads when someone actually opens the builder.
 */
const BuilderApp = lazy(() =>
  import('@/features/builder/BuilderApp').then((m) => ({ default: m.BuilderApp })),
);

export function CharacterBuilderPage() {
  const { charKey } = useParams<{ charKey?: string }>();
  const [params] = useSearchParams();
  const levelUp = params.get('levelup') === '1';
  const editing = Boolean(charKey);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-arcane/80">
          Character Builder
        </p>
        <h1 className="mt-2 font-display text-3xl text-gold">
          {editing ? (levelUp ? 'Level up your hero' : 'Edit your hero') : 'Forge a new hero'}
        </h1>
        <p className="mt-1 text-sm text-silver/60">
          A guided, 1–20 creation flow with automatic calculations, powered by a complete PF2e
          dataset.
        </p>
      </header>
      <Suspense
        fallback={
          <div className="py-16">
            <Spinner label="Unfurling the grimoire…" />
          </div>
        }
      >
        <BuilderApp editCharKey={charKey} levelUpOnLoad={levelUp} />
      </Suspense>
    </div>
  );
}
