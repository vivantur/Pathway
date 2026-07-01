import { Link, useParams } from 'react-router-dom';
import { GildedRule } from '@/components/ui/GildedRule';
import { Spinner } from '@/components/ui/Spinner';
import { useCharacter } from '@/features/characters/useCharacter';
import { isSchemaNotReady } from '@/features/characters/errors';
import type { CharacterRow, PathbuilderData } from '@/features/characters/types';
import {
  ABILITY_LABELS, ABILITY_ORDER, SKILL_ORDER, SKILL_ABILITY,
  abilityMod, fmtMod, profLabel, sizeLabel,
  perceptionBonus, saveBonus, skillBonus,
  maxHp, speed, acTotal, classDC,
  type Ability, type PathbuilderBuild,
} from '@/features/characters/pathbuilder';

/**
 * Character sheet page — the payoff for opening a card in the Vault.
 *
 * Reads the build (`pathbuilder_data`) plus live play state (columns) and
 * renders a grimoire-styled sheet. This is v1: display-only, no editing yet.
 */
export function CharacterPage() {
  const { charKey } = useParams<{ charKey: string }>();
  const { data, isLoading, isError, error } = useCharacter(charKey);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Retrieving character…" />
      </div>
    );
  }

  if (isError && isSchemaNotReady(error)) {
    return (
      <ErrorPanel>
        Your database isn&apos;t set up yet.
      </ErrorPanel>
    );
  }

  if (isError) {
    return (
      <ErrorPanel tone="danger">
        Couldn&apos;t load this character: {error instanceof Error ? error.message : 'unknown error'}
      </ErrorPanel>
    );
  }

  if (!data) {
    return <NotFoundPanel charKey={charKey ?? ''} />;
  }

  return <CharacterSheet character={data} />;
}

// ---------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------

function CharacterSheet({ character }: { character: CharacterRow }) {
  const build = unwrapBuild(character.pathbuilder_data);
  const level = build?.level ?? 1;
  const maxHitPoints = maxHp(build ?? {});
  const ac = build ? acTotal(build) : undefined;
  const spd = build ? speed(build) : undefined;
  const perception = build ? perceptionBonus(build) : undefined;

  return (
    <article className="space-y-10">
      {/* Back link */}
      <div>
        <Link
          to="/vault"
          className="text-sm text-silver/60 transition-colors hover:text-gold"
        >
          ← Character Vault
        </Link>
      </div>

      {/* Header */}
      <header className="rounded-lg border border-gold/20 bg-midnight-700/50 p-6 shadow-gilded">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl leading-tight text-gold">
              {character.name}
            </h1>
            <p className="mt-1 text-sm uppercase tracking-widest text-silver/40">
              {character.char_key}
            </p>
            <p className="mt-4 max-w-xl leading-relaxed text-silver/80">
              {[
                sizeLabel(build?.size),
                build?.ancestry,
                build?.heritage,
              ].filter(Boolean).join(' ') || '—'}
              {build?.class && (
                <>
                  {' • '}
                  <span className="text-silver/95">{build.class}</span>
                </>
              )}
              {build?.background && (
                <>
                  {' • '}
                  <span className="text-silver/70">{build.background}</span>
                </>
              )}
              {build?.deity && (
                <>
                  {' • '}
                  <span className="text-silver/70">devoted to {build.deity}</span>
                </>
              )}
            </p>
          </div>
          <div className="rounded-md border border-gold/30 px-4 py-2 text-center">
            <div className="text-xs uppercase tracking-wider text-silver/50">Level</div>
            <div className="font-display text-3xl text-gold">{level}</div>
          </div>
        </div>

        <GildedRule className="my-6" />

        {/* Live state row */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <LiveStat label="HP" value={character.current_hp} max={maxHitPoints} tone="hp" />
          <LiveStat label="Hero" value={character.hero_points} tone="hero" />
          <LiveStat label="Dying" value={character.dying} tone="danger" />
          <LiveStat label="Wounded" value={character.wounded} tone="danger" />
          <LiveStat label="XP" value={character.experience} max={1000} tone="xp" />
        </dl>
      </header>

      {build ? (
        <>
          {/* Ability scores + core stats */}
          <section className="grid gap-6 lg:grid-cols-2">
            <AbilitiesPanel build={build} />
            <CoreStatsPanel
              build={build}
              ac={ac}
              perception={perception}
              speed={spd}
            />
          </section>

          {/* Saves */}
          <SavesPanel build={build} />

          {/* Skills */}
          <SkillsPanel build={build} />

          {/* Feats */}
          <FeatsPanel build={build} />
        </>
      ) : (
        <ErrorPanel>
          This character has no build data yet. Import from Pathbuilder to fill in
          the sheet.
        </ErrorPanel>
      )}
    </article>
  );
}

// ---------------------------------------------------------------
// Panels
// ---------------------------------------------------------------

function AbilitiesPanel({ build }: { build: PathbuilderBuild }) {
  return (
    <Panel title="Abilities">
      <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6">
        {ABILITY_ORDER.map((ab) => {
          const score = build.abilities?.[ab] ?? 10;
          const mod = abilityMod(score);
          return (
            <div
              key={ab}
              className="rounded-md border border-gold/15 bg-midnight-900/60 p-3 text-center"
            >
              <dt className="text-[0.65rem] uppercase tracking-widest text-silver/40">
                {ABILITY_LABELS[ab]}
              </dt>
              <dd className="mt-1 font-display text-xl text-gold">{score}</dd>
              <dd className="text-sm text-arcane">{fmtMod(mod)}</dd>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}

function CoreStatsPanel({
  build,
  ac,
  perception,
  speed,
}: {
  build: PathbuilderBuild;
  ac?: number;
  perception?: number;
  speed?: number;
}) {
  const cdc = classDC(build);
  return (
    <Panel title="Defenses & Awareness">
      <dl className="grid grid-cols-2 gap-4">
        <StatBig label="AC" value={ac ?? '—'} />
        <StatBig label="Perception" value={perception != null ? fmtMod(perception) : '—'} />
        <StatBig label="Speed" value={speed != null ? `${speed} ft` : '—'} />
        {cdc != null && <StatBig label="Class DC" value={cdc} />}
      </dl>
    </Panel>
  );
}

function SavesPanel({ build }: { build: PathbuilderBuild }) {
  const saves: Array<{ label: string; key: 'fortitude' | 'reflex' | 'will' }> = [
    { label: 'Fortitude', key: 'fortitude' },
    { label: 'Reflex', key: 'reflex' },
    { label: 'Will', key: 'will' },
  ];
  return (
    <Panel title="Saving Throws">
      <dl className="grid grid-cols-3 gap-4">
        {saves.map((s) => {
          const rank = build.proficiencies?.[s.key];
          const bonus = saveBonus(build, s.key);
          return (
            <div
              key={s.key}
              className="rounded-md border border-gold/15 bg-midnight-900/60 p-4 text-center"
            >
              <div className="text-xs uppercase tracking-widest text-silver/50">
                {s.label}
              </div>
              <div className="mt-1 font-display text-2xl text-gold">{fmtMod(bonus)}</div>
              <div className="text-[0.65rem] uppercase tracking-wider text-silver/40">
                {profLabel(rank)}
              </div>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}

function SkillsPanel({ build }: { build: PathbuilderBuild }) {
  return (
    <Panel title="Skills">
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {SKILL_ORDER.map((s) => {
          const rank = build.proficiencies?.[s];
          const bonus = skillBonus(build, s);
          const trained = (rank ?? 0) > 0;
          return (
            <li
              key={s}
              className={`flex items-center justify-between gap-3 rounded px-3 py-1.5 ${trained ? 'bg-midnight-900/60' : 'bg-midnight-900/20 opacity-60'}`}
            >
              <div>
                <div className="text-sm capitalize text-silver/90">{s}</div>
                <div className="text-[0.65rem] uppercase tracking-wider text-silver/40">
                  {profLabel(rank)} · {ABILITY_LABELS[SKILL_ABILITY[s] as Ability]}
                </div>
              </div>
              <div className={`font-display ${trained ? 'text-arcane' : 'text-silver/50'}`}>
                {fmtMod(bonus)}
              </div>
            </li>
          );
        })}
      </ul>
      {build.lores && build.lores.length > 0 && (
        <>
          <GildedRule className="my-4" />
          <h3 className="mb-2 text-xs uppercase tracking-widest text-silver/50">Lore</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {build.lores.map(([name, rank]) => (
              <li key={name} className="flex items-center justify-between rounded bg-midnight-900/60 px-3 py-1.5">
                <span className="text-sm text-silver/90">{name}</span>
                <span className="text-xs uppercase tracking-wider text-silver/40">
                  {profLabel(rank)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function FeatsPanel({ build }: { build: PathbuilderBuild }) {
  const feats = build.feats ?? [];
  if (feats.length === 0) return null;

  const byType = new Map<string, typeof feats>();
  for (const f of feats) {
    const type = f[2] || 'Feat';
    const arr = byType.get(type) ?? [];
    arr.push(f);
    byType.set(type, arr);
  }
  const types = Array.from(byType.keys()).sort();

  return (
    <Panel title="Feats">
      <div className="grid gap-6 md:grid-cols-2">
        {types.map((t) => (
          <div key={t}>
            <h3 className="mb-2 text-xs uppercase tracking-widest text-gold/80">{t}</h3>
            <ul className="space-y-1.5">
              {byType.get(t)!
                .slice()
                .sort((a, b) => (a[3] ?? 0) - (b[3] ?? 0) || a[0].localeCompare(b[0]))
                .map((f, i) => (
                  <li key={`${t}-${f[0]}-${i}`} className="flex items-baseline gap-3 rounded bg-midnight-900/60 px-3 py-1.5">
                    <span className="w-8 text-xs text-silver/40">L{f[3] ?? '?'}</span>
                    <span className="flex-1 text-sm text-silver/90">{f[0]}</span>
                    {f[1] && <span className="text-[0.65rem] uppercase tracking-wider text-silver/40">{f[1]}</span>}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gold/15 bg-midnight-700/40 p-6">
      <h2 className="mb-4 font-display text-lg text-gold">{title}</h2>
      {children}
    </section>
  );
}

function LiveStat({
  label,
  value,
  max,
  tone = 'default',
}: {
  label: string;
  value: number | null;
  max?: number;
  tone?: 'default' | 'hp' | 'hero' | 'xp' | 'danger';
}) {
  const color =
    tone === 'hp' ? 'text-emerald-soft' :
    tone === 'hero' ? 'text-gold' :
    tone === 'xp' ? 'text-arcane' :
    tone === 'danger' ? 'text-red-300' :
    'text-silver';
  return (
    <div className="rounded-md border border-gold/15 bg-midnight-900/60 p-3 text-center">
      <div className="text-[0.65rem] uppercase tracking-widest text-silver/40">{label}</div>
      <div className={`mt-1 font-display text-2xl ${color}`}>
        {value ?? '—'}
        {max != null && <span className="text-sm text-silver/40"> / {max}</span>}
      </div>
    </div>
  );
}

function StatBig({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gold/15 bg-midnight-900/60 p-4 text-center">
      <div className="text-xs uppercase tracking-widest text-silver/50">{label}</div>
      <div className="mt-1 font-display text-2xl text-gold">{value}</div>
    </div>
  );
}

function ErrorPanel({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'danger';
}) {
  const cls = tone === 'danger'
    ? 'border-red-500/30 bg-red-500/10 text-red-300'
    : 'border-arcane/25 bg-arcane/5 text-silver/80';
  return (
    <div className={`rounded-lg border p-6 text-center ${cls}`}>{children}</div>
  );
}

function NotFoundPanel({ charKey }: { charKey: string }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="font-display text-6xl text-gold/80">?</p>
      <h1 className="mt-4 font-display text-xl text-silver">Character not found</h1>
      <p className="mt-2 text-sm text-silver/60">
        No character in your vault matches <code className="text-arcane">{charKey}</code>.
      </p>
      <Link
        to="/vault"
        className="mt-6 inline-block rounded-md border border-gold/30 px-4 py-2 text-gold transition-colors hover:border-gold/60"
      >
        Back to the vault
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/** Pathbuilder JSON may or may not wrap the build under `.build`. */
function unwrapBuild(pd: PathbuilderData | null): PathbuilderBuild | null {
  if (!pd || typeof pd !== 'object') return null;
  const asObj = pd as Record<string, unknown>;
  if (asObj.build && typeof asObj.build === 'object') {
    return asObj.build as PathbuilderBuild;
  }
  return asObj as PathbuilderBuild;
}
