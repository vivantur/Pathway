import { describe, expect, it } from "vitest";
import type { ResolvedCharacter } from "./character.js";
import { parseExpr, type Expr } from "./expr.js";
import {
  applyPassiveEffects,
  collectPassiveSheetEffects,
  collectTraits,
  passiveEffectSchema,
  resolveRankValue,
  type PassiveEffect,
} from "./passive.js";

// A hand-resolved level-5 caster+martial hybrid, enough fields to fold onto every
// selector kind. Values are authored directly; this module does no derivation.
const base: ResolvedCharacter = {
  level: 5,
  scores: { str: 18, dex: 14, con: 14, int: 12, wis: 10, cha: 16 },
  mods: { str: 4, dex: 2, con: 2, int: 1, wis: 0, cha: 3 },
  keyAbility: "cha",
  traits: ["elf"],
  hp: { max: 60 },
  ac: { value: 22, shieldBonus: 0 },
  perception: { modifier: 11, rank: 2 },
  saves: {
    fortitude: { modifier: 13, rank: 2 },
    reflex: { modifier: 11, rank: 2 },
    will: { modifier: 9, rank: 1 },
  },
  classDc: { modifier: 20, rank: 1 },
  speeds: { land: 25 },
  skills: {
    athletics: { modifier: 12, rank: 2, ability: "str" },
    intimidation: { modifier: 11, rank: 1, ability: "cha" },
  },
  spellcasting: [
    { tradition: "arcane", ability: "cha", spellAttack: { modifier: 11, rank: 1 }, spellDc: { modifier: 21, rank: 1 } },
  ],
  focusPoints: { max: 1 },
};

const lit = (value: number): Expr => ({ kind: "lit", value });

const mod = (target: string, bonusType: string, value: number, when?: unknown): PassiveEffect =>
  ({ kind: "modifier", target, bonusType, value: lit(value), ...(when ? { when } : {}) }) as PassiveEffect;

describe("applyPassiveEffects — modifier folding + stacking", () => {
  it("folds a single status bonus into the AC total", () => {
    const out = applyPassiveEffects(base, [mod("ac", "status", 1)]);
    expect(out.character.ac.value).toBe(23);
    // input untouched
    expect(base.ac.value).toBe(22);
  });

  it("two bonuses of the SAME type: only the highest applies", () => {
    const out = applyPassiveEffects(base, [mod("will", "status", 1), mod("will", "status", 2)]);
    expect(out.character.saves.will.modifier).toBe(9 + 2);
  });

  it("bonuses of DIFFERENT types both add; a penalty nets against them", () => {
    const out = applyPassiveEffects(base, [
      mod("athletics", "status", 1),
      mod("athletics", "item", 2),
      mod("athletics", "circumstance", -1),
    ]);
    // +1 status +2 item -1 circumstance = +2 net over base 12
    expect(out.character.skills.athletics?.modifier).toBe(14);
  });

  it("untyped bonuses all stack (unlike typed)", () => {
    const out = applyPassiveEffects(base, [mod("perception", "untyped", 1), mod("perception", "untyped", 1)]);
    expect(out.character.perception.modifier).toBe(13);
  });

  it("reports the pre-stack modifiers per stat for provenance", () => {
    const out = applyPassiveEffects(base, [mod("ac", "status", 1), mod("ac", "status", 2)]);
    expect(out.modifiers.get("ac")).toEqual([
      { type: "status", value: 1 },
      { type: "status", value: 2 },
    ]);
    // but only the highest is folded
    expect(out.character.ac.value).toBe(24);
  });

  it("folds onto spell DC / spell attack and class DC", () => {
    const out = applyPassiveEffects(base, [
      mod("spell-dc", "status", 1),
      mod("spell-attack", "status", 1),
      mod("class-dc", "item", 2),
    ]);
    expect(out.character.spellcasting![0]!.spellDc.modifier).toBe(22);
    expect(out.character.spellcasting![0]!.spellAttack.modifier).toBe(12);
    expect(out.character.classDc!.modifier).toBe(22);
  });

  it("a value expression reads the character namespace (e.g. level)", () => {
    const out = applyPassiveEffects(base, [
      { kind: "modifier", target: "perception", bonusType: "untyped", value: { kind: "var", name: "level" } } as PassiveEffect,
    ]);
    expect(out.character.perception.modifier).toBe(11 + 5);
  });

  it("a zero-net contribution leaves the total (and object identity) unchanged", () => {
    const out = applyPassiveEffects(base, [mod("ac", "status", 0)]);
    expect(out.character).toBe(base); // no deltas → same reference
  });
});

describe("applyPassiveEffects — predicates gate modifiers", () => {
  it("a self:trait predicate that holds applies; one that fails does not", () => {
    const onElf = mod("ac", "status", 2, { tag: "self:trait:elf" });
    const onDwarf = mod("ac", "status", 2, { tag: "self:trait:dwarf" });
    expect(applyPassiveEffects(base, [onElf]).character.ac.value).toBe(24);
    expect(applyPassiveEffects(base, [onDwarf]).character.ac.value).toBe(22);
  });

  it("caller-supplied combat tags are unioned in before evaluation", () => {
    const offGuard = mod("ac", "circumstance", -2, { tag: "self:condition:off-guard" });
    expect(applyPassiveEffects(base, [offGuard]).character.ac.value).toBe(22);
    expect(applyPassiveEffects(base, [offGuard], { tags: ["self:condition:off-guard"] }).character.ac.value).toBe(20);
  });
});

describe("applyPassiveEffects — error policy", () => {
  it("skips and counts a modifier whose value references an unknown variable", () => {
    const bad: PassiveEffect = { kind: "modifier", target: "ac", bonusType: "status", value: { kind: "var", name: "nope" } } as PassiveEffect;
    const out = applyPassiveEffects(base, [bad, mod("ac", "status", 1)]);
    expect(out.skipped).toBe(1);
    expect(out.character.ac.value).toBe(23); // the good one still applied
  });
});

describe("applyPassiveEffects — non-modifier kinds are collected, not folded", () => {
  it("proficiency effects surface as rankGrants and do NOT change totals", () => {
    const out = applyPassiveEffects(base, [
      { kind: "proficiency", target: "will", rank: 3, mode: "upgrade" },
    ]);
    expect(out.rankGrants).toEqual([{ target: "will", rank: 3, mode: "upgrade" }]);
    expect(out.character.saves.will.modifier).toBe(9); // unchanged
    expect(out.character.saves.will.rank).toBe(1); // base rank; not raised here
  });

  it("grant effects are collected (predicate-gated)", () => {
    const out = applyPassiveEffects(base, [
      { kind: "grant", grant: { type: "sense", name: "darkvision" } },
      { kind: "grant", grant: { type: "speed", movement: "fly", value: lit(30) }, when: { tag: "self:trait:dwarf" } },
    ]);
    expect(out.grants).toEqual([{ type: "sense", name: "darkvision" }]); // dwarf-gated one filtered out
  });

  it("rollAdjust effects are collected for Layer 2", () => {
    const out = applyPassiveEffects(base, [
      { kind: "rollAdjust", target: "will", adjust: { type: "reroll", keep: "higher" } },
    ]);
    expect(out.rollAdjusts).toHaveLength(1);
    expect(out.rollAdjusts[0]!.adjust).toEqual({ type: "reroll", keep: "higher" });
  });

  it("note effects that pass their predicate are collected per stat", () => {
    const out = applyPassiveEffects(base, [
      { kind: "note", target: "athletics", text: "Ignore difficult terrain when Climbing." },
      { kind: "note", target: "ac", text: "gated", when: { tag: "self:trait:dwarf" } },
    ]);
    expect(out.notes).toEqual([{ target: "athletics", text: "Ignore difficult terrain when Climbing." }]);
  });
});

describe("applyPassiveEffects — reserved selectors and absent skills", () => {
  it("a reserved selector's modifier is reported but not folded (no field)", () => {
    const out = applyPassiveEffects(base, [mod("attack", "status", 1)]);
    expect(out.modifiers.get("attack")).toEqual([{ type: "status", value: 1 }]);
    // A reserved-selector modifier nets non-zero, so a (value-identical) copy is
    // returned; the reserved field simply has nowhere to fold.
    expect(out.character).toEqual(base);
    expect(out.character.ac.value).toBe(22);
  });

  it("a modifier on a skill the character lacks is reported but not folded", () => {
    const out = applyPassiveEffects(base, [mod("stealth", "item", 1)]);
    expect(out.modifiers.get("stealth")).toEqual([{ type: "item", value: 1 }]);
    expect(out.character.skills.stealth).toBeUndefined();
  });
});

describe("passiveEffectSchema", () => {
  it("validates each effect kind", () => {
    const samples: unknown[] = [
      { kind: "modifier", target: "ac", bonusType: "status", value: { kind: "lit", value: 1 } },
      { kind: "modifier", target: "will", bonusType: "circumstance", value: { kind: "lit", value: 2 }, when: { tag: "self:trait:elf" } },
      { kind: "proficiency", target: "athletics", rank: 2, mode: "upgrade" },
      { kind: "grant", grant: { type: "resistance", damageType: "fire", value: { kind: "lit", value: 5 } } },
      { kind: "rollAdjust", target: "will", adjust: { type: "degree", direction: "improve" } },
      { kind: "note", target: "perception", text: "Can't be flat-footed to hidden creatures." },
    ];
    for (const s of samples) expect(passiveEffectSchema.safeParse(s).success).toBe(true);
  });

  it("takes an EXPRESSION for a grant's numeric payload, not a bare number", () => {
    // "fire resistance equal to half your level" is ordinary content, and a grant is
    // authored/ingested with no character in hand — so a plain number could not
    // represent it. Values are expression ASTs everywhere (doc decision 1); a bare
    // number is rejected rather than silently coerced.
    const levelScaled = {
      kind: "grant",
      grant: { type: "resistance", damageType: "fire", value: { kind: "var", name: "level" } },
    };
    expect(passiveEffectSchema.safeParse(levelScaled).success).toBe(true);
    expect(
      passiveEffectSchema.safeParse({ kind: "grant", grant: { type: "resistance", damageType: "fire", value: 5 } })
        .success,
    ).toBe(false);
    expect(
      passiveEffectSchema.safeParse({ kind: "grant", grant: { type: "speed", movement: "fly", value: 15 } }).success,
    ).toBe(false);
  });

  it("rejects an unknown selector, bonus type, and rank out of range", () => {
    expect(passiveEffectSchema.safeParse({ kind: "modifier", target: "made-up", bonusType: "status", value: { kind: "lit", value: 1 } }).success).toBe(false);
    expect(passiveEffectSchema.safeParse({ kind: "modifier", target: "ac", bonusType: "sacred", value: { kind: "lit", value: 1 } }).success).toBe(false);
    expect(passiveEffectSchema.safeParse({ kind: "proficiency", target: "ac", rank: 5, mode: "set" }).success).toBe(false);
  });

  it("rejects an unknown discriminator and extra fields", () => {
    expect(passiveEffectSchema.safeParse({ kind: "teleport", target: "ac" }).success).toBe(false);
    expect(passiveEffectSchema.safeParse({ kind: "note", target: "ac", text: "x", extra: 1 }).success).toBe(false);
  });
});

// These carry over the behaviors the deleted `collectSheetEffects` tests protected.
// That function read FOUNDRY's rule elements at runtime; this one reads OUR effects,
// mapped at ingest. The mapping half is covered in foundry.test.ts — what is locked
// here is the COLLECTION: how effects fold into the bag a builder derives from.
describe("collectPassiveSheetEffects", () => {
  const lit = (value: number): Expr => ({ kind: "lit", value });
  const ctx = { level: 5 };

  it("sums untyped HP bonuses (Toughness → +level)", () => {
    const e = collectPassiveSheetEffects(
      [[{ kind: "modifier", target: "hp", bonusType: "untyped", value: { kind: "var", name: "level" } }]],
      { level: 8 },
    );
    expect(e.hpBonus).toBe(8);
    expect(e.skipped).toBe(0);
  });

  it("resolves an ability-mod variable in a value when abilityMods are supplied", () => {
    // "+strengthMod circumstance to Athletics" — a variable modifier. It resolves only when
    // the collect scope carries the ability mods; without them it falls back to being skipped.
    const eff = [[{ kind: "modifier" as const, target: "athletics" as const, bonusType: "circumstance" as const, value: { kind: "var" as const, name: "strengthMod" } }]];
    const withMods = collectPassiveSheetEffects(eff, { level: 5, abilityMods: { str: 4, dex: 1, con: 2, int: 0, wis: 0, cha: -1 } });
    expect(withMods.statModifiers.get("athletics")?.[0]?.value).toBe(4);
    expect(withMods.skipped).toBe(0);
    // level-only scope: strengthMod is unknown, so the effect is skipped (not guessed).
    const withoutMods = collectPassiveSheetEffects(eff, { level: 5 });
    expect(withoutMods.statModifiers.get("athletics")).toBeUndefined();
    expect(withoutMods.skipped).toBe(1);
  });

  it("counts a TYPED HP bonus rather than folding it in as untyped", () => {
    // The bag takes a single flat bonusHp; a typed bonus has nowhere to stack, so it
    // is reported, not quietly treated as if it were untyped.
    const e = collectPassiveSheetEffects(
      [[{ kind: "modifier", target: "hp", bonusType: "status", value: lit(5) }]],
      ctx,
    );
    expect(e.hpBonus).toBe(0);
    expect(e.skipped).toBe(1);
  });

  it("collects typed modifiers per selector, unstacked (stacking happens at use)", () => {
    const e = collectPassiveSheetEffects(
      [
        [
          { kind: "modifier", target: "perception", bonusType: "status", value: lit(2) },
          { kind: "modifier", target: "perception", bonusType: "circumstance", value: lit(1) },
          { kind: "modifier", target: "ac", bonusType: "item", value: lit(1) },
        ],
      ],
      ctx,
    );
    expect(e.statModifiers.get("perception")).toEqual([
      { type: "status", value: 2 },
      { type: "circumstance", value: 1 },
    ]);
    expect(e.statModifiers.get("ac")).toEqual([{ type: "item", value: 1 }]);
  });

  it("evaluates a value expression against the character level", () => {
    const e = collectPassiveSheetEffects(
      [[{ kind: "modifier", target: "will", bonusType: "status", value: { kind: "var", name: "level" } }]],
      { level: 3 },
    );
    expect(e.statModifiers.get("will")).toEqual([{ type: "status", value: 3 }]);
  });

  it("counts an unevaluable value instead of guessing", () => {
    const e = collectPassiveSheetEffects(
      [[{ kind: "modifier", target: "will", bonusType: "status", value: { kind: "var", name: "nope" } }]],
      ctx,
    );
    expect(e.statModifiers.size).toBe(0);
    expect(e.skipped).toBe(1);
  });

  it("takes the HIGHEST rank when several items grant the same skill", () => {
    const e = collectPassiveSheetEffects(
      [
        [{ kind: "proficiency", target: "thievery", rank: 1, mode: "upgrade" }],
        [{ kind: "proficiency", target: "thievery", rank: 3, mode: "upgrade" }],
        [{ kind: "proficiency", target: "thievery", rank: 2, mode: "upgrade" }],
      ],
      ctx,
    );
    expect(e.skillRanks.get("thievery")).toBe(3);
  });

  it("grants save and Perception ranks", () => {
    const e = collectPassiveSheetEffects(
      [
        [
          { kind: "proficiency", target: "fortitude", rank: 3, mode: "upgrade" },
          { kind: "proficiency", target: "perception", rank: 2, mode: "upgrade" },
        ],
      ],
      ctx,
    );
    expect(e.saveRanks.get("fortitude")).toBe(3);
    expect(e.perceptionRank).toBe(2);
  });

  it("counts a `set` proficiency — the bag is highest-wins and cannot lower a rank", () => {
    const e = collectPassiveSheetEffects(
      [[{ kind: "proficiency", target: "thievery", rank: 1, mode: "set" }]],
      ctx,
    );
    expect(e.skillRanks.size).toBe(0);
    expect(e.skipped).toBe(1);
  });

  it("attributes each applied effect to its source label", () => {
    const e = collectPassiveSheetEffects(
      [
        [{ kind: "modifier", target: "hp", bonusType: "untyped", value: lit(3) }],
        [{ kind: "proficiency", target: "thievery", rank: 1, mode: "upgrade" }],
      ],
      ctx,
      ["Toughness", "Adroit Manipulation"],
    );
    expect(e.applied).toEqual([
      { source: "Toughness", stat: "hp", summary: "+3 HP" },
      { source: "Adroit Manipulation", stat: "thievery", summary: "Trained in Thievery" },
    ]);
  });

  it("NEVER folds a conditional modifier into a total — but surfaces it for display", () => {
    // Folding it in would turn a situational bonus into a permanent one (a wrong
    // sheet). Discarding it would hide a bonus the player really has. So: shown,
    // not summed.
    const e = collectPassiveSheetEffects(
      [
        [
          {
            kind: "modifier",
            target: "will",
            bonusType: "status",
            value: lit(1),
            when: { tag: "opponent:trait:undead" },
          },
        ],
      ],
      ctx,
      ["Blessed One"],
    );
    expect(e.statModifiers.size).toBe(0);
    expect(e.applied).toEqual([]);
    expect(e.conditional).toEqual([
      { source: "Blessed One", stat: "will", summary: "+1 status to Will", condition: "vs undead" },
    ]);
    // It is displayed, so it is NOT an unexplained omission.
    expect(e.skipped).toBe(0);
  });

  it("renders a negative conditional modifier with its sign", () => {
    const e = collectPassiveSheetEffects(
      [[{ kind: "modifier", target: "ac", bonusType: "circumstance", value: lit(-2), when: { tag: "opponent:trait:dragon" } }]],
      ctx,
      ["Cursed"],
    );
    expect(e.conditional[0]).toEqual({
      source: "Cursed",
      stat: "ac",
      summary: "-2 circumstance to AC",
      condition: "vs dragon",
    });
  });

  it("still COUNTS a conditional effect that has no display form", () => {
    // A conditional grant/rollAdjust/proficiency has nowhere to be shown on this
    // bag, so it stays an honest `skipped` rather than a silent drop.
    const e = collectPassiveSheetEffects(
      [
        [
          { kind: "grant", grant: { type: "sense", name: "darkvision" }, when: { tag: "opponent:trait:undead" } },
          { kind: "rollAdjust", target: "will", adjust: { type: "degree", direction: "improve" }, when: { tag: "opponent:trait:undead" } },
        ],
      ],
      ctx,
    );
    expect(e.conditional).toEqual([]);
    expect(e.skipped).toBe(2);
  });

  it("counts a conditional modifier whose VALUE will not evaluate, rather than showing a guess", () => {
    const e = collectPassiveSheetEffects(
      [[{ kind: "modifier", target: "will", bonusType: "status", value: { kind: "var", name: "nonsense" }, when: { tag: "opponent:trait:undead" } }]],
      ctx,
    );
    expect(e.conditional).toEqual([]);
    expect(e.skipped).toBe(1);
  });

  it("drops a conditional modifier that evaluates to zero", () => {
    const e = collectPassiveSheetEffects(
      [[{ kind: "modifier", target: "will", bonusType: "status", value: lit(0), when: { tag: "opponent:trait:undead" } }]],
      ctx,
    );
    expect(e.conditional).toEqual([]);
    expect(e.skipped).toBe(0);
  });

  it("leaves `conditional` empty when nothing is conditional", () => {
    const e = collectPassiveSheetEffects(
      [[{ kind: "modifier", target: "will", bonusType: "status", value: lit(1) }]],
      ctx,
    );
    expect(e.conditional).toEqual([]);
    expect(e.statModifiers.get("will")?.[0]?.value).toBe(1);
  });

  it("counts grants and rollAdjusts — the derived sheet has no slot for them", () => {
    const e = collectPassiveSheetEffects(
      [
        [
          { kind: "grant", grant: { type: "sense", name: "darkvision" } },
          { kind: "rollAdjust", target: "will", adjust: { type: "degree", direction: "improve" } },
        ],
      ],
      ctx,
    );
    expect(e.skipped).toBe(2);
  });

  it("ignores notes without counting them — display text, not a sheet number", () => {
    const e = collectPassiveSheetEffects([[{ kind: "note", target: "athletics", text: "x" }]], ctx);
    expect(e.skipped).toBe(0);
    expect(e.statModifiers.size).toBe(0);
  });

  it("leaves an effectless build completely untouched", () => {
    const e = collectPassiveSheetEffects([], ctx);
    expect(e).toMatchObject({ hpBonus: 0, perceptionRank: null, skipped: 0, applied: [] });
    expect(e.statModifiers.size).toBe(0);
    expect(e.skillRanks.size).toBe(0);
    expect(e.saveRanks.size).toBe(0);
  });
});

// The grant slice: what `applyPassiveEffects` and `collectPassiveSheetEffects`
// both deliberately punt on. These are the ancestry/heritage senses and
// resistances the sheet shows.
describe("collectTraits (senses & resistances)", () => {
  const halfLevel = parseExpr("max(1,floor(@actor.level/2))");

  const sense = (name: string, extra: Record<string, unknown> = {}): PassiveEffect =>
    ({ kind: "grant", grant: { type: "sense", name, ...extra } }) as PassiveEffect;
  const resist = (damageType: string, value: Expr): PassiveEffect =>
    ({ kind: "grant", grant: { type: "resistance", damageType, value } }) as PassiveEffect;

  it("collects a simple sense and an acuity/range sense, attributed to their source", () => {
    const t = collectTraits(
      [[sense("darkvision")], [sense("scent", { acuity: "imprecise", range: 30 })]],
      { level: 1 },
      ["Cavern Elf", "Hunting Catfolk"],
    );
    expect(t.senses).toEqual([
      { type: "darkvision", source: "Cavern Elf" },
      { type: "scent", acuity: "imprecise", range: 30, source: "Hunting Catfolk" },
    ]);
    expect(t.skipped).toBe(0);
  });

  it("evaluates a level-scaled resistance per character — the real corpus expression", () => {
    // `max(1,floor(@actor.level/2))` is 31 of the 32 resistance values in the data.
    expect(collectTraits([[resist("cold", halfLevel)]], { level: 6 }).resistances).toEqual([
      { type: "cold", value: 3, source: "" },
    ]);
    // The max(1,…) clamp is why these apply from level 1.
    expect(collectTraits([[resist("cold", halfLevel)]], { level: 1 }).resistances).toEqual([
      { type: "cold", value: 1, source: "" },
    ]);
  });

  it("drops a resistance that rounds to 0 rather than showing 'resistance 0'", () => {
    const unclamped = parseExpr("floor(@actor.level/2)");
    expect(collectTraits([[resist("cold", unclamped)]], { level: 1 }).resistances).toEqual([]);
    expect(collectTraits([[resist("cold", unclamped)]], { level: 6 }).resistances).toEqual([
      { type: "cold", value: 3, source: "" },
    ]);
  });

  it("keeps the higher resistance and the more useful sense when they collide", () => {
    const t = collectTraits(
      [
        [resist("fire", { kind: "lit", value: 2 })],
        [resist("fire", { kind: "lit", value: 5 })],
        [sense("darkvision", { range: 30 })],
        [sense("darkvision")], // unlimited range wins
        [sense("scent", { acuity: "vague", range: 30 })],
        [sense("scent", { acuity: "imprecise", range: 30 })], // better acuity wins
      ],
      { level: 1 },
    );
    expect(t.resistances).toEqual([{ type: "fire", value: 5, source: "" }]);
    expect(t.senses).toEqual([
      { type: "darkvision", source: "" },
      { type: "scent", acuity: "imprecise", range: 30, source: "" },
    ]);
  });

  it("skips and counts a CONDITIONAL grant instead of showing it as permanent", () => {
    const conditional: PassiveEffect = {
      kind: "grant",
      grant: { type: "resistance", damageType: "fire", value: { kind: "lit", value: 5 } },
      when: { tag: "self:condition:frightened" },
    } as PassiveEffect;
    const t = collectTraits([[conditional]], { level: 6 });
    expect(t.resistances).toEqual([]);
    expect(t.skipped).toBe(1);
  });

  it("counts a resistance whose expression cannot be evaluated, never guessing a value", () => {
    const t = collectTraits([[resist("cold", { kind: "var", name: "nonesuch" })]], { level: 6 });
    expect(t.resistances).toEqual([]);
    expect(t.skipped).toBe(1);
  });

  it("ignores the other collectors' slices without counting them as misses", () => {
    const t = collectTraits(
      [
        [
          { kind: "modifier", target: "ac", bonusType: "item", value: { kind: "lit", value: 2 } },
          { kind: "proficiency", target: "athletics", rank: 1, mode: "upgrade" },
          { kind: "grant", grant: { type: "immunity", to: "fire" } },
          sense("scent"),
        ] as PassiveEffect[],
      ],
      { level: 1 },
    );
    expect(t.senses).toEqual([{ type: "scent", source: "" }]);
    expect(t.skipped).toBe(0);
  });
});

// A rank that varies by level (Canny Acumen: expert, master at 17th). The literal
// stays the common case; this is the expression path.
describe("resolveRankValue — level-scaled proficiency", () => {
  const canny = parseExpr("ternary(gte(@actor.level,17),3,2)");

  it("reads a literal rank straight through", () => {
    expect(resolveRankValue(2, 20)).toBe(2);
  });

  it("evaluates a level-scaled rank at the character's level", () => {
    expect(resolveRankValue(canny, 1)).toBe(2);
    expect(resolveRankValue(canny, 16)).toBe(2);
    expect(resolveRankValue(canny, 17)).toBe(3);
    expect(resolveRankValue(canny, 20)).toBe(3);
  });

  it("throws rather than clamping a rank outside 0-4", () => {
    expect(() => resolveRankValue({ kind: "lit", value: 7 }, 1)).toThrow(/outside/);
  });

  it("collectPassiveSheetEffects folds a level-scaled rank at the right level", () => {
    const effect: PassiveEffect = { kind: "proficiency", target: "will", rank: canny, mode: "upgrade" };
    expect(collectPassiveSheetEffects([[effect]], { level: 16 }).saveRanks.get("will")).toBe(2);
    expect(collectPassiveSheetEffects([[effect]], { level: 17 }).saveRanks.get("will")).toBe(3);
  });

  it("counts an unresolvable rank instead of guessing one", () => {
    const bad: PassiveEffect = {
      kind: "proficiency",
      target: "will",
      rank: { kind: "var", name: "nonesuch" },
      mode: "upgrade",
    };
    const out = collectPassiveSheetEffects([[bad]], { level: 5 });
    expect(out.saveRanks.size).toBe(0);
    expect(out.skipped).toBe(1);
  });
});
