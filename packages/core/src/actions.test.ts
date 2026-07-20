import { describe, expect, it } from "vitest";
import {
  ACTION_SKILLS,
  ACTION_SLUGS,
  BASIC_ACTION_SLUGS,
  SKILL_ACTION_SLUGS,
  SPECIALTY_BASIC_ACTION_SLUGS,
  actionTag,
  actionsForSkill,
  isActionSlug,
  isSkillAction,
  skillsForAction,
} from "./actions.js";
import { SKILL_SLUGS } from "./selectors.js";

describe("the action vocabulary", () => {
  it("is the union of its three sources, with nothing lost", () => {
    expect(ACTION_SLUGS).toHaveLength(
      BASIC_ACTION_SLUGS.length + SPECIALTY_BASIC_ACTION_SLUGS.length + SKILL_ACTION_SLUGS.length,
    );
    expect(BASIC_ACTION_SLUGS).toHaveLength(15);
    expect(SPECIALTY_BASIC_ACTION_SLUGS).toHaveLength(10);
    expect(SKILL_ACTION_SLUGS).toHaveLength(50);
  });

  it("contains no duplicates across the three groups", () => {
    expect(new Set(ACTION_SLUGS).size).toBe(ACTION_SLUGS.length);
  });

  it("uses kebab-case slugs throughout — the form Foundry predicates carry", () => {
    for (const slug of ACTION_SLUGS) expect(slug).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  });

  it("recognises members and refuses non-members", () => {
    expect(isActionSlug("demoralize")).toBe(true);
    expect(isActionSlug("escape")).toBe(true);
    expect(isActionSlug("raise-a-shield")).toBe(true);
    // Feat-granted actions and creature abilities are real, but are NOT in this
    // vocabulary — the mapper must refuse them rather than invent a tag.
    expect(isActionSlug("battle-medicine")).toBe(false);
    expect(isActionSlug("scare-to-death")).toBe(false);
    expect(isActionSlug("swallow-whole")).toBe(false);
    expect(isActionSlug("")).toBe(false);
    expect(isActionSlug(undefined)).toBe(false);
    expect(isActionSlug(42)).toBe(false);
  });

  it("omits Stride, which the source page references but does not define", () => {
    // Documented in actions.ts: adding it would be a rules claim with no source,
    // and no corpus content asks for it. This test exists so its absence reads as
    // a decision rather than an oversight.
    expect(isActionSlug("stride")).toBe(false);
  });
});

describe("skill associations", () => {
  it("gives every skill action at least one skill", () => {
    for (const action of SKILL_ACTION_SLUGS) {
      expect(ACTION_SKILLS[action].length).toBeGreaterThan(0);
    }
  });

  it("names only real skills, plus the open-ended lore", () => {
    const allowed = new Set<string>([...SKILL_SLUGS, "lore"]);
    for (const action of SKILL_ACTION_SLUGS) {
      for (const skill of ACTION_SKILLS[action]) expect(allowed.has(skill)).toBe(true);
    }
  });

  it("keeps every skill of a many-to-many action", () => {
    // Recall Knowledge is the widest — collapsing it to one skill would be a rules
    // claim with no basis, so the map holds all seven.
    expect([...skillsForAction("recall-knowledge")].sort()).toEqual([
      "arcana",
      "crafting",
      "lore",
      "nature",
      "occultism",
      "religion",
      "society",
    ]);
    expect([...skillsForAction("earn-income")].sort()).toEqual(["crafting", "lore", "performance"]);
    expect([...skillsForAction("subsist")].sort()).toEqual(["society", "survival"]);
  });

  it("distinguishes skill actions from basic ones", () => {
    expect(isSkillAction("demoralize")).toBe(true);
    expect(isSkillAction("escape")).toBe(false);
    expect(isSkillAction("raise-a-shield")).toBe(false);
  });

  it("reports no skills for a basic action rather than guessing one", () => {
    // Escape is Athletics-flavoured but is a BASIC action usable with several
    // skills depending on the effect; the source does not assign it one, so
    // neither do we.
    expect(skillsForAction("escape")).toEqual([]);
    expect(skillsForAction("strike")).toEqual([]);
  });

  it("inverts consistently — actionsForSkill agrees with ACTION_SKILLS", () => {
    for (const skill of [...SKILL_SLUGS, "lore" as const]) {
      for (const action of actionsForSkill(skill)) {
        expect(ACTION_SKILLS[action]).toContain(skill);
      }
    }
    expect(actionsForSkill("athletics")).toContain("grapple");
    expect(actionsForSkill("athletics")).toContain("trip");
    expect(actionsForSkill("intimidation")).toEqual(["coerce", "demoralize"]);
  });

  it("gives every one of the 16 skills at least one action", () => {
    for (const skill of SKILL_SLUGS) {
      expect(actionsForSkill(skill).length).toBeGreaterThan(0);
    }
  });
});

describe("actionTag", () => {
  it("builds the namespaced tag a predicate matches on", () => {
    expect(actionTag("demoralize")).toBe("action:demoralize");
    expect(actionTag("raise-a-shield")).toBe("action:raise-a-shield");
  });
});
