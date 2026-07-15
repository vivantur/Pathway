import { describe, expect, it } from "vitest";
import { degreeOfSuccess, numericalDegree, shiftDegree } from "./degree.js";

describe("numericalDegree (bands, no natural adjustment)", () => {
  it("meets/exceeds DC by 10+ → critical success", () => {
    expect(numericalDegree(25, 15)).toBe("critical-success"); // +10 exactly
    expect(numericalDegree(30, 15)).toBe("critical-success");
  });
  it("meets/exceeds DC by 0–9 → success", () => {
    expect(numericalDegree(15, 15)).toBe("success"); // exactly meets
    expect(numericalDegree(24, 15)).toBe("success"); // +9
  });
  it("below DC by less than 10 → failure", () => {
    expect(numericalDegree(14, 15)).toBe("failure"); // -1
    expect(numericalDegree(6, 15)).toBe("failure"); // -9
  });
  it("fails by 10 or more → critical failure", () => {
    expect(numericalDegree(5, 15)).toBe("critical-failure"); // -10 exactly
    expect(numericalDegree(1, 15)).toBe("critical-failure");
  });
});

describe("natural 20 / natural 1 (one-degree shift, applied to the numbers)", () => {
  it("nat 20 bumps an ordinary success to a critical success", () => {
    expect(degreeOfSuccess({ total: 15, dc: 15, die: 20 })).toBe("critical-success");
  });
  it("nat 1 drops an ordinary success to a failure", () => {
    expect(degreeOfSuccess({ total: 15, dc: 15, die: 1 })).toBe("failure");
  });

  // Worked example from the rules: a very high DC where 20+mod is 10+ below the
  // DC → numerical critical failure, so nat 20 yields only a FAILURE.
  it("nat 20 against a very high DC yields only a failure", () => {
    expect(degreeOfSuccess({ total: 10, dc: 30, die: 20 })).toBe("failure");
  });

  // Worked example from the rules: a modifier so high that 1+mod exceeds the DC
  // by 10+ → numerical critical success, so nat 1 still yields a SUCCESS.
  it("nat 1 with a very high modifier still succeeds", () => {
    expect(degreeOfSuccess({ total: 30, dc: 15, die: 1 })).toBe("success");
  });

  it("clamps: crit success + nat 20 stays crit success; crit fail + nat 1 stays crit fail", () => {
    expect(degreeOfSuccess({ total: 30, dc: 15, die: 20 })).toBe("critical-success");
    expect(degreeOfSuccess({ total: 1, dc: 30, die: 1 })).toBe("critical-failure");
  });

  it("a non-20/1 die face applies no natural shift", () => {
    expect(degreeOfSuccess({ total: 15, dc: 15, die: 11 })).toBe("success");
  });

  it("omitting the die (e.g. Assurance) applies no natural rule", () => {
    expect(degreeOfSuccess({ total: 15, dc: 15 })).toBe("success");
  });
});

describe("ability adjustments (after the natural shift, in order)", () => {
  it("applies improve/worsen as clamped one-step shifts", () => {
    expect(degreeOfSuccess({ total: 15, dc: 15, adjustments: ["improve"] })).toBe("critical-success");
    expect(degreeOfSuccess({ total: 15, dc: 15, adjustments: ["worsen"] })).toBe("failure");
  });

  it("resolves natural shift BEFORE ability adjustments", () => {
    // Numerical crit failure (total 10 vs DC 30). Nat 20 first → failure, then
    // improve → success. (17 different order would not matter here, but the
    // sequence is fixed by the rules.)
    expect(
      degreeOfSuccess({ total: 10, dc: 30, die: 20, adjustments: ["improve"] }),
    ).toBe("success");
  });
});

describe("shiftDegree", () => {
  it("shifts and clamps to the crit-fail/crit-success bounds", () => {
    expect(shiftDegree("failure", 1)).toBe("success");
    expect(shiftDegree("success", 2)).toBe("critical-success");
    expect(shiftDegree("critical-success", 1)).toBe("critical-success");
    expect(shiftDegree("critical-failure", -3)).toBe("critical-failure");
  });
});
