// The condition vocabulary. Every expectation here traces to the rules text supplied
// by the project owner (Player Core pp. 442–447) — nothing is asserted from memory.
//
// The three GENERAL rules are driven end-to-end through `stackModifiers`, not just
// asserted structurally, because "only the worst penalty applies" is a claim about a
// resulting NUMBER and that is what a player sees.

import { describe, expect, it } from "vitest";
import {
  CONDITIONS,
  CONDITION_SLUGS,
  applyCondition,
  conditionGaps,
  conditionModifiers,
  conditionPassives,
  isConditionSlug,
  removeCondition,
  resolveConditions,
  type HeldCondition,
} from "./conditions.js";
import { stackModifiers, type Modifier } from "./effects.js";
import type { Selector } from "./selectors.js";

/** Net modifier a set of conditions produces for one stat — what the player sees. */
function netFor(held: readonly HeldCondition[], target: Selector): number {
  const mods: Modifier[] = conditionPassives(held)
    .filter((e) => e.kind === "modifier" && e.target === target)
    .map((e) => ({
      type: (e as { bonusType: Modifier["type"] }).bonusType,
      value: (e as { value: { value: number } }).value.value,
    }));
  return stackModifiers(mods);
}

describe("the vocabulary", () => {
  it("holds 41 conditions, each defined and self-consistent", () => {
    expect(CONDITION_SLUGS).toHaveLength(41);
    for (const slug of CONDITION_SLUGS) {
      const def = CONDITIONS[slug];
      expect(def.slug).toBe(slug);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.summary.length).toBeGreaterThan(0);
    }
  });

  it("recognizes its own slugs and nothing else", () => {
    expect(isConditionSlug("frightened")).toBe(true);
    expect(isConditionSlug("Frightened")).toBe(false);
    expect(isConditionSlug("exhausted")).toBe(false); // not a PF2e condition
  });

  it("names a blocker for every condition that carries no passives", () => {
    // The honesty invariant: a condition either contributes modifiers, or says why
    // not. A definition with neither is a silent gap — the thing this module exists
    // to prevent.
    for (const slug of CONDITION_SLUGS) {
      const def = CONDITIONS[slug];
      if (!def.passives) expect(def.unmodeled?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("marks exactly the death track as bot-owned, and gives it no passives", () => {
    // Core must not assert a second version of dying/wounded/doomed — that is the
    // drift bug packages/core exists to end.
    const deathTrack = CONDITION_SLUGS.filter((s) => CONDITIONS[s].unmodeled?.includes("death-track"));
    expect(deathTrack.sort()).toEqual(["doomed", "dying", "wounded"]);
    for (const s of deathTrack) expect(CONDITIONS[s].passives).toBeUndefined();
  });
});

describe("rule 3 — the same condition twice keeps the worst", () => {
  it("Enfeebled 1 then Enfeebled 2 is Enfeebled 2, not Enfeebled 3", () => {
    // The owner's worked example.
    const held = applyCondition(applyCondition([], "enfeebled", 1), "enfeebled", 2);
    expect(held).toEqual([{ slug: "enfeebled", value: 2 }]);
  });

  it("a lower value never downgrades a higher one", () => {
    const held = applyCondition(applyCondition([], "frightened", 3), "frightened", 1);
    expect(held).toEqual([{ slug: "frightened", value: 3 }]);
  });

  it("a binary condition applied twice is still held once", () => {
    expect(applyCondition(applyCondition([], "prone"), "prone")).toEqual([{ slug: "prone" }]);
  });

  it("caps a value the rules bound — dying stops at 4", () => {
    expect(applyCondition([], "dying", 9)).toEqual([{ slug: "dying", value: 4 }]);
  });

  it("removes cleanly", () => {
    const held = applyCondition(applyCondition([], "prone"), "frightened", 2);
    expect(removeCondition(held, "prone")).toEqual([{ slug: "frightened", value: 2 }]);
  });

  it("never mutates the input", () => {
    const held: HeldCondition[] = [{ slug: "enfeebled", value: 1 }];
    applyCondition(held, "enfeebled", 3);
    expect(held).toEqual([{ slug: "enfeebled", value: 1 }]);
  });
});

describe("rule 1 — the worst penalty applies, never the sum", () => {
  it("Clumsy 1 + Frightened 2 on a Dex-based DC takes the worse, not -3", () => {
    // The owner's worked example: both are STATUS penalties to AC, so stackModifiers
    // keeps the worse. This is the whole reason conditions emit typed modifiers.
    const held: HeldCondition[] = [
      { slug: "clumsy", value: 1 },
      { slug: "frightened", value: 2 },
    ];
    expect(netFor(held, "ac")).toBe(-2);
    expect(netFor(held, "reflex")).toBe(-2);
  });

  it("takes the clumsy value when IT is the worse one", () => {
    const held: HeldCondition[] = [
      { slug: "clumsy", value: 3 },
      { slug: "frightened", value: 1 },
    ];
    expect(netFor(held, "ac")).toBe(-3);
  });

  it("a circumstance penalty stacks WITH a status penalty — different types", () => {
    // Off-Guard is circumstance (-2 AC); Frightened is status. They do not compete.
    expect(netFor([{ slug: "off-guard" }, { slug: "frightened", value: 1 }], "ac")).toBe(-3);
  });
});

describe("rule 2 — a typed bonus and a same-typed penalty coexist", () => {
  it("a status bonus is not cancelled by a status penalty of the same type", () => {
    // +1 status (from anywhere) alongside frightened 1's -1 status nets 0 — both are
    // kept and summed, rather than one being discarded by type.
    const mods: Modifier[] = [
      { type: "status", value: 1 },
      { type: "status", value: -1 },
    ];
    expect(stackModifiers(mods)).toBe(0);
  });
});

describe("the numeric conditions", () => {
  it("Clumsy hits AC, Reflex and the three named skills", () => {
    const targets = conditionPassives([{ slug: "clumsy", value: 2 }]).map((e) => (e as { target: string }).target);
    expect(targets.sort()).toEqual(["ac", "acrobatics", "reflex", "stealth", "thievery"]);
    expect(netFor([{ slug: "clumsy", value: 2 }], "stealth")).toBe(-2);
  });

  it("Enfeebled hits Athletics, and NOT the unscoped attack/damage selectors", () => {
    // The rules scope it to Strength-based melee attacks and Strength-based damage;
    // our selectors cannot say "Strength-based", so those are named, not approximated.
    const targets = conditionPassives([{ slug: "enfeebled", value: 1 }]).map((e) => (e as { target: string }).target);
    expect(targets).toEqual(["athletics"]);
    expect(CONDITIONS.enfeebled.unmodeled).toContain("needs-selector");
  });

  it("Stupefied hits Will, spell attack/DC and only the Int/Wis/Cha skills", () => {
    const targets = conditionPassives([{ slug: "stupefied", value: 1 }]).map((e) => (e as { target: string }).target);
    expect(targets).toContain("will");
    expect(targets).toContain("spell-attack");
    expect(targets).toContain("spell-dc");
    expect(targets).toContain("arcana"); // int
    expect(targets).toContain("medicine"); // wis
    expect(targets).toContain("deception"); // cha
    // Str- and Dex-based skills are untouched.
    expect(targets).not.toContain("athletics");
    expect(targets).not.toContain("stealth");
    expect(targets).not.toContain("acrobatics");
  });

  it("Frightened reaches all checks and DCs INCLUDING AC, but not damage", () => {
    const targets = conditionPassives([{ slug: "frightened", value: 1 }]).map((e) => (e as { target: string }).target);
    expect(targets).toContain("ac"); // AC is a DC (owner-confirmed)
    expect(targets).toContain("perception");
    expect(targets).toContain("will");
    expect(targets).toContain("athletics");
    expect(targets).toContain("attack");
    expect(targets).not.toContain("damage"); // a damage roll is not a check or DC
    expect(targets).not.toContain("hp");
  });

  it("Fatigued is a flat -1 to AC and saves, with no value", () => {
    expect(netFor([{ slug: "fatigued" }], "ac")).toBe(-1);
    expect(netFor([{ slug: "fatigued" }], "will")).toBe(-1);
    expect(netFor([{ slug: "fatigued" }], "perception")).toBe(0);
  });

  it("Drained penalises Fortitude but does not touch HP as a modifier", () => {
    expect(netFor([{ slug: "drained", value: 2 }], "fortitude")).toBe(-2);
    expect(netFor([{ slug: "drained", value: 2 }], "hp")).toBe(0);
    expect(CONDITIONS.drained.unmodeled).toContain("hp-alteration");
  });

  it("Off-Guard is fully modelled — a flat -2 circumstance to AC and nothing unnamed", () => {
    expect(netFor([{ slug: "off-guard" }], "ac")).toBe(-2);
    expect(CONDITIONS["off-guard"].unmodeled).toBeUndefined();
  });
});

describe("implications", () => {
  it("Grabbed gives off-guard and immobilized", () => {
    const { active } = resolveConditions([{ slug: "grabbed" }]);
    expect(active.map((h) => h.slug).sort()).toEqual(["grabbed", "immobilized", "off-guard"]);
  });

  it("Encumbered implies clumsy 1 — an implication carrying a value", () => {
    const { active } = resolveConditions([{ slug: "encumbered" }]);
    expect(active).toContainEqual({ slug: "clumsy", value: 1 });
    expect(netFor([{ slug: "encumbered" }], "stealth")).toBe(-1);
  });

  it("does not let an implied value downgrade a directly held one", () => {
    // Clumsy 3 plus Encumbered (which implies clumsy 1) stays clumsy 3.
    const { active } = resolveConditions([{ slug: "clumsy", value: 3 }, { slug: "encumbered" }]);
    expect(active).toContainEqual({ slug: "clumsy", value: 3 });
  });

  it("resolves transitively: Dying → Unconscious → Blinded + Off-Guard", () => {
    const slugs = resolveConditions([{ slug: "dying", value: 1 }]).active.map((h) => h.slug);
    expect(slugs).toContain("unconscious");
    expect(slugs).toContain("blinded");
    expect(slugs).toContain("off-guard");
  });

  it("applies an implied condition's passives to the sheet", () => {
    // Unconscious is -4 status to AC; the off-guard it implies adds -2 circumstance.
    expect(netFor([{ slug: "unconscious" }], "ac")).toBe(-6);
  });
});

describe("overrides — the three explicit statements in the rules", () => {
  it("Blinded overrides Dazzled", () => {
    const r = resolveConditions([{ slug: "blinded" }, { slug: "dazzled" }]);
    expect(r.suppressed).toEqual(["dazzled"]);
    expect(r.active.map((h) => h.slug)).not.toContain("dazzled");
  });

  it("Restrained overrides Grabbed", () => {
    const r = resolveConditions([{ slug: "restrained" }, { slug: "grabbed" }]);
    expect(r.suppressed).toEqual(["grabbed"]);
  });

  it("Stunned overrides Slowed", () => {
    const r = resolveConditions([{ slug: "stunned", value: 1 }, { slug: "slowed", value: 2 }]);
    expect(r.suppressed).toEqual(["slowed"]);
  });

  it("suppresses via an IMPLIED condition too — Unconscious brings Blinded, which beats Dazzled", () => {
    const r = resolveConditions([{ slug: "unconscious" }, { slug: "dazzled" }]);
    expect(r.suppressed).toEqual(["dazzled"]);
  });

  it("does not suppress a condition that is not present", () => {
    expect(resolveConditions([{ slug: "blinded" }]).suppressed).toEqual([]);
  });

  it("suppression is a VIEW, so removing the overrider restores the overridden", () => {
    // Restrained is stored alongside Grabbed rather than destroying it; Escaping the
    // restraint must leave you still grabbed.
    const held = applyCondition(applyCondition([], "grabbed"), "restrained");
    expect(resolveConditions(held).active.map((h) => h.slug)).not.toContain("grabbed");
    expect(resolveConditions(removeCondition(held, "restrained")).active.map((h) => h.slug)).toContain("grabbed");
  });
});

describe("conditionModifiers — the numbers a sheet shows", () => {
  it("nets the owner's worked example to a single -2 on AC", () => {
    const m = conditionModifiers([
      { slug: "clumsy", value: 1 },
      { slug: "frightened", value: 2 },
    ]);
    expect(m.get("ac")).toBe(-2);
    expect(m.get("reflex")).toBe(-2);
  });

  it("adds a circumstance penalty on top of a status one", () => {
    expect(conditionModifiers([{ slug: "off-guard" }, { slug: "frightened", value: 1 }]).get("ac")).toBe(-3);
  });

  it("includes penalties arriving via implications", () => {
    // Unconscious: -4 status AC, plus the off-guard it implies at -2 circumstance.
    expect(conditionModifiers([{ slug: "unconscious" }]).get("ac")).toBe(-6);
  });

  it("omits stats no condition touches, so presence means 'this number changed'", () => {
    const m = conditionModifiers([{ slug: "clumsy", value: 2 }]);
    expect(m.has("ac")).toBe(true);
    expect(m.has("will")).toBe(false);
    expect(m.has("athletics")).toBe(false);
  });

  it("is empty for no conditions, and for conditions with no expressible effect", () => {
    expect(conditionModifiers([]).size).toBe(0);
    expect(conditionModifiers([{ slug: "slowed", value: 2 }]).size).toBe(0);
  });
});

describe("conditionGaps — what the passives do not say", () => {
  it("reports the blockers in force, deduped across conditions", () => {
    expect(conditionGaps([{ slug: "stupefied", value: 1 }])).toEqual(["flat-check"]);
    expect(conditionGaps([{ slug: "slowed", value: 1 }])).toEqual(["action-economy"]);
  });

  it("is empty for a fully-modelled condition", () => {
    expect(conditionGaps([{ slug: "off-guard" }])).toEqual([]);
  });

  it("includes gaps arriving via an implication", () => {
    // Dying itself is death-track; the Unconscious it implies adds action-economy.
    expect(conditionGaps([{ slug: "dying", value: 1 }])).toContain("action-economy");
  });
});
