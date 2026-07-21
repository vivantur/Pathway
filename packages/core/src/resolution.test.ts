import { describe, expect, it } from "vitest";
import {
  addEffect,
  addGrantedAction,
  addRider,
  applyBulk,
  applyResolution,
  conflictReadings,
  isAddedKey,
  isEmptyPatch,
  parsePredicate,
  patchResolves,
  rejectCandidate,
  rejectReasonOf,
  resolutionIssues,
  resolveConflict,
  resolveGaps,
} from "./resolution.js";
import { effectKey, effectSignature, promote, resolveEntity, type DraftEffect, type EffectCandidate, type EffectDecision } from "./candidate.js";

const lit = (value: number) => ({ kind: "lit", value });

/** A modifier gapped on `when` — the corpus's dominant shape (956 of 1,066 gaps). */
const gappedWhen: DraftEffect = { kind: "modifier", target: "will", bonusType: "status", value: lit(1) };
/** Gapped on `target` — the anaphoric pronoun case ("the check"). */
const gappedTarget: DraftEffect = { kind: "modifier", bonusType: "circumstance", value: lit(2) };

const cand = (over: Partial<EffectCandidate> = {}): EffectCandidate => {
  const draft = over.draft ?? gappedWhen;
  return {
    entityId: "feat-x",
    draft,
    gaps: [],
    agreement: "parser-only",
    key: effectKey(draft),
    signature: effectSignature(draft),
    evidence: [{ source: "parser" }],
    ...over,
  };
};

const whenGapped = (): EffectCandidate =>
  cand({ draft: gappedWhen, gaps: [{ field: "when", reason: "conditional-unmapped", raw: "against death effects" }] });

const targetGapped = (): EffectCandidate =>
  cand({ draft: gappedTarget, gaps: [{ field: "target", reason: "anaphoric", raw: "the check" }] });

const deathTrait = { tag: "effect:trait:death" };

describe("applyResolution — the gap-clearing rule", () => {
  it("clears a gap on the field the patch supplies, and patches the draft", () => {
    const out = applyResolution(whenGapped(), { when: deathTrait });
    expect(out.gaps).toEqual([]);
    expect(out.draft.when).toEqual(deathTrait);
  });

  it("KEEPS gaps on fields the patch does not supply, so a half-fill stays unpromotable", () => {
    // The trap this prevents: a candidate gapped on both fields, patched with one,
    // silently promoting with the other hole still open — a wrong sheet at scale.
    const both = cand({
      draft: gappedTarget,
      gaps: [
        { field: "when", reason: "conditional-unmapped", raw: "against undead" },
        { field: "target", reason: "anaphoric", raw: "the check" },
      ],
    });
    const out = applyResolution(both, { target: "will" });
    expect(out.gaps.map((g) => g.field)).toEqual(["when"]);
    expect(promote(out).ok).toBe(false);
  });

  it("does not judge the VALUE of a fill — a well-formed but wrong predicate still clears", () => {
    // Detecting "that's the wrong condition" would require implementing the rules.
    // The schema gets the last word; rules correctness is the human's.
    const out = applyResolution(whenGapped(), { when: { tag: "effect:trait:fire" } });
    expect(out.gaps).toEqual([]);
    expect(promote(out).ok).toBe(true);
  });

  it("`unconditional` closes a when-gap and REMOVES the condition", () => {
    const withWhen = cand({
      draft: { ...gappedWhen, when: deathTrait },
      gaps: [{ field: "when", reason: "ambiguous", raw: "sometimes" }],
    });
    const out = applyResolution(withWhen, { unconditional: true });
    expect(out.gaps).toEqual([]);
    expect(out.draft.when).toBeUndefined();
  });

  it("recomputes key and signature, because a decision points at a candidate BY key", () => {
    // A stale key would file the decision against the wrong candidate next run.
    const out = applyResolution(targetGapped(), { target: "stealth" });
    expect(out.key).toBe("modifier:stealth:circumstance");
    expect(out.signature).toBe("modifier:skill:circumstance");
    expect(out.key).not.toBe(targetGapped().key);
  });

  it("does not mutate the input candidate", () => {
    const c = whenGapped();
    applyResolution(c, { when: deathTrait });
    expect(c.gaps).toHaveLength(1);
    expect(c.draft.when).toBeUndefined();
  });
});

describe("resolutionIssues — addressed to a field", () => {
  it("is empty exactly when promote succeeds", () => {
    // The equivalence that keeps the editor from enabling a save promote then refuses.
    const cases = [
      whenGapped(),
      targetGapped(),
      cand({ agreement: "conflicting", alternatives: [gappedTarget] }),
      cand(),
      cand({ draft: { kind: "modifier", target: "ac" } }), // schema-invalid: no value
    ];
    for (const c of cases) {
      expect(resolutionIssues(c).length === 0).toBe(promote(c).ok);
    }
  });

  it("names the gapped field, carrying the reviewer's raw quote", () => {
    const [issue] = resolutionIssues(whenGapped());
    expect(issue).toMatchObject({ field: "when", source: "gap" });
    expect(issue!.message).toContain("against death effects");
  });

  it("reports a conflict at the root", () => {
    const c = cand({ agreement: "conflicting", alternatives: [gappedTarget] });
    expect(resolutionIssues(c).some((i) => i.source === "conflict")).toBe(true);
  });

  it("does not double-report a hole as both a gap and a schema error", () => {
    // A draft missing its target fails the schema too; showing both would be the
    // same problem twice in two vocabularies.
    const issues = resolutionIssues(targetGapped());
    expect(issues).toHaveLength(1);
    expect(issues[0]!.source).toBe("gap");
  });

  it("surfaces schema issues once the gaps are closed", () => {
    const bad = cand({ draft: { kind: "modifier", target: "ac", bonusType: "circumstance" } });
    const issues = resolutionIssues(bad);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.source === "schema")).toBe(true);
  });
});

describe("resolveGaps — the gate into a decision", () => {
  it("emits an `edit` decision carrying the FINAL effect", () => {
    const out = resolveGaps(whenGapped(), { when: deathTrait }, { by: "sam" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.decision.action).toBe("edit");
    expect(out.decision.by).toBe("sam");
    expect(out.decision.effect).toMatchObject({ kind: "modifier", target: "will", when: deathTrait });
  });

  it("records an empty patch as `accept` — endorsing the proposal as-is", () => {
    const out = resolveGaps(cand(), {});
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.decision.action).toBe("accept");
  });

  it("REFUSES a candidate whose gaps the patch did not close, with the issues", () => {
    const out = resolveGaps(whenGapped(), { target: "will" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.issues.map((i) => i.field)).toContain("when");
  });

  it("addresses the decision by the ORIGINAL key, not the patched one", () => {
    // REGRESSION. Filling a `target` changes the key, and next run the producers
    // re-emit the GAPPED proposal under the OLD key. Keying by the patched draft
    // sent every target-gap decision (110 in the corpus) to `staleDecisions` — the
    // human's answer dropped, the candidate back in the queue. A `when` fill does
    // not change the key, which is why this hid.
    const c = targetGapped();
    const out = resolveGaps(c, { target: "stealth" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.decision.key).toBe("modifier:?:circumstance");
    expect(out.decision.effect).toMatchObject({ target: "stealth" });

    // ...and it survives the round trip through the fold-in.
    const folded = resolveEntity([targetGapped()], [out.decision]);
    expect(folded.staleDecisions).toEqual([]);
    expect(folded.effects[0]).toMatchObject({ target: "stealth" });
  });
});

describe("conflicts", () => {
  const readingA: DraftEffect = { kind: "grant", grant: { type: "resistance", damageType: "mental", value: lit(2) } };
  const readingB: DraftEffect = { kind: "grant", grant: { type: "resistance", damageType: "mental", value: lit(3) } };
  const conflicted = (): EffectCandidate =>
    cand({
      draft: readingA,
      agreement: "conflicting",
      alternatives: [readingB],
      evidence: [{ source: "parser" }, { source: "foundry" }],
    });

  it("lists every reading with the producer that proposed it, primary first", () => {
    const readings = conflictReadings(conflicted());
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({ draft: readingA, sources: ["parser"], index: 0 });
    expect(readings[1]).toMatchObject({ draft: readingB, sources: ["foundry"], index: 1 });
  });

  it("omits sources rather than guessing when evidence does not align", () => {
    // Attributing a reading to the wrong producer sends a reviewer to the wrong text.
    const c = cand({ draft: readingA, agreement: "conflicting", alternatives: [readingB], evidence: [{ source: "parser" }] });
    expect(conflictReadings(c).every((r) => r.sources.length === 0)).toBe(true);
  });

  it("picking a reading clears the conflict and promotes it", () => {
    const out = resolveConflict(conflicted(), { index: 1 }, { by: "sam" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.decision.action).toBe("accept");
    expect(out.decision.effect).toMatchObject({ grant: { value: lit(3) } });
  });

  it("authoring a third reading is an `edit`", () => {
    const authored: DraftEffect = { kind: "grant", grant: { type: "resistance", damageType: "mental", value: lit(5) } };
    const out = resolveConflict(conflicted(), { draft: authored });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.decision.action).toBe("edit");
    expect(out.decision.effect).toMatchObject({ grant: { value: lit(5) } });
  });

  it("refuses an out-of-range index instead of picking something", () => {
    const out = resolveConflict(conflicted(), { index: 7 });
    expect(out.ok).toBe(false);
  });

  it("picking a reading is NOT a way around the gap or schema gates", () => {
    const gappedConflict = cand({
      draft: gappedTarget,
      agreement: "conflicting",
      alternatives: [gappedWhen],
      gaps: [{ field: "target", reason: "anaphoric", raw: "the check" }],
      evidence: [{ source: "parser" }, { source: "foundry" }],
    });
    const out = resolveConflict(gappedConflict, { index: 0 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.issues.some((i) => i.field === "target")).toBe(true);
  });
});

describe("rejection with a reason", () => {
  it("round-trips the reason through the decision's note", () => {
    const d = rejectCandidate(whenGapped(), "not-a-passive");
    expect(d.action).toBe("reject");
    expect(rejectReasonOf(d)).toBe("not-a-passive");
  });

  it("keeps the human's note alongside the reason", () => {
    const d = rejectCandidate(whenGapped(), "not-a-passive", { by: "sam", note: "duration, belongs to Layer 2" });
    expect(rejectReasonOf(d)).toBe("not-a-passive");
    expect(d.note).toContain("Layer 2");
  });

  it("returns undefined for a reasonless or non-reject decision", () => {
    expect(rejectReasonOf({ entityId: "f", key: "k", action: "reject" })).toBeUndefined();
    expect(rejectReasonOf({ entityId: "f", key: "k", action: "reject", note: "just wrong" })).toBeUndefined();
    expect(rejectReasonOf({ entityId: "f", key: "k", action: "accept", note: "not-a-passive" })).toBeUndefined();
  });

  it("a rejected candidate never reaches content", () => {
    const c = whenGapped();
    const { effects, pending } = resolveEntity([c], [rejectCandidate(c, "not-a-passive")]);
    expect(effects).toEqual([]);
    expect(pending).toEqual([]);
  });
});

describe("applyBulk — the multi-select path", () => {
  it("applies one fill across many candidates", () => {
    const cs = [whenGapped(), whenGapped(), whenGapped()];
    const { decisions, refused } = applyBulk(cs, { when: deathTrait }, { by: "sam" });
    expect(decisions).toHaveLength(3);
    expect(refused).toEqual([]);
    expect(decisions.every((d) => d.by === "sam")).toBe(true);
  });

  it("REFUSES what the patch does not complete instead of forcing it", () => {
    // The whole point: a shared fill that never addressed a candidate's other hole
    // must not be approximated onto it.
    const cs = [whenGapped(), targetGapped()];
    const { decisions, refused } = applyBulk(cs, { when: deathTrait });
    expect(decisions).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.issues.some((i) => i.field === "target")).toBe(true);
  });

  it("`patchResolves` predicts the split before the action is taken", () => {
    const cs = [whenGapped(), targetGapped()];
    expect(cs.filter((c) => patchResolves(c, { when: deathTrait }))).toHaveLength(1);
  });
});

describe("parsePredicate", () => {
  it("accepts a nested tree", () => {
    const out = parsePredicate({ all: [{ tag: "effect:trait:death" }, { not: { tag: "self:trait:elf" } }] });
    expect(out.ok).toBe(true);
  });

  it("rejects a half-built node, addressing the issue under `when`", () => {
    const out = parsePredicate({ tag: "" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.issues[0]!.field.startsWith("when")).toBe(true);
  });
});

describe("end to end — a gapped candidate reaches a sheet", () => {
  it("fills a gap, folds the decision in, and the effect lands", () => {
    const c = whenGapped();
    const out = resolveGaps(c, { when: deathTrait }, { by: "sam" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    // The decision must match the candidate as it will be REGENERATED next run —
    // i.e. still gapped, keyed as it was before the fill.
    const { effects, pending, staleDecisions } = resolveEntity([c], [out.decision]);
    expect(staleDecisions).toEqual([]);
    expect(pending).toEqual([]);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ kind: "modifier", target: "will", when: deathTrait });
  });

  it("emits `multiplicity` copies, so a bulk fill on Natural Skill's shape stays two", () => {
    const c = { ...whenGapped(), multiplicity: 2 };
    const out = resolveGaps(c, { when: deathTrait });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(resolveEntity([c], [out.decision]).effects).toHaveLength(2);
  });
});

describe("addEffect — an effect no producer proposed", () => {
  const draft: DraftEffect = {
    kind: "rollAdjust",
    target: "will",
    adjust: { type: "degreeMap", map: { success: "critical-success" } },
  };

  it("mints an add decision carrying the validated effect", () => {
    const out = addEffect("adhyabhau", draft, [], { by: "sam" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.decision.action).toBe("add");
    expect(out.decision.entityId).toBe("adhyabhau");
    expect(out.decision.effect).toEqual(draft);
    expect(out.decision.by).toBe("sam");
  });

  it("refuses a draft the schema refuses, rather than recording nonsense", () => {
    const out = addEffect("x", { kind: "rollAdjust", target: "will", adjust: { type: "degreeMap", map: {} } });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.issues.every((i) => i.source === "schema")).toBe(true);
  });

  it("gives two additions sharing an effectKey distinct keys", () => {
    // Dragon's Presence rewrites a success AND a failure — both `rollAdjust:will`.
    const first = addEffect("dragons-presence", draft, []);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = addEffect(
      "dragons-presence",
      { ...draft, adjust: { type: "degreeMap", map: { failure: "critical-failure" } } },
      [first.decision],
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.decision.key).not.toBe(first.decision.key);
    expect(isAddedKey(second.decision.key)).toBe(true);
  });

  it("keys are namespaced so they can never collide with a candidate key", () => {
    const out = addEffect("x", draft, []);
    if (!out.ok) return;
    expect(isAddedKey(out.decision.key)).toBe(true);
    expect(isAddedKey(effectKey(draft))).toBe(false);
  });
});

describe("resolveEntity folds additions in", () => {
  const added: EffectDecision = {
    entityId: "adhyabhau",
    key: "added:rollAdjust:will#1",
    action: "add",
    effect: { kind: "rollAdjust", target: "will", adjust: { type: "degreeMap", map: { success: "critical-success" } } },
  };

  it("reaches content even though no candidate proposed it", () => {
    const out = resolveEntity([], [added]);
    expect(out.effects).toEqual([added.effect]);
  });

  // The trap: `staleDecisions` means "a producer changed its mind". An addition was
  // never tied to a proposal, so a naive filter drops every one on the next run.
  it("is NEVER reported stale", () => {
    expect(resolveEntity([], [added]).staleDecisions).toEqual([]);
  });

  it("still reports a genuinely stale decision", () => {
    const orphan: EffectDecision = { entityId: "x", key: "modifier:ac:status", action: "accept" };
    expect(resolveEntity([], [orphan]).staleDecisions).toEqual([orphan]);
  });
});

describe("addGrantedAction", () => {
  // Shape-only demonstration trees, never a rules claim: authoring a real activity
  // from memory is exactly what rules-from-source exists to prevent. What is under
  // test is the DOOR — that it validates, keys stably, and reaches content.
  const draft = {
    id: "demo-activity",
    name: "Demo Activity",
    actionCost: { kind: "actions", min: 1, max: 1 },
    automation: [{ kind: "text", body: "Shape only." }],
  };

  it("records an authored activity as an ADD decision", () => {
    const out = addGrantedAction("demo-feat", draft);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.decision).toMatchObject({
      entityId: "demo-feat",
      action: "add",
      grantedAction: { id: "demo-activity", name: "Demo Activity" },
    });
    // No `effect`/`choice`: an activity is a third payload, not a passive.
    expect(out.decision?.effect).toBeUndefined();
    expect(out.decision?.choice).toBeUndefined();
  });

  it("keys off the action's own id, so re-authoring UPSERTS instead of duplicating", () => {
    // The decisions table is unique on (entity_id, key). A minted `#n` suffix here
    // would make an edit accumulate a second copy sharing one id — the sheet would
    // show the activity twice. This is the property that prevents that.
    const first = addGrantedAction("demo-feat", draft);
    const edited = addGrantedAction("demo-feat", { ...draft, name: "Demo Activity, revised" });
    expect(first.ok && edited.ok).toBe(true);
    if (!first.ok || !edited.ok) return;
    expect(edited.decision?.key).toBe(first.decision?.key);
    expect(isAddedKey(edited.decision!.key)).toBe(true);
  });

  it("gives different activities different keys", () => {
    const a = addGrantedAction("demo-feat", draft);
    const b = addGrantedAction("demo-feat", { ...draft, id: "other-activity" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.decision?.key).not.toBe(b.decision?.key);
  });

  it("refuses an activity with no name", () => {
    const out = addGrantedAction("demo-feat", { id: "x" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues.map((i) => i.field).join(" ")).toMatch(/name/);
  });

  it("refuses an INVALID AUTOMATION TREE — the door validates recursively", () => {
    // The whole point of routing authored actions through core: a bad tree is
    // rejected at the door rather than reaching content and failing at run time.
    const out = addGrantedAction("demo-feat", {
      ...draft,
      automation: [{ kind: "roll", notation: "not dice" }],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues.length).toBeGreaterThan(0);
  });
});

describe("addRider", () => {
  // Shape-only, like addGrantedAction: the DOOR is under test, not a rules claim.
  const rider = {
    id: "demo-rider",
    name: "Demo Rider",
    keyword: "demo",
    apply: "opt-in" as const,
    onSuccess: [{ kind: "text", body: "Shape only." }],
  };

  it("records an authored rider as an ADD decision keyed on its id", () => {
    const out = addRider("demo-feat", rider);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.decision).toMatchObject({ entityId: "demo-feat", action: "add", rider: { id: "demo-rider", keyword: "demo" } });
    expect(isAddedKey(out.decision!.key)).toBe(true);
    // Not a passive, not an activity — a fourth payload.
    expect(out.decision?.effect).toBeUndefined();
    expect(out.decision?.grantedAction).toBeUndefined();
  });

  it("re-authoring UPSERTS (same id → same key), and different riders differ", () => {
    const first = addRider("demo-feat", rider);
    const edited = addRider("demo-feat", { ...rider, name: "Demo Rider, revised" });
    const other = addRider("demo-feat", { ...rider, id: "other-rider" });
    if (!first.ok || !edited.ok || !other.ok) return;
    expect(edited.decision?.key).toBe(first.decision?.key);
    expect(other.decision?.key).not.toBe(first.decision?.key);
  });

  it("refuses a rider with an invalid automation fragment — the door validates recursively", () => {
    const out = addRider("demo-feat", { ...rider, onSuccess: [{ kind: "roll", notation: "not dice" }] });
    expect(out.ok).toBe(false);
  });
});

describe("resolveEntity — riders", () => {
  const rider = { id: "demo-rider", name: "Demo Rider", keyword: "demo", onHit: [{ kind: "text", body: "Shape only." }] };

  it("folds an authored rider into content, without leaking into other fields", () => {
    const added = addRider("demo-feat", rider);
    if (!added.ok) return;
    const r = resolveEntity([], [added.decision!]);
    expect(r.riders).toEqual([added.decision!.rider]);
    expect(r.grantedActions).toEqual([]);
    expect(r.effects).toEqual([]);
  });

  it("never reports an authored rider as stale, and returns [] when none authored", () => {
    const added = addRider("demo-feat", rider);
    if (!added.ok) return;
    expect(resolveEntity([], [added.decision!]).staleDecisions).toEqual([]);
    expect(resolveEntity([], []).riders).toEqual([]);
  });
});

describe("resolveEntity — granted actions", () => {
  const action = { id: "demo-activity", name: "Demo Activity" };

  it("folds an authored activity into content", () => {
    const added = addGrantedAction("demo-feat", action);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const r = resolveEntity([], [added.decision!]);
    expect(r.grantedActions).toEqual([action]);
    // And it does not leak into the passive fields.
    expect(r.effects).toEqual([]);
    expect(r.choices).toEqual([]);
  });

  it("never reports an authored activity as stale", () => {
    // An addition answers no candidate. If the stale filter caught it, every
    // authored action would silently stop shipping on the very next producer run.
    const added = addGrantedAction("demo-feat", action);
    if (!added.ok) return;
    expect(resolveEntity([], [added.decision!]).staleDecisions).toEqual([]);
  });

  it("returns an empty list when nothing was authored", () => {
    // Not undefined: remap-effects writes this field unconditionally, so an entity
    // whose actions were all removed must come back as [] and clear the content.
    expect(resolveEntity([], []).grantedActions).toEqual([]);
  });

  it("carries actions and passives on the SAME entity independently", () => {
    const act = addGrantedAction("demo-feat", action);
    const eff = addEffect("demo-feat", {
      kind: "modifier", target: "ac", bonusType: "status", value: { kind: "lit", value: 1 },
    } as DraftEffect);
    if (!act.ok || !eff.ok) return;
    const r = resolveEntity([], [act.decision!, eff.decision!]);
    expect(r.grantedActions).toHaveLength(1);
    expect(r.effects).toHaveLength(1);
  });
});
