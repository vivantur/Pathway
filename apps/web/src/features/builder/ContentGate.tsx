import { useEffect, useState, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { isDatasetLoaded, loadDataset } from '@/features/builder/data';

/**
 * Blocks rendering of content-dependent UI (the builder) until the lazily
 * code-split PF2e dataset has loaded. `getDataset()` and the `find*` lookups are
 * synchronous and throw before the dataset resolves, so anything that calls them
 * must live under this gate.
 */
export function ContentGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(isDatasetLoaded);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadDataset().then(
      () => alive && setReady(true),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [ready]);

  if (failed) {
    return (
      <div style={{ padding: '4rem 1rem', textAlign: 'center' }}>
        <p>Couldn’t load the game content. Check your connection and reload the page.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <Spinner label="Loading game content…" />
      </div>
    );
  }

  return <>{children}</>;
}
