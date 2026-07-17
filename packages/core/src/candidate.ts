// The candidate / review model — how a PROPOSED effect becomes a REAL one.
//
// THE SPINE: candidates are not content.
//
//   producers ──► candidates (proposals) ──promote──► effects (content, applied)
//
// `effects` on an entity is content: versioned, pinned by characters, applied to
// sheets. A candidate is a work queue item: regenerated every time a producer
// improves, and NEVER applied to anything. Keeping them apart is what makes guessing
// safe — a guess is structurally incapable of reaching a character — and it protects
// the pin-version invariant, since a re-run must not dirty content and force a
// content update on every character that pinned it.
//
// STORAGE-AGNOSTIC ON PURPOSE. Everything here is a pure function over plain values.
// Candidates and decisions are produced and consumed, never read or written — the
// file/DB edge lives entirely outside this module, so moving content into the
// database later replaces the edge and touches none of this.
//
// AGREEMENT IS EARNED, NOT SCORED. There is deliberately no numeric confidence: a
// parser does not know how right it is, and a score invites false precision. What we
// CAN state as fact is whether two independent derivations of the same effect agree —
// which is real evidence, and is what lets the easy cases clear in bulk.
//
// NO PF2e RULES LIVE HERE. This module arbitrates between producers; the rules are in
// passive.ts / foundry.ts / the parser, each from source text.

import { passiveEffectSchema, type PassiveEffect } from "./passive.js";

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------

/** Which producer proposed an effect. Two sources agreeing is the whole point. */
export type CandidateSource = "parser" | "foundry";

/**
 * Why a draft has a hole. The vocabulary is small and each entry names a REAL,
 * measured failure — `anaphoric` dominates in practice, because PF2e prose says
 * "you gain a +2 circumstance bonus to **the check**" and the target is a pronoun
 * pointing at an earlier clause. No dictionary fixes that; a human resolves it in
 * seconds. Gaps are the main path, not an error path.
 */
export type GapReason =
  /** The prose refers back to something earlier ("the check", "the save"). */
  | "anaphoric"
  /** A term we have no vocabulary for yet. */
  | "unresolved-vocabulary"
  /** There is a condition on this effect that we cannot express (see predicate.ts). */
  | "conditional-unmapped"
  /** The prose admits more than one reading. */
  | "ambiguous"
  /** The field simply is not stated. */
  | "missing";

/** One hole in a draft, and what a human needs in order to fill it. */
export interface Gap {
  /** The draft field that is missing or unresolved (`target`, `value`, `when`…). */
  field: string;
  reason: GapReason;
  /** The raw text we could not resolve, quoted for the reviewer ("the check"). */
  raw?: string;
}

/**
 * How much independent support a candidate has. Each value is a FACT about the
 * producers, never a heuristic:
 *   • corroborated — two producers independently proposed the same effect.
 *   • conflicting  — two producers proposed the same effect DIFFERENTLY. A bug lives
 *                    here, so it goes to the top of the queue, never into content.
 *   • parser-only / foundry-only — only one producer saw it.
 */
export type Agreement = "corroborated" | "conflicting" | "parser-only" | "foundry-only";

/** Where a proposal came from, so a reviewer can check it against the source. */
export interface Evidence {
  source: CandidateSource;
  /** Parser: the prose it read, quoted (and where, for highlighting). */
  span?: { start: number; end: number; text: string };
  /** Foundry: which of the entity's raw rule elements produced it. */
  ruleElementIndex?: number;
}

/**
 * A proposed effect, possibly with holes. Deliberately a loose bag rather than a
 * `Partial<PassiveEffect>`: a draft is mid-construction and may be nonsense, and the
 * union's discriminated shape cannot express "half a modifier". Completeness is not
 * this type's job — see `promote`.
 */
export interface DraftEffect {
  kind?: PassiveEffect["kind"];
  target?: string;
  bonusType?: string;
  value?: unknown;
  rank?: number;
  mode?: string;
  grant?: unknown;
  adjust?: unknown;
  text?: string;
  when?: unknown;
}

export interface EffectCandidate {
  entityId: string;
  /** The proposal. `gaps` says what is missing from it. */
  draft: DraftEffect;
  gaps: Gap[];
  agreement: Agreement;
  /** The other producers' differing proposals, when `agreement` is "conflicting". */
  alternatives?: DraftEffect[];
  /** Matching identity — what `reconcile` buckets on, and what a decision points at. */
  key: string;
  /** Grouping shape — what the review UI bulk-accepts by. */
  signature: string;
  evidence: Evidence[];
}

/** One producer's proposals for one entity. */
export interface SourceProposals {
  source: CandidateSource;
  proposals: { draft: DraftEffect; gaps?: Gap[]; evidence?: Omit<Evidence, "source"> }[];
}

// ---------------------------------------------------------------------------
// identity + grouping
// ---------------------------------------------------------------------------

const SKILLS = new Set([
  "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy",
  "intimidation", "medicine", "nature", "occultism", "performance", "religion",
  "society", "stealth", "survival", "thievery",
]);
const SAVES = new Set(["fortitude", "reflex", "will"]);
const RANK_WORD = ["untrained", "trained", "expert", "master", "legendary"] as const;

/**
 * The MATCHING identity of a draft: what makes two producers' proposals "the same
 * effect", so that agreeing on it is corroboration and differing on it is a conflict.
 *
 * The VALUE is deliberately excluded. Two producers both saying "a circumstance bonus
 * to AC" are talking about the same effect; if one says +1 and the other +2, that is
 * exactly the disagreement we want surfaced as a conflict — not filed as two
 * unrelated proposals that both quietly land.
 */
export function effectKey(draft: DraftEffect): string {
  const kind = draft.kind ?? "?";
  const target = draft.target ?? "?";
  switch (kind) {
    case "modifier":
      return `modifier:${target}:${draft.bonusType ?? "?"}`;
    case "proficiency":
      return `proficiency:${target}`;
    case "note":
      return `note:${target}`;
    case "rollAdjust":
      return `rollAdjust:${target}`;
    case "grant": {
      const g = draft.grant as { type?: string } | undefined;
      return `grant:${g?.type ?? "?"}`;
    }
    default:
      return `${kind}:${target}`;
  }
}

/**
 * The GROUPING shape — coarser than the key, because it generalizes the specific stat
 * to its class (`proficiency:thievery` → `proficiency:skill:trained`).
 *
 * This is the number that decides the review UI. Measured over the real corpus, the
 * extracted effects fall into ~57 shapes and the top 20 cover 90% of them — so review
 * is "confirm this shape across these 150 feats", not 150 forms. A `?` marks a gap, so
 * incomplete candidates group together too ("resolve the target for these 300").
 */
export function effectSignature(draft: DraftEffect): string {
  const target = draft.target;
  const cls = target === undefined ? "?" : SKILLS.has(target) ? "skill" : SAVES.has(target) ? "save" : target;
  switch (draft.kind) {
    case "modifier":
      return `modifier:${cls}:${draft.bonusType ?? "?"}`;
    case "proficiency": {
      const word = draft.rank !== undefined ? RANK_WORD[draft.rank] ?? "?" : "?";
      return `proficiency:${cls}:${word}`;
    }
    case "grant": {
      const g = draft.grant as { type?: string } | undefined;
      return `grant:${g?.type ?? "?"}`;
    }
    case undefined:
      return "?";
    default:
      return `${draft.kind}:${cls}`;
  }
}

/** Stable structural serialization — key order must not decide equality. */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(rec[k])}`).join(",")}}`;
}

/** Whether two drafts are the same proposal, values and all. */
export function sameDraft(a: DraftEffect, b: DraftEffect): boolean {
  return stable(a) === stable(b);
}

// ---------------------------------------------------------------------------
// reconciliation
// ---------------------------------------------------------------------------

/**
 * Merge every producer's proposals for ONE entity into candidates, classifying each
 * by how much independent support it has.
 *
 * This is where the second source pays for itself: an effect that the prose parser and
 * Foundry's hand-authored rule element BOTH describe the same way is corroborated by
 * two independent derivations, and can clear in bulk. One that they describe
 * differently is a conflict — and a conflict is the single most informative thing in
 * the queue, because one of the two is wrong and we now know where to look.
 *
 * A candidate that carries gaps stays gapped even when corroborated: agreement about
 * an incomplete effect is still incomplete.
 */
export function reconcile(entityId: string, sources: readonly SourceProposals[]): EffectCandidate[] {
  interface Bucket {
    key: string;
    entries: { source: CandidateSource; draft: DraftEffect; gaps: Gap[]; evidence: Evidence }[];
  }
  const buckets = new Map<string, Bucket>();

  for (const src of sources) {
    for (const p of src.proposals) {
      const key = effectKey(p.draft);
      let b = buckets.get(key);
      if (!b) {
        b = { key, entries: [] };
        buckets.set(key, b);
      }
      b.entries.push({
        source: src.source,
        draft: p.draft,
        gaps: p.gaps ?? [],
        evidence: { source: src.source, ...(p.evidence ?? {}) },
      });
    }
  }

  const out: EffectCandidate[] = [];
  for (const b of buckets.values()) {
    const sourcesSeen = new Set(b.entries.map((e) => e.source));
    const first = b.entries[0]!;
    const gaps = b.entries.flatMap((e) => e.gaps);
    const evidence = b.entries.map((e) => e.evidence);

    if (sourcesSeen.size < 2) {
      out.push({
        entityId,
        draft: first.draft,
        gaps,
        agreement: first.source === "parser" ? "parser-only" : "foundry-only",
        key: b.key,
        signature: effectSignature(first.draft),
        evidence,
      });
      continue;
    }

    // Two producers reached the same key. Do they say the same thing?
    const agreed = b.entries.every((e) => sameDraft(e.draft, first.draft));
    if (agreed) {
      out.push({
        entityId,
        draft: first.draft,
        gaps,
        agreement: "corroborated",
        key: b.key,
        signature: effectSignature(first.draft),
        evidence,
      });
      continue;
    }
    // Conflict: keep every reading. Which one is "primary" is not ours to decide —
    // `promote` refuses a conflict outright, so a human picks.
    const alternatives = b.entries.slice(1).filter((e) => !sameDraft(e.draft, first.draft)).map((e) => e.draft);
    out.push({
      entityId,
      draft: first.draft,
      gaps,
      agreement: "conflicting",
      alternatives,
      key: b.key,
      signature: effectSignature(first.draft),
      evidence,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// promotion — the one gate into content
// ---------------------------------------------------------------------------

export type PromoteResult =
  | { ok: true; effect: PassiveEffect }
  | { ok: false; blocked: "gaps" | "conflict" | "invalid"; issues: string[] };

/**
 * Turn a candidate into a real effect, or say why it cannot be one.
 *
 * `passiveEffectSchema` IS the completeness check — there is deliberately no second
 * "is this draft finished?" predicate to drift out of step with the schema every other
 * consumer validates against. Gaps exist to EXPLAIN a hole to a human; the schema
 * decides whether the machine may proceed.
 *
 * Refuses, always:
 *   • gaps — a draft missing its target would apply a bonus to the wrong stat, or (if
 *     the gap is its condition) turn a situational bonus into a permanent one. A wrong
 *     sheet is worse than an absent effect.
 *   • conflict — two producers disagree; promoting either would be picking a winner by
 *     coin flip.
 */
export function promote(candidate: EffectCandidate): PromoteResult {
  if (candidate.gaps.length > 0) {
    return { ok: false, blocked: "gaps", issues: candidate.gaps.map((g) => `${g.field}: ${g.reason}${g.raw ? ` ("${g.raw}")` : ""}`) };
  }
  if (candidate.agreement === "conflicting") {
    return { ok: false, blocked: "conflict", issues: ["producers disagree; a human must choose"] };
  }
  const parsed = passiveEffectSchema.safeParse(candidate.draft);
  if (!parsed.success) {
    return {
      ok: false,
      blocked: "invalid",
      issues: parsed.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`),
    };
  }
  return { ok: true, effect: parsed.data };
}

/**
 * Whether a candidate may promote with NO human in the loop (owner decision,
 * 2026-07-16): corroborated + complete only. Two independent derivations agreeing is
 * real evidence, and auto-promoting them is what collapses a ~1,000-item queue down to
 * the cases that actually need judgment. Auto-promoted effects stay listed and
 * reversible — off the queue, not out of sight.
 */
export function autoPromotable(candidate: EffectCandidate): boolean {
  return candidate.agreement === "corroborated" && promote(candidate).ok;
}

// ---------------------------------------------------------------------------
// triage — the queue the review UI renders
// ---------------------------------------------------------------------------

export interface Triage {
  /** corroborated + complete: promoted without a human (still listed, still reversible). */
  autoPromote: EffectCandidate[];
  /** Producers disagree. Most informative thing in the queue — review first. */
  conflicts: EffectCandidate[];
  /** Complete but for a hole a human fills. Group by gap kind, not by feat. */
  gapped: EffectCandidate[];
  /** One producer, complete. Ordinary review. */
  review: EffectCandidate[];
  /** Complete-looking but schema-invalid — a producer BUG, not a content problem. */
  invalid: EffectCandidate[];
}

/**
 * Sort candidates into the buckets the review queue is built from. The policy lives
 * here, in core, so the UI renders a decision it did not make.
 */
export function triage(candidates: readonly EffectCandidate[]): Triage {
  const out: Triage = { autoPromote: [], conflicts: [], gapped: [], review: [], invalid: [] };
  for (const c of candidates) {
    if (c.agreement === "conflicting") out.conflicts.push(c);
    else if (c.gaps.length > 0) out.gapped.push(c);
    // `autoPromotable`, not a bare agreement check: it re-validates through the
    // schema, so this bucket cannot claim a candidate that `resolveEntity` would
    // then refuse to promote. One policy, one implementation.
    else if (autoPromotable(c)) out.autoPromote.push(c);
    else if (promote(c).ok) out.review.push(c);
    else out.invalid.push(c);
  }
  return out;
}

/** Group candidates by their bulk-review shape (`effectSignature`), largest first. */
export function groupBySignature(candidates: readonly EffectCandidate[]): { signature: string; candidates: EffectCandidate[] }[] {
  const m = new Map<string, EffectCandidate[]>();
  for (const c of candidates) {
    const list = m.get(c.signature);
    if (list) list.push(c);
    else m.set(c.signature, [c]);
  }
  return [...m.entries()]
    .map(([signature, cs]) => ({ signature, candidates: cs }))
    .sort((a, b) => b.candidates.length - a.candidates.length);
}

// ---------------------------------------------------------------------------
// decisions — the human's output
// ---------------------------------------------------------------------------

/**
 * A recorded human judgment. Points at a candidate by (entityId, key) rather than by
 * identity, because candidates are EPHEMERAL — they are regenerated whenever a
 * producer improves, and a decision must outlive the proposal that prompted it.
 *
 * An `accept` carries the FINAL effect rather than a reference, so it stays meaningful
 * even if the producer later changes its mind — a human said "this is what the feat
 * does", and that survives a re-run. (An `edit` is an accept whose effect differs from
 * what was proposed; the distinction is provenance, not mechanism.)
 */
export interface EffectDecision {
  entityId: string;
  /** The candidate's `key`. Stable across re-runs while the proposal is the same. */
  key: string;
  action: "accept" | "reject" | "edit";
  /** Required for accept/edit — the effect that becomes content. */
  effect?: PassiveEffect;
  by?: string;
  at?: string;
  /** Why — especially for a reject, so a re-run's reviewer is not re-deciding blind. */
  note?: string;
}

export interface ResolveResult {
  /** What becomes the entity's `effects`: decided accepts + auto-promoted candidates. */
  effects: PassiveEffect[];
  /** Candidates still needing a human. */
  pending: EffectCandidate[];
  /** Decisions that matched no candidate — a producer changed its mind since. */
  staleDecisions: EffectDecision[];
}

/**
 * Fold human decisions over an entity's candidates into the effects that reach a sheet.
 *
 * The ONE path from proposal to content, so no consumer can invent its own. A rejected
 * candidate never appears in `effects` and never resurfaces as pending; an accepted one
 * contributes the human's effect, not the producer's draft.
 */
export function resolveEntity(
  candidates: readonly EffectCandidate[],
  decisions: readonly EffectDecision[],
): ResolveResult {
  const byKey = new Map<string, EffectDecision>();
  for (const d of decisions) byKey.set(`${d.entityId} ${d.key}`, d);
  const used = new Set<string>();

  const effects: PassiveEffect[] = [];
  const pending: EffectCandidate[] = [];

  for (const c of candidates) {
    const id = `${c.entityId} ${c.key}`;
    const decision = byKey.get(id);
    if (decision) {
      used.add(id);
      if (decision.action === "reject") continue;
      if (decision.effect) effects.push(decision.effect);
      continue;
    }
    // Undecided: auto-promote if it has earned it, else it waits for a human.
    const p = promote(c);
    if (autoPromotable(c) && p.ok) effects.push(p.effect);
    else pending.push(c);
  }

  const staleDecisions = decisions.filter((d) => !used.has(`${d.entityId} ${d.key}`));
  return { effects, pending, staleDecisions };
}
