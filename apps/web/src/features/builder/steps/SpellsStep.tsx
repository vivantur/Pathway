import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { GrimoireMarkdown } from '@/components/ui/GrimoireMarkdown';
import { findClass, findSpell, getDataset, type Spell } from '@/features/builder/data';
import { useBuilder } from '../store';
import type { SpellTradition } from '../types';
import {
  casterConfig,
  cantripsFor,
  focusCantripsFor,
  focusConfig,
  focusPoolSize,
  focusSpellsFor,
  focusStats,
  focusTraditionFor,
  maxSpellRank,
  resolveCasterTradition,
  slotsForRank,
  spellStats,
  spellsForRank,
  subclassNote,
} from '../spellcasting';

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || (n >= 11 && n <= 13) ? 0 : n % 10]}`;

function SpellSection({
  title,
  hint,
  candidates,
  selected,
  max,
  onToggle,
}: {
  title: string;
  hint: string;
  candidates: Spell[];
  selected: string[];
  /** Selection cap; omit for no limit (focus spells aren't slot-limited). */
  max?: number;
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<{ spell: Spell; top: number; left: number } | null>(null);
  const chosen = new Set(selected);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? candidates.filter((s) => s.name.toLowerCase().includes(q)) : candidates;
  }, [candidates, query]);
  const capped = max != null;
  const remaining = capped ? max - chosen.size : Infinity;
  const atLimit = capped && remaining <= 0;

  const showTip = (spell: Spell, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = 320;
    // Prefer the right of the row; flip to the left if it would overflow.
    let left = r.right + 10;
    if (left + width > window.innerWidth - 8) left = Math.max(8, r.left - width - 10);
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 240));
    setHover({ spell, top, left });
  };

  return (
    <section className="panel flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-display text-lg text-gold-400">{title}</h4>
        <span className={`font-ui text-xs ${atLimit ? 'text-green-300' : 'text-parchment/60'}`}>
          {chosen.size}
          {capped ? `/${max}` : ''} chosen
        </span>
      </div>
      <p className="font-ui text-xs text-parchment/60">{hint} Hover a spell to read what it does.</p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search spells…"
        className="rounded-lg border border-gold-500/25 bg-midnight-950/50 px-3 py-2 font-ui text-sm text-parchment placeholder:text-parchment/40 focus:border-gold-400/60 focus:outline-none"
      />
      <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
        {filtered.map((s) => {
          const isChosen = chosen.has(s.id);
          const disabled = !isChosen && atLimit;
          return (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(s.id)}
              onMouseEnter={(e) => showTip(s, e.currentTarget)}
              onMouseLeave={() => setHover(null)}
              onFocus={(e) => showTip(s, e.currentTarget)}
              onBlur={() => setHover(null)}
              className="choice-card flex items-center justify-between gap-2 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
              data-selected={isChosen}
            >
              <span className="min-w-0">
                <span className="font-display text-parchment">{s.name}</span>
                <span className="ml-2 font-ui text-[11px] text-parchment/50">
                  {s.traits.slice(0, 3).join(', ')}
                </span>
              </span>
              {s.cast && (
                <span className="shrink-0 font-ui text-[10px] uppercase tracking-wider text-parchment/40">
                  {s.cast === 'reaction' ? '⚡' : `${s.cast}⌛`}
                </span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="font-ui text-sm text-parchment/50">No spells match your search.</p>
        )}
      </div>

      {hover &&
        createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-h-[80vh] w-80 overflow-hidden rounded-xl border border-gold-500/40 bg-midnight-900/95 p-3 shadow-rune backdrop-blur"
          style={{ top: hover.top, left: hover.left }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-gold-400">{hover.spell.name}</span>
            <span className="font-ui text-[10px] uppercase tracking-wider text-parchment/50">
              {hover.spell.traits.includes('cantrip') ? 'Cantrip' : `Rank ${hover.spell.rank}`}
            </span>
          </div>
          {hover.spell.traits.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {hover.spell.traits.slice(0, 6).map((t) => (
                <span
                  key={t}
                  className="rounded bg-midnight-700/70 px-1.5 py-0.5 font-ui text-[10px] text-parchment/70"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-ui text-[10px] text-parchment/70">
            {hover.spell.cast && (
              <SpellMeta label="Cast" value={hover.spell.cast === 'reaction' ? 'reaction' : `${hover.spell.cast} action(s)`} />
            )}
            {hover.spell.range && <SpellMeta label="Range" value={hover.spell.range} />}
            {hover.spell.area && <SpellMeta label="Area" value={hover.spell.area} />}
            {hover.spell.targets && <SpellMeta label="Targets" value={hover.spell.targets} />}
            {hover.spell.defense && <SpellMeta label="Defense" value={hover.spell.defense} />}
            {hover.spell.duration && <SpellMeta label="Duration" value={hover.spell.duration} />}
          </dl>
          <div className="mt-2 border-t border-gold-500/15 pt-2">
            {hover.spell.description ? (
              <GrimoireMarkdown>{hover.spell.description}</GrimoireMarkdown>
            ) : (
              <p className="font-ui text-xs text-parchment/60">No description available.</p>
            )}
          </div>
        </div>,
          document.body,
        )}
    </section>
  );
}

function SpellMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="truncate">
      <span className="uppercase tracking-wider text-parchment/45">{label}: </span>
      <span className="text-parchment/85">{value}</span>
    </div>
  );
}

function FocusSpellsSection() {
  const state = useBuilder((s) => s.state);
  const toggleFocusSpell = useBuilder((s) => s.toggleFocusSpell);
  const toggleFocusCantrip = useBuilder((s) => s.toggleFocusCantrip);
  const setFocusTradition = useBuilder((s) => s.setFocusTradition);

  const cfg = focusConfig(state.classId, state.subclassId);
  if (!cfg) return null;

  const stats = focusStats(state);
  const tradition = focusTraditionFor(state);
  const spells = focusSpellsFor(state.classId);
  const cantrips = focusCantripsFor(state.classId);
  const pool = focusPoolSize(state);
  // Summoner picks one eidolon tradition for BOTH its slots and its focus
  // spells; the slot section already shows that selector, so don't duplicate it.
  const casterHasChoice = Boolean(casterConfig(state.classId, state.subclassId)?.traditionChoices);
  const showTraditionSelect = Boolean(cfg.traditionChoices) && !casterHasChoice;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-arcane-400/25 bg-arcane-500/5 p-5">
      <div>
        <h4 className="font-display text-lg text-arcane-400">Focus Spells</h4>
        <p className="mt-1 font-ui text-sm text-parchment/70">
          Focus spells are cast from a special pool of Focus Points (max 3), refreshed with the
          10‑minute Refocus activity. You gain them from class features and feats — pick the ones your
          build grants.
        </p>
        {showTraditionSelect && cfg.traditionChoices && (
          <label className="mt-3 flex flex-wrap items-center gap-2 font-ui text-sm text-parchment/80">
            Tradition:
            <select
              value={tradition ?? ''}
              onChange={(e) => setFocusTradition(e.target.value)}
              className="rounded-lg border border-arcane-400/30 bg-midnight-950/50 px-2 py-1 text-parchment focus:border-arcane-400/60 focus:outline-none"
            >
              {cfg.traditionChoices.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-3 flex flex-wrap gap-2 font-ui text-sm">
          <span className="rounded-lg border border-arcane-400/25 bg-midnight-800/60 px-3 py-1.5 text-parchment">
            Focus pool <span className="text-arcane-400">{pool}</span>
          </span>
          {stats && (
            <>
              <span className="rounded-lg border border-arcane-400/25 bg-midnight-800/60 px-3 py-1.5 text-parchment">
                Focus attack <span className="text-arcane-400">{sign(stats.attack)}</span>
              </span>
              <span className="rounded-lg border border-arcane-400/25 bg-midnight-800/60 px-3 py-1.5 text-parchment">
                Focus DC <span className="text-arcane-400">{stats.dc}</span>
              </span>
              <span className="rounded-lg border border-arcane-400/25 bg-midnight-800/60 px-3 py-1.5 text-parchment">
                Tradition <span className="text-arcane-400">{stats.tradition}</span>
              </span>
            </>
          )}
        </div>
      </div>

      {cantrips.length > 0 && (
        <SpellSection
          title="Focus Cantrips"
          hint="Focus cantrips your class grants."
          candidates={cantrips}
          selected={state.spellcasting.focusCantrips ?? []}
          onToggle={toggleFocusCantrip}
        />
      )}

      {spells.length > 0 ? (
        <SpellSection
          title="Focus Spells"
          hint="Each is granted by a specific class feature or feat; select those your build has."
          candidates={spells}
          selected={state.spellcasting.focusSpells ?? []}
          onToggle={toggleFocusSpell}
        />
      ) : (
        <p className="font-ui text-sm text-parchment/50">
          No focus spells for this class are in the current data set.
        </p>
      )}
    </section>
  );
}

const TRADITIONS: SpellTradition[] = ['arcane', 'divine', 'occult', 'primal'];
const spellRankLabel = (s: Spell) => (s.traits.includes('cantrip') ? 'Cantrip' : `Rank ${s.rank}`);

/**
 * Innate spells come from ancestry, heritage, feats, or magic items — not a
 * spellcasting class — so this is shown for every character. Since the dataset
 * doesn't encode which source grants which innate spell, the player records the
 * ones their build has (the same "guide, don't over-constrain" approach as
 * focus spells), choosing each spell's tradition and how many times per day.
 */
function InnateSpellsSection() {
  const state = useBuilder((s) => s.state);
  const addInnate = useBuilder((s) => s.addInnateSpell);
  const removeInnate = useBuilder((s) => s.removeInnateSpell);
  const setPerDay = useBuilder((s) => s.setInnatePerDay);
  const setTradition = useBuilder((s) => s.setInnateTradition);
  const [query, setQuery] = useState('');

  const innate = state.innateSpells ?? [];
  const defaultTradition = (resolveCasterTradition(state) ??
    focusTraditionFor(state) ??
    'arcane') as SpellTradition;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(innate.map((e) => e.spellId));
    return getDataset()
      .spells.filter((s) => s.name.toLowerCase().includes(q) && !chosen.has(s.id))
      .slice(0, 24);
  }, [query, innate]);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-gold-500/20 bg-midnight-800/40 p-5">
      <div>
        <h4 className="font-display text-lg text-gold-400">Innate Spells</h4>
        <p className="mt-1 font-ui text-sm text-parchment/70">
          Innate spells come from your ancestry, heritage, feats, or magic items. Add any your build
          grants and set each spell’s tradition and how often you can cast it.
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search any spell to add…"
        className="rounded-lg border border-gold-500/25 bg-midnight-950/50 px-3 py-2 font-ui text-sm text-parchment placeholder:text-parchment/40 focus:border-gold-400/60 focus:outline-none"
      />
      {results.length > 0 && (
        <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
          {results.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                addInnate(s.id, defaultTradition);
                setQuery('');
              }}
              className="choice-card flex items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="font-display text-parchment">{s.name}</span>
              <span className="font-ui text-[11px] text-parchment/50">{spellRankLabel(s)}</span>
            </button>
          ))}
        </div>
      )}

      {innate.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {innate.map((e) => {
            const spell = findSpell(e.spellId);
            if (!spell) return null;
            return (
              <li
                key={e.spellId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-gold-500/20 bg-midnight-900/50 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-display text-parchment">{spell.name}</span>
                  <span className="ml-2 font-ui text-[11px] text-parchment/50">{spellRankLabel(spell)}</span>
                </span>
                <select
                  value={e.tradition}
                  onChange={(ev) => setTradition(e.spellId, ev.target.value as SpellTradition)}
                  className="rounded-lg border border-gold-500/25 bg-midnight-950/50 px-2 py-1 font-ui text-xs text-parchment focus:border-gold-400/60 focus:outline-none"
                  aria-label={`Tradition for ${spell.name}`}
                >
                  {TRADITIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className="flex items-center gap-1 font-ui text-xs text-parchment/70">
                  <button
                    type="button"
                    className="btn px-2 py-0.5"
                    onClick={() => setPerDay(e.spellId, e.perDay - 1)}
                    aria-label="Fewer per day"
                  >
                    −
                  </button>
                  {e.perDay}/day
                  <button
                    type="button"
                    className="btn px-2 py-0.5"
                    onClick={() => setPerDay(e.spellId, e.perDay + 1)}
                    aria-label="More per day"
                  >
                    +
                  </button>
                </span>
                <button
                  type="button"
                  className="btn px-2 py-0.5 text-xs"
                  onClick={() => removeInnate(e.spellId)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="font-ui text-xs text-parchment/50">No innate spells added.</p>
      )}
    </section>
  );
}

export function SpellsStep() {
  const state = useBuilder((s) => s.state);
  const toggleCantrip = useBuilder((s) => s.toggleCantrip);
  const toggleSpell = useBuilder((s) => s.toggleSpell);
  const setFocusTradition = useBuilder((s) => s.setFocusTradition);

  const cfg = casterConfig(state.classId, state.subclassId);
  const focus = focusConfig(state.classId, state.subclassId);
  const klass = state.classId ? findClass(state.classId) : undefined;

  const stats = cfg ? spellStats(state) : null;
  const tradition = resolveCasterTradition(state);
  const maxRank = maxSpellRank(state.level || 1, cfg?.progression);
  const ranks = Array.from({ length: maxRank }, (_, i) => i + 1);
  const sub = subclassNote(state);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 font-display text-xl text-gold-400">Spells</h3>
        {cfg ? (
          <p className="font-ui text-sm text-parchment/70">
            As a{' '}
            <span className="text-parchment">
              {cfg.type} {tradition}
            </span>{' '}
            caster, you cast {tradition} spells using {cfg.keyAbility.toUpperCase()}.
            {sub ? ` (${sub})` : ''}
            {cfg.progression === 'bounded' &&
              (cfg.type === 'spontaneous'
                ? ' Every spell you know is a signature spell.'
                : ' You also gain Studious Spells slots (restricted to specific spells) not shown here.')}
          </p>
        ) : focus ? (
          <p className="font-ui text-sm text-parchment/70">
            The {klass?.name} doesn’t cast spells from slots, but it draws on focus spells.
          </p>
        ) : (
          <p className="font-ui text-sm text-parchment/70">
            {klass ? `The ${klass.name} isn’t a spellcasting class` : 'Choose a class first'} — but any
            character can gain innate spells from their ancestry, feats, or magic items.
          </p>
        )}
        {cfg?.traditionChoices && (
          <label className="mt-3 flex flex-wrap items-center gap-2 font-ui text-sm text-parchment/80">
            Tradition (from your eidolon):
            <select
              value={tradition ?? ''}
              onChange={(e) => setFocusTradition(e.target.value)}
              className="rounded-lg border border-gold-500/30 bg-midnight-950/50 px-2 py-1 text-parchment focus:border-gold-400/60 focus:outline-none"
            >
              {cfg.traditionChoices.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}
        {stats && (
          <div className="mt-3 flex flex-wrap gap-2 font-ui text-sm">
            <span className="rounded-lg border border-gold-500/25 bg-midnight-800/60 px-3 py-1.5 text-parchment">
              Spell attack <span className="text-gold-400">{sign(stats.attack)}</span>
            </span>
            <span className="rounded-lg border border-gold-500/25 bg-midnight-800/60 px-3 py-1.5 text-parchment">
              Spell DC <span className="text-gold-400">{stats.dc}</span>
            </span>
          </div>
        )}
      </div>

      {cfg && tradition && (
        <>
          <SpellSection
            title="Cantrips"
            hint="At-will spells you can cast any number of times. They automatically scale with your level."
            candidates={cantripsFor(tradition)}
            selected={state.spellcasting.cantrips}
            max={cfg.cantrips}
            onToggle={(id) => toggleCantrip(id, cfg.cantrips)}
          />

          {ranks.map((rank) => {
            const max = slotsForRank(state.level || 1, rank, cfg.progression);
            return (
              <SpellSection
                key={rank}
                title={`${ordinal(rank)}-Rank Spells`}
                hint={
                  cfg.type === 'spontaneous'
                    ? 'Spells in your repertoire — you can cast any of them using a slot of this rank.'
                    : 'Spells you can prepare in your slots of this rank each day.'
                }
                candidates={spellsForRank(tradition, rank)}
                selected={state.spellcasting.spellsByRank[rank] ?? []}
                max={max}
                onToggle={(id) => toggleSpell(rank, id, max)}
              />
            );
          })}
        </>
      )}

      {focus && <FocusSpellsSection />}

      <InnateSpellsSection />
    </div>
  );
}
