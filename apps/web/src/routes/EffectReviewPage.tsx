import { useEffect, useMemo, useRef, useState } from 'react';
import {
  triage,
  partitionDecided,
  autoPromotable,
  groupBySignature,
  groupSilence,
  promote,
  applyResolution,
  resolutionIssues,
  resolveGaps,
  patchResolves,
  addEffect,
  applyBulk,
  parsePredicate,
  describePredicate,
  rejectCandidate,
  conflictReadings,
  resolveConflict,
  type ResolutionPatch,
  type RejectReason,
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
import {
  PredicateField,
  SelectorField,
  EffectForm,
  validatePassive,
  strip,
  withId,
  BROADCAST,
  EFFECT_KINDS,
  type Draft,
} from '@/features/authoring/fields';
import { GildedRule } from '@/components/ui/GildedRule';
import { CornerBrackets } from '@/components/ui/CornerBrackets';
import { GrimoireMarkdown } from '@/components/ui/GrimoireMarkdown';
import { fetchDecisions, saveDecisions, clearDecisions } from '@/features/effects/decisions';

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
 * THE EDITOR (slices 1–3, 2026-07-19): a gapped candidate is FILLED here and a
 * conflicting one has its winner CHOSEN here, both through `resolution.ts` — the only
 * path from a blocked candidate to a decision. The controls are reused wholesale from
 * `features/authoring`, so the review surface and the homebrew editor author the same
 * shapes; and the editor is two fields (`when`, `target`) because measured over the
 * corpus, every gap is on one of them. `resolutionIssues` drives enablement, so this
 * page can never record something `promote` would refuse.
 *
 * NOT here: authoring a brand-new effect. That is EffectAuthorPage, which is already
 * the general authoring surface — this one only resolves what a producer proposed.
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

const DEGREE_LABEL: Record<string, string> = {
  'critical-failure': 'critical failure',
  failure: 'failure',
  success: 'success',
  'critical-success': 'critical success',
};

/**
 * What a `rollAdjust` does, in the reviewer's language. Every one of these used to
 * render as "adjust rolls on ?", which tells a reviewer nothing they can confirm
 * against the prose — and the corpus now proposes 200+ of them.
 *
 * A degree map is stated as the rewrite the prose states: "a success becomes a
 * critical success". A map with several entries lists them, because a reviewer has to
 * check each against the text (Dragon's Presence improves a success AND worsens a
 * failure, and confirming one is not confirming the other).
 */
function describeAdjust(adjust: unknown): string {
  const a = adjust as { type?: string; direction?: string; keep?: string; map?: Record<string, string> } | undefined;
  if (!a) return 'adjust rolls';
  if (a.type === 'reroll') return `reroll, keep ${a.keep ?? '?'}`;
  if (a.type === 'degree') return `every result one degree ${a.direction === 'worsen' ? 'worse' : 'better'}`;
  if (a.type === 'degreeMap') {
    const entries = Object.entries(a.map ?? {});
    if (entries.length === 0) return 'rewrites nothing';
    return entries.map(([from, to]) => `${DEGREE_LABEL[from] ?? from} → ${DEGREE_LABEL[to] ?? to}`).join(', ');
  }
  return 'adjust rolls';
}

/**
 * The condition on a draft, in the SAME prose the sheet shows the player — core's
 * `describePredicate`, so the review surface and the sheet can never word a condition
 * differently.
 *
 * Returns null for an absent or half-built predicate rather than guessing at one: the
 * gap editor already reports an unparseable `when` as an issue, and inventing a
 * description for it here would be a second opinion that could disagree.
 */
function conditionText(when: unknown): string | null {
  if (when === undefined || when === null) return null;
  const parsed = parsePredicate(when);
  return parsed.ok ? describePredicate(parsed.predicate) : null;
}

/**
 * A one-line, human-readable summary of a draft effect — what the reviewer confirms.
 *
 * THE CONDITION IS PART OF THE EFFECT, not decoration. This omitted `when` entirely
 * until now, which was survivable only while most conditions were unresolved: an
 * unresolved one at least showed as a gap line, so the reviewer knew a condition
 * existed. Once the Foundry mapper started resolving them, a corroborated candidate
 * showed NO gap and NO condition — so Adaptive Vision read as "success → critical
 * success on will", flatly, and a reviewer would have accepted an effect whose actual
 * scope (visual effects only) was nowhere on screen. That is the wrong-sheet failure
 * this pipeline is built to prevent, reproduced in the surface meant to catch it.
 */
function describeEffect(d: DraftEffect): string {
  const base = describeEffectBase(d);
  const cond = conditionText(d.when);
  return cond ? `${base} · ${cond}` : base;
}

function describeEffectBase(d: DraftEffect): string {
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
      return `${describeAdjust(d.adjust)} on ${d.target ?? '?'}`;
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

// Each entry says what the reviewer should DO about it, because that is the question a
// gap actually poses. The four condition reasons were one bucket until 2026-07-19 —
// see prose.ts `classifyCondition` for why splitting them aims this queue.
const GAP_MEANING: Record<string, string> = {
  anaphoric: 'The target is a pronoun ("the check", "the save") pointing at an earlier clause.',
  'unresolved-vocabulary': 'A term we have no vocabulary for yet — the word may name a creature, or something we do not model at all.',
  'conditional-unmapped': 'A condition we cannot yet state — usually a compound scope ("spells and other magical effects from the same tradition").',
  'combat-state': 'Momentary combat state ("while raging", "when adjacent to an ally"). Blocked on the tag model, not on a missing word — nothing to fill in here yet.',
  'purpose-scope': 'Narrowed to an action ("to Climb", "to Recall Knowledge"). Needs an action tag namespace we have not built.',
  'duration-not-condition': 'Not a condition at all — the prose states a DURATION ("until the start of your next turn"). The effect is unconditional and temporary.',
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

type Bucket = 'review' | 'gapped' | 'conflicts' | 'autoPromote' | 'invalid' | 'decided';

const BUCKET_LABEL: Record<Bucket, string> = {
  review: 'Needs review',
  gapped: 'Gapped',
  conflicts: 'Conflicts',
  autoPromote: 'Auto-promoted',
  invalid: 'Invalid',
  decided: 'Decided',
};

const BUCKET_HINT: Record<Bucket, string> = {
  review: 'One producer, complete — the interactive core. Confirm the shape, accept in bulk.',
  gapped: 'Complete but for a hole. Read-only here — filling it reuses the authoring editor (later slice).',
  conflicts: 'Producers disagree. One is wrong — the most informative thing in the queue.',
  autoPromote:
    'Corroborated + complete: both producers agreed, so these become content with no human needed. Accept is optional here — it records a durable "a human confirmed this" that survives a re-run; Reject reverses the auto-promotion.',
  invalid: 'Complete-looking but schema-invalid — a producer bug, not a content problem.',
  decided:
    'Settled — a human ruled on these, so they have left the buckets above and those counts fell. Undo returns a row to the bucket it came from. Confirmations of already-auto-promoted effects are not counted here; they stay under Auto-promoted, which is why this can read lower than the Decided tile.',
};

/**
 * The two top-level views. The queue was the whole page until now, which quietly
 * presented ~18% of the corpus as if it were all the work: 1,096 feats propose
 * something, 5,020 propose nothing and had no surface at all.
 */
type View = 'queue' | 'silent';

/**
 * How the queue is CUT. Both cuts show the same candidates; they answer different
 * questions, so neither replaces the other.
 *
 * `shape` groups by `effectSignature` — "confirm this one shape across 143 feats",
 * which is where the bulk leverage is and the only cut `BulkBar` makes sense in.
 *
 * `feat` groups by entity, across every bucket and regardless of decision. It exists
 * because the shape cut can scatter ONE feat's effects across three tabs: Adaptive
 * Vision's three saves and its degree rewrite are four rows in four places, so
 * "are we accounting for everything this feat does" was unanswerable at a glance —
 * and that question is exactly how a reviewer catches a MISSING effect, which no
 * per-candidate row can ever show them.
 */
type Grouping = 'shape' | 'feat';

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

// ── the gap editor ──────────────────────────────────────────────────────────
//
// Measured over the corpus, EVERY gap is on `when` (956) or `target` (110) — so this
// is a two-field editor, not a general draft editor (that is EffectAuthorPage, which
// is strictly more general). Both controls already exist in features/authoring, so
// nothing is re-implemented here: the review surface and the homebrew editor author
// the same shapes through the same fields.

/** What each kind is, in the reviewer's language rather than the schema's. */
const KIND_LABEL: Record<(typeof EFFECT_KINDS)[number], string> = {
  modifier: 'a bonus or penalty',
  proficiency: 'a proficiency rank',
  grant: 'grant something',
  note: 'a note on a stat',
  rollAdjust: 'change the result',
};

/**
 * Expand a broadcast target ("all saves", "all skills") into one draft per stat.
 *
 * The stored model is per-stat — a single `all-saves` effect is not a shape the schema
 * accepts, and ingest fans the same tokens out — so this is purely an authoring
 * convenience, exactly as `EffectAuthorPage.patchEffect` does it. Without it the token
 * reaches the validator as a target and reports "unknown stat selector", which is what
 * this panel did: it offered the broadcast options and could never accept one.
 */
function fanOut(draft: DraftEffect): DraftEffect[] {
  const fan = BROADCAST[(draft as { target?: string }).target as keyof typeof BROADCAST];
  return fan ? fan.map((target) => ({ ...draft, target }) as DraftEffect) : [draft];
}

/**
 * Author an effect on this feat that NO producer proposed.
 *
 * Separate from the gap editor above it, and deliberately so: that editor answers
 * "which gap did this close?", and an addition closes none — there is no proposal to
 * close one on. Core keeps the same split (`ResolutionPatch` vs `addEffect`), so the
 * distinction survives into the exported decisions as `action: "add"` and a reviewer
 * reading them later can tell a human's fill from a human's invention.
 *
 * The form is `EffectForm` — the SAME control the homebrew authoring page uses, so
 * there is one authoring surface rendered in two places rather than two that drift.
 */
function AddEffectPanel({
  entityId,
  additions,
  onAdd,
  onRemove,
}: {
  entityId: string;
  additions: EffectDecision[];
  onAdd: (drafts: readonly DraftEffect[]) => { ok: boolean };
  onRemove: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // `modifier` is the default because a typed bonus is the commonest thing the parser
  // misses. This panel was pinned to `rollAdjust` with no way to change it, so the one
  // effect a human most needed to add — "+1 status to saves vs darkness" — could not be
  // authored here at all.
  const [kind, setKind] = useState<(typeof EFFECT_KINDS)[number]>('modifier');
  const fresh = (k: (typeof EFFECT_KINDS)[number]) => withId({ kind: k });
  const [draft, setDraft] = useState<Draft>(() => fresh('modifier'));

  // Validate what will actually be RECORDED: a broadcast target becomes several drafts,
  // and validating the un-fanned one reports "unknown stat selector" on a shape that is
  // never stored. Messages are deduped — the same complaint about sixteen skills is one
  // problem to the author.
  const drafts = fanOut(strip(draft) as DraftEffect);
  const issues = [...new Set(drafts.flatMap((d) => validatePassive(d as unknown as Draft)))];

  const pickKind = (k: (typeof EFFECT_KINDS)[number]) => {
    // A fresh draft per kind, so switching never leaves a stale field from the old shape
    // (a `rollAdjust`'s `adjust` hanging off a `modifier`) that the schema would refuse.
    setKind(k);
    setDraft(fresh(k));
  };

  const submit = () => {
    if (onAdd(drafts).ok) {
      setDraft(fresh(kind));
      setOpen(false);
    }
  };

  return (
    <div className="mt-2">
      {additions.length > 0 && (
        <ul className="mb-2 space-y-1">
          {additions.map((a) => (
            <li key={a.key} className="flex items-center gap-2 rounded border border-emerald/25 bg-emerald/5 px-2 py-1">
              <span className="rounded border border-emerald/30 px-1 text-xs text-emerald-soft">added</span>
              <span className="text-sm text-parchment/85">{a.effect ? describeEffect(a.effect as DraftEffect) : '—'}</span>
              <button
                onClick={() => onRemove(a.key)}
                className="ml-auto text-xs text-parchment/50 hover:text-red-300"
                title="Remove this addition"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="rounded-md border border-gold/15 bg-midnight-950/60 p-2.5">
          <div className="mb-1.5 text-xs uppercase tracking-wide text-parchment/50">
            add an effect to {nameOf(entityId)} — one no producer proposed
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-parchment/50">this feat also…</span>
            <select
              className="rounded border border-gold/20 bg-midnight-950/60 px-2 py-1 text-sm text-parchment"
              value={kind}
              onChange={(e) => pickKind(e.target.value as (typeof EFFECT_KINDS)[number])}
            >
              {EFFECT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <EffectForm draft={draft} onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))} allowBroadcast />
          {drafts.length > 1 && (
            <p className="mt-1.5 text-xs text-parchment/50">
              fans out to {drafts.length} effects, one per stat — the stored model is per-stat
            </p>
          )}
          {issues.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {issues.map((i, n) => (
                <li key={n} className="text-xs text-amber-200/70">{i}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              onClick={submit}
              disabled={issues.length > 0}
              className="rounded border border-emerald/30 px-2 py-0.5 text-sm text-emerald-soft hover:bg-emerald/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
            <button onClick={() => setOpen(false)} className="rounded border border-gold/20 px-2 py-0.5 text-sm text-parchment/60 hover:text-gold">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="text-xs text-parchment/45 hover:text-gold">
          ＋ add an effect the producers missed
        </button>
      )}
    </div>
  );
}

/**
 * Whether what is on screen has reached the database.
 *
 * An `error` here does NOT mean the reviewer's work is lost — local state keeps it and
 * Export still writes it out — so the message says what to do rather than just what
 * broke. Rolling local state back on a failed write would destroy real judgment to
 * report a network problem.
 */
function SaveIndicator({ state, error, count }: { state: 'idle' | 'saving' | 'saved' | 'error'; error: string | null; count: number }) {
  if (state === 'error') {
    return (
      <span
        className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-sm text-red-200"
        title={error ?? undefined}
      >
        ⚠ not saved — your work is still here; use Export to keep it
      </span>
    );
  }
  if (state === 'saving') {
    return <span className="px-2.5 py-1.5 text-sm text-parchment/50">saving…</span>;
  }
  if (state === 'saved') {
    return <span className="px-2.5 py-1.5 text-sm text-emerald-soft/80">✓ saved ({count})</span>;
  }
  return <span className="px-2.5 py-1.5 text-sm text-parchment/40">{count > 0 ? `${count} decided` : 'decisions save automatically'}</span>;
}

const REJECT_REASONS: { value: RejectReason; label: string; hint: string }[] = [
  {
    value: 'not-a-passive',
    label: 'not a passive',
    hint: 'Real content, but a duration or triggered effect — Layer 2’s, not a passive. 104 of the when-gaps are duration text.',
  },
  { value: 'wrong-reading', label: 'wrong reading', hint: 'The producer misread the prose; the effect it describes is not there.' },
  { value: 'out-of-scope', label: 'out of scope', hint: 'Real and expressible, but out of the current scope to model.' },
  { value: 'duplicate', label: 'duplicate', hint: 'Already covered by another candidate on this feat.' },
];

/**
 * The patch controls for a set of gap fields. Shared by the per-candidate editor and
 * the bulk bar so one patch means the same thing in both places.
 *
 * `unconditional` is its own checkbox rather than "an empty predicate", because those
 * are different claims: an empty builder means NOT YET ANSWERED, while unconditional
 * means a human read the prose and ruled there is no condition. Collapsing them would
 * silently promote every untouched candidate as unconditional — turning a situational
 * bonus into a permanent one, the exact wrong-sheet failure the pipeline refuses.
 */
function PatchFields({
  fields,
  patch,
  onPatch,
}: {
  fields: ReadonlySet<string>;
  patch: ResolutionPatch;
  onPatch: (p: ResolutionPatch) => void;
}) {
  return (
    <div className="space-y-2">
      {fields.has('target') && (
        <label className="flex flex-wrap items-center gap-2 text-xs text-parchment/70">
          <span className="w-20 shrink-0">target</span>
          <SelectorField value={patch.target ?? ''} onChange={(v) => onPatch({ ...patch, target: v || undefined })} />
          <span className="text-parchment/40">the stat the pronoun refers to</span>
        </label>
      )}
      {fields.has('when') && (
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs text-parchment/70">
            <input
              type="checkbox"
              checked={!!patch.unconditional}
              onChange={(e) => onPatch({ ...patch, unconditional: e.target.checked, ...(e.target.checked ? { when: undefined } : {}) })}
            />
            no condition — the prose clause is not a condition on this effect
          </label>
          {!patch.unconditional && (
            <PredicateField value={patch.when} onChange={(v) => onPatch({ ...patch, when: v })} />
          )}
        </div>
      )}
    </div>
  );
}

/** The gap fields present across a set of candidates — what `PatchFields` renders. */
function gapFieldsOf(candidates: readonly EffectCandidate[]): Set<string> {
  const s = new Set<string>();
  for (const c of candidates) for (const g of c.gaps) s.add(g.field);
  return s;
}

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
  const [grouping, setGrouping] = useState<Grouping>('shape');
  const [openSig, setOpenSig] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  /** Which rulings the Decided bucket shows — a reject is settled but not the same claim. */
  const [decidedFilter, setDecidedFilter] = useState<'all' | 'accept' | 'reject'>('all');
  // By-feat state. The corpus has 1,096 feats with candidates, so a search is not a
  // convenience — without it the cut is unusable for finding the one feat you want.
  const [featQuery, setFeatQuery] = useState('');
  const [outstandingOnly, setOutstandingOnly] = useState(true);
  const [openFeat, setOpenFeat] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Map<string, EffectDecision>>(new Map());
  // Per-candidate gap fills, and the multi-select state for the bulk bar. Both are
  // scoped to the open signature group and cleared when it changes — a patch authored
  // for "modifier:save:circumstance" means nothing against a different shape, and
  // carrying it across would invite applying it somewhere it was never read for.
  const [patches, setPatches] = useState<Map<string, ResolutionPatch>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPatch, setBulkPatch] = useState<ResolutionPatch>({});
  const importRef = useRef<HTMLInputElement>(null);
  /**
   * Effects a human authored that NO producer proposed — the prose said something the
   * parser cannot yet read. Held apart from `decisions` because they are addressed by a
   * minted key rather than a candidate's (see core's `addEffect`), so they have no row
   * in the queue to hang off. They export alongside the rest, and `resolveEntity` folds
   * them into content without ever reporting them stale.
   */
  const [additions, setAdditions] = useState<EffectDecision[]>([]);
  /**
   * Whether what is on screen has reached the database. Surfaced rather than kept
   * internal because the entire point of persisting is that the reviewer can trust
   * their work is safe — a silent write failure would be worse than the old manual
   * export, which at least never claimed to have saved.
   */
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // Load what was already decided. A failure here is NOT fatal — the queue is still
  // reviewable and export still works — but it must be visible, because a reviewer
  // who cannot see their prior decisions would otherwise re-decide from scratch.
  useEffect(() => {
    let live = true;
    fetchDecisions()
      .then((stored) => {
        if (!live) return;
        setDecisions(new Map(stored.filter((d) => d.action !== 'add').map((d) => [`${d.entityId} ${d.key}`, d])));
        setAdditions(stored.filter((d) => d.action === 'add'));
      })
      .catch((e: unknown) => {
        if (!live) return;
        setSaveState('error');
        setSaveError(e instanceof Error ? e.message : 'could not load saved decisions');
      });
    return () => {
      live = false;
    };
  }, []);

  const split = useMemo(
    () => (data ? partitionDecided(data.candidates, [...decisions.values()]) : null),
    [data, decisions],
  );
  const buckets = useMemo(() => (data ? triage(data.candidates) : null), [data]);

  /**
   * The tabs. Decided work leaves the queue — a settled row used to keep its seat and its
   * tally forever, so no count on this page could fall as the reviewer worked.
   *
   * It drains the four HUMAN buckets only. Auto-promoted keeps every corroborated
   * candidate whether or not someone confirmed it, because that tab is not a queue: those
   * are already content, an accept there is the optional durable "a human confirmed this"
   * its own hint describes, and draining it would leave the tab reading 0 while 342
   * effects quietly ship. A confirmed row stays there, tinted, with its undo.
   */
  const bucketList = useMemo((): Record<Bucket, EffectCandidate[]> | null => {
    if (!buckets || !split) return null;
    const undecided = new Set(split.undecided.map(decisionId));
    const open = (cs: EffectCandidate[]) => cs.filter((c) => undecided.has(decisionId(c)));
    return {
      autoPromote: buckets.autoPromote,
      conflicts: open(buckets.conflicts),
      gapped: open(buckets.gapped),
      review: open(buckets.review),
      invalid: open(buckets.invalid),
      // Everything a human ruled on that was theirs to rule on. An auto-promoted
      // confirmation is not listed here as well — one row, one place.
      decided: split.decided.filter((c) => !autoPromotable(c)),
    };
  }, [buckets, split]);

  // The signature groups for the selected bucket, largest shape first — "confirm this
  // across 150 feats", not 150 forms.
  const groups = useMemo(() => {
    if (!bucketList) return [];
    const list =
      bucket === 'decided' && decidedFilter !== 'all'
        ? bucketList.decided.filter((c) => decisions.get(decisionId(c))?.action === decidedFilter)
        : bucketList[bucket];
    return groupBySignature(list);
  }, [bucketList, bucket, decidedFilter, decisions]);

  /**
   * Every feat that proposed anything, with ALL of its candidates — the by-feat cut.
   *
   * Built from the full candidate list rather than a bucket, deliberately: a feat whose
   * effects are half accepted and half conflicting must show BOTH, or the cut cannot
   * answer the question it exists for.
   */
  const featGroups = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, EffectCandidate[]>();
    for (const c of data.candidates) {
      const list = m.get(c.entityId);
      if (list) list.push(c);
      else m.set(c.entityId, [c]);
    }
    return [...m.entries()]
      .map(([entityId, candidates]) => ({ entityId, name: nameOf(entityId), candidates }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  /**
   * Feats matching the search and the outstanding filter.
   *
   * "Outstanding" is undecided AND not auto-promotable — the same definition the "Need a
   * human" tile uses, so a feat whose only candidates were corroborated does not sit in
   * the list looking like work.
   */
  const visibleFeats = useMemo(() => {
    const q = featQuery.trim().toLowerCase();
    return featGroups.filter((g) => {
      if (q && !g.name.toLowerCase().includes(q)) return false;
      if (!outstandingOnly) return true;
      return g.candidates.some((c) => !decisions.has(decisionId(c)) && !autoPromotable(c));
    });
  }, [featGroups, featQuery, outstandingOnly, decisions]);

  /**
   * The ONE place local state and the database move together. Every decision path
   * routes through it, so there is no way to add a control that updates the screen
   * and forgets to persist — the bug this shape exists to prevent.
   *
   * Batched by construction: a group accept of 130 candidates is one call in one
   * transaction, not 130 round trips that can half-apply.
   */
  const commit = (entries: readonly { c: EffectCandidate; decision: EffectDecision | null }[]) => {
    if (entries.length === 0) return;
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const { c, decision } of entries) {
        if (decision) next.set(decisionId(c), decision);
        else next.delete(decisionId(c));
      }
      return next;
    });
    const saves = entries.flatMap((e) => (e.decision ? [e.decision] : []));
    const clears = entries.flatMap((e) => (e.decision ? [] : [{ entityId: e.c.entityId, key: e.c.key }]));
    persist(() => Promise.all([saveDecisions(saves), clearDecisions(clears)]));
  };

  /** Run a write, reporting its outcome. Local state is NOT rolled back on failure:
   *  the reviewer's judgment is still on screen and still exportable, and silently
   *  reverting it would destroy work to report a network problem. */
  const persist = (run: () => Promise<unknown>) => {
    setSaveState('saving');
    setSaveError(null);
    run()
      .then(() => setSaveState('saved'))
      .catch((e: unknown) => {
        setSaveState('error');
        setSaveError(e instanceof Error ? e.message : 'save failed');
      });
  };

  const setDecision = (c: EffectCandidate, decision: EffectDecision | null) => commit([{ c, decision }]);

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
  const reject = (c: EffectCandidate, reason?: RejectReason) =>
    setDecision(
      c,
      reason
        ? rejectCandidate(c, reason, { at: new Date().toISOString() })
        : { entityId: c.entityId, key: c.key, action: 'reject', at: new Date().toISOString() },
    );

  /** Bulk accept/reject — one commit, so 130 rows are one transaction. */
  const acceptGroup = (cands: EffectCandidate[]) =>
    commit(
      cands.flatMap((c) => {
        const p = promote(c);
        if (!p.ok) return [];
        return [{
          c,
          decision: {
            entityId: c.entityId,
            key: c.key,
            action: 'accept' as const,
            ...(p.effect ? { effect: p.effect } : {}),
            ...(p.choice ? { choice: p.choice } : {}),
            at: new Date().toISOString(),
          },
        }];
      }),
    );

  const rejectGroup = (cands: EffectCandidate[]) =>
    commit(
      cands.map((c) => ({
        c,
        decision: { entityId: c.entityId, key: c.key, action: 'reject' as const, at: new Date().toISOString() },
      })),
    );

  /** Undo a whole group of rulings — the Decided bucket's counterpart to accept-all. */
  const clearGroup = (cands: EffectCandidate[]) => commit(cands.map((c) => ({ c, decision: null })));

  const setPatch = (c: EffectCandidate, patch: ResolutionPatch) =>
    setPatches((prev) => new Map(prev).set(decisionId(c), patch));

  /**
   * Record a gap fill as a decision. `resolveGaps` is the gate — it refuses anything the
   * patch did not complete — so this cannot record a half-resolved candidate even if the
   * button's disabled state were wrong.
   */
  const resolve = (c: EffectCandidate, patch: ResolutionPatch) => {
    const out = resolveGaps(c, patch, { at: new Date().toISOString() });
    if (out.ok) setDecision(c, out.decision);
  };

  /** One patch across the selected candidates. Refusals are reported, never forced. */
  const applyBulkPatch = (cands: readonly EffectCandidate[]) => {
    const { decisions: made } = applyBulk(cands, bulkPatch, { at: new Date().toISOString() });
    if (made.length === 0) return;
    // applyBulk returns decisions only for the ones that resolved — so re-derive each
    // row from the candidate it came from rather than assuming the arrays line up.
    commit(
      cands.flatMap((c) => {
        const d = made.find((m) => m.entityId === c.entityId && m.key === c.key);
        return d ? [{ c, decision: d }] : [];
      }),
    );
    setSelected(new Set());
  };

  /**
   * Settle a conflict by picking one producer's reading. `resolveConflict` still runs
   * the schema and gap gates, so choosing a reading is not a way around either.
   */
  const pickReading = (c: EffectCandidate, index: number) => {
    const out = resolveConflict(c, { index }, { at: new Date().toISOString() });
    if (out.ok) setDecision(c, out.decision);
  };

  /** Opening a different shape resets the editor — see the `patches` note above. */
  const openGroup = (signature: string | null) => {
    setOpenSig(signature);
    setSelected(new Set());
    setBulkPatch({});
  };


  /**
   * Record one or more authored effects. Plural because a broadcast target ("all saves")
   * fans out to one effect per stat — the stored model is per-stat.
   *
   * ALL OR NOTHING, and the keys are minted against a pool that grows as it goes: minting
   * each against the unchanged `additions` would hand two of them the same key, and the
   * second would overwrite the first. A half-recorded fan-out is a wrong sheet — "+1 to
   * all saves" silently becoming +1 to two of the three.
   */
  const addTo = (entityId: string, drafts: readonly DraftEffect[]) => {
    const made: EffectDecision[] = [];
    let pool = additions;
    for (const draft of drafts) {
      const out = addEffect(entityId, draft, pool, { at: new Date().toISOString() });
      if (!out.ok) return out; // nothing recorded — `made` is discarded with the frame
      made.push(out.decision);
      pool = [...pool, out.decision];
    }
    if (made.length === 0) return { ok: true as const, decision: undefined };
    setAdditions((prev) => [...prev, ...made]);
    persist(() => saveDecisions(made));
    return { ok: true as const, decision: made[0] };
  };
  const removeAddition = (key: string) => {
    const gone = additions.find((a) => a.key === key);
    setAdditions((prev) => prev.filter((a) => a.key !== key));
    if (gone) persist(() => clearDecisions([{ entityId: gone.entityId, key: gone.key }]));
  };

  const exportDecisions = () => {
    const arr = [...decisions.values(), ...additions];
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
  if (!data || !buckets || !bucketList) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <p className="text-parchment/60">Loading the candidate queue…</p>
      </div>
    );
  }

  const { summary } = data;
  /**
   * Outstanding work, LIVE — from the undecided triage, not the baked `summary`.
   *
   * This read off `data.summary` until now, which is generated by build-candidates.mjs
   * and therefore constant: 343 decisions in, it still said 1,702 needed a human, and it
   * would have said so with every candidate decided. The one number a reviewer uses to
   * judge whether the work is shrinking could not shrink.
   */
  const needsHuman =
    bucketList.conflicts.length + bucketList.gapped.length + bucketList.review.length + bucketList.invalid.length;
  const accepts = [...decisions.values()].filter((d) => d.action === 'accept').length;
  const rejects = [...decisions.values()].filter((d) => d.action === 'reject').length;
  // Counted over the decided CANDIDATES, not over `decisions`, so the sub-filter tallies
  // match what the list can actually show: a decision left over from an earlier producer
  // run points at no candidate, and would otherwise be counted into a filter that then
  // renders one row fewer than it promised.
  const decidedBy = (action: 'accept' | 'reject') =>
    bucketList.decided.filter((c) => decisions.get(decisionId(c))?.action === action).length;

  /**
   * Everything a candidate row needs, bundled once. The row is rendered from two cuts
   * now (by shape and by feat), and threading fourteen props through both is how the
   * two drift — a control added to one and forgotten in the other.
   */
  const bind: RowBind = {
    decisions,
    additions,
    patches,
    showText,
    setPatch,
    accept,
    reject,
    resolve,
    pickReading,
    addTo,
    removeAddition,
    clear: (c) => setDecision(c, null),
  };

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
        <StatTile label="Auto-promoted" value={buckets.autoPromote.length.toLocaleString()} hint="corroborated + complete" />
        <StatTile label="Need a human" value={needsHuman.toLocaleString()} hint="still undecided" />
        <StatTile label="Decided" value={decisions.size.toLocaleString()} hint={`${accepts} accept · ${rejects} reject`} />
      </div>

      {/* decisions toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Decisions save as you make them. Shown because the value of persisting is
            that the reviewer can TRUST it — a silent write failure would be worse than
            the old manual export, which never claimed to have saved. */}
        <SaveIndicator state={saveState} error={saveError} count={decisions.size + additions.length} />
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
      {/* the cut — by shape (bulk leverage) or by feat (completeness). See `Grouping`. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-parchment/40">group by</span>
        {([
          ['shape', 'Shape'],
          ['feat', 'Feat'],
        ] as [Grouping, string][]).map(([g, label]) => (
          <button
            key={g}
            onClick={() => setGrouping(g)}
            className={`rounded-md border px-3 py-1 text-sm ${
              grouping === g ? 'border-arcane/50 bg-arcane/10 text-arcane' : 'border-gold/15 text-parchment/70 hover:bg-midnight-900/50'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="text-xs text-parchment/45">
          {grouping === 'shape'
            ? 'one shape across many feats — where the bulk actions are'
            : 'one feat with every effect we found for it — is anything missing?'}
        </span>
      </div>

      {grouping === 'feat' && (
        <FeatPanel
          feats={visibleFeats}
          total={featGroups.length}
          query={featQuery}
          onQuery={setFeatQuery}
          outstandingOnly={outstandingOnly}
          onOutstandingOnly={setOutstandingOnly}
          openFeat={openFeat}
          onOpenFeat={setOpenFeat}
          bind={bind}
        />
      )}

      {grouping === 'shape' && (
        <>
      {/* bucket tabs */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
          <button
            key={b}
            onClick={() => {
              setBucket(b);
              openGroup(null);
            }}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              bucket === b
                ? 'border-gold/50 bg-midnight-900/80 text-gold'
                : b === 'decided'
                  ? 'border-emerald/20 text-emerald-soft/70 hover:bg-midnight-900/50'
                  : 'border-gold/15 text-parchment/70 hover:bg-midnight-900/50'
            }`}
          >
            {BUCKET_LABEL[b]} <span className="tabular-nums text-parchment/50">{bucketList[b].length}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-parchment/60">{BUCKET_HINT[bucket]}</p>

      {/* the Decided bucket splits by what was ruled — an accept and a reject are both
          settled, but they are not the same claim about the content. */}
      {bucket === 'decided' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {([
            ['all', `All ${bucketList.decided.length}`],
            ['accept', `Accepted ${decidedBy('accept')}`],
            ['reject', `Rejected ${decidedBy('reject')}`],
          ] as ['all' | 'accept' | 'reject', string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => {
                setDecidedFilter(f);
                openGroup(null);
              }}
              className={`rounded border px-2 py-0.5 text-xs ${
                decidedFilter === f ? 'border-gold/50 text-gold' : 'border-gold/15 text-parchment/60 hover:text-gold'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* signature groups */}
      <div className="mt-4 space-y-3">
        {groups.map(({ signature, candidates }) => {
          const open = openSig === signature;
          const promotable = candidates.filter((c) => promote(c).ok);
          return (
            <div key={signature} className="relative rounded-lg border border-gold/15 bg-midnight-900/40">
              {open && <CornerBrackets />}
              <button
                onClick={() => openGroup(open ? null : signature)}
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
                  {bucket === 'decided' ? (
                    <div className="mb-3 flex gap-2">
                      <button
                        onClick={() => clearGroup(candidates)}
                        className="rounded border border-gold/25 px-2.5 py-1 text-xs text-parchment/70 hover:text-gold"
                      >
                        Undo all {candidates.length}
                      </button>
                    </div>
                  ) : (
                    promotable.length > 0 && (
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
                    )
                  )}
                  {/* bulk fill — one patch across a selection. The leverage lives here:
                      504 distinct `when` phrasings mean you resolve by the ANSWER, not
                      by the question, so the selection is the human's, not automatic. */}
                  {bucket !== 'decided' && gapFieldsOf(candidates).size > 0 && (
                    <BulkBar
                      candidates={candidates}
                      selected={selected}
                      patch={bulkPatch}
                      onPatch={setBulkPatch}
                      onToggleAll={(on) =>
                        setSelected(on ? new Set(candidates.map(decisionId)) : new Set())
                      }
                      onApply={() => applyBulkPatch(candidates.filter((c) => selected.has(decisionId(c))))}
                    />
                  )}
                  <div className="space-y-2">
                    {candidates.map((c) => (
                      <BoundRow
                        key={decisionId(c)}
                        candidate={c}
                        bind={bind}
                        selected={selected.has(decisionId(c))}
                        onSelect={(on) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (on) next.add(decisionId(c));
                            else next.delete(decisionId(c));
                            return next;
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <p className="text-sm text-parchment/50">
            {bucket === 'decided' ? 'Nothing decided yet.' : 'Nothing left in this bucket.'}
          </p>
        )}
      </div>
        </>
      )}
        </>
      )}

      <p className="mt-10 text-xs text-parchment/40">
        Generated {new Date(data.generatedAt).toLocaleString()} · regenerate with{' '}
        <code>node scripts/build-candidates.mjs</code>. Decisions are folded into content by a later slice.
      </p>
    </div>
  );
}

/**
 * The bulk fill bar: select rows, author ONE patch, apply it across them.
 *
 * The count is computed with `patchResolves` BEFORE the action, so the bar can say
 * "34 of 50 will resolve" rather than reporting 16 refusals afterwards. `applyBulk`
 * refuses the rest rather than approximating them — forcing a shared fill onto a
 * candidate whose remaining gap it never addressed is how a bulk action produces
 * wrong sheets at scale.
 */
function BulkBar({
  candidates,
  selected,
  patch,
  onPatch,
  onToggleAll,
  onApply,
}: {
  candidates: EffectCandidate[];
  selected: Set<string>;
  patch: ResolutionPatch;
  onPatch: (p: ResolutionPatch) => void;
  onToggleAll: (on: boolean) => void;
  onApply: () => void;
}) {
  const picked = candidates.filter((c) => selected.has(decisionId(c)));
  const willResolve = picked.filter((c) => patchResolves(c, patch)).length;
  const allOn = picked.length === candidates.length && candidates.length > 0;

  return (
    <div className="mb-3 rounded-md border border-arcane/25 bg-arcane/5 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-parchment/70">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={allOn} onChange={(e) => onToggleAll(e.target.checked)} />
          select all {candidates.length}
        </label>
        <span className="text-parchment/40">·</span>
        <span className="tabular-nums">{picked.length} selected</span>
      </div>

      {picked.length > 0 && (
        <div className="mt-2 border-t border-arcane/15 pt-2">
          <PatchFields fields={gapFieldsOf(picked)} patch={patch} onPatch={onPatch} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={onApply}
              disabled={willResolve === 0}
              className="rounded border border-emerald/30 px-2.5 py-1 text-xs text-emerald-soft hover:bg-emerald/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Apply to {willResolve}
            </button>
            <span className="text-xs text-parchment/50">
              {willResolve} of {picked.length} selected will resolve with this fill
              {willResolve < picked.length && ' — the rest keep a gap it does not close, and are left alone'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The page state and handlers a candidate row needs, bundled so both cuts bind a row
 * the same way. See the `bind` note in the page.
 */
interface RowBind {
  decisions: Map<string, EffectDecision>;
  additions: EffectDecision[];
  patches: Map<string, ResolutionPatch>;
  showText: boolean;
  setPatch: (c: EffectCandidate, p: ResolutionPatch) => void;
  accept: (c: EffectCandidate) => void;
  reject: (c: EffectCandidate, reason?: RejectReason) => void;
  resolve: (c: EffectCandidate, p: ResolutionPatch) => void;
  pickReading: (c: EffectCandidate, index: number) => void;
  addTo: (entityId: string, drafts: readonly DraftEffect[]) => { ok: boolean };
  removeAddition: (key: string) => void;
  clear: (c: EffectCandidate) => void;
}

/** A `CandidateRow` wired to the page. The ONE place a row's props are assembled. */
function BoundRow({
  candidate: c,
  bind,
  selected,
  onSelect,
  showName = true,
  showAddPanel = true,
  showText,
}: {
  candidate: EffectCandidate;
  bind: RowBind;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  /** By-feat renders the name once on the card, so the rows under it drop theirs. */
  showName?: boolean;
  /** Likewise the add-effect panel, which is per-FEAT and was repeated per row. */
  showAddPanel?: boolean;
  showText?: boolean;
}) {
  const id = decisionId(c);
  return (
    <CandidateRow
      candidate={c}
      decision={bind.decisions.get(id)}
      showText={showText ?? bind.showText}
      showName={showName}
      showAddPanel={showAddPanel}
      patch={bind.patches.get(id) ?? {}}
      onPatch={(p) => bind.setPatch(c, p)}
      selected={selected ?? false}
      onSelect={onSelect ?? (() => {})}
      additions={bind.additions.filter((a) => a.entityId === c.entityId)}
      onAdd={(d) => bind.addTo(c.entityId, d)}
      onRemoveAddition={bind.removeAddition}
      onAccept={() => bind.accept(c)}
      onResolve={(p) => bind.resolve(c, p)}
      onReject={(reason) => bind.reject(c, reason)}
      onPickReading={(i) => bind.pickReading(c, i)}
      onClear={() => bind.clear(c)}
    />
  );
}

/** How many feats to render at once. Enough to browse, few enough to stay responsive. */
const FEAT_PAGE = 60;

/** A candidate's state in one word — what a by-feat card summarises per row. */
function statusOf(c: EffectCandidate, decisions: Map<string, EffectDecision>): {
  label: string;
  className: string;
  outstanding: boolean;
} {
  const d = decisions.get(decisionId(c));
  if (d?.action === 'reject') return { label: 'rejected', className: 'border-red-500/30 text-red-300/80', outstanding: false };
  if (d) return { label: 'accepted', className: 'border-emerald/30 text-emerald-soft', outstanding: false };
  if (c.agreement === 'conflicting') return { label: 'conflict', className: 'border-red-500/40 text-red-300', outstanding: true };
  if (c.gaps.length > 0) return { label: 'gapped', className: 'border-brass/40 text-brass', outstanding: true };
  if (autoPromotable(c)) return { label: 'auto', className: 'border-gold/25 text-gold/70', outstanding: false };
  if (promote(c).ok) return { label: 'needs review', className: 'border-arcane/40 text-arcane', outstanding: true };
  return { label: 'invalid', className: 'border-red-500/30 text-red-300/70', outstanding: true };
}

/**
 * The by-feat cut: one card per feat, holding EVERY effect any producer proposed for it.
 *
 * This is a completeness surface, not a throughput one. The shape cut is faster for
 * confirming a known shape across 143 feats; it cannot show that a feat's fourth effect
 * was never proposed at all, because that absence has no row anywhere. Here the feat's
 * full text sits above its effects, so the reviewer reads the prose and counts.
 *
 * Decided rows stay VISIBLE here rather than moving to their own section, unlike the
 * shape cut — "what does this feat do" is answered wrongly if the accepted half is
 * hidden. The status chip carries the distinction instead.
 */
function FeatPanel({
  feats,
  total,
  query,
  onQuery,
  outstandingOnly,
  onOutstandingOnly,
  openFeat,
  onOpenFeat,
  bind,
}: {
  feats: { entityId: string; name: string; candidates: EffectCandidate[] }[];
  total: number;
  query: string;
  onQuery: (q: string) => void;
  outstandingOnly: boolean;
  onOutstandingOnly: (on: boolean) => void;
  openFeat: string | null;
  onOpenFeat: (id: string | null) => void;
  bind: RowBind;
}) {
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search feats…"
          className="rounded-md border border-gold/20 bg-midnight-950/60 px-3 py-1.5 text-sm text-parchment placeholder:text-parchment/35 focus:border-gold/50 focus:outline-none"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-parchment/70">
          <input type="checkbox" checked={outstandingOnly} onChange={(e) => onOutstandingOnly(e.target.checked)} />
          only feats with outstanding work
        </label>
        <span className="text-sm text-parchment/45">
          {feats.length.toLocaleString()} of {total.toLocaleString()} feats
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {feats.slice(0, FEAT_PAGE).map((f) => {
          const open = openFeat === f.entityId;
          const statuses = f.candidates.map((c) => statusOf(c, bind.decisions));
          const outstanding = statuses.filter((s) => s.outstanding).length;
          const feat = FEAT_BY_ID.get(f.entityId);
          const featAdditions = bind.additions.filter((a) => a.entityId === f.entityId);

          return (
            <div key={f.entityId} className="relative rounded-lg border border-gold/15 bg-midnight-900/40">
              {open && <CornerBrackets />}
              <button
                onClick={() => onOpenFeat(open ? null : f.entityId)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="font-ui text-base text-gold">{f.name}</span>
                <span className="text-xs text-parchment/50">
                  {f.candidates.length} effect{f.candidates.length === 1 ? '' : 's'}
                </span>
                {featAdditions.length > 0 && (
                  <span className="text-xs text-emerald-soft/70">+{featAdditions.length} added</span>
                )}
                {/* The chips ARE the summary — a closed card still says where this feat
                    stands, so scanning the list does not require opening each one. */}
                <span className="flex flex-wrap gap-1">
                  {statuses.map((s, i) => (
                    <span key={i} className={`rounded border px-1 text-[10px] ${s.className}`}>
                      {s.label}
                    </span>
                  ))}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {outstanding > 0 ? (
                    <span className="text-xs text-brass">{outstanding} outstanding</span>
                  ) : (
                    <span className="text-xs text-emerald-soft/60">settled</span>
                  )}
                  <span className="text-parchment/40">{open ? '▾' : '▸'}</span>
                </span>
              </button>

              {open && (
                <div className="border-t border-gold/10 px-4 py-3">
                  {/* The prose ONCE, above the effects it produced — this is the cut where
                      you read the feat and check nothing in it went unmodelled. */}
                  {feat?.description && (
                    <div className="mb-3 max-h-72 overflow-y-auto rounded-md border border-gold/15 bg-midnight-950/70 p-3">
                      <GrimoireMarkdown strip={['access', 'source']}>{feat.description}</GrimoireMarkdown>
                    </div>
                  )}

                  <div className="space-y-2">
                    {f.candidates.map((c) => (
                      <BoundRow
                        key={decisionId(c)}
                        candidate={c}
                        bind={bind}
                        showName={false}
                        showAddPanel={false}
                        showText={false}
                      />
                    ))}
                  </div>

                  {/* ONE add panel for the feat. In the shape cut this renders inside every
                      row, so a feat with three candidates lists its additions three times. */}
                  <div className="mt-3 border-t border-gold/10 pt-2">
                    <AddEffectPanel
                      entityId={f.entityId}
                      additions={featAdditions}
                      onAdd={(d) => bind.addTo(f.entityId, d)}
                      onRemove={bind.removeAddition}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {feats.length === 0 && (
          <p className="text-sm text-parchment/50">
            {outstandingOnly
              ? 'No feats with outstanding work match — clear the filter to see settled ones.'
              : 'No feats match that search.'}
          </p>
        )}
        {feats.length > FEAT_PAGE && (
          <p className="text-xs text-parchment/50">
            Showing the first {FEAT_PAGE} of {feats.length.toLocaleString()} — search to narrow.
          </p>
        )}
      </div>
    </>
  );
}

function CandidateRow({
  candidate: c,
  decision,
  showText,
  showName = true,
  showAddPanel = true,
  patch,
  onPatch,
  selected,
  onSelect,
  additions,
  onAdd,
  onRemoveAddition,
  onAccept,
  onResolve,
  onReject,
  onPickReading,
  onClear,
}: {
  candidate: EffectCandidate;
  decision: EffectDecision | undefined;
  showText: boolean;
  /** By-feat names the feat once on its card; the rows under it would just repeat it. */
  showName?: boolean;
  /** Likewise the add panel — it is per-FEAT, and by-feat hoists it out of the rows. */
  showAddPanel?: boolean;
  patch: ResolutionPatch;
  onPatch: (p: ResolutionPatch) => void;
  selected: boolean;
  onSelect: (on: boolean) => void;
  additions: EffectDecision[];
  onAdd: (drafts: readonly DraftEffect[]) => { ok: boolean };
  onRemoveAddition: (key: string) => void;
  onAccept: () => void;
  onResolve: (p: ResolutionPatch) => void;
  onReject: (reason?: RejectReason) => void;
  onPickReading: (index: number) => void;
  onClear: () => void;
}) {
  const feat = FEAT_BY_ID.get(c.entityId);
  const canAccept = promote(c).ok;
  const decided = decision?.action;
  const gapped = c.gaps.length > 0;
  // What the fill leaves outstanding, addressed to a field — the same gates `promote`
  // uses, so the Resolve button can never enable a save promote would refuse.
  const patched = applyResolution(c, patch);
  const issues = resolutionIssues(patched);
  const canResolve = issues.length === 0;

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
        {gapped && !decided && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            title="Select for a bulk fill"
          />
        )}
        {showName && <span className="font-ui text-base text-parchment">{feat?.name ?? c.entityId}</span>}
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
              {canAccept ? (
                <button
                  onClick={onAccept}
                  title="Accept as content"
                  className="rounded border border-emerald/30 px-2.5 py-0.5 text-sm text-emerald-soft hover:bg-emerald/10"
                >
                  Accept
                </button>
              ) : (
                <button
                  onClick={() => onResolve(patch)}
                  disabled={!canResolve}
                  title={
                    canResolve
                      ? 'Record this fill as a decision'
                      : gapped
                        ? 'Fill the gap below first'
                        : // A conflict is not fillable — a human picks a reading, which is
                          // slice 3. Saying "fill the gap" here would send them looking for
                          // a hole that does not exist.
                          'Producers disagree — picking a reading is the conflict editor (next slice)'
                  }
                  className="rounded border border-emerald/30 px-2.5 py-0.5 text-sm text-emerald-soft hover:bg-emerald/10 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Resolve
                </button>
              )}
              {/* Reject carries a REASON, from a closed vocabulary. "not a passive" is
                  the one that matters: 104 of the when-gaps are duration text, which is
                  real Layer-2 content — rejecting it as a misreading would lie to the
                  next reviewer. */}
              <select
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  onReject(v ? (v as RejectReason) : undefined);
                  e.target.value = '';
                }}
                title="Reject with a reason"
                className="rounded border border-red-500/25 bg-midnight-950/60 px-1.5 py-0.5 text-sm text-red-300/80"
              >
                <option value="" disabled>
                  Reject…
                </option>
                {REJECT_REASONS.map((r) => (
                  <option key={r.value} value={r.value} title={r.hint}>
                    {r.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      {/* a choice's options — the primary content of a choice candidate */}
      {c.draft.kind === 'choice' && <ChoiceOptions choice={c.draft.choice as DraftChoice} />}

      {/* conflict: every reading side by side, each with the producer that proposed
          it, so a reviewer can go check the right source text. One of them is wrong. */}
      {c.agreement === 'conflicting' && !decided && (
        <div className="mt-2 rounded-md border border-red-500/25 bg-red-500/5 p-2.5">
          <div className="mb-2 text-xs uppercase tracking-wide text-red-300/70">
            Producers disagree — pick the correct reading
          </div>
          <div className="space-y-1.5">
            {conflictReadings(c).map((r) => (
              <div key={r.index} className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => onPickReading(r.index)}
                  className="rounded border border-emerald/30 px-2 py-0.5 text-xs text-emerald-soft hover:bg-emerald/10"
                >
                  Use this
                </button>
                <span className="text-sm text-parchment/85">{describeEffect(r.draft)}</span>
                {r.sources.length > 0 && (
                  <span className="rounded border border-gold/20 px-1 text-xs text-parchment/50">
                    {r.sources.join(', ')}
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-parchment/45">
            Authoring a third reading is deliberately not offered here — the readings cover every
            conflict in the measured corpus. An effect the producers missed entirely is a
            different thing, and goes through "add an effect" below.
          </p>
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

      {/* the gap editor — two fields, because every gap in the corpus is on one of
          them. Shown whenever a row cannot yet be accepted, not just when it is
          gapped: a conflicting or schema-invalid row then explains ITSELF through the
          same issue list, instead of offering a disabled button and no reason. */}
      {!canAccept && !decided && (
        <div className="mt-2 rounded-md border border-gold/15 bg-midnight-950/60 p-2.5">
          <PatchFields fields={gapFieldsOf([c])} patch={patch} onPatch={onPatch} />
          {issues.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {issues.map((i, n) => (
                <li key={n} className="text-xs text-amber-200/70">
                  <span className="font-mono text-parchment/50">{i.field}</span> — {i.message}
                </li>
              ))}
            </ul>
          )}
          {canResolve && (
            <p className="mt-2 text-xs text-emerald-soft/80">
              resolves to: {describeEffect(patched.draft)}
            </p>
          )}
        </div>
      )}

      {showAddPanel && (
        <AddEffectPanel
          entityId={c.entityId}
          additions={additions}
          onAdd={onAdd}
          onRemove={onRemoveAddition}
        />
      )}

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
