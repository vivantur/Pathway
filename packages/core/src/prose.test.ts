// prose.ts — the parser producer. Fixtures are REAL prose lifted from the corpus
// (apps/web/src/features/builder/data/feats.json), not invented, so the tests exercise
// the shapes the parser will actually meet. The Foundry-vs-parser agreement is measured
// corpus-wide by scripts/prose-recall.mjs; these lock the unit behaviour.

import { describe, expect, it } from "vitest";
import {
  extractFromProse,
  modifierExtractor,
  parseProse,
  proficiencyExtractor,
  segment,
  type Clause,
} from "./prose.js";
import { promote, reconcile } from "./candidate.js";

// A clause built by hand, for extractor-level tests.
const clause = (text: string, governor?: Clause["governor"]): Clause => ({
  text,
  ...(governor ? { governor } : {}),
  start: 0,
  end: text.length,
});

/** Read a draft's lit value (DraftEffect.value is `unknown` — a draft may be half-built). */
const litValue = (v: unknown): number => (v as { value: number }).value;

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

  // ── compound grants: "and" fans out, "choice of" does not ────────────────────
  it("fans a compound 'X and Y' grant into one draft per skill (Anadi Lore)", () => {
    // The ancestry-Lore feats grant TWO skills; single-word capture dropped the second.
    const ex = extractFromProse("You gain the trained proficiency rank in Crafting and Survival.", [proficiencyExtractor]);
    expect(ex.map((e) => e.draft.target)).toEqual(["crafting", "survival"]);
    expect(ex.every((e) => e.draft.rank === 1 && e.draft.mode === "upgrade")).toBe(true);
  });

  it("fans a three-skill compound with an Oxford comma", () => {
    const ex = extractFromProse("You are trained in Deception, Diplomacy, and Intimidation.", [proficiencyExtractor]);
    expect(ex.map((e) => e.draft.target)).toEqual(["deception", "diplomacy", "intimidation"]);
  });

  it("does NOT fan a 'choice of' construction — grants the definite skill only (Dragonscaled Lore)", () => {
    // "pick one of four" is the CHOICE shape (a later slice); fanning it into four grants
    // is a wrong sheet. The chain stops at "your", so only the definite Intimidation lands.
    const ex = extractFromProse(
      "You become trained in Intimidation and your choice of Arcana, Nature, Occultism, or Religion.",
      [proficiencyExtractor],
    );
    expect(ex.map((e) => e.draft.target)).toEqual(["intimidation"]);
  });

  it("does NOT chain across 'or' (a choice of one, not a conjunction)", () => {
    const ex = extractFromProse("You become trained in Arcana or Occultism.", [proficiencyExtractor]);
    expect(ex.map((e) => e.draft.target)).toEqual(["arcana"]);
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

describe("modifierExtractor", () => {
  const mods = (text: string) => extractFromProse(text, [modifierExtractor]);

  it("reads value + stated bonus type + a resolvable target", () => {
    const ex = mods("You gain a +2 circumstance bonus to Stealth.");
    expect(ex).toHaveLength(1);
    expect(ex[0]!.draft).toEqual({
      kind: "modifier",
      target: "stealth",
      bonusType: "circumstance",
      value: { kind: "lit", value: 2 },
    });
    expect(ex[0]!.gaps).toEqual([]);
  });

  it("makes a penalty negative", () => {
    const ex = mods("You take a -1 status penalty to attack rolls.");
    expect(ex[0]!.draft).toMatchObject({ target: "attack", bonusType: "status", value: { kind: "lit", value: -1 } });
  });

  it("strips a possessive and a role noun to reach the stat", () => {
    expect(mods("a +1 circumstance bonus to your Reflex saves")[0]!.draft).toMatchObject({ target: "reflex" });
    expect(mods("a +2 status bonus to your Perception DC")[0]!.draft).toMatchObject({ target: "perception" });
    expect(mods("a +1 circumstance bonus to the attack roll")[0]!.draft).toMatchObject({ target: "attack" });
  });

  it("fans a broadcast target out to every stat it covers", () => {
    // "+1 to all saving throws" is +1 to each of the three saves — the same fan-out
    // Foundry does at ingest, which is what lets the two producers corroborate.
    const ex = mods("You gain a +1 status bonus to all saving throws.");
    expect(ex.map((e) => e.draft.target).sort()).toEqual(["fortitude", "reflex", "will"]);
    expect(ex.every((e) => e.draft.bonusType === "status")).toBe(true);
  });

  it("defaults an unstated bonus type to untyped", () => {
    expect(mods("You gain a +1 bonus to Athletics.")[0]!.draft).toMatchObject({ target: "athletics", bonusType: "untyped" });
  });

  // ── the gap machinery: anaphora is the point, not an error path ──────────────
  it("emits a GAPPED draft when the target is anaphoric, never a guess", () => {
    // "the check" names no stat — the value and type are known, the target points at an
    // earlier clause. A human resolves it; the draft cannot promote until they do.
    const ex = mods("You gain a +2 circumstance bonus to the check.");
    expect(ex).toHaveLength(1);
    expect(ex[0]!.draft.target).toBeUndefined();
    expect(ex[0]!.draft).toMatchObject({ kind: "modifier", bonusType: "circumstance", value: { kind: "lit", value: 2 } });
    expect(ex[0]!.gaps).toEqual([{ field: "target", reason: "anaphoric", raw: "the check" }]);
  });

  it("an anaphoric draft is REFUSED by promote until the target is filled", () => {
    const candidate = {
      entityId: "x",
      draft: mods("a +2 circumstance bonus to your check")[0]!.draft,
      gaps: mods("a +2 circumstance bonus to your check")[0]!.gaps,
      agreement: "parser-only" as const,
      key: "modifier:?:circumstance",
      signature: "modifier:?:circumstance",
      evidence: [],
    };
    const result = promote(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blocked).toBe("gaps");
  });

  it("carries an 'against X' scope as a condition, never a blanket bonus", () => {
    // "+1 to saving throws against magic" is +1 to each save WHEN against magic — the fan
    // is fine, but dropping "against magic" would turn a narrow bonus into a blanket one.
    const ex = mods("You gain a +1 circumstance bonus to saving throws against magic.");
    expect(ex.map((e) => e.draft.target).sort()).toEqual(["fortitude", "reflex", "will"]);
    expect(ex.every((e) => e.gaps.some((g) => g.field === "when" && /against magic/i.test(g.raw ?? "")))).toBe(true);
  });

  it("carries a governed clause's condition as a gap instead of dropping it", () => {
    // Unlike a proficiency phrase, "+1 to attacks while raging" is a real conditional
    // modifier — kept, with the condition as a when-gap.
    const ex = extractFromProse("You gain a +1 status bonus to attack rolls while you are raging.", [
      modifierExtractor,
    ]);
    const governed = ex.find((e) => e.draft.target === "attack");
    expect(governed?.gaps.some((g) => g.field === "when" && g.reason === "conditional-unmapped")).toBe(true);
  });

  it("splits a compound target into one draft per stat (Oxford comma too)", () => {
    // "+1 to Intimidation, Perception, and Survival" — three stats, one value/type each.
    const ex = mods("You gain a +1 circumstance bonus to Intimidation, Perception, and Survival.");
    expect(ex.map((e) => e.draft.target).sort()).toEqual(["intimidation", "perception", "survival"]);
    expect(ex.every((e) => litValue(e.draft.value) === 1 && e.draft.bonusType === "circumstance" && !e.gaps.length)).toBe(true);
  });

  it("fans a compound where one element is itself a broadcast class", () => {
    // "AC and saving throws" → AC + the three saves (Avowed Insight's real shape).
    const ex = mods("You gain a +1 status bonus to AC and saving throws.");
    expect(ex.map((e) => e.draft.target).sort()).toEqual(["ac", "fortitude", "reflex", "will"]);
  });

  it("keeps the resolvable elements of a compound and drops the junk half", () => {
    // "Reflex saves and is Off-Guard" (Catfolk Dance): the second half is a different
    // effect, not a target — the reflex bonus still lands, the junk is dropped.
    const ex = mods("The target takes a -1 circumstance penalty to Reflex saves and is Off-Guard.");
    expect(ex.map((e) => e.draft.target)).toEqual(["reflex"]);
    expect(litValue(ex[0]!.draft.value)).toBe(-1);
  });

  it("applies a shared trailing scope to every element of a compound", () => {
    // "saves and AC against spells" (Soulforger): the "against spells" scope conditions
    // the whole list, so every fanned draft carries it — never a blanket bonus.
    const ex = mods("You gain a +2 status bonus to saving throws and AC against spells.");
    expect(ex.map((e) => e.draft.target).sort()).toEqual(["ac", "fortitude", "reflex", "will"]);
    expect(ex.every((e) => e.gaps.some((g) => g.field === "when" && /against spells/i.test(g.raw ?? "")))).toBe(true);
  });

  it("skips regex noise that is not a real modifier target", () => {
    // The clause boundary keeps the target from swallowing following prose; a target that
    // resolves to neither a stat nor an anaphor is dropped, not emitted as garbage.
    const ex = mods("You gain a +2 circumstance bonus to Make an Impression on such animals.");
    // "make an impression on such animals" is neither a stat nor a bare check ref.
    expect(ex).toEqual([]);
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
