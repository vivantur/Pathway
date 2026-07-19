import { useEffect, useMemo, useRef, useState } from 'react';
import {
  triage,
  groupBySignature,
  groupSilence,
  promote,
  type SilentEntity,
  type SilenceReason,
  type EffectCandidate,
  type EffectDecision,
  type DraftEffect,
  type Gap,
  type Evidence,
  type Expr,
} from '@pathway/core';
import featData from '@/features/builder/data/feats.json';
import { GildedRule } from '@/components/ui/GildedRule';
import { CornerBrackets } from '@/components/ui/CornerBrackets';
import { GrimoireMarkdown } from '@/components/ui/GrimoireMarkdown';

/**
 * Effect review — the admin surface where a human turns auto-mapped PROPOSALS into
 * content, one shape at a time. See docs/effects-engine-design.md, "the review UI".
 *
 * THE SPINE: candidates are not content. Two independent producers — the prose parser
 * and Foundry's hand-authored rule elements — each propose effects; `reconcile` (in
 * core) buckets them into candidates by whether they agree. This page renders the
 * queue and records a human's accept/reject as `EffectDecision[]`. It does NOT write
 * content: promotion into a feat's `effects` is a later slice. A decision here is
 * exported as JSON, committed, and folded in downstream — so a guess can never reach a
 * character's sheet from this page.
 *
 * SLICE 1 (triage + accept/reject + export): no inline editor. A gapped or conflicting
 * candidate needs a value FILLED or a winner CHOSEN — that reuses the homebrew authoring
 * surface (stage 3), so here it is shown read-only with its blocker named, and can only
 * be rejected, not accepted. The promotable `review` candidates are the interactive core.
 *
 * The candidate list is an admin-only sidecar, DYNAMICALLY imported so its ~1 MB never
 * sits in a bundle a player downloads. `triage`/`groupBySignature` run here (client-side)
 * so the bucketing policy stays in core, not re-implemented in the UI.
 */

// ── the sidecar's shape (see scripts/build-candidates.mjs) ──────────────────
interface Sidecar {
  generatedAt: string;
  summary: {
    feats: number;
    featsWithProse: number;
    candidates: number;
    autoPromote: number;
    conflicts: number;
    gapped: number;
    review: number;
    invalid: number;
    silent: number;
    actionFeatsInQueue: number;
  };
  candidates: EffectCandidate[];
  /** Feats that proposed NOTHING — 3/4 of the corpus, invisible until this landed. */
  silent: SilentEntity[];
  /** Feats WITH candidates that carry an action cost — likely modelled as passives. */
  actionFeatsInQueue: string[];
  /** The blocker tally across the silent, largest first. The roadmap. */
  silenceBlockers: { reason: string; count: number }[];
}

// feats.json → id → display fields. The sidecar deliberately omits descriptions;
// the app already bundles them for the builder, so we read them from here.
interface FeatLite {
  id: string;
  name: string;
  description?: string;
}
const FEATS = featData as FeatLite[];
const FEAT_BY_ID = new Map(FEATS.map((f) => [f.id, f]));

const RANK_WORD = ['untrained', 'trained', 'expert', 'master', 'legendary'];

/** The shape of a choice draft's payload (see EffectChoice in @pathway/core). */
interface DraftChoice {
  flag?: string;
  prompt?: string;
  options?: { value: string; label: string; effects: DraftEffect[] }[];
}

/** Render an expression value AST as compact human text (a plain number is `lit`). */
function exprText(v: unknown): string {
  if (v === null || typeof v !== 'object') return String(v);
  const e = v as Expr;
  switch (e.kind) {
    case 'lit':
      return String(e.value);
    case 'var':
      return e.name;
    case 'call':
      return `${e.fn}(${e.args.map(exprText).join(', ')})`;
    default:
      return JSON.stringify(v);
  }
}

/** A one-line, human-readable summary of a draft effect — what the reviewer confirms. */
function describeEffect(d: DraftEffect): string {
  switch (d.kind) {
    case 'modifier': {
      const val = d.value === undefined ? '?' : exprText(d.value);
      const signed = /^-/.test(val) ? val : `+${val}`;
      return `${signed} ${d.bonusType ?? 'untyped'} to ${d.target ?? '?'}`;
    }
    case 'proficiency': {
      const word = typeof d.rank === 'number' ? RANK_WORD[d.rank] ?? `rank ${d.rank}` : exprText(d.rank);
      const mode = d.mode === 'set' ? 'set to' : 'to';
      return `${d.target ?? '?'} ${mode} ${word}`;
    }
    case 'grant': {
      const g = d.grant as Record<string, unknown> | undefined;
      if (!g) return 'grant ?';
      const parts = Object.entries(g)
        .filter(([k]) => k !== 'type')
        .map(([k, val]) => `${k} ${typeof val === 'object' ? exprText(val) : String(val)}`);
      return `grant ${String(g.type)}${parts.length ? ` (${parts.join(', ')})` : ''}`;
    }
    case 'note':
      return `note on ${d.target ?? '?'}`;
    case 'rollAdjust':
      return `adjust rolls on ${d.target ?? '?'}`;
    case 'choice': {
      const ch = d.choice as DraftChoice | undefined;
      const n = ch?.options?.length ?? 0;
      return `choose 1 of ${n}${ch?.prompt ? ` · ${ch.prompt.toLowerCase()}` : ''}`;
    }
    default:
      return d.kind ? `${d.kind}` : '(incomplete)';
  }
}

/** The option list of a choice, each with the effect it grants — what a reviewer confirms. */
function ChoiceOptions({ choice }: { choice: DraftChoice }) {
  const options = choice.options ?? [];
  return (
    <div className="mt-2 rounded-md border border-gold/15 bg-midnight-950/50 p-2.5">
      <div className="mb-1.5 text-xs uppercase tracking-wide text-parchment/50">
        Pick one{choice.prompt ? ` · ${choice.prompt}` : ''}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((o) => {
          // The label already names the skill; drop a leading target that just repeats it,
          // so a proficiency option reads "Arcana → trained", not "Arcana → arcana to trained".
          const detail = o.effects?.[0] ? describeEffect(o.effects[0]).replace(new RegExp(`^${o.value}\\s+(?:set )?to\\s+`, 'i'), '') : '';
          return (
            <span key={o.value} className="text-sm text-parchment/80">
              <span className="text-gold">{o.label}</span>
              {detail && <span className="text-parchment/50"> → {detail}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const AGREEMENT_STYLE: Record<string, string> = {
  corroborated: 'border-emerald/40 bg-emerald/10 text-emerald-soft',
  conflicting: 'border-red-500/40 bg-red-500/10 text-red-300',
  'parser-only': 'border-arcane/40 bg-arcane/10 text-arcane',
  'foundry-only': 'border-gold/30 bg-gold/10 text-gold',
};

const GAP_MEANING: Record<string, string> = {
  anaphoric: 'The target is a pronoun ("the check", "the save") pointing at an earlier clause.',
  'unresolved-vocabulary': 'A term we have no vocabulary for yet.',
  'conditional-unmapped': 'A condition on this effect we cannot yet express.',
  ambiguous: 'The prose admits more than one reading.',
  missing: 'A required field simply is not stated.',
};

/** Stable identity of a decision, matching resolveEntity's `${entityId} ${key}`. */
const decisionId = (c: EffectCandidate) => `${c.entityId} ${c.key}`;

// ── small presentational pieces ─────────────────────────────────────────────

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gold/20 bg-midnight-900/60 px-4 py-3">
      <div className="font-ui text-3xl text-gold">{value}</div>
      <div className="mt-1 text-sm text-parchment/80">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-parchment/50">{hint}</div>}
    </div>
  );
}

function EvidenceLine({ ev }: { ev: Evidence }) {
  if (ev.source === 'parser' && ev.span) {
    return (
      <div className="text-sm text-parchment/65">
        <span className="text-arcane">parser</span> read “<span className="text-parchment/85">{ev.span.text}</span>”
      </div>
    );
  }
  if (ev.source === 'foundry') {
    return (
      <div className="text-sm text-parchment/65">
        <span className="text-gold">foundry</span> rule element
        {ev.ruleElementIndex !== undefined ? ` #${ev.ruleElementIndex}` : ''}
      </div>
    );
  }
  return <div className="text-sm text-parchment/65">{ev.source}</div>;
}

function GapLine({ gap }: { gap: Gap }) {
  return (
    <div className="text-sm text-brass">
      gap · <span className="text-parchment/85">{gap.field}</span> — {gap.reason}
      {gap.raw && <> (“{gap.raw}”)</>}
      <span className="text-parchment/50"> · {GAP_MEANING[gap.reason] ?? ''}</span>
    </div>
  );
}

// ── the page ────────────────────────────────────────────────────────────────

type Bucket = 'review' | 'gapped' | 'conflicts' | 'autoPromote' | 'invalid';

const BUCKET_LABEL: Record<Bucket, string> = {
  review: 'Needs review',
  gapped: 'Gapped',
  conflicts: 'Conflicts',
  autoPromote: 'Auto-promoted',
  invalid: 'Invalid',
};

const BUCKET_HINT: Record<Bucket, string> = {
  review: 'One producer, complete — the interactive core. Confirm the shape, accept in bulk.',
  gapped: 'Complete but for a hole. Read-only here — filling it reuses the authoring editor (later slice).',
  conflicts: 'Producers disagree. One is wrong — the most informative thing in the queue.',
  autoPromote:
    'Corroborated + complete: both producers agreed, so these become content with no human needed. Accept is optional here — it records a durable "a human confirmed this" that survives a re-run; Reject reverses the auto-promotion.',
  invalid: 'Complete-looking but schema-invalid — a producer bug, not a content problem.',
};

/**
 * The two top-level views. The queue was the whole page until now, which quietly
 * presented ~18% of the corpus as if it were all the work: 1,096 feats propose
 * something, 5,020 propose nothing and had no surface at all.
 */
type View = 'queue' | 'silent';

const SILENCE_LABEL: Record<SilenceReason, string> = {
  'action-feat': 'Action feats',
  'all-unsupported': 'All elements unsupported',
  'no-producer-signal': 'No producer signal',
};

const SILENCE_HINT: Record<SilenceReason, string> = {
  'action-feat':
    'Carries an action cost, so it grants an ACTIVITY, not a passive — correctly absent from this queue. Not a gap in coverage; work for the granted-action pass, which is why they are named rather than filtered away.',
  'all-unsupported':
    'A producer had rule elements for these and every one mapped to unsupported. Not a mystery — the blockers below are named, and they are the roadmap.',
  'no-producer-signal':
    'Nothing was ingested for these and the prose yielded nothing. Most likely no passive mechanics at all, but that is unverified — this is the least-understood group.',
};

/** A feat's display name, falling back to its id so a missing entry stays legible. */
const nameOf = (id: string): string => FEAT_BY_ID.get(id)?.name ?? id;

/** The silent view: what never reaches review, grouped by why. */
function SilentPanel({ data }: { data: Sidecar }) {
  const [openReason, setOpenReason] = useState<SilenceReason | null>(null);
  const groups = useMemo(() => groupSilence(data.silent), [data.silent]);
  // The largest tally scales the bars. Guarded: an empty blocker list is possible in
  // principle (a corpus where every silent feat is an action feat), and indexing [0]
  // for the divisor would take the whole admin page down with it.
  const maxBlocker = data.silenceBlockers[0]?.count ?? 0;

  return (
    <>
      <p className="mt-2 max-w-3xl text-sm text-parchment/60">
        {data.summary.silent.toLocaleString()} of {data.summary.feats.toLocaleString()} feats propose
        nothing at all, so they never enter the queue. Coverage is not the point — knowing what the
        remainder <em>is</em> is the point.
      </p>

      {/* the blocker tally — the roadmap, restated from the side of what is missing */}
      <div className="mt-6 rounded-lg border border-gold/15 bg-midnight-900/40 p-4">
        <h2 className="font-display text-lg text-gold">Blockers across the silent</h2>
        <p className="mt-1 text-sm text-parchment/60">
          Counted in rule ELEMENTS, not feats — one feat can be blocked several ways.
        </p>
        <ul className="mt-3 space-y-1.5">
          {data.silenceBlockers.map((b) => (
            <li key={b.reason} className="flex items-center gap-3 text-sm">
              <span className="w-52 shrink-0 font-mono text-parchment/80">{b.reason}</span>
              <span className="tabular-nums text-parchment/60">{b.count.toLocaleString()}</span>
              <span
                className="h-2 rounded-sm bg-gold/30"
                style={{ width: `${maxBlocker > 0 ? Math.max(2, (b.count / maxBlocker) * 60) : 2}%` }}
              />
            </li>
          ))}
        </ul>
      </div>

      {data.actionFeatsInQueue.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/5 p-4">
          <h2 className="font-display text-lg text-amber-200/90">
            {data.actionFeatsInQueue.length} action feats are IN the queue
          </h2>
          <p className="mt-1 text-sm text-parchment/70">
            These carry an action cost but still produced passive candidates — so a granted activity
            is likely being modelled as a passive effect. They are flagged, never auto-removed:
            dropping real candidates on a heuristic would be exactly the guessing this pipeline
            refuses.
          </p>
          <p className="mt-2 text-sm text-parchment/60">
            {data.actionFeatsInQueue.slice(0, 12).map((id) => nameOf(id)).join(' · ')}
            {data.actionFeatsInQueue.length > 12 && ` … +${data.actionFeatsInQueue.length - 12} more`}
          </p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {groups.map(({ reason, entities }) => {
          const open = openReason === reason;
          return (
            <div key={reason} className="relative rounded-lg border border-gold/15 bg-midnight-900/40">
              {open && <CornerBrackets />}
              <button
                onClick={() => setOpenReason(open ? null : reason)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="font-display text-gold">{SILENCE_LABEL[reason]}</span>
                <span className="tabular-nums text-sm text-parchment/60">
                  {entities.length.toLocaleString()}
                </span>
              </button>
              {open && (
                <div className="border-t border-gold/10 px-4 py-3">
                  <p className="mb-3 max-w-3xl text-sm text-parchment/60">{SILENCE_HINT[reason]}</p>
                  <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
                    {entities.slice(0, 300).map((e) => (
                      <li key={e.entityId} className="flex items-baseline gap-2">
                        <span className="text-parchment/85">{nameOf(e.entityId)}</span>
                        {e.actionCost && (
                          <span className="rounded border border-gold/20 px-1 text-xs text-gold/70">
                            {e.actionCost}
                          </span>
                        )}
                        {e.blockers?.length ? (
                          <span className="font-mono text-xs text-parchment/45">
                            {e.blockers.map((b) => `${b.reason}×${b.count}`).join(' ')}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {entities.length > 300 && (
                    <p className="mt-2 text-xs text-parchment/50">
                      Showing the first 300 of {entities.length.toLocaleString()}.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function EffectReviewPage() {
  const [data, setData] = useState<Sidecar | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>('queue');
  const [bucket, setBucket] = useState<Bucket>('review');
  const [openSig, setOpenSig] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [decisions, setDecisions] = useState<Map<string, EffectDecision>>(new Map());
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    import('@/features/builder/data/effect-candidates.json')
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

  const buckets = useMemo(() => (data ? triage(data.candidates) : null), [data]);

  // The signature groups for the selected bucket, largest shape first — "confirm this
  // across 150 feats", not 150 forms.
  const groups = useMemo(() => (buckets ? groupBySignature(buckets[bucket]) : []), [buckets, bucket]);

  const setDecision = (c: EffectCandidate, decision: EffectDecision | null) => {
    setDecisions((prev) => {
      const next = new Map(prev);
      if (decision) next.set(decisionId(c), decision);
      else next.delete(decisionId(c));
      return next;
    });
  };

  const accept = (c: EffectCandidate) => {
    const p = promote(c);
    if (!p.ok) return; // guarded by the disabled button, but never trust the caller
    // A candidate promotes to EITHER an effect OR a choice (the second content type) — carry
    // whichever the schema produced so resolveEntity routes it to the right output.
    setDecision(c, {
      entityId: c.entityId,
      key: c.key,
      action: 'accept',
      ...(p.effect ? { effect: p.effect } : {}),
      ...(p.choice ? { choice: p.choice } : {}),
      at: new Date().toISOString(),
    });
  };
  const reject = (c: EffectCandidate) =>
    setDecision(c, { entityId: c.entityId, key: c.key, action: 'reject', at: new Date().toISOString() });

  const acceptGroup = (cands: EffectCandidate[]) => cands.forEach((c) => promote(c).ok && accept(c));
  const rejectGroup = (cands: EffectCandidate[]) => cands.forEach((c) => reject(c));

  const exportDecisions = () => {
    const arr = [...decisions.values()];
    const blob = new Blob([`${JSON.stringify(arr, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'effect-decisions.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importDecisions = (file: File) => {
    file.text().then((text) => {
      try {
        const arr = JSON.parse(text) as EffectDecision[];
        setDecisions(new Map(arr.map((d) => [`${d.entityId} ${d.key}`, d])));
      } catch {
        /* a malformed file just does nothing — no partial import */
      }
    });
  };

  if (failed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-parchment/80">
          Could not load the candidate queue. Run{' '}
          <code className="text-gold">node scripts/build-candidates.mjs</code> in{' '}
          <code className="text-gold">apps/web</code> to generate it.
        </p>
      </div>
    );
  }
  if (!data || !buckets) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-parchment/60">Loading the candidate queue…</p>
      </div>
    );
  }

  const { summary } = data;
  const needsHuman = summary.conflicts + summary.gapped + summary.review + summary.invalid;
  const accepts = [...decisions.values()].filter((d) => d.action === 'accept').length;
  const rejects = [...decisions.values()].filter((d) => d.action === 'reject').length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-3xl text-gold">Effect review</h1>
      <p className="mt-3 max-w-3xl text-parchment/80">
        Two independent producers — the prose parser and Foundry’s hand-authored rule elements —
        each propose effects for a feat. Where they agree is corroboration; where they disagree is a
        conflict. This queue is what a human confirms before a proposal becomes content. Nothing here
        is applied to a character; your decisions export as JSON to be folded in downstream.
      </p>
      <GildedRule className="my-6" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Candidates" value={summary.candidates.toLocaleString()} hint={`${summary.featsWithProse.toLocaleString()} feats`} />
        <StatTile label="Auto-promoted" value={summary.autoPromote.toLocaleString()} hint="corroborated + complete" />
        <StatTile label="Need a human" value={needsHuman.toLocaleString()} hint="conflict · gapped · review" />
        <StatTile label="Decided" value={decisions.size.toLocaleString()} hint={`${accepts} accept · ${rejects} reject`} />
      </div>

      {/* decisions toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={exportDecisions}
          disabled={decisions.size === 0}
          className="rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-sm text-gold hover:border-gold/60 disabled:opacity-40"
        >
          Export decisions ({decisions.size})
        </button>
        <button
          onClick={() => importRef.current?.click()}
          className="rounded-md border border-gold/25 px-3 py-1.5 text-sm text-parchment hover:bg-midnight-900/60"
        >
          Import…
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importDecisions(f);
            e.target.value = '';
          }}
        />
        {decisions.size > 0 && (
          <button
            onClick={() => setDecisions(new Map())}
            className="rounded-md border border-red-500/25 px-3 py-1.5 text-sm text-red-300/80 hover:bg-red-500/10"
          >
            Clear
          </button>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-parchment/70">
          <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} />
          Show feat text
        </label>
      </div>

      {/* view toggle — the queue is only 18% of the corpus; the rest is behind "Not proposed" */}
      <div className="mt-8 flex flex-wrap gap-2 border-b border-gold/15 pb-3">
        {([
          ['queue', `Review queue (${summary.candidates.toLocaleString()})`],
          ['silent', `Not proposed (${summary.silent.toLocaleString()})`],
        ] as [View, string][]).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              view === v ? 'border-gold/50 bg-midnight-900/80 text-gold' : 'border-gold/15 text-parchment/70 hover:bg-midnight-900/50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'silent' && <SilentPanel data={data} />}

      {view === 'queue' && (
        <>
      {/* bucket tabs */}
      <div className="mt-6 flex flex-wrap gap-2">
        {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
          <button
            key={b}
            onClick={() => {
              setBucket(b);
              setOpenSig(null);
            }}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              bucket === b ? 'border-gold/50 bg-midnight-900/80 text-gold' : 'border-gold/15 text-parchment/70 hover:bg-midnight-900/50'
            }`}
          >
            {BUCKET_LABEL[b]} <span className="tabular-nums text-parchment/50">{buckets[b].length}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-parchment/60">{BUCKET_HINT[bucket]}</p>

      {/* signature groups */}
      <div className="mt-4 space-y-3">
        {groups.map(({ signature, candidates }) => {
          const open = openSig === signature;
          const promotable = candidates.filter((c) => promote(c).ok);
          return (
            <div key={signature} className="relative rounded-lg border border-gold/15 bg-midnight-900/40">
              {open && <CornerBrackets />}
              <button
                onClick={() => setOpenSig(open ? null : signature)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="font-ui text-sm text-gold">{signature}</span>
                <span className="text-xs text-parchment/50">{candidates.length} feat{candidates.length === 1 ? '' : 's'}</span>
                {promotable.length > 0 && (
                  <span className="text-xs text-emerald-soft/70">{promotable.length} acceptable</span>
                )}
                <span className="ml-auto text-parchment/40">{open ? '▾' : '▸'}</span>
              </button>

              {open && (
                <div className="border-t border-gold/10 px-4 py-3">
                  {promotable.length > 0 && (
                    <div className="mb-3 flex gap-2">
                      <button
                        onClick={() => acceptGroup(candidates)}
                        className="rounded border border-emerald/30 px-2.5 py-1 text-xs text-emerald-soft hover:bg-emerald/10"
                      >
                        Accept all {promotable.length}
                      </button>
                      <button
                        onClick={() => rejectGroup(candidates)}
                        className="rounded border border-red-500/25 px-2.5 py-1 text-xs text-red-300/80 hover:bg-red-500/10"
                      >
                        Reject all {candidates.length}
                      </button>
                    </div>
                  )}
                  <div className="space-y-2">
                    {candidates.map((c) => (
                      <CandidateRow
                        key={decisionId(c)}
                        candidate={c}
                        decision={decisions.get(decisionId(c))}
                        showText={showText}
                        onAccept={() => accept(c)}
                        onReject={() => reject(c)}
                        onClear={() => setDecision(c, null)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && <p className="text-sm text-parchment/50">Nothing in this bucket.</p>}
      </div>
        </>
      )}

      <p className="mt-10 text-xs text-parchment/40">
        Generated {new Date(data.generatedAt).toLocaleString()} · regenerate with{' '}
        <code>node scripts/build-candidates.mjs</code>. Decisions are folded into content by a later slice.
      </p>
    </div>
  );
}

function CandidateRow({
  candidate: c,
  decision,
  showText,
  onAccept,
  onReject,
  onClear,
}: {
  candidate: EffectCandidate;
  decision: EffectDecision | undefined;
  showText: boolean;
  onAccept: () => void;
  onReject: () => void;
  onClear: () => void;
}) {
  const feat = FEAT_BY_ID.get(c.entityId);
  const canAccept = promote(c).ok;
  const decided = decision?.action;

  return (
    <div
      className={`rounded-md border p-3 ${
        decided === 'accept'
          ? 'border-emerald/30 bg-emerald/5'
          : decided === 'reject'
            ? 'border-red-500/20 bg-red-500/5'
            : 'border-gold/10 bg-midnight-950/50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-ui text-base text-parchment">{feat?.name ?? c.entityId}</span>
        <span className={`rounded border px-1.5 py-0.5 text-xs ${AGREEMENT_STYLE[c.agreement] ?? 'border-gold/20 text-parchment/70'}`}>
          {c.agreement}
        </span>
        <span className="text-sm text-parchment/80">{describeEffect(c.draft)}</span>

        <div className="ml-auto flex items-center gap-1.5">
          {decided ? (
            <button onClick={onClear} className="rounded border border-gold/20 px-2 py-0.5 text-sm text-parchment/60 hover:text-gold">
              {decided === 'accept' ? '✓ accepted' : '✕ rejected'} · undo
            </button>
          ) : (
            <>
              <button
                onClick={onAccept}
                disabled={!canAccept}
                title={canAccept ? 'Accept as content' : 'Not acceptable yet — resolve its gap/conflict in the editor (later slice)'}
                className="rounded border border-emerald/30 px-2.5 py-0.5 text-sm text-emerald-soft hover:bg-emerald/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Accept
              </button>
              <button onClick={onReject} className="rounded border border-red-500/25 px-2.5 py-0.5 text-sm text-red-300/80 hover:bg-red-500/10">
                Reject
              </button>
            </>
          )}
        </div>
      </div>

      {/* a choice's options — the primary content of a choice candidate */}
      {c.draft.kind === 'choice' && <ChoiceOptions choice={c.draft.choice as DraftChoice} />}

      {/* conflict: show every reading, since one is wrong */}
      {c.agreement === 'conflicting' && c.alternatives && (
        <div className="mt-2 text-sm text-red-300/80">
          also read as: {c.alternatives.map((a, i) => <span key={i}>{describeEffect(a)}{i < c.alternatives!.length - 1 ? '; ' : ''}</span>)}
        </div>
      )}

      <div className="mt-2 space-y-1">
        {c.gaps.map((g, i) => (
          <GapLine key={i} gap={g} />
        ))}
        {c.evidence.map((ev, i) => (
          <EvidenceLine key={i} ev={ev} />
        ))}
      </div>

      {/* Full feat text, on demand — read and confirm in place, especially for
          foundry-only rows where the parser left no quoted span. */}
      {showText && feat?.description && (
        <div className="mt-3 max-h-96 overflow-y-auto rounded-md border border-gold/15 bg-midnight-950/70 p-3">
          <GrimoireMarkdown strip={['access', 'source']}>{feat.description}</GrimoireMarkdown>
        </div>
      )}
    </div>
  );
}
