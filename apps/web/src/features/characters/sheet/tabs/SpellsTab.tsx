import { useCallback, useMemo, useState } from 'react';
import { safeHttpUrl } from "@/lib/safeUrl";
import { GrimoireMarkdown } from '@/components/ui/GrimoireMarkdown';
import { useSpellsByNames } from '@/features/characters/useSpellsByNames';
import { useSpellSearch } from '@/features/characters/useSpellSearch';
import {
  abilityMod,
  type FocusPools,
  type PathbuilderBuild,
  type Spellcaster,
} from '@/features/characters/pathbuilder';
import type {
  AddedSpell,
  CharacterRow,
  SpellRow,
} from '@/features/characters/types';
import { Panel, type EditControls } from '../Sheet';
import { SpellsIcon, StarIcon } from '../icons';

/**
 * Full spellcasting deep-dive with click-to-expand descriptions.
 *
 * Every spell chip on the tab is a button — clicking it expands an inline
 * detail card (traits, action cost, range, area, targets, saving throw,
 * duration, heightened text, full description, AoN link). Multiple can be
 * expanded at once so the sheet serves as a live combat reference.
 *
 * Layout uses CSS grid rather than flex-wrap so the expanded detail card
 * (`col-span-full`) can span the full row without disrupting the chip flow.
 */
export function SpellsTab({
  build,
  character,
  edit,
}: {
  build: PathbuilderBuild;
  character: CharacterRow;
  edit: EditControls;
}) {
  // Memoize the fallbacks so a fresh empty array/object each render doesn't
  // invalidate downstream useMemo deps (and their queries).
  const casters = useMemo(() => build.spellCasters ?? [], [build.spellCasters]);
  const focus = useMemo(() => build.focus ?? {}, [build.focus]);

  // Player-added spells (web-owned overlay slot), sorted by rank then name.
  const added = useMemo(
    () =>
      [...(character.overlay?.web_edits?.spells ?? [])].sort(
        (a, b) => a.rank - b.rank || a.name.localeCompare(b.name),
      ),
    [character.overlay?.web_edits?.spells],
  );

  // Every unique spell name across all casters + focus pools + added spells
  // → one query for descriptions.
  const allNames = useMemo(
    () => [...collectAllSpellNames(casters, focus), ...added.map((s) => s.name)],
    [casters, focus, added],
  );
  const { data: spellRows } = useSpellsByNames(allNames);

  // Lookup: lowercased name → SpellRow (case-insensitive so "Heal" and "heal" match).
  const spellMap = useMemo(() => {
    const m = new Map<string, SpellRow>();
    for (const s of spellRows ?? []) m.set(s.name.toLowerCase(), s);
    return m;
  }, [spellRows]);

  // Multiple spells can be expanded at once — a set of lowercased names.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((name: string) => {
    const key = name.toLowerCase();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const ctx: SpellCtx = { spellMap, expanded, toggleExpanded };

  const mainCasters = casters.filter((c) => !c.innate && hasAnyContent(c));
  const innateCasters = casters.filter((c) => c.innate && hasAnyContent(c));
  const focusEntries = flattenFocus(focus);

  // Transform the web-owned spell list inside an overlay mutator so it runs
  // against the freshest overlay (concurrent bot writes survive) and only
  // web_edits.spells is touched.
  const transformAdded = (fn: (spells: AddedSpell[]) => AddedSpell[]) =>
    edit.updateOverlay((o) => ({
      ...o,
      web_edits: { ...(o.web_edits ?? {}), spells: fn(o.web_edits?.spells ?? []) },
    }));
  const addSpell = (name: string, rank: number) =>
    transformAdded((spells) =>
      spells.some((s) => s.name.toLowerCase() === name.toLowerCase())
        ? spells
        : [...spells, { name, rank }],
    );
  const removeSpell = (name: string) =>
    transformAdded((spells) => spells.filter((s) => s.name.toLowerCase() !== name.toLowerCase()));

  const hasBuildSpells =
    mainCasters.length > 0 || innateCasters.length > 0 || focusEntries.length > 0;

  // Show the "Added Spells" grimoire whenever there's something to show or the
  // owner can add to it — so a character with no spellcasting can still keep a
  // list (archetype spells, scrolls, wands, etc.).
  const showAdded = edit.enabled || added.length > 0;

  if (!hasBuildSpells && !showAdded) {
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
        <SpellcasterPanel key={`c-${i}`} caster={c} build={build} ctx={ctx} />
      ))}
      {innateCasters.length > 0 && (
        <InnateSpellsPanel casters={innateCasters} ctx={ctx} />
      )}
      {focusEntries.length > 0 && (
        <FocusSpellsPanel entries={focusEntries} build={build} ctx={ctx} />
      )}
      {showAdded && (
        <AddedSpellsPanel
          added={added}
          ctx={ctx}
          canEdit={edit.enabled}
          onAdd={addSpell}
          onRemove={removeSpell}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Added spells (web-owned) + picker
// ---------------------------------------------------------------

function AddedSpellsPanel({
  added,
  ctx,
  canEdit,
  onAdd,
  onRemove,
}: {
  added: AddedSpell[];
  ctx: SpellCtx;
  canEdit: boolean;
  onAdd: (name: string, rank: number) => void;
  onRemove: (name: string) => void;
}) {
  const byRank = new Map<number, AddedSpell[]>();
  for (const s of added) {
    const list = byRank.get(s.rank) ?? [];
    list.push(s);
    byRank.set(s.rank, list);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const existing = new Set(added.map((s) => s.name.toLowerCase()));

  return (
    <Panel title="Added Spells" icon={<SpellsIcon />}>
      {canEdit && (
        <div className="mb-3">
          <AddSpellPicker existing={existing} onAdd={onAdd} />
        </div>
      )}
      {added.length === 0 ? (
        <p className="py-4 text-center text-sm text-silver/50">
          No added spells yet. Use “Add a spell” to search the archive and pin
          spells from scrolls, wands, archetypes, or anything the build doesn’t
          already track.
        </p>
      ) : (
        <div className="space-y-3">
          {ranks.map((rank) => (
            <div key={rank} className="border-l-2 border-gold/25 pl-3">
              <div className="mb-1.5 font-display text-xs uppercase tracking-widest text-gold/90">
                {rank === 0 ? 'Cantrips' : `Rank ${rank}`}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
                {byRank.get(rank)!.map((s) => (
                  <AddedSpellChip
                    key={s.name}
                    name={s.name}
                    ctx={ctx}
                    onRemove={canEdit ? () => onRemove(s.name) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Like SpellChipWithDetail but with an optional remove control. */
function AddedSpellChip({
  name,
  ctx,
  onRemove,
}: {
  name: string;
  ctx: SpellCtx;
  onRemove?: () => void;
}) {
  const key = name.toLowerCase();
  const row = ctx.spellMap.get(key);
  const isExpanded = ctx.expanded.has(key);

  return (
    <>
      <div
        className={`inline-flex items-center justify-between gap-1 rounded border px-2 py-1 text-xs transition-colors ${
          isExpanded
            ? 'border-gold/60 bg-gold/10 text-gold'
            : 'border-gold/15 bg-midnight-900/60 text-silver/90 hover:border-gold/40'
        }`}
      >
        <button
          type="button"
          onClick={() => ctx.toggleExpanded(name)}
          className="min-w-0 flex-1 truncate text-left hover:text-gold/90"
        >
          {name}
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
            title="Remove spell"
            className="shrink-0 text-silver/40 hover:text-red-300"
          >
            ×
          </button>
        )}
      </div>
      {isExpanded && (
        <div className="col-span-full">
          <SpellDetailCard name={name} row={row} />
        </div>
      )}
    </>
  );
}

function AddSpellPicker({
  existing,
  onAdd,
}: {
  existing: Set<string>;
  onAdd: (name: string, rank: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { data: results, isFetching } = useSpellSearch(query);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-display uppercase tracking-widest text-gold hover:bg-gold/20"
      >
        + Add a spell
      </button>
    );
  }

  return (
    <div className="rounded border border-gold/25 bg-midnight-900/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search spells by name…"
          className="w-full rounded border border-gold/30 bg-midnight-800/80 px-2 py-1.5 text-sm text-silver focus:border-gold/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery('');
          }}
          className="shrink-0 text-xs uppercase tracking-widest text-silver/60 hover:text-gold"
        >
          Done
        </button>
      </div>
      {query.trim().length < 2 ? (
        <p className="px-1 py-2 text-xs text-silver/40">Type at least 2 letters to search.</p>
      ) : isFetching ? (
        <p className="px-1 py-2 text-xs text-silver/40">Searching…</p>
      ) : (results?.length ?? 0) === 0 ? (
        <p className="px-1 py-2 text-xs text-silver/40">No spells match “{query.trim()}”.</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {results!.map((r) => {
            const already = existing.has(r.name.toLowerCase());
            return (
              <li key={r.name}>
                <button
                  type="button"
                  disabled={already}
                  onClick={() => onAdd(r.name, r.rank)}
                  className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-sm ${
                    already
                      ? 'cursor-default border-gold/10 bg-midnight-900/40 text-silver/40'
                      : 'border-gold/15 bg-midnight-900/60 text-silver/90 hover:border-gold/40 hover:text-gold'
                  }`}
                >
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-[0.6rem] uppercase tracking-widest text-silver/50">
                      {r.rank === 0 ? 'Cantrip' : `Rank ${r.rank}`}
                    </span>
                    {already && (
                      <span className="text-[0.6rem] uppercase tracking-widest text-emerald-soft">
                        Added
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------

interface SpellCtx {
  spellMap: Map<string, SpellRow>;
  expanded: Set<string>;
  toggleExpanded: (name: string) => void;
}

// ---------------------------------------------------------------
// Non-innate caster panel
// ---------------------------------------------------------------

function SpellcasterPanel({
  caster,
  build,
  ctx,
}: {
  caster: Spellcaster;
  build: PathbuilderBuild;
  ctx: SpellCtx;
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
                ctx={ctx}
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
  ctx,
}: {
  level: number;
  spells: string[];
  slots: number;
  prepared: string[];
  showPrepared: boolean;
  ctx: SpellCtx;
}) {
  return (
    <div className="border-l-2 border-gold/25 pl-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
        <span className="font-display uppercase tracking-widest text-gold/90">
          {level === 0 ? 'Cantrips' : `Rank ${level}`}
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
      <SpellChipGrid spells={spells} ctx={ctx} />
    </div>
  );
}

/**
 * CSS grid layout for spell chips. Grid columns via auto-fill/minmax so each
 * chip claims ~140px min-width; expanded detail cards use col-span-full to
 * flow underneath their chip without breaking layout.
 *
 * Duplicates in the incoming name list (e.g. Heal prepared in all four
 * Divine Font slots) are collapsed to one chip with a `×N` count tag —
 * mechanically the four slots all point to the same spell, so showing four
 * identical chips is noise; the ×N badge preserves the "how many prepared"
 * information without the repetition.
 */
function SpellChipGrid({
  spells,
  ctx,
  emptyLabel = '—',
}: {
  spells: string[];
  ctx: SpellCtx;
  emptyLabel?: string;
}) {
  if (spells.length === 0) return <span className="text-xs text-silver/40">{emptyLabel}</span>;

  const counts = new Map<string, { name: string; count: number }>();
  for (const raw of spells) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { name: trimmed, count: 1 });
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
      {Array.from(counts.values()).map(({ name, count }) => (
        <SpellChipWithDetail
          key={name}
          name={name}
          tag={count > 1 ? `×${count}` : undefined}
          ctx={ctx}
        />
      ))}
    </div>
  );
}

function SpellChipWithDetail({
  name,
  tag,
  ctx,
}: {
  name: string;
  tag?: string;
  ctx: SpellCtx;
}) {
  const key = name.toLowerCase();
  const row = ctx.spellMap.get(key);
  const isExpanded = ctx.expanded.has(key);

  return (
    <>
      <button
        type="button"
        onClick={() => ctx.toggleExpanded(name)}
        className={`inline-flex items-center justify-between gap-1 rounded border px-2 py-1 text-left text-xs transition-colors ${
          isExpanded
            ? 'border-gold/60 bg-gold/10 text-gold'
            : 'border-gold/15 bg-midnight-900/60 text-silver/90 hover:border-gold/40 hover:text-gold/90'
        }`}
      >
        <span className="truncate">{name}</span>
        {tag && (
          <span className="ml-1 shrink-0 text-[0.6rem] uppercase tracking-widest text-silver/50">
            {tag}
          </span>
        )}
      </button>
      {isExpanded && (
        <div className="col-span-full">
          <SpellDetailCard name={name} row={row} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------
// The expanded detail card
// ---------------------------------------------------------------

function SpellDetailCard({ name, row }: { name: string; row?: SpellRow }) {
  if (!row) {
    return (
      <div className="my-2 rounded border border-gold/25 bg-midnight-900/70 p-3">
        <div className="mb-1 font-display text-sm text-gold">{name}</div>
        <p className="text-xs italic text-silver/50">
          No reference entry in the archive — description unavailable.
        </p>
      </div>
    );
  }

  const traits = normalizeStringArray(row.traits);
  const spellLevel = row.rank ?? row.level ?? row.spell_level ?? null;
  const actions = pickString(row, 'actions', 'action_cost');
  const range = pickString(row, 'range');
  const area = pickString(row, 'area');
  const targets = pickString(row, 'targets');
  const savingThrow = pickString(row, 'saving_throw', 'save');
  const duration = pickString(row, 'duration');
  const heightened = pickString(row, 'heightened');
  const source = pickString(row, 'source');
  const rarity = pickString(row, 'rarity');

  return (
    <div className="my-2 rounded border border-gold/30 bg-midnight-900/70 p-4 shadow-gilded">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-baseline gap-2">
            <h4 className="font-display text-lg text-gold">{row.name}</h4>
            {spellLevel != null && (
              <span className="rounded border border-arcane/40 bg-arcane/10 px-1.5 py-0.5 text-[0.6rem] font-display uppercase tracking-widest text-arcane">
                {spellLevel === 0 ? 'Cantrip' : `Rank ${spellLevel}`}
              </span>
            )}
            {actions && (
              <span className="rounded border border-gold/25 bg-midnight-900/70 px-1.5 py-0.5 text-[0.6rem] uppercase text-silver/70">
                {actions}
              </span>
            )}
            {rarity && rarity.toLowerCase() !== 'common' && (
              <RarityChip rarity={rarity} />
            )}
          </div>
          {source && (
            <div className="mt-1 text-[0.6rem] uppercase tracking-widest text-silver/50">
              {source}
            </div>
          )}
        </div>
        {row.aon_url && (
          <a
            href={safeHttpUrl(row.aon_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[0.65rem] uppercase tracking-widest text-arcane hover:text-arcane-soft"
          >
            AoN ↗
          </a>
        )}
      </div>

      {traits.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {traits.map((t) => (
            <TraitChip key={t} trait={t} />
          ))}
        </div>
      )}

      {/* Mechanics grid */}
      {(range || area || targets || savingThrow || duration) && (
        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {range && <MechEntry label="Range" value={range} />}
          {area && <MechEntry label="Area" value={area} />}
          {targets && <MechEntry label="Targets" value={targets} />}
          {savingThrow && <MechEntry label="Save" value={savingThrow} />}
          {duration && <MechEntry label="Duration" value={duration} />}
        </dl>
      )}

      {row.description && (
        <GrimoireMarkdown strip={['**Source**']}>{row.description}</GrimoireMarkdown>
      )}

      {heightened && (
        <div className="mt-3 border-t border-gold/15 pt-3">
          <div className="mb-1 text-[0.6rem] uppercase tracking-widest text-gold/70">
            Heightened
          </div>
          <GrimoireMarkdown strip={['**Source**']}>{heightened}</GrimoireMarkdown>
        </div>
      )}
    </div>
  );
}

function MechEntry({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline text-[0.6rem] uppercase tracking-widest text-gold/70">
        {label}:{' '}
      </dt>
      <dd className="inline text-silver/85">{value}</dd>
    </div>
  );
}

function SlotDots({ count }: { count: number }) {
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
// Innate spells
// ---------------------------------------------------------------

function InnateSpellsPanel({
  casters,
  ctx,
}: {
  casters: Spellcaster[];
  ctx: SpellCtx;
}) {
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1.5">
                {dedupeInnate(spells).map(({ name, level, count }) => (
                  <SpellChipWithDetail
                    key={name}
                    name={name}
                    tag={`${perDayLabel(c, level)}${count > 1 ? ` ×${count}` : ''}`}
                    ctx={ctx}
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
  ctx,
}: {
  entries: FocusEntry[];
  build: PathbuilderBuild;
  ctx: SpellCtx;
}) {
  return (
    <Panel title="Focus Spells" icon={<StarIcon />}>
      <ul className="space-y-3">
        {entries.map((e, i) => {
          const level = build.level ?? 1;
          const rank = e.proficiency ?? 0;
          const focusAttack =
            rank > 0
              ? level + rank + (e.abilityBonus ?? 0) + (e.itemBonus ?? 0)
              : e.abilityBonus ?? 0;
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
                <div className="mb-2">
                  <div className="mb-1 text-[0.6rem] uppercase tracking-widest text-gold/70">
                    Focus Cantrips
                  </div>
                  <SpellChipGrid spells={e.focusCantrips} ctx={ctx} />
                </div>
              )}
              {e.focusSpells.length > 0 && (
                <div>
                  <div className="mb-1 text-[0.6rem] uppercase tracking-widest text-gold/70">
                    Focus Spells
                  </div>
                  <SpellChipGrid spells={e.focusSpells} ctx={ctx} />
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

function TraitChip({ trait }: { trait: string }) {
  return (
    <span className="inline-flex items-center rounded border border-gold/20 bg-midnight-900/70 px-1.5 py-0 text-[0.6rem] uppercase tracking-widest text-silver/75">
      {trait}
    </span>
  );
}

function RarityChip({ rarity }: { rarity: string }) {
  const r = rarity.toLowerCase();
  const cls =
    r === 'uncommon'
      ? 'border-arcane/40 bg-arcane/10 text-arcane'
      : r === 'rare'
      ? 'border-gold/50 bg-gold/10 text-gold'
      : r === 'unique'
      ? 'border-brass/60 bg-brass/15 text-gold-soft'
      : 'border-gold/20 bg-midnight-900/60 text-silver/70';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[0.6rem] font-display uppercase tracking-widest ${cls}`}
    >
      {rarity}
    </span>
  );
}

// ---------------------------------------------------------------
// Data + math helpers
// ---------------------------------------------------------------

function collectAllSpellNames(casters: Spellcaster[], focus: FocusPools): string[] {
  const names = new Set<string>();
  for (const c of casters) {
    for (const sl of c.spells ?? []) {
      for (const n of sl.list ?? []) names.add(n);
    }
    for (const prep of c.prepared ?? []) {
      for (const n of prep?.list ?? []) names.add(n);
    }
  }
  for (const tradition of Object.values(focus ?? {})) {
    for (const ability of Object.values(tradition)) {
      for (const n of ability.focusSpells ?? []) names.add(n);
      for (const n of ability.focusCantrips ?? []) names.add(n);
    }
  }
  return Array.from(names);
}

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

/**
 * Collapse identical innate-spell entries (same name, same level) to one row
 * with a count. Different levels of the same name stay separate — an innate
 * caster that grants Mindlink both at cantrip and level-2 rank would still
 * show as two chips.
 */
function dedupeInnate(
  spells: Array<{ level: number; name: string }>,
): Array<{ name: string; level: number; count: number }> {
  const map = new Map<string, { name: string; level: number; count: number }>();
  for (const s of spells) {
    const key = `${s.level}::${s.name.trim().toLowerCase()}`;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { name: s.name.trim(), level: s.level, count: 1 });
  }
  return Array.from(map.values());
}

function perDayLabel(c: Spellcaster, level: number): string {
  const n = c.perDay?.[level] ?? 1;
  return n === 1 ? '1/day' : `${n}/day`;
}

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

function pickString(row: SpellRow, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = (row as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function normalizeStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter((s) => s.trim().length > 0);
  if (typeof v === 'string') return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [];
}
