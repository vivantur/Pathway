// Every rule element in these tests is a REAL shape lifted from the ingested Foundry
// corpus (apps/web/src/features/builder/data/feats.json), not an invented one — an
// adapter tested against a fabricated version of the thing it adapts proves nothing.

import { describe, expect, it } from "vitest";
import { mapFoundryRules, summarizeReports, type RuleElement } from "./foundry.js";
import { evaluate, type Expr } from "./expr.js";
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

  it("blames the CHOICE, not the granting, when a grant's target is an unresolved selection", () => {
    // Measured: ~90 of 620 GrantItems on feats point at `{item|flags.…rulesSelections.x}`
    // — whatever a ChoiceSet earlier on the item selected. There is no entity to resolve
    // until that choice is made, so the blocker is the choice. Reporting these as
    // `needs-granting` overstated the entity-modelling work and hid them from the
    // runtime-choice tally, which is the number that would justify building choices.
    const { report } = mapFoundryRules([
      { key: "GrantItem", uuid: "{item|flags.system.rulesSelections.feat}" },
      { key: "GrantItem", uuid: "{actor|flags.system.gunslinger.initialDeed}" },
    ]);
    expect(report.map((e) => e.reason)).toEqual(["needs-runtime-choice", "needs-runtime-choice"]);
  });

  it("reports a static entity grant as needs-granting when it cannot be RESOLVED", () => {
    // No `knownFeatIds` supplied ⇒ nothing resolves ⇒ nothing is emitted. The default
    // is deliberate: a ref we cannot confirm is a dangling pointer.
    const { report, grants } = mapFoundryRules([
      { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Domain Initiate" },
      { key: "GrantItem", uuid: "Compendium.pf2e.actionspf2e.Item.Bon Mot" },
      { key: "GrantItem" }, // no uuid at all — still a grant, still unmapped
    ]);
    expect(report.map((e) => e.reason)).toEqual(["needs-granting", "needs-granting", "needs-granting"]);
    expect(grants).toEqual([]);
  });

  describe("feat grants become a build-graph edge, not an effect", () => {
    const known = new Set(["domain-initiate", "specialty-crafting", "alchemical-crafting"]);

    it("resolves a feats-srd uuid to OUR id, and emits no PassiveEffect for it", () => {
      const { grants, effects, report } = mapFoundryRules(
        [{ key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Domain Initiate" }],
        { knownFeatIds: known },
      );
      expect(grants).toEqual([{ type: "feat", ref: "domain-initiate" }]);
      expect(effects).toEqual([]);
      expect(report[0]).toMatchObject({ outcome: "mapped", produced: 1 });
    });

    it("resolves a name with an apostrophe, which our ids strip", () => {
      const { grants } = mapFoundryRules([{ key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Appraiser’s Eye" }], {
        knownFeatIds: new Set(["appraisers-eye"]),
      });
      expect(grants).toEqual([{ type: "feat", ref: "appraisers-eye" }]);
    });

    it("emits ONE grant for a doubled feat, and says so in the report", () => {
      // Elemental Trade / Anvil Dwarf. Two grants would assert the character holds
      // Specialty Crafting twice; per the owner it is held once with two professions.
      const { grants, report } = mapFoundryRules(
        [
          { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting", preselectChoices: { specialtyCrafting: "stonemasonry" } },
          { key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Specialty Crafting", preselectChoices: { specialtyCrafting: "blacksmithing" } },
        ],
        { knownFeatIds: known },
      );
      expect(grants).toEqual([{ type: "feat", ref: "specialty-crafting" }]);
      // The invariant holds — one entry per element — and the second NAMES what it
      // discarded rather than vanishing.
      expect(report).toHaveLength(2);
      expect(report[0]).toMatchObject({ outcome: "mapped", produced: 1 });
      expect(report[1]).toMatchObject({ outcome: "mapped", produced: 0 });
      expect(report[1]!.detail).toContain("blacksmithing");
    });

    it("refuses a feat we do not hold, and names it", () => {
      const { grants, report } = mapFoundryRules(
        [{ key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Some Feat We Lack" }],
        { knownFeatIds: known },
      );
      expect(grants).toEqual([]);
      expect(report[0]).toMatchObject({ outcome: "unsupported", reason: "needs-granting" });
      expect(report[0]!.detail).toContain("Some Feat We Lack");
    });

    it("refuses a non-feat pack even when the name would slugify to a feat we hold", () => {
      // classfeatures/ancestryfeatures are entities we do not carry (2/52 and 0/19
      // resolve), so trusting the name across packs would manufacture refs.
      const { grants, report } = mapFoundryRules(
        [{ key: "GrantItem", uuid: "Compendium.pf2e.classfeatures.Item.Domain Initiate" }],
        { knownFeatIds: known },
      );
      expect(grants).toEqual([]);
      expect(report[0]!.detail).toContain("classfeatures");
    });

    it("DEFERS a conditional grant rather than handing out an unearned feat", () => {
      const { grants, report } = mapFoundryRules(
        [{ key: "GrantItem", uuid: "Compendium.pf2e.feats-srd.Item.Domain Initiate", predicate: ["class:cleric"] }],
        { knownFeatIds: known },
      );
      expect(grants).toEqual([]);
      expect(report[0]).toMatchObject({ outcome: "unsupported" });
      expect(report[0]!.detail).toContain("conditional grant");
    });
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

  it("maps the infix half-your-level idiom now that expr.ts parses arithmetic", () => {
    // This was a tracked gap (~30 corpus values reported `unsupported-value`) until
    // expr.ts gained infix. The mapper needed no change — widening the grammar
    // turned a whole reason-bucket into mapped effects, which is exactly what the
    // reason tallies are for.
    const { effects, report } = mapFoundryRules([
      { key: "FlatModifier", selector: "hp", type: "untyped", value: "floor(@actor.level/2)" },
    ]);
    expect(report[0]).toMatchObject({ outcome: "mapped" });
    expect(effects[0]).toMatchObject({ kind: "modifier", target: "hp", bonusType: "untyped" });
    // The value is carried as an AST and evaluated per character, not at ingest.
    expect(evaluate((effects[0] as { value: Expr }).value, { vars: { level: 7 } }, "number")).toBe(3);
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

// Choice groups span several elements (a ChoiceSet plus the ActiveEffectLike(s) its
// flag is substituted into), so they are mapped as a group. Every fixture below is
// the REAL rules array from the corpus.
describe("mapFoundryRules — choice-driven rank grants", () => {
  it("maps a `config: skills` shorthand to one option per skill (Skill Training)", () => {
    const { choices, report } = mapFoundryRules([
      { key: "ChoiceSet", flag: "skill", choices: { config: "skills", predicate: ["skill:{choice|value}:rank:0"] } },
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.{item|flags.system.rulesSelections.skill}.rank", value: 1 },
    ] as unknown as RuleElement[]);

    expect(choices).toHaveLength(1);
    expect(choices[0]!.flag).toBe("skill");
    expect(choices[0]!.prompt).toBe("Skill");
    expect(choices[0]!.options).toHaveLength(16);
    // The stored value is OUR slug, never Foundry's `system.skills.x.rank` path.
    expect(choices[0]!.options[0]).toEqual({
      value: "acrobatics",
      label: "Acrobatics",
      effects: [{ kind: "proficiency", target: "acrobatics", rank: 1, mode: "upgrade" }],
    });
    // BOTH elements are consumed by the group — the report stays 1:1 with the input.
    expect(report).toHaveLength(2);
    expect(report.every((r) => r.outcome === "mapped")).toBe(true);
  });

  it("maps whole-path options and drops ones the engine can't apply", () => {
    // Canny Acumen's own SHAPE, with a literal rank substituted for its ternary. Here
    // the AEL's path IS the placeholder, so the option value is a complete rank path.
    const { choices } = mapFoundryRules([
      {
        key: "ChoiceSet",
        flag: "cannyAcumen",
        choices: [
          { label: "PF2E.SavesFortitude", value: "system.saves.fortitude.rank" },
          { label: "PF2E.PerceptionLabel", value: "system.perception.rank" },
          { label: "Nonsense", value: "system.details.nonsense.rank" }, // not a stat we apply
        ],
      },
      { key: "ActiveEffectLike", mode: "upgrade", path: "{item|flags.system.rulesSelections.cannyAcumen}", value: 2 },
    ] as unknown as RuleElement[]);

    expect(choices[0]!.prompt).toBe("Proficiency");
    // The unmappable option is OMITTED, not shown as a dropdown entry that does nothing.
    expect(choices[0]!.options.map((o) => o.value)).toEqual(["fortitude", "perception"]);
    expect(choices[0]!.options[0]!.effects).toEqual([
      { kind: "proficiency", target: "fortitude", rank: 2, mode: "upgrade" },
    ]);
  });

  it("maps a RESTRICTED list of bare slugs by substituting each into the path", () => {
    // Fighter Dedication: "trained in Acrobatics or Athletics". The selection is a
    // bare slug substituted INTO the path — the same rule as the whole-path case,
    // which is why both are one code path.
    const { choices } = mapFoundryRules([
      {
        key: "ChoiceSet",
        flag: "skill",
        choices: [{ value: "acrobatics" }, { value: "athletics" }],
      },
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.{item|flags.system.rulesSelections.skill}.rank", value: 1 },
    ] as unknown as RuleElement[]);

    expect(choices[0]!.prompt).toBe("Skill");
    expect(choices[0]!.options.map((o) => o.value)).toEqual(["acrobatics", "athletics"]);
  });

  it("yields no option when a selection doesn't substitute to a stat we apply", () => {
    // Fighter Dedication's OTHER ChoiceSet picks an attribute. Substituting "str"
    // gives `system.abilities.str.rank`, which is not a rank path — so the choice is
    // dropped rather than offered as a dropdown that does nothing.
    const { choices } = mapFoundryRules([
      { key: "ChoiceSet", flag: "attribute", choices: [{ value: "str" }, { value: "dex" }] },
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.abilities.{item|flags.system.rulesSelections.attribute}.rank", value: 1 },
    ] as unknown as RuleElement[]);
    expect(choices).toEqual([]);
  });

  it("maps object-valued options whose sub-fields name skills (Clan Lore)", () => {
    const { choices, report } = mapFoundryRules([
      {
        key: "ChoiceSet",
        flag: "clan",
        choices: [
          { label: "…Aringeld", value: { clan: "aringeld", skillOne: "diplomacy", skillTwo: "society" } },
          { label: "…Breakiron", value: { clan: "breakiron", skillOne: "crafting", skillTwo: "survival" } },
          { label: "…Tolorr", value: { clan: "tolorr", skillOne: "diplomacy", skillTwo: "society" } },
        ],
      },
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.{item|flags.system.rulesSelections.clan.skillOne}.rank", value: 1 },
      { key: "ActiveEffectLike", mode: "upgrade", path: "system.skills.{item|flags.system.rulesSelections.clan.skillTwo}.rank", value: 1 },
    ] as unknown as RuleElement[]);

    expect(choices[0]!.prompt).toBe("Trains");
    // Aringeld and Tolorr train the SAME pair — one option, not two identical ones.
    expect(choices[0]!.options).toHaveLength(2);
    expect(choices[0]!.options[0]).toEqual({
      value: "diplomacy,society",
      label: "Diplomacy, Society",
      effects: [
        { kind: "proficiency", target: "diplomacy", rank: 1, mode: "upgrade" },
        { kind: "proficiency", target: "society", rank: 1, mode: "upgrade" },
      ],
    });
    expect(report).toHaveLength(3);
    expect(report.every((r) => r.outcome === "mapped")).toBe(true);
  });

  it("carries a LEVEL-SCALED rank through as an expression (Canny Acumen)", () => {
    // Canny Acumen verbatim: expert, upgrading to master at 17th. The rank is not a
    // literal, so it stays an AST and is evaluated per character — mapping it as a
    // flat 2 would be a wrong sheet at level 17+.
    const { choices } = mapFoundryRules([
      { key: "ChoiceSet", flag: "cannyAcumen", choices: [{ label: "F", value: "system.saves.fortitude.rank" }] },
      {
        key: "ActiveEffectLike",
        mode: "upgrade",
        path: "{item|flags.system.rulesSelections.cannyAcumen}",
        value: "ternary(gte(@actor.level,17),3,2)",
      },
    ] as unknown as RuleElement[]);

    const effect = choices[0]!.options[0]!.effects[0] as { rank: Expr };
    expect(typeof effect.rank).toBe("object"); // an expression, not a number
    expect(evaluate(effect.rank, { vars: { level: 16 } }, "number")).toBe(2); // expert
    expect(evaluate(effect.rank, { vars: { level: 17 } }, "number")).toBe(3); // master
  });

  it("leaves a ChoiceSet that drives no rank grant to the normal per-element pass", () => {
    const { choices, report } = mapFoundryRules([
      { key: "ChoiceSet", flag: "weapon", choices: { config: "weapons" } },
    ] as unknown as RuleElement[]);
    expect(choices).toEqual([]);
    expect(report[0]).toMatchObject({ outcome: "unsupported", reason: "needs-runtime-choice" });
  });
});

// Every fixture below is a VERBATIM element from the corpus sidecar, not an invented
// shape — the vocabulary counts they stand for are in foundry.ts's section header.
describe("AdjustDegreeOfSuccess", () => {
  const effectTraits = new Set(['visual', 'emotion', 'fear', 'disease', 'poison', 'dream', 'illusion']);
  const map = (rule: RuleElement) => mapFoundryRules([rule], { effectTraits });

  it("maps Adaptive Vision, fanning a broadcast save selector across all three", () => {
    const { effects } = map({
      key: 'AdjustDegreeOfSuccess',
      adjustment: { success: 'one-degree-better' },
      predicate: ['visual'],
      selector: 'saving-throw',
      type: 'save',
    });
    expect(effects).toHaveLength(3);
    expect(effects[0]).toEqual({
      kind: 'rollAdjust',
      target: 'fortitude',
      adjust: { type: 'degreeMap', map: { success: 'critical-success' } },
      when: { tag: 'effect:trait:visual' },
    });
  });

  // The key names the incoming degree, which is what makes a RELATIVE instruction
  // resolvable to an absolute target with no approximation.
  it("resolves 'one-degree-better' against the degree its key names", () => {
    const { effects } = map({
      key: 'AdjustDegreeOfSuccess',
      adjustment: { criticalFailure: 'one-degree-better' },
      selector: 'will',
    });
    expect((effects[0] as { adjust: { map: unknown } }).adjust.map).toEqual({ 'critical-failure': 'failure' });
  });

  it("maps an absolute instruction too", () => {
    const { effects } = map({
      key: 'AdjustDegreeOfSuccess',
      adjustment: { success: 'to-critical-success' },
      selector: 'athletics',
    });
    expect((effects[0] as { adjust: { map: unknown } }).adjust.map).toEqual({ success: 'critical-success' });
  });

  it("expands `all` to every degree, dropping the entry that would rewrite nothing", () => {
    // A critical success one degree better is still a critical success — clamped, so
    // it says nothing and is omitted rather than stored as an identity rewrite.
    const { effects } = map({
      key: 'AdjustDegreeOfSuccess',
      adjustment: { all: 'one-degree-better' },
      selector: 'will',
    });
    expect((effects[0] as { adjust: { map: unknown } }).adjust.map).toEqual({
      'critical-failure': 'failure',
      failure: 'success',
      success: 'critical-success',
    });
  });

  it("maps a Foundry `or` to our `any`, reading item: as the incoming effect", () => {
    const { effects } = map({
      key: 'AdjustDegreeOfSuccess',
      adjustment: { criticalFailure: 'one-degree-better' },
      predicate: [{ or: ['item:trait:disease', 'item:trait:poison'] }],
      selector: 'fortitude',
    });
    expect((effects[0] as { when: unknown }).when).toEqual({
      any: [{ tag: 'effect:trait:disease' }, { tag: 'effect:trait:poison' }],
    });
  });

  it("refuses an action-scoped predicate rather than dropping it", () => {
    // We have no action vocabulary; shipping this unconditional would apply a
    // Climb-only rewrite to every Athletics check. 74 corpus elements are here.
    const { effects, report } = map({
      key: 'AdjustDegreeOfSuccess',
      adjustment: { success: 'one-degree-better' },
      predicate: ['action:climb'],
      selector: 'athletics',
    });
    expect(effects).toEqual([]);
    expect(report[0]!.reason).toBe('needs-combat-tags');
  });

  it("refuses a bare option the trait vocabulary does not confirm", () => {
    // Most bare Foundry roll options are feat slugs or flags, not traits. Guessing
    // would produce a condition that can never fire.
    const { report } = map({
      key: 'AdjustDegreeOfSuccess',
      adjustment: { success: 'one-degree-better' },
      predicate: ['student-of-the-canon'],
      selector: 'religion',
    });
    expect(report[0]!.reason).toBe('needs-combat-tags');
  });

  it("refuses a numeric predicate leaf, which the tag model excludes by design", () => {
    const { report } = map({
      key: 'AdjustDegreeOfSuccess',
      adjustment: { success: 'one-degree-better' },
      predicate: [{ gte: ['check:roll:total', 19] }],
      selector: 'will',
    });
    expect(report[0]!.reason).toBe('needs-combat-tags');
  });

  it("with NO trait vocabulary, a bare option maps nothing", () => {
    // The default. Honest when we have no corpus to check a word against.
    const { report } = mapFoundryRules([
      { key: 'AdjustDegreeOfSuccess', adjustment: { success: 'one-degree-better' }, predicate: ['visual'], selector: 'will' },
    ]);
    expect(report[0]!.reason).toBe('needs-combat-tags');
  });

  it("reports an unknown instruction rather than approximating it", () => {
    const { report } = map({
      key: 'AdjustDegreeOfSuccess',
      adjustment: { success: 'three-degrees-sideways' },
      selector: 'will',
    });
    expect(report[0]!.outcome).toBe('unsupported');
    expect(report[0]!.reason).toBe('unsupported-shape');
  });
});
