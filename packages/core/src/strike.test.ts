import { describe, expect, it } from "vitest";
import type { ResolvedCharacter } from "./character.js";
import { runAutomation, type ExecutionContext } from "./automation.js";
import { makeRng } from "./rng.js";
import {
  collectStrikeModifiers,
  damageAbilityMod,
  increaseDieSize,
  resolveScaling,
  resolveStrike,
  strikeSourceSchema,
  strikeAutomation,
  traitDieSize,
  type StrikeSource,
} from "./strike.js";

/** A level-5 fighter-ish character: Str +4, Dex +2. */
const hero: ResolvedCharacter = {
  level: 5,
  scores: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
  mods: { str: 4, dex: 2, con: 2, int: 0, wis: 1, cha: 0 },
  hp: { max: 70 },
  ac: { value: 22, shieldBonus: 0 },
  perception: { modifier: 10, rank: 1 },
  saves: {
    fortitude: { modifier: 12, rank: 2 },
    reflex: { modifier: 10, rank: 1 },
    will: { modifier: 9, rank: 1 },
  },
  classDc: { modifier: 20, rank: 1 },
  speeds: { land: 25 },
  skills: {},
};

const longsword: StrikeSource = {
  id: "longsword",
  name: "Longsword",
  range: "melee",
  group: "sword",
  weapon: "longsword",
  traits: ["versatile-p"],
  damageDie: 8,
  damageType: "slashing",
};

const shortbow: StrikeSource = {
  id: "shortbow",
  name: "Shortbow",
  range: "ranged",
  group: "bow",
  weapon: "shortbow",
  traits: ["deadly d10"],
  damageDie: 6,
  damageType: "piercing",
};

describe("die ladder", () => {
  it("steps one rung and stops at d12", () => {
    expect(increaseDieSize(4)).toBe(6);
    expect(increaseDieSize(6)).toBe(8);
    expect(increaseDieSize(8)).toBe(10);
    expect(increaseDieSize(10)).toBe(12);
    // "There is no effect on an existing d12."
    expect(increaseDieSize(12)).toBe(12);
  });

  it("leaves an off-ladder die alone rather than guessing", () => {
    expect(increaseDieSize(3)).toBe(3);
  });
});

describe("trait die parsing", () => {
  it("reads deadly and fatal die sizes", () => {
    expect(traitDieSize(["deadly d10"], "deadly")).toBe(10);
    expect(traitDieSize(["fatal-d8"], "fatal")).toBe(8);
    expect(traitDieSize(["agile", "finesse"], "deadly")).toBeNull();
    // Doesn't confuse the two traits.
    expect(traitDieSize(["deadly d10"], "fatal")).toBeNull();
  });
});

describe("ability damage by trait", () => {
  it("melee adds full Strength; plain ranged adds none", () => {
    expect(damageAbilityMod("melee", [], 4)).toBe(4);
    expect(damageAbilityMod("ranged", [], 4)).toBe(0);
  });

  it("thrown adds full Strength", () => {
    expect(damageAbilityMod("ranged", ["thrown"], 4)).toBe(4);
  });

  it("propulsive adds half a positive Strength but ALL of a negative one", () => {
    expect(damageAbilityMod("ranged", ["propulsive"], 4)).toBe(2);
    expect(damageAbilityMod("ranged", ["propulsive"], 5)).toBe(2); // rounds down
    expect(damageAbilityMod("ranged", ["propulsive"], -2)).toBe(-2); // full penalty
  });
});

describe("resolveStrike — the slot pipeline", () => {
  it("resolves a plain melee weapon", () => {
    const s = resolveStrike(hero, { source: longsword, rank: 2 });
    // Str +4, expert (2) at level 5 → 5 + 4 = 9, no item bonus.
    expect(s.attack).toBe(4 + 9);
    expect(s.damage[0]!.formula).toBe("1d8+4");
    expect(s.damage[0]!.type).toBe("slashing");
    expect(s.breakdown).toMatchObject({ ability: 4, abilityKey: "str", proficiency: 9, item: 0 });
  });

  it("uses Dex for a ranged weapon and adds no ability damage", () => {
    const s = resolveStrike(hero, { source: shortbow, rank: 2 });
    expect(s.breakdown.abilityKey).toBe("dex");
    expect(s.attack).toBe(2 + 9);
    expect(s.damage[0]!.formula).toBe("1d6"); // no flat bonus at all
  });

  it("finesse picks the better of Str and Dex for ATTACK only", () => {
    const rapier: StrikeSource = { ...longsword, id: "rapier", traits: ["finesse"], damageDie: 6 };
    // This hero's Str (4) beats Dex (2), so finesse changes nothing here…
    expect(resolveStrike(hero, { source: rapier, rank: 2 }).breakdown.abilityKey).toBe("str");

    // …but a dex-heavy character picks Dex for the attack while damage stays Str.
    const swashbuckler = { ...hero, mods: { ...hero.mods, str: 1, dex: 5 } };
    const s = resolveStrike(swashbuckler, { source: rapier, rank: 2 });
    expect(s.breakdown.abilityKey).toBe("dex");
    expect(s.attack).toBe(5 + 9);
    expect(s.damage[0]!.formula).toBe("1d6+1"); // damage still Strength
  });

  it("potency raises the ATTACK only; striking raises the dice COUNT only", () => {
    const s = resolveStrike(hero, {
      source: longsword,
      rank: 2,
      runes: { potency: 2, striking: 1 },
    });
    expect(s.attack).toBe(4 + 9 + 2); // +2 item bonus on the attack roll
    // Striking = two weapon damage dice; potency contributes NOTHING to damage.
    expect(s.damage[0]!.formula).toBe("2d8+4");
    expect(s.breakdown.item).toBe(2);
  });

  it("maps striking ranks to 2/3/4 dice", () => {
    const dice = (striking: number) =>
      resolveStrike(hero, { source: longsword, rank: 2, runes: { striking } }).dice.count;
    expect(dice(0)).toBe(1);
    expect(dice(1)).toBe(2); // striking
    expect(dice(2)).toBe(3); // greater striking
    expect(dice(3)).toBe(4); // major striking
  });

  it("clamps an out-of-range rune rather than trusting it", () => {
    const s = resolveStrike(hero, { source: longsword, rank: 2, runes: { potency: 9, striking: -4 } });
    expect(s.breakdown.item).toBe(3);
    expect(s.dice.count).toBe(1);
  });

  it("stacks typed modifiers from passive effects per the PF2e rules", () => {
    const s = resolveStrike(hero, {
      source: longsword,
      rank: 2,
      // Two status bonuses do NOT add — the higher wins.
      attackModifiers: [
        { type: "status", value: 1 },
        { type: "status", value: 2 },
        { type: "circumstance", value: 1 },
      ],
    });
    expect(s.breakdown.effects).toBe(3); // 2 status + 1 circumstance
    expect(s.attack).toBe(4 + 9 + 3);
  });
});

describe("resolveStrike — overrides (the Pathbuilder attack-editor surface)", () => {
  it("an attack override replaces the total but keeps an honest breakdown", () => {
    const s = resolveStrike(hero, {
      source: longsword,
      rank: 2,
      overrides: { attackTotal: 99 },
    });
    expect(s.attack).toBe(99);
    expect(s.breakdown.overridden).toBe(true);
    // The proficiency line is computed, not back-derived from the override —
    // otherwise the sheet would show a fabricated +86.
    expect(s.breakdown.proficiency).toBe(9);
  });

  it("honours proficiency, ability, dice, and damage overrides", () => {
    const s = resolveStrike(hero, {
      source: longsword,
      rank: 0,
      overrides: {
        rank: 4,
        attackAbility: "cha",
        diceCount: 3,
        increaseDice: true,
        damageTotal: 7,
        name: "Weird Sword",
      },
    });
    expect(s.name).toBe("Weird Sword");
    expect(s.breakdown.rank).toBe(4);
    expect(s.attack).toBe(0 + (5 + 8)); // Cha +0, legendary at level 5
    expect(s.damage[0]!.formula).toBe("3d10+7"); // d8 stepped to d10
  });

  it("adds custom damage rows as separate typed components", () => {
    const s = resolveStrike(hero, {
      source: longsword,
      rank: 2,
      overrides: { extraDamage: [{ formula: "1d6", type: "acid" }] },
    });
    expect(s.damage).toHaveLength(2);
    expect(s.damage[1]).toMatchObject({ formula: "1d6", type: "acid" });
  });
});

describe("resolveStrike — non-weapon sources need no special case", () => {
  it("a Kineticist-style blast scales off Constitution with its own dice rule", () => {
    const blast: StrikeSource = {
      id: "elemental-blast",
      name: "Elemental Blast",
      range: "melee",
      unarmed: true,
      damageDie: 8,
      damageType: "fire",
      attackAbility: "con",
      damageAbility: "con",
      // Its own progression — no runes involved at any point.
      scaling: (level) => ({ count: level >= 5 ? 2 : 1 }),
    };
    const s = resolveStrike(hero, { source: blast, rank: 2 });
    expect(s.breakdown.abilityKey).toBe("con");
    expect(s.attack).toBe(2 + 9); // Con +2
    expect(s.damage[0]!.formula).toBe("2d8+2");
  });

  it("a source can declare that damage gets NO ability modifier", () => {
    const s = resolveStrike(hero, {
      source: { ...longsword, damageAbility: null },
      rank: 2,
    });
    expect(s.damage[0]!.formula).toBe("1d8"); // Str deliberately absent
  });
});

describe("storable strike sources — custom attacks as DATA, not code", () => {
  // The Kineticist blast from the suite above, but authored the way a feat or a
  // player-built custom attack actually has to be: plain JSON with a declarative
  // scaling expression. A JS closure could never survive a database round trip,
  // so this — not the pipeline — is what makes custom attacks a real feature.
  const elementalBlastJson = {
    id: "elemental-blast",
    name: "Elemental Blast",
    range: "melee",
    unarmed: true,
    damageDie: 8,
    damageType: "fire",
    attackAbility: "con",
    damageAbility: "con",
    // "one die, plus another from level 5" — arithmetic over `level`, no eval.
    scaling: {
      count: {
        kind: "call",
        fn: "add",
        args: [
          { kind: "lit", value: 1 },
          // A boolean coerces to 0/1, so "+1 from level 5" is just this.
          {
            kind: "call",
            fn: "gte",
            args: [{ kind: "var", name: "level" }, { kind: "lit", value: 5 }],
          },
        ],
      },
    },
  };

  it("validates, survives a JSON round trip, and resolves identically", () => {
    const parsed = strikeSourceSchema.safeParse(elementalBlastJson);
    expect(parsed.success).toBe(true);

    // The real test: through JSON.stringify/parse and out the other side.
    const roundTripped = strikeSourceSchema.parse(
      JSON.parse(JSON.stringify(elementalBlastJson)),
    );
    const low = resolveStrike({ ...hero, level: 4 }, { source: roundTripped, rank: 2 });
    const high = resolveStrike({ ...hero, level: 5 }, { source: roundTripped, rank: 2 });
    expect(low.damage[0]!.formula).toBe("1d8+2"); // Con +2
    expect(high.damage[0]!.formula).toBe("2d8+2");
    expect(high.breakdown.abilityKey).toBe("con");
  });

  it("REJECTS a function-valued scaling, so a closure cannot reach stored content", () => {
    const withClosure = { ...elementalBlastJson, scaling: () => ({ count: 3 }) };
    expect(strikeSourceSchema.safeParse(withClosure).success).toBe(false);
  });

  it("rejects a damage type outside the vocabulary", () => {
    const bad = { ...elementalBlastJson, damageType: "spirit" };
    expect(strikeSourceSchema.safeParse(bad).success).toBe(false);
  });

  it("keeps `damageAbility: null` distinct from omitting it", () => {
    // null = "adds no ability modifier"; absent = "use the trait-derived default".
    const explicit = strikeSourceSchema.parse({
      id: "x", name: "X", range: "melee", damageDie: 6, damageAbility: null,
    });
    expect(explicit.damageAbility).toBeNull();
    expect(resolveStrike(hero, { source: explicit, rank: 2 }).damage[0]!.formula).toBe("1d6");
  });

  it("rejects an unknown field rather than silently dropping it", () => {
    // A typo'd key in authored content should fail loudly, not vanish.
    expect(
      strikeSourceSchema.safeParse({ ...elementalBlastJson, atackAbility: "con" }).success,
    ).toBe(false);
  });

  it("resolveScaling accepts both forms and agrees", () => {
    const asExpr = { count: { kind: "var" as const, name: "level" } };
    expect(resolveScaling(asExpr, 7)).toEqual({ count: 7 });
    expect(resolveScaling((level: number) => ({ count: level }), 7)).toEqual({ count: 7 });
    expect(resolveScaling(undefined, 7)).toEqual({});
  });
});

describe("critical damage — fatal is inside the doubling, deadly outside it", () => {
  it("deadly adds an undoubled die whose count keys off striking", () => {
    const bow = (striking: number) =>
      resolveStrike(hero, { source: shortbow, rank: 2, runes: { striking } });
    // 1 die normally, 2 at greater striking, 3 at major. Plain striking: still 1.
    expect(bow(0).deadlyDamage[0]!.formula).toBe("1d10");
    expect(bow(1).deadlyDamage[0]!.formula).toBe("1d10");
    expect(bow(2).deadlyDamage[0]!.formula).toBe("2d10"); // the text's rapier example
    expect(bow(3).deadlyDamage[0]!.formula).toBe("3d10");
    // Deadly does NOT replace the base damage.
    expect(bow(0).criticalDamage).toBeNull();
  });

  it("increase-dice never changes the deadly die size", () => {
    // "An ability that changes the size of the weapon's normal damage dice
    // doesn't change the size of its deadly die."
    const s = resolveStrike(hero, {
      source: shortbow,
      rank: 2,
      overrides: { increaseDice: true },
    });
    expect(s.dice.size).toBe(8); // the weapon's d6 stepped to d8
    expect(s.deadlyDamage[0]!.formula).toBe("1d10"); // deadly d10 unmoved
  });

  it("fatal replaces the base dice with a bigger die plus one extra", () => {
    const pick: StrikeSource = {
      ...longsword,
      id: "pick",
      traits: ["fatal d10"],
      damageDie: 6,
    };
    const s = resolveStrike(hero, { source: pick, rank: 2 });
    expect(s.damage[0]!.formula).toBe("1d6+4");
    // d6 → d10, and one additional d10: 2d10. The owner's worked example.
    expect(s.criticalDamage![0]!.formula).toBe("2d10+4");
    expect(s.deadlyDamage).toEqual([]);
  });
});

describe("strikeAutomation — runnable on the existing interpreter", () => {
  const targetDummy: ResolvedCharacter = {
    ...hero,
    ac: { value: 10, shieldBonus: 0 },
    skills: {},
    classDc: null,
  };
  it("emits an attack node with damage under its degree branches", () => {
    const s = resolveStrike(hero, { source: longsword, rank: 2 });
    const tree = strikeAutomation(s);
    expect(tree[0]).toMatchObject({ kind: "attack" });
    // No new node kinds were needed — this is the design's central claim.
    const kinds = new Set(tree.flatMap((n) => [n.kind]));
    expect(kinds).toEqual(new Set(["attack"]));
  });

  /** Every die rolls its MAXIMUM, so the crit arithmetic is exact, not a range. */
  const maxRoll: ExecutionContext["rng"] = { next: () => 0, int: (_min, max) => max };

  const critDamage = (source: StrikeSource): number[] => {
    const s = resolveStrike(hero, { source, rank: 4 });
    const out = runAutomation(strikeAutomation(s), {
      actor: hero,
      targets: [targetDummy],
      rng: maxRoll,
    });
    expect(out.log.find((e) => e.kind === "check")).toMatchObject({ degree: "critical-success" });
    return out.mutations.filter((m) => m.kind === "damage").map((m) => (m as { amount: number }).amount);
  };

  it("doubles the base damage on a crit but NOT the deadly dice", () => {
    // d6 bow, deadly d10, no ability damage (ranged): base 6 → doubled 12, plus
    // an UNdoubled 10. Total 22, i.e. `(d6 + mod) × 2 + d10`.
    // Were deadly folded into the doubled list it would read 32 — the exact
    // silent-inflation bug the two separate lists exist to prevent.
    expect(critDamage(shortbow)).toEqual([12, 10]);
  });

  it("doubles fatal's replaced dice, because fatal is inside the doubling", () => {
    // d6 pick, fatal d10, no ability damage: the base dice BECOME 2d10 → 20,
    // and the whole thing doubles → 40, i.e. `(2d10 + mod) × 2`.
    const pick: StrikeSource = {
      ...longsword,
      id: "pick",
      traits: ["fatal d10"],
      damageDie: 6,
      damageAbility: null,
    };
    expect(critDamage(pick)).toEqual([40]);
  });

  it("doubles an ordinary weapon's damage, ability modifier included", () => {
    expect(critDamage(longsword)).toEqual([(8 + 4) * 2]);
  });

  it("carries the MAP marker through to the emitted attack node", () => {
    const s = resolveStrike(hero, { source: longsword, rank: 2 });
    const tree = strikeAutomation(s, { agile: true });
    expect(tree[0]).toMatchObject({ map: { agile: true } });
  });
});

describe("collectStrikeModifiers — the join between Layer 1 and strikes", () => {
  const sword = resolveStrike(hero, { source: longsword, rank: 2 }).descriptor;
  const bow = resolveStrike(hero, { source: shortbow, rank: 2 }).descriptor;

  it("routes matching modifiers to attack or damage by the selector's base", () => {
    const mods = [
      { selector: "attack" as const, type: "status" as const, value: 1 },
      { selector: "damage:strike:melee" as const, type: "status" as const, value: 2 },
    ];
    const forSword = collectStrikeModifiers(mods, sword);
    expect(forSword.attack).toEqual([{ type: "status", value: 1 }]);
    expect(forSword.damage).toEqual([{ type: "status", value: 2 }]);

    // The bow is ranged, so the melee-scoped damage bonus must not reach it.
    const forBow = collectStrikeModifiers(mods, bow);
    expect(forBow.attack).toEqual([{ type: "status", value: 1 }]);
    expect(forBow.damage).toEqual([]);
  });

  it("feeds straight back into resolveStrike", () => {
    const mods = [{ selector: "attack:group:sword" as const, type: "item" as const, value: 2 }];
    const { attack } = collectStrikeModifiers(mods, sword);
    const s = resolveStrike(hero, { source: longsword, rank: 2, attackModifiers: attack });
    expect(s.attack).toBe(4 + 9 + 2);
  });
});
