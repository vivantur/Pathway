import { ABILITY_NAMES, getDataset, findClass } from '@/features/builder/data';
import { useBuilder } from '../store';
import { rogueRacketAbility } from '../subclassEffects';
import { ChoiceGrid } from './ChoiceGrid';

export function ClassStep() {
  const { classId, keyAbility, subclassId } = useBuilder((s) => s.state);
  const chooseClass = useBuilder((s) => s.chooseClass);
  const update = useBuilder((s) => s.update);
  const klass = classId ? findClass(classId) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Choose a Class</h3>
        <p className="font-ui text-sm text-parchment/70">
          Your class is your calling — it sets your key ability, Hit Points, proficiencies, and
          signature feats.
        </p>
      </div>
      <ChoiceGrid
        items={getDataset().classes.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          meta: <span className="font-ui text-xs text-parchment/60">{c.hp} HP</span>,
        }))}
        selectedId={classId}
        onSelect={chooseClass}
      />

      {klass && klass.keyAbility.length > 1 && (
        <div className="panel p-5">
          <h4 className="mb-2 font-display text-lg text-gold-400">Key Ability</h4>
          <div className="flex flex-wrap gap-2">
            {klass.keyAbility.map((k) => (
              <button
                key={k}
                type="button"
                className="choice-card flex-1"
                data-selected={keyAbility === k}
                onClick={() => update({ keyAbility: k })}
              >
                <span className="font-display text-parchment">{ABILITY_NAMES[k]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {klass?.subclasses?.length ? (
        <div className="panel p-5">
          <h4 className="mb-2 font-display text-lg text-gold-400">{klass.subclassLabel}</h4>
          <ChoiceGrid
            items={klass.subclasses.map((s) => ({ id: s.id, name: s.name, description: s.description }))}
            selectedId={subclassId}
            onSelect={(id) => {
              // A rogue's racket sets their key ability (Ruffian=Str, Thief=Dex, …).
              const racket = klass?.id === 'rogue' ? rogueRacketAbility(id) : undefined;
              update(racket ? { subclassId: id, keyAbility: racket } : { subclassId: id });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
