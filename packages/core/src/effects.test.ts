import { describe, expect, it } from "vitest";
import { collectSheetEffects, collectTraits, evalNumeric, stackModifiers, type Modifier, type RuleElement } from "./effects.js";

describe("stackModifiers (PF2e bonus/penalty stacking)", () => {
  const m = (type: Modifier["type"], value: number): Modifier => ({ type, value });

  it("takes only the highest of same-type bonuses", () => {
    // Two item bonuses (+1 rune, +2 feat) → only +2 applies.
    expect(stackModifiers([m("item", 1), m("item", 2)])).toBe(2);
  });

  it("adds bonuses of different types", () => {
    // item +1, circumstance +2, status +1 → all stack = +4.
    expect(stackModifiers([m("item", 1), m("circumstance", 2), m("status", 1)])).toBe(4);
  });

  it("stacks untyped bonuses (data convention) with each other and with typed", () => {
    expect(stackModifiers([m("untyped", 1), m("untyped", 2), m("item", 3)])).toBe(6);
  });

  it("takes only the worst of same-type penalties", () => {
    // Two item penalties (−1, −2) → only −2 applies.
    expect(stackModifiers([m("item", -1), m("item", -2)])).toBe(-2);
  });

  it("adds penalties of different types", () => {
    expect(stackModifiers([m("circumstance", -1), m("status", -2)])).toBe(-3);
  });

  it("adds ALL untyped penalties together (the exception)", () => {
    expect(stackModifiers([m("untyped", -1), m("untyped", -2)])).toBe(-3);
  });

  it("resolves a bonus and a penalty of the same type independently", () => {
    // Highest circumstance bonus (+2) AND worst circumstance penalty (−1) both apply.
    expect(stackModifiers([m("circumstance", 2), m("circumstance", 1), m("circumstance", -1)])).toBe(1);
  });

  it("returns 0 for no modifiers and ignores zeros", () => {
    expect(stackModifiers([])).toBe(0);
    expect(stackModifiers([m("item", 0)])).toBe(0);
  });
});

describe("evalNumeric", () => {
  const ctx = (level: number) => ({ level });

  it("handles numbers and integer strings", () => {
    expect(evalNumeric(1, ctx(1))).toBe(1);
    expect(evalNumeric("3", ctx(1))).toBe(3);
  });

  it("resolves @actor.level", () => {
    expect(evalNumeric("@actor.level", ctx(7))).toBe(7);
  });

  it("evaluates comparison + ternary", () => {
    // Canny-Acumen-style: expert (2) until 17th, then master (3).
    const expr = "ternary(gte(@actor.level,17),3,2)";
    expect(evalNumeric(expr, ctx(1))).toBe(2);
    expect(evalNumeric(expr, ctx(16))).toBe(2);
    expect(evalNumeric(expr, ctx(17))).toBe(3);
  });

  it("evaluates nested ternary / min / max / floor", () => {
    const expr = "ternary(gte(@actor.level,15),4,ternary(gte(@actor.level,7),3,2))";
    expect(evalNumeric(expr, ctx(6))).toBe(2);
    expect(evalNumeric(expr, ctx(7))).toBe(3);
    expect(evalNumeric(expr, ctx(15))).toBe(4);
    expect(evalNumeric("max(1,3,2)", ctx(1))).toBe(3);
    expect(evalNumeric("min(4,2)", ctx(1))).toBe(2);
    expect(evalNumeric("floor(add(@actor.level,1))", ctx(4))).toBe(5);
  });

  it("evaluates infix arithmetic with precedence (resistance scaling)", () => {
    // The exact forms the corpus uses for level-scaled resistances.
    expect(evalNumeric("floor(@actor.level/2)", ctx(6))).toBe(3);
    expect(evalNumeric("floor(@actor.level/2)", ctx(5))).toBe(2);
    expect(evalNumeric("max(1,floor(@actor.level/2))", ctx(1))).toBe(1);
    // Precedence + parens + unary minus.
    expect(evalNumeric("@actor.level + 1", ctx(1))).toBe(2);
    expect(evalNumeric("1 + 2 * 3", ctx(1))).toBe(7);
    expect(evalNumeric("(1 + 2) * 3", ctx(1))).toBe(9);
    expect(evalNumeric("floor((@actor.level - 7) / 2)", ctx(11))).toBe(2);
    expect(evalNumeric("-3 + 5", ctx(1))).toBe(2);
  });

  it("throws on unsupported references / grammar (so callers skip, never guess)", () => {
    expect(() => evalNumeric("@actor.system.proficiencies.defenses.medium.rank", ctx(1))).toThrow();
    expect(() => evalNumeric("{item|flags.system.rulesSelections.rank}", ctx(1))).toThrow();
    expect(() => evalNumeric("@actor.level %% 1", ctx(1))).toThrow();
    expect(() => evalNumeric("bogus(1)", ctx(1))).toThrow();
  });
});

describe("collectSheetEffects", () => {
  const rule = (r: RuleElement) => r;

  it("sums an unconditional untyped HP FlatModifier (Toughness → +level)", () => {
    const toughness: RuleElement[] = [
      { key: "FlatModifier", selector: "hp", value: "@actor.level" },
      { key: "ActiveEffectLike", mode: "subtract", path: "system.attributes.dying.recoveryDC", value: 1 },
    ];
    const e = collectSheetEffects([toughness], { level: 8 });
    expect(e.hpBonus).toBe(8);
    // The recovery-DC ActiveEffectLike isn't a rank path — ignored, not skipped-as-relevant.
    expect(e.skipped).toBe(0);
  });

  it("skips conditional or typed HP modifiers (they need stacking rules) and counts them", () => {
    const e = collectSheetEffects(
      [
        [{ key: "FlatModifier", selector: "hp", value: 5, predicate: ["self:condition:frightened"] }],
        [{ key: "FlatModifier", selector: "hp", value: 5, type: "status" }],
      ],
      { level: 1 },
    );
    expect(e.hpBonus).toBe(0);
    expect(e.skipped).toBe(2);
  });

  it("attributes each applied effect to its source label", () => {
    const e = collectSheetEffects(
      [
        [{ key: "FlatModifier", selector: "hp", value: "@actor.level" }],
        [{ key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.thievery.rank", value: 1 }],
        [{ key: "FlatModifier", selector: "perception", type: "circumstance", value: 2 }],
      ],
      { level: 5 },
      ["Toughness", "Adroit Manipulation", "Superior Sight"],
    );
    expect(e.applied).toEqual([
      { source: "Toughness", stat: "hp", summary: "+5 HP" },
      { source: "Adroit Manipulation", stat: "thievery", summary: "Trained in Thievery" },
      { source: "Superior Sight", stat: "perception", summary: "+2 circumstance to Perception" },
    ]);
  });

  it("grants a fixed-path skill rank via upgrade", () => {
    const e = collectSheetEffects(
      [[rule({ key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.thievery.rank", value: 1 })]],
      { level: 1 },
    );
    expect(e.skillRanks.get("thievery")).toBe(1);
  });

  it("takes the highest rank when several feats grant the same skill", () => {
    const e = collectSheetEffects(
      [
        [{ key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.nature.rank", value: 1 }],
        [{ key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.nature.rank", value: 2 }],
      ],
      { level: 1 },
    );
    expect(e.skillRanks.get("nature")).toBe(2);
  });

  it("resolves a level-gated rank expression", () => {
    const e = collectSheetEffects(
      [[{ key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.athletics.rank", value: "ternary(gte(@actor.level,13),2,1)" }]],
      { level: 13 },
    );
    expect(e.skillRanks.get("athletics")).toBe(2);
  });

  it("grants save and Perception ranks", () => {
    const e = collectSheetEffects(
      [
        [{ key: "ActiveEffectLike", mode: "upgrade", path: "system.saves.fortitude.rank", value: 2 }],
        [{ key: "ActiveEffectLike", mode: "upgrade", path: "system.attributes.perception.rank", value: 1 }],
      ],
      { level: 1 },
    );
    expect(e.saveRanks.get("fortitude")).toBe(2);
    expect(e.perceptionRank).toBe(1);
  });

  it("skips choice-driven rank paths (counted, not guessed)", () => {
    const e = collectSheetEffects(
      [[{ key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.{item|flags.system.rulesSelections.skill}.rank", value: 1 }]],
      { level: 1 },
    );
    expect(e.skillRanks.size).toBe(0);
    expect(e.skipped).toBe(1);
  });

  it("resolves a whole-path choice (Canny Acumen → chosen save rank)", () => {
    // Canny Acumen's ActiveEffectLike path IS the placeholder; the stored choice
    // is the full target path. Expert until 17th, master after.
    const cannyAcumen: RuleElement[] = [
      {
        key: "ActiveEffectLike",
        mode: "upgrade",
        path: "{item|flags.system.rulesSelections.cannyAcumen}",
        value: "ternary(gte(@actor.level,17),3,2)",
      },
    ];
    const e = collectSheetEffects(
      [cannyAcumen],
      { level: 10 },
      ["Canny Acumen"],
      [{ cannyAcumen: "system.saves.will.rank" }],
    );
    expect(e.saveRanks.get("will")).toBe(2);
    expect(e.skipped).toBe(0);
  });

  it("resolves an embedded skill-slug choice (Natural Skill → chosen skill)", () => {
    const naturalSkill: RuleElement[] = [
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.{item|flags.system.rulesSelections.skillOne}.rank", value: 1 },
    ];
    const e = collectSheetEffects([naturalSkill], { level: 1 }, ["Natural Skill"], [{ skillOne: "stealth" }]);
    expect(e.skillRanks.get("stealth")).toBe(1);
    expect(e.skipped).toBe(0);
  });

  it("skips a choice-driven path when the referenced flag has no stored selection", () => {
    const naturalSkill: RuleElement[] = [
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.{item|flags.system.rulesSelections.skillOne}.rank", value: 1 },
    ];
    // Wrong/empty flag map → unresolved → skipped, never guessed.
    const e = collectSheetEffects([naturalSkill], { level: 1 }, ["Natural Skill"], [{ somethingElse: "stealth" }]);
    expect(e.skillRanks.size).toBe(0);
    expect(e.skipped).toBe(1);
  });

  it("collects typed FlatModifiers per stat bucket", () => {
    const e = collectSheetEffects(
      [
        [{ key: "FlatModifier", selector: "ac", type: "item", value: 1 }],
        [{ key: "FlatModifier", selector: "saving-throw", type: "status", value: 1 }],
        [{ key: "FlatModifier", selector: "athletics", type: "circumstance", value: 2 }],
        [{ key: "FlatModifier", selector: "perception", value: 1 }], // no type → untyped
      ],
      { level: 1 },
    );
    expect(e.statModifiers.get("ac")).toEqual([{ type: "item", value: 1 }]);
    expect(e.statModifiers.get("saving-throw")).toEqual([{ type: "status", value: 1 }]);
    expect(e.statModifiers.get("athletics")).toEqual([{ type: "circumstance", value: 2 }]);
    expect(e.statModifiers.get("perception")).toEqual([{ type: "untyped", value: 1 }]);
  });

  it("skips conditional and base-calc-typed (ability/proficiency) stat modifiers", () => {
    const e = collectSheetEffects(
      [
        [{ key: "FlatModifier", selector: "ac", type: "circumstance", value: 2, predicate: ["target:flatFooted"] }],
        [{ key: "FlatModifier", selector: "skill-check", type: "proficiency", value: 3 }],
        [{ key: "FlatModifier", selector: "will", type: "ability", value: 1 }],
      ],
      { level: 1 },
    );
    expect(e.statModifiers.size).toBe(0);
    expect(e.skipped).toBe(3);
  });

  it("ignores rule elements flagged ignored and non-rank ActiveEffectLike", () => {
    const e = collectSheetEffects(
      [
        [{ key: "FlatModifier", selector: "hp", value: 3, ignored: true }],
        [{ key: "ActiveEffectLike", mode: "add", path: "system.attributes.speed.value", value: 5 }],
      ],
      { level: 1 },
    );
    expect(e.hpBonus).toBe(0);
    expect(e.skipped).toBe(0);
  });
});

describe("collectTraits (senses & resistances)", () => {
  it("collects a simple sense and an acuity/range sense", () => {
    const t = collectTraits(
      [
        [{ key: "Sense", selector: "darkvision" }],
        [{ key: "Sense", selector: "scent", acuity: "imprecise", range: 30 }],
      ],
      { level: 1 },
      ["Cavern Elf", "Hunting Catfolk"],
    );
    expect(t.senses).toEqual([
      { type: "darkvision", source: "Cavern Elf" },
      { type: "scent", acuity: "imprecise", range: 30, source: "Hunting Catfolk" },
    ]);
  });

  it("resolves a level-scaled resistance and drops one that rounds to 0", () => {
    const rule: RuleElement[] = [{ key: "Resistance", type: "cold", value: "floor(@actor.level/2)" }];
    expect(collectTraits([rule], { level: 6 }).resistances).toEqual([
      { type: "cold", value: 3, source: "" },
    ]);
    // At level 1, floor(1/2) = 0 → not yet a resistance.
    expect(collectTraits([rule], { level: 1 }).resistances).toEqual([]);
  });

  it("keeps the higher resistance and the more useful sense when types collide", () => {
    const t = collectTraits(
      [
        [{ key: "Resistance", type: "fire", value: 2 }],
        [{ key: "Resistance", type: "fire", value: 5 }],
        [{ key: "Sense", selector: "darkvision", range: 30 }],
        [{ key: "Sense", selector: "darkvision" }], // unlimited range wins
      ],
      { level: 1 },
    );
    expect(t.resistances).toEqual([{ type: "fire", value: 5, source: "" }]);
    expect(t.senses).toEqual([{ type: "darkvision", source: "" }]);
  });

  it("skips (and counts) choice-driven resistance types and conditional traits", () => {
    const t = collectTraits(
      [
        [{ key: "Resistance", type: "{item|flags.system.rulesSelections.heritageDeepFetchling}", value: 3 }],
        [{ key: "Sense", selector: "tremorsense", predicate: ["self:prone"] }],
      ],
      { level: 6 },
    );
    expect(t.resistances).toEqual([]);
    expect(t.senses).toEqual([]);
    expect(t.skipped).toBe(1); // the resistance; the conditional sense is simply ignored
  });
});
