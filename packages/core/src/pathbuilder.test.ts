import { describe, expect, it } from "vitest";

import {
  normalizeDefenseList,
  pathbuilderAc,
  pathbuilderClassDc,
  pathbuilderFocusPool,
  pathbuilderMaxHp,
  pathbuilderPerception,
  pathbuilderSaveBonus,
  pathbuilderShieldBonus,
  pathbuilderSize,
  pathbuilderSkillBonus,
  pathbuilderSpeed,
  resolvedFromPathbuilder,
  type PathbuilderBuild,
} from "./pathbuilder.js";

// A worked example, level 5. Every expectation below is DERIVED from the two rules
// this module composes (both already locked by stats/derived tests) rather than
// recalled: proficiencyBonus = 0 when untrained, else level + 2 × rank; a
// proficient modifier = abilityMod + that. Pathbuilder stores ranks as raw
// bonuses (0/2/4/6/8), so `4` here means rank 2 (expert).
//
//   str 18 (+4)  dex 14 (+2)  con 16 (+3)  int 10 (+0)  wis 12 (+1)  cha 8 (-1)
const HERO: PathbuilderBuild = {
  name: "Test Hero",
  class: "Fighter",
  level: 5,
  keyability: "str",
  size: 2,
  attributes: { ancestryhp: 8, classhp: 10, bonushp: 0, bonushpPerLevel: 0, speed: 25, speedBonus: 5 },
  abilities: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
  proficiencies: {
    fortitude: 4,
    reflex: 2,
    will: 2,
    perception: 4,
    classDC: 4,
    athletics: 6,
    arcana: 2,
    stealth: 0,
  },
  acTotal: { acTotal: 21 },
};

describe("proficiency-based readers", () => {
  it("routes each save through its governing ability", () => {
    // fortitude: con +3, rank 2 → 5 + 4 = 9
    expect(pathbuilderSaveBonus(HERO, "fortitude")).toBe(3 + 9);
    // reflex: dex +2, rank 1 → 5 + 2 = 7
    expect(pathbuilderSaveBonus(HERO, "reflex")).toBe(2 + 7);
    // will: wis +1, rank 1 → 7
    expect(pathbuilderSaveBonus(HERO, "will")).toBe(1 + 7);
  });

  it("reads Perception off Wisdom", () => {
    expect(pathbuilderPerception(HERO)).toBe(1 + 9);
  });

  it("routes each skill through the ability core's table assigns it", () => {
    expect(pathbuilderSkillBonus(HERO, "athletics")).toBe(4 + (5 + 6)); // str, master
    expect(pathbuilderSkillBonus(HERO, "arcana")).toBe(0 + (5 + 2)); // int, trained
  });

  it("gives an untrained skill no proficiency bonus at all — not level", () => {
    // The rank-0 case is the one place the level term drops out entirely.
    expect(pathbuilderSkillBonus(HERO, "stealth")).toBe(2);
  });

  it("returns 0 for a skill core has no ability mapping for", () => {
    expect(pathbuilderSkillBonus(HERO, "not-a-skill")).toBe(0);
  });

  it("builds the class DC as 10 + key ability + proficiency", () => {
    expect(pathbuilderClassDc(HERO)).toBe(10 + 4 + 9);
  });

  it("has no class DC without a stored rank or a key ability", () => {
    expect(pathbuilderClassDc({ ...HERO, proficiencies: {} })).toBeUndefined();
    expect(pathbuilderClassDc({ ...HERO, keyability: undefined })).toBeUndefined();
  });
});

describe("attributes", () => {
  it("computes max HP as ancestry + (class + con) per level", () => {
    expect(pathbuilderMaxHp(HERO)).toBe(8 + (10 + 3) * 5);
  });

  it("applies per-level bonus HP at every level", () => {
    const tough = { ...HERO, attributes: { ...HERO.attributes, bonushp: 4, bonushpPerLevel: 2 } };
    expect(pathbuilderMaxHp(tough)).toBe(8 + (10 + 3) * 5 + 4 + 2 * 5);
  });

  it("has no max HP without an attributes block", () => {
    expect(pathbuilderMaxHp({ level: 5 })).toBeUndefined();
  });

  it("adds the speed bonus, and falls back to 25 feet", () => {
    expect(pathbuilderSpeed(HERO)).toBe(30);
    expect(pathbuilderSpeed({ attributes: {} })).toBe(25);
    expect(pathbuilderSpeed({})).toBe(25);
  });
});

describe("AC", () => {
  it("passes Pathbuilder's precomputed total straight through", () => {
    expect(pathbuilderAc(HERO)).toBe(21);
  });

  it("is undefined when the build carries no acTotal — never a guessed value", () => {
    // AC arrives as an opaque total; with nothing stored there is nothing to
    // recompute from, and inventing one would be worse than admitting the gap.
    expect(pathbuilderAc({ ...HERO, acTotal: undefined })).toBeUndefined();
  });
});

describe("shield bonus", () => {
  it("prefers Pathbuilder's own value when it is populated", () => {
    const b = { ...HERO, acTotal: { acTotal: 21, shieldBonus: 2 } };
    expect(pathbuilderShieldBonus(b)).toBe(2);
  });

  it("falls back to a shield in the armor list when Pathbuilder left it at 0", () => {
    const b: PathbuilderBuild = { ...HERO, armor: [{ name: "Buckler", prof: "shield" }] };
    expect(pathbuilderShieldBonus(b)).toBe(1);
  });

  it("defaults an unrecognized shield-proficiency armor entry to +2", () => {
    const b: PathbuilderBuild = { ...HERO, armor: [{ name: "Bastion Plate", prof: "shield" }] };
    expect(pathbuilderShieldBonus(b)).toBe(2);
  });

  it("takes the best shield when several are carried", () => {
    const b: PathbuilderBuild = {
      ...HERO,
      armor: [{ name: "Buckler" }, { name: "Steel Shield" }],
    };
    expect(pathbuilderShieldBonus(b)).toBe(2);
  });

  it("last-resorts to the loose equipment list", () => {
    const b: PathbuilderBuild = { ...HERO, equipment: [["Wooden Shield", 1]] };
    expect(pathbuilderShieldBonus(b)).toBe(2);
  });

  it("is 0 when no shield is carried anywhere", () => {
    expect(pathbuilderShieldBonus(HERO)).toBe(0);
    expect(pathbuilderShieldBonus({ ...HERO, armor: [{ name: "Chain Mail" }] })).toBe(0);
  });
});

describe("focus pool", () => {
  it("counts focus spells and cantrips known", () => {
    const b: PathbuilderBuild = {
      ...HERO,
      focus: { divine: { wis: { focusSpells: ["Lay on Hands"], focusCantrips: ["Guidance"] } } },
    };
    expect(pathbuilderFocusPool(b)).toBe(2);
  });

  it("caps at 3 however many are known", () => {
    const b: PathbuilderBuild = {
      ...HERO,
      focus: { divine: { wis: { focusSpells: ["a", "b", "c", "d", "e"] } } },
    };
    expect(pathbuilderFocusPool(b)).toBe(3);
  });

  it("honors an explicit per-caster count when it is larger", () => {
    const b: PathbuilderBuild = {
      ...HERO,
      focus: { divine: { wis: { focusSpells: ["Lay on Hands"] } } },
      spellCasters: [{ focusPoints: 2 } as never],
    };
    expect(pathbuilderFocusPool(b)).toBe(2);
  });

  it("honors the top-level count the web builder writes", () => {
    expect(pathbuilderFocusPool({ ...HERO, focusPoints: 3 })).toBe(3);
  });

  it("is 0 for a character with no focus spells", () => {
    expect(pathbuilderFocusPool(HERO)).toBe(0);
  });
});

describe("format decoding", () => {
  it("decodes Pathbuilder's 0-indexed size codes", () => {
    // Regression: a 1-indexed table here once rendered every Medium character
    // as Small. Pathbuilder writes 2 for Medium.
    expect(pathbuilderSize(2)).toBe("Medium");
    expect(pathbuilderSize(0)).toBe("Tiny");
    expect(pathbuilderSize(5)).toBe("Gargantuan");
    expect(pathbuilderSize(undefined)).toBeUndefined();
    expect(pathbuilderSize(99)).toBeUndefined();
  });

  it("normalizes every shape a defense slot is stored in", () => {
    expect(normalizeDefenseList(null)).toEqual([]);
    expect(normalizeDefenseList(undefined)).toEqual([]);
    expect(normalizeDefenseList("")).toEqual([]);
    expect(normalizeDefenseList("Silver 1")).toEqual(["Silver 1"]);
    expect(normalizeDefenseList("Silver 1, Fire 2")).toEqual(["Silver 1", "Fire 2"]);
    expect(normalizeDefenseList("Silver 1; Fire 2")).toEqual(["Silver 1", "Fire 2"]);
    expect(normalizeDefenseList(["Silver 1", "  ", "Fire 2"])).toEqual(["Silver 1", "Fire 2"]);
  });
});

describe("resolvedFromPathbuilder", () => {
  const rc = resolvedFromPathbuilder(HERO);

  it("carries level, scores, and derived modifiers", () => {
    expect(rc.level).toBe(5);
    expect(rc.scores).toEqual({ str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 });
    expect(rc.mods).toEqual({ str: 4, dex: 2, con: 3, int: 0, wis: 1, cha: -1 });
  });

  it("agrees with the individual readers it composes", () => {
    expect(rc.hp.max).toBe(pathbuilderMaxHp(HERO));
    expect(rc.ac.value).toBe(pathbuilderAc(HERO));
    expect(rc.ac.shieldBonus).toBe(pathbuilderShieldBonus(HERO));
    expect(rc.perception.modifier).toBe(pathbuilderPerception(HERO));
    expect(rc.saves.fortitude.modifier).toBe(pathbuilderSaveBonus(HERO, "fortitude"));
    expect(rc.speeds.land).toBe(pathbuilderSpeed(HERO));
    expect(rc.focusPoints?.max).toBe(pathbuilderFocusPool(HERO));
  });

  it("records the proficiency rank behind each statistic, not just its total", () => {
    // The rank is what a Layer-1 effect keyed to proficiency reads.
    expect(rc.perception.rank).toBe(2);
    expect(rc.saves.fortitude.rank).toBe(2);
    expect(rc.saves.reflex.rank).toBe(1);
    expect(rc.skills.athletics?.rank).toBe(3);
    expect(rc.skills.stealth?.rank).toBe(0);
  });

  it("populates every skill core knows about, with its governing ability", () => {
    expect(rc.skills.athletics).toEqual({ modifier: 4 + 11, rank: 3, ability: "str" });
    expect(rc.skills.arcana).toEqual({ modifier: 0 + 7, rank: 1, ability: "int" });
    // Skills the build never mentions still resolve, as untrained.
    expect(rc.skills.medicine).toEqual({ modifier: 1, rank: 0, ability: "wis" });
  });

  it("carries the class DC with its rank, and null when there is none", () => {
    expect(rc.classDc).toEqual({ modifier: 23, rank: 2 });
    expect(resolvedFromPathbuilder({ ...HERO, proficiencies: {} }).classDc).toBeNull();
  });

  it("survives an empty build with defaults rather than throwing", () => {
    // The bot reads whatever is in `pathbuilder_data`; a sparse row must not crash
    // the effects engine before it starts.
    const empty = resolvedFromPathbuilder({});
    expect(empty.level).toBe(1);
    expect(empty.scores).toEqual({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
    expect(empty.mods).toEqual({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });
    expect(empty.hp.max).toBe(0);
    expect(empty.ac).toEqual({ value: 0, shieldBonus: 0 });
    expect(empty.classDc).toBeNull();
    expect(empty.speeds.land).toBe(25);
    expect(empty.keyAbility).toBeNull();
  });
});
