import { Suspense, lazy } from 'react';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Character Builder route. The builder (and its bundled PF2e dataset) is a big
 * chunk, so it's lazy-loaded here — the rest of the app stays lean and the data
 * only downloads when someone actually opens the builder.
 */
const BuilderApp = lazy(() =>
  import('@/features/builder/BuilderApp').then((m) => ({ default: m.BuilderApp })),
);

export function CharacterBuilderPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <p className="font-display text-sm uppercase tracking-[0.3em] text-arcane/80">
          Character Builder
        </p>
        <h1 className="mt-2 font-display text-3xl text-gold">Forge a new hero</h1>
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
        <BuilderApp />
      </Suspense>
    </div>
  );
}
