import { describe, expect, it } from "vitest";
import type { ResolvedCharacter } from "./character.js";
import {
  describePredicate,
  evaluatePredicate,
  predicateHolds,
  predicateSchema,
  rollTags,
  staticTags,
  tagSlug,
  type Predicate,
} from "./predicate.js";

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

describe("staticTags", () => {
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

describe("tagSlug", () => {
  it("lower-cases, trims, and collapses whitespace to -", () => {
    expect(tagSlug("Elf")).toBe("elf");
    expect(tagSlug("  Low Light  ")).toBe("low-light");
    expect(tagSlug("")).toBe("");
  });
});

describe("rollTags — the opposed context", () => {
  it("emits the precise namespace AND the opponent union for a target", () => {
    const t = rollTags({ target: { traits: ["Undead", "Mindless"] } });
    expect(t.has("target:trait:undead")).toBe(true);
    expect(t.has("opponent:trait:undead")).toBe(true);
    expect(t.has("target:trait:mindless")).toBe(true);
    // The other direction is NOT asserted — nothing said this came from them.
    expect(t.has("origin:trait:undead")).toBe(false);
  });

  it("emits origin:+opponent: for the creature behind an incoming effect", () => {
    const t = rollTags({ origin: { traits: ["dragon"] } });
    expect(t.has("origin:trait:dragon")).toBe(true);
    expect(t.has("opponent:trait:dragon")).toBe(true);
    expect(t.has("target:trait:dragon")).toBe(false);
  });

  it("so one `opponent:` predicate matches BOTH directions — the whole point", () => {
    const vsUndead: Predicate = { tag: "opponent:trait:undead" };
    // Outgoing: your attack against an undead creature.
    expect(evaluatePredicate(vsUndead, rollTags({ target: { traits: ["undead"] } }))).toBe(true);
    // Incoming: your save against an undead creature's effect.
    expect(evaluatePredicate(vsUndead, rollTags({ origin: { traits: ["undead"] } }))).toBe(true);
    // While the precise spellings stay distinguishable when content needs them.
    expect(evaluatePredicate({ tag: "target:trait:undead" }, rollTags({ origin: { traits: ["undead"] } }))).toBe(false);
  });

  it("unions both creatures when a roll has each", () => {
    const t = rollTags({ target: { traits: ["construct"] }, origin: { traits: ["undead"] } });
    expect(t.has("opponent:trait:construct")).toBe(true);
    expect(t.has("opponent:trait:undead")).toBe(true);
  });

  it("emits effect:trait: from the effect being rolled against", () => {
    // "+1 status to saves against death effects" — the shape EffectTemplate.traits
    // exists to make representable.
    const t = rollTags({ effect: { traits: ["death", "Magical"] } });
    expect(t.has("effect:trait:death")).toBe(true);
    expect(t.has("effect:trait:magical")).toBe(true);
    expect(evaluatePredicate({ tag: "effect:trait:death" }, t)).toBe(true);
  });

  it("emits effect:causes: from the conditions an effect would inflict", () => {
    // "+2 circumstance to saves against effects that would make you enfeebled" — the
    // shape EffectTemplate.conditions exists to make representable.
    const t = rollTags({ effect: { conditions: [{ slug: "enfeebled" }, { slug: "clumsy" }] } });
    expect(t.has("effect:causes:enfeebled")).toBe(true);
    expect(t.has("effect:causes:clumsy")).toBe(true);
    expect(evaluatePredicate({ tag: "effect:causes:enfeebled" }, t)).toBe(true);
    expect(evaluatePredicate({ tag: "effect:causes:drained" }, t)).toBe(false);
  });

  it("ignores the condition VALUE — the tag says which, not how much", () => {
    // Membership-only by design: "enfeebled 2 or more" is a numeric threshold and
    // belongs to Layer 2's branch, not the tag model.
    const t = rollTags({ effect: { conditions: [{ slug: "enfeebled", value: 3 }] } });
    expect([...t]).toEqual(["effect:causes:enfeebled"]);
  });

  it("keeps an effect's traits and the conditions it causes in separate namespaces", () => {
    const t = rollTags({ effect: { traits: ["death"], conditions: [{ slug: "drained" }] } });
    expect(t.has("effect:trait:death")).toBe(true);
    expect(t.has("effect:causes:drained")).toBe(true);
    expect(t.has("effect:trait:drained")).toBe(false);
    expect(t.has("effect:causes:death")).toBe(false);
  });

  it("does NOT give an effect an opponent: union — an effect is not a creature", () => {
    const t = rollTags({ effect: { traits: ["death"] } });
    expect(t.has("opponent:trait:death")).toBe(false);
    expect(t.size).toBe(1);
  });

  it("keeps creature and effect traits independent when a roll has both", () => {
    // A save against an undead's death spell: the creature is undead, the effect is
    // death. Neither tag may leak into the other's namespace.
    const t = rollTags({ origin: { traits: ["undead"] }, effect: { traits: ["death"] } });
    expect(evaluatePredicate({ all: [{ tag: "opponent:trait:undead" }, { tag: "effect:trait:death" }] }, t)).toBe(true);
    expect(t.has("effect:trait:undead")).toBe(false);
    expect(t.has("opponent:trait:death")).toBe(false);
  });

  it("passes host `extra` tags through verbatim (the combat-tracker seam)", () => {
    expect(rollTags({ extra: ["self:condition:off-guard"] }).has("self:condition:off-guard")).toBe(true);
  });

  it("produces nothing for an unopposed roll, so creature predicates fail", () => {
    expect(rollTags({}).size).toBe(0);
    expect(evaluatePredicate({ tag: "opponent:trait:undead" }, rollTags({}))).toBe(false);
  });

  it("slugifies and drops blanks like staticTags does", () => {
    const t = rollTags({ target: { traits: ["Swarm Mind", "  "] } });
    expect(t.has("opponent:trait:swarm-mind")).toBe(true);
    expect(t.size).toBe(2); // the blank contributed neither tag
  });

  it("unions with staticTags for a mixed self/opponent predicate", () => {
    const all = new Set([...staticTags({ ...base, traits: ["elf"] }), ...rollTags({ target: { traits: ["undead"] } })]);
    const p: Predicate = { all: [{ tag: "self:trait:elf" }, { tag: "opponent:trait:undead" }] };
    expect(evaluatePredicate(p, all)).toBe(true);
  });
});

describe("describePredicate — display prose", () => {
  it("renders creature leaves by scope", () => {
    expect(describePredicate({ tag: "opponent:trait:undead" })).toBe("vs undead");
    expect(describePredicate({ tag: "target:trait:undead" })).toBe("vs undead");
    expect(describePredicate({ tag: "origin:trait:dragon" })).toBe("vs effects from dragon");
    expect(describePredicate({ tag: "self:trait:elf" })).toBe("when elf");
  });

  it("de-slugs multi-word trait values", () => {
    expect(describePredicate({ tag: "opponent:trait:swarm-mind" })).toBe("vs swarm mind");
  });

  it("collapses a shared prefix across a group", () => {
    const p: Predicate = { any: [{ tag: "opponent:trait:undead" }, { tag: "opponent:trait:fiend" }] };
    expect(describePredicate(p)).toBe("vs undead or fiend");
  });

  it("renders an effect trait with its noun, and collapses the noun across a group", () => {
    expect(describePredicate({ tag: "effect:trait:death" })).toBe("vs death effects");
    const p: Predicate = { any: [{ tag: "effect:trait:death" }, { tag: "effect:trait:fear" }] };
    expect(describePredicate(p)).toBe("vs death or fear effects");
  });

  it("renders a caused condition, and collapses a group of them", () => {
    expect(describePredicate({ tag: "effect:causes:enfeebled" })).toBe("vs effects that cause enfeebled");
    const p: Predicate = { any: [{ tag: "effect:causes:enfeebled" }, { tag: "effect:causes:clumsy" }] };
    expect(describePredicate(p)).toBe("vs effects that cause enfeebled or clumsy");
  });

  it("does not collapse a creature trait with an effect trait — different nouns", () => {
    const p: Predicate = { all: [{ tag: "opponent:trait:undead" }, { tag: "effect:trait:death" }] };
    expect(describePredicate(p)).toBe("vs undead and vs death effects");
  });

  it("does not collapse across differing prefixes", () => {
    const p: Predicate = { all: [{ tag: "self:trait:elf" }, { tag: "opponent:trait:undead" }] };
    expect(describePredicate(p)).toBe("when elf and vs undead");
  });

  it("unwraps a single-child group and negates", () => {
    expect(describePredicate({ all: [{ tag: "opponent:trait:undead" }] })).toBe("vs undead");
    expect(describePredicate({ not: { tag: "opponent:trait:undead" } })).toBe("not vs undead");
  });

  it("renders an UNRECOGNIZED tag as itself rather than inventing a meaning", () => {
    expect(describePredicate({ tag: "self:effect:rage" })).toBe("self:effect:rage");
    expect(describePredicate({ tag: "weird" })).toBe("weird");
  });

  it("names the neutral elements", () => {
    expect(describePredicate({ all: [] })).toBe("always");
    expect(describePredicate({ any: [] })).toBe("never");
  });
});
