import {
  ABILITY_NAMES,
  getDataset,
  findAncestry,
  findBackground,
  findClass,
} from '@/features/builder/data';
import { deriveCharacter, freeSkillCount, trainedSkillIds } from '../rules';
import { useBuilder } from '../store';

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function SkillsStep() {
  const state = useBuilder((s) => s.state);
  const toggleSkill = useBuilder((s) => s.toggleSkill);
  const toggleLanguage = useBuilder((s) => s.toggleLanguage);

  const klass = state.classId ? findClass(state.classId) : undefined;
  const background = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  if (!klass) {
    return <p className="font-ui text-parchment/70">Choose a class first to train skills.</p>;
  }

  const maxFree = freeSkillCount(state);
  const chosen = new Set(state.skillChoices);
  const granted = trainedSkillIds({ ...state, skillChoices: [] }); // class + background auto-trained
  const derived = deriveCharacter(state);
  const modById = new Map(derived.skills.map((s) => [s.id, s.modifier]));

  const remaining = maxFree - chosen.size;

  // Languages: ancestry's fixed bonus slots + your Intelligence modifier (if positive).
  const intMod = derived.mods.int;
  const bonusLangs = (ancestry?.bonusLanguages ?? 0) + Math.max(0, intMod);
  const langPool = (ancestry?.bonusLanguageChoices ?? []).filter(
    (l) => !(ancestry?.languages ?? []).includes(l),
  );
  const chosenLangs = new Set(state.languageChoices);
  const langsRemaining = bonusLangs - chosenLangs.size;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Train Skills</h3>
        <p className="font-ui text-sm text-parchment/70">
          Your class and background train some skills automatically. You may train{' '}
          <span className="text-gold-400">{maxFree}</span> more of your choice
          {klass.initialProficiencies.trainedSkillCount !== maxFree
            ? ' (including your Intelligence bonus)'
            : ''}
          .{' '}
          <span className={remaining === 0 ? 'text-green-300' : 'text-gold-400'}>
            {remaining} remaining.
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {getDataset().skills.map((skill) => {
          const isGranted = granted.has(skill.id);
          const isChosen = chosen.has(skill.id);
          const trained = isGranted || isChosen;
          const disabled = isGranted || (!isChosen && remaining === 0);
          return (
            <button
              key={skill.id}
              type="button"
              disabled={disabled}
              onClick={() => toggleSkill(skill.id, maxFree)}
              className="choice-card flex items-center justify-between disabled:cursor-not-allowed disabled:opacity-100"
              data-selected={trained}
            >
              <span className="flex flex-col text-left">
                <span className="font-display text-parchment">{skill.name}</span>
                <span className="font-ui text-xs text-parchment/60">{ABILITY_NAMES[skill.ability]}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-display text-gold-400">{sign(modById.get(skill.id) ?? 0)}</span>
                {isGranted && (
                  <span className="rounded bg-midnight-600/70 px-1.5 py-0.5 font-ui text-[10px] uppercase tracking-wider text-parchment/60">
                    {background && background.trainedSkill === skill.id ? 'Background' : 'Class'}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {ancestry && (
        <div className="panel flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-display text-lg text-gold-400">Languages</h4>
            {bonusLangs > 0 && (
              <span className={`font-ui text-xs ${langsRemaining === 0 ? 'text-green-300' : 'text-gold-400'}`}>
                {chosenLangs.size}/{bonusLangs} chosen
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(ancestry.languages ?? []).map((l) => (
              <span
                key={l}
                className="rounded border border-gold-500/30 bg-gold-500/10 px-2.5 py-1 font-ui text-xs text-gold-400"
                title="Known from your ancestry"
              >
                {l}
              </span>
            ))}
          </div>
          {bonusLangs > 0 ? (
            <>
              <p className="font-ui text-xs text-parchment/60">
                Choose {bonusLangs} additional language{bonusLangs > 1 ? 's' : ''}
                {intMod > 0 ? ` (${intMod} from Intelligence)` : ''}.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {langPool.map((l) => {
                  const isChosen = chosenLangs.has(l);
                  const disabled = !isChosen && langsRemaining === 0;
                  return (
                    <button
                      key={l}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleLanguage(l, bonusLangs)}
                      className="choice-card px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                      data-selected={isChosen}
                    >
                      <span className="font-ui text-sm text-parchment">{l}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="font-ui text-xs text-parchment/50">
              No additional languages (a positive Intelligence modifier grants more).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
