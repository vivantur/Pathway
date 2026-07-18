import { useMemo, useState } from 'react';
import {
  CONDITIONS,
  CONDITION_SLUGS,
  describePredicate,
  evaluate,
  type PassiveEffect,
  type UnmodeledReason,
} from '@pathway/core';
import { GildedRule } from '@/components/ui/GildedRule';

/**
 * Condition coverage — the admin diagnostic over core's condition vocabulary.
 *
 * WHAT THIS IS FOR: most PF2e conditions are not modifiers, so the sheet can only ever
 * show part of what a condition does. `conditions.ts` is built so that the rest is
 * NAMED rather than silently missing (the `unmodeled` vocabulary). This page is how a
 * human reads that: what each condition actually contributes to a sheet, and what it
 * does that we cannot yet express.
 *
 * It exists because gaps were being found by playing. Reading them off a screen is
 * cheaper — the tally is a roadmap, exactly like the effect-ingest coverage page.
 *
 * No dynamic import here, unlike EffectCoveragePage: this data IS core's table, a few
 * KB already in the bundle, not a multi-megabyte ingest sidecar.
 */

const GAP_COPY: Record<UnmodeledReason, string> = {
  'action-economy': 'Changes how many actions you get. Needs an action model.',
  'action-restriction': 'Restricts which actions you may use. Needs an action model.',
  detection: 'Visibility/targeting state between creatures. Needs a detection model.',
  'flat-check': 'Imposes a flat check to act or be targeted. Needs a flat-check model.',
  'death-track': "Dying/Wounded/Doomed — owned by the bot's combat model, deliberately not core's.",
  'gm-adjudicated': 'Attitude/roleplay. No deterministic effect on a sheet.',
  'object-only': 'Applies to objects, not creatures. Needs an item model.',
  movement: 'Speed or terrain changes. The model has no field for them.',
  'hp-alteration': 'Changes Hit Points outside the modifier model.',
  immunity: 'Grants immunity to a trait. The model has no immunity field.',
  'sense-conditional': 'Penalty scoped to a sense or check type we cannot tag yet.',
  'needs-selector': 'Targets a stat our selectors cannot name (ranged attacks, Str-based melee).',
  recovery: 'The value changes by its own rule over time or via an action.',
};

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gold/20 bg-midnight-900/60 px-4 py-3">
      <div className="font-ui text-3xl text-gold">{value}</div>
      <div className="mt-1 text-sm text-parchment/80">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-parchment/50">{hint}</div>}
    </div>
  );
}

/** Render one passive as "-2 status to AC", plus its condition when it carries one. */
function describePassive(effect: PassiveEffect, level: number): string {
  if (effect.kind !== 'modifier') return effect.kind;
  let n: number;
  try {
    n = evaluate(effect.value, { vars: { level } }, 'number') as number;
  } catch {
    return `${effect.bonusType} to ${effect.target} (unevaluated)`;
  }
  const sign = n >= 0 ? '+' : '';
  const when = effect.when ? ` · ${describePredicate(effect.when)}` : '';
  return `${sign}${n} ${effect.bonusType} to ${effect.target}${when}`;
}

export function ConditionCoveragePage() {
  const [gap, setGap] = useState<string>('all');
  const [query, setQuery] = useState('');
  // Valued conditions are shown at a value, and Drained's HP reduction scales with
  // level — both are inputs so the table shows real numbers rather than formulas.
  const [value, setValue] = useState(1);
  const [level, setLevel] = useState(5);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONDITION_SLUGS.filter((slug) => {
      const def = CONDITIONS[slug];
      if (q && !def.name.toLowerCase().includes(q)) return false;
      if (gap === 'all') return true;
      if (gap === 'modelled') return !!def.passives && !def.unmodeled?.length;
      if (gap === 'no-passives') return !def.passives;
      return def.unmodeled?.includes(gap as UnmodeledReason) ?? false;
    });
  }, [gap, query]);

  const summary = useMemo(() => {
    let withPassives = 0;
    let fully = 0;
    const byGap: Record<string, number> = {};
    for (const slug of CONDITION_SLUGS) {
      const def = CONDITIONS[slug];
      if (def.passives) withPassives += 1;
      if (def.passives && !def.unmodeled?.length) fully += 1;
      for (const r of def.unmodeled ?? []) byGap[r] = (byGap[r] ?? 0) + 1;
    }
    return { withPassives, fully, byGap };
  }, []);

  const gapOptions = Object.entries(summary.byGap).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="font-display text-3xl text-gold">Condition coverage</h1>
      <p className="mt-3 max-w-3xl text-parchment/80">
        What each PF2e condition contributes to a sheet, and what it does that we can't yet
        express. Most conditions are not modifiers — the point of this page is that the
        remainder is <em>named</em> rather than quietly missing.
      </p>
      <GildedRule className="my-6" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Conditions" value={String(CONDITION_SLUGS.length)} />
        <StatTile
          label="Contribute modifiers"
          value={`${summary.withPassives}`}
          hint={`of ${CONDITION_SLUGS.length}`}
        />
        <StatTile
          label="Fully modelled"
          value={`${summary.fully}`}
          hint="nothing left unnamed"
        />
        <StatTile label="Distinct blockers" value={String(gapOptions.length)} hint="the roadmap" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          className="rounded-md border border-gold/20 bg-midnight-900/60 px-3 py-1.5 text-sm text-parchment placeholder:text-parchment/40"
          placeholder="Search a condition…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="rounded-md border border-gold/20 bg-midnight-950/60 px-2 py-1.5 text-sm text-parchment"
          value={gap}
          onChange={(e) => setGap(e.target.value)}
        >
          <option value="all">all conditions</option>
          <option value="modelled">fully modelled</option>
          <option value="no-passives">no modifiers at all</option>
          {gapOptions.map(([r, n]) => (
            <option key={r} value={r}>
              {r} ({n})
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-parchment/60">
          value
          <input
            type="number"
            min={1}
            max={6}
            className="w-14 rounded border border-gold/20 bg-midnight-950/60 px-2 py-1 text-sm text-parchment"
            value={value}
            onChange={(e) => setValue(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-parchment/60">
          level
          <input
            type="number"
            min={1}
            max={20}
            className="w-14 rounded border border-gold/20 bg-midnight-950/60 px-2 py-1 text-sm text-parchment"
            value={level}
            onChange={(e) => setLevel(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <span className="text-xs text-parchment/40">{rows.length} shown</span>
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((slug) => {
          const def = CONDITIONS[slug];
          const passives = def.passives?.(def.valued ? value : 1) ?? [];
          const gaps = def.unmodeled ?? [];
          return (
            <div
              key={slug}
              className={`rounded-md border p-3 ${
                passives.length && !gaps.length
                  ? 'border-emerald/25 bg-emerald/5'
                  : passives.length
                    ? 'border-gold/20 bg-midnight-900/40'
                    : 'border-red-500/20 bg-red-500/5'
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-ui text-lg text-gold">
                  {def.name}
                  {def.valued && <span className="text-parchment/50"> {value}</span>}
                </span>
                {def.group && (
                  <span className="rounded border border-gold/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-parchment/50">
                    {def.group}
                  </span>
                )}
                <span className="text-sm text-parchment/70">{def.summary}</span>
              </div>

              {(def.implies?.length || def.overrides?.length) && (
                <div className="mt-1.5 text-xs text-parchment/60">
                  {def.implies?.length ? (
                    <span>
                      also gives{' '}
                      {def.implies
                        .map((i) => CONDITIONS[i.slug].name + (i.value ? ` ${i.value}` : ''))
                        .join(', ')}
                    </span>
                  ) : null}
                  {def.implies?.length && def.overrides?.length ? ' · ' : null}
                  {def.overrides?.length ? (
                    <span>overrides {def.overrides.map((o) => CONDITIONS[o].name).join(', ')}</span>
                  ) : null}
                </div>
              )}

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-parchment/40">
                    On the sheet
                  </div>
                  {passives.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {passives.map((p, i) => (
                        <li key={i} className="font-ui text-xs text-emerald-soft/90">
                          {describePassive(p, level)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-parchment/40">nothing — see blockers</p>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-parchment/40">
                    Not expressed
                  </div>
                  {gaps.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {gaps.map((g) => (
                        <li key={g} className="text-xs text-parchment/60" title={GAP_COPY[g]}>
                          <span className="text-gold/70">{g}</span> — {GAP_COPY[g]}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-emerald-soft/70">
                      nothing — the modifiers are the whole story
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-xs text-parchment/40">
        Green = fully modelled. Red = contributes no modifiers at all (which is correct for
        many: an attitude or a detection state has no number to show). The blockers are a
        closed vocabulary, so this list is a roadmap rather than a pile of complaints.
      </p>
    </div>
  );
}
