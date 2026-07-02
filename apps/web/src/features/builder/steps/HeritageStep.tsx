import { getDataset, findAncestry } from '@/features/builder/data';
import { useBuilder } from '../store';
import { ChoiceGrid } from './ChoiceGrid';

export function HeritageStep() {
  const { ancestryId, heritageId } = useBuilder((s) => s.state);
  const update = useBuilder((s) => s.update);
  const setStep = useBuilder((s) => s.setStep);
  const ancestry = ancestryId ? findAncestry(ancestryId) : undefined;
  const versatile = getDataset().versatileHeritages;

  if (!ancestry) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="font-ui text-parchment/70">Choose an ancestry first — heritages depend on it.</p>
        <button type="button" className="btn" onClick={() => setStep('ancestry')}>
          ← Back to Ancestry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Choose a Heritage</h3>
        <p className="font-ui text-sm text-parchment/70">
          A heritage represents your specific lineage within the {ancestry.name} ancestry.
        </p>
      </div>

      <section>
        <h4 className="mb-2 font-display text-lg text-gold-400">{ancestry.name} Heritages</h4>
        <ChoiceGrid
          items={ancestry.heritages.map((h) => ({
            id: h.id,
            name: h.name,
            description: h.description,
          }))}
          selectedId={heritageId}
          onSelect={(id) => update({ heritageId: id })}
        />
      </section>

      <div className="rune-divider" />

      <section>
        <h4 className="mb-1 font-display text-lg text-arcane-400">Versatile Heritages</h4>
        <p className="mb-3 font-ui text-sm text-parchment/70">
          Planar and unusual lineages you can take instead of an ancestry heritage,{' '}
          <span className="text-parchment">regardless of your ancestry</span>.
        </p>
        <ChoiceGrid
          items={versatile.map((h) => ({
            id: h.id,
            name: h.name,
            description: h.description,
          }))}
          selectedId={heritageId}
          onSelect={(id) => update({ heritageId: id })}
        />
      </section>
    </div>
  );
}
