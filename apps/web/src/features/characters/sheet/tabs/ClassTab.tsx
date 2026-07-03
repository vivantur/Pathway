import type { ReactNode } from 'react';
import { safeHttpUrl } from "@/lib/safeUrl";
import { GrimoireMarkdown } from '@/components/ui/GrimoireMarkdown';
import { Spinner } from '@/components/ui/Spinner';
import { errorMessage } from '@/features/characters/errorMessage';
import { useClassBundle } from '@/features/characters/useClassBundle';
import type {
  CharacterRow,
  ClassFeatureRow,
  ClassGamedata,
  FeatRow,
} from '@/features/characters/types';
import type { PathbuilderBuild } from '@/features/characters/pathbuilder';
import { Panel } from '../Sheet';
import { BookIcon, ClassIcon, FeatsIcon } from '../icons';

/**
 * Class tab — reads the class from `gamedata` (category='classes'), its
 * level-eligible class features from `class_features`, and its level-
 * eligible class feats from `feats`. Renders defensively: the class row's
 * JSONB `data` payload varies (Pathbuilder vs AoN vs Foundry shape) so we
 * look through several common paths for each field, and any missing piece
 * quietly hides.
 */
export function ClassTab({
  character,
  build,
}: {
  character: CharacterRow;
  build: PathbuilderBuild;
}) {
  const className = character.class_name ?? build.class ?? '';
  const level = character.level ?? build.level ?? 1;

  const { data, isLoading, isError, error } = useClassBundle({
    className,
    characterLevel: level,
  });

  if (!className) {
    return (
      <Empty
        icon={<ClassIcon />}
        message="This character has no class recorded."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner label={`Consulting the archive on ${className}…`} />
      </div>
    );
  }

  if (isError) {
    return (
      <Empty
        icon={<ClassIcon />}
        message={
          <>
            <div className="mb-2">Couldn&apos;t load {className}:</div>
            <code className="block whitespace-pre-wrap rounded border border-red-500/30 bg-red-500/5 p-2 text-left text-xs text-red-300">
              {errorMessage(error)}
            </code>
          </>
        }
      />
    );
  }

  const { classInfo, features, feats } = data ?? {
    classInfo: null,
    features: [],
    feats: [],
  };

  return (
    <div className="space-y-4">
      <ClassOverview classInfo={classInfo} fallbackName={className} />
      <ClassFeaturesPanel features={features} characterLevel={level} />
      <ClassFeatsPanel feats={feats} characterLevel={level} />
    </div>
  );
}

// ---------------------------------------------------------------
// Overview: name, badges, description, key stats
// ---------------------------------------------------------------

function ClassOverview({
  classInfo,
  fallbackName,
}: {
  classInfo: ClassGamedata | null;
  fallbackName: string;
}) {
  if (!classInfo) {
    return (
      <Panel title={fallbackName} icon={<ClassIcon />}>
        <p className="py-6 text-center text-sm text-silver/60">
          <span className="text-silver/90">{fallbackName}</span> isn&apos;t in
          the gamedata classes table. Might be a homebrew or a slightly
          different label.
        </p>
      </Panel>
    );
  }

  const data = classInfo.data ?? {};
  const summary = pickString(data, 'summary');
  const keyAttribute = pickString(data, 'keyAttribute', 'key_ability', 'keyAbility');
  const hp = pickString(data, 'hitPoints', 'hp', 'hit_points');
  const image = pickImageUrl(data);
  const rarity = pickString(data, 'rarity');
  const source = pickString(data, 'source', 'sourcebook');
  const traits = pickStringArray(data, 'traits');
  const aonUrl = pickString(data, 'aon_url', 'aonUrl', 'archive_url');
  const proficiencies = (data.proficiencies ?? {}) as Record<string, unknown>;

  // NOTE: we deliberately do NOT render `data.description`. It's an AoN-page
  // dump that (a) duplicates keyAttribute / hitPoints / proficiencies as
  // prose, (b) contains the class-progression table already served by the
  // Class Features panel below, and (c) has no consistent heading structure.
  // The structured fields above cover the same information cleanly.

  return (
    <Panel title={classInfo.name} icon={<ClassIcon />}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {rarity && <RarityChip rarity={rarity} />}
        {source && (
          <span className="inline-flex items-center rounded border border-gold/20 bg-midnight-900/60 px-2 py-0.5 text-[0.65rem] uppercase tracking-widest text-silver/70">
            {source}
          </span>
        )}
        {aonUrl && (
          <a
            href={safeHttpUrl(aonUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded border border-gold/25 px-2 py-0.5 text-[0.65rem] uppercase tracking-widest text-arcane hover:border-arcane/60 hover:text-arcane-soft"
          >
            <BookIcon />
            Archive of Nethys
          </a>
        )}
      </div>

      {/* Iconic art (if present) alongside the summary */}
      {(image || summary) && (
        <div className="mb-5 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
          {image && (
            <figure className="mx-auto sm:mx-0">
              <img
                src={safeHttpUrl(image)}
                alt={`Iconic ${classInfo.name}`}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-40 w-auto rounded border border-gold/25 bg-midnight-900 object-contain shadow-gilded"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
              <figcaption className="mt-1 text-center text-[0.55rem] uppercase tracking-widest text-silver/40">
                Iconic
              </figcaption>
            </figure>
          )}
          {summary && (
            <p className="text-sm italic leading-relaxed text-silver/85">{summary}</p>
          )}
        </div>
      )}

      {/* Key structured stats */}
      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <BaseStat label="Key Attribute" value={keyAttribute} />
        <BaseStat
          label="Hit Points"
          value={hp != null ? `${hp} + Con mod` : null}
        />
        <BaseStat
          label="Perception"
          value={pickString(proficiencies, 'perception')}
        />
      </dl>

      {/* Traits (if any) */}
      {traits.length > 0 && (
        <div className="mb-5">
          <SectionLabel>Traits</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {traits.map((t) => (
              <TraitChip key={t} trait={t} />
            ))}
          </div>
        </div>
      )}

      {/* Initial proficiencies — driven off the structured object */}
      <InitialProficienciesBlock proficiencies={proficiencies} />
    </Panel>
  );
}

/**
 * Render `data.proficiencies` as a clean labeled grid. Each entry is a short
 * prose or bullet-list string; we keep the bullets intact by using
 * whitespace-pre-line, which respects the "\n• " newlines in the source.
 */
function InitialProficienciesBlock({
  proficiencies,
}: {
  proficiencies: Record<string, unknown>;
}) {
  const rows: Array<{ key: string; label: string; text: string | null }> = [
    { key: 'perception',   label: 'Perception',      text: pickString(proficiencies, 'perception') },
    { key: 'savingthrows', label: 'Saving Throws',   text: pickString(proficiencies, 'savingthrows', 'saving_throws') },
    { key: 'skills',       label: 'Skills',          text: pickString(proficiencies, 'skills') },
    { key: 'attacks',      label: 'Weapon Attacks',  text: pickString(proficiencies, 'attacks', 'weapons') },
    { key: 'defenses',     label: 'Defenses',        text: pickString(proficiencies, 'defenses', 'armor') },
  ];
  const filled = rows.filter((r) => r.text && r.text.trim().length > 0);
  if (filled.length === 0) return null;

  return (
    <div className="rounded border border-gold/20 bg-midnight-900/50 p-4">
      <div className="mb-3 text-[0.65rem] font-display uppercase tracking-widest text-gold/80">
        Initial Proficiencies
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {filled.map((r) => (
          <div key={r.key} className="rounded bg-midnight-900/40 p-3">
            <dt className="mb-1 text-[0.6rem] font-display uppercase tracking-widest text-gold/70">
              {r.label}
            </dt>
            <dd className="whitespace-pre-line text-sm leading-relaxed text-silver/85">
              {r.text}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Iconic image URLs in gamedata are stored as relative AoN paths like
 * `/Images/Classes/Iconic_Valeros.png`. Prepend the AoN host so <img> can
 * fetch them. Returns null if the field is missing or already absolute (in
 * which case we hand it back unchanged).
 */
function pickImageUrl(data: Record<string, unknown>): string | null {
  const raw = data.image;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string' || first.trim().length === 0) return null;
  if (/^https?:\/\//i.test(first)) return first;
  return `https://2e.aonprd.com${first.startsWith('/') ? '' : '/'}${first}`;
}

// ---------------------------------------------------------------
// Class features: grouped by level
// ---------------------------------------------------------------

function ClassFeaturesPanel({
  features,
  characterLevel,
}: {
  features: ClassFeatureRow[];
  characterLevel: number;
}) {
  if (features.length === 0) {
    return (
      <Panel title="Class Features" icon={<ClassIcon />}>
        <p className="py-4 text-center text-sm text-silver/50">
          No class features found for this class at level {characterLevel}.
          Some classes tag features by traits differently — tell me which
          class if this is unexpected.
        </p>
      </Panel>
    );
  }

  const byLevel = groupByLevel(features);
  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);

  return (
    <Panel title={`Class Features (${features.length})`} icon={<ClassIcon />}>
      <div className="space-y-4">
        {levels.map((lvl) => (
          <div key={lvl} className="border-l-2 border-gold/25 pl-3">
            <div className="mb-2 text-[0.65rem] font-display uppercase tracking-widest text-gold/80">
              Level {lvl}
            </div>
            <ul className="space-y-2">
              {byLevel.get(lvl)!.map((f) => (
                <FeatureCard key={f.id} feature={f} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FeatureCard({ feature }: { feature: ClassFeatureRow }) {
  const traits = (feature.traits ?? []).map(String);
  return (
    <li className="rounded border border-gold/15 bg-midnight-900/40 p-3">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm text-silver">{feature.name}</span>
          {feature.is_choice && (
            <span className="rounded border border-arcane/40 bg-arcane/10 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-widest text-arcane">
              Choice
            </span>
          )}
        </div>
        {feature.aon_url && (
          <a
            href={safeHttpUrl(feature.aon_url)}
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
      {feature.description && (
        <GrimoireMarkdown strip={['**Source**']}>{feature.description}</GrimoireMarkdown>
      )}
    </li>
  );
}

// ---------------------------------------------------------------
// Class feats
// ---------------------------------------------------------------

function ClassFeatsPanel({
  feats,
  characterLevel,
}: {
  feats: FeatRow[];
  characterLevel: number;
}) {
  if (feats.length === 0) {
    return (
      <Panel title="Class Feats" icon={<FeatsIcon />}>
        <p className="py-4 text-center text-sm text-silver/50">
          No class feats available at level {characterLevel}.
        </p>
      </Panel>
    );
  }

  const byLevel = groupByLevel(feats);
  const levels = Array.from(byLevel.keys()).sort((a, b) => a - b);

  return (
    <Panel title={`Class Feats (${feats.length})`} icon={<FeatsIcon />}>
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
  const traits = (feat.traits ?? []).map(String);
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
            href={safeHttpUrl(feat.aon_url)}
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
        <GrimoireMarkdown strip={['**Source**']}>{feat.description}</GrimoireMarkdown>
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
      <Panel title="Class" icon={icon}>
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

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 text-[0.6rem] uppercase tracking-widest text-gold/70">
      {children}
    </div>
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

// ---------------------------------------------------------------
// Data helpers — reach into the gamedata JSONB defensively
// ---------------------------------------------------------------

function pickString(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}


function pickStringArray(obj: unknown, key: string): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const v = (obj as Record<string, unknown>)[key];
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter((s) => s.trim().length > 0);
  if (typeof v === 'string')
    return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function groupByLevel<T extends { level?: number | null }>(rows: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const r of rows) {
    const lvl = r.level ?? 1;
    const arr = out.get(lvl) ?? [];
    arr.push(r);
    out.set(lvl, arr);
  }
  return out;
}
