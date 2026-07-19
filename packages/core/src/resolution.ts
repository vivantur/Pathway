// Gap and conflict RESOLUTION — the editor's backend.
//
// `candidate.ts` decides what needs a human. This module is what the human does
// about it. It is the only place a gapped or conflicting candidate can become a
// decision, so the refusals in `promote` stay the last word everywhere else.
//
//   candidate (gapped/conflicting) ──resolve──► EffectDecision ──resolveEntity──► content
//
// PURE, AND STORAGE-AGNOSTIC LIKE ITS SIBLING. Functions over plain values; the
// UI holds the state and the file/DB edge lives outside. Nothing here reads or
// writes anything.
//
// WHY THE SURFACE IS THIS NARROW. Measured over the real corpus (1,820 candidates,
// 2026-07-18) EVERY gap is on one of two fields: `when` (956) and `target` (110).
// So this is not a general draft editor — the general one is the homebrew authoring
// surface. It is a two-field editor plus a conflict picker, and keeping it that
// narrow is what makes "did this patch close the gap?" answerable mechanically
// instead of by inference.
//
// NO PF2e RULES LIVE HERE. Filling a gap is a human's rules judgment; this module
// only carries it, checks it against the schema, and records who made it.

import {
  promote,
  effectKey,
  effectSignature,
  type DraftEffect,
  type EffectCandidate,
  type EffectDecision,
  type Gap,
} from "./candidate.js";
import { predicateSchema, type Predicate } from "./predicate.js";
import { passiveEffectSchema, effectChoiceSchema } from "./passive.js";

// ---------------------------------------------------------------------------
// the patch
// ---------------------------------------------------------------------------

/**
 * A human's fill for a candidate's holes. Deliberately NOT a `Partial<DraftEffect>`:
 * the measured gap surface is two fields, and a type that admits any field would
 * invite the review queue to become a second authoring surface — where an edit is
 * no longer checkable against "which gap did this close?".
 *
 * Everything is optional because a candidate may be gapped on either field, both,
 * or (for a conflict) neither.
 */
export interface ResolutionPatch {
  /** The condition, as a real predicate tree. Fills a `when` gap. */
  when?: Predicate;
  /** The stat the effect applies to. Fills a `target` gap (the anaphora's referent). */
  target?: string;
  /**
   * Drop the condition entirely — the prose's clause is NOT a condition on this
   * effect (the parser over-scoped it, or it was duration text). Distinct from
   * leaving `when` unset, which means "still unresolved": this says a human read
   * the prose and ruled the effect unconditional.
   */
  unconditional?: boolean;
}

/** Whether a patch says anything at all. */
export function isEmptyPatch(patch: ResolutionPatch): boolean {
  return patch.when === undefined && patch.target === undefined && !patch.unconditional;
}

// ---------------------------------------------------------------------------
// applying a resolution
// ---------------------------------------------------------------------------

/**
 * The fields a patch can fill, and therefore the gaps it can close. A gap on any
 * OTHER field is untouchable here by construction — see `ResolutionPatch`.
 */
const PATCHABLE_FIELDS = new Set(["when", "target"]);

/**
 * Which gap fields a patch supplies. `unconditional` closes a `when` gap just as a
 * predicate does: both are a human's ruling about the condition, and the ruling
 * "there isn't one" is as complete an answer as a tree.
 */
function suppliedFields(patch: ResolutionPatch): Set<string> {
  const s = new Set<string>();
  if (patch.when !== undefined || patch.unconditional) s.add("when");
  if (patch.target !== undefined) s.add("target");
  return s;
}

/**
 * Apply a human's fill to a candidate, returning the patched candidate.
 *
 * THE GAP-CLEARING RULE IS MECHANICAL, ON PURPOSE: a gap on field F clears when
 * the patch supplies F. Nothing here inspects the VALUE to judge whether it is a
 * good answer — a predicate that is well-formed but wrong is a rules mistake, and
 * this module cannot detect rules mistakes without implementing rules. Inferring
 * "that fill looks insufficient" would be exactly the guessing the pipeline
 * refuses. The schema still gets the last word in `promote`.
 *
 * Gaps on fields the patch does not supply SURVIVE, so a candidate gapped on both
 * `when` and `target` and patched with only one stays gapped — and stays
 * unpromotable — rather than half-resolving into content.
 *
 * `key` and `signature` are recomputed so the patched candidate reports its true
 * identity — the editor regroups by signature as fills land.
 *
 * CAREFUL: that recomputed key is for DISPLAY, and is NOT what a decision is
 * addressed by. See `resolveGaps`.
 */
export function applyResolution(candidate: EffectCandidate, patch: ResolutionPatch): EffectCandidate {
  const supplied = suppliedFields(patch);
  const draft: DraftEffect = { ...candidate.draft };

  if (patch.target !== undefined) draft.target = patch.target;
  if (patch.unconditional) delete draft.when;
  else if (patch.when !== undefined) draft.when = patch.when;

  const gaps = candidate.gaps.filter((g) => !supplied.has(g.field));

  return {
    ...candidate,
    draft,
    gaps,
    key: effectKey(draft),
    signature: effectSignature(draft),
  };
}

// ---------------------------------------------------------------------------
// field-level issues — what the editor points at
// ---------------------------------------------------------------------------

/**
 * One thing still wrong with a candidate, ADDRESSED TO A FIELD so an editor can
 * highlight it. `promote` returns prose strings for a log; this returns the same
 * facts keyed by field for a form.
 */
export interface ResolutionIssue {
  /** The draft field at fault, or `(root)` when the schema blames the whole shape. */
  field: string;
  message: string;
  /** `gap` — a producer flagged a hole. `schema` — the value present is not valid.
   *  `conflict` — producers disagree and no reading has been picked. */
  source: "gap" | "schema" | "conflict";
}

/** A gap rendered as an issue, keeping the reviewer-facing raw quote. */
function gapIssue(g: Gap): ResolutionIssue {
  return {
    field: g.field,
    message: `${g.reason}${g.raw ? `: "${g.raw}"` : ""}`,
    source: "gap",
  };
}

/**
 * Everything standing between this candidate and content, field by field.
 *
 * Deliberately derived from the SAME gates as `promote` (the gaps list, the
 * conflict rule, and the Zod schemas) rather than re-deciding completeness — a
 * second opinion here would eventually disagree with the one that actually
 * governs, and the editor would enable a save that `promote` then refuses.
 * Empty ⇔ `promote(candidate).ok`, and a test pins that equivalence.
 */
export function resolutionIssues(candidate: EffectCandidate): ResolutionIssue[] {
  const issues: ResolutionIssue[] = candidate.gaps.map(gapIssue);

  if (candidate.agreement === "conflicting") {
    issues.push({
      field: "(root)",
      message: "producers disagree; pick a reading or author one",
      source: "conflict",
    });
  }

  // Schema issues only once the holes are filled: a draft missing its target fails
  // the schema too, and reporting both would show the reviewer the same problem
  // twice in two vocabularies.
  if (issues.length === 0) {
    const schema = candidate.draft.kind === "choice" ? effectChoiceSchema : passiveEffectSchema;
    const subject = candidate.draft.kind === "choice" ? candidate.draft.choice : candidate.draft;
    const parsed = schema.safeParse(subject);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        issues.push({
          field: i.path.length ? i.path.join(".") : "(root)",
          message: i.message,
          source: "schema",
        });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// producing a decision
// ---------------------------------------------------------------------------

/** Who made a call and when — recorded on every decision this module emits. */
export interface Attribution {
  by?: string;
  at?: string;
  note?: string;
}

export type ResolveOutcome =
  | { ok: true; decision: EffectDecision }
  | { ok: false; issues: ResolutionIssue[] };

/**
 * Fill a candidate's gaps and emit the decision that carries it into content.
 *
 * Refuses whenever the patched candidate would not promote, and hands back the
 * field-level issues so the editor can say WHERE. This is the gate: a gapped
 * candidate cannot reach a decision except by actually closing its gaps.
 *
 * The action is `edit` when the human changed the draft and `accept` when the
 * patch was empty (they endorsed the proposal as-is) — the distinction is
 * provenance, which is exactly what `EffectDecision` says it is for.
 *
 * THE DECISION IS ADDRESSED BY THE ORIGINAL CANDIDATE'S KEY, NOT THE PATCHED ONE.
 * A decision points at the PROPOSAL it answers, and next run the producers emit
 * that same gapped proposal again — so it must be found under the key it will
 * have then. Filling a `target` changes the key (`modifier:?:circumstance` →
 * `modifier:stealth:circumstance`), so keying by the patched draft would send
 * every one of the corpus's 110 target-gap decisions to `staleDecisions` on the
 * next run: the human's answer silently dropped and the candidate back in the
 * queue as pending. A `when` fill does not change the key, which is exactly why
 * this is the kind of bug that hides.
 */
export function resolveGaps(
  candidate: EffectCandidate,
  patch: ResolutionPatch,
  attribution: Attribution = {},
): ResolveOutcome {
  const patched = applyResolution(candidate, patch);
  const result = promote(patched);
  if (!result.ok) return { ok: false, issues: resolutionIssues(patched) };

  return {
    ok: true,
    decision: {
      entityId: candidate.entityId,
      key: candidate.key,
      action: isEmptyPatch(patch) ? "accept" : "edit",
      ...(result.effect ? { effect: result.effect } : {}),
      ...(result.choice ? { choice: result.choice } : {}),
      ...attribution,
    },
  };
}

// ---------------------------------------------------------------------------
// conflicts
// ---------------------------------------------------------------------------

/**
 * One producer's reading of a conflicted candidate, paired with who proposed it.
 * The editor renders these side by side; the human picks one or authors a third.
 */
export interface ConflictReading {
  draft: DraftEffect;
  /** Which producers proposed exactly this reading. */
  sources: string[];
  /** Index into `readings` — what `resolveConflict` takes. */
  index: number;
}

/**
 * Every distinct reading of a conflicted candidate, primary first.
 *
 * The evidence list is positional against `[draft, ...alternatives]` only when no
 * two producers agreed, which is precisely the conflicting case — so a reading's
 * sources come from the same position. When that correspondence does not hold the
 * sources are simply omitted rather than guessed: attributing a reading to the
 * wrong producer would send a reviewer to check the wrong source text.
 */
export function conflictReadings(candidate: EffectCandidate): ConflictReading[] {
  const drafts = [candidate.draft, ...(candidate.alternatives ?? [])];
  const aligned = candidate.evidence.length === drafts.length;
  return drafts.map((draft, index) => ({
    draft,
    sources: aligned ? [candidate.evidence[index]!.source] : [],
    index,
  }));
}

/**
 * Resolve a conflict by picking a reading — or by authoring one neither producer
 * proposed, which is the case that matters when both are wrong.
 *
 * Clearing `agreement` is the point: a conflict blocks `promote` outright, and a
 * human choosing between the readings is exactly the input that unblocks it. The
 * chosen draft still has to pass the schema, and still has to have no gaps, so
 * picking a reading is not a way around either gate.
 */
export function resolveConflict(
  candidate: EffectCandidate,
  choice: { index: number } | { draft: DraftEffect },
  attribution: Attribution = {},
): ResolveOutcome {
  let draft: DraftEffect;
  if ("draft" in choice) {
    draft = choice.draft;
  } else {
    const readings = conflictReadings(candidate);
    const picked = readings[choice.index];
    if (!picked) {
      return {
        ok: false,
        issues: [{ field: "(root)", message: `no reading at index ${choice.index}`, source: "conflict" }],
      };
    }
    draft = picked.draft;
  }

  // The picked reading becomes THE draft, and the disagreement is over: a human
  // ruled. `alternatives` goes with it — keeping them would leave a candidate that
  // still looks contested after it has been settled.
  const settled: EffectCandidate = {
    ...candidate,
    draft,
    agreement: "corroborated",
    key: effectKey(draft),
    signature: effectSignature(draft),
  };
  delete settled.alternatives;

  const result = promote(settled);
  if (!result.ok) return { ok: false, issues: resolutionIssues(settled) };

  return {
    ok: true,
    decision: {
      // The original key, for the same reason as `resolveGaps`: an authored third
      // reading can name a different target, and the decision still has to be found
      // under the key the conflicting proposal will be regenerated with.
      entityId: candidate.entityId,
      key: candidate.key,
      // Picking a producer's reading is an accept OF that reading; authoring a third
      // is an edit. Same provenance distinction as `resolveGaps`.
      action: "index" in choice ? "accept" : "edit",
      ...(result.effect ? { effect: result.effect } : {}),
      ...(result.choice ? { choice: result.choice } : {}),
      ...attribution,
    },
  };
}

// ---------------------------------------------------------------------------
// rejection — including "this is not a Layer-1 passive"
// ---------------------------------------------------------------------------

/**
 * Why a candidate was rejected. A closed vocabulary, because "rejected" alone
 * loses the single most useful distinction in this queue: WRONG versus REAL BUT
 * NOT EXPRESSIBLE HERE.
 *
 * Measured, 109 of the 956 `when` gaps are DURATION text ("until the start of your
 * next turn") — a category error, since a Layer-1 passive has no duration. Those
 * are not bad proposals; they are Layer-2 applied effects that the parser reached
 * from a passive's clause. Filing them as `wrong-reading` would tell a future
 * reviewer the prose was misread, and filing them as gaps leaves a reviewer trying
 * to invent a predicate for a duration. `not-a-passive` says the true thing, and
 * makes the set queryable when Layer 2 authoring comes for them.
 */
export type RejectReason =
  /** Real content, but a duration/triggered effect — Layer 2's, not a passive. */
  | "not-a-passive"
  /** The producer misread the prose; the effect it describes is not there. */
  | "wrong-reading"
  /** Real and expressible, but out of the current scope to model. */
  | "out-of-scope"
  /** Already covered by another candidate on the same entity. */
  | "duplicate";

/**
 * Reject a candidate, with a reason. Always succeeds: a human may reject anything,
 * including a candidate that would have promoted cleanly.
 *
 * The reason rides in the decision's existing `note` (prefixed, so it survives the
 * round trip and stays readable) rather than as a new required field, keeping
 * `EffectDecision` backward compatible — the fold-in and every shipped decision
 * file keep working untouched.
 */
export function rejectCandidate(
  candidate: EffectCandidate,
  reason: RejectReason,
  attribution: Attribution = {},
): EffectDecision {
  const note = attribution.note ? `${reason}: ${attribution.note}` : reason;
  return {
    entityId: candidate.entityId,
    key: candidate.key,
    action: "reject",
    ...attribution,
    note,
  };
}

/** Read a `RejectReason` back off a decision, if it carries one. */
export function rejectReasonOf(decision: EffectDecision): RejectReason | undefined {
  if (decision.action !== "reject" || !decision.note) return undefined;
  const head = decision.note.split(":", 1)[0]!.trim();
  return REJECT_REASONS.has(head) ? (head as RejectReason) : undefined;
}

const REJECT_REASONS: ReadonlySet<string> = new Set<RejectReason>([
  "not-a-passive",
  "wrong-reading",
  "out-of-scope",
  "duplicate",
]);

// ---------------------------------------------------------------------------
// bulk resolution
// ---------------------------------------------------------------------------

/** A candidate a bulk patch could not be applied to, and why. */
export interface BulkRefusal {
  candidate: EffectCandidate;
  issues: ResolutionIssue[];
}

export interface BulkResult {
  decisions: EffectDecision[];
  refused: BulkRefusal[];
}

/**
 * Apply ONE patch across many candidates — the multi-select path.
 *
 * This is the queue's only real leverage, and the measurement says why it has to be
 * human-selected rather than automatic. The `when` gaps have 504 distinct raw
 * phrasings; the top 20 cover 16.5% and 319 occur exactly once, so no grouping of
 * the QUESTION collapses this queue. What repeats is the ANSWER: many phrasings
 * resolve to the same predicate. So the human selects the set and this applies the
 * fill across it.
 *
 * PARTIAL BY DESIGN, NEVER FORCED. A candidate the patch does not complete is
 * REFUSED with its issues, not approximated and not silently dropped — the caller
 * gets decisions for the ones that worked and an addressable list of the ones that
 * did not. Forcing a shared fill onto a candidate whose remaining gap it never
 * addressed is precisely how a bulk action produces wrong sheets at scale.
 */
export function applyBulk(
  candidates: readonly EffectCandidate[],
  patch: ResolutionPatch,
  attribution: Attribution = {},
): BulkResult {
  const decisions: EffectDecision[] = [];
  const refused: BulkRefusal[] = [];

  for (const c of candidates) {
    const outcome = resolveGaps(c, patch, attribution);
    if (outcome.ok) decisions.push(outcome.decision);
    else refused.push({ candidate: c, issues: outcome.issues });
  }
  return { decisions, refused };
}

/**
 * Whether a patch would fully resolve a candidate — the editor's enablement check,
 * so a bulk action can show "42 of 51 selected" BEFORE it is taken rather than
 * reporting 9 refusals afterwards.
 */
export function patchResolves(candidate: EffectCandidate, patch: ResolutionPatch): boolean {
  return promote(applyResolution(candidate, patch)).ok;
}

// ---------------------------------------------------------------------------
// validation helper for the editor's predicate input
// ---------------------------------------------------------------------------

export type PredicateParse =
  | { ok: true; predicate: Predicate }
  | { ok: false; issues: ResolutionIssue[] };

/**
 * Validate a predicate the editor built, before it reaches a patch. The editor is
 * a form over a recursive tree and can hold a half-built node; this says whether
 * it is yet a real predicate, in the same issue shape as everything else here.
 */
export function parsePredicate(value: unknown): PredicateParse {
  const parsed = predicateSchema.safeParse(value);
  if (parsed.success) return { ok: true, predicate: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({
      field: i.path.length ? `when.${i.path.join(".")}` : "when",
      message: i.message,
      source: "schema" as const,
    })),
  };
}
