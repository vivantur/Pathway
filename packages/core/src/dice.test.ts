import { describe, expect, it } from "vitest";
import { parseDice, rollDice, rollNotation, safeParseDice } from "./dice.js";
import { makeRng } from "./rng.js";

// A stub RNG returning a fixed sequence, so dice totals are exactly predictable.
function stubRng(...faces: number[]) {
  let i = 0;
  return {
    next: () => 0,
    int: (_min: number, _max: number) => faces[i++ % faces.length]!,
  };
}

describe("parseDice — structure", () => {
  it("parses NdM, bare dM, and constants", () => {
    expect(parseDice("2d6")).toEqual({ kind: "dice", count: 2, sides: 6 });
    expect(parseDice("d20")).toEqual({ kind: "dice", count: 1, sides: 20 });
    expect(parseDice("3")).toEqual({ kind: "num", value: 3 });
  });

  it("parses + and - with dice and constants", () => {
    expect(parseDice("1d8 + 3")).toEqual({
      kind: "binary",
      op: "+",
      left: { kind: "dice", count: 1, sides: 8 },
      right: { kind: "num", value: 3 },
    });
  });

  it("gives * and / higher precedence than + and -", () => {
    // 2 + 3 * 4  →  2 + (3*4)
    expect(parseDice("2 + 3 * 4")).toEqual({
      kind: "binary",
      op: "+",
      left: { kind: "num", value: 2 },
      right: { kind: "binary", op: "*", left: { kind: "num", value: 3 }, right: { kind: "num", value: 4 } },
    });
  });

  it("honors parentheses and unary minus", () => {
    expect(parseDice("(1 + 2) * 3")).toEqual({
      kind: "binary",
      op: "*",
      left: { kind: "binary", op: "+", left: { kind: "num", value: 1 }, right: { kind: "num", value: 2 } },
      right: { kind: "num", value: 3 },
    });
    expect(parseDice("-1d4")).toEqual({ kind: "neg", operand: { kind: "dice", count: 1, sides: 4 } });
  });

  it("treats a bare identifier as a variable, and strips {braces}", () => {
    expect(parseDice("strengthMod")).toEqual({ kind: "var", name: "strengthMod" });
    expect(parseDice("1d6 + {strengthMod}")).toEqual({
      kind: "binary",
      op: "+",
      left: { kind: "dice", count: 1, sides: 6 },
      right: { kind: "var", name: "strengthMod" },
    });
  });

  it("rejects malformed notation", () => {
    expect(safeParseDice("2d")).toBeNull(); // no sides
    expect(safeParseDice("1d6 +")).toBeNull(); // dangling operator
    expect(safeParseDice("(1d6")).toBeNull(); // unclosed paren
    expect(safeParseDice("2d6 3")).toBeNull(); // trailing token
    expect(safeParseDice("2.5d6")).toBeNull(); // fractional dice count
    expect(safeParseDice("")).toBeNull();
  });
});

describe("rollDice — evaluation with a seeded RNG", () => {
  it("sums each die and records every roll", () => {
    const roll = rollDice(parseDice("2d6"), stubRng(4, 5));
    expect(roll.total).toBe(9);
    expect(roll.dice).toEqual([
      { sides: 6, result: 4 },
      { sides: 6, result: 5 },
    ]);
  });

  it("applies the arithmetic: 2d6 + 3", () => {
    expect(rollDice(parseDice("2d6 + 3"), stubRng(6, 6)).total).toBe(15);
  });

  it("resolves variable terms from the supplied bag", () => {
    expect(rollDice(parseDice("1d8 + strengthMod"), stubRng(5), { strengthMod: 4 }).total).toBe(9);
  });

  it("supports * and /, flooring the FINAL total", () => {
    expect(rollDice(parseDice("1d6 * 2"), stubRng(3)).total).toBe(6);
    // (5 / 2) = 2.5 → floored to 2 at the end
    expect(rollDice(parseDice("1d6 / 2"), stubRng(5)).total).toBe(2);
  });

  it("throws on an unknown variable", () => {
    expect(() => rollDice(parseDice("1d6 + missing"), stubRng(3))).toThrow();
  });
});

describe("rollNotation — determinism via a real seeded RNG", () => {
  it("same seed → same total and dice", () => {
    const a = rollNotation("3d8 + 2", makeRng(42));
    const b = rollNotation("3d8 + 2", makeRng(42));
    expect(a).toEqual(b);
    expect(a.dice).toHaveLength(3);
    expect(a.total).toBeGreaterThanOrEqual(3 + 2);
    expect(a.total).toBeLessThanOrEqual(24 + 2);
  });
});
