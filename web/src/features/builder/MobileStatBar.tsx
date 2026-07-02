import { deriveCharacter } from './rules';
import { spellStats } from './spellcasting';
import { useBuilder } from './store';

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex shrink-0 flex-col items-center rounded-md border border-gold-500/20 bg-midnight-800/70 px-2.5 py-1">
      <span className="font-display text-sm leading-none text-gold-400">{value}</span>
      <span className="font-ui text-[9px] uppercase tracking-wider text-parchment/60">{label}</span>
    </div>
  );
}

/**
 * A compact, horizontally-scrollable stat strip that sticks to the top on small
 * screens, so a mobile builder can always see key numbers while choosing.
 * Hidden on desktop, where the full sidebar summary is visible instead.
 */
export function MobileStatBar() {
  const state = useBuilder((s) => s.state);
  const d = deriveCharacter(state);
  const spells = spellStats(state);

  return (
    <div className="sticky top-0 z-30 rounded-lg border border-gold-500/20 bg-midnight-950/90 p-2 backdrop-blur lg:hidden">
      <div className="flex gap-2 overflow-x-auto">
        <Stat label="HP" value={d.maxHp} />
        <Stat label="AC" value={d.shieldBonus ? `${d.ac}/${d.ac + d.shieldBonus}` : d.ac} />
        <Stat label="Perc" value={sign(d.perception)} />
        <Stat label="Fort" value={sign(d.saves.fortitude)} />
        <Stat label="Ref" value={sign(d.saves.reflex)} />
        <Stat label="Will" value={sign(d.saves.will)} />
        <Stat label="ClsDC" value={d.classDc} />
        <Stat label="Spd" value={`${d.speed}`} />
        {spells && <Stat label="SpDC" value={spells.dc} />}
      </div>
    </div>
  );
}
