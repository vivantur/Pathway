import { describe, expect, it } from "vitest";
import {
  automationSchema,
  effectTemplateSchema,
  runAutomation,
  runButton,
  type AutomationNode,
  type Button,
  type EffectTemplate,
  type ExecutionContext,
  type Outcome,
} from "./automation.js";
import { evaluatePredicate, rollTags } from "./predicate.js";
import type { RollAdjustEffect } from "./passive.js";
import type { ResolvedCharacter } from "./character.js";
import type { Expr } from "./expr.js";
import { autoHeightenRank } from "./heightening.js";
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
      ctx({ targets: [target], rng: fixedd20(10) }),
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
      ctx({ targets: [target], rng: fixedd20(10) }),
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
      ctx({ targets: [target], rng: fixedd20(10) }),
    );
    expect(crit.log.find((e) => e.kind === "check")).toMatchObject({ checkType: "attack", dc: 18, degree: "critical-success" });
    expect(crit.log.some((e) => e.kind === "text" && e.body === "crit hit")).toBe(true);

    // bonus 0, die 20 → total 20 vs AC 25 → numerical failure, nat-20 bumps to success
    const nat20 = runAutomation([{ kind: "attack", bonus: lit(0) }], ctx({ targets: [{ ...target, ac: { value: 25, shieldBonus: 0 } }], rng: fixedd20(20) }));
    expect(nat20.log.find((e) => e.kind === "check")).toMatchObject({ degree: "success" });
  });
});

describe("attack node — multiple attack penalty", () => {
  // A fixed d20 face of 10 makes every total = 10 + bonus + MAP, so the penalty is
  // readable straight off the logged total.
  const attackTotals = (out: ReturnType<typeof runAutomation>): number[] =>
    out.log.filter((e) => e.kind === "check").map((e) => (e as { total: number }).total);

  it("takes no MAP without the marker — trees authored before MAP are unchanged", () => {
    const out = runAutomation(
      [{ kind: "attack", bonus: lit(10) }, { kind: "attack", bonus: lit(10) }],
      ctx({ targets: [target], rng: fixedd20(10) }),
    );
    expect(attackTotals(out)).toEqual([20, 20]);
    // No MAP-marked node ran, so the run says nothing about the turn's count.
    expect(out.attacksThisTurn).toBeUndefined();
  });

  it("escalates across attacks in one tree and reports the count", () => {
    const out = runAutomation(
      [
        { kind: "attack", bonus: lit(10), map: {} },
        { kind: "attack", bonus: lit(10), map: {} },
        { kind: "attack", bonus: lit(10), map: {} },
      ],
      ctx({ targets: [target], rng: fixedd20(10) }),
    );
    expect(attackTotals(out)).toEqual([20, 15, 10]); // 0 / −5 / −10
    expect(out.attacksThisTurn).toBe(3);
  });

  it("continues from the host's count across invocations", () => {
    // The second `/use` of a turn must not restart at no-penalty.
    const out = runAutomation(
      [{ kind: "attack", bonus: lit(10), map: {} }],
      ctx({ targets: [target], rng: fixedd20(10), attacksThisTurn: 1 }),
    );
    expect(attackTotals(out)).toEqual([15]); // second attack → −5
    expect(out.attacksThisTurn).toBe(2);
  });

  // Player Core p. 402's own worked example, driven end to end through the
  // interpreter: a longsword and an agile shortsword, three Strikes in a turn.
  // The penalty follows the weapon swung NOW, not the ones swung before.
  it("uses the current weapon's agile trait, not the previous attacks'", () => {
    const out = runAutomation(
      [
        { kind: "attack", bonus: lit(10), map: {} }, // longsword — first, no penalty
        { kind: "attack", bonus: lit(10), map: { agile: true } }, // shortsword — −4
        { kind: "attack", bonus: lit(10), map: {} }, // longsword — third, −10
      ],
      ctx({ targets: [target], rng: fixedd20(10) }),
    );
    expect(attackTotals(out)).toEqual([20, 16, 10]);
  });

  it("an off-turn attack takes no penalty and does not advance the count", () => {
    const out = runAutomation(
      [
        { kind: "attack", bonus: lit(10), map: {} },
        { kind: "attack", bonus: lit(10), map: { offTurn: true } }, // Reactive Strike
        { kind: "attack", bonus: lit(10), map: {} },
      ],
      ctx({ targets: [target], rng: fixedd20(10) }),
    );
    // The reaction is unpenalised AND invisible to the third attack, which is
    // still only the second attack of the turn.
    expect(attackTotals(out)).toEqual([20, 20, 15]);
    expect(out.attacksThisTurn).toBe(2);
  });

  it("counts an attack-trait skill check too — Shove advances MAP", () => {
    // "Every check that has the attack trait counts toward your multiple attack
    // penalty, including Strikes, spell attack rolls, certain skill actions like
    // Shove." The actor is trained in athletics via the shared test fixture.
    const out = runAutomation(
      [
        { kind: "check", check: "athletics", dc: { kind: "flat", value: lit(15) }, map: {} },
        { kind: "attack", bonus: lit(10), map: {} },
      ],
      ctx({ targets: [target], rng: fixedd20(10) }),
    );
    // The Strike is the SECOND attack-trait check of the turn → −5.
    expect(attackTotals(out)[1]).toBe(15);
    expect(out.attacksThisTurn).toBe(2);
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
      ctx({ targets: [target], rng: fixedd20(10) }),
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
      ctx({ targets: [target], rng: fixedd20(10) }),
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
      ctx({ targets: [target], rng: seqRng(4, 5) }),
    );
    expect(out.mutations).toEqual([
      { kind: "damage", target: { kind: "target", index: 0 }, healing: false, amount: 9, instances: [{ amount: 9, type: "fire" }] },
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
      ctx({ targets: [target], rng: seqRng(5, 3) }),
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
      ctx({ targets: [target], rng: seqRng(10, 4, 5) }),
    );
    expect(crit.mutations.find((m) => m.kind === "damage")).toMatchObject({ amount: 18 });

    // attack bonus 0 vs AC 18, die 10 → total 10 → miss; damage ×0
    const miss = runAutomation(
      [
        { kind: "attack", bonus: lit(0) },
        { kind: "damage", components: [{ formula: "2d6", type: "fire" }], scaling: { by: "attack" } },
      ],
      ctx({ targets: [target], rng: seqRng(10, 4, 5) }),
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
      ctx({ targets: [target], rng: seqRng(10, 3) }),
    );
    expect(half.mutations.find((m) => m.kind === "damage")).toMatchObject({ amount: 1 });

    // save crit-failure (die 10 = 15 vs DC 30); 1d6 (3) → ×2 = 6
    const critFail = runAutomation(
      [
        { kind: "save", save: "fortitude", dc: { kind: "flat", value: lit(30) }, basicSave: true },
        { kind: "damage", components: [{ formula: "1d6", type: "fire" }], scaling: { by: "basic-save" } },
      ],
      ctx({ targets: [target], rng: seqRng(10, 3) }),
    );
    expect(critFail.mutations.find((m) => m.kind === "damage")).toMatchObject({ amount: 6 });
  });

  it("scaling with no prior degree warns and deals full damage", () => {
    const out = runAutomation(
      [{ kind: "damage", components: [{ formula: "1d6", type: "fire" }], scaling: { by: "attack" } }],
      ctx({ targets: [target], rng: seqRng(4) }),
    );
    expect(out.mutations.find((m) => m.kind === "damage")).toMatchObject({ amount: 4 });
    expect(out.warnings.some((w) => /scaling/.test(w))).toBe(true);
  });

  it("healing emits a healing mutation; an untyped component is allowed", () => {
    const out = runAutomation(
      [{ kind: "damage", components: [{ formula: "2d8" }], healing: true, target: "self" }],
      ctx({ targets: [target], rng: seqRng(3, 4) }),
    );
    expect(out.mutations).toEqual([
      { kind: "damage", target: { kind: "self" }, healing: true, amount: 7, instances: [{ amount: 7 }] },
    ]);
  });

  it("a bad dice variable obeys the error policy (default ignore → no mutation)", () => {
    const out = runAutomation(
      [{ kind: "damage", components: [{ formula: "1d6 + missing", type: "fire" }] }],
      ctx({ targets: [target], rng: seqRng(3) }),
    );
    expect(out.mutations).toEqual([]);
    expect(out.aborted).toBe(false);
  });
});

describe("temphp node", () => {
  it("emits a temphp mutation, defaulting to self", () => {
    const out = runAutomation([{ kind: "temphp", formula: "2d4 + 2" }], ctx({ targets: [target], rng: seqRng(2, 3) }));
    expect(out.mutations).toEqual([{ kind: "temphp", target: { kind: "self" }, amount: 7 }]);
  });
});

describe("counter node", () => {
  const focus = () => ({ focus: { current: 2, max: 3 } });

  it("spends and emits a counter mutation, binding lastCounter refs", () => {
    const out = runAutomation(
      [
        { kind: "counter", counter: "focus", amount: lit(1) },
        { kind: "branch", condition: call("eq", v("lastCounterRemaining"), lit(1)), onTrue: [{ kind: "text", body: "1 left" }], onFalse: [] },
      ],
      ctx({ counters: focus(), rng: seqRng(1) }),
    );
    expect(out.mutations).toEqual([{ kind: "counter", counter: "focus", spent: 1, remaining: 1 }]);
    expect(out.log.some((e) => e.kind === "text" && e.body === "1 left")).toBe(true);
  });

  it("a negative amount recharges, clamping at max", () => {
    const out = runAutomation([{ kind: "counter", counter: "focus", amount: lit(-5) }], ctx({ counters: focus(), rng: seqRng(1) }));
    // current 2, recharge 5 → clamped to max 3, so only 1 restored (spent = -1)
    expect(out.mutations).toEqual([{ kind: "counter", counter: "focus", spent: -1, remaining: 3 }]);
  });

  it("two spends in one run compound, and never mutate the caller's snapshot", () => {
    const snapshot = focus();
    const out = runAutomation(
      [
        { kind: "counter", counter: "focus", amount: lit(1) },
        { kind: "counter", counter: "focus", amount: lit(1) },
      ],
      ctx({ counters: snapshot, rng: seqRng(1) }),
    );
    expect(out.mutations).toEqual([
      { kind: "counter", counter: "focus", spent: 1, remaining: 1 },
      { kind: "counter", counter: "focus", spent: 1, remaining: 0 },
    ]);
    expect(snapshot.focus.current).toBe(2); // caller's object untouched
  });

  it("clamps an over-spend and reports it via lastCounterClamped", () => {
    const out = runAutomation(
      [
        { kind: "counter", counter: "focus", amount: lit(5) },
        { kind: "branch", condition: v("lastCounterClamped"), onTrue: [{ kind: "text", body: "clamped" }], onFalse: [] },
      ],
      ctx({ counters: focus(), rng: seqRng(1) }),
    );
    // current 2, spend 5 → clamps at min 0, so only 2 spent
    expect(out.mutations).toEqual([{ kind: "counter", counter: "focus", spent: 2, remaining: 0 }]);
    expect(out.log.some((e) => e.kind === "text" && e.body === "clamped")).toBe(true);
  });

  it("requireAvailable blocks a partial spend: no mutation, error policy applies", () => {
    const out = runAutomation(
      [{ kind: "counter", counter: "focus", amount: lit(5), requireAvailable: true, onError: { on: "warn" } }],
      ctx({ counters: focus(), rng: seqRng(1) }),
    );
    expect(out.mutations).toEqual([]);
    expect(out.warnings.some((w) => /not enough available/.test(w))).toBe(true);
  });

  it("allowOverflow lets a spend pass the lower bound", () => {
    const out = runAutomation(
      [{ kind: "counter", counter: "focus", amount: lit(5), allowOverflow: true }],
      ctx({ counters: focus(), rng: seqRng(1) }),
    );
    expect(out.mutations).toEqual([{ kind: "counter", counter: "focus", spent: 5, remaining: -3 }]);
  });

  it("an unknown counter obeys the error policy (raise aborts)", () => {
    const out = runAutomation(
      [{ kind: "counter", counter: "nope", amount: lit(1), onError: { on: "raise" } }, { kind: "text", body: "after" }],
      ctx({ counters: focus(), rng: seqRng(1) }),
    );
    expect(out.aborted).toBe(true);
    expect(out.mutations).toEqual([]);
    expect(out.log).toEqual([]);
  });

  it("a named counter node binds its own refs too", () => {
    const out = runAutomation(
      [
        { kind: "counter", counter: "focus", amount: lit(2), name: "spend" },
        { kind: "branch", condition: call("eq", v("spendSpent"), lit(2)), onTrue: [{ kind: "text", body: "spent 2" }], onFalse: [] },
      ],
      ctx({ counters: focus(), rng: seqRng(1) }),
    );
    expect(out.log.some((e) => e.kind === "text" && e.body === "spent 2")).toBe(true);
  });
});

describe("target node", () => {
  const tough = { ...target, ac: { value: 25, shieldBonus: 0 } };
  const dmg1: AutomationNode = { kind: "damage", components: [{ formula: "1d1", type: "fire" }] };

  it("mode all: runs children once per target, attributing each mutation by index", () => {
    const out = runAutomation(
      [{ kind: "target", mode: "all", children: [dmg1] }],
      ctx({ targets: [target, tough], rng: seqRng(1) }),
    );
    expect(out.mutations).toEqual([
      { kind: "damage", target: { kind: "target", index: 0 }, healing: false, amount: 1, instances: [{ amount: 1, type: "fire" }] },
      { kind: "damage", target: { kind: "target", index: 1 }, healing: false, amount: 1, instances: [{ amount: 1, type: "fire" }] },
    ]);
  });

  it("each target gets its OWN DC comparison and degree", () => {
    // one d20 face of 10 + bonus 10 = 20: beats AC 18 (success), misses AC 25 (failure)
    const out = runAutomation(
      [{ kind: "target", mode: "all", children: [{ kind: "attack", bonus: lit(10) }] }],
      ctx({ targets: [target, tough], rng: fixedd20(10) }),
    );
    const checks = out.log.filter((e) => e.kind === "check");
    expect(checks[0]).toMatchObject({ dc: 18, degree: "success" });
    expect(checks[1]).toMatchObject({ dc: 25, degree: "failure" });
  });

  it("mode self: scopes to the actor, so 'target' mutations land on self", () => {
    const out = runAutomation(
      [{ kind: "target", mode: "self", children: [dmg1] }],
      ctx({ targets: [target], rng: seqRng(1) }),
    );
    expect(out.mutations[0]).toMatchObject({ target: { kind: "self" } });
  });

  it("mode position: picks the Nth target; out of range obeys the error policy", () => {
    const picked = runAutomation(
      [{ kind: "target", mode: "position", index: 1, children: [dmg1] }],
      ctx({ targets: [target, tough], rng: seqRng(1) }),
    );
    expect(picked.mutations[0]).toMatchObject({ target: { kind: "target", index: 1 } });

    const missing = runAutomation(
      [{ kind: "target", mode: "position", index: 5, children: [dmg1], onError: { on: "raise" } }],
      ctx({ targets: [target], rng: seqRng(1) }),
    );
    expect(missing.aborted).toBe(true);
    expect(missing.mutations).toEqual([]);
  });

  it("mode all over an empty target list runs nothing (an area that caught no one)", () => {
    const out = runAutomation(
      [{ kind: "target", mode: "all", children: [{ kind: "text", body: "hit" }] }],
      ctx({ targets: [], rng: seqRng(1) }),
    );
    expect(out.log).toEqual([]);
    expect(out.aborted).toBe(false);
  });

  it("restores the enclosing scope after the node", () => {
    const out = runAutomation(
      [{ kind: "target", mode: "self", children: [dmg1] }, dmg1],
      ctx({ targets: [target], rng: seqRng(1) }),
    );
    expect(out.mutations.map((m) => m.kind === "damage" && m.target)).toEqual([{ kind: "self" }, { kind: "target", index: 0 }]);
  });

  it("a raise inside children still aborts the whole run", () => {
    const out = runAutomation(
      [
        { kind: "target", mode: "all", children: [{ kind: "variable", name: "x", value: v("nope"), onError: { on: "raise" } }] },
        { kind: "text", body: "after" },
      ],
      ctx({ targets: [target, tough], rng: seqRng(1) }),
    );
    expect(out.aborted).toBe(true);
    expect(out.log).toEqual([]);
  });
});

describe("rollMode — shared vs per-target", () => {
  const tough = { ...target, ac: { value: 25, shieldBonus: 0 } };

  it("per-target (default) re-rolls damage for each target", () => {
    const out = runAutomation(
      [{ kind: "target", mode: "all", children: [{ kind: "damage", components: [{ formula: "1d6", type: "fire" }] }] }],
      ctx({ targets: [target, tough], rng: seqRng(2, 5) }),
    );
    expect(out.mutations.map((m) => m.kind === "damage" && m.amount)).toEqual([2, 5]);
  });

  it("shared rolls the damage once and reuses it for every target", () => {
    const out = runAutomation(
      [
        {
          kind: "target",
          mode: "all",
          children: [{ kind: "damage", components: [{ formula: "1d6", type: "fire" }], rollMode: "shared" }],
        },
      ],
      ctx({ targets: [target, tough], rng: seqRng(2, 5) }),
    );
    expect(out.mutations.map((m) => m.kind === "damage" && m.amount)).toEqual([2, 2]);
  });

  // Owner's example 1: fireball at several targets — each rolls its OWN save
  // against the shared spell DC, but the damage is rolled ONCE and then scaled
  // by each target's own result.
  it("fireball: per-target saves, one shared damage roll scaled per target", () => {
    const out = runAutomation(
      [
        {
          kind: "target",
          mode: "all",
          children: [
            { kind: "save", save: "reflex", dc: { kind: "flat", value: lit(20) }, basicSave: true },
            { kind: "damage", components: [{ formula: "6d6", type: "fire" }], scaling: { by: "basic-save" }, rollMode: "shared" },
          ],
        },
      ],
      // target reflex +3, tough reflex +3. d20 faces: 20 (crit success) then 1 (crit fail);
      // between them the shared 6d6 rolls six 3s = 18.
      ctx({ targets: [target, tough], rng: seqRng(20, 3, 3, 3, 3, 3, 3, 1) }),
    );
    const dmg = out.mutations.filter((m) => m.kind === "damage");
    // First target crit-succeeds → 0. Second crit-fails → the SAME 18, doubled → 36.
    expect(dmg.map((m) => m.kind === "damage" && m.amount)).toEqual([0, 36]);
    expect(dmg.map((m) => m.kind === "damage" && m.target)).toEqual([
      { kind: "target", index: 0 },
      { kind: "target", index: 1 },
    ]);
  });

  // Owner's example 2: a fighter feat that makes ONE attack roll compared against
  // each enemy's AC, with a single damage roll shared between them.
  it("fighter feat: one shared attack roll vs each AC, one shared damage roll", () => {
    const out = runAutomation(
      [
        {
          kind: "target",
          mode: "all",
          children: [
            { kind: "attack", bonus: lit(10), rollMode: "shared" },
            { kind: "damage", components: [{ formula: "1d8 + 4", type: "slashing" }], scaling: { by: "attack" }, rollMode: "shared" },
          ],
        },
      ],
      // ONE d20 face of 10 → total 20: beats AC 18 (hit), misses AC 25. Then one 1d8 = 4 → 8 damage.
      ctx({ targets: [target, tough], rng: seqRng(10, 4) }),
    );
    const checks = out.log.filter((e) => e.kind === "check");
    // Same roll, different DCs → different degrees
    expect(checks.map((e) => e.kind === "check" && e.die)).toEqual([10, 10]);
    expect(checks.map((e) => e.kind === "check" && e.total)).toEqual([20, 20]);
    expect(checks.map((e) => e.kind === "check" && e.degree)).toEqual(["success", "failure"]);
    // Hit deals the shared 8; miss deals none.
    expect(out.mutations.map((m) => m.kind === "damage" && m.amount)).toEqual([8, 0]);
  });

  it("a shared roll outside any target scope is just a normal single roll", () => {
    const out = runAutomation(
      [{ kind: "damage", components: [{ formula: "1d6", type: "fire" }], rollMode: "shared" }],
      ctx({ targets: [target], rng: seqRng(3) }),
    );
    expect(out.mutations[0]).toMatchObject({ amount: 3 });
  });
});

describe("applyEffect / removeEffect", () => {
  const frightened: EffectTemplate = {
    name: "Frightened 1",
    duration: { kind: "rounds", count: 1 },
    tickTiming: { when: "end", whose: "bearer" },
    passives: [{ kind: "modifier", target: "will", bonusType: "status", value: lit(-1) }],
  };

  it("carries the effect's own traits, which a `when` predicate reads as effect:trait:", () => {
    // The declaration that makes "+1 to saves against death effects" representable:
    // without it there is nothing for such a predicate to test. Optional, so a
    // template that declares none still validates — absence is not evidence.
    const withTraits: EffectTemplate = { ...frightened, traits: ["emotion", "fear", "mental"] };
    expect(effectTemplateSchema.safeParse(withTraits).success).toBe(true);
    expect(effectTemplateSchema.safeParse(frightened).success).toBe(true);
    expect(effectTemplateSchema.safeParse({ ...frightened, traits: [""] }).success).toBe(false);

    // And the traits reach a tag set that a predicate resolves against.
    const tags = rollTags({ effect: { traits: withTraits.traits } });
    expect(evaluatePredicate({ tag: "effect:trait:fear" }, tags)).toBe(true);
    expect(evaluatePredicate({ tag: "effect:trait:death" }, tags)).toBe(false);
  });

  it("declares the conditions it inflicts, validated against the closed vocabulary", () => {
    // The read side of "+2 to saves against effects that would make you enfeebled".
    // Unlike traits (free text), conditions are a closed 41-slug list — so a typo is a
    // PARSE ERROR rather than a predicate that silently never matches.
    const withConditions: EffectTemplate = {
      ...frightened,
      conditions: [{ slug: "enfeebled", value: 2 }, { slug: "clumsy" }],
    };
    expect(effectTemplateSchema.safeParse(withConditions).success).toBe(true);
    expect(effectTemplateSchema.safeParse({ ...frightened, conditions: [{ slug: "enfeebeld" }] }).success).toBe(false);
    expect(effectTemplateSchema.safeParse({ ...frightened, conditions: [{ slug: "enfeebled", value: 0 }] }).success).toBe(false);

    // And the declaration reaches a tag set a predicate resolves against.
    const tags = rollTags({ effect: { conditions: withConditions.conditions } });
    expect(evaluatePredicate({ tag: "effect:causes:enfeebled" }, tags)).toBe(true);
    expect(evaluatePredicate({ tag: "effect:causes:drained" }, tags)).toBe(false);
  });

  it("emits an applyEffect mutation carrying the template, defaulting to the current target", () => {
    const out = runAutomation([{ kind: "applyEffect", effect: frightened }], ctx({ targets: [target], rng: seqRng(1) }));
    expect(out.mutations).toEqual([
      { kind: "applyEffect", target: { kind: "target", index: 0 }, effect: frightened },
    ]);
  });

  it("applies to every creature inside a target scope", () => {
    const out = runAutomation(
      [{ kind: "target", mode: "all", children: [{ kind: "applyEffect", effect: frightened }] }],
      ctx({ targets: [target, { ...target, ac: { value: 25, shieldBonus: 0 } }], rng: seqRng(1) }),
    );
    expect(out.mutations.map((m) => m.kind === "applyEffect" && m.target)).toEqual([
      { kind: "target", index: 0 },
      { kind: "target", index: 1 },
    ]);
  });

  // The doc's load-bearing case: ONE invocation applies paired effects to TWO
  // actors — Grappled on the target and Grappling on the caster — joined so that
  // removing either removes both.
  it("links a paired application across two actors (Grapple)", () => {
    const grappled: EffectTemplate = { name: "Grappled", duration: { kind: "unlimited" }, passives: [] };
    const grappling: EffectTemplate = { name: "Grappling", duration: { kind: "unlimited" }, passives: [] };
    const out = runAutomation(
      [
        { kind: "applyEffect", effect: grappled, target: "target", linkGroup: "grapple" },
        { kind: "applyEffect", effect: grappling, target: "self", linkGroup: "grapple" },
      ],
      ctx({ targets: [target], rng: seqRng(1) }),
    );
    expect(out.mutations).toEqual([
      { kind: "applyEffect", target: { kind: "target", index: 0 }, effect: grappled, linkGroup: "grapple" },
      { kind: "applyEffect", target: { kind: "self" }, effect: grappling, linkGroup: "grapple" },
    ]);
  });

  it("removeEffect emits by name, with cascade defaulting to false", () => {
    const out = runAutomation(
      [
        { kind: "removeEffect", name: "Grappled", cascade: true },
        { kind: "removeEffect", name: "Slowed", target: "self" },
      ],
      ctx({ targets: [target], rng: seqRng(1) }),
    );
    expect(out.mutations).toEqual([
      { kind: "removeEffect", target: { kind: "target", index: 0 }, name: "Grappled", cascade: true },
      { kind: "removeEffect", target: { kind: "self" }, name: "Slowed", cascade: false },
    ]);
  });

  it("no target in scope obeys the error policy", () => {
    const out = runAutomation(
      [{ kind: "applyEffect", effect: frightened, onError: { on: "warn" } }],
      ctx({ targets: [], rng: seqRng(1) }),
    );
    expect(out.mutations).toEqual([]);
    expect(out.warnings.some((w) => /applyEffect "Frightened 1"/.test(w))).toBe(true);
  });

  it("can be gated on a resolved degree (apply only on a failed save)", () => {
    const out = runAutomation(
      [
        {
          kind: "save",
          save: "will",
          dc: { kind: "flat", value: lit(30) }, // will +7, die 10 → 17 vs 30 → crit failure
          onCriticalFailure: [{ kind: "applyEffect", effect: frightened }],
        },
      ],
      ctx({ targets: [target], rng: fixedd20(10) }),
    );
    expect(out.mutations).toHaveLength(1);
    expect(out.mutations[0]).toMatchObject({ kind: "applyEffect" });
  });
});

describe("buttons — runButton (live by default)", () => {
  const escape: Button = {
    id: "escape",
    label: "Escape",
    automation: [{ kind: "check", check: "athletics", dc: { kind: "stat", who: "target", selector: "athletics" } }],
  };
  const grappler: ResolvedCharacter = { ...target, skills: { athletics: { modifier: 10, rank: 2, ability: "str" } } };

  // The owner's case: a grapple's escape DC is 10 + the GRAPPLER's Athletics. It is
  // NOT frozen at apply time — if the grappler becomes enfeebled 2 mid-grapple, the
  // DC follows, right now. [PF2e] divergence from Avrae's frozen-closure buttons.
  it("re-resolves a derived DC against the CURRENT stats every press", () => {
    // presser is the actor; the grappler is the creature the check is measured against
    const before = runButton(escape, { actor, targets: [grappler], rng: fixedd20(10) });
    expect(before.log.find((e) => e.kind === "check")).toMatchObject({ dc: 20 });

    // enfeebled 2 → the grappler's Athletics drops to +8 → escape DC is now 18
    const enfeebled: ResolvedCharacter = { ...grappler, skills: { athletics: { modifier: 8, rank: 2, ability: "str" } } };
    const after = runButton(escape, { actor, targets: [enfeebled], rng: fixedd20(10) });
    expect(after.log.find((e) => e.kind === "check")).toMatchObject({ dc: 18 });
  });

  it("merges an effect's captured values in as starting variables", () => {
    const frozen: Button = {
      id: "b",
      label: "B",
      automation: [{ kind: "check", check: "athletics", dc: { kind: "flat", value: v("escapeDc") } }],
    };
    const out = runButton(frozen, { actor, targets: [target], rng: fixedd20(10) }, { escapeDc: 25 });
    expect(out.log.find((e) => e.kind === "check")).toMatchObject({ dc: 25 });
  });

  it("a button can mix a live lookup with a frozen one, and re-enters the full node set", () => {
    const mixed: Button = {
      id: "b",
      label: "B",
      automation: [
        { kind: "check", check: "athletics", dc: { kind: "stat", who: "target", selector: "athletics" } },
        { kind: "damage", components: [{ formula: "castRank", type: "fire" }], scaling: { by: "attack" } },
      ],
    };
    const out = runButton(mixed, { actor, targets: [grappler], rng: fixedd20(10) }, { castRank: 5 });
    // live DC from the grappler, frozen 5 damage from the captured cast rank
    expect(out.log.find((e) => e.kind === "check")).toMatchObject({ dc: 20 });
    expect(out.mutations.find((m) => m.kind === "damage")).toMatchObject({ amount: 5 });
  });
});

describe("applyEffect — capture (opt-in freeze)", () => {
  const tpl: EffectTemplate = { name: "Grappled", duration: { kind: "unlimited" }, passives: [] };

  it("evaluates capture expressions at APPLY time and rides them along", () => {
    const out = runAutomation(
      [{ kind: "applyEffect", effect: tpl, capture: { escapeDc: v("classDc"), castRank: lit(3) } }],
      ctx({ targets: [target], rng: seqRng(1) }),
    );
    // the actor's classDc is 18, frozen now
    expect(out.mutations[0]).toMatchObject({ captured: { escapeDc: 18, castRank: 3 } });
  });

  it("omits captured entirely when nothing is captured (live is the default)", () => {
    const out = runAutomation([{ kind: "applyEffect", effect: tpl }], ctx({ targets: [target], rng: seqRng(1) }));
    expect(out.mutations[0]).not.toHaveProperty("captured");
  });

  it("a failing capture expression obeys the error policy", () => {
    const out = runAutomation(
      [{ kind: "applyEffect", effect: tpl, capture: { x: v("nope") }, onError: { on: "warn" } }],
      ctx({ targets: [target], rng: seqRng(1) }),
    );
    expect(out.mutations).toEqual([]);
    expect(out.warnings.some((w) => /applyEffect "Grappled"/.test(w))).toBe(true);
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

  it("validates a counter node and rejects an empty counter id", () => {
    expect(
      automationSchema.safeParse([
        { kind: "counter", counter: "focus", amount: { kind: "lit", value: 1 }, requireAvailable: true, allowOverflow: false, name: "spend" },
      ]).success,
    ).toBe(true);
    expect(automationSchema.safeParse([{ kind: "counter", counter: "", amount: { kind: "lit", value: 1 } }]).success).toBe(false);
    expect(automationSchema.safeParse([{ kind: "counter", counter: "focus" }]).success).toBe(false); // amount required
  });

  it("validates rollMode on actor-rolled nodes and rejects it on save", () => {
    expect(automationSchema.safeParse([{ kind: "attack", bonus: { kind: "lit", value: 9 }, rollMode: "shared" }]).success).toBe(true);
    expect(
      automationSchema.safeParse([{ kind: "damage", components: [{ formula: "1d6" }], rollMode: "per-target" }]).success,
    ).toBe(true);
    expect(automationSchema.safeParse([{ kind: "attack", bonus: { kind: "lit", value: 9 }, rollMode: "once" }]).success).toBe(false);
    // a save is rolled BY each target, so it has no rollMode
    expect(
      automationSchema.safeParse([
        { kind: "save", save: "reflex", dc: { kind: "flat", value: { kind: "lit", value: 20 } }, rollMode: "shared" },
      ]).success,
    ).toBe(false);
  });

  it("validates applyEffect / removeEffect nodes", () => {
    expect(
      automationSchema.safeParse([
        {
          kind: "applyEffect",
          effect: { name: "Grappled", duration: { kind: "unlimited" }, passives: [] },
          target: "target",
          linkGroup: "grapple",
        },
      ]).success,
    ).toBe(true);
    expect(automationSchema.safeParse([{ kind: "removeEffect", name: "Grappled", cascade: true }]).success).toBe(true);
    // a template must carry a valid duration and its passives
    expect(
      automationSchema.safeParse([{ kind: "applyEffect", effect: { name: "X", duration: { kind: "forever" }, passives: [] } }]).success,
    ).toBe(false);
    expect(automationSchema.safeParse([{ kind: "removeEffect" }]).success).toBe(false); // name required
  });

  it("validates an effect template carrying buttons and granted actions", () => {
    expect(
      automationSchema.safeParse([
        {
          kind: "applyEffect",
          effect: {
            name: "Grappled",
            duration: { kind: "unlimited" },
            passives: [],
            tickTiming: { when: "end", whose: "bearer" },
            tickButton: "recover",
            buttons: [{ id: "recover", label: "Recovery check", automation: [{ kind: "text", body: "flat check" }] }],
            grantedActions: [{ id: "escape", name: "Escape", actionCost: { kind: "actions", min: 1, max: 1 } }],
          },
          capture: { escapeDc: { kind: "lit", value: 20 } },
        },
      ]).success,
    ).toBe(true);
  });

  it("rejects a button with no id/label and an unknown template field", () => {
    const eff = { name: "X", duration: { kind: "unlimited" }, passives: [] };
    expect(
      automationSchema.safeParse([{ kind: "applyEffect", effect: { ...eff, buttons: [{ label: "no id", automation: [] }] } }]).success,
    ).toBe(false);
    expect(automationSchema.safeParse([{ kind: "applyEffect", effect: { ...eff, bogus: 1 } }]).success).toBe(false);
  });

  it("validates a target node with nested children", () => {
    expect(
      automationSchema.safeParse([
        { kind: "target", mode: "all", children: [{ kind: "damage", components: [{ formula: "1d6", type: "fire" }] }] },
      ]).success,
    ).toBe(true);
    expect(automationSchema.safeParse([{ kind: "target", mode: "position", index: 2, children: [] }]).success).toBe(true);
    expect(automationSchema.safeParse([{ kind: "target", mode: "everyone", children: [] }]).success).toBe(false);
    expect(automationSchema.safeParse([{ kind: "target", mode: "all" }]).success).toBe(false); // children required
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

describe("interval heightening (damage.heightening)", () => {
  // seqRng(1) makes every die roll 1 whatever its size, so a damage total EQUALS the
  // number of dice rolled — which lets these assert dice counts directly.
  const fireball = (castRank: number, over: Partial<ExecutionContext> = {}) =>
    runAutomation(
      [
        {
          kind: "damage",
          components: [{ formula: "6d6", type: "fire" }],
          heightening: { step: 1, components: [{ formula: "2d6", type: "fire" }] },
        },
      ],
      ctx({ targets: [target], rng: seqRng(1), spell: { baseRank: 3, castRank }, ...over }),
    );

  it("walks the fireball ladder from the rules text: 6d6 -> 8d6 -> 10d6", () => {
    expect(fireball(3).mutations[0]).toMatchObject({ kind: "damage", amount: 6 });
    expect(fireball(4).mutations[0]).toMatchObject({ kind: "damage", amount: 8 });
    expect(fireball(5).mutations[0]).toMatchObject({ kind: "damage", amount: 10 });
    expect(fireball(10).mutations[0]).toMatchObject({ kind: "damage", amount: 20 });
  });

  it("is unheightened at the base rank and below", () => {
    expect(fireball(3).mutations[0]).toMatchObject({ amount: 6 });
    expect(fireball(1).mutations[0]).toMatchObject({ amount: 6 });
  });

  it("floors a partial increment: a +2 spell gains nothing one rank up", () => {
    const step2 = (castRank: number) =>
      runAutomation(
        [
          {
            kind: "damage",
            components: [{ formula: "1d6" }],
            heightening: { step: 2, components: [{ formula: "1d6" }] },
          },
        ],
        ctx({ targets: [target], rng: seqRng(1), spell: { baseRank: 1, castRank } }),
      ).mutations[0];
    expect(step2(2)).toMatchObject({ amount: 1 });
    expect(step2(3)).toMatchObject({ amount: 2 });
    expect(step2(5)).toMatchObject({ amount: 3 });
  });

  it("scales a mixed formula's FLAT term too, not just its dice", () => {
    // The reason heightening repeat-rolls rather than scaling a dice count: one
    // increment of `1d4+1` is 2 here, so two increments must add 4, not 3.
    const out = runAutomation(
      [
        {
          kind: "damage",
          components: [{ formula: "1d4+1" }],
          heightening: { step: 1, components: [{ formula: "1d4+1" }] },
        },
      ],
      ctx({ targets: [target], rng: seqRng(1), spell: { baseRank: 1, castRank: 3 } }),
    );
    expect(out.mutations[0]).toMatchObject({ amount: 6 }); // 2 base + 2 + 2
  });

  it("keeps ONE instance per component, so resistance applies once per type", () => {
    expect(fireball(5).mutations[0]).toMatchObject({
      kind: "damage",
      amount: 10,
      instances: [
        { amount: 6, type: "fire" },
        { amount: 4, type: "fire" }, // both increments, merged into one instance
      ],
    });
  });

  it("warns and deals unheightened damage when the context carries no spell", () => {
    const out = fireball(5, { spell: undefined });
    expect(out.mutations[0]).toMatchObject({ amount: 6 });
    expect(out.warnings).toContain("damage heightening: no spell rank in context");
  });

  it("heightens a SHARED roll once, then scales it by each target's own save", () => {
    // Fireball proper: every creature rolls its own save, but the 10d6 is rolled once
    // and shared — each target's degree then scales that same total independently.
    const a: ResolvedCharacter = { ...target, saves: { ...target.saves, reflex: { modifier: 20, rank: 2 } } };
    const b: ResolvedCharacter = { ...target, saves: { ...target.saves, reflex: { modifier: -5, rank: 0 } } };
    const out = runAutomation(
      [
        {
          kind: "target",
          mode: "all",
          children: [
            { kind: "save", save: "reflex", dc: { kind: "flat", value: lit(20) }, basicSave: true },
            {
              kind: "damage",
              components: [{ formula: "6d6", type: "fire" }],
              heightening: { step: 1, components: [{ formula: "2d6", type: "fire" }] },
              scaling: { by: "basic-save" },
              rollMode: "shared",
            },
          ],
        },
      ],
      ctx({ targets: [a, b], rng: fixedd20(10), spell: { baseRank: 3, castRank: 5 } }),
    );
    // fixedd20 makes every die a 10 → the shared roll is 10 dice x 10 = 100.
    // a: +20 vs DC 20 → critical success → none. b: -5 → critical failure → double.
    expect(out.mutations).toMatchObject([
      { kind: "damage", target: { kind: "target", index: 0 }, amount: 0 },
      { kind: "damage", target: { kind: "target", index: 1 }, amount: 200 },
    ]);
  });
});

describe("flat heightening (castRank in scope)", () => {
  it("needs no new vocabulary — it is arithmetic over castRank/baseRank", () => {
    const out = runAutomation(
      [{ kind: "temphp", formula: "5 + 5 * (castRank - baseRank)" }],
      ctx({ spell: { baseRank: 1, castRank: 4 } }),
    );
    expect(out.mutations[0]).toMatchObject({ kind: "temphp", amount: 20 });
  });

  it("exposes the ranks to expressions, not only to dice", () => {
    const out = runAutomation(
      [{ kind: "variable", name: "n", value: v("castRank") }, { kind: "temphp", formula: "n" }],
      ctx({ spell: { baseRank: 2, castRank: 6 } }),
    );
    expect(out.mutations[0]).toMatchObject({ kind: "temphp", amount: 6 });
  });
});

describe("at-rank heightening (the heightened node)", () => {
  // Mystic Armor's shape: several "Heightened (Nth)" entries, of which exactly ONE is
  // read — the highest the cast reaches.
  const mysticArmor = (castRank: number, over: Partial<ExecutionContext> = {}) =>
    runAutomation(
      [
        {
          kind: "heightened",
          entries: [
            { minRank: 2, children: [{ kind: "text", body: "+1 AC" }] },
            { minRank: 5, children: [{ kind: "text", body: "+2 AC" }] },
            { minRank: 7, children: [{ kind: "text", body: "+3 AC" }] },
          ],
        },
      ],
      ctx({ spell: { baseRank: 1, castRank }, ...over }),
    );
  const bodies = (out: Outcome) =>
    out.log.flatMap((e) => (e.kind === "text" ? [e.body] : []));

  it("uses the highest applicable entry", () => {
    expect(bodies(mysticArmor(8))).toEqual(["+3 AC"]);
    expect(bodies(mysticArmor(7))).toEqual(["+3 AC"]);
  });

  it("treats an entry as a FLOOR, not an exact match: 4th rank still gets the 2nd entry", () => {
    // The trap: reading "the entry for the rank you're using" as an exact match would
    // leave a 4th-rank cast with no heightening at all.
    expect(bodies(mysticArmor(4))).toEqual(["+1 AC"]);
    expect(bodies(mysticArmor(6))).toEqual(["+2 AC"]);
  });

  it("never stacks entries — exactly one is read", () => {
    expect(bodies(mysticArmor(9))).toHaveLength(1);
  });

  it("is independent of authored order", () => {
    const descending = runAutomation(
      [
        {
          kind: "heightened",
          entries: [
            { minRank: 7, children: [{ kind: "text", body: "+3 AC" }] },
            { minRank: 5, children: [{ kind: "text", body: "+2 AC" }] },
            { minRank: 2, children: [{ kind: "text", body: "+1 AC" }] },
          ],
        },
      ],
      ctx({ spell: { baseRank: 1, castRank: 6 } }),
    );
    expect(bodies(descending)).toEqual(["+2 AC"]);
  });

  it("gains nothing below the lowest entry, without erroring", () => {
    const out = mysticArmor(1);
    expect(bodies(out)).toEqual([]);
    expect(out.warnings).toEqual([]);
    expect(out.aborted).toBe(false);
  });

  it("falls through the error policy when the context carries no spell", () => {
    const out = mysticArmor(5, { spell: undefined, onError: { on: "warn" } });
    expect(bodies(out)).toEqual([]);
    expect(out.warnings).toContain("heightened (no spell rank in context) failed");
  });

  it("composes with a cantrip's auto-heightened rank", () => {
    // A level-5 caster's cantrips are 3rd rank (half level, rounded up).
    const out = runAutomation(
      [
        {
          kind: "heightened",
          entries: [
            { minRank: 3, children: [{ kind: "text", body: "bigger" }] },
            { minRank: 9, children: [{ kind: "text", body: "biggest" }] },
          ],
        },
      ],
      ctx({ spell: { baseRank: 1, castRank: autoHeightenRank(actor.level) } }),
    );
    expect(bodies(out)).toEqual(["bigger"]);
  });
});

describe("heightening schema", () => {
  it("accepts both heightening shapes", () => {
    expect(
      automationSchema.safeParse([
        {
          kind: "damage",
          components: [{ formula: "6d6", type: "fire" }],
          heightening: { step: 1, components: [{ formula: "2d6", type: "fire" }] },
        },
        { kind: "heightened", entries: [{ minRank: 5, children: [{ kind: "text", body: "x" }] }] },
      ]).success,
    ).toBe(true);
  });

  it("rejects a step below 1, an empty entry list, and a non-integer rank", () => {
    expect(
      automationSchema.safeParse([
        { kind: "damage", components: [{ formula: "1d6" }], heightening: { step: 0, components: [{ formula: "1d6" }] } },
      ]).success,
    ).toBe(false);
    expect(automationSchema.safeParse([{ kind: "heightened", entries: [] }]).success).toBe(false);
    expect(
      automationSchema.safeParse([{ kind: "heightened", entries: [{ minRank: 2.5, children: [] }] }]).success,
    ).toBe(false);
  });
});

describe("degree adjustments — selected per ROLLER", () => {
  // OWNER RULING, 2026-07-19. Both creatures' passives are live in a resolution, but
  // a degree adjustment fires only for the creature ACTUALLY ROLLING. The worked case
  // the owner gave: Grapple is the actor's Athletics check against the target's
  // Fortitude DC. A target whose passive turns a successful Fortitude SAVE into a
  // critical success does NOT get it here — nobody made a save. Anything modifying
  // that Fortitude DC still applies, because the DC is built from the target's own
  // modifiers before any of this runs.
  //
  // "Success becomes a critical success" is the shape all 42 shipped rollAdjusts use.
  const fortSuccessToCrit: RollAdjustEffect = {
    kind: "rollAdjust",
    target: "fortitude",
    adjust: { type: "degreeMap", map: { success: "critical-success" } },
  };

  // Both DCs are chosen so seed 3 (a d20 of 15) lands on a PLAIN SUCCESS — the one
  // degree these adjustments rewrite. A critical success would hide the effect by
  // being the answer either way, which is what the first draft of this got wrong.
  /** The target rolls Fortitude (+5) → 20 vs DC 18: success by 2. */
  const saveTree: AutomationNode[] = [
    { kind: "save", save: "fortitude", dc: { kind: "flat", value: { kind: "lit", value: 18 } } },
  ];

  /** Grapple-shaped: the ACTOR rolls Athletics (+11) → 26 vs DC 20: success by 6. */
  const grappleTree: AutomationNode[] = [
    { kind: "check", check: "athletics", dc: { kind: "flat", value: { kind: "lit", value: 20 } } },
  ];

  const degreeOf = (out: ReturnType<typeof runAutomation>) => {
    const entry = out.log.find((l) => l.kind === "check");
    return entry?.kind === "check" ? entry.degree : undefined;
  };

  it("fires the TARGET's adjustment on a save, because the target rolls it", () => {
    const adjusted = { ...target, rollAdjusts: [fortSuccessToCrit] };
    const out = runAutomation(saveTree, ctx({ targets: [adjusted], rng: makeRng(3) }));
    expect(degreeOf(out)).toBe("critical-success");

    // Same roll, same seed, without the passive: a plain success. So the adjustment
    // is what moved it, not the dice.
    const plain = runAutomation(saveTree, ctx({ targets: [target], rng: makeRng(3) }));
    expect(degreeOf(plain)).toBe("success");
  });

  it("does NOT fire the target's Fortitude adjustment on a CHECK against its Fort DC", () => {
    // THE GRAPPLE CASE. The target carries the same passive, and the roll is
    // resolved against Fortitude — but the ACTOR is rolling, so it must not apply.
    const adjusted = { ...target, rollAdjusts: [fortSuccessToCrit] };
    const withPassive = runAutomation(grappleTree, ctx({ targets: [adjusted], rng: makeRng(3) }));
    const without = runAutomation(grappleTree, ctx({ targets: [target], rng: makeRng(3) }));
    expect(degreeOf(withPassive)).toBe(degreeOf(without));
    expect(degreeOf(withPassive)).toBe("success");
  });

  it("fires the ACTOR's adjustment on a check, because the actor rolls it", () => {
    const athleticsBoost: RollAdjustEffect = {
      kind: "rollAdjust",
      target: "athletics",
      adjust: { type: "degreeMap", map: { success: "critical-success" } },
    };
    const out = runAutomation(
      grappleTree,
      ctx({ actor: { ...actor, rollAdjusts: [athleticsBoost] }, targets: [target], rng: makeRng(3) }),
    );
    expect(degreeOf(out)).toBe("critical-success");
  });

  it("does NOT fire the ACTOR's save adjustment on a save the TARGET rolls", () => {
    // The mirror of the Grapple case: the actor's own Fortitude passive is theirs,
    // and a save node is rolled by someone else.
    const out = runAutomation(
      saveTree,
      ctx({ actor: { ...actor, rollAdjusts: [fortSuccessToCrit] }, targets: [target], rng: makeRng(3) }),
    );
    expect(degreeOf(out)).toBe("success");
  });

  it("ignores an adjustment for a DIFFERENT statistic", () => {
    const willOnly: RollAdjustEffect = {
      kind: "rollAdjust",
      target: "will",
      adjust: { type: "degreeMap", map: { success: "critical-success" } },
    };
    const out = runAutomation(
      saveTree,
      ctx({ targets: [{ ...target, rollAdjusts: [willOnly] }], rng: makeRng(3) }),
    );
    expect(degreeOf(out)).toBe("success");
  });

  it("a creature with no rollAdjusts resolves exactly as before", () => {
    // Backward compatibility: the field is optional, and every existing host omits
    // it. Absent must mean "no adjustments", never a crash.
    const out = runAutomation(saveTree, ctx({ targets: [target], rng: makeRng(3) }));
    expect(degreeOf(out)).toBe("success");
    expect(out.warnings).toEqual([]);
  });
});
