import { useState, type FormEvent } from 'react';
import {
  ABILITY_NAMES,
  allLanguages,
  getDataset,
  findAncestry,
  findBackground,
  findClass,
} from '@/features/builder/data';
import {
  backgroundLoreSubject,
  deriveCharacter,
  freeSkillCount,
  loreDisplayName,
  trainedSkillIds,
} from '../rules';
import { useBuilder } from '../store';

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

// Common Lore subjects, offered as one-tap suggestions. The player can type any
// subject — these are just a convenient starting set, not an exhaustive rule.
const LORE_SUGGESTIONS = [
  'Academia',
  'Warfare',
  'Underworld',
  'Mercantile',
  'Legal',
  'Heraldry',
  'Engineering',
  'Sailing',
  'Farming',
  'Hunting',
  'Herbalism',
  'Tavern',
];

export function SkillsStep() {
  const state = useBuilder((s) => s.state);
  const toggleSkill = useBuilder((s) => s.toggleSkill);
  const addLore = useBuilder((s) => s.addLore);
  const removeLore = useBuilder((s) => s.removeLore);
  const toggleLanguage = useBuilder((s) => s.toggleLanguage);

  const [loreInput, setLoreInput] = useState('');
  const [langFilter, setLangFilter] = useState('');

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

  // Trained skills and chosen Lores share one free-skill pool.
  const loreList = state.loreChoices ?? [];
  const remaining = maxFree - chosen.size - loreList.length;
  const bgLore = backgroundLoreSubject(state);

  // Languages: ancestry's fixed bonus slots + your Intelligence modifier (if positive).
  const intMod = derived.mods.int;
  const bonusLangs = (ancestry?.bonusLanguages ?? 0) + Math.max(0, intMod);
  const known = ancestry?.languages ?? [];
  const chosenLangs = new Set(state.languageChoices);
  const langsRemaining = bonusLangs - chosenLangs.size;
  // The full roster, minus what this ancestry already speaks. Any language is
  // available — no per-ancestry preset — so nothing is silently off-limits.
  const langQuery = langFilter.trim().toLowerCase();
  const langPool = allLanguages()
    .filter((l) => !known.includes(l))
    .filter((l) => !langQuery || l.toLowerCase().includes(langQuery));

  function submitLore(e: FormEvent) {
    e.preventDefault();
    const clean = loreInput.trim();
    if (!clean || remaining <= 0) return;
    addLore(clean, maxFree - chosen.size);
    setLoreInput('');
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Train Skills</h3>
        <p className="font-ui text-sm text-parchment/70">
          Your class and background train some skills automatically. You may train{' '}
          <span className="text-gold-400">{maxFree}</span> more of your choice
          {klass.initialProficiencies.trainedSkillCount !== maxFree
            ? ' (including your Intelligence bonus)'
            : ''}{' '}
          — a slot can go to any skill <em>or</em> a Lore.{' '}
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
              // Reserve the slots already spent on Lore so the two can't overcommit.
              onClick={() => toggleSkill(skill.id, maxFree - loreList.length)}
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

      {/* Lore skills -------------------------------------------------------- */}
      <div className="panel flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="font-display text-lg text-gold-400">Lore Skills</h4>
          <span className="font-ui text-xs text-parchment/60">
            Intelligence · pick a subject
          </span>
        </div>
        <p className="font-ui text-xs text-parchment/60">
          A Lore covers a narrow field of knowledge (a place, trade, or topic). Each Lore you train
          spends one free skill slot.
        </p>

        {/* Trained lores: background-granted (free) + chosen (removable) */}
        <div className="flex flex-wrap gap-1.5">
          {bgLore && (
            <span
              className="flex items-center gap-1.5 rounded border border-gold-500/30 bg-gold-500/10 px-2.5 py-1 font-ui text-xs text-gold-400"
              title="Granted by your background"
            >
              {loreDisplayName(bgLore)}
              <span className="rounded bg-midnight-600/70 px-1 text-[9px] uppercase tracking-wider text-parchment/60">
                Background
              </span>
            </span>
          )}
          {loreList.map((subject) => (
            <span
              key={subject}
              className="flex items-center gap-1.5 rounded border border-gold-500/40 bg-gold-500/15 px-2.5 py-1 font-ui text-xs text-parchment"
            >
              {loreDisplayName(subject)}
              <button
                type="button"
                onClick={() => removeLore(subject)}
                className="text-parchment/60 hover:text-red-300"
                aria-label={`Remove ${loreDisplayName(subject)}`}
              >
                ×
              </button>
            </span>
          ))}
          {!bgLore && loreList.length === 0 && (
            <span className="font-ui text-xs text-parchment/45">No Lore trained yet.</span>
          )}
        </div>

        {remaining > 0 ? (
          <>
            <form onSubmit={submitLore} className="flex flex-wrap items-center gap-2">
              <input
                value={loreInput}
                onChange={(e) => setLoreInput(e.target.value)}
                placeholder="Lore subject — e.g. Warfare"
                className="min-w-0 flex-1 rounded-md border border-gold-500/20 bg-midnight-900 px-3 py-1.5 font-ui text-sm text-parchment placeholder:text-parchment/30 focus:border-gold-500/60 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!loreInput.trim()}
                className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-ui text-sm text-gold-400 hover:border-gold-500/70 disabled:opacity-50"
              >
                Add Lore
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {LORE_SUGGESTIONS.filter(
                (s) => !loreList.some((l) => l.toLowerCase() === s.toLowerCase()),
              ).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addLore(s, maxFree - chosen.size)}
                  className="choice-card px-2.5 py-1 font-ui text-xs text-parchment/80"
                >
                  + {s}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="font-ui text-xs text-parchment/50">
            No free slots left for Lore. Free a trained skill above to add one.
          </p>
        )}
      </div>

      {/* Languages ---------------------------------------------------------- */}
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
            {known.map((l) => (
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
              <input
                value={langFilter}
                onChange={(e) => setLangFilter(e.target.value)}
                placeholder="Filter languages…"
                className="w-full max-w-xs rounded-md border border-gold-500/20 bg-midnight-900 px-3 py-1.5 font-ui text-sm text-parchment placeholder:text-parchment/30 focus:border-gold-500/60 focus:outline-none"
              />
              <div className="flex max-h-60 flex-wrap gap-1.5 overflow-y-auto">
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
                {langPool.length === 0 && (
                  <span className="font-ui text-xs text-parchment/45">No languages match “{langFilter}”.</span>
                )}
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
