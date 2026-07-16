import { describe, expect, it } from "vitest";
import type { ResolvedCharacter } from "./character.js";
import { evaluatePredicate, predicateHolds, predicateSchema, staticTags, type Predicate } from "./predicate.js";

const tags = (...t: string[]): ReadonlySet<string> => new Set(t);

describe("evaluatePredicate — leaf tag", () => {
  it("is true when the tag is active, false otherwise", () => {
    expect(evaluatePredicate({ tag: "self:trait:elf" }, tags("self:trait:elf"))).toBe(true);
    expect(evaluatePredicate({ tag: "self:trait:elf" }, tags("self:trait:dwarf"))).toBe(false);
    expect(evaluatePredicate({ tag: "self:trait:elf" }, tags())).toBe(false);
  });
});

describe("evaluatePredicate — all / any / not", () => {
  it("all is conjunction; empty all is vacuously true", () => {
    const p: Predicate = { all: [{ tag: "a" }, { tag: "b" }] };
    expect(evaluatePredicate(p, tags("a", "b"))).toBe(true);
    expect(evaluatePredicate(p, tags("a"))).toBe(false);
    expect(evaluatePredicate({ all: [] }, tags())).toBe(true);
  });

  it("any is disjunction; empty any is false", () => {
    const p: Predicate = { any: [{ tag: "a" }, { tag: "b" }] };
    expect(evaluatePredicate(p, tags("b"))).toBe(true);
    expect(evaluatePredicate(p, tags("c"))).toBe(false);
    expect(evaluatePredicate({ any: [] }, tags("a"))).toBe(false);
  });

  it("not negates its child", () => {
    expect(evaluatePredicate({ not: { tag: "a" } }, tags())).toBe(true);
    expect(evaluatePredicate({ not: { tag: "a" } }, tags("a"))).toBe(false);
  });

  it("nests: (elf OR half-elf) AND NOT frightened", () => {
    const p: Predicate = {
      all: [
        { any: [{ tag: "self:trait:elf" }, { tag: "self:trait:half-elf" }] },
        { not: { tag: "self:condition:frightened" } },
      ],
    };
    expect(evaluatePredicate(p, tags("self:trait:half-elf"))).toBe(true);
    expect(evaluatePredicate(p, tags("self:trait:elf", "self:condition:frightened"))).toBe(false);
    expect(evaluatePredicate(p, tags("self:trait:dwarf"))).toBe(false);
  });
});

describe("predicateHolds — the effect call site", () => {
  it("an absent predicate always holds (unconditional passive)", () => {
    expect(predicateHolds(undefined, tags())).toBe(true);
  });
  it("a present predicate is evaluated normally", () => {
    expect(predicateHolds({ tag: "a" }, tags("a"))).toBe(true);
    expect(predicateHolds({ tag: "a" }, tags())).toBe(false);
  });
});

describe("predicateSchema", () => {
  it("accepts each node kind and rejects unknown/empty shapes", () => {
    expect(predicateSchema.safeParse({ tag: "self:trait:elf" }).success).toBe(true);
    expect(predicateSchema.safeParse({ all: [{ tag: "a" }, { not: { tag: "b" } }] }).success).toBe(true);
    expect(predicateSchema.safeParse({ tag: "" }).success).toBe(false);
    expect(predicateSchema.safeParse({ tag: "a", extra: 1 }).success).toBe(false);
    expect(predicateSchema.safeParse({ nope: [] }).success).toBe(false);
  });
});

describe("staticTags", () => {
  const base: ResolvedCharacter = {
    level: 1,
    scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    mods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    hp: { max: 8 },
    ac: { value: 10, shieldBonus: 0 },
    perception: { modifier: 0, rank: 0 },
    saves: {
      fortitude: { modifier: 0, rank: 0 },
      reflex: { modifier: 0, rank: 0 },
      will: { modifier: 0, rank: 0 },
    },
    classDc: null,
    speeds: { land: 25 },
    skills: {},
  };

  it("emits self:trait:<slug> for each own trait, slugified/lower-cased", () => {
    const t = staticTags({ ...base, traits: ["Elf", "Low-Light Vision"] });
    expect(t.has("self:trait:elf")).toBe(true);
    expect(t.has("self:trait:low-light-vision")).toBe(true);
  });

  it("is empty when traits are absent (optional field) or blank", () => {
    expect(staticTags(base).size).toBe(0);
    expect(staticTags({ ...base, traits: ["", "  "] }).size).toBe(0);
  });

  it("feeds evaluatePredicate directly", () => {
    const t = staticTags({ ...base, traits: ["elf"] });
    expect(evaluatePredicate({ tag: "self:trait:elf" }, t)).toBe(true);
    expect(evaluatePredicate({ tag: "self:trait:dwarf" }, t)).toBe(false);
  });
});
