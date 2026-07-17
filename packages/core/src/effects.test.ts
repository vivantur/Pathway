import { describe, expect, it } from "vitest";
import { stackModifiers, type Modifier } from "./effects.js";

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
