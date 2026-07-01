import type { ReactNode } from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { useAncestryBundle } from '@/features/characters/useAncestryBundle';
import type {
  AncestryRow,
  CharacterRow,
  FeatRow,
  HeritageRow,
} from '@/features/characters/types';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { Panel } from '../Sheet';
import { AncestryIcon, BookIcon, FeatsIcon } from '../icons';

/**
 * Ancestry tab — reads the row from `public.ancestries`, its linked heritages,
 * and level-eligible ancestry feats (via `feats.traits @> [ancestryName]`).
 * Renders defensively: any field the DB doesn't have quietly shows an em-dash,
 * so a missing column doesn't blank the page.
 */
export function AncestryTab({
  character,
  build,
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
}) {
  const ancestryName = character.ancestry_name ?? build.ancestry ?? '';
  const heritageName = character.heritage_name ?? build.heritage ?? '';
  const level = character.level ?? build.level ?? 1;

  const { data, isLoading, isError, error } = useAncestryBundle({
    ancestryName,
    characterLevel: level,
  });

  if (!ancestryName) {
    return (
      <Empty message="This character has no ancestry recorded." icon={<AncestryIcon />} />
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label={`Consulting the archive on ${ancestryName}…`} />
      </div>
    );
  }

  if (isError) {
    return (
      <Empty
        icon={<AncestryIcon />}
        message={
          error instanceof Error ? `Couldn't load ${ancestryName}: ${error.message}` : 'Failed to load ancestry data.'
        }
      />
    );
  }

  const { ancestry, heritages, ancestryFeats } = data ?? {
    ancestry: null,
    heritages: [],
    ancestryFeats: [],
  };

  if (!ancestry) {
    return (
      <Empty
        icon={<AncestryIcon />}
        message={
          <>
            <span className="text-silver/90">{ancestryName}</span> isn&apos;t in your
            ancestries table. Might be a homebrew name, or the row uses a slightly
            different label.
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <AncestryOverview ancestry={ancestry} />
      <HeritagePanel
        heritages={heritages}
        currentName={heritageName}
        ancestryName={ancestryName}
      />
      <AncestryFeatsPanel feats={ancestryFeats} characterLevel={level} />
    </div>
  );
}

// ---------------------------------------------------------------
// Overview: base stats + description + traits
// ---------------------------------------------------------------

function AncestryOverview({ ancestry }: { ancestry: AncestryRow }) {
  const traits = normalizeStringArray(ancestry.traits);
  const boosts = normalizeStringArray(ancestry.ability_boosts);
  const flaws = normalizeStringArray(ancestry.ability_flaws);
  const languages = normalizeStringArray(ancestry.languages);

  return (
    <Panel title={ancestry.name} icon={<AncestryIcon />}>
      {/* Rarity + Source header row */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {ancestry.rarity && <RarityChip rarity={ancestry.rarity} />}
        {ancestry.source && (
          <span className="inline-flex items-center rounded border border-gold/20 bg-midnight-900/60 px-2 py-0.5 text-[0.65rem] uppercase tracking-widest text-silver/70">
            {ancestry.source}
          </span>
        )}
        {ancestry.aon_url && (
          <a
            href={ancestry.aon_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded border border-gold/25 px-2 py-0.5 text-[0.65rem] uppercase tracking-widest text-arcane hover:border-arcane/60 hover:text-arcane-soft"
          >
            <BookIcon />
            Archive of Nethys
          </a>
        )}
      </div>

      {/* Description */}
      {ancestry.description && (
        <p className="mb-4 whitespace-pre-line text-sm leading-relaxed text-silver/85">
          {ancestry.description}
        </p>
      )}

      {/* Base stats */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BaseStat label="HP" value={ancestry.hp} />
        <BaseStat label="Size" value={ancestry.size} />
        <BaseStat label="Speed" value={ancestry.speed != null ? `${ancestry.speed} ft.` : null} />
        <BaseStat label="Rarity" value={ancestry.rarity} />
      </div>

      {/* Ability boosts / flaws */}
      {(boosts.length > 0 || flaws.length > 0) && (
        <dl className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {boosts.length > 0 && (
            <LabelValue label="Ability Boosts" value={boosts.join(', ')} />
          )}
          {flaws.length > 0 && (
            <LabelValue label="Ability Flaws" value={flaws.join(', ')} />
          )}
        </dl>
      )}

      {/* Languages + traits */}
      {languages.length > 0 && (
        <div className="mb-3">
          <SectionLabel>Languages</SectionLabel>
          <p className="text-sm text-silver/85">{languages.join(', ')}</p>
        </div>
      )}
      {traits.length > 0 && (
        <div>
          <SectionLabel>Traits</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {traits.map((t) => (
              <TraitChip key={t} trait={t} />
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------
// Heritages: current + all available
// ---------------------------------------------------------------

function HeritagePanel({
  heritages,
  currentName,
  ancestryName,
}: {
  heritages: HeritageRow[];
  currentName: string;
  ancestryName: string;
}) {
  if (heritages.length === 0) {
    return (
      <Panel title="Heritages" icon={<AncestryIcon />}>
        <p className="py-4 text-center text-sm text-silver/50">
          No heritages found for {ancestryName} in the archive.
        </p>
      </Panel>
    );
  }

  const currentLower = currentName.trim().toLowerCase();
  const current = heritages.find((h) => h.name.toLowerCase() === currentLower) ?? null;
  const others = heritages.filter((h) => h !== current);

  return (
    <Panel title={`Heritages (${heritages.length})`} icon={<AncestryIcon />}>
      {current && (
        <div className="mb-4 rounded border border-gold/30 bg-midnight-900/60 p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[0.6rem] uppercase tracking-widest text-gold/70">
                Current
              </span>
              <span className="font-display text-lg text-gold">{current.name}</span>
            </div>
            {current.rarity && <RarityChip rarity={current.rarity} />}
          </div>
          {current.description && (
            <p className="text-sm leading-relaxed text-silver/85">{current.description}</p>
          )}
        </div>
      )}

      {others.length > 0 && (
        <details className="rounded border border-gold/15 bg-midnight-900/40 p-3">
          <summary className="cursor-pointer text-[0.7rem] uppercase tracking-widest text-gold/70 hover:text-gold">
            {current ? 'Other heritages available' : 'All heritages'} ({others.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {others.map((h) => (
              <li key={h.id} className="border-l-2 border-gold/20 pl-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-display text-sm text-silver">{h.name}</span>
                  {h.rarity && <RarityChip rarity={h.rarity} />}
                </div>
                {h.description && (
                  <p className="text-xs leading-relaxed text-silver/70">{h.description}</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------
// Ancestry feats: grouped by level, up to the character's level
// ---------------------------------------------------------------

function AncestryFeatsPanel({
  feats,
  characterLevel,
}: {
  feats: FeatRow[];
  characterLevel: number;
}) {
  if (feats.length === 0) {
    return (
      <Panel title="Ancestry Feats" icon={<FeatsIcon />}>
        <p className="py-4 text-center text-sm text-silver/50">
          No ancestry feats available at level {characterLevel}.
        </p>
      </Panel>
    );
  }

  const byLevel = new Map<number, FeatRow[]>();
  for (const f of feats) {
    const lvl = f.level ?? 1;
    const arr = byLevel.get(lvl) ?? [];
    arr.push(f);
    byLevel.set(lvl, arr);
  }
  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);

  return (
    <Panel title={`Ancestry Feats (${feats.length})`} icon={<FeatsIcon />}>
      <div className="space-y-4">
        {levels.map((lvl) => (
          <div key={lvl} className="border-l-2 border-gold/25 pl-3">
            <div className="mb-2 text-[0.65rem] font-display uppercase tracking-widest text-gold/80">
              Level {lvl}
            </div>
            <ul className="space-y-2">
              {byLevel.get(lvl)!.map((f) => (
                <FeatCard key={f.id} feat={f} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FeatCard({ feat }: { feat: FeatRow }) {
  const traits = normalizeStringArray(feat.traits);
  return (
    <li className="rounded border border-gold/15 bg-midnight-900/40 p-3">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm text-silver">{feat.name}</span>
          {feat.action_cost && (
            <span className="rounded border border-gold/20 bg-midnight-900/60 px-1.5 py-0.5 text-[0.6rem] uppercase text-silver/60">
              {feat.action_cost}
            </span>
          )}
        </div>
        {feat.aon_url && (
          <a
            href={feat.aon_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[0.65rem] uppercase tracking-widest text-arcane hover:text-arcane-soft"
          >
            AoN ↗
          </a>
        )}
      </div>
      {traits.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {traits.slice(0, 6).map((t) => (
            <TraitChip key={t} trait={t} tiny />
          ))}
        </div>
      )}
      {feat.prerequisites && (
        <p className="mb-1 text-xs italic text-silver/50">
          <span className="text-gold/70">Prerequisites:</span> {feat.prerequisites}
        </p>
      )}
      {feat.trigger && (
        <p className="mb-1 text-xs italic text-silver/50">
          <span className="text-gold/70">Trigger:</span> {feat.trigger}
        </p>
      )}
      {feat.description && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-silver/85">
          {feat.description}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------

function Empty({ message, icon }: { message: ReactNode; icon: ReactNode }) {
  return (
    <div className="space-y-4">
      <Panel title="Ancestry" icon={icon}>
        <p className="py-8 text-center text-sm text-silver/60">{message}</p>
      </Panel>
    </div>
  );
}

function BaseStat({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="rounded border border-gold/15 bg-midnight-900/50 p-2 text-center">
      <div className="text-[0.6rem] uppercase tracking-widest text-silver/50">{label}</div>
      <div className="mt-0.5 font-display text-lg text-gold">
        {value != null && value !== '' ? String(value) : '—'}
      </div>
    </div>
  );
}

function LabelValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <p className="text-sm text-silver/85">{value}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 text-[0.6rem] uppercase tracking-widest text-gold/70">{children}</div>
  );
}

function RarityChip({ rarity }: { rarity: string }) {
  const r = rarity.toLowerCase();
  const cls =
    r === 'common'
      ? 'border-emerald/40 bg-emerald/10 text-emerald-soft'
      : r === 'uncommon'
      ? 'border-arcane/40 bg-arcane/10 text-arcane'
      : r === 'rare'
      ? 'border-gold/50 bg-gold/10 text-gold'
      : r === 'unique'
      ? 'border-brass/60 bg-brass/15 text-gold-soft'
      : 'border-gold/20 bg-midnight-900/60 text-silver/70';
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[0.6rem] font-display uppercase tracking-widest ${cls}`}
    >
      {rarity}
    </span>
  );
}

function TraitChip({ trait, tiny }: { trait: string; tiny?: boolean }) {
  const cls = tiny ? 'px-1.5 py-0 text-[0.6rem]' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center rounded border border-gold/20 bg-midnight-900/70 uppercase tracking-widest text-silver/75 ${cls}`}
    >
      {trait}
    </span>
  );
}

function normalizeStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter((s) => s.trim().length > 0);
  if (typeof v === 'string') {
    return v
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}
