import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ABILITY_NAMES, getDataset, findClass, type CharacterClass } from '@/features/builder/data';
import { useBuilder } from '../store';
import { rogueRacketAbility } from '../subclassEffects';
import { ChoiceGrid } from './ChoiceGrid';

// Weapon groups from the item catalog (for the fighter's group-scoped mastery).
const WEAPON_GROUPS = [
  'axe', 'bow', 'brawling', 'club', 'crossbow', 'dart', 'firearm', 'flail',
  'hammer', 'knife', 'pick', 'polearm', 'shield', 'sling', 'spear', 'sword',
];

export function ClassStep() {
  const { classId, keyAbility, subclassId, weaponGroup, monkPaths } = useBuilder((s) => s.state);
  const chooseClass = useBuilder((s) => s.chooseClass);
  const chooseSubclass = useBuilder((s) => s.chooseSubclass);
  const update = useBuilder((s) => s.update);
  const klass = classId ? findClass(classId) : undefined;
  const [hover, setHover] = useState<{ c: CharacterClass; top: number; left: number } | null>(null);

  const showTip = (c: CharacterClass, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = 320;
    let left = r.right + 10;
    if (left + width > window.innerWidth - 8) left = Math.max(8, r.left - width - 10);
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 260));
    setHover({ c, top, left });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Choose a Class</h3>
        <p className="font-ui text-sm text-parchment/70">
          Your class is your calling — it sets your key attribute, Hit Points, proficiencies, and
          signature feats. Hover a class to see what it grants.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {getDataset().classes.map((c) => (
          <button
            key={c.id}
            type="button"
            className="choice-card text-left"
            data-selected={classId === c.id}
            onClick={() => chooseClass(c.id)}
            onMouseEnter={(e) => showTip(c, e.currentTarget)}
            onMouseLeave={() => setHover(null)}
            onFocus={(e) => showTip(c, e.currentTarget)}
            onBlur={() => setHover(null)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-lg text-parchment">{c.name}</span>
              <span className="font-ui text-xs text-parchment/60">{c.hp} HP</span>
            </div>
            <p className="mt-1 font-ui text-sm leading-snug text-parchment/70">{c.description}</p>
          </button>
        ))}
      </div>

      {klass && klass.keyAbility.length > 1 && (
        <div className="panel p-5">
          <h4 className="mb-2 font-display text-lg text-gold-400">Key Attribute</h4>
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
              chooseSubclass(id, racket);
            }}
          />
        </div>
      ) : null}

      {klass?.id === 'monk' && (
        <div className="panel p-5">
          <h4 className="mb-2 font-display text-lg text-gold-400">Paths to Perfection</h4>
          <p className="mb-3 font-ui text-sm text-parchment/70">
            At 7th, 11th, and 15th level you perfect your saving throws: a chosen save becomes
            master (7th), a different save becomes master (11th), and one of those two becomes
            legendary (15th).
          </p>
          <div className="flex flex-wrap gap-4">
            {(['first', 'second', 'third'] as const).map((slot, i) => {
              const label = ['First Path (7th)', 'Second Path (11th)', 'Third Path (15th)'][i];
              const paths = monkPaths ?? {};
              const options = (['fortitude', 'reflex', 'will'] as const).filter((s) => {
                if (slot === 'second') return s !== paths.first;
                if (slot === 'third') return s === paths.first || s === paths.second;
                return true;
              });
              return (
                <label key={slot} className="flex flex-col gap-1 font-ui text-xs text-parchment/70">
                  {label}
                  <select
                    value={paths[slot] ?? ''}
                    onChange={(e) =>
                      update({
                        monkPaths: { ...paths, [slot]: (e.target.value || undefined) as never },
                      })
                    }
                    className="rounded-lg border border-gold-500/25 bg-midnight-950/50 px-2 py-1.5 text-sm text-parchment focus:border-gold-400/60 focus:outline-none"
                  >
                    <option value="">— choose —</option>
                    {options.map((s) => (
                      <option key={s} value={s}>
                        {s[0].toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {klass?.id === 'fighter' && (
        <div className="panel p-5">
          <h4 className="mb-2 font-display text-lg text-gold-400">Weapon Group</h4>
          <p className="mb-3 font-ui text-sm text-parchment/70">
            Fighter Weapon Mastery (5th) and Weapon Legend (13th) raise your proficiency further with
            one weapon group of your choice. Weapons of this group show the higher attack bonus.
          </p>
          <div className="flex flex-wrap gap-2">
            {WEAPON_GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                className="choice-card px-3 py-1.5"
                data-selected={weaponGroup === g}
                onClick={() => update({ weaponGroup: g })}
              >
                <span className="font-ui text-sm text-parchment">{g[0].toUpperCase() + g.slice(1)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {hover &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 w-80 rounded-xl border border-gold-500/40 bg-midnight-900/95 p-3 shadow-rune backdrop-blur"
            style={{ top: hover.top, left: hover.left }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-gold-400">{hover.c.name}</span>
              <span className="font-ui text-[10px] uppercase tracking-wider text-parchment/50">
                {hover.c.hp} HP · {hover.c.keyAbility.map((k) => k.toUpperCase()).join(' or ')}
              </span>
            </div>
            {hover.c.features?.length ? (
              <div className="mt-2">
                <div className="font-ui text-[10px] uppercase tracking-widest text-gold-400/80">
                  You gain at level 1
                </div>
                <p className="mt-0.5 font-ui text-xs leading-relaxed text-parchment/85">
                  {hover.c.features.join(', ')}
                </p>
              </div>
            ) : null}
            {hover.c.subclassLabel && (
              <div className="mt-2 font-ui text-[11px] text-parchment/60">
                Choose a {hover.c.subclassLabel}.
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
