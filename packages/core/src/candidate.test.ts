import { describe, expect, it } from "vitest";
import {
  autoPromotable,
  effectKey,
  effectSignature,
  groupBySignature,
  promote,
  reconcile,
  resolveEntity,
  sameDraft,
  triage,
  type DraftEffect,
  type EffectCandidate,
  type EffectDecision,
} from "./candidate.js";
import type { PassiveEffect } from "./passive.js";

const lit = (value: number) => ({ kind: "lit", value });

/** A complete, schema-valid draft: +1 circumstance to AC. */
const acBonus: DraftEffect = { kind: "modifier", target: "ac", bonusType: "circumstance", value: lit(1) };
/** The same effect, valued differently — a conflict, not a second effect. */
const acBonus2: DraftEffect = { kind: "modifier", target: "ac", bonusType: "circumstance", value: lit(2) };
/** Trained in Thievery. */
const thievery: DraftEffect = { kind: "proficiency", target: "thievery", rank: 1, mode: "upgrade" };

const cand = (over: Partial<EffectCandidate> = {}): EffectCandidate => ({
  entityId: "f",
  draft: acBonus,
  gaps: [],
  agreement: "corroborated",
  key: effectKey(acBonus),
  signature: effectSignature(acBonus),
  evidence: [],
  ...over,
});

describe("effectKey — the matching identity", () => {
  it("ignores the VALUE, so a disagreement about it is a conflict not a second effect", () => {
    // If the key included the value, +1 and +2 to AC would be two unrelated proposals
    // and BOTH would quietly land. The whole point is that they collide.
    expect(effectKey(acBonus)).toBe(effectKey(acBonus2));
  });

  it("separates different targets and bonus types", () => {
    expect(effectKey(acBonus)).not.toBe(effectKey({ ...acBonus, target: "will" }));
    expect(effectKey(acBonus)).not.toBe(effectKey({ ...acBonus, bonusType: "status" }));
  });

  it("marks an unresolved field rather than colliding everything on undefined", () => {
    expect(effectKey({ kind: "modifier", bonusType: "circumstance" })).toBe("modifier:?:circumstance");
  });

  it("separates grants by their SUB-TARGET, so a two-resistance feat is two effects", () => {
    // Blast Resistance grants fire AND sonic; keying both as `grant:resistance` collapsed
    // them and made two agreeing producers look like a conflict.
    const fire = { kind: "grant" as const, grant: { type: "resistance", damageType: "fire", value: { kind: "lit", value: 3 } } };
    const sonic = { kind: "grant" as const, grant: { type: "resistance", damageType: "sonic", value: { kind: "lit", value: 3 } } };
    expect(effectKey(fire)).toBe("grant:resistance:fire");
    expect(effectKey(fire)).not.toBe(effectKey(sonic));
    // sense keys on its name, immunity on its target, speed on its movement
    expect(effectKey({ kind: "grant", grant: { type: "sense", name: "scent" } })).toBe("grant:sense:scent");
    expect(effectKey({ kind: "grant", grant: { type: "immunity", to: "poison" } })).toBe("grant:immunity:poison");
    expect(effectKey({ kind: "grant", grant: { type: "speed", movement: "swim", value: { kind: "lit", value: 15 } } })).toBe("grant:speed:swim");
  });
});

describe("effectSignature — the bulk-review shape", () => {
  it("generalizes a specific skill to its class, so 150 feats are ONE bulk action", () => {
    expect(effectSignature(thievery)).toBe("proficiency:skill:trained");
    expect(effectSignature({ ...thievery, target: "society" })).toBe("proficiency:skill:trained");
  });

  it("generalizes saves, and keeps non-class targets as themselves", () => {
    expect(effectSignature({ kind: "modifier", target: "will", bonusType: "status", value: lit(1) })).toBe("modifier:save:status");
    expect(effectSignature(acBonus)).toBe("modifier:ac:circumstance");
  });

  it("distinguishes ranks — trained and legendary are not one bulk action", () => {
    expect(effectSignature({ ...thievery, rank: 4 })).toBe("proficiency:skill:legendary");
  });

  it("groups gapped candidates by their hole, so the target-resolution queue is one screen", () => {
    // The measured reality: ~a quarter of extractions know the bonus but not the target.
    expect(effectSignature({ kind: "modifier", bonusType: "circumstance", value: lit(2) })).toBe("modifier:?:circumstance");
  });
});

describe("sameDraft", () => {
  it("is insensitive to key order", () => {
    expect(sameDraft({ kind: "modifier", target: "ac" }, { target: "ac", kind: "modifier" })).toBe(true);
  });
  it("sees a value difference", () => {
    expect(sameDraft(acBonus, acBonus2)).toBe(false);
  });
});

describe("reconcile — agreement is earned from the producers", () => {
  it("two producers proposing the SAME effect is corroboration", () => {
    const out = reconcile("f", [
      { source: "parser", proposals: [{ draft: acBonus }] },
      { source: "foundry", proposals: [{ draft: acBonus }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ agreement: "corroborated" });
    expect(out[0]!.evidence.map((e) => e.source)).toEqual(["parser", "foundry"]);
  });

  it("two producers DISAGREEING on the same effect is a conflict, and keeps both readings", () => {
    const out = reconcile("f", [
      { source: "parser", proposals: [{ draft: acBonus }] },
      { source: "foundry", proposals: [{ draft: acBonus2 }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ agreement: "conflicting" });
    expect(out[0]!.alternatives).toEqual([acBonus2]);
  });

  it("labels a single-producer proposal by its source", () => {
    const parser = reconcile("f", [{ source: "parser", proposals: [{ draft: acBonus }] }]);
    expect(parser[0]!.agreement).toBe("parser-only");
    const foundry = reconcile("f", [{ source: "foundry", proposals: [{ draft: thievery }] }]);
    expect(foundry[0]!.agreement).toBe("foundry-only");
  });

  it("does not merge different effects from the same producer", () => {
    const out = reconcile("f", [{ source: "parser", proposals: [{ draft: acBonus }, { draft: thievery }] }]);
    expect(out).toHaveLength(2);
  });

  it("carries every producer's gaps and evidence onto the candidate", () => {
    const out = reconcile("f", [
      {
        source: "parser",
        proposals: [
          {
            draft: { kind: "modifier", bonusType: "circumstance", value: lit(2) },
            gaps: [{ field: "target", reason: "anaphoric", raw: "the check" }],
            evidence: { span: { start: 10, end: 60, text: "a +2 circumstance bonus to the check" } },
          },
        ],
      },
    ]);
    expect(out[0]!.gaps).toEqual([{ field: "target", reason: "anaphoric", raw: "the check" }]);
    expect(out[0]!.evidence[0]).toMatchObject({ source: "parser", span: { text: "a +2 circumstance bonus to the check" } });
  });

  it("agreement about an INCOMPLETE effect is still incomplete", () => {
    const gapped = { draft: { kind: "modifier" as const, bonusType: "circumstance", value: lit(2) }, gaps: [{ field: "target", reason: "anaphoric" as const }] };
    const out = reconcile("f", [
      { source: "parser", proposals: [gapped] },
      { source: "foundry", proposals: [gapped] },
    ]);
    expect(out[0]!.agreement).toBe("corroborated");
    expect(promote(out[0]!).ok).toBe(false); // corroboration does not fill a hole
  });
});

describe("promote — the one gate into content", () => {
  it("promotes a complete, valid, non-conflicting draft", () => {
    const r = promote(cand());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.effect).toEqual(acBonus as unknown as PassiveEffect);
  });

  it("REFUSES a gapped draft — a bonus on the wrong stat is worse than no bonus", () => {
    const r = promote(cand({ gaps: [{ field: "target", reason: "anaphoric", raw: "the check" }] }));
    expect(r).toMatchObject({ ok: false, blocked: "gaps" });
    if (!r.ok) expect(r.issues[0]).toContain("the check");
  });

  it("REFUSES a conflict rather than picking a winner by coin flip", () => {
    expect(promote(cand({ agreement: "conflicting", alternatives: [acBonus2] }))).toMatchObject({
      ok: false,
      blocked: "conflict",
    });
  });

  it("lets the SCHEMA decide completeness — no second definition to drift", () => {
    // Nothing here declares a gap; the draft simply isn't a valid PassiveEffect.
    const r = promote(cand({ draft: { kind: "modifier", target: "not-a-stat", bonusType: "circumstance", value: lit(1) } }));
    expect(r).toMatchObject({ ok: false, blocked: "invalid" });
    if (!r.ok) expect(r.issues.join(" ")).toContain("target");
  });

  it("refuses a bare draft with no kind", () => {
    expect(promote(cand({ draft: {} })).ok).toBe(false);
  });
});

describe("autoPromotable — corroborated + complete only", () => {
  it("auto-promotes a corroborated, complete candidate", () => {
    expect(autoPromotable(cand())).toBe(true);
  });

  it("never auto-promotes a single-source, a conflict, or a gapped candidate", () => {
    expect(autoPromotable(cand({ agreement: "parser-only" }))).toBe(false);
    expect(autoPromotable(cand({ agreement: "foundry-only" }))).toBe(false);
    expect(autoPromotable(cand({ agreement: "conflicting" }))).toBe(false);
    expect(autoPromotable(cand({ gaps: [{ field: "target", reason: "missing" }] }))).toBe(false);
  });
});

describe("triage — the queue the UI renders", () => {
  it("sorts each candidate into exactly one bucket", () => {
    const t = triage([
      cand({ key: "a" }),
      cand({ key: "b", agreement: "conflicting", alternatives: [acBonus2] }),
      cand({ key: "c", agreement: "parser-only", gaps: [{ field: "target", reason: "anaphoric" }] }),
      cand({ key: "d", agreement: "parser-only" }),
      cand({ key: "e", agreement: "parser-only", draft: { kind: "modifier", target: "bogus" } }),
    ]);
    expect(t.autoPromote).toHaveLength(1);
    expect(t.conflicts).toHaveLength(1);
    expect(t.gapped).toHaveLength(1);
    expect(t.review).toHaveLength(1);
    expect(t.invalid).toHaveLength(1);
  });

  it("a conflict outranks its gaps — the disagreement is the thing to look at", () => {
    const t = triage([cand({ agreement: "conflicting", gaps: [{ field: "target", reason: "missing" }] })]);
    expect(t.conflicts).toHaveLength(1);
    expect(t.gapped).toHaveLength(0);
  });

  it("an invalid draft is a PRODUCER bug, kept out of the ordinary review queue", () => {
    const t = triage([cand({ agreement: "corroborated", draft: { kind: "modifier", target: "bogus" } })]);
    expect(t.autoPromote).toHaveLength(0);
    expect(t.invalid).toHaveLength(1);
  });
});

describe("groupBySignature — the bulk primitive", () => {
  it("groups by shape, largest first", () => {
    const g = groupBySignature([
      cand({ key: "1", draft: thievery, signature: effectSignature(thievery) }),
      cand({ key: "2", draft: { ...thievery, target: "society" }, signature: effectSignature({ ...thievery, target: "society" }) }),
      cand({ key: "3" }),
    ]);
    expect(g[0]).toMatchObject({ signature: "proficiency:skill:trained" });
    expect(g[0]!.candidates).toHaveLength(2);
    expect(g[1]).toMatchObject({ signature: "modifier:ac:circumstance" });
  });
});

describe("resolveEntity — proposals + human decisions → content", () => {
  const accepted: PassiveEffect = { kind: "modifier", target: "ac", bonusType: "circumstance", value: { kind: "lit", value: 1 } } as PassiveEffect;

  it("an accept contributes the HUMAN's effect, not the producer's draft", () => {
    // The human corrected +2 down to +1; content must reflect the human.
    const c = cand({ agreement: "parser-only", draft: acBonus2 });
    const d: EffectDecision = { entityId: "f", key: c.key, action: "edit", effect: accepted };
    const r = resolveEntity([c], [d]);
    expect(r.effects).toEqual([accepted]);
    expect(r.pending).toHaveLength(0);
  });

  it("a rejected candidate never becomes content and never resurfaces as pending", () => {
    const c = cand({ agreement: "parser-only" });
    const r = resolveEntity([c], [{ entityId: "f", key: c.key, action: "reject", note: "misread the sentence" }]);
    expect(r.effects).toEqual([]);
    expect(r.pending).toEqual([]);
  });

  it("a rejection OUTRANKS auto-promotion — a human beats corroboration", () => {
    const c = cand(); // corroborated + complete: would auto-promote
    const r = resolveEntity([c], [{ entityId: "f", key: c.key, action: "reject" }]);
    expect(r.effects).toEqual([]);
  });

  it("undecided corroborated candidates auto-promote; the rest wait", () => {
    const auto = cand({ key: "auto" });
    const wait = cand({ key: "wait", agreement: "parser-only" });
    const r = resolveEntity([auto, wait], []);
    expect(r.effects).toHaveLength(1);
    expect(r.pending).toEqual([wait]);
  });

  it("reports a decision that matches no candidate as STALE, never as content", () => {
    // A producer changed its mind since the human decided. Surfacing it beats both
    // silently dropping the decision and silently re-applying it.
    const r = resolveEntity([], [{ entityId: "f", key: "modifier:ac:circumstance", action: "accept", effect: accepted }]);
    expect(r.effects).toEqual([]);
    expect(r.staleDecisions).toHaveLength(1);
  });

  it("decisions are scoped per entity — a key from another feat does not leak", () => {
    const c = cand({ entityId: "feat-a" });
    const r = resolveEntity([c], [{ entityId: "feat-b", key: c.key, action: "reject" }]);
    expect(r.effects).toHaveLength(1); // feat-a's candidate still auto-promoted
    expect(r.staleDecisions).toHaveLength(1); // feat-b's decision matched nothing
  });
});
