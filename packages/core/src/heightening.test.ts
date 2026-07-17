import { describe, expect, it } from "vitest";
import { autoHeightenRank, heightenIncrements } from "./heightening.js";

describe("autoHeightenRank", () => {
  it("is half your level, rounded up", () => {
    expect(autoHeightenRank(1)).toBe(1);
    expect(autoHeightenRank(2)).toBe(1);
    expect(autoHeightenRank(3)).toBe(2);
    expect(autoHeightenRank(4)).toBe(2);
    expect(autoHeightenRank(19)).toBe(10);
    expect(autoHeightenRank(20)).toBe(10);
  });

  it("rounds UP on odd levels — the half-level trap", () => {
    // A 5th-level caster's cantrips are 3rd rank, not 2nd. Rounding down here is
    // the classic error, and it under-heightens every cantrip at every odd level.
    expect(autoHeightenRank(5)).toBe(3);
    expect(autoHeightenRank(7)).toBe(4);
    expect(autoHeightenRank(11)).toBe(6);
  });

  it("tracks the highest spell slot a typical caster has", () => {
    // "For a typical spellcaster, this means its rank is equal to the highest rank
    // of spell slot you have" — level 1-2 → 1st, 3-4 → 2nd, and so on.
    expect(autoHeightenRank(1)).toBe(autoHeightenRank(2));
    expect(autoHeightenRank(3)).toBe(autoHeightenRank(4));
    expect(autoHeightenRank(17)).toBe(9);
  });
});

describe("heightenIncrements", () => {
  it("counts increments above the spell's LOWEST rank — the fireball ladder", () => {
    // The pasted rule's own worked example: fireball is a 3rd-rank spell with
    // "Heightened (+1) The damage increases by 2d6", so 6d6 → 8d6 → 10d6.
    const fireball = (castRank: number) => heightenIncrements({ castRank, baseRank: 3, step: 1 });
    expect(fireball(3)).toBe(0);
    expect(fireball(4)).toBe(1);
    expect(fireball(5)).toBe(2);
    expect(fireball(10)).toBe(7);
  });

  it("floors a partial increment — a +2 spell gains nothing one rank up", () => {
    const step2 = (castRank: number) => heightenIncrements({ castRank, baseRank: 1, step: 2 });
    expect(step2(1)).toBe(0);
    expect(step2(2)).toBe(0);
    expect(step2(3)).toBe(1);
    expect(step2(4)).toBe(1);
    expect(step2(5)).toBe(2);
  });

  it("is zero below the base rank — a lower-rank spell in a higher slot is unheightened", () => {
    // The spontaneous-caster rule: the cast resolves to the rank the spell is known
    // at, and "the spell doesn't have any heightened effects". Never negative.
    expect(heightenIncrements({ castRank: 1, baseRank: 3, step: 1 })).toBe(0);
    expect(heightenIncrements({ castRank: 0, baseRank: 5, step: 1 })).toBe(0);
  });

  it("rejects a step below 1 rather than dividing by zero", () => {
    expect(() => heightenIncrements({ castRank: 5, baseRank: 3, step: 0 })).toThrow(/step/);
    expect(() => heightenIncrements({ castRank: 5, baseRank: 3, step: -1 })).toThrow(/step/);
  });
});
