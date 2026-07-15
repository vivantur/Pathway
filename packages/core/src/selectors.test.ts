import { describe, expect, it } from "vitest";
import {
  FIXED_SELECTORS,
  isSelector,
  isSkillSlug,
  SAVE_SELECTORS,
  SKILL_SLUGS,
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
});
