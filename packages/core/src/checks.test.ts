import { describe, expect, it } from "vitest";
import { dcFromModifier, degreeOrdinal, rollCheck } from "./checks.js";

/** A stub RNG whose `int` always returns a fixed d20 face. */
const fixedd20 = (face: number) => ({ next: () => 0, int: (_min: number, _max: number) => face });

describe("dcFromModifier", () => {
  it("is 10 + the modifier", () => {
    expect(dcFromModifier(5)).toBe(15);
    expect(dcFromModifier(0)).toBe(10);
    expect(dcFromModifier(-2)).toBe(8);
  });
});

describe("degreeOrdinal", () => {
  it("orders worst → best, 0..3", () => {
    expect(degreeOrdinal("critical-failure")).toBe(0);
    expect(degreeOrdinal("failure")).toBe(1);
    expect(degreeOrdinal("success")).toBe(2);
    expect(degreeOrdinal("critical-success")).toBe(3);
  });
});

describe("rollCheck", () => {
  it("adds the modifier to the die and resolves the numeric degree", () => {
    // die 5 + mod 10 = 15 vs DC 15 → exactly meets → success
    expect(rollCheck({ modifier: 10, dc: 15, rng: fixedd20(5) })).toEqual({
      die: 5,
      total: 15,
      dc: 15,
      degree: "success",
    });
    // total beats DC by 10+ → critical success
    expect(rollCheck({ modifier: 20, dc: 15, rng: fixedd20(5) }).degree).toBe("critical-success");
    // total below DC by less than 10 → failure
    expect(rollCheck({ modifier: 0, dc: 15, rng: fixedd20(9) }).degree).toBe("failure");
    // fails by 10+ → critical failure
    expect(rollCheck({ modifier: 0, dc: 20, rng: fixedd20(5) }).degree).toBe("critical-failure");
  });

  it("applies the natural-20/1 shift via the die face", () => {
    // die 20, total 20 meets DC 20 → success, bumped one step by nat 20 → crit success
    expect(rollCheck({ modifier: 0, dc: 20, rng: fixedd20(20) }).degree).toBe("critical-success");
    // die 1, total 21 meets DC 20 → success, dropped one step by nat 1 → failure
    expect(rollCheck({ modifier: 20, dc: 20, rng: fixedd20(1) }).degree).toBe("failure");
  });
});
