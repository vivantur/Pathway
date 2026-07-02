import {
  ABILITY_KEYS,
  ABILITY_NAMES,
  findAncestry,
  findBackground,
  findClass,
  type AbilityKey,
} from '@/features/builder/data';
import { choiceSlots, computeAbilityScores } from '../rules';
import { useBuilder } from '../store';

function AbilityButtons({
  options,
  value,
  onPick,
  disabled = [],
}: {
  options: AbilityKey[];
  value: AbilityKey | null;
  onPick: (k: AbilityKey) => void;
  disabled?: AbilityKey[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled.includes(k) && value !== k}
          className="choice-card px-3 py-1.5 disabled:cursor-not-allowed"
          data-selected={value === k}
          onClick={() => onPick(k)}
        >
          <span className="font-ui text-sm text-parchment">{k.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}

function LockedChip({ label }: { label: string }) {
  return (
    <span className="rounded border border-gold-500/30 bg-gold-500/10 px-3 py-1.5 font-ui text-sm text-gold-400">
      {label}
    </span>
  );
}

export function AbilitiesStep() {
  const state = useBuilder((s) => s.state);
  const update = useBuilder((s) => s.update);

  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  const background = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  const klass = state.classId ? findClass(state.classId) : undefined;
  const scores = computeAbilityScores(state);

  const setChoice = (
    field: 'ancestryBoostChoices' | 'backgroundBoostChoices',
    order: number,
    value: AbilityKey,
  ) => {
    const arr = [...state[field]];
    arr[order] = value;
    update({ [field]: arr } as Partial<typeof state>);
  };

  const setFree = (order: number, value: AbilityKey) => {
    const arr = [...state.freeBoosts];
    arr[order] = value;
    update({ freeBoosts: arr });
  };

  if (!ancestry || !background || !klass) {
    return (
      <p className="font-ui text-parchment/70">
        Choose an ancestry, background, and class first — your attribute boosts come from all three.
      </p>
    );
  }

  const ancestrySlots = choiceSlots(ancestry.boosts);
  const bgSlots = choiceSlots(background.boosts);
  const freeChosen = state.freeBoosts.filter(Boolean) as AbilityKey[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Assign Attribute Boosts</h3>
        <p className="font-ui text-sm text-parchment/70">
          Every character starts at 10 in each attribute. A boost raises it by 2 (by 1 once above 18).
          Boosts come from your ancestry, background, class key attribute, and four free boosts.
        </p>
      </div>

      {/* Ancestry */}
      <section className="panel p-5">
        <h4 className="mb-3 font-display text-lg text-gold-400">Ancestry — {ancestry.name}</h4>
        <div className="flex flex-col gap-3">
          {ancestry.boosts.map((b, i) =>
            b === 'free' || Array.isArray(b) ? null : (
              <div key={`fixed-${i}`} className="flex items-center gap-3">
                <span className="w-24 font-ui text-sm text-parchment/60">Boost</span>
                <LockedChip label={ABILITY_NAMES[b]} />
              </div>
            ),
          )}
          {ancestrySlots.map((slot, order) => (
            <div key={`choice-${slot.index}`} className="flex items-center gap-3">
              <span className="w-24 font-ui text-sm text-parchment/60">
                {slot.options.length === ABILITY_KEYS.length ? 'Free boost' : 'Choose'}
              </span>
              <AbilityButtons
                options={slot.options}
                value={state.ancestryBoostChoices[order] ?? null}
                onPick={(k) => setChoice('ancestryBoostChoices', order, k)}
              />
            </div>
          ))}
          {ancestry.flaws.map((f, i) => (
            <div key={`flaw-${i}`} className="flex items-center gap-3">
              <span className="w-24 font-ui text-sm text-parchment/60">Flaw</span>
              <span className="rounded border border-red-400/30 bg-red-500/10 px-3 py-1.5 font-ui text-sm text-red-300">
                {ABILITY_NAMES[f]}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Background */}
      <section className="panel p-5">
        <h4 className="mb-3 font-display text-lg text-gold-400">Background — {background.name}</h4>
        <div className="flex flex-col gap-3">
          {bgSlots.map((slot, order) => (
            <div key={`bg-${slot.index}`} className="flex items-center gap-3">
              <span className="w-24 font-ui text-sm text-parchment/60">
                {slot.options.length === ABILITY_KEYS.length ? 'Free boost' : 'Choose'}
              </span>
              <AbilityButtons
                options={slot.options}
                value={state.backgroundBoostChoices[order] ?? null}
                onPick={(k) => setChoice('backgroundBoostChoices', order, k)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Class key ability */}
      <section className="panel p-5">
        <h4 className="mb-3 font-display text-lg text-gold-400">Class Key Attribute — {klass.name}</h4>
        {klass.keyAbility.length > 1 ? (
          <AbilityButtons
            options={klass.keyAbility}
            value={state.keyAbility ?? null}
            onPick={(k) => update({ keyAbility: k })}
          />
        ) : (
          <LockedChip label={ABILITY_NAMES[state.keyAbility ?? klass.keyAbility[0]]} />
        )}
      </section>

      {/* Four free boosts */}
      <section className="panel p-5">
        <h4 className="mb-1 font-display text-lg text-gold-400">Four Free Boosts</h4>
        <p className="mb-3 font-ui text-sm text-parchment/70">
          Each must target a different ability.
        </p>
        <div className="flex flex-col gap-3">
          {state.freeBoosts.map((val, order) => (
            <div key={`free-${order}`} className="flex items-center gap-3">
              <span className="w-24 font-ui text-sm text-parchment/60">Free {order + 1}</span>
              <AbilityButtons
                options={[...ABILITY_KEYS]}
                value={val}
                onPick={(k) => setFree(order, k)}
                disabled={freeChosen}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Result */}
      <section className="grid grid-cols-6 gap-2">
        {ABILITY_KEYS.map((k) => (
          <div key={k} className="rounded-lg border border-gold-500/25 bg-midnight-800/60 py-2 text-center">
            <div className="font-ui text-[10px] uppercase tracking-widest text-parchment/60">{k}</div>
            <div className="font-display text-2xl text-parchment">{scores[k]}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
