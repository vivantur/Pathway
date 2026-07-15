import { describe, expect, it } from "vitest";
import { applyCounter, canSpend, clampCounter, type Counter } from "./counter.js";

describe("applyCounter — spending", () => {
  it("spends within range", () => {
    const r = applyCounter({ current: 3, max: 3 }, { amount: 1 });
    expect(r.remaining).toBe(2);
    expect(r.spent).toBe(1);
    expect(r.clamped).toBe(false);
    expect(r.counter).toEqual({ current: 2, max: 3 });
  });

  it("clamps a spend to the lower bound and reports the truncation", () => {
    const r = applyCounter({ current: 1, max: 3 }, { amount: 2 });
    expect(r.remaining).toBe(0);
    expect(r.spent).toBe(1); // only 1 was actually available
    expect(r.requested).toBe(2);
    expect(r.clamped).toBe(true);
  });

  it("honors a custom minimum", () => {
    const r = applyCounter({ current: 2, min: 1 }, { amount: 5 });
    expect(r.remaining).toBe(1);
    expect(r.clamped).toBe(true);
  });

  it("does nothing for a zero amount", () => {
    const r = applyCounter({ current: 2, max: 3 }, { amount: 0 });
    expect(r.remaining).toBe(2);
    expect(r.spent).toBe(0);
    expect(r.clamped).toBe(false);
  });
});

describe("applyCounter — recharging (negative amount)", () => {
  it("recharges toward max", () => {
    const r = applyCounter({ current: 1, max: 3 }, { amount: -1 });
    expect(r.remaining).toBe(2);
    expect(r.spent).toBe(-1); // negative = restored
    expect(r.clamped).toBe(false);
  });

  it("clamps a recharge at max", () => {
    const r = applyCounter({ current: 2, max: 3 }, { amount: -5 });
    expect(r.remaining).toBe(3);
    expect(r.spent).toBe(-1);
    expect(r.clamped).toBe(true);
  });

  it("an uncapped counter recharges without clamping", () => {
    const r = applyCounter({ current: 1 }, { amount: -10 });
    expect(r.remaining).toBe(11);
    expect(r.clamped).toBe(false);
  });
});

describe("applyCounter — allowOverflow", () => {
  it("spends below the minimum (counter as a free-form number store)", () => {
    const r = applyCounter({ current: 1 }, { amount: 3, allowOverflow: true });
    expect(r.remaining).toBe(-2);
    expect(r.clamped).toBe(false);
  });

  it("recharges above the maximum", () => {
    const r = applyCounter({ current: 3, max: 3 }, { amount: -2, allowOverflow: true });
    expect(r.remaining).toBe(5);
    expect(r.clamped).toBe(false);
  });
});

describe("applyCounter — purity", () => {
  it("does not mutate the input counter", () => {
    const c: Counter = { current: 3, max: 3 };
    applyCounter(c, { amount: 2 });
    expect(c.current).toBe(3);
  });
});

describe("canSpend", () => {
  it("reports whether a spend fits without hitting the floor", () => {
    expect(canSpend({ current: 1, max: 3 }, 1)).toBe(true);
    expect(canSpend({ current: 1, max: 3 }, 2)).toBe(false);
    expect(canSpend({ current: 3, min: 1 }, 2)).toBe(true);
    expect(canSpend({ current: 3, min: 1 }, 3)).toBe(false);
  });
});

describe("clampCounter", () => {
  it("pulls an out-of-range current back into bounds", () => {
    expect(clampCounter({ current: 5, max: 3 })).toEqual({ current: 3, max: 3 });
    expect(clampCounter({ current: -2 })).toEqual({ current: 0 });
  });
  it("returns the same object when already in range", () => {
    const c: Counter = { current: 2, max: 3 };
    expect(clampCounter(c)).toBe(c);
  });
});
