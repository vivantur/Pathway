import { useMemo, useState } from 'react';
import { getDataset, findSkill } from '@/features/builder/data';
import { useBuilder } from '../store';
import { ChoiceGrid } from './ChoiceGrid';

export function BackgroundStep() {
  const backgroundId = useBuilder((s) => s.state.backgroundId);
  const chooseBackground = useBuilder((s) => s.chooseBackground);
  const [query, setQuery] = useState('');

  const backgrounds = getDataset().backgrounds;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? backgrounds.filter((b) => b.name.toLowerCase().includes(q))
      : backgrounds;
  }, [backgrounds, query]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Choose a Background</h3>
        <p className="font-ui text-sm text-parchment/70">
          Your background reflects your life before adventuring. It grants two attribute boosts, a
          trained skill, a Lore, and a skill feat. There are {backgrounds.length} to choose from.
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search backgrounds…"
        className="rounded-lg border border-gold-500/25 bg-midnight-950/50 px-3 py-2 font-ui text-sm text-parchment placeholder:text-parchment/40 focus:border-gold-400/60 focus:outline-none"
      />

      <ChoiceGrid
        items={filtered.map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description,
          meta: (
            <span className="font-ui text-xs text-parchment/60">
              {findSkill(b.trainedSkill)?.name ?? b.trainedSkill}
            </span>
          ),
        }))}
        selectedId={backgroundId}
        onSelect={chooseBackground}
      />
    </div>
  );
}
