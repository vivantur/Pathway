import { describe, expect, it } from "vitest";
import { resolveStrike, traitDieSize } from "./strike.js";
import {
  coerceWeapon,
  potencyAttackBonus,
  strikingDamageDice,
  unmappedStrikeTraits,
  weaponSchema,
  weaponToStrikeSources,
  type Weapon,
} from "./weapon.js";

/** A dataset row exactly as `items.json` stores one. */
const rawLongsword = {
  id: "longsword",
  kind: "weapon",
  name: "Longsword",
  category: "martial",
  group: "sword",
  damageDie: "d8",
  damageType: "S",
  hands: "1",
  ranged: false,
  traits: ["versatile-p"],
  bulk: "1",
  price: 10,
  source: "Player Core",
};

const ok = (row: Record<string, unknown>): Weapon => {
  const r = coerceWeapon(row);
  if ("error" in r) throw new Error(r.error);
  return r.weapon;
};

describe("coerceWeapon — the items.json boundary", () => {
  it("normalizes the dataset's two storage encodings", () => {
    const w = ok(rawLongsword);
    // "d8" → 8, and "S" → the real vocabulary. Neither encoding escapes the adapter.
    expect(w.damageDie).toBe(8);
    expect(w.damageType).toBe("slashing");
    expect(w.category).toBe("martial");
    expect(w.group).toBe("sword");
  });

  it("drops the empty-string group the dataset uses for ungrouped weapons", () => {
    expect(ok({ ...rawLongsword, group: "" }).group).toBeUndefined();
  });

  it("keeps the range increment on ranged weapons", () => {
    const bow = ok({ ...rawLongsword, id: "shortbow", group: "bow", ranged: true, range: 60, damageDie: "d6", damageType: "P" });
    expect(bow.ranged).toBe(true);
    expect(bow.range).toBe(60);
  });

  it("reports a bad row instead of producing a broken weapon", () => {
    expect(coerceWeapon({ ...rawLongsword, damageDie: "banana" })).toMatchObject({
      error: expect.stringContaining("damageDie"),
    });
    // An unmapped damage code must not silently become untyped damage.
    expect(coerceWeapon({ ...rawLongsword, damageType: "X" })).toMatchObject({
      error: expect.stringContaining("damageType"),
    });
    expect(coerceWeapon({ ...rawLongsword, category: "legendary" })).toMatchObject({
      error: expect.stringContaining("category"),
    });
  });

  it("accepts a bare numeric die as well as the d-prefixed string", () => {
    expect(ok({ ...rawLongsword, damageDie: 12 }).damageDie).toBe(12);
    expect(ok({ ...rawLongsword, damageDie: "12" }).damageDie).toBe(12);
  });
});

describe("fundamental runes", () => {
  it("potency rank IS the attack bonus", () => {
    expect(potencyAttackBonus(undefined)).toBe(0);
    expect(potencyAttackBonus({ potency: 1 })).toBe(1);
    expect(potencyAttackBonus({ potency: 3 })).toBe(3);
  });

  it("striking rank + 1 IS the dice count — 2 / 3 / 4", () => {
    expect(strikingDamageDice(undefined)).toBe(1);
    expect(strikingDamageDice({ striking: 1 })).toBe(2); // striking
    expect(strikingDamageDice({ striking: 2 })).toBe(3); // greater
    expect(strikingDamageDice({ striking: 3 })).toBe(4); // major
  });

  it("clamps a rank outside 0–3 rather than trusting stored data", () => {
    expect(potencyAttackBonus({ potency: 9 })).toBe(3);
    expect(strikingDamageDice({ striking: -2 })).toBe(1);
  });

  it("rejects an out-of-range rank at the schema edge", () => {
    expect(weaponSchema.shape.category.safeParse("martial").success).toBe(true);
  });
});

describe("weaponToStrikeSources — one weapon, several strikes", () => {
  it("produces a strike source that feeds resolveStrike directly", () => {
    const { sources } = weaponToStrikeSources(ok(rawLongsword));
    expect(sources).toHaveLength(1);
    const hero = { level: 5, mods: { str: 4, dex: 2, con: 2, int: 0, wis: 1, cha: 0 } };
    const strike = resolveStrike(hero, { source: sources[0]!, rank: 2, runes: { striking: 1 } });
    expect(strike.damage[0]!.formula).toBe("2d8+4");
    expect(strike.descriptor).toMatchObject({ group: "sword", weapon: "longsword", range: "melee" });
  });

  it("marks an unarmed weapon so `damage:unarmed` effects reach it", () => {
    const fist = ok({ ...rawLongsword, id: "fist", category: "unarmed", group: "brawling", damageDie: "d4", damageType: "B" });
    expect(weaponToStrikeSources(fist).sources[0]!.unarmed).toBe(true);
  });

  it("does not flag ordinary traits as unmapped", () => {
    const w = ok({ ...rawLongsword, traits: ["agile", "finesse", "deadly-d10", "propulsive"] });
    expect(unmappedStrikeTraits(w)).toEqual([]);
  });

  it("reports `modular`, whose configurations live in prose rather than the trait", () => {
    // All 12 shipped modular weapons carry the trait BARE — there is nothing to
    // parse, so it is named instead of guessed.
    const w = ok({ ...rawLongsword, traits: ["modular"] });
    expect(unmappedStrikeTraits(w)).toEqual([
      { trait: "modular", reason: expect.stringContaining("prose") },
    ]);
  });

  it("reports a versatile type outside the damage vocabulary", () => {
    // `versatile-spirit` ships on one weapon; "spirit" is not a damage type core
    // models, and inventing one would put an unreasonable type on a sheet.
    const w = ok({ ...rawLongsword, traits: ["versatile-spirit"] });
    expect(unmappedStrikeTraits(w)[0]).toMatchObject({ trait: "versatile-spirit" });
    // …while a full-word type core DOES model resolves fine.
    const ok2 = ok({ ...rawLongsword, traits: ["versatile-vitality"] });
    expect(unmappedStrikeTraits(ok2)).toEqual([]);
    expect(weaponToStrikeSources(ok2).sources[0]!.variants?.versatileTypes).toEqual(["vitality"]);
  });
});

describe("strike variants — two-hand, versatile, thrown, fatal aim", () => {
  const hero = { level: 5, mods: { str: 4, dex: 2, con: 2, int: 0, wis: 1, cha: 0 } };
  const build = (traits: string[], over: Record<string, unknown> = {}) =>
    weaponToStrikeSources(ok({ ...rawLongsword, traits, ...over }));

  it("two-hand changes the die size, and ALL striking dice with it", () => {
    // "change its weapon damage die to the indicated value. This change applies
    // to all the weapon's damage dice." A d8 longsword with two-hand d12 and a
    // greater striking rune deals 3d12, not 2d8 + 1d12.
    const { sources } = build(["two-hand-d12"]);
    const src = sources[0]!;
    const oneHanded = resolveStrike(hero, { source: src, rank: 2, runes: { striking: 2 } });
    const twoHanded = resolveStrike(hero, {
      source: src,
      rank: 2,
      runes: { striking: 2 },
      overrides: { twoHanded: true },
    });
    expect(oneHanded.damage[0]!.formula).toBe("3d8+4");
    expect(twoHanded.damage[0]!.formula).toBe("3d12+4");
    // The COUNT is untouched — two-hand is a size rule, not a dice rule.
    expect(twoHanded.dice).toEqual({ count: 3, size: 12 });
  });

  it("two-hand does NOT change the deadly die", () => {
    // "An ability that changes the size of the weapon's normal damage dice
    // doesn't change the size of its deadly die." 5 shipped weapons pair them.
    const { sources } = build(["two-hand-d12", "deadly-d8"]);
    const s = resolveStrike(hero, { source: sources[0]!, rank: 2, overrides: { twoHanded: true } });
    expect(s.dice.size).toBe(12);
    expect(s.deadlyDamage[0]!.formula).toBe("1d8");
  });

  it("fatal aim grants fatal ONLY in two hands", () => {
    // "When you wield the weapon in two hands, it gains the fatal trait with the
    // listed damage die."
    const { sources } = build(["fatal-aim-d12"], { damageDie: "d6", group: "firearm" });
    const src = sources[0]!;
    expect(resolveStrike(hero, { source: src, rank: 2 }).criticalDamage).toBeNull();
    const two = resolveStrike(hero, { source: src, rank: 2, overrides: { twoHanded: true } });
    // d6 base → fatal d12: the die becomes d12 and one extra is added.
    expect(two.criticalDamage![0]!.formula).toBe("2d12+4");
  });

  it("versatile offers alternative damage types, chosen per attack", () => {
    const { sources } = build(["versatile-p"]);
    const src = sources[0]!;
    expect(src.variants?.versatileTypes).toEqual(["piercing"]);
    expect(resolveStrike(hero, { source: src, rank: 2 }).damage[0]!.type).toBe("slashing");
    const chosen = resolveStrike(hero, {
      source: src,
      rank: 2,
      overrides: { damageType: "piercing" },
    });
    expect(chosen.damage[0]!.type).toBe("piercing");
  });

  it("thrown produces a SECOND, ranged strike that still adds Strength to damage", () => {
    // "it is a ranged weapon when thrown" (so Dex makes the attack) but "you add
    // your Strength modifier to damage as you would for a melee weapon".
    const { sources } = build(["thrown-20"], { id: "javelin", damageDie: "d6", damageType: "P" });
    expect(sources).toHaveLength(2);
    const [melee, thrown] = sources as [typeof sources[0], typeof sources[0]];
    expect(melee.range).toBe("melee");
    expect(thrown.range).toBe("ranged");
    expect(thrown.rangeIncrement).toBe(20);

    const m = resolveStrike(hero, { source: melee, rank: 2 });
    const t = resolveStrike(hero, { source: thrown, rank: 2 });
    // Melee attacks with Str (+4); thrown attacks with Dex (+2)…
    expect(m.breakdown.abilityKey).toBe("str");
    expect(t.breakdown.abilityKey).toBe("dex");
    expect(m.attack - t.attack).toBe(2);
    // …but BOTH add full Strength to damage. This is the whole point of the trait.
    expect(m.damage[0]!.formula).toBe("1d6+4");
    expect(t.damage[0]!.formula).toBe("1d6+4");
  });

  it("does not add a thrown strike to a weapon that is already ranged", () => {
    // The 15 bare-`thrown` weapons are stored `ranged: true` and use their own
    // Range entry; a second strike would be a duplicate.
    const { sources } = build(["thrown"], { ranged: true, range: 20, damageType: "P" });
    expect(sources).toHaveLength(1);
    expect(sources[0]!.rangeIncrement).toBe(20);
    // Bare `thrown` on a ranged weapon still grants Strength to damage.
    expect(resolveStrike(hero, { source: sources[0]!, rank: 2 }).damage[0]!.formula).toBe("1d8+4");
  });

  it("combines axes independently", () => {
    // 39 shipped weapons carry two or more variant axes.
    const { sources } = build(["thrown-10", "two-hand-d10", "versatile-b"], { damageDie: "d6" });
    expect(sources).toHaveLength(2);
    const thrown = sources[1]!;
    const s = resolveStrike(hero, {
      source: thrown,
      rank: 2,
      overrides: { twoHanded: true, damageType: "bludgeoning" },
    });
    expect(s.dice.size).toBe(10);
    expect(s.damage[0]!.type).toBe("bludgeoning");
  });
});

describe("fatal-aim is NOT fatal", () => {
  it("reads the dataset's hyphenated deadly/fatal forms", () => {
    // items.json stores these hyphenated: `deadly-d10`, not `deadly d10`.
    expect(traitDieSize(["deadly-d10"], "deadly")).toBe(10);
    expect(traitDieSize(["fatal-d12"], "fatal")).toBe(12);
  });

  it("refuses fatal-aim, which is a different trait with no rules text supplied", () => {
    // Were this read as fatal d10, every firearm carrying it would silently gain
    // a bigger crit die the rules never granted.
    expect(traitDieSize(["fatal-aim-d10"], "fatal")).toBeNull();
    expect(traitDieSize(["fatal-aim-d12"], "fatal")).toBeNull();
  });
});
