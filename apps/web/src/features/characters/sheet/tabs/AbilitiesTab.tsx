import {
  ABILITY_LABELS,
  ABILITY_ORDER,
  abilityMod,
  fmtMod,
  SKILL_ABILITY,
  SKILL_ORDER,
  type Ability,
  type PathbuilderBuild,
} from '@/features/characters/pathbuilder';
import { perceptionBonus, saveBonus, skillBonus } from '../sheetStats';
import { Panel } from '../Sheet';
import { AbilitiesIcon } from '../icons';

/**
 * Abilities tab — the six ability scores in detail, each with its modifier,
 * everything it governs on this sheet (saves / skills / perception), and the
 * full boost trail from `abilities.breakdown`. Read-only; all values derive
 * from the Pathbuilder build.
 */
export function AbilitiesTab({ build }: { build: PathbuilderBuild }) {
  return (
    <div className="space-y-4">
      <ScoreGrid build={build} />
      <BoostTrail build={build} />
    </div>
  );
}

// ---------------------------------------------------------------
// Big score cards, each with what it drives
// ---------------------------------------------------------------

function ScoreGrid({ build }: { build: PathbuilderBuild }) {
  return (
    <Panel title="Ability Scores" icon={<AbilitiesIcon />}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ABILITY_ORDER.map((ab) => (
          <AbilityCard key={ab} build={build} ability={ab} />
        ))}
      </div>
    </Panel>
  );
}

function AbilityCard({ build, ability }: { build: PathbuilderBuild; ability: Ability }) {
  const score = build.abilities?.[ability] ?? 10;
  const mod = abilityMod(score);
  const governs = governedBy(build, ability);

  return (
    <div className="rounded-md border border-gold/20 bg-midnight-900/50 p-4">
      <div className="flex items-center justify-between">
        <span className="font-display text-sm uppercase tracking-widest text-gold">
          {ABILITY_LABELS[ability]}
        </span>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl text-silver">{score}</span>
          <span className="font-display text-lg text-arcane">{fmtMod(mod)}</span>
        </div>
      </div>

      {governs.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-gold/15 pt-2 text-xs">
          {governs.map((g) => (
            <li key={g.label} className="flex items-center justify-between gap-2">
              <span className="text-silver/70">{g.label}</span>
              <span className="tabular-nums text-silver/90">{g.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The saves / perception / skills this ability governs, with their totals. */
function governedBy(
  build: PathbuilderBuild,
  ability: Ability,
): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];

  // Saves
  if (ability === 'con') out.push({ label: 'Fortitude', value: fmtMod(saveBonus(build, 'fortitude')) });
  if (ability === 'dex') out.push({ label: 'Reflex', value: fmtMod(saveBonus(build, 'reflex')) });
  if (ability === 'wis') {
    out.push({ label: 'Will', value: fmtMod(saveBonus(build, 'will')) });
    out.push({ label: 'Perception', value: fmtMod(perceptionBonus(build)) });
  }

  // Skills governed by this ability
  for (const skill of SKILL_ORDER) {
    if (SKILL_ABILITY[skill] === ability) {
      const rank = build.proficiencies?.[skill];
      if ((rank ?? 0) > 0) {
        out.push({
          label: capitalize(skill),
          value: fmtMod(skillBonus(build, skill)),
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------
// Boost trail — how the scores were built, level by level
// ---------------------------------------------------------------

function BoostTrail({ build }: { build: PathbuilderBuild }) {
  const b = build.abilities?.breakdown;
  if (!b) {
    return (
      <Panel title="Ability Boosts" icon={<AbilitiesIcon />}>
        <p className="py-3 text-center text-sm text-silver/50">
          Pathbuilder didn&apos;t record a boost breakdown for this character.
        </p>
      </Panel>
    );
  }

  const rows: Array<{ label: string; boosts: string[]; flaws?: string[] }> = [];
  if (b.ancestryBoosts?.length || b.ancestryFree?.length || b.ancestryFlaws?.length) {
    rows.push({
      label: 'Ancestry',
      boosts: [...(b.ancestryBoosts ?? []), ...(b.ancestryFree ?? [])],
      flaws: b.ancestryFlaws ?? [],
    });
  }
  if (b.backgroundBoosts?.length) rows.push({ label: 'Background', boosts: b.backgroundBoosts });
  if (b.classBoosts?.length) rows.push({ label: 'Class', boosts: b.classBoosts });
  if (b.mapLevelledBoosts) {
    const levels = Object.keys(b.mapLevelledBoosts)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
      .sort((a, c) => a - c);
    for (const lvl of levels) {
      const arr = b.mapLevelledBoosts[String(lvl)];
      if (arr?.length) rows.push({ label: `Level ${lvl}`, boosts: arr });
    }
  }

  if (rows.length === 0) {
    return (
      <Panel title="Ability Boosts" icon={<AbilitiesIcon />}>
        <p className="py-3 text-center text-sm text-silver/50">—</p>
      </Panel>
    );
  }

  return (
    <Panel title="Ability Boost Trail" icon={<AbilitiesIcon />}>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-gold/15 bg-midnight-900/40 px-3 py-2"
          >
            <span className="w-24 shrink-0 text-[0.65rem] uppercase tracking-widest text-gold/80">
              {r.label}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {r.boosts.map((ab, i) => (
                <Pill key={`${ab}-${i}`} tone="boost">
                  +{ab}
                </Pill>
              ))}
              {r.flaws?.map((ab, i) => (
                <Pill key={`flaw-${ab}-${i}`} tone="flaw">
                  −{ab}
                </Pill>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs italic text-silver/50">
        Ancestry may include free boosts (player&apos;s choice) alongside fixed
        ones; a flaw reduces one score by 2 at 1st level.
      </p>
    </Panel>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'boost' | 'flaw' }) {
  const cls =
    tone === 'boost'
      ? 'border-emerald/40 bg-emerald/10 text-emerald-soft'
      : 'border-red-500/40 bg-red-500/10 text-red-300';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[0.65rem] font-display uppercase tracking-widest ${cls}`}
    >
      {children}
    </span>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
