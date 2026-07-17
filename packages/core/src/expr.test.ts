import { describe, expect, it } from "vitest";
import {
  evaluate,
  evaluateString,
  parseExpr,
  type Expr,
  type ExprScope,
} from "./expr.js";

describe("evaluate (AST)", () => {
  it("returns literals", () => {
    expect(evaluate({ kind: "lit", value: 5 })).toBe(5);
    expect(evaluate({ kind: "lit", value: true })).toBe(true);
    expect(evaluate({ kind: "lit", value: "athletics" })).toBe("athletics");
  });

  it("resolves variables from scope, throws on unknown", () => {
    const scope: ExprScope = { vars: { strengthMod: 4, level: 5 } };
    expect(evaluate({ kind: "var", name: "strengthMod" }, scope)).toBe(4);
    expect(() => evaluate({ kind: "var", name: "wisdomMod" }, scope)).toThrow(/unknown variable/);
  });

  it("evaluates the pure function set", () => {
    const add: Expr = { kind: "call", fn: "add", args: [{ kind: "lit", value: 2 }, { kind: "lit", value: 3 }] };
    expect(evaluate(add)).toBe(5);
    const cmp: Expr = { kind: "call", fn: "gte", args: [{ kind: "lit", value: 5 }, { kind: "lit", value: 3 }] };
    expect(evaluate(cmp)).toBe(true);
  });

  it("throws on an unknown function", () => {
    expect(() => evaluate({ kind: "call", fn: "bogus", args: [] })).toThrow(/unknown function/);
  });
});

describe("scope-aware functions (rank)", () => {
  const scope: ExprScope = {
    vars: { level: 5 },
    functions: { rank: (a) => (a[0] === "athletics" ? 2 : 0) },
  };
  it("calls a host-provided function with its string argument", () => {
    expect(evaluateString('rank("athletics")', scope)).toBe(2);
    expect(evaluateString('rank("stealth")', scope)).toBe(0);
  });
  it("uses the result in a larger expression", () => {
    // Trained (rank 2) → +2, else +0.
    expect(evaluateString('ternary(gte(rank("athletics"),1),2,0)', scope)).toBe(2);
  });
});

describe("typed coercion via `expected`", () => {
  it("coerces a boolean result to 1/0 for a numeric slot", () => {
    expect(evaluate({ kind: "call", fn: "gte", args: [{ kind: "lit", value: 1 }, { kind: "lit", value: 0 }] }, {}, "number")).toBe(1);
  });
  it("coerces a number to truthy for a boolean slot", () => {
    expect(evaluate({ kind: "lit", value: 3 }, {}, "boolean")).toBe(true);
    expect(evaluate({ kind: "lit", value: 0 }, {}, "boolean")).toBe(false);
  });
  it("rejects a string where a number/boolean is required", () => {
    expect(() => evaluate({ kind: "lit", value: "x" }, {}, "number")).toThrow(/expected a number/);
  });
});

describe("parseExpr (string grammar → AST)", () => {
  it("parses numbers, strings, @actor.level, and bare vars", () => {
    expect(parseExpr("3")).toEqual({ kind: "lit", value: 3 });
    expect(parseExpr("@actor.level")).toEqual({ kind: "var", name: "level" });
    expect(parseExpr("strengthMod")).toEqual({ kind: "var", name: "strengthMod" });
    expect(parseExpr('"athletics"')).toEqual({ kind: "lit", value: "athletics" });
  });

  it("parses nested function calls", () => {
    expect(parseExpr("max(1,add(2,3))")).toEqual({
      kind: "call",
      fn: "max",
      args: [
        { kind: "lit", value: 1 },
        { kind: "call", fn: "add", args: [{ kind: "lit", value: 2 }, { kind: "lit", value: 3 }] },
      ],
    });
  });

  it("rejects unknown @-refs, braces, and trailing tokens", () => {
    expect(() => parseExpr("@actor.system.proficiencies.rank")).toThrow();
    expect(() => parseExpr("{item|flags}")).toThrow();
    expect(() => parseExpr("max(1,2)extra")).toThrow();
  });
});

// Infix desugars to the SAME call nodes a structured builder emits, so the stored
// AST and `exprSchema` are untouched by this grammar — it is a parser surface, not
// a value shape.
describe("parseExpr (infix arithmetic)", () => {
  it("desugars the four operators to their pure functions", () => {
    expect(parseExpr("1+2")).toEqual({
      kind: "call",
      fn: "add",
      args: [{ kind: "lit", value: 1 }, { kind: "lit", value: 2 }],
    });
    expect(parseExpr("@actor.level/2")).toEqual({
      kind: "call",
      fn: "divide",
      args: [{ kind: "var", name: "level" }, { kind: "lit", value: 2 }],
    });
  });

  it("honors precedence and left-associativity", () => {
    // 1 + 2*3 → add(1, multiply(2,3)), not multiply(add(1,2),3)
    expect(parseExpr("1+2*3")).toEqual({
      kind: "call",
      fn: "add",
      args: [
        { kind: "lit", value: 1 },
        { kind: "call", fn: "multiply", args: [{ kind: "lit", value: 2 }, { kind: "lit", value: 3 }] },
      ],
    });
    // 10-3-2 → subtract(subtract(10,3),2) = 5, NOT subtract(10,subtract(3,2)) = 9
    expect(evaluateString("10-3-2", {}, "number")).toBe(5);
    expect(evaluateString("12/3/2", {}, "number")).toBe(2);
    expect(evaluateString("(1+2)*3", {}, "number")).toBe(9);
  });

  it("distinguishes a negative literal from subtraction", () => {
    expect(parseExpr("-2")).toEqual({ kind: "lit", value: -2 });
    expect(evaluateString("5-3", {}, "number")).toBe(2);
    expect(evaluateString("max(-2,-5)", {}, "number")).toBe(-2);
    // Unary minus on a non-literal.
    expect(evaluateString("-@actor.level", { vars: { level: 3 } }, "number")).toBe(-3);
  });

  it("parses the half-your-level idiom — every ancestry resistance in the corpus", () => {
    const expr = "max(1,floor(@actor.level/2))";
    expect(evaluateString(expr, { vars: { level: 6 } }, "number")).toBe(3);
    expect(evaluateString(expr, { vars: { level: 5 } }, "number")).toBe(2);
    // The max(1,…) floor is why these resistances apply from level 1.
    expect(evaluateString(expr, { vars: { level: 1 } }, "number")).toBe(1);
    // The un-clamped variant genuinely rounds to 0 at level 1.
    expect(evaluateString("floor(@actor.level/2)", { vars: { level: 1 } }, "number")).toBe(0);
  });

  it("throws on division by zero rather than yielding Infinity", () => {
    expect(() => evaluateString("1/0", {}, "number")).toThrow(/division by zero/);
  });
});

// Behavior-preservation: the worked cases effects.ts's evalNumeric was locked on
// must produce identical results now that it delegates here.
describe("string round-trip preserves the old evalNumeric behavior", () => {
  const lvl = (level: number): ExprScope => ({ vars: { level } });

  it("handles the level ref and level-gated ranks", () => {
    expect(evaluateString("@actor.level", lvl(7), "number")).toBe(7);
    const expr = "ternary(gte(@actor.level,17),3,2)";
    expect(evaluateString(expr, lvl(16), "number")).toBe(2);
    expect(evaluateString(expr, lvl(17), "number")).toBe(3);
  });

  it("handles nested ternary / min / max / floor", () => {
    const expr = "ternary(gte(@actor.level,15),4,ternary(gte(@actor.level,7),3,2))";
    expect(evaluateString(expr, lvl(6), "number")).toBe(2);
    expect(evaluateString(expr, lvl(7), "number")).toBe(3);
    expect(evaluateString(expr, lvl(15), "number")).toBe(4);
    expect(evaluateString("floor(add(@actor.level,1))", lvl(4), "number")).toBe(5);
  });
});
