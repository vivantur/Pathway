import { useMemo, useState } from 'react';
import { getDataset } from '@/features/builder/data';
import { useBuilder } from '../store';
import { ChoiceGrid } from './ChoiceGrid';

export function AncestryStep() {
  const ancestryId = useBuilder((s) => s.state.ancestryId);
  const chooseAncestry = useBuilder((s) => s.chooseAncestry);
  const setStep = useBuilder((s) => s.setStep);
  const [query, setQuery] = useState('');

  const ancestries = getDataset().ancestries;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ancestries.filter((a) => a.name.toLowerCase().includes(q)) : ancestries;
  }, [ancestries, query]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Choose an Ancestry</h3>
        <p className="font-ui text-sm text-parchment/70">
          Your ancestry sets your Hit Points, Speed, size, and initial attribute boosts. There are{' '}
          {ancestries.length} to choose from — next you’ll pick a heritage.
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search ancestries…"
        className="rounded-lg border border-gold-500/25 bg-midnight-950/50 px-3 py-2 font-ui text-sm text-parchment placeholder:text-parchment/40 focus:border-gold-400/60 focus:outline-none"
      />

      <ChoiceGrid
        items={filtered.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          meta: (
            <span className="font-ui text-xs text-parchment/60">
              {a.hp} HP · {a.speed} ft
            </span>
          ),
        }))}
        selectedId={ancestryId}
        onSelect={(id) => {
          chooseAncestry(id);
          setStep('heritage'); // move straight to picking a heritage
        }}
      />
    </div>
  );
}
