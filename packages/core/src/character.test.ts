import { describe, expect, it } from "vitest";
import {
  characterNamespace,
  resolveSelector,
  type ResolvedCharacter,
} from "./character.js";

// A hand-RESOLVED level-1 martial: no spellcasting, class DC present. Every
// value is authored directly (this module does no math), so the tests assert
// pure plumbing — the right field is returned for the right selector.
const fighter: ResolvedCharacter = {
  level: 1,
  scores: { str: 18, dex: 14, con: 12, int: 10, wis: 12, cha: 8 },
  mods: { str: 4, dex: 2, con: 1, int: 0, wis: 1, cha: -1 },
  hp: { max: 20 },
  ac: { value: 18, shieldBonus: 2 },
  perception: { modifier: 7, rank: 2 },
  saves: {
    fortitude: { modifier: 8, rank: 2 },
    reflex: { modifier: 5, rank: 1 },
    will: { modifier: 4, rank: 1 },
  },
  classDc: { modifier: 17, rank: 1 },
  speeds: { land: 25 },
  skills: {
    athletics: { modifier: 8, rank: 1, ability: "str" },
    intimidation: { modifier: 3, rank: 1, ability: "cha" },
  },
};

// A hand-resolved level-5 caster: no class DC, one spellcasting tradition.
const wizard: ResolvedCharacter = {
  level: 5,
  scores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
  mods: { str: -1, dex: 2, con: 1, int: 4, wis: 1, cha: 0 },
  hp: { max: 38 },
  ac: { value: 20, shieldBonus: 0 },
  perception: { modifier: 9, rank: 1 },
  saves: {
    fortitude: { modifier: 8, rank: 1 },
    reflex: { modifier: 11, rank: 2 },
    will: { modifier: 12, rank: 2 },
  },
  classDc: null,
  speeds: { land: 25, fly: 30 },
  skills: {
    arcana: { modifier: 13, rank: 2, ability: "int" },
  },
  spellcasting: [
    { tradition: "arcane", spellAttack: { modifier: 13, rank: 2 }, spellDc: { modifier: 23, rank: 2 } },
  ],
  focusPoints: { max: 1 },
};

describe("resolveSelector", () => {
  it("reads defenses, Perception, and class DC", () => {
    expect(resolveSelector(fighter, "ac")).toBe(18);
    expect(resolveSelector(fighter, "fortitude")).toBe(8);
    expect(resolveSelector(fighter, "reflex")).toBe(5);
    expect(resolveSelector(fighter, "will")).toBe(4);
    expect(resolveSelector(fighter, "perception")).toBe(7);
    expect(resolveSelector(fighter, "class-dc")).toBe(17);
  });

  it("reads a skill by slug, 0 for an untrained/absent skill", () => {
    expect(resolveSelector(fighter, "athletics")).toBe(8);
    expect(resolveSelector(fighter, "stealth")).toBe(0); // not on the sheet
  });

  it("reads land speed", () => {
    expect(resolveSelector(fighter, "speed:land")).toBe(25);
  });

  it("returns 0 for class DC when the class has none", () => {
    expect(resolveSelector(wizard, "class-dc")).toBe(0);
  });

  it("reads spell DC / spell attack from the primary tradition, 0 when non-caster", () => {
    expect(resolveSelector(wizard, "spell-dc")).toBe(23);
    expect(resolveSelector(wizard, "spell-attack")).toBe(13);
    expect(resolveSelector(fighter, "spell-dc")).toBe(0);
    expect(resolveSelector(fighter, "spell-attack")).toBe(0);
  });

  it("returns 0 for reserved selectors not yet carried by the model", () => {
    expect(resolveSelector(fighter, "attack")).toBe(0);
    expect(resolveSelector(fighter, "damage")).toBe(0);
    expect(resolveSelector(fighter, "initiative")).toBe(0);
  });
});

describe("characterNamespace", () => {
  it("exposes ability mods, level, and resolved stats as flat vars", () => {
    const ns = characterNamespace(fighter);
    expect(ns.level).toBe(1);
    expect(ns.strengthMod).toBe(4);
    expect(ns.charismaMod).toBe(-1);
    expect(ns.maxHp).toBe(20);
    expect(ns.ac).toBe(18);
    expect(ns.perception).toBe(7);
    expect(ns.fortitude).toBe(8);
    expect(ns.classDc).toBe(17);
    expect(ns.speed).toBe(25);
    expect(ns.athletics).toBe(8);
  });

  it("omits skills the character has no entry for", () => {
    const ns = characterNamespace(fighter);
    expect("stealth" in ns).toBe(false);
  });

  it("adds spell vars only for a caster and defaults classDc to 0", () => {
    const ns = characterNamespace(wizard);
    expect(ns.spellDc).toBe(23);
    expect(ns.spellAttack).toBe(13);
    expect(ns.classDc).toBe(0);
    expect("spellDc" in characterNamespace(fighter)).toBe(false);
  });
});
