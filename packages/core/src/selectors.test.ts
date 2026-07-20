import { describe, expect, it } from "vitest";
import {
  FIXED_SELECTORS,
  isScopedSelector,
  isSelector,
  isSkillSlug,
  SAVE_SELECTORS,
  scopedBase,
  selectorMatchesStrike,
  SKILL_SLUGS,
  type ScopedSelector,
  type StrikeDescriptor,
} from "./selectors.js";

describe("skill slugs", () => {
  it("enumerates exactly the 16 PF2e skills", () => {
    expect(SKILL_SLUGS).toHaveLength(16);
    // No duplicates.
    expect(new Set(SKILL_SLUGS).size).toBe(16);
  });

  it("isSkillSlug recognizes a skill and rejects non-skills", () => {
    expect(isSkillSlug("thievery")).toBe(true);
    expect(isSkillSlug("perception")).toBe(false); // Perception is not a skill
    expect(isSkillSlug("survivalism")).toBe(false);
    expect(isSkillSlug(undefined)).toBe(false);
  });
});

describe("selector vocabulary", () => {
  it("includes the saves, defenses, and spell selectors", () => {
    for (const s of SAVE_SELECTORS) expect(FIXED_SELECTORS).toContain(s);
    for (const s of ["ac", "perception", "class-dc", "spell-dc", "spell-attack", "speed:land"]) {
      expect(FIXED_SELECTORS).toContain(s);
    }
  });

  it("isSelector accepts fixed selectors and skill slugs, rejects others", () => {
    expect(isSelector("ac")).toBe(true);
    expect(isSelector("will")).toBe(true);
    expect(isSelector("athletics")).toBe(true);
    // Foundry-ingest names are a different vocabulary — not read selectors.
    expect(isSelector("saving-throw")).toBe(false);
    expect(isSelector("land-speed")).toBe(false);
    expect(isSelector("nonsense")).toBe(false);
  });

  it("no longer carries attack/damage as fixed selectors", () => {
    // They moved to the scoped vocabulary — a fixed entry would mean the model
    // claims one character-wide number for them, which is the bug being fixed.
    expect(FIXED_SELECTORS).not.toContain("attack");
    expect(FIXED_SELECTORS).not.toContain("damage");
    // …but they remain valid selectors, unscoped.
    expect(isSelector("attack")).toBe(true);
    expect(isSelector("damage")).toBe(true);
  });
});

describe("scoped attack/damage selectors", () => {
  const longsword: StrikeDescriptor = {
    kind: "strike",
    range: "melee",
    unarmed: false,
    group: "sword",
    weapon: "longsword",
  };
  const jaws: StrikeDescriptor = {
    kind: "strike",
    range: "melee",
    unarmed: true,
    group: "brawling",
    weapon: "jaws",
  };
  const shortbow: StrikeDescriptor = {
    kind: "strike",
    range: "ranged",
    unarmed: false,
    group: "bow",
    weapon: "shortbow",
  };
  const spellAttack: StrikeDescriptor = { kind: "spell-attack", range: "ranged", unarmed: false };

  it("accepts well-formed scoped selectors", () => {
    for (const s of [
      "attack",
      "damage",
      "attack:strike",
      "damage:melee",
      "attack:ranged",
      "damage:unarmed",
      "attack:group:sword",
      "damage:weapon:jaws",
      "damage:strike:melee",
    ]) {
      expect(isScopedSelector(s)).toBe(true);
      expect(isSelector(s)).toBe(true);
    }
  });

  it("rejects malformed scopes", () => {
    expect(isScopedSelector("attack:nonsense")).toBe(false);
    expect(isScopedSelector("attack:group")).toBe(false); // keyed segment with no value
    expect(isScopedSelector("attack:group:")).toBe(false); // …or an empty one
    expect(isScopedSelector("ac:melee")).toBe(false); // ac takes no scope
    // Foundry's own selector strings are import feedstock, not our vocabulary.
    expect(isScopedSelector("strike-damage")).toBe(false);
    expect(isScopedSelector("melee-strike-attack-roll")).toBe(false);
  });

  it("reads the base off a scoped selector", () => {
    expect(scopedBase("damage:strike:melee")).toBe("damage");
    expect(scopedBase("attack")).toBe("attack");
  });

  it("an unscoped selector matches every strike", () => {
    for (const strike of [longsword, jaws, shortbow, spellAttack]) {
      expect(selectorMatchesStrike("attack", strike)).toBe(true);
      expect(selectorMatchesStrike("damage", strike)).toBe(true);
    }
  });

  it("`strike` excludes spell attacks — a bonus to attack rolls is broader", () => {
    expect(selectorMatchesStrike("attack:strike", longsword)).toBe(true);
    expect(selectorMatchesStrike("attack:strike", spellAttack)).toBe(false);
    // Unscoped still reaches the spell attack.
    expect(selectorMatchesStrike("attack", spellAttack)).toBe(true);
  });

  it("matches on range, unarmed, group, and weapon", () => {
    expect(selectorMatchesStrike("damage:melee", longsword)).toBe(true);
    expect(selectorMatchesStrike("damage:melee", shortbow)).toBe(false);
    expect(selectorMatchesStrike("damage:ranged", shortbow)).toBe(true);

    expect(selectorMatchesStrike("damage:unarmed", jaws)).toBe(true);
    expect(selectorMatchesStrike("damage:unarmed", longsword)).toBe(false);

    expect(selectorMatchesStrike("attack:group:sword", longsword)).toBe(true);
    expect(selectorMatchesStrike("attack:group:bow", longsword)).toBe(false);

    expect(selectorMatchesStrike("damage:weapon:jaws", jaws)).toBe(true);
    expect(selectorMatchesStrike("damage:weapon:jaws", longsword)).toBe(false);
  });

  it("segments INTERSECT — every one must match, never any-of", () => {
    // `melee-strike-damage` is the corpus's third-most-common scoped selector.
    expect(selectorMatchesStrike("damage:strike:melee", longsword)).toBe(true);
    expect(selectorMatchesStrike("damage:strike:melee", shortbow)).toBe(false); // ranged
    // A spell attack that happens to be melee still fails the `strike` segment,
    // so an any-of reading would wrongly match here.
    expect(
      selectorMatchesStrike("damage:strike:melee", { ...spellAttack, range: "melee" }),
    ).toBe(false);
  });

  it("a strike with no group/weapon is not matched by a keyed scope", () => {
    expect(selectorMatchesStrike("attack:group:sword", spellAttack)).toBe(false);
    expect(selectorMatchesStrike("attack:weapon:longsword", spellAttack)).toBe(false);
  });

  it("a malformed selector fails to apply rather than throwing", () => {
    expect(selectorMatchesStrike("attack:nonsense" as ScopedSelector, longsword)).toBe(false);
  });
});
