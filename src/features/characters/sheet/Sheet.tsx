import type { ReactNode } from 'react';
import { noteText } from '@/features/characters/api';
import { useCharacterNotes } from '@/features/characters/useCharacterNotes';
import type { CharacterOverlay, CharacterRow } from '@/features/characters/types';
import {
  ABILITY_ORDER,
  SKILL_ORDER,
  SKILL_ABILITY,
  TRADITION_COLOR,
  abilityMod,
  acTotal,
  classDC,
  fmtMod,
  maxHp,
  perceptionBonus,
  profLabel,
  saveBonus,
  skillBonus,
  sizeLabel,
  speed,
  totalGp,
  weaponDamage,
  type Ability,
  type PathbuilderBuild,
  type Spellcaster,
  type Weapon,
} from '@/features/characters/pathbuilder';
import {
  AbilitiesIcon,
  AncestryIcon,
  BookIcon,
  BrainIcon,
  CameraIcon,
  ClassIcon,
  CoinsIcon,
  CompassIcon,
  DotsIcon,
  DownloadIcon,
  EquipmentIcon,
  EyeIcon,
  FeatsIcon,
  HeartIcon,
  HourglassIcon,
  JournalIcon,
  NoteIcon,
  OverviewIcon,
  PencilIcon,
  PouchIcon,
  RunningIcon,
  ShareIcon,
  ShieldIcon,
  ShieldPlusIcon,
  SkillsIcon,
  SpellsIcon,
  StarIcon,
  SwordIcon,
} from './icons';

/**
 * Full read-only Pathway character sheet.
 *
 * Layout: fixed header + 3-column body + bottom tab bar. Data is sourced from
 * `pathbuilder_data` (Pathbuilder JSON, rooted — no `.build` wrapper) plus the
 * live play-state columns (HP/hero/dying/wounded/XP). Anything the build
 * doesn't tell us renders as an em-dash placeholder so the layout stays intact
 * for undermodeled characters.
 */
export function Sheet({ character, build }: { character: CharacterRow; build: PathbuilderBuild }) {
  return (
    <div className="space-y-4">
      <SheetHeader character={character} build={build} />
      <div className="grid gap-4 xl:grid-cols-[220px_1fr_240px]">
        <LeftColumn character={character} build={build} />
        <CenterColumn character={character} build={build} />
        <RightColumn build={build} />
      </div>
      <BottomTabBar />
    </div>
  );
}

// ---------------------------------------------------------------
// Header
// ---------------------------------------------------------------

function SheetHeader({ character, build }: { character: CharacterRow; build: PathbuilderBuild }) {
  const level = character.level ?? build.level ?? 1;
  const xpTarget = 1000;
  const xp = character.experience ?? 0;
  const overlay = character.overlay ?? {};
  const bg =
    overlay.pathway_bot_state?.edits?.background ??
    character.background_name ??
    build.background;
  return (
    <header className="rounded-lg border border-gold/25 bg-midnight-900/60 p-4 shadow-gilded">
      <div className="grid items-center gap-4 lg:grid-cols-[auto_1fr_auto]">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <CompassIcon className="text-3xl text-gold" />
          <div className="leading-tight">
            <div className="font-display text-2xl tracking-wider text-gold">PATHWAY</div>
            <div className="text-[0.6rem] uppercase tracking-[0.25em] text-silver/50">
              PF2E Character Sheet
            </div>
          </div>
        </div>

        {/* Form-style field grid */}
        <div className="grid gap-2 sm:grid-cols-3">
          <HeaderField label="Character Name" value={character.name || build.name || '—'} wide />
          <HeaderField label="Ancestry" value={character.ancestry_name ?? build.ancestry} />
          <HeaderField label="Background" value={bg} />
          <HeaderField label="Class" value={character.class_name ?? build.class} />
          <HeaderField label="Level" value={level} />
          <HeaderField
            label="Experience Points"
            value={
              <span className="tabular-nums">
                {xp.toLocaleString()} <span className="text-silver/40">/ {xpTarget.toLocaleString()}</span>
              </span>
            }
          />
          <HeaderField label="Size" value={sizeLabel(build.size)} />
          <HeaderField label="Speed" value={`${speed(build)} ft.`} />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <HeaderButton icon={<PencilIcon />} label="Edit" />
            <HeaderButton icon={<ShareIcon />} label="Share" />
            <HeaderButton icon={<DotsIcon />} aria-label="More" />
          </div>
          <HeaderButton icon={<DownloadIcon />} label="Export" />
        </div>
      </div>
    </header>
  );
}

function HeaderField({
  label,
  value,
  wide,
}: {
  label: string;
  value: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${wide ? 'sm:col-span-1' : ''}`}>
      <div className="whitespace-nowrap text-[0.6rem] uppercase tracking-widest text-gold/70">
        {label}
      </div>
      <div className="flex-1 rounded-sm border border-gold/20 bg-midnight-800/80 px-3 py-1 font-serif text-silver">
        {value || '—'}
      </div>
    </div>
  );
}

function HeaderButton({
  icon,
  label,
  ...aria
}: {
  icon: ReactNode;
  label?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-md border border-gold/25 bg-midnight-800/70 px-3 py-1.5 text-sm text-silver/80 transition-colors hover:border-gold/60 hover:text-gold"
      {...aria}
    >
      <span className="text-base text-gold">{icon}</span>
      {label && <span>{label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------
// Left column
// ---------------------------------------------------------------

function LeftColumn({ character, build }: { character: CharacterRow; build: PathbuilderBuild }) {
  const perception = perceptionBonus(build);
  const overlay = character.overlay ?? {};
  const senses = overlay.pathway_bot_state?.edits?.senses ?? inferSenses(build);
  const languages =
    overlay.pathway_bot_state?.edits?.languages ?? build.languages ?? [];
  return (
    <aside className="space-y-4">
      <Portrait art={character.art} name={character.name || build.name} />
      <AbilityScoreList build={build} />
      <FramedBlock title="Ability Boosts">
        <AbilityBoostsSummary build={build} />
      </FramedBlock>
      <FramedBlock title="Senses">
        <p className="text-sm text-silver/80">
          {senses.length ? senses.join(', ') : '—'}
        </p>
        <p className="mt-1 text-xs text-silver/60">Perception {fmtMod(perception)}</p>
      </FramedBlock>
      <FramedBlock title="Languages">
        <p className="text-sm text-silver/80">
          {languages.length ? languages.join(', ') : '—'}
        </p>
      </FramedBlock>
      <FramedBlock title="Perception" icon={<EyeIcon />}>
        <div className="font-display text-3xl text-gold">{fmtMod(perception)}</div>
        <div className="text-xs text-silver/60">
          {profLabel(build.proficiencies?.perception)} in Perception
        </div>
      </FramedBlock>
    </aside>
  );
}

function Portrait({ art, name }: { art: string | null; name: string | undefined }) {
  const wrapCls =
    'relative mx-auto flex h-40 w-40 items-center justify-center overflow-hidden rounded-full border-2 border-gold/40 bg-gradient-to-br from-midnight-700 to-midnight-900 shadow-gilded';
  return (
    <div className={wrapCls}>
      {art ? (
        <img
          src={art}
          alt={name ?? 'Character portrait'}
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="font-display text-4xl text-gold/60">{initials(name)}</span>
      )}
      <button
        type="button"
        aria-label="Upload portrait"
        className="absolute bottom-2 right-2 rounded-full border border-gold/40 bg-midnight-900/90 p-1.5 text-gold/70 hover:text-gold"
      >
        <CameraIcon className="text-sm" />
      </button>
    </div>
  );
}

/**
 * Renders the ability-boost trail from `pathbuilder_data.abilities.breakdown`,
 * grouped by category. Empty when Pathbuilder didn't record it (rare).
 */
function AbilityBoostsSummary({ build }: { build: PathbuilderBuild }) {
  const b = build.abilities?.breakdown;
  if (!b) return <p className="text-sm text-silver/40">—</p>;

  const lines: Array<{ label: string; content: string }> = [];
  const ancestryBits: string[] = [];
  if (b.ancestryBoosts?.length) ancestryBits.push(b.ancestryBoosts.join(', '));
  if (b.ancestryFree?.length) ancestryBits.push(`free ${b.ancestryFree.join(', ')}`);
  if (b.ancestryFlaws?.length) ancestryBits.push(`flaw ${b.ancestryFlaws.join(', ')}`);
  if (ancestryBits.length) lines.push({ label: 'Ancestry', content: ancestryBits.join('; ') });

  if (b.backgroundBoosts?.length) {
    lines.push({ label: 'Background', content: b.backgroundBoosts.join(', ') });
  }
  if (b.classBoosts?.length) {
    lines.push({ label: 'Class', content: b.classBoosts.join(', ') });
  }
  if (b.mapLevelledBoosts) {
    const levels = Object.keys(b.mapLevelledBoosts)
      .map((k) => Number(k))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    for (const lvl of levels) {
      const arr = b.mapLevelledBoosts[String(lvl)];
      if (arr?.length) lines.push({ label: `L${lvl}`, content: arr.join(', ') });
    }
  }

  if (lines.length === 0) return <p className="text-sm text-silver/40">—</p>;
  return (
    <ul className="space-y-1 text-sm">
      {lines.map((l) => (
        <li key={l.label} className="leading-tight">
          <span className="text-[0.65rem] uppercase tracking-widest text-gold/70">
            {l.label}:{' '}
          </span>
          <span className="text-silver/85">{l.content}</span>
        </li>
      ))}
    </ul>
  );
}

function AbilityScoreList({ build }: { build: PathbuilderBuild }) {
  return (
    <ul className="space-y-1.5">
      {ABILITY_ORDER.map((ab) => {
        const score = build.abilities?.[ab] ?? 10;
        const mod = abilityMod(score);
        return (
          <li
            key={ab}
            className="flex items-center gap-3 rounded-md border border-gold/15 bg-midnight-900/60 px-3 py-2"
          >
            <span className="w-10 text-[0.7rem] uppercase tracking-widest text-gold/80">
              {ab.toUpperCase()}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/30 bg-midnight-800 font-display text-silver">
              {score}
            </span>
            <span className="ml-auto w-8 text-right font-display text-lg text-gold">
              {fmtMod(mod)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FramedBlock({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="relative rounded-md border border-gold/20 bg-midnight-900/60 p-3">
      <CornerAccents />
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[0.65rem] uppercase tracking-widest text-gold/80">
        {icon && <span className="text-sm text-gold">{icon}</span>}
        {title}
      </h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------
// Center column
// ---------------------------------------------------------------

function CenterColumn({ character, build }: { character: CharacterRow; build: PathbuilderBuild }) {
  return (
    <div className="space-y-4">
      <StatRow character={character} build={build} />
      <ConditionsRow character={character} />
      <div className="grid gap-4 lg:grid-cols-3">
        <SkillsPanel build={build} />
        <AttacksPanel character={character} build={build} />
        <FeatsPanel build={build} />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <EquipmentPanel build={build} />
        <InventoryPanel build={build} />
        <TreasurePanel character={character} build={build} />
        <NotesPanel charKey={character.char_key} shortNote={character.notes} />
      </div>
    </div>
  );
}

// ---- Ornate top stat row ---------------------------------------

function StatRow({ character, build }: { character: CharacterRow; build: PathbuilderBuild }) {
  const max = maxHp(build);
  const hero = character.hero_points ?? character.overlay?.daily?.hero_points ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      <StatCard
        label="HP"
        icon={<HeartIcon className="text-red-400" />}
        value={
          <span className="tabular-nums">
            {character.current_hp ?? '—'}
            <span className="text-silver/40"> / {max ?? '—'}</span>
          </span>
        }
      />
      <StatCard label="AC" icon={<ShieldIcon />} value={acTotal(build) ?? '—'} />
      <StatCard label="Fortitude" icon={<ShieldPlusIcon />} value={fmtMod(saveBonus(build, 'fortitude'))} />
      <StatCard label="Reflex" icon={<RunningIcon />} value={fmtMod(saveBonus(build, 'reflex'))} />
      <StatCard label="Will" icon={<BrainIcon />} value={fmtMod(saveBonus(build, 'will'))} />
      <StatCard label="Perception" icon={<EyeIcon />} value={fmtMod(perceptionBonus(build))} />
      <HeroPointsCard value={hero} />
    </div>
  );
}

function StatCard({
  label,
  icon,
  value,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="relative rounded-md border border-gold/30 bg-midnight-900/70 px-3 py-3 text-center shadow-gilded">
      <CornerAccents />
      <div className="text-[0.65rem] font-display uppercase tracking-widest text-gold/90">
        {label}
      </div>
      <div className="my-1 flex justify-center text-xl text-gold">{icon}</div>
      <div className="font-display text-2xl text-silver">{value}</div>
    </div>
  );
}

function HeroPointsCard({ value }: { value: number }) {
  return (
    <div className="relative rounded-md border border-gold/30 bg-midnight-900/70 px-3 py-3 text-center shadow-gilded">
      <CornerAccents />
      <div className="text-[0.65rem] font-display uppercase tracking-widest text-gold/90">
        Hero Points
      </div>
      <div className="my-1 flex justify-center text-xl text-gold">
        <StarIcon />
      </div>
      <div className="flex justify-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`inline-block h-3 w-3 rounded-full border border-gold/60 ${i < value ? 'bg-gold' : 'bg-transparent'}`}
          />
        ))}
      </div>
    </div>
  );
}

// ---- Conditions + resistances ----------------------------------

function ConditionsRow({ character }: { character: CharacterRow }) {
  const conditions = renderConditions(character);
  const counters = renderCounters(character.overlay ?? null);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <SlimBar
        label="Conditions"
        value={conditions.length ? conditions.join(' · ') : '—'}
      />
      <SlimBar
        label={counters.length ? 'Counters' : 'Resistances & Immunities'}
        value={counters.length ? counters.join(' · ') : '—'}
      />
    </div>
  );
}

function renderConditions(c: CharacterRow): string[] {
  const out: string[] = [];
  if ((c.dying ?? 0) > 0) out.push(`Dying ${c.dying}`);
  if ((c.wounded ?? 0) > 0) out.push(`Wounded ${c.wounded}`);
  if (c.status) out.push(c.status);
  return out;
}

function renderCounters(overlay: CharacterOverlay | null): string[] {
  if (!overlay?.counters) return [];
  return Object.entries(overlay.counters)
    .filter(([, v]) => v && (v.max ?? 0) > 0)
    .map(([k, v]) => `${v.label || k.toUpperCase()} ${v.current ?? 0}/${v.max ?? 0}`);
}

function SlimBar({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-gold/20 bg-midnight-900/50 px-3 py-2">
      <span className="text-[0.65rem] font-display uppercase tracking-widest text-gold/80">
        {label}
      </span>
      <span className="text-sm text-silver/80">{value}</span>
    </div>
  );
}

// ---- Skills panel ----------------------------------------------

function SkillsPanel({ build }: { build: PathbuilderBuild }) {
  return (
    <Panel title="Skills">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 text-sm">
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Skill</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Total</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Rank</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Ability</div>
        {SKILL_ORDER.map((s) => {
          const rank = build.proficiencies?.[s];
          const trained = (rank ?? 0) > 0;
          const bonus = skillBonus(build, s);
          const ab = SKILL_ABILITY[s] as Ability;
          const abMod = abilityMod(build.abilities?.[ab]);
          return (
            <RowContents key={s} dim={!trained}>
              <span className="flex items-center gap-1.5 capitalize">
                <BookIcon className="text-xs text-gold/50" />
                {s}
              </span>
              <span className="tabular-nums text-arcane">{fmtMod(bonus)}</span>
              <span className="text-xs text-silver/60">{profLabel(rank)}</span>
              <span className="text-xs uppercase tracking-wider text-silver/60 tabular-nums">
                {fmtMod(abMod)}
              </span>
            </RowContents>
          );
        })}
      </div>
      {build.lores && build.lores.length > 0 && (
        <>
          <div className="mt-3 border-t border-gold/15 pt-2 text-[0.6rem] uppercase tracking-widest text-gold/70">
            Additional Skills
          </div>
          <p className="mt-1 text-sm text-silver/80">
            {build.lores
              .map(([name, rank]) => `${name} ${fmtMod(loreBonus(build, rank))}`)
              .join(', ')}
          </p>
        </>
      )}
    </Panel>
  );
}

function loreBonus(build: PathbuilderBuild, rank: number): number {
  const int = abilityMod(build.abilities?.int);
  const level = build.level ?? 1;
  return rank > 0 ? int + rank + level : int;
}

/** Reusable "row of 4 cells" — pass exactly 4 children. */
function RowContents({ children, dim }: { children: ReactNode; dim?: boolean }) {
  const cls = dim ? 'opacity-50' : '';
  return (
    <>
      {Array.isArray(children) &&
        children.map((c, i) => (
          <div key={i} className={cls}>
            {c}
          </div>
        ))}
    </>
  );
}

// ---- Attacks & spellcasting -----------------------------------

function AttacksPanel({ character, build }: { character: CharacterRow; build: PathbuilderBuild }) {
  const weapons = mergeWeapons(build, character.overlay ?? null);
  const spellRows = collectSpellAttackRows(build);
  const rows = [
    ...weapons.map((w) => ({ kind: 'weapon' as const, w })),
    ...spellRows,
  ];
  return (
    <Panel title="Attacks & Spellcasting">
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-1.5 text-sm">
        <div />
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Name</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Atk / Dmg / DC</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Traits</div>
        {rows.length === 0 && (
          <div className="col-span-4 py-3 text-center text-sm text-silver/40">—</div>
        )}
        {rows.map((r, i) =>
          r.kind === 'weapon' ? <WeaponRow key={`w-${i}`} w={r.w} /> : <SpellRow key={`s-${i}`} row={r} />
        )}
      </div>
    </Panel>
  );
}

function WeaponRow({ w }: { w: Weapon }) {
  return (
    <>
      <SwordIcon className="text-sm text-gold/70" />
      <span className="text-silver">{w.display || w.name}</span>
      <span className="text-arcane tabular-nums">
        {w.attack != null && `${fmtMod(w.attack)} `}
        <span className="text-silver/80">{weaponDamage(w)}</span>
      </span>
      <span className="text-xs text-silver/60">{w.prof ?? ''}</span>
    </>
  );
}

type SpellAttackRow = {
  kind: 'spell';
  name: string;
  attack: number;
  tradition: string;
  level: number;
};

function collectSpellAttackRows(build: PathbuilderBuild): SpellAttackRow[] {
  const casters = build.spellCasters ?? [];
  const rows: SpellAttackRow[] = [];
  for (const c of casters) {
    if (c.innate) continue;
    const attack = spellAttackTotal(build, c);
    for (const lvl of c.spells ?? []) {
      for (const name of lvl.list ?? []) {
        rows.push({
          kind: 'spell',
          name,
          attack,
          tradition: c.magicTradition,
          level: lvl.spellLevel,
        });
      }
    }
  }
  return rows.slice(0, 10);
}

function SpellRow({ row }: { row: SpellAttackRow }) {
  const tint = TRADITION_COLOR[row.tradition] ?? 'gold';
  return (
    <>
      <span className={`text-sm text-${tint === 'gold' ? 'gold' : tint}/70`}>✦</span>
      <span className="text-silver">{row.name}</span>
      <span className="tabular-nums text-arcane">{fmtMod(row.attack)}</span>
      <span className="text-xs capitalize text-silver/60">
        {row.tradition} · L{row.level}
      </span>
    </>
  );
}

function spellAttackTotal(build: PathbuilderBuild, c: Spellcaster): number {
  const level = build.level ?? 1;
  const ab = abilityMod(build.abilities?.[c.ability]);
  const rank = c.proficiency ?? 0;
  return rank > 0 ? level + rank + ab : ab;
}

// ---- Feats & Abilities ----------------------------------------

function FeatsPanel({ build }: { build: PathbuilderBuild }) {
  const feats = build.feats ?? [];
  return (
    <Panel title="Feats & Abilities">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-1.5 text-[0.6rem] uppercase tracking-widest text-gold/70">Feats</div>
          <ul className="space-y-1 text-sm">
            {feats.length === 0 && <li className="text-silver/40">—</li>}
            {feats.slice(0, 12).map((f, i) => (
              <li key={`${f[0]}-${i}`} className="flex items-center gap-1.5 text-silver/90">
                <BookIcon className="text-[0.75rem] text-gold/50" />
                <span className="truncate" title={f[0]}>{f[0]}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1.5 text-[0.6rem] uppercase tracking-widest text-gold/70">Abilities</div>
          <ul className="space-y-1 text-sm text-silver/60">
            <li>—</li>
          </ul>
        </div>
      </div>
    </Panel>
  );
}

// ---- Bottom row: equipment / inventory / treasure / notes ------

function EquipmentPanel({ build }: { build: PathbuilderBuild }) {
  const weapons = build.weapons ?? [];
  const armor = build.armor ?? [];
  const gear = build.equipment ?? [];
  return (
    <Panel title="Equipment" icon={<PouchIcon />}>
      <div className="mb-2 flex justify-center gap-2 border-b border-gold/15 pb-2 text-lg text-gold/70">
        <SwordIcon /><ShieldIcon /><EquipmentIcon /><PouchIcon /><CoinsIcon /><BookIcon />
      </div>
      <ul className="space-y-1 text-sm">
        {weapons.map((w, i) => (
          <li key={`w-${i}`} className="flex items-baseline justify-between gap-2">
            <span className="text-silver/90 truncate">
              {w.pot ? `+${w.pot} ` : ''}
              {w.display || w.name}
            </span>
            <span className="text-xs text-silver/40">—</span>
          </li>
        ))}
        {armor.map((a, i) => (
          <li key={`a-${i}`} className="flex items-baseline justify-between gap-2">
            <span className="text-silver/90 truncate">
              {a.pot ? `+${a.pot} ` : ''}
              {a.display || a.name}
            </span>
            <span className="text-xs text-silver/40">—</span>
          </li>
        ))}
        {gear.slice(0, 8).map(([name, qty], i) => (
          <li key={`g-${i}`} className="flex items-baseline justify-between gap-2">
            <span className="text-silver/90 truncate">
              {name}
              {qty > 1 && <span className="text-silver/50"> ×{qty}</span>}
            </span>
            <span className="text-xs text-silver/40">—</span>
          </li>
        ))}
        {weapons.length + armor.length + gear.length === 0 && (
          <li className="text-silver/40">—</li>
        )}
      </ul>
    </Panel>
  );
}

function InventoryPanel({ build }: { build: PathbuilderBuild }) {
  const gear = build.equipment ?? [];
  const overflow = gear.slice(8);
  return (
    <Panel title="Inventory" icon={<PouchIcon />}>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-sm">
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Item</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Qty</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Wt.</div>
        {overflow.length === 0 && <div className="col-span-3 text-silver/40">—</div>}
        {overflow.map(([name, qty], i) => (
          <RowContents key={`i-${i}`}>
            <span className="text-silver/90 truncate">{name}</span>
            <span className="tabular-nums text-silver/70">{qty}</span>
            <span className="text-silver/40">—</span>
          </RowContents>
        ))}
      </div>
    </Panel>
  );
}

function TreasurePanel({ character, build }: { character: CharacterRow; build: PathbuilderBuild }) {
  // Live `currency` column wins over the Pathbuilder snapshot — the bot updates
  // it as coin is earned/spent, while `pathbuilder_data.money` stays frozen.
  const money = character.currency ?? build.money ?? {};
  const rows: Array<[string, number | undefined]> = [
    ['CP', money.cp],
    ['SP', money.sp],
    ['GP', money.gp],
    ['PP', money.pp],
  ];
  return (
    <Panel title="Treasure" icon={<CoinsIcon />}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70">Coin</div>
        <div className="text-[0.6rem] uppercase tracking-widest text-gold/70 text-right">Amount</div>
        {rows.map(([c, v]) => (
          <RowContents key={c}>
            <span className="text-gold/80">{c}</span>
            <span className="text-right tabular-nums text-silver/90">
              {v?.toLocaleString() ?? '—'}
            </span>
          </RowContents>
        ))}
      </div>
      <div className="mt-2 border-t border-gold/15 pt-2 text-right text-xs text-silver/50">
        ≈ {totalGp(money).toLocaleString()} gp total
      </div>
    </Panel>
  );
}

function NotesPanel({
  charKey,
  shortNote,
}: {
  charKey: string;
  shortNote: string | null;
}) {
  const { data: notes, isLoading } = useCharacterNotes(charKey);
  const list = (notes ?? [])
    .map(noteText)
    .filter((t) => t.length > 0);
  const hasAny = list.length > 0 || (shortNote?.trim().length ?? 0) > 0;

  return (
    <Panel title="Notes" icon={<NoteIcon />}>
      {isLoading ? (
        <p className="text-sm text-silver/40">Loading…</p>
      ) : !hasAny ? (
        <p className="text-sm text-silver/40">—</p>
      ) : (
        <div className="space-y-2 text-sm leading-relaxed text-silver/85">
          {shortNote?.trim() && <p className="italic text-silver/70">{shortNote}</p>}
          {list.slice(0, 4).map((t, i) => (
            <p key={i}>{t}</p>
          ))}
          {list.length > 4 && (
            <p className="text-xs text-silver/50">
              …{list.length - 4} more note{list.length - 4 === 1 ? '' : 's'}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * Merge the Pathbuilder weapons array with the bot's overlay-side additions
 * (natural weapons, custom entries) — bot-side takes precedence when a name
 * matches. Overlay weapons come with pre-formatted `die` like `"1d8+3"`, so
 * we normalize to the shape our WeaponRow expects.
 */
function mergeWeapons(
  build: PathbuilderBuild,
  overlay: CharacterOverlay | null,
): Weapon[] {
  const pathbuilderWeapons: Weapon[] = build.weapons ?? [];
  const overlayWeapons = overlay?.pathway_bot_state?.edits?.weapons ?? [];
  if (overlayWeapons.length === 0) return pathbuilderWeapons;

  const nameOf = (w: { name?: string; display?: string }) =>
    (w.display ?? w.name ?? '').toLowerCase();
  const overlayByName = new Map(overlayWeapons.map((w) => [nameOf(w), w]));
  const merged: Weapon[] = pathbuilderWeapons.map((w) => {
    const override = overlayByName.get(nameOf(w));
    if (!override) return w;
    overlayByName.delete(nameOf(w));
    return {
      ...w,
      display: override.display ?? w.display,
      die: parseOverlayDie(override.die) ?? w.die,
      damageBonus: override.damageBonus ?? w.damageBonus,
      damageType: override.damageType?.[0] ?? w.damageType,
      attack: override.attack ?? w.attack,
    };
  });
  for (const extra of overlayByName.values()) {
    merged.push({
      name: extra.name ?? extra.display ?? 'Weapon',
      display: extra.display ?? extra.name,
      die: parseOverlayDie(extra.die),
      attack: extra.attack,
      damageBonus: extra.damageBonus,
      damageType: extra.damageType?.[0],
    });
  }
  return merged;
}

/** Overlay stores die as `"1d8+3"`; the Weapon row wants just the die (`d8`). */
function parseOverlayDie(die: string | undefined): string | undefined {
  if (!die) return undefined;
  const m = die.match(/d\d+/);
  return m ? m[0] : die;
}

// ---------------------------------------------------------------
// Right column
// ---------------------------------------------------------------

function RightColumn({ build }: { build: PathbuilderBuild }) {
  const cdc = classDC(build);
  const primaryCaster = (build.spellCasters ?? []).find((c) => !c.innate);
  const spellAttack = primaryCaster ? spellAttackTotal(build, primaryCaster) : undefined;
  const initiative = perceptionBonus(build);
  return (
    <aside className="space-y-4">
      <MiniStat label="Class DC" value={cdc ?? '—'} />
      <MiniStat label="Spell Attack" value={spellAttack != null ? fmtMod(spellAttack) : '—'} />
      <MiniStat
        label="Initiative"
        icon={<HourglassIcon />}
        value={fmtMod(initiative)}
      />
      <FramedBlock title="Defenses">
        <p className="text-sm text-silver/40">—</p>
      </FramedBlock>
      <FramedBlock title="Movement">
        <p className="text-sm text-silver/80">{speed(build)} ft.</p>
      </FramedBlock>
      <FramedBlock title="Specials">
        <p className="text-sm text-silver/40">—</p>
      </FramedBlock>
    </aside>
  );
}

function MiniStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-gold/20 bg-midnight-900/60 px-3 py-2">
      <span className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-widest text-gold/80">
        {icon && <span className="text-sm">{icon}</span>}
        {label}
      </span>
      <span className="font-display text-gold">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------
// Bottom tab bar
// ---------------------------------------------------------------

const TABS: Array<{ label: string; icon: (props: { className?: string }) => JSX.Element; active?: boolean }> = [
  { label: 'Overview', icon: OverviewIcon, active: true },
  { label: 'Ancestry', icon: AncestryIcon },
  { label: 'Class', icon: ClassIcon },
  { label: 'Abilities', icon: AbilitiesIcon },
  { label: 'Skills', icon: SkillsIcon },
  { label: 'Feats', icon: FeatsIcon },
  { label: 'Spells', icon: SpellsIcon },
  { label: 'Equipment', icon: EquipmentIcon },
  { label: 'Journal', icon: JournalIcon },
];

function BottomTabBar() {
  return (
    <nav className="flex items-center justify-between gap-4 rounded-lg border border-gold/25 bg-midnight-900/60 px-4 py-3 shadow-gilded">
      <div className="flex flex-1 flex-wrap items-center gap-2 sm:gap-4">
        {TABS.map((t) => (
          <button
            key={t.label}
            type="button"
            className={`group inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs uppercase tracking-widest transition-colors ${t.active ? 'text-gold' : 'text-silver/60 hover:text-gold/80'}`}
          >
            <t.icon className="text-base" />
            <span className="font-display">{t.label}</span>
            {t.active && (
              <span className="ml-2 h-px w-6 bg-gold/70" aria-hidden />
            )}
          </button>
        ))}
      </div>
      <CompassIcon className="text-xl text-gold/50" />
    </nav>
  );
}

// ---------------------------------------------------------------
// Shared decorations
// ---------------------------------------------------------------

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="relative rounded-md border border-gold/20 bg-midnight-900/50 p-3">
      <CornerAccents />
      <h2 className="mb-2 flex items-center gap-1.5 border-b border-gold/15 pb-1.5 font-display text-sm uppercase tracking-widest text-gold">
        {icon && <span>{icon}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Four gilded L-brackets at each panel corner — approximates the ornate frames. */
function CornerAccents() {
  const size = 'h-2.5 w-2.5';
  return (
    <>
      <span className={`pointer-events-none absolute left-0.5 top-0.5 ${size} border-l border-t border-gold/70`} aria-hidden />
      <span className={`pointer-events-none absolute right-0.5 top-0.5 ${size} border-r border-t border-gold/70`} aria-hidden />
      <span className={`pointer-events-none absolute bottom-0.5 left-0.5 ${size} border-b border-l border-gold/70`} aria-hidden />
      <span className={`pointer-events-none absolute bottom-0.5 right-0.5 ${size} border-b border-r border-gold/70`} aria-hidden />
    </>
  );
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

/**
 * Rough senses list from ancestry hints. The Pathbuilder JSON doesn't have a
 * dedicated senses field, so this is a best-effort inference; a proper mapping
 * (ancestry → senses table) can replace this later.
 */
function inferSenses(build: PathbuilderBuild): string[] {
  const out: string[] = [];
  const ancestry = (build.ancestry ?? '').toLowerCase();
  if (['elf', 'gnome', 'goblin', 'halfling', 'kobold', 'orc'].includes(ancestry)) {
    out.push('Low-Light Vision');
  }
  if (['orc', 'dwarf', 'kobold'].includes(ancestry)) {
    out.push('Darkvision');
  }
  return out;
}
