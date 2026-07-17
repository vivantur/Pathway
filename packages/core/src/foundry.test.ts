// Every rule element in these tests is a REAL shape lifted from the ingested Foundry
// corpus (apps/web/src/features/builder/data/feats.json), not an invented one — an
// adapter tested against a fabricated version of the thing it adapts proves nothing.

import { describe, expect, it } from "vitest";
import { mapFoundryRules, summarizeReports, type RuleElement } from "./foundry.js";
import { featSchema } from "./feat.js";

describe("mapFoundryRules — the report invariant", () => {
  it("emits exactly one report entry per element, always", () => {
    // The whole point: the old collectSheetEffects looked only at kinds it treated
    // as sheet-relevant, so ~70% of the corpus vanished without a trace. Nothing may
    // fall through silently here.
    const rules: RuleElement[] = [
      { key: "FlatModifier", selector: "hp", value: "@actor.level", type: "untyped" },
      { key: "ItemAlteration", itemType: "weapon", mode: "add", property: "damage-dice" },
      { key: "Nonsense" },
      { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.x" },
    ];
    const { report } = mapFoundryRules(rules);
    expect(report).toHaveLength(rules.length);
    expect(report.map((e) => e.index)).toEqual([0, 1, 2, 3]);
  });

  it("names a blocker for every unsupported element — never a bare skip", () => {
    const { report } = mapFoundryRules([
      { key: "ItemAlteration" },
      { key: "ChoiceSet" },
      { key: "RollOption" },
      { key: "GrantItem" },
    ]);
    expect(report.every((e) => e.outcome === "unsupported" && e.reason && e.detail)).toBe(true);
    expect(report.map((e) => e.reason)).toEqual([
      "needs-item-model",
      "needs-runtime-choice",
      "needs-combat-tags",
      "needs-granting",
    ]);
  });

  it("reports an unknown kind rather than ignoring it", () => {
    const { report } = mapFoundryRules([{ key: "SomeNewFoundryThing" }]);
    expect(report[0]).toMatchObject({ outcome: "unsupported", reason: "unknown-key" });
  });
});

describe("mapFoundryRules — conditional elements", () => {
  // 540 of the corpus's 592 FlatModifiers carry a predicate. Dropping the condition
  // would turn a situational bonus into a permanent one — a WRONG sheet, which is
  // worse than an absent effect. So they are reported, never mapped-unconditionally.
  it("refuses a predicated element instead of dropping the condition", () => {
    const { effects, report } = mapFoundryRules([
      { key: "FlatModifier", predicate: ["emotion"], selector: "will", type: "circumstance", value: 1 },
    ]);
    expect(effects).toEqual([]);
    expect(report[0]).toMatchObject({ outcome: "unsupported", reason: "needs-combat-tags" });
  });

  it("checks the predicate before the shape, so the reason names the real blocker", () => {
    // This one is ALSO on an unmappable selector; the predicate is the first wall.
    const { report } = mapFoundryRules([
      { key: "FlatModifier", predicate: ["action:perform"], selector: "strike-damage", value: 2 },
    ]);
    expect(report[0]!.reason).toBe("needs-combat-tags");
  });

  it("maps an element whose predicate key is present but empty", () => {
    const { effects } = mapFoundryRules([
      { key: "FlatModifier", predicate: [], selector: "perception", type: "status", value: 1 },
    ]);
    expect(effects).toHaveLength(1);
  });
});

describe("mapFoundryRules — FlatModifier", () => {
  it("maps an unconditional typed modifier", () => {
    const { effects, report } = mapFoundryRules([
      { key: "FlatModifier", selector: "perception", type: "status", value: 2 },
    ]);
    expect(effects).toEqual([
      { kind: "modifier", target: "perception", bonusType: "status", value: { kind: "lit", value: 2 } },
    ]);
    expect(report[0]).toMatchObject({ outcome: "mapped", produced: 1 });
  });

  it("treats a missing type as untyped (87 of the corpus's FlatModifiers)", () => {
    const { effects } = mapFoundryRules([{ key: "FlatModifier", selector: "initiative", value: 1 }]);
    expect(effects[0]).toMatchObject({ bonusType: "untyped" });
  });

  it("carries @actor.level through as an EXPRESSION, unevaluated (Toughness)", () => {
    // There is no character at ingest, so the value stays an AST to be evaluated per
    // character at read time. This is why grant/modifier values are Expr, not number.
    const { effects } = mapFoundryRules([
      { key: "FlatModifier", selector: "hp", type: "untyped", value: "@actor.level" },
    ]);
    expect(effects[0]).toMatchObject({ kind: "modifier", target: "hp", value: { kind: "var", name: "level" } });
  });

  it("fans a broadcast selector out to each stat it really hits", () => {
    const saves = mapFoundryRules([
      { key: "FlatModifier", selector: "saving-throw", type: "circumstance", value: 1 },
    ]);
    expect(saves.effects.map((e) => (e as { target: string }).target)).toEqual(["fortitude", "reflex", "will"]);
    expect(saves.report[0]).toMatchObject({ outcome: "mapped", produced: 3 });

    const skills = mapFoundryRules([{ key: "FlatModifier", selector: "skill-check", type: "status", value: 1 }]);
    expect(skills.effects).toHaveLength(16);
  });

  it("maps an array selector", () => {
    const { effects } = mapFoundryRules([
      { key: "FlatModifier", selector: ["perception", "stealth"], type: "item", value: 1 },
    ]);
    expect(effects.map((e) => (e as { target: string }).target)).toEqual(["perception", "stealth"]);
  });

  it("rejects a bonus type outside our vocabulary rather than coercing it", () => {
    const { effects, report } = mapFoundryRules([
      { key: "FlatModifier", selector: "ac", type: "proficiency", value: 1 },
    ]);
    expect(effects).toEqual([]);
    expect(report[0]).toMatchObject({ reason: "unsupported-bonus-type", detail: 'type "proficiency"' });
  });

  it("reports a per-weapon selector as unsupported, not as `damage`", () => {
    const { report } = mapFoundryRules([
      { key: "FlatModifier", selector: "strike-damage", type: "circumstance", value: 2 },
    ]);
    expect(report[0]).toMatchObject({ reason: "unsupported-selector" });
  });

  it("reports the infix `floor(@actor.level/2)` idiom, which expr.ts cannot parse yet", () => {
    // ~30 corpus values look like this. Named here so the gap is a tracked roadmap
    // item rather than a silent absence: it needs infix arithmetic in expr.ts.
    const { report } = mapFoundryRules([
      { key: "FlatModifier", selector: "hp", type: "untyped", value: "floor(@actor.level/2)" },
    ]);
    expect(report[0]).toMatchObject({ reason: "unsupported-value" });
  });

  it("reports a deep Foundry actor-data ref — mapping it would import their schema", () => {
    const { report } = mapFoundryRules([
      { key: "FlatModifier", selector: "ac", value: "@actor.system.proficiencies.defenses.light.rank" },
    ]);
    expect(report[0]).toMatchObject({ reason: "unsupported-value" });
  });

  it("reports a {choice|…} interpolation as needing a runtime choice", () => {
    const { report } = mapFoundryRules([
      { key: "FlatModifier", selector: "ac", value: "{item|flags.system.rulesSelections.x}" },
    ]);
    expect(report[0]).toMatchObject({ reason: "needs-runtime-choice" });
  });
});

describe("mapFoundryRules — ActiveEffectLike (proficiency ranks)", () => {
  it("maps an upgrade on a skill rank path", () => {
    const { effects } = mapFoundryRules([
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.thievery.rank", value: 1 },
    ]);
    expect(effects).toEqual([{ kind: "proficiency", target: "thievery", rank: 1, mode: "upgrade" }]);
  });

  it("maps save and perception rank paths, including the attributes. variant", () => {
    const saves = mapFoundryRules([
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.saves.fortitude.rank", value: 2 },
    ]);
    expect(saves.effects[0]).toMatchObject({ target: "fortitude", rank: 2 });

    const perc = mapFoundryRules([
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.attributes.perception.rank", value: 3 },
    ]);
    expect(perc.effects[0]).toMatchObject({ target: "perception", rank: 3 });
  });

  it("maps override to `set` and refuses `add` (rank arithmetic has no equivalent)", () => {
    const over = mapFoundryRules([
      { key: "ActiveEffectLike", mode: "override", path: "system.skills.arcana.rank", value: 4 },
    ]);
    expect(over.effects[0]).toMatchObject({ mode: "set", rank: 4 });

    const add = mapFoundryRules([
      { key: "ActiveEffectLike", mode: "add", path: "system.skills.arcana.rank", value: 1 },
    ]);
    expect(add.report[0]).toMatchObject({ reason: "unsupported-shape" });
  });

  it("reports a non-rank path — that is Foundry's actor schema, not ours", () => {
    const { report } = mapFoundryRules([
      { key: "ActiveEffectLike", mode: "override", path: "system.details.ancestry.adopted", value: "x" },
    ]);
    expect(report[0]).toMatchObject({ reason: "unsupported-selector" });
  });

  it("reports a choice-driven skill path", () => {
    const { report } = mapFoundryRules([
      {
        key: "ActiveEffectLike",
        mode: "upgrade",
        path: "system.skills.{item|flags.system.rulesSelections.skill}.rank",
        value: 1,
      },
    ]);
    expect(report[0]!.outcome).toBe("unsupported");
  });

  it("rejects a rank outside 0-4", () => {
    const { report } = mapFoundryRules([
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.arcana.rank", value: 9 },
    ]);
    expect(report[0]).toMatchObject({ reason: "unsupported-value" });
  });
});

describe("mapFoundryRules — grants", () => {
  it("maps a level-scaled resistance as an expression (the schema-widening case)", () => {
    // "fire resistance equal to half your level" is common content. A number-valued
    // grant could not hold this at all: ingest has no character to evaluate against.
    const { effects } = mapFoundryRules([{ key: "Resistance", type: "fire", value: "@actor.level" }]);
    expect(effects[0]).toEqual({
      kind: "grant",
      grant: { type: "resistance", damageType: "fire", value: { kind: "var", name: "level" } },
    });
  });

  it("maps a flat weakness and keeps resistance exceptions", () => {
    const w = mapFoundryRules([{ key: "Weakness", type: "cold-iron", value: 5 }]);
    expect(w.effects[0]).toMatchObject({ grant: { type: "weakness", damageType: "cold-iron" } });

    const r = mapFoundryRules([
      { key: "Resistance", type: "physical", value: 5, exceptions: ["silver"] },
    ]);
    expect(r.effects[0]).toMatchObject({ grant: { type: "resistance", exceptions: ["silver"] } });
  });

  it("fans an array of immunities out to one grant each", () => {
    const { effects } = mapFoundryRules([{ key: "Immunity", type: ["paralyzed", "sleep"] }]);
    expect(effects).toHaveLength(2);
    expect(effects.map((e) => (e as { grant: { to: string } }).grant.to)).toEqual(["paralyzed", "sleep"]);
  });

  it("reports a choice-driven resistance type", () => {
    const { report } = mapFoundryRules([
      { key: "Resistance", type: "{item|flags.system.rulesSelections.deflectingWave}", value: 5 },
    ]);
    expect(report[0]).toMatchObject({ reason: "needs-runtime-choice" });
  });

  it("maps a sense with range and acuity", () => {
    const { effects } = mapFoundryRules([
      { key: "Sense", selector: "darkvision" },
      { key: "Sense", selector: "scent", acuity: "imprecise", range: 30 },
    ]);
    expect(effects[0]).toMatchObject({ grant: { type: "sense", name: "darkvision" } });
    expect(effects[1]).toMatchObject({ grant: { type: "sense", name: "scent", acuity: "imprecise", range: 30 } });
  });

  it("maps a base speed, tolerating Foundry's `-speed` suffix", () => {
    const { effects } = mapFoundryRules([
      { key: "BaseSpeed", selector: "fly", value: 15 },
      { key: "BaseSpeed", selector: "swim-speed", value: 20 },
    ]);
    expect(effects[0]).toMatchObject({ grant: { type: "speed", movement: "fly", value: { kind: "lit", value: 15 } } });
    expect(effects[1]).toMatchObject({ grant: { type: "speed", movement: "swim" } });
  });

  it("reports an unknown movement rather than inventing one", () => {
    const { report } = mapFoundryRules([{ key: "BaseSpeed", selector: "all-speeds", value: 10 }]);
    expect(report[0]).toMatchObject({ reason: "unsupported-selector" });
  });
});

describe("mapFoundryRules — Note", () => {
  it("maps an unconditional plain note", () => {
    const { effects } = mapFoundryRules([
      { key: "Note", selector: "athletics", text: "You can Climb at full Speed.", title: "Quick Climb" },
    ]);
    expect(effects[0]).toEqual({ kind: "note", target: "athletics", text: "You can Climb at full Speed." });
  });

  it("refuses a degree-scoped note — our note has no outcome field to hold it", () => {
    const { report } = mapFoundryRules([
      { key: "Note", outcome: ["criticalSuccess"], selector: "athletics", text: "x" },
    ]);
    expect(report[0]).toMatchObject({ reason: "unsupported-shape" });
  });

  it("refuses a note whose text is a Foundry content reference", () => {
    const { report } = mapFoundryRules([
      { key: "Note", selector: "will", text: "<em>@Localize[PF2E.SpecificRule.Dhampir.X]</em>" },
    ]);
    expect(report[0]).toMatchObject({ reason: "unsupported-value" });
  });
});

describe("mapped effects are valid against our own schema", () => {
  it("everything the mapper emits parses as a PassiveEffect on a feat", () => {
    // The mapper's output is content we will store, so it must satisfy the schema a
    // homebrew author's output would — one schema, official and homebrew alike.
    const { effects } = mapFoundryRules([
      { key: "FlatModifier", selector: "hp", type: "untyped", value: "@actor.level" },
      { key: "FlatModifier", selector: "saving-throw", type: "circumstance", value: 1 },
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.thievery.rank", value: 1 },
      { key: "Resistance", type: "fire", value: "@actor.level" },
      { key: "Sense", selector: "darkvision" },
      { key: "BaseSpeed", selector: "fly", value: 15 },
      { key: "Note", selector: "athletics", text: "note" },
    ]);
    const parsed = featSchema.safeParse({
      id: "toughness",
      version: 1,
      name: "Toughness",
      ownerKind: "official",
      source: { title: "Player Core" },
      rarity: "common",
      traits: [],
      isLegacy: false,
      level: 1,
      classIds: [],
      rules: [],
      effects,
      review: { status: "unreviewed" },
      description: "You can withstand more punishment.",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("summarizeReports", () => {
  it("tallies reasons across entities — the corpus roadmap", () => {
    const a = mapFoundryRules([
      { key: "FlatModifier", selector: "perception", type: "status", value: 1 },
      { key: "RollOption", option: "x" },
    ]);
    const b = mapFoundryRules([
      { key: "ItemAlteration" },
      { key: "FlatModifier", predicate: ["emotion"], selector: "will", value: 1 },
      { key: "FlatModifier", selector: "saving-throw", type: "circumstance", value: 1 },
    ]);
    const s = summarizeReports([a.report, b.report]);
    expect(s).toMatchObject({
      elements: 5,
      mapped: 2,
      unsupported: 3,
      effects: 4, // 1 + the saving-throw fan-out to 3
    });
    expect(s.byReason).toEqual({ "needs-combat-tags": 2, "needs-item-model": 1 });
    expect(s.byKey).toEqual({ RollOption: 1, ItemAlteration: 1, FlatModifier: 1 });
  });
});
