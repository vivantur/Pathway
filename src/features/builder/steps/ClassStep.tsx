import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ABILITY_NAMES, getDataset, findClass, type CharacterClass } from '@/features/builder/data';
import { useBuilder } from '../store';
import { rogueRacketAbility } from '../subclassEffects';
import { ChoiceGrid } from './ChoiceGrid';

export function ClassStep() {
  const { classId, keyAbility, subclassId } = useBuilder((s) => s.state);
  const chooseClass = useBuilder((s) => s.chooseClass);
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
          Your class is your calling — it sets your key ability, Hit Points, proficiencies, and
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
