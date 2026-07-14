import {
  ancestryRecommendations,
  classRecommendations,
  getDataset,
  findAncestry,
  findBackground,
  findClass,
} from '@/features/builder/data';
import { useBuilder } from '../store';
import { chosenFeatIds, opt } from '../rules';
import { OPT } from '../options/config';
import { plainText } from '../contentText';
import { FeatPicker } from '../FeatPicker';
import { FeatChoicesPanel } from '../FeatChoicesPanel';

export function FeatsStep() {
  const state = useBuilder((s) => s.state);
  const update = useBuilder((s) => s.update);
  const taken = chosenFeatIds(state);

  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  const klass = state.classId ? findClass(state.classId) : undefined;
  const background = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  const feats = getDataset().feats;

  const ancestryFeats = feats.filter(
    (f) => f.type === 'ancestry' && f.level === 1 && f.ancestryId === ancestry?.id,
  );
  const classFeats = feats.filter(
    (f) => f.type === 'class' && f.level === 1 && (f.classIds ?? []).includes(klass?.id ?? ''),
  );
  const bgFeat = background?.skillFeat ? feats.find((f) => f.id === background.skillFeat) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Choose Feats</h3>
        <p className="font-ui text-sm text-parchment/70">
          At 1st level you gain an ancestry feat and a class feat. Your background grants a skill
          feat automatically. Not sure what to take? Start with a ★ recommended pick.
        </p>
      </div>

      <section className="panel flex flex-col gap-4 p-5">
        <div>
          <h4 className="font-display text-lg text-gold-400">
            Ancestry Feat{ancestry ? ` — ${ancestry.name}` : ''}
          </h4>
          <p className="font-ui text-sm text-parchment/70">A feat reflecting your ancestral heritage.</p>
        </div>
        <FeatPicker
          feats={ancestryFeats}
          recommendations={ancestryRecommendations(ancestry?.id)}
          selectedId={state.ancestryFeatId}
          onSelect={(id) => update({ ancestryFeatId: id })}
          emptyLabel="Choose an ancestry first."
          takenIds={taken}
        />
      </section>

      {opt(state, OPT.ancestryParagon) && (
        <section className="panel flex flex-col gap-4 p-5">
          <div>
            <h4 className="font-display text-lg text-gold-400">
              Ancestry Paragon Feat{ancestry ? ` — ${ancestry.name}` : ''}
            </h4>
            <p className="font-ui text-sm text-parchment/70">
              A bonus 1st-level ancestry feat from the Ancestry Paragon variant rule (you gain
              further bonus ancestry feats at levels 3, 7, 11, 15, and 19 in Advancement).
            </p>
          </div>
          <FeatPicker
            feats={ancestryFeats}
            recommendations={[]}
            selectedId={state.ancestryParagonFeatId}
            onSelect={(id) => update({ ancestryParagonFeatId: id })}
            emptyLabel="Choose an ancestry first."
            takenIds={taken}
          />
        </section>
      )}

      <section className="panel flex flex-col gap-4 p-5">
        <div>
          <h4 className="font-display text-lg text-gold-400">
            Class Feat{klass ? ` — ${klass.name}` : ''}
          </h4>
          <p className="font-ui text-sm text-parchment/70">A signature technique or talent from your class.</p>
        </div>
        <FeatPicker
          feats={classFeats}
          recommendations={classRecommendations(klass?.id)}
          selectedId={state.classFeatId}
          onSelect={(id) => update({ classFeatId: id })}
          emptyLabel="Choose a class first."
          takenIds={taken}
        />
      </section>

      {bgFeat && (
        <section className="panel p-5">
          <h4 className="mb-1 font-display text-lg text-gold-400">Skill Feat (from background)</h4>
          <div className="choice-card" data-selected="true">
            <div className="font-display text-parchment">{bgFeat.name}</div>
            <p className="mt-1 font-ui text-sm text-parchment/70">{plainText(bgFeat.description)}</p>
          </div>
        </section>
      )}

      <FeatChoicesPanel />
    </div>
  );
}
