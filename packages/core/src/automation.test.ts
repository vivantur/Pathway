import { describe, expect, it } from "vitest";
import {
  automationSchema,
  runAutomation,
  type AutomationNode,
  type ExecutionContext,
} from "./automation.js";
import type { ResolvedCharacter } from "./character.js";
import type { Expr } from "./expr.js";
import { makeRng } from "./rng.js";

const actor: ResolvedCharacter = {
  level: 5,
  scores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  mods: { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
  hp: { max: 50 },
  ac: { value: 20, shieldBonus: 0 },
  perception: { modifier: 9, rank: 2 },
  saves: {
    fortitude: { modifier: 11, rank: 2 },
    reflex: { modifier: 9, rank: 1 },
    will: { modifier: 7, rank: 1 },
  },
  classDc: { modifier: 18, rank: 1 },
  speeds: { land: 25 },
  skills: { athletics: { modifier: 11, rank: 2, ability: "str" } },
};

// A target with known defenses, for resolution nodes.
const target: ResolvedCharacter = {
  level: 3,
  scores: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  mods: { str: 0, dex: 1, con: 1, int: 0, wis: 0, cha: 0 },
  hp: { max: 30 },
  ac: { value: 18, shieldBonus: 0 },
  perception: { modifier: 6, rank: 1 },
  saves: {
    fortitude: { modifier: 5, rank: 1 },
    reflex: { modifier: 3, rank: 1 },
    will: { modifier: 7, rank: 2 },
  },
  classDc: null,
  speeds: { land: 25 },
  skills: {},
};

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({ actor, rng: makeRng(1), ...over });

/** A stub RNG whose d20 always shows `face`, for deterministic degrees. */
const fixedd20 = (face: number): ExecutionContext["rng"] => ({ next: () => 0, int: () => face });

/** A stub RNG returning the given values in order (cycling), ignoring the die size. */
const seqRng = (...vals: number[]): ExecutionContext["rng"] => {
  let i = 0;
  return { next: () => 0, int: () => vals[i++ % vals.length]! };
};

const lit = (value: number | boolean | string): Expr => ({ kind: "lit", value });
const v = (name: string): Expr => ({ kind: "var", name });
const call = (fn: string, ...args: Expr[]): Expr => ({ kind: "call", fn, args });

describe("text node", () => {
  it("appends narration, title optional", () => {
    const out = runAutomation(
      [
        { kind: "text", body: "Plain body." },
        { kind: "text", title: "Heading", body: "With a title." },
      ],
      ctx(),
    );
    expect(out.log).toEqual([
      { kind: "text", body: "Plain body." },
      { kind: "text", title: "Heading", body: "With a title." },
    ]);
    expect(out.mutations).toEqual([]);
    expect(out.aborted).toBe(false);
  });
});

describe("variable + forward-only scope", () => {
  it("binds a value that a LATER node can read", () => {
    const tree: AutomationNode[] = [
      { kind: "variable", name: "n", value: lit(3) },
      { kind: "branch", condition: call("gte", v("n"), lit(3)), onTrue: [{ kind: "text", body: "reached" }], onFalse: [] },
    ];
    const out = runAutomation(tree, ctx());
    expect(out.log).toEqual([{ kind: "text", body: "reached" }]);
  });

  it("a variable can read the character namespace and earlier vars", () => {
    const tree: AutomationNode[] = [
      { kind: "variable", name: "half", value: call("floor", call("multiply", v("level"), lit(0.5))) },
      { kind: "branch", condition: call("eq", v("half"), lit(2)), onTrue: [{ kind: "text", body: "half of 5 is 2" }], onFalse: [] },
    ];
    expect(runAutomation(tree, ctx()).log).toEqual([{ kind: "text", body: "half of 5 is 2" }]);
  });
});

describe("branch", () => {
  it("runs onTrue / onFalse by the condition, and nests", () => {
    const nested: AutomationNode = {
      kind: "branch",
      condition: call("gte", v("level"), lit(5)),
      onTrue: [{ kind: "text", body: "level 5+" }],
      onFalse: [{ kind: "text", body: "under 5" }],
    };
    expect(runAutomation([nested], ctx()).log).toEqual([{ kind: "text", body: "level 5+" }]);

    const falsy: AutomationNode = {
      kind: "branch",
      condition: call("gt", v("level"), lit(10)),
      onTrue: [{ kind: "text", body: "high" }],
      onFalse: [nested],
    };
    expect(runAutomation([falsy], ctx()).log).toEqual([{ kind: "text", body: "level 5+" }]);
  });
});

describe("error policy", () => {
  const badVar: Expr = v("doesNotExist");

  it("ignore (default): the failing node is skipped, no warning, run continues", () => {
    const out = runAutomation(
      [
        { kind: "variable", name: "x", value: badVar },
        { kind: "text", body: "after" },
      ],
      ctx(),
    );
    expect(out.warnings).toEqual([]);
    expect(out.log).toEqual([{ kind: "text", body: "after" }]);
    expect(out.aborted).toBe(false);
  });

  it("warn: skipped, run continues, a warning is recorded", () => {
    const out = runAutomation([{ kind: "variable", name: "x", value: badVar, onError: { on: "warn" } }], ctx());
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/variable "x"/);
  });

  it("value: substitutes a fallback expression", () => {
    const out = runAutomation(
      [
        {
          kind: "branch",
          condition: badVar,
          onError: { on: "value", value: lit(true) },
          onTrue: [{ kind: "text", body: "fallback true" }],
          onFalse: [{ kind: "text", body: "fallback false" }],
        },
      ],
      ctx(),
    );
    expect(out.log).toEqual([{ kind: "text", body: "fallback true" }]);
  });

  it("raise: aborts the run; later nodes do NOT execute", () => {
    const out = runAutomation(
      [
        { kind: "text", body: "before" },
        { kind: "variable", name: "x", value: badVar, onError: { on: "raise" } },
        { kind: "text", body: "after" },
      ],
      ctx(),
    );
    expect(out.aborted).toBe(true);
    expect(out.log).toEqual([{ kind: "text", body: "before" }]);
    expect(out.warnings.some((w) => /aborted/.test(w))).toBe(true);
  });

  it("a context-level default policy applies when a node has none", () => {
    const out = runAutomation([{ kind: "variable", name: "x", value: badVar }], ctx({ onError: { on: "warn" } }));
    expect(out.warnings).toHaveLength(1);
  });
});

describe("roll node", () => {
  it("rolls, binds the total to lastRoll (and a name), and logs the dice", () => {
    // Seed chosen so the run is deterministic; assert via bounds + structure.
    const out = runAutomation(
      [
        { kind: "roll", notation: "2d6 + 3", name: "dmg" },
        { kind: "branch", condition: call("eq", v("dmg"), v("lastRoll")), onTrue: [{ kind: "text", body: "bound" }], onFalse: [] },
      ],
      ctx({ rng: makeRng(5) }),
    );
    const rollEntry = out.log.find((e) => e.kind === "roll");
    expect(rollEntry).toBeDefined();
    if (rollEntry?.kind === "roll") {
      expect(rollEntry.name).toBe("dmg");
      expect(rollEntry.dice).toHaveLength(2);
      expect(rollEntry.total).toBeGreaterThanOrEqual(2 + 3);
      expect(rollEntry.total).toBeLessThanOrEqual(12 + 3);
    }
    // dmg and lastRoll are equal → the branch reached onTrue
    expect(out.log.some((e) => e.kind === "text" && e.body === "bound")).toBe(true);
  });

  it("a roll can read character-namespace variables in its notation", () => {
    const out = runAutomation([{ kind: "roll", notation: "1d1 + strengthMod" }], ctx({ rng: makeRng(1) }));
    const entry = out.log.find((e) => e.kind === "roll");
    // 1d1 is always 1; strengthMod is 3 → total 4
    expect(entry?.kind === "roll" && entry.total).toBe(4);
  });

  it("a bad notation obeys the error policy (raise aborts)", () => {
    const out = runAutomation(
      [
        { kind: "roll", notation: "1d6 + missingVar", onError: { on: "raise" } },
        { kind: "text", body: "after" },
      ],
      ctx({ rng: makeRng(1) }),
    );
    expect(out.aborted).toBe(true);
    expect(out.log.some((e) => e.kind === "text")).toBe(false);
  });

  it("a value fallback binds a substitute total when the roll fails", () => {
    const out = runAutomation(
      [{ kind: "roll", notation: "1d6 + missingVar", name: "dmg", onError: { on: "value", value: lit(0) } }],
      ctx({ rng: makeRng(1) }),
    );
    const entry = out.log.find((e) => e.kind === "roll");
    expect(entry?.kind === "roll" && entry.total).toBe(0);
  });
});

describe("save node", () => {
  it("the target rolls the save vs a flat DC; the matching per-degree list runs", () => {
    // target fortitude +5, die 10 → total 15 vs DC 20 → failure (within 10)
    const out = runAutomation(
      [
        {
          kind: "save",
          save: "fortitude",
          dc: { kind: "flat", value: lit(20) },
          basicSave: true,
          onFailure: [{ kind: "text", body: "failed the save" }],
          onCriticalSuccess: [{ kind: "text", body: "unreached" }],
        },
      ],
      ctx({ target, rng: fixedd20(10) }),
    );
    const entry = out.log.find((e) => e.kind === "check");
    expect(entry).toEqual({ kind: "check", checkType: "save", die: 10, total: 15, dc: 20, degree: "failure" });
    expect(out.log.some((e) => e.kind === "text" && e.body === "failed the save")).toBe(true);
    expect(out.log.some((e) => e.kind === "text" && e.body === "unreached")).toBe(false);
  });

  it("binds degree refs a later node can branch on", () => {
    const out = runAutomation(
      [
        { kind: "save", save: "will", dc: { kind: "flat", value: lit(30) } }, // will +7, die 10 → 17 vs 30 → crit fail
        { kind: "branch", condition: v("saveIsCritFailure"), onTrue: [{ kind: "text", body: "critically failed" }], onFalse: [] },
        { kind: "branch", condition: call("eq", v("lastDegree"), lit(0)), onTrue: [{ kind: "text", body: "last was 0" }], onFalse: [] },
      ],
      ctx({ target, rng: fixedd20(10) }),
    );
    expect(out.log.some((e) => e.kind === "text" && e.body === "critically failed")).toBe(true);
    expect(out.log.some((e) => e.kind === "text" && e.body === "last was 0")).toBe(true);
  });

  it("a missing target obeys the error policy (ignore skips, raise aborts)", () => {
    const skipped = runAutomation([{ kind: "save", save: "reflex", dc: { kind: "flat", value: lit(15) } }], ctx({ rng: fixedd20(10) }));
    expect(skipped.log.some((e) => e.kind === "check")).toBe(false);
    expect(skipped.aborted).toBe(false);

    const aborted = runAutomation(
      [{ kind: "save", save: "reflex", dc: { kind: "flat", value: lit(15) }, onError: { on: "raise" } }, { kind: "text", body: "after" }],
      ctx({ rng: fixedd20(10) }),
    );
    expect(aborted.aborted).toBe(true);
    expect(aborted.log.length).toBe(0);
  });
});

describe("attack node", () => {
  it("rolls the actor's bonus vs the target's AC; nat-20 shifts a degree", () => {
    // bonus 20, die 10 → total 30 vs AC 18 → beats by 12 → critical success
    const crit = runAutomation(
      [{ kind: "attack", bonus: lit(20), onCriticalSuccess: [{ kind: "text", body: "crit hit" }] }],
      ctx({ target, rng: fixedd20(10) }),
    );
    expect(crit.log.find((e) => e.kind === "check")).toMatchObject({ checkType: "attack", dc: 18, degree: "critical-success" });
    expect(crit.log.some((e) => e.kind === "text" && e.body === "crit hit")).toBe(true);

    // bonus 0, die 20 → total 20 vs AC 25 → numerical failure, nat-20 bumps to success
    const nat20 = runAutomation([{ kind: "attack", bonus: lit(0) }], ctx({ target: { ...target, ac: { value: 25, shieldBonus: 0 } }, rng: fixedd20(20) }));
    expect(nat20.log.find((e) => e.kind === "check")).toMatchObject({ degree: "success" });
  });
});

describe("check node", () => {
  it("rolls an actor skill vs a target-stat-derived DC (10 + modifier)", () => {
    // actor athletics +11, die 10 → total 21 vs (10 + target reflex 3 = 13) → success
    const out = runAutomation(
      [
        {
          kind: "check",
          check: "athletics",
          dc: { kind: "stat", who: "target", selector: "reflex" },
          onSuccess: [{ kind: "text", body: "tripped" }],
        },
      ],
      ctx({ target, rng: fixedd20(10) }),
    );
    expect(out.log.find((e) => e.kind === "check")).toMatchObject({ checkType: "check", dc: 13, total: 21, degree: "success" });
    expect(out.log.some((e) => e.kind === "text" && e.body === "tripped")).toBe(true);
  });

  it("supports a flat DC and names the degree refs by the node name", () => {
    const out = runAutomation(
      [
        { kind: "check", check: "athletics", dc: { kind: "flat", value: lit(50) }, name: "climb" },
        { kind: "branch", condition: v("climbIsCritFailure"), onTrue: [{ kind: "text", body: "fell" }], onFalse: [] },
      ],
      ctx({ target, rng: fixedd20(10) }),
    );
    // athletics +11, die 10 → 21 vs 50 → fails by 29 → critical failure
    expect(out.log.find((e) => e.kind === "check")).toMatchObject({ name: "climb", degree: "critical-failure" });
    expect(out.log.some((e) => e.kind === "text" && e.body === "fell")).toBe(true);
  });
});

describe("damage node", () => {
  it("rolls typed components and emits a damage mutation", () => {
    const out = runAutomation(
      [{ kind: "damage", components: [{ formula: "2d6", type: "fire" }] }],
      ctx({ target, rng: seqRng(4, 5) }),
    );
    expect(out.mutations).toEqual([
      { kind: "damage", target: "target", healing: false, amount: 9, instances: [{ amount: 9, type: "fire" }] },
    ]);
    expect(out.log).toEqual([]); // damage is a mutation, not narration
  });

  it("sums multiple typed components and preserves descriptors", () => {
    const out = runAutomation(
      [
        {
          kind: "damage",
          components: [
            { formula: "1d6", type: "slashing" },
            { formula: "1d4", type: "fire", material: "silver", categories: ["persistent"] },
          ],
        },
      ],
      ctx({ target, rng: seqRng(5, 3) }),
    );
    expect(out.mutations[0]).toMatchObject({
      amount: 8,
      instances: [
        { amount: 5, type: "slashing" },
        { amount: 3, type: "fire", material: "silver", categories: ["persistent"] },
      ],
    });
  });

  it("scaling by attack: doubles on a crit, zero on a miss", () => {
    // attack bonus 20 vs AC 18, die 10 → total 30 → crit; 2d6 (4,5)=9 → ×2 = 18
    const crit = runAutomation(
      [
        { kind: "attack", bonus: lit(20) },
        { kind: "damage", components: [{ formula: "2d6", type: "fire" }], scaling: { by: "attack" } },
      ],
      ctx({ target, rng: seqRng(10, 4, 5) }),
    );
    expect(crit.mutations.find((m) => m.kind === "damage")).toMatchObject({ amount: 18 });

    // attack bonus 0 vs AC 18, die 10 → total 10 → miss; damage ×0
    const miss = runAutomation(
      [
        { kind: "attack", bonus: lit(0) },
        { kind: "damage", components: [{ formula: "2d6", type: "fire" }], scaling: { by: "attack" } },
      ],
      ctx({ target, rng: seqRng(10, 4, 5) }),
    );
    expect(miss.mutations.find((m) => m.kind === "damage")).toMatchObject({ amount: 0 });
  });

  it("scaling by basic-save: half rounds down, crit-failure doubles", () => {
    // save success (fort +5, die 10 = 15 vs DC 15); 1d6 (3) → ×0.5 = 1.5 → floor 1
    const half = runAutomation(
      [
        { kind: "save", save: "fortitude", dc: { kind: "flat", value: lit(15) }, basicSave: true },
        { kind: "damage", components: [{ formula: "1d6", type: "fire" }], scaling: { by: "basic-save" } },
      ],
      ctx({ target, rng: seqRng(10, 3) }),
    );
    expect(half.mutations.find((m) => m.kind === "damage")).toMatchObject({ amount: 1 });

    // save crit-failure (die 10 = 15 vs DC 30); 1d6 (3) → ×2 = 6
    const critFail = runAutomation(
      [
        { kind: "save", save: "fortitude", dc: { kind: "flat", value: lit(30) }, basicSave: true },
        { kind: "damage", components: [{ formula: "1d6", type: "fire" }], scaling: { by: "basic-save" } },
      ],
      ctx({ target, rng: seqRng(10, 3) }),
    );
    expect(critFail.mutations.find((m) => m.kind === "damage")).toMatchObject({ amount: 6 });
  });

  it("scaling with no prior degree warns and deals full damage", () => {
    const out = runAutomation(
      [{ kind: "damage", components: [{ formula: "1d6", type: "fire" }], scaling: { by: "attack" } }],
      ctx({ target, rng: seqRng(4) }),
    );
    expect(out.mutations.find((m) => m.kind === "damage")).toMatchObject({ amount: 4 });
    expect(out.warnings.some((w) => /scaling/.test(w))).toBe(true);
  });

  it("healing emits a healing mutation; an untyped component is allowed", () => {
    const out = runAutomation(
      [{ kind: "damage", components: [{ formula: "2d8" }], healing: true, target: "self" }],
      ctx({ target, rng: seqRng(3, 4) }),
    );
    expect(out.mutations).toEqual([
      { kind: "damage", target: "self", healing: true, amount: 7, instances: [{ amount: 7 }] },
    ]);
  });

  it("a bad dice variable obeys the error policy (default ignore → no mutation)", () => {
    const out = runAutomation(
      [{ kind: "damage", components: [{ formula: "1d6 + missing", type: "fire" }] }],
      ctx({ target, rng: seqRng(3) }),
    );
    expect(out.mutations).toEqual([]);
    expect(out.aborted).toBe(false);
  });
});

describe("temphp node", () => {
  it("emits a temphp mutation, defaulting to self", () => {
    const out = runAutomation([{ kind: "temphp", formula: "2d4 + 2" }], ctx({ target, rng: seqRng(2, 3) }));
    expect(out.mutations).toEqual([{ kind: "temphp", target: "self", amount: 7 }]);
  });
});

describe("automationSchema", () => {
  it("parses a valid nested tree", () => {
    const tree = [
      { kind: "text", body: "hi" },
      { kind: "variable", name: "n", value: { kind: "lit", value: 1 } },
      {
        kind: "branch",
        condition: { kind: "var", name: "n" },
        onTrue: [{ kind: "text", body: "t" }],
        onFalse: [],
        onError: { on: "value", value: { kind: "lit", value: false } },
      },
    ];
    expect(automationSchema.safeParse(tree).success).toBe(true);
  });

  it("validates a roll node and rejects invalid dice notation", () => {
    expect(automationSchema.safeParse([{ kind: "roll", notation: "2d6 + 3", name: "dmg" }]).success).toBe(true);
    expect(automationSchema.safeParse([{ kind: "roll", notation: "2d" }]).success).toBe(false);
  });

  it("validates resolution nodes with DCs and per-degree children", () => {
    expect(
      automationSchema.safeParse([
        {
          kind: "save",
          save: "reflex",
          dc: { kind: "flat", value: { kind: "lit", value: 20 } },
          basicSave: true,
          onCriticalFailure: [{ kind: "text", body: "prone" }],
        },
      ]).success,
    ).toBe(true);
    expect(automationSchema.safeParse([{ kind: "attack", bonus: { kind: "lit", value: 9 } }]).success).toBe(true);
    expect(
      automationSchema.safeParse([{ kind: "check", check: "athletics", dc: { kind: "stat", who: "target", selector: "reflex" } }]).success,
    ).toBe(true);
  });

  it("rejects a bad save selector, a bad DC selector, and a missing attack bonus", () => {
    expect(automationSchema.safeParse([{ kind: "save", save: "dexterity", dc: { kind: "flat", value: { kind: "lit", value: 1 } } }]).success).toBe(false);
    expect(automationSchema.safeParse([{ kind: "check", check: "athletics", dc: { kind: "stat", who: "target", selector: "made-up" } }]).success).toBe(false);
    expect(automationSchema.safeParse([{ kind: "attack" }]).success).toBe(false);
  });

  it("validates damage and temphp nodes", () => {
    expect(
      automationSchema.safeParse([
        { kind: "damage", components: [{ formula: "2d6", type: "fire" }], scaling: { by: "basic-save" }, healing: false },
      ]).success,
    ).toBe(true);
    expect(automationSchema.safeParse([{ kind: "damage", components: [{ formula: "1d8" }] }]).success).toBe(true); // untyped ok
    expect(automationSchema.safeParse([{ kind: "temphp", formula: "1d6 + 2" }]).success).toBe(true);
  });

  it("rejects a bad damage type, empty components, and a bad temphp formula", () => {
    expect(automationSchema.safeParse([{ kind: "damage", components: [{ formula: "2d6", type: "radiant" }] }]).success).toBe(false);
    expect(automationSchema.safeParse([{ kind: "damage", components: [] }]).success).toBe(false);
    expect(automationSchema.safeParse([{ kind: "temphp", formula: "2d" }]).success).toBe(false);
  });

  it("rejects an unknown node kind, missing branch arms, and extra fields", () => {
    expect(automationSchema.safeParse([{ kind: "teleport", to: "x" }]).success).toBe(false);
    expect(automationSchema.safeParse([{ kind: "branch", condition: { kind: "lit", value: true }, onTrue: [] }]).success).toBe(false);
    expect(automationSchema.safeParse([{ kind: "text", body: "x", extra: 1 }]).success).toBe(false);
  });

  it("rejects an unknown error-policy option", () => {
    expect(
      automationSchema.safeParse([{ kind: "variable", name: "n", value: { kind: "lit", value: 1 }, onError: { on: "explode" } }]).success,
    ).toBe(false);
  });
});
