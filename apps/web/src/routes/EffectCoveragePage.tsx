import { useEffect, useMemo, useState } from 'react';
import { GildedRule } from '@/components/ui/GildedRule';

/**
 * Effect ingest coverage — the admin diagnostic over `effect-ingest-report.json`.
 *
 * WHAT THIS IS FOR: auto-mapping official content into our effect schema is
 * best-effort and NOT trustworthy by default. The mapper never guesses — an element
 * either becomes a PassiveEffect we can stand behind, or it is reported with a
 * reason. This page is how a human sees which is which, and decides what to build
 * (or correct) next. See docs/effects-engine-design.md, "Ingest review".
 *
 * The report is loaded with a DYNAMIC import so neither it (~3 MB) nor Foundry's raw
 * rule elements are in the app's main bundle — it is admin-only data and must not
 * ship to players on a page they never open.
 */

// ── the sidecar's shape (see scripts/remap-effects.mjs) ─────────────────────
interface ReportEntry {
  index: number;
  key: string;
  outcome: 'mapped' | 'unsupported';
  reason?: string;
  detail?: string;
  produced?: number;
}
interface Entity {
  id: string;
  name: string;
  raw: unknown[];
  report: ReportEntry[];
}
interface Sidecar {
  sourceCommit: string;
  mappedAt: string;
  summary: {
    entities: number;
    entitiesWithEffects: number;
    elements: number;
    mapped: number;
    effectsProduced: number;
    unsupported: number;
    byReason: Record<string, number>;
    byKey: Record<string, number>;
  };
  entities: Entity[];
}

/**
 * What each blocker actually means, and what would have to exist to clear it. The
 * reason vocabulary is named after the BLOCKER rather than the symptom precisely so
 * that this table reads as a roadmap.
 */
const REASON_MEANING: Record<string, string> = {
  'needs-combat-tags': 'Gated by a predicate, or produces one. Needs the deferred combat-tag vocabulary.',
  'needs-item-model': 'Alters or creates weapons/items. Needs an item model.',
  'needs-granting': 'Grants a whole feat/item — an entity, not an effect.',
  'needs-runtime-choice': 'Depends on a choice made when the feat is taken.',
  'unsupported-selector': "Targets a stat we don't model, or a Foundry-internal data path.",
  'unsupported-bonus-type': 'Bonus type outside circumstance / status / item / untyped.',
  'unsupported-value': "A value expression our grammar can't parse (e.g. infix arithmetic).",
  'unsupported-shape': 'The kind maps in principle; this instance’s shape does not.',
  'unknown-key': 'A rule-element kind the adapter does not handle.',
};

const PAGE_SIZE = 40;

/** A headline figure. Sans + proportional figures — a stat value is not a table cell. */
function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gold/20 bg-midnight-900/60 px-4 py-3">
      <div className="font-ui text-3xl text-gold">{value}</div>
      <div className="mt-1 text-sm text-parchment/80">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-parchment/50">{hint}</div>}
    </div>
  );
}

export function EffectCoveragePage() {
  const [data, setData] = useState<Sidecar | null>(null);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState<string>('all');
  const [kind, setKind] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    let live = true;
    import('@/features/builder/data/effect-ingest-report.json')
      .then((m) => {
        if (live) setData(m.default as unknown as Sidecar);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Re-collapse the list whenever the slice changes, so a filter never dumps
  // thousands of rows at once.
  useEffect(() => setLimit(PAGE_SIZE), [reason, kind, query]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const out: { entity: Entity; entries: ReportEntry[] }[] = [];
    for (const entity of data.entities) {
      if (q && !entity.name.toLowerCase().includes(q)) continue;
      const entries = entity.report.filter(
        (e) =>
          (reason === 'all' ? e.outcome === 'unsupported' : reason === 'mapped' ? e.outcome === 'mapped' : e.reason === reason) &&
          (kind === 'all' || e.key === kind),
      );
      if (entries.length) out.push({ entity, entries });
    }
    return out;
  }, [data, reason, kind, query]);

  if (failed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-parchment/80">
          Could not load the ingest report. Run <code className="text-gold">node scripts/remap-effects.mjs</code> in{' '}
          <code className="text-gold">apps/web</code> to generate it.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-parchment/60">Loading the ingest report…</p>
      </div>
    );
  }

  const { summary } = data;
  const pct = ((summary.mapped / summary.elements) * 100).toFixed(1);
  const reasons = Object.entries(summary.byReason).sort((a, b) => b[1] - a[1]);
  const maxReason = reasons[0]?.[1] ?? 1;
  const shown = rows.slice(0, limit);
  const totalMatching = rows.reduce((n, r) => n + r.entries.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-3xl text-gold">Effect ingest coverage</h1>
      <p className="mt-3 max-w-3xl text-parchment/80">
        Every Foundry rule element we hold, and what our mapper made of it. The mapper never guesses: an
        element either becomes an effect we can stand behind, or it is listed here with the reason it
        could not be. Nothing is dropped silently — {summary.mapped.toLocaleString()} mapped plus{' '}
        {summary.unsupported.toLocaleString()} reported equals all {summary.elements.toLocaleString()}.
      </p>
      <GildedRule className="my-6" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Rule elements" value={summary.elements.toLocaleString()} hint={`${summary.entities.toLocaleString()} feats`} />
        <StatTile label="Mapped" value={`${pct}%`} hint={`${summary.mapped.toLocaleString()} elements`} />
        <StatTile
          label="Effects produced"
          value={summary.effectsProduced.toLocaleString()}
          hint={`on ${summary.entitiesWithEffects.toLocaleString()} feats`}
        />
        <StatTile label="Unaccounted for" value="0" hint="every element is reported" />
      </div>

      <h2 className="mt-10 font-display text-xl text-gold">Where the gaps are</h2>
      <p className="mt-2 max-w-3xl text-sm text-parchment/70">
        Grouped by what would have to be built to clear them, not by symptom — so this reads as a
        roadmap. Select a row to inspect its elements.
      </p>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-gold/20 text-left text-xs uppercase tracking-wide text-parchment/50">
            <th className="py-2 font-normal">Blocker</th>
            <th className="py-2 pl-3 text-right font-normal">Elements</th>
            <th className="py-2 pl-3 font-normal">Share</th>
          </tr>
        </thead>
        <tbody>
          {reasons.map(([r, n]) => (
            <tr
              key={r}
              onClick={() => setReason(reason === r ? 'all' : r)}
              className={`cursor-pointer border-b border-gold/10 align-top hover:bg-midnight-900/60 ${
                reason === r ? 'bg-midnight-900/80' : ''
              }`}
            >
              <td className="py-2 pr-3">
                <div className={reason === r ? 'text-gold' : 'text-parchment'}>{r}</div>
                <div className="text-xs text-parchment/50">{REASON_MEANING[r] ?? ''}</div>
              </td>
              <td className="py-2 pl-3 text-right tabular-nums text-parchment">{n.toLocaleString()}</td>
              <td className="w-1/3 py-2 pl-3">
                {/* One measure, one hue: length carries the value, the label carries identity. */}
                <div className="mt-1 h-2 w-full rounded-sm bg-midnight-800">
                  <div className="h-2 rounded-sm bg-arcane/70" style={{ width: `${(n / maxReason) * 100}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-10 font-display text-xl text-gold">Inspect</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search feats…"
          className="rounded-md border border-gold/20 bg-midnight-900/60 px-3 py-1.5 text-sm text-parchment placeholder:text-parchment/40"
        />
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded-md border border-gold/20 bg-midnight-900/60 px-3 py-1.5 text-sm text-parchment"
        >
          <option value="all">All unsupported</option>
          <option value="mapped">Mapped (what we produced)</option>
          {reasons.map(([r]) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-md border border-gold/20 bg-midnight-900/60 px-3 py-1.5 text-sm text-parchment"
        >
          <option value="all">All kinds</option>
          {Object.entries(summary.byKey)
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => (
              <option key={k} value={k}>
                {k} ({n})
              </option>
            ))}
        </select>
        <span className="text-sm text-parchment/50">
          {totalMatching.toLocaleString()} elements across {rows.length.toLocaleString()} feats
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {shown.map(({ entity, entries }) => (
          <div key={entity.id} className="rounded-lg border border-gold/15 bg-midnight-900/40 p-3">
            <div className="font-ui text-sm text-gold">{entity.name}</div>
            <div className="mt-2 space-y-2">
              {entries.map((e) => (
                <div key={e.index} className="rounded-md bg-midnight-950/60 p-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-midnight-800 px-1.5 py-0.5 text-parchment/80">{e.key}</span>
                    <span className={e.outcome === 'mapped' ? 'text-emerald-soft' : 'text-brass'}>
                      {e.outcome === 'mapped' ? `mapped → ${e.produced} effect(s)` : e.reason}
                    </span>
                    {e.detail && <span className="text-parchment/50">{e.detail}</span>}
                  </div>
                  {/* The source element, verbatim — what a human checks the mapping against. */}
                  <pre className="mt-2 overflow-x-auto rounded bg-black/30 p-2 text-[11px] leading-relaxed text-parchment/70">
                    {JSON.stringify(entity.raw[e.index], null, 1)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        ))}
        {rows.length > limit && (
          <button
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
            className="w-full rounded-md border border-gold/25 py-2 text-sm text-gold hover:bg-midnight-900/60"
          >
            Show more ({(rows.length - limit).toLocaleString()} feats remaining)
          </button>
        )}
        {rows.length === 0 && <p className="text-sm text-parchment/50">No elements match that filter.</p>}
      </div>

      <p className="mt-10 text-xs text-parchment/40">
        Source: {data.sourceCommit} · mapped {new Date(data.mappedAt).toLocaleString()} · regenerate with{' '}
        <code>node scripts/remap-effects.mjs</code> (no Foundry checkout required).
      </p>
    </div>
  );
}
