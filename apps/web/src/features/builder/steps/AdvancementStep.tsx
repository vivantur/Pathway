import type { ReactNode } from 'react';
import {
  ABILITY_KEYS,
  ancestryRecommendations,
  classRecommendations,
  getDataset,
  findAncestry,
  findClass,
  findFeat,
  findHeritage,
  type AbilityKey,
} from '@/features/builder/data';
import { MAX_LEVEL, useBuilder } from '../store';
import {
  archetypeFeatOptions,
  chosenFeatIds,
  gainsForLevel,
  skillRankMap,
  unmetAtLevel,
  RANK_LABEL,
} from '../rules';
import { emptyLevelGains } from '../types';
import { FeatPicker } from '../FeatPicker';

function SlotBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-ui text-[11px] uppercase tracking-widest text-gold-400/80">{title}</div>
      {children}
    </div>
  );
}

function LevelCard({ level }: { level: number }) {
  const state = useBuilder((s) => s.state);
  const updateLevelGains = useBuilder((s) => s.updateLevelGains);
  const slots = gainsForLevel(level, state.options);
  const gains = state.progression[level] ?? emptyLevelGains();
  const taken = chosenFeatIds(state);
  const unmet = unmetAtLevel(state, level);
  const feats = getDataset().feats;
  const klass = state.classId ? findClass(state.classId) : undefined;
  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  const ranks = skillRankMap({ ...state, level });

  const classFeats = feats.filter(
    (f) => f.type === 'class' && f.level <= level && (f.classIds ?? []).includes(klass?.id ?? ''),
  );
  const ancestryFeats = feats.filter(
    (f) => f.type === 'ancestry' && f.level <= level && f.ancestryId === ancestry?.id,
  );
  const skillFeats = feats.filter((f) => f.type === 'skill' && f.level <= level);
  const generalFeats = feats.filter(
    (f) => (f.type === 'general' || f.type === 'skill') && f.level <= level,
  );
  // Free Archetype: only Dedication feats until you've taken one (you must begin
  // an archetype with its Dedication), then the archetype's other feats open up.
  const archetypeFeats = archetypeFeatOptions(state, level);

  const boostCount = slots.boostCount;
  const boosts =
    gains.boosts.length === boostCount ? gains.boosts : (Array(boostCount).fill(null) as (AbilityKey | null)[]);
  const chosenBoosts = boosts.filter(Boolean) as AbilityKey[];
  const setBoost = (i: number, k: AbilityKey) => {
    const next = [...boosts];
    next[i] = k;
    updateLevelGains(level, { boosts: next });
  };

  return (
    <details className="panel p-5" open={unmet.length > 0}>
      <summary className="flex cursor-pointer items-center justify-between gap-3">
        <span className="font-display text-lg text-parchment">Level {level}</span>
        <span
          className="rounded-full border px-2 py-0.5 font-ui text-[11px]"
          style={{
            borderColor: unmet.length ? 'rgba(248,113,113,0.4)' : 'rgba(134,239,172,0.4)',
            color: unmet.length ? 'rgb(252,165,165)' : 'rgb(134,239,172)',
          }}
        >
          {unmet.length ? `${unmet.length} to choose` : 'Complete'}
        </span>
      </summary>

      <div className="mt-4 flex flex-col gap-6">
        {boostCount > 0 && (
          <SlotBlock
            title={`Attribute Boost${boostCount > 1 ? 's' : ''} (pick ${boostCount} different attribut${
              boostCount > 1 ? 'es' : 'e'
            })`}
          >
            <div className="flex flex-col gap-2">
              {boosts.map((val, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  {ABILITY_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={chosenBoosts.includes(k) && val !== k}
                      className="choice-card px-3 py-1.5 disabled:cursor-not-allowed"
                      data-selected={val === k}
                      onClick={() => setBoost(i, k)}
                    >
                      <span className="font-ui text-sm text-parchment">{k.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </SlotBlock>
        )}

        {slots.skillIncrease && (
          <SlotBlock title="Skill Increase (raise one skill's proficiency)">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {getDataset().skills.map((sk) => {
                const chosen = gains.skillIncreases.includes(sk.id);
                return (
                  <button
                    key={sk.id}
                    type="button"
                    className="choice-card flex items-center justify-between px-3 py-2"
                    data-selected={chosen}
                    onClick={() => updateLevelGains(level, { skillIncreases: chosen ? [] : [sk.id] })}
                  >
                    <span className="font-ui text-sm text-parchment">{sk.name}</span>
                    <span className="font-ui text-[10px] uppercase tracking-wider text-parchment/50">
                      {RANK_LABEL[ranks.get(sk.id) ?? 0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </SlotBlock>
        )}

        {slots.classFeat && (
          <SlotBlock title="Class Feat">
            <FeatPicker
              feats={classFeats}
              recommendations={level <= 4 ? classRecommendations(klass?.id) : []}
              selectedId={gains.classFeatId}
              onSelect={(id) => updateLevelGains(level, { classFeatId: id })}
              takenIds={taken}
            />
          </SlotBlock>
        )}

        {slots.ancestryFeat && (
          <SlotBlock title="Ancestry Feat">
            <FeatPicker
              feats={ancestryFeats}
              recommendations={level <= 5 ? ancestryRecommendations(ancestry?.id) : []}
              selectedId={gains.ancestryFeatId}
              onSelect={(id) => updateLevelGains(level, { ancestryFeatId: id })}
              takenIds={taken}
            />
          </SlotBlock>
        )}

        {slots.skillFeat && (
          <SlotBlock title="Skill Feat">
            <FeatPicker
              feats={skillFeats}
              selectedId={gains.skillFeatId}
              onSelect={(id) => updateLevelGains(level, { skillFeatId: id })}
              takenIds={taken}
            />
          </SlotBlock>
        )}

        {slots.generalFeat && (
          <SlotBlock title="General Feat">
            <FeatPicker
              feats={generalFeats}
              selectedId={gains.generalFeatId}
              onSelect={(id) => updateLevelGains(level, { generalFeatId: id })}
              takenIds={taken}
            />
          </SlotBlock>
        )}

        {slots.archetypeFeat && (
          <SlotBlock title="Archetype Feat (Free Archetype)">
            <FeatPicker
              feats={archetypeFeats}
              selectedId={gains.archetypeFeatId}
              onSelect={(id) => updateLevelGains(level, { archetypeFeatId: id })}
              emptyLabel="No archetype feats available at this level."
              takenIds={taken}
            />
          </SlotBlock>
        )}
      </div>
    </details>
  );
}

function LevelOneSummary() {
  const state = useBuilder((s) => s.state);
  const setStep = useBuilder((s) => s.setStep);
  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  const heritage = findHeritage(state.ancestryId, state.heritageId);
  const klass = state.classId ? findClass(state.classId) : undefined;
  const lineage = [heritage?.name, ancestry?.name].filter(Boolean).join(' ');

  const chips = [
    lineage && `${lineage}`,
    klass?.name,
    state.ancestryFeatId && `Ancestry: ${findFeat(state.ancestryFeatId)?.name}`,
    state.classFeatId && `Class: ${findFeat(state.classFeatId)?.name}`,
  ].filter(Boolean) as string[];

  return (
    <details className="panel p-5">
      <summary className="flex cursor-pointer items-center justify-between gap-3">
        <span className="font-display text-lg text-parchment">Level 1 — Creation</span>
        <button
          type="button"
          className="btn py-1 text-xs"
          onClick={(e) => {
            e.preventDefault();
            setStep('ancestry');
          }}
        >
          Edit
        </button>
      </summary>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span
            key={c}
            className="rounded border border-gold-500/25 bg-midnight-700/50 px-2 py-0.5 font-ui text-xs text-parchment/80"
          >
            {c}
          </span>
        ))}
      </div>
      <p className="mt-2 font-ui text-xs text-parchment/50">
        Level 1 is set in the earlier steps. Use the “Edit” button to change it.
      </p>
    </details>
  );
}

export function AdvancementStep() {
  const state = useBuilder((s) => s.state);
  const setLevel = useBuilder((s) => s.setLevel);
  const levelUp = useBuilder((s) => s.levelUp);
  const klass = state.classId ? findClass(state.classId) : undefined;

  if (!klass) {
    return (
      <p className="font-ui text-parchment/70">
        Choose a class first — leveling up adds class feats, skill increases, and more.
      </p>
    );
  }

  const levels = Array.from({ length: state.level }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="mb-1 font-display text-xl text-gold-400">Advancement</h3>
          <p className="max-w-xl font-ui text-sm text-parchment/70">
            You don’t have to build all the way to 20 at once. Set your level, fill in each level’s
            choices, and come back later to <span className="text-gold-400">Level Up</span> when your
            character advances in play.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="font-ui text-sm text-parchment/70">Level</label>
          <select
            className="rounded-lg border border-gold-500/25 bg-midnight-950/50 px-3 py-2 font-display text-parchment focus:border-gold-400/60 focus:outline-none"
            value={state.level}
            onChange={(e) => setLevel(Number(e.target.value))}
          >
            {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={state.level >= MAX_LEVEL}
            onClick={levelUp}
          >
            Level Up →
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <LevelOneSummary />
        {levels
          .filter((l) => l >= 2)
          .map((l) => (
            <LevelCard key={l} level={l} />
          ))}
      </div>
    </div>
  );
}
