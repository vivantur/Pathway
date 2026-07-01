import {
  abilityMod,
  type FocusPools,
  type PathbuilderBuild,
  type Spellcaster,
} from '@/features/characters/pathbuilder';
import { Panel } from '../Sheet';
import { SpellsIcon, StarIcon } from '../icons';

/**
 * Full spellcasting deep-dive. Splits the character's `spellCasters` array
 * into non-innate (main casters — one card each with slots per level) vs.
 * innate (compact list, since they're just "1/day this spell"), then adds a
 * Focus Spells panel driven off `build.focus` when a focus pool exists.
 * Fully read-only in this pass.
 */
export function SpellsTab({ build }: { build: PathbuilderBuild }) {
  const casters = build.spellCasters ?? [];
  const focus = build.focus ?? {};
  const mainCasters = casters.filter((c) => !c.innate && hasAnyContent(c));
  const innateCasters = casters.filter((c) => c.innate && hasAnyContent(c));
  const focusEntries = flattenFocus(focus);

  const empty =
    mainCasters.length === 0 &&
    innateCasters.length === 0 &&
    focusEntries.length === 0;

  if (empty) {
    return (
      <div className="space-y-4">
        <Panel title="Spellcasting" icon={<SpellsIcon />}>
          <p className="py-8 text-center text-sm text-silver/50">
            This character has no spellcasting classes, innate spells, or focus spells.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mainCasters.map((c, i) => (
        <SpellcasterPanel key={`c-${i}`} caster={c} build={build} />
      ))}
      {innateCasters.length > 0 && (
        <InnateSpellsPanel casters={innateCasters} />
      )}
      {focusEntries.length > 0 && (
        <FocusSpellsPanel entries={focusEntries} build={build} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// One caster (Wizard, Oracle, Sorcerer, etc.)
// ---------------------------------------------------------------

function SpellcasterPanel({
  caster,
  build,
}: {
  caster: Spellcaster;
  build: PathbuilderBuild;
}) {
  const attack = spellAttackTotal(build, caster);
  const dc = 10 + attack;
  const isPrepared = caster.spellcastingType === 'prepared';
  const preparedByLevel = groupPreparedByLevel(caster);

  return (
    <Panel title={caster.name} icon={<SpellsIcon />}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <TraditionBadge tradition={caster.magicTradition} />
          <TypeBadge type={caster.spellcastingType} />
          <span className="inline-flex items-center rounded border border-gold/20 bg-midnight-900/60 px-2 py-0.5 text-[0.65rem] uppercase tracking-widest text-silver/70">
            Casting {String(caster.ability).toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <MetricPair label="Attack" value={fmtSigned(attack)} />
          <MetricPair label="DC" value={dc} />
        </div>
      </div>

      <div className="space-y-3">
        {caster.spells
          ?.slice()
          .sort((a, b) => a.spellLevel - b.spellLevel)
          .map((sl) => {
            const slots = caster.perDay?.[sl.spellLevel] ?? 0;
            const prepared = preparedByLevel[sl.spellLevel] ?? [];
            return (
              <SpellLevelRow
                key={sl.spellLevel}
                level={sl.spellLevel}
                spells={sl.list ?? []}
                slots={slots}
                prepared={prepared}
                showPrepared={isPrepared && prepared.length > 0}
              />
            );
          })}
      </div>
    </Panel>
  );
}

function SpellLevelRow({
  level,
  spells,
  slots,
  prepared,
  showPrepared,
}: {
  level: number;
  spells: string[];
  slots: number;
  prepared: string[];
  showPrepared: boolean;
}) {
  return (
    <div className="border-l-2 border-gold/25 pl-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="font-display uppercase tracking-widest text-gold/90">
          {level === 0 ? 'Cantrips' : `Level ${level}`}
        </span>
        {slots > 0 && (
          <span className="flex items-center gap-2 text-silver/60">
            <SlotDots count={slots} />
            <span className="text-[0.65rem] uppercase tracking-widest">
              {slots} per day
            </span>
          </span>
        )}
      </div>
      {showPrepared && (
        <div className="mb-1.5 text-[0.65rem] uppercase tracking-widest text-arcane/80">
          Prepared today: {prepared.join(', ')}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {spells.length === 0 ? (
          <span className="text-xs text-silver/40">—</span>
        ) : (
          spells.map((name) => <SpellChip key={name} name={name} />)
        )}
      </div>
    </div>
  );
}

function SlotDots({ count }: { count: number }) {
  // Just visual, all unspent for now — live slot tracking (which lives in
  // `overlay.daily.slots_used`) will wire up when the sheet becomes editable.
  const dots = Math.min(count, 8);
  return (
    <span className="flex gap-1">
      {Array.from({ length: dots }).map((_, i) => (
        <span key={i} className="h-2 w-2 rounded-full border border-gold/60" aria-hidden />
      ))}
      {count > 8 && <span className="ml-1 text-[0.65rem] text-silver/50">+{count - 8}</span>}
    </span>
  );
}

// ---------------------------------------------------------------
// Innate spells (compact)
// ---------------------------------------------------------------

function InnateSpellsPanel({ casters }: { casters: Spellcaster[] }) {
  return (
    <Panel title="Innate Spells" icon={<StarIcon />}>
      <ul className="space-y-3">
        {casters.map((c, i) => {
          const spells = flattenSpellList(c);
          if (spells.length === 0) return null;
          return (
            <li
              key={`in-${i}`}
              className="rounded border border-gold/15 bg-midnight-900/40 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-display text-gold">{c.name}</span>
                <TraditionBadge tradition={c.magicTradition} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {spells.map((entry) => (
                  <SpellChip
                    key={`${entry.level}-${entry.name}`}
                    name={entry.name}
                    tag={`${perDayLabel(c, entry.level)}`}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------
// Focus spells
// ---------------------------------------------------------------

type FocusEntry = {
  tradition: string;
  ability: string;
  focusSpells: string[];
  focusCantrips: string[];
  abilityBonus?: number;
  proficiency?: number;
  itemBonus?: number;
};

function flattenFocus(focus: FocusPools): FocusEntry[] {
  const out: FocusEntry[] = [];
  for (const [tradition, byAbility] of Object.entries(focus)) {
    for (const [ability, data] of Object.entries(byAbility)) {
      const focusSpells = Array.isArray(data.focusSpells) ? data.focusSpells : [];
      const focusCantrips = Array.isArray(data.focusCantrips) ? data.focusCantrips : [];
      if (focusSpells.length === 0 && focusCantrips.length === 0) continue;
      out.push({
        tradition,
        ability,
        focusSpells,
        focusCantrips,
        abilityBonus: data.abilityBonus,
        proficiency: data.proficiency,
        itemBonus: data.itemBonus,
      });
    }
  }
  return out;
}

function FocusSpellsPanel({
  entries,
  build,
}: {
  entries: FocusEntry[];
  build: PathbuilderBuild;
}) {
  return (
    <Panel title="Focus Spells" icon={<StarIcon />}>
      <ul className="space-y-3">
        {entries.map((e, i) => {
          const level = build.level ?? 1;
          const rank = e.proficiency ?? 0;
          const focusAttack = rank > 0 ? level + rank + (e.abilityBonus ?? 0) + (e.itemBonus ?? 0) : (e.abilityBonus ?? 0);
          const focusDC = 10 + focusAttack;
          return (
            <li
              key={`f-${i}`}
              className="rounded border border-gold/15 bg-midnight-900/40 p-3"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <TraditionBadge tradition={e.tradition} />
                  <span className="text-silver/60">Casting {e.ability.toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-4">
                  <MetricPair label="Focus Attack" value={fmtSigned(focusAttack)} />
                  <MetricPair label="DC" value={focusDC} />
                </div>
              </div>
              {e.focusCantrips.length > 0 && (
                <div className="mb-1.5">
                  <div className="mb-1 text-[0.6rem] uppercase tracking-widest text-gold/70">
                    Focus Cantrips
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {e.focusCantrips.map((name) => (
                      <SpellChip key={name} name={name} />
                    ))}
                  </div>
                </div>
              )}
              {e.focusSpells.length > 0 && (
                <div>
                  <div className="mb-1 text-[0.6rem] uppercase tracking-widest text-gold/70">
                    Focus Spells
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {e.focusSpells.map((name) => (
                      <SpellChip key={name} name={name} />
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------

function SpellChip({ name, tag }: { name: string; tag?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-gold/15 bg-midnight-900/60 px-2 py-1 text-xs text-silver/90">
      {name}
      {tag && <span className="text-[0.65rem] uppercase tracking-widest text-silver/50">{tag}</span>}
    </span>
  );
}

function TraditionBadge({ tradition }: { tradition: string }) {
  const cls =
    tradition === 'arcane'
      ? 'border-arcane/50 bg-arcane/10 text-arcane'
      : tradition === 'divine'
      ? 'border-gold/50 bg-gold/10 text-gold'
      : tradition === 'occult'
      ? 'border-brass/60 bg-brass/10 text-gold-soft'
      : tradition === 'primal'
      ? 'border-emerald/50 bg-emerald/10 text-emerald-soft'
      : 'border-gold/20 bg-midnight-900/60 text-silver/80';
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[0.65rem] font-display uppercase tracking-widest ${cls}`}
    >
      {tradition}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center rounded border border-gold/20 bg-midnight-900/60 px-2 py-0.5 text-[0.65rem] uppercase tracking-widest text-silver/70">
      {type}
    </span>
  );
}

function MetricPair({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[0.6rem] uppercase tracking-widest text-silver/50">{label}</span>
      <span className="font-display text-arcane">{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------
// Math (duplicated locally so this file has no runtime coupling to Overview)
// ---------------------------------------------------------------

function spellAttackTotal(build: PathbuilderBuild, c: Spellcaster): number {
  const level = build.level ?? 1;
  const ab = abilityMod(build.abilities?.[c.ability]);
  const rank = c.proficiency ?? 0;
  return rank > 0 ? level + rank + ab : ab;
}

function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function hasAnyContent(c: Spellcaster): boolean {
  return (c.spells ?? []).some((s) => (s.list ?? []).length > 0);
}

function flattenSpellList(c: Spellcaster): Array<{ level: number; name: string }> {
  const out: Array<{ level: number; name: string }> = [];
  for (const sl of c.spells ?? []) {
    for (const name of sl.list ?? []) out.push({ level: sl.spellLevel, name });
  }
  return out;
}

function perDayLabel(c: Spellcaster, level: number): string {
  const n = c.perDay?.[level] ?? 1;
  return n === 1 ? '1/day' : `${n}/day`;
}

/**
 * `prepared` in the Pathbuilder schema is a per-day preparation list — same
 * structure as `spells` (array of `{ spellLevel, list }`), but typed here as
 * unknown-ish because the Pathbuilder types allow variation. Normalize to a
 * level → string[] map.
 */
function groupPreparedByLevel(c: Spellcaster): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const entry of c.prepared ?? []) {
    const lvl = entry?.spellLevel;
    const list = entry?.list;
    if (typeof lvl !== 'number' || !Array.isArray(list)) continue;
    out[lvl] = (out[lvl] ?? []).concat(list);
  }
  return out;
}
