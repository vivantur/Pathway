import { describe, expect, it } from "vitest";
import { collectSheetEffects, evalNumeric, type RuleElement } from "./effects.js";

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

  it("throws on unsupported references / grammar (so callers skip, never guess)", () => {
    expect(() => evalNumeric("@actor.system.proficiencies.defenses.medium.rank", ctx(1))).toThrow();
    expect(() => evalNumeric("{item|flags.system.rulesSelections.rank}", ctx(1))).toThrow();
    expect(() => evalNumeric("@actor.level + 1", ctx(1))).toThrow();
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
