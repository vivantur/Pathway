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

const ctx = (over: Partial<ExecutionContext> = {}): ExecutionContext => ({ actor, rng: makeRng(1), ...over });

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

  it("rejects an unknown node kind, missing branch arms, and extra fields", () => {
    expect(automationSchema.safeParse([{ kind: "roll", dice: "1d6" }]).success).toBe(false);
    expect(automationSchema.safeParse([{ kind: "branch", condition: { kind: "lit", value: true }, onTrue: [] }]).success).toBe(false);
    expect(automationSchema.safeParse([{ kind: "text", body: "x", extra: 1 }]).success).toBe(false);
  });

  it("rejects an unknown error-policy option", () => {
    expect(
      automationSchema.safeParse([{ kind: "variable", name: "n", value: { kind: "lit", value: 1 }, onError: { on: "explode" } }]).success,
    ).toBe(false);
  });
});
