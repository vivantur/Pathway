import {
  ABILITY_KEYS,
  ABILITY_NAMES,
  findAncestry,
  findBackground,
  findClass,
  findHeritage,
} from '@/features/builder/data';
import { deriveCharacter } from './rules';
import { spellStats } from './spellcasting';
import { useBuilder } from './store';

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gold-500/20 bg-midnight-800/60 px-3 py-2 text-center">
      <div className="font-display text-xl text-gold-400">{value}</div>
      <div className="font-ui text-[10px] uppercase tracking-widest text-parchment/60">{label}</div>
    </div>
  );
}

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function CharacterSummary() {
  const state = useBuilder((s) => s.state);
  const d = deriveCharacter(state);

  const ancestry = state.ancestryId ? findAncestry(state.ancestryId) : undefined;
  const heritage = findHeritage(state.ancestryId, state.heritageId);
  const background = state.backgroundId ? findBackground(state.backgroundId) : undefined;
  const klass = state.classId ? findClass(state.classId) : undefined;

  const lineage = [heritage?.name, ancestry?.name].filter(Boolean).join(' ');
  const trained = d.skills.filter((s) => s.rank > 0);
  const spells = spellStats(state);
  const spellCount =
    state.spellcasting.cantrips.length +
    Object.values(state.spellcasting.spellsByRank).reduce((n, ids) => n + ids.length, 0);

  return (
    <aside className="panel flex flex-col gap-4 p-5 lg:sticky lg:top-6">
      <div className="flex items-center gap-3">
        {state.portrait && (
          <img
            src={state.portrait}
            alt=""
            className="h-14 w-14 shrink-0 rounded-full border border-gold-500/40 object-cover"
          />
        )}
        <div className="min-w-0">
          <h2 className="truncate font-display text-2xl text-parchment">
            {state.name || 'Unnamed Adventurer'}
          </h2>
          <p className="font-ui text-sm text-parchment/70">
            Level {state.level} {lineage || 'Ancestry'} {klass?.name ?? 'Class'}
            {background ? ` · ${background.name}` : ''}
          </p>
        </div>
      </div>

      <div className="rune-divider" />

      <div className="grid grid-cols-3 gap-2">
        {ABILITY_KEYS.map((k) => (
          <div
            key={k}
            className="rounded-lg border border-gold-500/20 bg-midnight-800/50 px-2 py-2 text-center"
            title={ABILITY_NAMES[k]}
          >
            <div className="font-ui text-[10px] uppercase tracking-widest text-parchment/60">
              {k.toUpperCase()}
            </div>
            <div className="font-display text-lg text-parchment">{d.scores[k]}</div>
            <div className="font-ui text-xs text-gold-400">{sign(d.mods[k])}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatBox label="Max HP" value={d.maxHp} />
        <StatBox label="AC" value={d.shieldBonus ? `${d.ac} / ${d.ac + d.shieldBonus}` : d.ac} />
        <StatBox label="Perception" value={sign(d.perception)} />
        <StatBox label="Fort" value={sign(d.saves.fortitude)} />
        <StatBox label="Reflex" value={sign(d.saves.reflex)} />
        <StatBox label="Will" value={sign(d.saves.will)} />
        <StatBox label="Class DC" value={d.classDc} />
        <StatBox label="Speed" value={`${d.speed} ft`} />
        <StatBox label="Trained" value={trained.length} />
      </div>

      {spells && (
        <div className="grid grid-cols-3 gap-2">
          <StatBox label="Spell Atk" value={sign(spells.attack)} />
          <StatBox label="Spell DC" value={spells.dc} />
          <StatBox label="Spells" value={spellCount} />
        </div>
      )}

      {d.weapons.length > 0 && (
        <div>
          <div className="mb-1 font-ui text-[10px] uppercase tracking-widest text-parchment/60">
            Equipped weapons
          </div>
          <div className="flex flex-col gap-1">
            {d.weapons.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between rounded border border-gold-500/20 bg-midnight-800/50 px-2 py-1 font-ui text-xs text-parchment/80"
              >
                <span>{w.name}</span>
                <span className="text-gold-400">
                  {sign(w.attack)} · 1{w.damageDie}
                  {w.damageMod ? sign(w.damageMod) : ''} {w.damageType}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {trained.length > 0 && (
        <div>
          <div className="mb-1 font-ui text-[10px] uppercase tracking-widest text-parchment/60">
            Trained skills
          </div>
          <div className="flex flex-wrap gap-1">
            {trained.map((s) => (
              <span
                key={s.id}
                className="rounded border border-gold-500/25 bg-midnight-700/50 px-2 py-0.5 font-ui text-xs text-parchment/80"
              >
                {s.name} {sign(s.modifier)}
              </span>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
