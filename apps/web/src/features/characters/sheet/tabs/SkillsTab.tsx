import {
  ABILITY_LABELS,
  abilityMod,
  fmtMod,
  profLabel,
  SKILL_ABILITY,
  SKILL_ORDER,
  type Ability,
  type PathbuilderBuild,
} from '@/features/characters/pathbuilder';
import { perceptionBonus, saveBonus, skillBonus } from '../sheetStats';
import { Panel } from '../Sheet';
import { BrainIcon, EyeIcon, RunningIcon, ShieldPlusIcon, SkillsIcon } from '../icons';

/**
 * Skills tab — every skill with its full proficiency math laid bare, plus a
 * Saves + Perception panel (they share the same "ability mod + rank + level"
 * formula, so it's natural to show the breakdown alongside). Trained skills
 * are emphasised; untrained ones are dimmed but still shown so the reader
 * can see the full picture. Lores get their own section.
 */
export function SkillsTab({ build }: { build: PathbuilderBuild }) {
  return (
    <div className="space-y-4">
      <DefensesPanel build={build} />
      <SkillTablePanel build={build} />
      <LorePanel build={build} />
    </div>
  );
}

// ---------------------------------------------------------------
// Saves + Perception (same proficiency math)
// ---------------------------------------------------------------

function DefensesPanel({ build }: { build: PathbuilderBuild }) {
  const level = build.level ?? 1;
  const rows = [
    {
      label: 'Perception',
      icon: <EyeIcon />,
      ability: 'wis' as Ability,
      rank: build.proficiencies?.perception,
      total: perceptionBonus(build),
    },
    {
      label: 'Fortitude',
      icon: <ShieldPlusIcon />,
      ability: 'con' as Ability,
      rank: build.proficiencies?.fortitude,
      total: saveBonus(build, 'fortitude'),
    },
    {
      label: 'Reflex',
      icon: <RunningIcon />,
      ability: 'dex' as Ability,
      rank: build.proficiencies?.reflex,
      total: saveBonus(build, 'reflex'),
    },
    {
      label: 'Will',
      icon: <BrainIcon />,
      ability: 'wis' as Ability,
      rank: build.proficiencies?.will,
      total: saveBonus(build, 'will'),
    },
  ];

  return (
    <Panel title="Saves & Perception" icon={<ShieldPlusIcon />}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r) => (
          <div
            key={r.label}
            className="rounded-md border border-gold/20 bg-midnight-900/50 p-3 text-center"
          >
            <div className="flex items-center justify-center gap-1.5 text-[0.65rem] uppercase tracking-widest text-gold/80">
              <span className="text-sm text-gold">{r.icon}</span>
              {r.label}
            </div>
            <div className="my-1 font-display text-2xl text-silver">{fmtMod(r.total)}</div>
            <div className="text-[0.6rem] uppercase tracking-wider text-silver/50">
              {profLabel(r.rank)}
            </div>
            <div className="mt-1 text-[0.6rem] text-silver/40">
              {breakdownText(build, r.ability, r.rank, level)}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------
// Full skills table with the math spelled out
// ---------------------------------------------------------------

function SkillTablePanel({ build }: { build: PathbuilderBuild }) {
  const level = build.level ?? 1;
  const trainedCount = SKILL_ORDER.filter((s) => (build.proficiencies?.[s] ?? 0) > 0).length;

  return (
    <Panel title={`Skills — ${trainedCount} trained`} icon={<SkillsIcon />}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gold/25 text-[0.6rem] uppercase tracking-widest text-gold/80">
              <th className="py-1.5 pl-2 pr-3">Skill</th>
              <th className="py-1.5 pr-3">Key</th>
              <th className="py-1.5 pr-3">Rank</th>
              <th className="py-1.5 pr-3 text-right">Total</th>
              <th className="py-1.5 pr-2 text-right">Breakdown</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gold/10">
            {SKILL_ORDER.map((skill) => {
              const ability = SKILL_ABILITY[skill] as Ability;
              const rank = build.proficiencies?.[skill];
              const trained = (rank ?? 0) > 0;
              const total = skillBonus(build, skill);
              return (
                <tr key={skill} className={`align-top ${trained ? '' : 'opacity-45'}`}>
                  <td className="py-1.5 pl-2 pr-3 font-display capitalize text-silver">
                    {skill}
                  </td>
                  <td className="py-1.5 pr-3 text-xs uppercase tracking-wider text-silver/60">
                    {ABILITY_LABELS[ability]}
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-silver/70">{profLabel(rank)}</td>
                  <td className="py-1.5 pr-3 text-right font-display tabular-nums text-arcane">
                    {fmtMod(total)}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-[0.65rem] text-silver/40">
                    {breakdownText(build, ability, rank, level)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs italic text-silver/50">
        Total = ability modifier + (proficiency rank + level) when trained or
        better. Item, circumstance, and status bonuses from feats or gear
        aren&apos;t included here.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------
// Lore skills
// ---------------------------------------------------------------

function LorePanel({ build }: { build: PathbuilderBuild }) {
  const lores = build.lores ?? [];
  if (lores.length === 0) return null;

  const int = abilityMod(build.abilities?.int);
  const level = build.level ?? 1;

  return (
    <Panel title={`Lore (${lores.length})`} icon={<SkillsIcon />}>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {lores.map(([name, rank]) => {
          const total = (rank ?? 0) > 0 ? int + rank + level : int;
          return (
            <li
              key={name}
              className="flex items-center justify-between rounded border border-gold/15 bg-midnight-900/40 px-3 py-2"
            >
              <div>
                <div className="text-sm text-silver/90">{name} Lore</div>
                <div className="text-[0.6rem] uppercase tracking-wider text-silver/50">
                  {profLabel(rank)} · INT
                </div>
              </div>
              <span className="font-display tabular-nums text-arcane">{fmtMod(total)}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------
// Shared
// ---------------------------------------------------------------

/** "DEX +3 · trained +2 · level +5" style math trail. */
function breakdownText(
  build: PathbuilderBuild,
  ability: Ability,
  rank: number | undefined,
  level: number,
): string {
  const mod = abilityMod(build.abilities?.[ability]);
  const parts = [`${ability.toUpperCase()} ${fmtMod(mod)}`];
  if ((rank ?? 0) > 0) {
    parts.push(`prof ${fmtMod(rank ?? 0)}`);
    parts.push(`lvl ${fmtMod(level)}`);
  }
  return parts.join(' · ');
}
