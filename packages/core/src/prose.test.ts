// prose.ts — the parser producer. Fixtures are REAL prose lifted from the corpus
// (apps/web/src/features/builder/data/feats.json), not invented, so the tests exercise
// the shapes the parser will actually meet. The Foundry-vs-parser agreement is measured
// corpus-wide by scripts/prose-recall.mjs; these lock the unit behaviour.

import { describe, expect, it } from "vitest";
import {
  extractFromProse,
  parseProse,
  proficiencyExtractor,
  segment,
  type Clause,
} from "./prose.js";
import { reconcile } from "./candidate.js";

// A clause built by hand, for extractor-level tests.
const clause = (text: string, governor?: Clause["governor"]): Clause => ({
  text,
  ...(governor ? { governor } : {}),
  start: 0,
  end: text.length,
});

describe("normalize + segment", () => {
  it("strips Foundry roll debris but keeps the prose around it", () => {
    // Lepidstadt Surgeon's real tail: a formula fragment with an unbalanced `)))`.
    // normalize is internal; its contract is observable through extraction — the debris
    // must not derail the grant in the first clause.
    const raw =
      "You become an expert in Medicine. When you Administer First Aid, it regains (@actor.system.skills.medicine.rank - 2))) healing Hit Points.";
    const ex = extractFromProse(raw, [proficiencyExtractor]);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.draft).toEqual({ kind: "proficiency", target: "medicine", rank: 2, mode: "upgrade" });
  });

  it("treats markdown section structure as hard clause boundaries", () => {
    const raw = "**Frequency** once per day\n\n---\n\n**Effect** You become trained in Stealth.";
    const ex = extractFromProse(raw, [proficiencyExtractor]);
    expect(ex.map((e) => e.draft.target)).toEqual(["stealth"]);
  });

  it("splits a sentence at a subordinating conjunction and tags the governor", () => {
    const clauses = segment("the healing increases by 10 when you are legendary in Medicine");
    // Two clauses: the ungoverned lead, and the `when`-governed condition.
    const governed = clauses.find((c) => c.governor);
    expect(governed?.governor).toBe("when");
    expect(governed?.text).toMatch(/legendary in Medicine/);
    expect(clauses.some((c) => !c.governor)).toBe(true);
  });
});

describe("proficiencyExtractor — semantic pieces, not sentence templates", () => {
  it("reads the several phrasings of a grant as one effect", () => {
    // These are five costumes for the same effect (design doc). All must extract.
    for (const [text, skill, rank] of [
      ["You gain the trained proficiency rank in Thievery.", "thievery", 1],
      ["You are trained in Stealth.", "stealth", 1],
      ["You become an expert in Medicine.", "medicine", 2],
      ["You're a master of Occultism.", "occultism", 3],
      ["You become legendary in Athletics.", "athletics", 4],
    ] as const) {
      const ex = extractFromProse(text, [proficiencyExtractor]);
      expect(ex).toHaveLength(1);
      expect(ex[0]!.draft).toMatchObject({ kind: "proficiency", target: skill, rank, mode: "upgrade" });
    }
  });

  it("carries an evidence span back to the clause it read", () => {
    const ex = extractFromProse("You become an expert in Medicine.", [proficiencyExtractor]);
    expect(ex[0]!.span.text).toMatch(/expert in Medicine/);
    expect(ex[0]!.span.end).toBeGreaterThan(ex[0]!.span.start);
  });

  it("ignores a rank word applied to something that is not one of the 16 skills", () => {
    // "expert in this weapon" / "trained in heavy armor" are not skill grants.
    expect(extractFromProse("You become an expert in unarmed attacks.", [proficiencyExtractor])).toEqual([]);
    expect(extractFromProse("You are trained in heavy armor.", [proficiencyExtractor])).toEqual([]);
  });

  // ── THE REGRESSION: the Lepidstadt Surgeon conflict ──────────────────────────
  it("does NOT read a condition as a grant (Lepidstadt Surgeon)", () => {
    // The real feat: the FIRST clause is the grant; a LATER clause mentions the same
    // "legendary in Medicine" as a CONDITION. A governor-blind parser reads the second
    // as a grant, ships two effects, and (worse) the false one has no Foundry element to
    // catch it. The governor gate must extract exactly the first.
    const raw =
      "You become an expert in Medicine. When you successfully Administer First Aid to stabilize a dying creature, it regains healing Hit Points; this healing increases by 10 when you are a master of Medicine and by another 10 when you are legendary in Medicine.";
    const ex = extractFromProse(raw, [proficiencyExtractor]);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.draft).toEqual({ kind: "proficiency", target: "medicine", rank: 2, mode: "upgrade" });
  });

  it("declines a governed clause directly", () => {
    expect(proficiencyExtractor(clause("you are legendary in Medicine", "when"))).toEqual([]);
    // ungoverned, the same words ARE a grant
    expect(proficiencyExtractor(clause("you are legendary in Medicine"))).toHaveLength(1);
  });
});

describe("parseProse — as a candidate.ts producer", () => {
  it("emits SourceProposals with source 'parser' and spans, ready to reconcile", () => {
    const sp = parseProse("You become an expert in Medicine.");
    expect(sp.source).toBe("parser");
    expect(sp.proposals).toHaveLength(1);
    expect(sp.proposals[0]!.evidence?.span?.text).toMatch(/Medicine/);
  });

  it("corroborates with a matching Foundry proposal through reconcile", () => {
    // The parser and Foundry independently derive the same Medicine grant → corroborated,
    // which is the whole point of a second producer.
    const parser = parseProse("You become an expert in Medicine.");
    const foundry = {
      source: "foundry" as const,
      proposals: [{ draft: { kind: "proficiency" as const, target: "medicine", rank: 2, mode: "upgrade" } }],
    };
    const candidates = reconcile("lepidstadt-surgeon-dedication", [parser, foundry]);
    const prof = candidates.find((c) => c.draft.kind === "proficiency");
    expect(prof?.agreement).toBe("corroborated");
  });
});
