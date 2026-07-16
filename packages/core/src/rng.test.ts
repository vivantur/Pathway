import { describe, expect, it } from "vitest";
import { makeRng } from "./rng.js";

describe("makeRng — determinism", () => {
  it("the same seed yields an identical sequence", () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds diverge", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.next()).not.toBe(b.next());
  });
});

describe("makeRng — next() range", () => {
  it("stays in [0, 1)", () => {
    const r = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("makeRng — int(min, max) inclusive", () => {
  it("stays within [min, max] and hits both ends over many draws", () => {
    const r = makeRng(7);
    let lo = false;
    let hi = false;
    for (let i = 0; i < 2000; i++) {
      const v = r.int(1, 6); // a d6
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      if (v === 1) lo = true;
      if (v === 6) hi = true;
    }
    expect(lo && hi).toBe(true); // both extremes are reachable
  });

  it("collapses to min when max <= min", () => {
    const r = makeRng(3);
    expect(r.int(5, 5)).toBe(5);
    expect(r.int(9, 2)).toBe(9);
  });

  it("floors fractional bounds", () => {
    const r = makeRng(3);
    for (let i = 0; i < 50; i++) {
      const v = r.int(1.9, 3.9); // → [1, 3]
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
    }
  });
});
