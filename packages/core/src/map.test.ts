import { describe, expect, it } from "vitest";
import {
  advanceAttackCount,
  AGILE_MAP,
  mapPenaltyPair,
  multipleAttackPenalty,
  STANDARD_MAP,
} from "./map.js";

describe("multiple attack penalty", () => {
  it("matches the Player Core table", () => {
    // First / second / third+ — standard and agile columns.
    expect(multipleAttackPenalty({ priorAttacks: 0 })).toBe(0);
    expect(multipleAttackPenalty({ priorAttacks: 1 })).toBe(-5);
    expect(multipleAttackPenalty({ priorAttacks: 2 })).toBe(-10);

    expect(multipleAttackPenalty({ priorAttacks: 0, agile: true })).toBe(0);
    expect(multipleAttackPenalty({ priorAttacks: 1, agile: true })).toBe(-4);
    expect(multipleAttackPenalty({ priorAttacks: 2, agile: true })).toBe(-8);
  });

  it("stays at the third-and-subsequent penalty however many attacks follow", () => {
    for (const prior of [3, 4, 7]) {
      expect(multipleAttackPenalty({ priorAttacks: prior })).toBe(-10);
      expect(multipleAttackPenalty({ priorAttacks: prior, agile: true })).toBe(-8);
    }
  });

  // THE worked example from the rules text, verbatim in structure: a longsword in
  // one hand and an agile shortsword in the other, three Strikes in a turn. This
  // is the case that catches any implementation caching a penalty instead of a
  // count — the penalty depends ONLY on the weapon swung right now.
  it("derives the penalty from the CURRENT weapon, not the previous ones", () => {
    // "The first Strike you make during your turn has no penalty, no matter what
    // weapon you are using."
    expect(multipleAttackPenalty({ priorAttacks: 0, agile: false })).toBe(0);
    expect(multipleAttackPenalty({ priorAttacks: 0, agile: true })).toBe(0);

    // "The second Strike will take either a –5 penalty if you use the longsword or
    // a –4 penalty if you use the shortsword."
    expect(multipleAttackPenalty({ priorAttacks: 1, agile: false })).toBe(-5);
    expect(multipleAttackPenalty({ priorAttacks: 1, agile: true })).toBe(-4);

    // "Your third attack would be a –10 penalty with the longsword and a –8 penalty
    // with the shortsword, no matter which weapon you used for your previous Strikes."
    expect(multipleAttackPenalty({ priorAttacks: 2, agile: false })).toBe(-10);
    expect(multipleAttackPenalty({ priorAttacks: 2, agile: true })).toBe(-8);
  });

  it("applies no penalty off-turn, whatever the count", () => {
    // "The multiple attack penalty applies only during your turn, so you don't have
    // to keep track of it if you can perform a Reactive Strike."
    expect(multipleAttackPenalty({ priorAttacks: 2, offTurn: true })).toBe(0);
    expect(multipleAttackPenalty({ priorAttacks: 2, agile: true, offTurn: true })).toBe(0);
  });

  it("an off-turn attack does not advance the counter", () => {
    expect(advanceAttackCount(0)).toBe(1);
    expect(advanceAttackCount(2)).toBe(3);
    expect(advanceAttackCount(2, true)).toBe(2);
  });

  it("guards against a negative or fractional count rather than producing nonsense", () => {
    expect(multipleAttackPenalty({ priorAttacks: -1 })).toBe(0);
    expect(advanceAttackCount(-3)).toBe(1);
  });
});

describe("MAP penalty pair selection", () => {
  it("picks agile over standard, and an override over both", () => {
    expect(mapPenaltyPair({ priorAttacks: 1 })).toEqual(STANDARD_MAP);
    expect(mapPenaltyPair({ priorAttacks: 1, agile: true })).toEqual(AGILE_MAP);

    // The extension seam for future MAP-altering features.
    const custom = { second: -3, thirdPlus: -6 };
    expect(mapPenaltyPair({ priorAttacks: 1, agile: true, override: custom })).toEqual(custom);
    expect(multipleAttackPenalty({ priorAttacks: 1, override: custom })).toBe(-3);
    expect(multipleAttackPenalty({ priorAttacks: 2, override: custom })).toBe(-6);
  });
});
