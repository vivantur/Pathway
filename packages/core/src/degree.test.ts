import { describe, expect, it } from "vitest";
import {
  applyDegreeAdjustments,
  degreeOfSuccess,
  numericalDegree,
  shiftDegree,
  type DegreeAdjustment,
} from "./degree.js";

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

// Each map below is transcribed from the feat's own prose, quoted above it. No
// remembered PF2e: the encoding is a reading of the English, and the ordering rule
// it resolves under is owner-supplied (see applyDegreeAdjustments).
describe("conditional degree maps (real feats)", () => {
  // Adaptive Vision: "If you roll a success on a saving throw against a visual
  // effect, you get a critical success instead."
  const adaptiveVision: DegreeAdjustment = { map: { success: "critical-success" } };

  it("rewrites the degree it names", () => {
    expect(applyDegreeAdjustments("success", [adaptiveVision])).toBe("critical-success");
  });

  it("leaves every degree it does NOT name alone", () => {
    expect(applyDegreeAdjustments("failure", [adaptiveVision])).toBe("failure");
    expect(applyDegreeAdjustments("critical-failure", [adaptiveVision])).toBe("critical-failure");
    expect(applyDegreeAdjustments("critical-success", [adaptiveVision])).toBe("critical-success");
  });

  // Dragon's Presence: "When you roll a success on a saving throw against a fear
  // effect, you get a critical success instead. When you roll a failure against a
  // fear effect, you get a critical failure instead."
  const dragonsPresence: DegreeAdjustment = {
    map: { success: "critical-success", failure: "critical-failure" },
  };

  it("fires at most ONE entry per roll, in either direction", () => {
    expect(applyDegreeAdjustments("success", [dragonsPresence])).toBe("critical-success");
    expect(applyDegreeAdjustments("failure", [dragonsPresence])).toBe("critical-failure");
    // Named neither → untouched. The two entries never compound on one roll.
    expect(applyDegreeAdjustments("critical-failure", [dragonsPresence])).toBe("critical-failure");
    expect(applyDegreeAdjustments("critical-success", [dragonsPresence])).toBe("critical-success");
  });

  // Forager: "While using Survival to Subsist, if you roll any result worse than a
  // success, you get a success." A floor, expressed as a map — no clamp primitive.
  const forager: DegreeAdjustment = {
    map: { "critical-failure": "success", failure: "success" },
  };

  it("expresses a floor: everything below the floor is raised TO it", () => {
    expect(applyDegreeAdjustments("critical-failure", [forager])).toBe("success");
    expect(applyDegreeAdjustments("failure", [forager])).toBe("success");
  });

  it("a floor never drags a better result DOWN to it", () => {
    expect(applyDegreeAdjustments("success", [forager])).toBe("success");
    expect(applyDegreeAdjustments("critical-success", [forager])).toBe("critical-success");
  });

  it("carries a multi-step rewrite in one shot (crit failure → success is +2)", () => {
    expect(applyDegreeAdjustments("critical-failure", [forager])).toBe("success");
  });
});

// OWNER-SUPPLIED (2026-07-19): "apply all the effects that IMPROVE the degree,
// followed by any that WORSEN it. Each effect can only change the degree of success
// once."
describe("multiple adjustments — improvers first, then worseners", () => {
  const improve: DegreeAdjustment = "improve";
  const worsen: DegreeAdjustment = "worsen";

  it("applies both buckets to an unclamped degree", () => {
    // failure +1 → success, then -1 → failure. Nets out.
    expect(applyDegreeAdjustments("failure", [improve, worsen])).toBe("failure");
  });

  // THE case the ordering rule exists for. On a critical success the improvement
  // clamps away, but it is still APPLIED FIRST, so the worsening then bites into
  // the clamped value. Worsen-first would have given critical-success back.
  it("order is observable at the bounds: improve clamps, then worsen still applies", () => {
    expect(applyDegreeAdjustments("critical-success", [improve, worsen])).toBe("success");
  });

  it("the same holds at the bottom bound", () => {
    // worsen clamps at critical-failure, but improve ran FIRST (crit-fail → failure),
    // so the result is critical-failure, not failure.
    expect(applyDegreeAdjustments("critical-failure", [improve, worsen])).toBe("critical-failure");
  });

  it("is independent of the order effects appear in the array", () => {
    // A sheet lists effects in whatever order it stores them; the engine is pure.
    expect(applyDegreeAdjustments("critical-success", [worsen, improve])).toBe("success");
    expect(applyDegreeAdjustments("critical-failure", [worsen, improve])).toBe("critical-failure");
  });

  it("stacks multiple improvers, then multiple worseners", () => {
    expect(applyDegreeAdjustments("critical-failure", [improve, improve])).toBe("success");
    expect(applyDegreeAdjustments("critical-success", [worsen, worsen])).toBe("failure");
  });

  it("measures every effect against the SAME incoming degree — no cascading", () => {
    // If these chained, success → critical-success → failure. They do not: each is
    // measured against `success`, so the first improves (+1) and the second does not
    // apply at all (it names critical-success, which was not what was rolled).
    const a: DegreeAdjustment = { map: { success: "critical-success" } };
    const b: DegreeAdjustment = { map: { "critical-success": "failure" } };
    expect(applyDegreeAdjustments("success", [a, b])).toBe("critical-success");
    expect(applyDegreeAdjustments("success", [b, a])).toBe("critical-success");
  });

  it("mixes blanket shifts with conditional maps", () => {
    const forager: DegreeAdjustment = { map: { "critical-failure": "success", failure: "success" } };
    // failure: map improves +1 (→ success), blanket improve +1 → critical-success.
    expect(applyDegreeAdjustments("failure", [forager, improve])).toBe("critical-success");
    // success: the map is silent, so only the blanket worsen applies.
    expect(applyDegreeAdjustments("success", [forager, worsen])).toBe("failure");
  });

  it("no adjustments leaves the degree untouched", () => {
    expect(applyDegreeAdjustments("success", [])).toBe("success");
  });
});

describe("degreeOfSuccess integrates maps after the natural shift", () => {
  it("a nat 20 improves first, and the map then reads the SHIFTED degree", () => {
    // Numerical failure (14 vs 15). Nat 20 → success. The map names success → crit.
    expect(
      degreeOfSuccess({
        total: 14,
        dc: 15,
        die: 20,
        adjustments: [{ map: { success: "critical-success" } }],
      }),
    ).toBe("critical-success");
  });

  it("a map keyed to the PRE-natural degree does not fire", () => {
    // Same roll: numerically a failure, but the nat 20 makes it a success before
    // adjustments run, so a failure-keyed entry never sees it.
    expect(
      degreeOfSuccess({
        total: 14,
        dc: 15,
        die: 20,
        adjustments: [{ map: { failure: "critical-failure" } }],
      }),
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
