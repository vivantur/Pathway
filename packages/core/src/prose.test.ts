// prose.ts — the parser producer. Fixtures are REAL prose lifted from the corpus
// (apps/web/src/features/builder/data/feats.json), not invented, so the tests exercise
// the shapes the parser will actually meet. The Foundry-vs-parser agreement is measured
// corpus-wide by scripts/prose-recall.mjs; these lock the unit behaviour.

import { describe, expect, it } from "vitest";
import {
  choiceExtractor,
  degreeExtractor,
  extractFromProse,
  grantExtractor,
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

  describe("trait scopes become a predicate, not a gap", () => {
    // The vocabulary is supplied by the caller from the real corpus; these stand in
    // for it. `linguistic` is deliberately only in the wide set (it is a feat trait,
    // never a spell trait) and `human`/`dragon` only in the wide set too — they are
    // what the narrow set has to keep out.
    // The real vocabulary is nested: effectTraits (spells + feats) is a SUPERSET of
    // spellTraits. The fixture mirrors that, or it would test a shape that cannot
    // occur. `linguistic` and `human` are the feat-only half — `human` being exactly
    // what the narrow set has to keep out of a bare "against …".
    const spellTraits = new Set(["mental", "death", "emotion", "fire", "disease", "poison", "fear", "curse"]);
    const ctx = {
      effectTraits: new Set([...spellTraits, "linguistic", "occult", "human"]),
      spellTraits,
    };
    const withCtx = (text: string) => extractFromProse(text, [modifierExtractor], ctx);

    it("resolves \"against <trait> effects\" to an effect:trait predicate", () => {
      const ex = withCtx("You gain a +1 status bonus to saving throws against mental effects.");
      const d = ex.find((e) => e.draft.target === "will");
      expect(d?.draft.when).toEqual({ tag: "effect:trait:mental" });
      expect(d?.gaps.some((g) => g.field === "when")).toBe(false);
    });

    it("uses the WIDE vocabulary when the prose says \"effects\"", () => {
      // `linguistic` never appears on a spell, but "effects" has already told us this
      // describes an effect, so the wide set is safe here.
      const ex = withCtx("You gain a +2 circumstance bonus to Will saves against linguistic effects.");
      expect(ex[0]?.draft.when).toEqual({ tag: "effect:trait:linguistic" });
    });

    it("resolves \"against <trait> spells\" too", () => {
      const ex = withCtx("You gain a +1 status bonus to saving throws against occult spells.");
      expect(ex[0]?.draft.when).toEqual({ tag: "effect:trait:occult" });
    });

    it("de-pluralizes only by checking the singular against the vocabulary", () => {
      const ex = withCtx("You gain a +1 status bonus to Fortitude saves against diseases.");
      expect(ex[0]?.draft.when).toEqual({ tag: "effect:trait:disease" });
    });

    it("resolves a bare \"against <trait>\" through the NARROW vocabulary", () => {
      const ex = withCtx("You gain a +1 status bonus to saving throws against fear.");
      expect(ex[0]?.draft.when).toEqual({ tag: "effect:trait:fear" });
    });

    it("REFUSES a bare creature type, which the narrow vocabulary excludes", () => {
      // "against humans" is a creature, not an effect trait. Reading it as
      // effect:trait:human would attach a bonus that can never fire — silently
      // wrong, and worse than the honest gap.
      const ex = withCtx("You gain a +1 circumstance bonus to attack rolls against humans.");
      const d = ex.find((e) => e.draft.target === "attack");
      expect(d?.draft.when).toBeUndefined();
      expect(d?.gaps.some((g) => g.reason === "conditional-unmapped")).toBe(true);
    });

    it("refuses a word that is in no vocabulary at all", () => {
      const ex = withCtx("You gain a +1 status bonus to saving throws against magic.");
      expect(ex[0]?.draft.when).toBeUndefined();
      expect(ex[0]?.gaps.some((g) => g.reason === "conditional-unmapped")).toBe(true);
    });

    it("still gaps a governor-style condition, which is not a trait scope", () => {
      const ex = withCtx("You gain a +1 status bonus to attack rolls while you are raging.");
      const d = ex.find((e) => e.draft.target === "attack");
      expect(d?.draft.when).toBeUndefined();
      expect(d?.gaps.some((g) => g.reason === "conditional-unmapped")).toBe(true);
    });

    it("emits a predicate OR a gap, never both and never neither", () => {
      for (const text of [
        "You gain a +1 status bonus to saving throws against mental effects.",
        "You gain a +1 status bonus to saving throws against magic.",
        "You gain a +1 status bonus to Stealth.",
      ]) {
        for (const e of withCtx(text)) {
          const gapped = e.gaps.some((g) => g.field === "when");
          expect(gapped && e.draft.when !== undefined).toBe(false);
        }
      }
    });

    it("without a vocabulary, behaves exactly as before — everything gaps", () => {
      // The default is empty on purpose: resolving against a stale built-in list
      // would be worse than admitting the parser does not know the word.
      const ex = extractFromProse("You gain a +1 status bonus to saving throws against mental effects.", [
        modifierExtractor,
      ]);
      expect(ex[0]?.draft.when).toBeUndefined();
      expect(ex[0]?.gaps.some((g) => g.reason === "conditional-unmapped")).toBe(true);
    });

    it("resolves \"effects with the <trait> trait\" — the least ambiguous shape", () => {
      const ex = withCtx("You gain a +1 status bonus to saves against effects with the fire trait.");
      expect(ex[0]?.draft.when).toEqual({ tag: "effect:trait:fire" });
    });

    it("coordinates several traits into an `any`", () => {
      const ex = withCtx("You gain a +1 status bonus to saves against effects with the mental or emotion traits.");
      expect(ex[0]?.draft.when).toEqual({
        any: [{ tag: "effect:trait:mental" }, { tag: "effect:trait:emotion" }],
      });
    });

    it("reads a coordinated pair as ANY, not ALL", () => {
      // "against emotion and fear effects" applies to an emotion effect AND to a fear
      // effect — not only to one carrying both traits.
      const ex = withCtx("You gain a +2 status bonus to saving throws against emotion and fear effects.");
      expect(ex[0]?.draft.when).toEqual({
        any: [{ tag: "effect:trait:emotion" }, { tag: "effect:trait:fear" }],
      });
    });

    it("coordinates plurals through the same singularization", () => {
      const ex = withCtx("You gain a +1 status bonus to Fortitude saves against poisons and diseases.");
      expect(ex[0]?.draft.when).toEqual({
        any: [{ tag: "effect:trait:poison" }, { tag: "effect:trait:disease" }],
      });
    });

    it("refuses a coordinated pair when only HALF resolves", () => {
      // Emitting just the resolvable half would be a NARROWER condition than the prose
      // states — the bonus would silently fail to apply where the feat grants it.
      const ex = withCtx("You gain a +1 status bonus to saves against emotion and gribbly effects.");
      expect(ex[0]?.draft.when).toBeUndefined();
      expect(ex[0]?.gaps.some((g) => g.reason === "conditional-unmapped")).toBe(true);
    });

    it("resolves \"effects that would impose <condition>\" from core's own slugs", () => {
      // effect:causes: reads CONDITION_SLUGS — closed and owner-supplied, so this shape
      // needs no vocabulary from the caller at all.
      const ex = withCtx("You gain a +2 circumstance bonus to saves against effects that would impose the immobilized condition.");
      expect(ex[0]?.draft.when).toEqual({ tag: "effect:causes:immobilized" });
    });

    it("coordinates several inflicted conditions", () => {
      const ex = withCtx("You gain a +1 status bonus to saves against effects that inflict the blinded or dazzled condition.");
      expect(ex[0]?.draft.when).toEqual({
        any: [{ tag: "effect:causes:blinded" }, { tag: "effect:causes:dazzled" }],
      });
    });

    it("refuses a would-impose phrase naming no known condition", () => {
      const ex = withCtx("You gain a +1 status bonus to saves against effects that would impose sogginess.");
      expect(ex[0]?.draft.when).toBeUndefined();
    });

    it("labels a back-reference as ANAPHORIC, not as missing vocabulary", () => {
      // "against the triggering attack" does not need a word we lack; it needs the
      // referent. Filing it as conditional-unmapped sent reviewers hunting for the
      // wrong thing.
      for (const text of [
        "You gain a +2 circumstance bonus to AC against the triggering attack.",
        "You gain a +1 status bonus to saves against this creature.",
      ]) {
        const ex = withCtx(text);
        const g = ex[0]?.gaps.find((x) => x.field === "when");
        expect(g?.reason).toBe("anaphoric");
      }
    });

    it("still calls a real vocabulary miss conditional-unmapped", () => {
      const ex = withCtx("You gain a +1 status bonus to saving throws against magic.");
      expect(ex[0]?.gaps.find((g) => g.field === "when")?.reason).toBe("conditional-unmapped");
    });

    it("carries the predicate onto an anaphoric draft as well", () => {
      // A draft can be gapped on its TARGET and still have a resolved condition.
      const ex = withCtx("You gain a +1 status bonus to the check against mental effects.");
      const anaphoric = ex.find((e) => e.gaps.some((g) => g.reason === "anaphoric"));
      if (anaphoric) expect(anaphoric.draft.when).toEqual({ tag: "effect:trait:mental" });
    });
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

describe("grantExtractor — senses + speeds", () => {
  const grants = (text: string) => extractFromProse(text, [grantExtractor]);
  const speed = (m: string, v: number) => ({ kind: "grant", grant: { type: "speed", movement: m, value: { kind: "lit", value: v } } });

  it("reads 'a <movement> Speed of N' (Like a Fish in Water)", () => {
    const ex = grants("You gain a swim Speed of 15 feet, and you can hold your breath for twice as long.");
    expect(ex.map((e) => e.draft)).toEqual([speed("swim", 15)]);
  });

  it("reads 'Your Speed is N feet' as a land Speed (Quadruped)", () => {
    const ex = grants("Your Speed is 30 feet.");
    expect(ex.map((e) => e.draft)).toEqual([speed("land", 30)]);
  });

  it("reads 'increases to N' as the resulting Speed (Strong Tail)", () => {
    const ex = grants("Your land Speed increases to 15 feet.");
    expect(ex.map((e) => e.draft)).toEqual([speed("land", 15)]);
  });

  it("reads 'increases from X to N' as N, not X (Serpentine Swimmer, the from→to trap)", () => {
    const ex = grants("Your swim Speed increases from 10 feet to 25 feet.");
    expect(ex.map((e) => e.draft)).toEqual([speed("swim", 25)]);
  });

  it("does NOT read 'increases BY N' as a speed grant (that is an additive modifier)", () => {
    // The conditional +5 in Like a Fish is a FlatModifier, not a BaseSpeed. Foundry leaves it
    // unmapped; the parser must not emit it as a grant. (Ungoverned here, to isolate the shape.)
    expect(grants("Your swim Speed increases by 5 feet.")).toEqual([]);
  });

  it("declines a governed (conditional) speed grant", () => {
    // "If you already have a swim Speed, it increases by 5 feet" — governed by `if`.
    expect(grantExtractor(clause("you gain a fly Speed of 20 feet", "while"))).toEqual([]);
  });

  it("reads a sense with acuity and range (Keen Nose)", () => {
    const ex = grants("You gain scent as an imprecise sense with a range of 30 feet.");
    expect(ex.map((e) => e.draft)).toEqual([
      { kind: "grant", grant: { type: "sense", name: "scent", acuity: "imprecise", range: 30 } },
    ]);
  });

  it("reads a bare sense grant", () => {
    const ex = grants("You gain darkvision.");
    expect(ex.map((e) => e.draft)).toEqual([{ kind: "grant", grant: { type: "sense", name: "darkvision" } }]);
  });

  it("reads acuity stated BEFORE the sense, and 'at a range of N' (Web Hunter)", () => {
    const ex = grants("You gain imprecise tremorsense at a range of 15 feet.");
    expect(ex.map((e) => e.draft)).toEqual([
      { kind: "grant", grant: { type: "sense", name: "tremorsense", acuity: "imprecise", range: 15 } },
    ]);
  });

  it("reads the value-before Speed phrasing 'a N-foot <movement> Speed' (Wavetouched Paragon)", () => {
    const ex = grants("You gain a 15-foot swim Speed.");
    expect(ex.map((e) => e.draft)).toEqual([speed("swim", 15)]);
  });

  // ── resistances / weaknesses / immunities (slice 2) ──────────────────────────
  const half = { kind: "call", fn: "floor", args: [{ kind: "call", fn: "divide", args: [{ kind: "var", name: "level" }, { kind: "lit", value: 2 }] }] };
  const halfMin1 = { kind: "call", fn: "max", args: [{ kind: "lit", value: 1 }, half] };

  it("reads 'resistance to X equal to half your level (minimum 1)' as max(1, floor(level/2)) (Fumesoul)", () => {
    const ex = grants("You gain resistance to poison equal to half your level (minimum 1).");
    expect(ex.map((e) => e.draft)).toEqual([{ kind: "grant", grant: { type: "resistance", damageType: "poison", value: halfMin1 } }]);
  });

  it("FOLLOWS THE PROSE: no '(minimum 1)' → bare floor(level/2), matching Foundry (Fire Resistance)", () => {
    // The owner's call: feats that omit "(minimum 1)" are never 1st-level, so half-your-level
    // is never 0 when you take them. Applying min-1 anyway would disagree with Foundry's bare floor.
    const ex = grants("You gain fire resistance equal to half your level.");
    expect(ex.map((e) => e.draft)).toEqual([{ kind: "grant", grant: { type: "resistance", damageType: "fire", value: half } }]);
  });

  it("fans a compound flat resistance and strips the 'persistent'/'damage' noise", () => {
    expect(grants("You gain resistance 3 to fire and sonic.").map((e) => e.draft.grant)).toEqual([
      { type: "resistance", damageType: "fire", value: { kind: "lit", value: 3 } },
      { type: "resistance", damageType: "sonic", value: { kind: "lit", value: 3 } },
    ]);
    expect(grants("You gain resistance 5 to persistent bleed damage.").map((e) => e.draft.grant)).toEqual([
      { type: "resistance", damageType: "bleed", value: { kind: "lit", value: 5 } },
    ]);
  });

  it("fans a COMMA-separated compound resistance list (Skeletal Resistance), not just the first", () => {
    // A bare comma is a list separator, not a stop — else the list truncates to "cold".
    const ex = grants("You gain resistance 2 to cold, electricity, fire, piercing, and slashing.");
    // `DraftEffect.grant` is `unknown` on purpose (a draft may be nonsense), so a
    // test that reads into it narrows explicitly.
    const asGrant = (g: unknown) => g as { damageType: string; value: { value: number } };
    expect(ex.map((e) => asGrant(e.draft.grant).damageType)).toEqual(["cold", "electricity", "fire", "piercing", "slashing"]);
    expect(ex.every((e) => asGrant(e.draft.grant).value.value === 2)).toBe(true);
  });

  it("reads a weakness in both orderings and canonicalizes the material ('cold iron' → cold-iron)", () => {
    expect(grants("You gain weakness 5 to cold iron.").map((e) => e.draft.grant)).toEqual([
      { type: "weakness", damageType: "cold-iron", value: { kind: "lit", value: 5 } },
    ]);
    expect(grants("You gain fire weakness equal to half your level.").map((e) => e.draft.grant)).toEqual([
      { type: "weakness", damageType: "fire", value: half },
    ]);
  });

  it("reads a value-free immunity, fanning a compound (Celestial Rebirth)", () => {
    expect(grants("You become immune to poison and disease.").map((e) => e.draft.grant)).toEqual([
      { type: "immunity", to: "poison" },
      { type: "immunity", to: "disease" },
    ]);
  });
});

describe("choiceExtractor — skill-proficiency choices", () => {
  const choices = (text: string) => extractFromProse(text, [choiceExtractor]);
  const opts = (ex: ReturnType<typeof choices>) =>
    (ex[0]?.draft.choice as { options: { value: string; effects: { rank: number }[] }[] } | undefined)?.options.map((o) => o.value);

  it("reads 'a skill of your choice' as a choice over all 16 skills (Skill Training)", () => {
    const ex = choices("You become trained in the skill of your choice.");
    expect(ex).toHaveLength(1);
    expect(opts(ex)).toHaveLength(16);
    expect(ex[0]!.draft.kind).toBe("choice");
  });

  it("reads an explicit 'your choice of X, Y, or Z' list (Dragonscaled Lore)", () => {
    const ex = choices("You become trained in your choice of Arcana, Nature, Occultism, or Religion.");
    expect(opts(ex)).toEqual(["arcana", "nature", "occultism", "religion"]);
  });

  it("reads the choice half of a mixed phrase via 'either X or Y' (Elemental Lore)", () => {
    // "your choice of Survival and either Arcana or Nature" — the definite Survival is NOT
    // swept into the option set; only the arcana/nature choice is captured.
    const ex = choices("You gain the trained proficiency in your choice of Survival and either Arcana or Nature.");
    expect(opts(ex)).toEqual(["arcana", "nature"]);
  });

  it("carries the stated rank, not always trained", () => {
    const ex = choices("You become an expert in a skill of your choice.");
    const rank = (ex[0]!.draft.choice as { options: { effects: { rank: number }[] }[] }).options[0]!.effects[0]!.rank;
    expect(rank).toBe(2);
  });

  it("declines a SUBSTITUTION fallback ('you instead become trained in a skill of your choice')", () => {
    expect(choices("For each of these skills you were already trained in, you instead become trained in a skill of your choice.")).toEqual([]);
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

// All fixtures below are verbatim corpus prose. The measured shape counts they stand
// in for are recorded in prose.ts's section-9 header.
describe("degreeExtractor — conditional degree-of-success rewrites", () => {
  const traits = { effectTraits: new Set(["visual", "fear", "emotion"]), spellTraits: new Set(["visual", "fear", "emotion"]) };
  const run = (raw: string, ctx = traits) =>
    extractFromProse(raw, [degreeExtractor], ctx).map((e) => ({ draft: e.draft, gaps: e.gaps }));

  it("reads Adaptive Vision: a scoped save rewrite, fanned across the three saves", () => {
    const out = run(
      "If you roll a success on a saving throw against a visual effect, you get a critical success instead.",
    );
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.draft.target)).toEqual(["fortitude", "reflex", "will"]);
    for (const o of out) {
      expect(o.draft.adjust).toEqual({ type: "degreeMap", map: { success: "critical-success" } });
      expect(o.draft.when).toEqual({ tag: "effect:trait:visual" });
      expect(o.gaps).toEqual([]);
    }
  });

  it("reads Dragon's Presence: one clause improves, the other worsens", () => {
    const out = run(
      "When you roll a success on a saving throw against a fear effect, you get a critical success instead. " +
        "When you roll a failure against a fear effect, you get a critical failure instead.",
    );
    const maps = out.map((o) => (o.draft.adjust as { map: unknown }).map);
    expect(maps).toContainEqual({ success: "critical-success" });
    expect(maps).toContainEqual({ failure: "critical-failure" });
  });

  it("reads Forager's floor as a map, with no clamp primitive", () => {
    const out = run("While using Survival to Subsist, if you roll any result worse than a success, you get a success.");
    expect(out).toHaveLength(1);
    expect((out[0]!.draft.adjust as { map: unknown }).map).toEqual({
      "critical-failure": "success",
      failure: "success",
    });
  });

  // The whole point of the extractor: the governing "when" is the effect's TRIGGER,
  // already encoded in the map's key, so it must not ALSO be filed as a condition gap.
  it("does not file the governing 'when you roll a X' as an unexpressed condition", () => {
    const out = run("When you roll a success on a saving throw against a fear effect, you get a critical success instead.");
    for (const o of out) expect(o.gaps.filter((g) => g.field === "when")).toEqual([]);
  });

  it("gaps the target rather than guessing when the clause does not state one", () => {
    const out = run("When you roll a critical failure, you get a failure instead.");
    expect(out).toHaveLength(1);
    expect(out[0]!.draft.target).toBeUndefined();
    expect(out[0]!.gaps).toEqual([{ field: "target", reason: "anaphoric", raw: expect.any(String) }]);
  });

  // Cantorian Reinforcement's second sentence: "the save" is the disease-or-poison save
  // from its first. Read as a broadcast it would rewrite EVERY save unconditionally.
  it("treats a definite 'the save' as anaphoric, not a broadcast over all three saves", () => {
    const out = run("If you roll a critical failure on the save you get a failure instead.");
    expect(out).toHaveLength(1);
    expect(out[0]!.draft.target).toBeUndefined();
    expect(out[0]!.gaps.some((g) => g.field === "target" && g.reason === "anaphoric")).toBe(true);
  });

  it("still fans an INDEFINITE 'a saving throw' across the three saves", () => {
    const out = run("If you roll a critical failure on a saving throw, you get a failure instead.");
    expect(out.map((o) => o.draft.target)).toEqual(["fortitude", "reflex", "will"]);
  });

  it("gaps a scope it cannot name instead of dropping it", () => {
    const out = run(
      "If you roll a success on a saving throw against a visual effect, you get a critical success instead.",
      { effectTraits: new Set<string>(), spellTraits: new Set<string>() },
    );
    for (const o of out) {
      expect(o.draft.when).toBeUndefined();
      expect(o.gaps).toContainEqual({ field: "when", reason: "conditional-unmapped", raw: "against visual effect" });
    }
  });

  it("matches a clause that omits 'instead' (6 real ones do)", () => {
    const out = run("If you roll a critical failure, you get a failure.");
    expect(out).toHaveLength(1);
    expect((out[0]!.draft.adjust as { map: unknown }).map).toEqual({ "critical-failure": "failure" });
  });

  it("discards an identity rewrite, which is what keeps 'instead' optional safe", () => {
    // Real corpus prose: "you roll a success to Treat Wounds … you get a success" is a
    // restatement, not a rewrite. Dropping it is why the word `instead` is not required.
    expect(run("If you roll a success to Treat Wounds for a creature, you get a success.")).toEqual([]);
  });

  it("reads 'critical success' as one degree, never as a bare 'success'", () => {
    const out = run("If you roll a critical success on a saving throw, you get a success instead.");
    expect((out[0]!.draft.adjust as { map: unknown }).map).toEqual({ "critical-success": "success" });
  });

  it("emits nothing for prose with no degree rewrite", () => {
    expect(run("You gain a +1 circumstance bonus to saving throws against visual effects.")).toEqual([]);
  });
});

describe("modifierExtractor — a trailing clause that is its own effect", () => {
  const traits = { effectTraits: new Set(["emotion", "mental"]), spellTraits: new Set(["emotion", "mental"]) };

  // Adhyabhau, verbatim. Two effects in one sentence: a scoped modifier and a degree
  // rewrite. Reading the second as the first's condition dropped the scope sitting
  // right there ("against effects with the emotion trait") and sent the reviewer to
  // resolve a condition that does not exist. Measured: 13 modifier drafts, all of
  // which gained a real predicate and became gap-free.
  const adhyabhau =
    "You gain a +1 circumstance bonus to Will saves against effects with the emotion trait, " +
    "and when you roll a success on a saving throw against such an effect, you get a critical success instead.";

  it("keeps the modifier's own scope instead of the degree clause", () => {
    const [mod] = extractFromProse(adhyabhau, [modifierExtractor], traits);
    expect(mod!.draft.target).toBe("will");
    expect(mod!.draft.when).toEqual({ tag: "effect:trait:emotion" });
    expect(mod!.gaps).toEqual([]);
  });

  it("still treats a genuine trailing condition as a condition", () => {
    // Not a degree rewrite — this one really does condition the bonus.
    const [mod] = extractFromProse(
      "You gain a +1 circumstance bonus to Will saves while you are raging.",
      [modifierExtractor],
      traits,
    );
    expect(mod!.gaps.some((g) => g.field === "when")).toBe(true);
  });

  it("the degree clause still becomes its own effect, not nothing", () => {
    const adjusts = extractFromProse(adhyabhau, [degreeExtractor], traits);
    expect(adjusts).toHaveLength(3);
    expect((adjusts[0]!.draft.adjust as { map: unknown }).map).toEqual({ success: "critical-success" });
  });

  it("aims 'against such an effect' at the referent, not at missing vocabulary", () => {
    // "such" names no trait — it points back at the effect described earlier. Filed as
    // conditional-unmapped it told a reviewer to go find a word we lack.
    const adjusts = extractFromProse(adhyabhau, [degreeExtractor], traits);
    expect(adjusts[0]!.gaps).toEqual([{ field: "when", reason: "anaphoric", raw: "against such an effect" }]);
  });
});
