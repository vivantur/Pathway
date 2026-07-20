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

import { passiveEffectSchema, effectChoiceSchema, type PassiveEffect, type EffectChoice } from "./passive.js";
import type { GrantedAction } from "./automation.js";

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
  /** A term we have no vocabulary for yet. Also what a bare "against <noun>" scope
   *  becomes once every trait vocabulary has declined it — "against dragons" (a
   *  creature type) and "against magic" (no creature at all) are the same SHAPE, so
   *  the honest claim is that the word is unknown, not what kind of thing it names. */
  | "unresolved-vocabulary"
  /** There is a condition on this effect that we cannot express (see predicate.ts). */
  | "conditional-unmapped"
  /** The prose admits more than one reading. */
  | "ambiguous"
  /** The field simply is not stated. */
  | "missing"
  // The three below SPLIT what `conditional-unmapped` used to absorb (along with
  // `unresolved-vocabulary` above, which already existed and now earns its keep).
  // Measured on the corpus it held 965 gaps meaning six different things, and a
  // reviewer opening one could not tell "go find a word we lack" from "this was never
  // a condition". Each names the BLOCKER and routes to a different fixer — the same
  // argument that split `anaphoric` out of it (see prose.ts, `classifyCondition`).
  //
  /** Momentary combat state — "while raging", "when you are adjacent to an ally".
   *  The deferred half of decision 3; blocked on the model, not on vocabulary. */
  | "combat-state"
  /** Narrowed to an ACTION — "to Climb", "to Recall Knowledge". Blocked on an
   *  `action:` tag namespace, which does not exist yet. */
  | "purpose-scope"
  /** Not a condition at all — "until the start of your next turn" states a DURATION.
   *  Filed as a missing `when` it sent reviewers hunting for a predicate that was
   *  never in the prose; the effect is unconditional and merely temporary. */
  | "duration-not-condition";

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
  /** `"choice"` is a SECOND content type (an `EffectChoice`), not a PassiveEffect kind. */
  kind?: PassiveEffect["kind"] | "choice";
  target?: string;
  bonusType?: string;
  value?: unknown;
  rank?: number;
  mode?: string;
  grant?: unknown;
  adjust?: unknown;
  text?: string;
  when?: unknown;
  /** Present when `kind === "choice"`: the draft `EffectChoice` (flag/prompt/options). */
  choice?: unknown;
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
  /**
   * How many INSTANCES of this effect the entity gets. Almost always 1, and omitted
   * then.
   *
   * Bucketing by `key` is what makes corroboration detectable, but it also collapses
   * a producer that proposed the same thing TWICE — and some content means it twice.
   * Natural Skill grants two identical "become trained in a skill of your choice"
   * elements; folded as one candidate that silently became "choose one skill", which
   * is a wrong sheet of exactly the kind this pipeline exists to prevent.
   *
   * It is the MAX across producers, not the sum: two producers each proposing it once
   * is one instance corroborated, not two of them.
   */
  multiplicity?: number;
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
      // A grant's identity needs its SUB-TARGET, not just its type: a feat that grants
      // resistance to fire AND sonic is two different effects, and keying both as
      // `grant:resistance` would collapse them into one bucket — reconcile would then
      // report a false conflict for two producers that actually AGREE (each proposing the
      // same pair). The discriminator is whichever field names what is granted.
      const g = draft.grant as GrantShape | undefined;
      return `grant:${g?.type ?? "?"}:${grantDiscriminator(g)}`;
    }
    case "choice":
      // A choice is identified by the SET OF OPTIONS it offers, NOT its flag/prompt: the
      // parser cannot know Foundry's flag ("elementalLore"), so keying on the flag would
      // never let the two producers corroborate. The option set ("arcana|nature") is the
      // shared identity; `sameDraft` then checks the option EFFECTS match too.
      return `choice:${choiceOptionSet(draft.choice)}`;
    default:
      return `${kind}:${target}`;
  }
}

/** The sorted, de-duplicated option values of a choice draft — its matching identity. */
function choiceOptionSet(choice: unknown): string {
  const opts = (choice as { options?: { value?: string }[] } | undefined)?.options;
  if (!opts?.length) return "?";
  return [...new Set(opts.map((o) => o.value ?? "?"))].sort().join("|");
}

/** The fields a grant uses to name WHAT it grants, across the grant sub-types. */
interface GrantShape {
  type?: string;
  damageType?: string;
  name?: string;
  to?: string;
  movement?: string;
  trait?: string;
  ref?: string;
}

/** What a grant is OF — damage type, sense name, immunity target, movement, … — for its key. */
function grantDiscriminator(g: GrantShape | undefined): string {
  return g?.damageType ?? g?.name ?? g?.to ?? g?.movement ?? g?.trait ?? g?.ref ?? "?";
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
    case "choice": {
      // Coarser than the key: the KIND of thing being chosen, for bulk review — a skill
      // proficiency choice groups with other skill proficiency choices regardless of which
      // skills. Read the first option's first effect as the representative shape.
      const first = (draft.choice as { options?: { effects?: DraftEffect[] }[] } | undefined)?.options?.[0]?.effects?.[0];
      return `choice:${first ? effectSignature(first) : "?"}`;
    }
    case "rollAdjust":
      // The DIRECTION is part of the shape, not a detail. "A success becomes a critical
      // success" and "a failure becomes a critical failure" are opposite rules and a
      // reviewer confirms them separately — grouping all 131 as `rollAdjust:save` would
      // hand them one bucket containing both, which is exactly what a signature is for
      // avoiding. `mixed` covers a map that does both at once (Dragon's Presence, when
      // one clause states them together).
      return `rollAdjust:${cls}:${rollAdjustDirection(draft.adjust)}`;
    case undefined:
      return "?";
    default:
      return `${draft.kind}:${cls}`;
  }
}

/** Degrees worst → best, for reading a rollAdjust's direction. Mirrors degree.ts. */
const DEGREE_ORDER = ["critical-failure", "failure", "success", "critical-success"];

/**
 * Which way a `rollAdjust` moves the degree: `improve`, `worsen`, `mixed` (a map with
 * entries going both ways), `reroll`, or `?` when it is not stated yet. Signature-only —
 * the resolver reads the payload itself, never this string.
 */
function rollAdjustDirection(adjust: unknown): string {
  const a = adjust as { type?: string; direction?: string; map?: Record<string, string> } | undefined;
  if (a?.type === "degree") return a.direction ?? "?";
  if (a?.type === "reroll") return "reroll";
  if (a?.type !== "degreeMap" || !a.map) return "?";
  let improves = false;
  let worsens = false;
  for (const [from, to] of Object.entries(a.map)) {
    const delta = DEGREE_ORDER.indexOf(to) - DEGREE_ORDER.indexOf(from);
    if (delta > 0) improves = true;
    else if (delta < 0) worsens = true;
  }
  if (improves && worsens) return "mixed";
  if (improves) return "improve";
  if (worsens) return "worsen";
  return "?";
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
  // Choices compare on MEANING, not cosmetics: the parser cannot know Foundry's `flag`
  // or `prompt`, and the option labels are display text — so equality is the set of
  // (option value → its effects), and a flag/prompt/label difference is NOT a conflict.
  if (a.kind === "choice" || b.kind === "choice") return normalizeChoice(a.choice) === normalizeChoice(b.choice);
  return stable(a) === stable(b);
}

/** A choice's meaningful content: options sorted by value, each carrying only value + effects. */
function normalizeChoice(choice: unknown): string {
  const opts = (choice as { options?: { value?: string; effects?: unknown }[] } | undefined)?.options ?? [];
  const norm = opts
    .map((o) => ({ value: o.value ?? "?", effects: o.effects ?? [] }))
    .sort((x, y) => x.value.localeCompare(y.value));
  return stable(norm);
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

    // How many instances the entity gets: the most any ONE producer proposed. Two
    // producers each saying it once is corroboration of a single instance; one
    // producer saying it twice is two instances. See `multiplicity`.
    const perSource = new Map<CandidateSource, number>();
    for (const e of b.entries) perSource.set(e.source, (perSource.get(e.source) ?? 0) + 1);
    const count = Math.max(...perSource.values());
    const mult = count > 1 ? { multiplicity: count } : {};

    if (sourcesSeen.size < 2) {
      out.push({
        entityId,
        draft: first.draft,
        gaps,
        agreement: first.source === "parser" ? "parser-only" : "foundry-only",
        key: b.key,
        signature: effectSignature(first.draft),
        evidence,
        ...mult,
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
        ...mult,
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
      ...mult,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// promotion — the one gate into content
// ---------------------------------------------------------------------------

export type PromoteResult =
  // Exactly ONE of `effect`/`choice` is set, per the candidate's content type. Both are
  // optional so a PassiveEffect caller can keep reading `.effect` unchanged.
  | { ok: true; effect?: PassiveEffect; choice?: EffectChoice }
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
  // A choice validates against its OWN schema — the second content type. Same gate shape:
  // the schema is the completeness check, no separate "is it finished?" predicate.
  if (candidate.draft.kind === "choice") {
    const parsed = effectChoiceSchema.safeParse(candidate.draft.choice);
    if (!parsed.success) {
      return { ok: false, blocked: "invalid", issues: parsed.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`) };
    }
    return { ok: true, choice: parsed.data };
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

/** A queue split into what a human has ruled on and what still awaits them. */
export interface DecidedPartition {
  /** Candidates a decision points at — settled work, out of the active queue. */
  decided: EffectCandidate[];
  /** Candidates nobody has ruled on. What `triage` should bucket for the queue. */
  undecided: EffectCandidate[];
}

/**
 * Split candidates by whether a human has already ruled on them.
 *
 * This lives beside `triage` for the same reason `triage` lives here: the queue's
 * policy is one implementation, and the UI renders a decision it did not make. Without
 * it the review page counted a settled candidate as outstanding forever — 2,044
 * candidates and 343 decisions still read "1,702 need a human", which is precisely the
 * number a reviewer uses to judge whether the work is shrinking.
 *
 * `add` decisions are ignored: they carry a minted key addressing an effect NO producer
 * proposed (see `addEffect`), so they match no candidate by construction. Counting one
 * as decided would be counting it against a row that does not exist.
 */
export function partitionDecided(
  candidates: readonly EffectCandidate[],
  decisions: readonly EffectDecision[],
): DecidedPartition {
  const ruled = new Set<string>();
  for (const d of decisions) if (d.action !== "add") ruled.add(`${d.entityId} ${d.key}`);

  const out: DecidedPartition = { decided: [], undecided: [] };
  for (const c of candidates) {
    if (ruled.has(`${c.entityId} ${c.key}`)) out.decided.push(c);
    else out.undecided.push(c);
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
  /**
   * `accept`/`edit`/`reject` answer a PROPOSAL. `add` does not: it carries an effect a
   * human authored for an entity no producer proposed it for — the prose said something
   * the parser cannot yet read. It is a separate action rather than a `ResolutionPatch`
   * field precisely so the patch surface keeps its property that every edit closes a
   * NAMED gap; an addition closes nothing, and says so.
   */
  action: "accept" | "reject" | "edit" | "add";
  /** Required for accept/edit of a passive-effect candidate — the effect that becomes content. */
  effect?: PassiveEffect;
  /** Required for accept/edit of a CHOICE candidate — the choice that becomes content. */
  choice?: EffectChoice;
  /**
   * A runnable ACTIVITY a human authored for this entity — the Layer-2 payload,
   * beside `effect`'s and `choice`'s Layer-1 ones.
   *
   * ONLY MEANINGFUL WITH `action: "add"`, and that is not a limitation but the
   * shape of the problem: no producer proposes granted actions, so there is no
   * proposal for an accept/reject/edit to answer. The corpus already says as
   * much — 1,544 entities are silent for `action-feat`, i.e. they grant an
   * activity and are correctly absent from a PASSIVE queue. An authored action
   * is how those entities get content at all.
   */
  grantedAction?: GrantedAction;
  by?: string;
  at?: string;
  /** Why — especially for a reject, so a re-run's reviewer is not re-deciding blind. */
  note?: string;
}

export interface ResolveResult {
  /** What becomes the entity's `effects`: decided accepts + auto-promoted candidates. */
  effects: PassiveEffect[];
  /** What becomes the entity's `choices`: decided/auto-promoted choice candidates. */
  choices: EffectChoice[];
  /** Candidates still needing a human. */
  pending: EffectCandidate[];
  /**
   * What becomes the entity's `grantedActions`: authored activities, all of them
   * from `add` decisions. Never auto-promoted, because nothing proposes one.
   */
  grantedActions: GrantedAction[];
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
  const choices: EffectChoice[] = [];
  const pending: EffectCandidate[] = [];
  const grantedActions: GrantedAction[] = [];

  for (const c of candidates) {
    const id = `${c.entityId} ${c.key}`;
    // A candidate standing for N instances contributes N. A decision on it decides
    // all of them: they are the same effect proposed the same way, so a reviewer
    // ruling on Natural Skill's "become trained in a skill of your choice" is
    // ruling on both of that feat's copies at once.
    const times = Math.max(1, Math.floor(c.multiplicity ?? 1));
    const pushEffect = (v: PassiveEffect | undefined): void => {
      if (v === undefined) return;
      for (let i = 0; i < times; i += 1) effects.push(v);
    };
    const pushChoice = (v: EffectChoice | undefined): void => {
      if (v === undefined) return;
      for (let i = 0; i < times; i += 1) choices.push(v);
    };

    const decision = byKey.get(id);
    if (decision) {
      used.add(id);
      if (decision.action === "reject") continue;
      pushEffect(decision.effect);
      pushChoice(decision.choice);
      continue;
    }
    // Undecided: auto-promote if it has earned it, else it waits for a human.
    const p = promote(c);
    if (autoPromotable(c) && p.ok) {
      pushEffect(p.effect);
      pushChoice(p.choice);
    } else pending.push(c);
  }

  // Human ADDITIONS answer no candidate, so they are folded in on their own — and must
  // never be read as stale. `staleDecisions` means "a producer changed its mind since a
  // human ruled"; an addition was never tied to a proposal, so the filter below would
  // drop every one of them silently on the very next run.
  for (const d of decisions) {
    if (d.action !== "add") continue;
    if (d.effect) effects.push(d.effect);
    if (d.choice) choices.push(d.choice);
    // A granted action arrives ONLY this way: nothing proposes one, so no candidate
    // branch above could ever produce it.
    if (d.grantedAction) grantedActions.push(d.grantedAction);
  }

  const staleDecisions = decisions.filter((d) => d.action !== "add" && !used.has(`${d.entityId} ${d.key}`));
  return { effects, choices, pending, grantedActions, staleDecisions };
}

// ---------------------------------------------------------------------------
// silence — the entities that never reach the queue at all
// ---------------------------------------------------------------------------
//
// THE QUEUE IS NOT THE PROBLEM. It holds 1,820 candidates over 1,096 feats; the
// corpus has 6,116. The other 5,020 propose NOTHING, and with no view of them the
// review page silently reports 18% of the work as if it were all of it. Naming why
// each one is silent is the same discipline as `foundry.ts`'s unsupported reasons:
// coverage is not the point, knowing what the remainder IS is the point.
//
// Measured 2026-07-18 over the real corpus: 1,544 action-feat only, 1,370
// all-unsupported only, 348 both, 1,758 with no signal at all.

/**
 * Why an entity produced no candidates. Precedence is `action-feat` →
 * `all-unsupported` → `no-producer-signal`, and only 348 entities are ambiguous
 * between the first two, so the ordering costs almost nothing in practice.
 *
 * `action-feat` wins when both apply because it says the entity is in the WRONG
 * PIPELINE — a different thing to do about it — whereas the blockers say the passive
 * pipeline needs to grow. The blockers are kept either way, so nothing is lost.
 */
export type SilenceReason =
  /**
   * The entity carries an action cost, so it grants an ACTIVITY, not a passive
   * (owner-supplied identifier, 2026-07-18: an action feat is flagged as such in the
   * rules text — "[two-actions]" on Timber Sentinel). Correctly absent from a passive
   * queue; real work for the granted-action pass, which is why it is named and not
   * just filtered away.
   */
  | "action-feat"
  /** A producer had rule elements for it and every one mapped to `unsupported`. */
  | "all-unsupported"
  /** No producer saw anything: not ingested, and the prose yielded nothing. */
  | "no-producer-signal";

/** One blocker and how many of the entity's elements hit it. */
export interface SilenceBlocker {
  reason: string;
  count: number;
}

/** An entity that proposed nothing, and what we can say about why. */
export interface SilentEntity {
  entityId: string;
  reason: SilenceReason;
  /** The action cost, when that is what makes it silent — shown by the UI. */
  actionCost?: string;
  /**
   * The named blockers from a producer's unsupported elements, when it had any.
   * Present even for an `action-feat`, so the roadmap tally stays complete.
   */
  blockers?: SilenceBlocker[];
}

/**
 * What a caller must supply per entity. Deliberately NOT a content type: core does
 * not hold the corpus, and the caller (the build script) already has it. Keeping
 * this a plain bag is what lets the same policy classify feats today and any other
 * entity kind later without core learning either one's schema.
 */
export interface SilenceInput {
  entityId: string;
  /** Present ⇒ the entity grants an activity. Any truthy cost counts. */
  actionCost?: string | null;
  /** The `reason` of each element a producer could not map, in order. */
  unsupportedReasons?: readonly string[];
}

export interface SilenceReport {
  silent: SilentEntity[];
  /**
   * Entities that DID propose candidates but carry an action cost — so a granted
   * activity is very likely being modelled as a passive effect. Measured at 296.
   * NOT filtered out of the queue: this names a suspicion for a human, and silently
   * dropping real candidates on a heuristic would be the guessing the pipeline
   * refuses.
   */
  actionFeatsInQueue: string[];
}

/**
 * Classify every entity that produced no candidates, plus flag the ones whose
 * candidates look like they belong to the action pipeline instead.
 *
 * The policy lives here, in core, for the same reason `triage` does: the UI should
 * render a decision it did not make.
 */
export function classifySilence(
  entities: readonly SilenceInput[],
  candidates: readonly EffectCandidate[],
): SilenceReport {
  const proposed = new Set(candidates.map((c) => c.entityId));
  const silent: SilentEntity[] = [];
  const actionFeatsInQueue: string[] = [];

  for (const e of entities) {
    const isAction = e.actionCost !== undefined && e.actionCost !== null && e.actionCost !== "";
    if (proposed.has(e.entityId)) {
      if (isAction) actionFeatsInQueue.push(e.entityId);
      continue;
    }

    const blockers = tallyBlockers(e.unsupportedReasons);
    const reason: SilenceReason = isAction
      ? "action-feat"
      : blockers.length > 0
        ? "all-unsupported"
        : "no-producer-signal";

    silent.push({
      entityId: e.entityId,
      reason,
      ...(isAction && e.actionCost ? { actionCost: e.actionCost } : {}),
      ...(blockers.length > 0 ? { blockers } : {}),
    });
  }
  return { silent, actionFeatsInQueue };
}

/** Count each distinct unsupported reason, largest first. */
function tallyBlockers(reasons: readonly string[] | undefined): SilenceBlocker[] {
  if (!reasons?.length) return [];
  const m = new Map<string, number>();
  for (const r of reasons) m.set(r, (m.get(r) ?? 0) + 1);
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

/** Group silent entities by their reason, largest group first — what the UI renders. */
export function groupSilence(silent: readonly SilentEntity[]): { reason: SilenceReason; entities: SilentEntity[] }[] {
  const m = new Map<SilenceReason, SilentEntity[]>();
  for (const s of silent) {
    const list = m.get(s.reason);
    if (list) list.push(s);
    else m.set(s.reason, [s]);
  }
  return [...m.entries()]
    .map(([reason, entities]) => ({ reason, entities }))
    .sort((a, b) => b.entities.length - a.entities.length);
}

/**
 * The blocker tally across every silent entity — the roadmap, restated from the
 * side of what is MISSING rather than what was mapped. Largest first.
 */
export function silenceBlockerTally(silent: readonly SilentEntity[]): SilenceBlocker[] {
  const m = new Map<string, number>();
  for (const s of silent) for (const b of s.blockers ?? []) m.set(b.reason, (m.get(b.reason) ?? 0) + b.count);
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}
