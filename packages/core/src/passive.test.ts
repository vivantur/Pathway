import { describe, expect, it } from "vitest";
import type { ResolvedCharacter } from "./character.js";
import type { Expr } from "./expr.js";
import {
  applyPassiveEffects,
  collectPassiveSheetEffects,
  passiveEffectSchema,
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

  it("REFUSES a conditional effect — there is no tag context at derivation time", () => {
    // Applying it unconditionally would turn a situational bonus into a permanent one.
    const e = collectPassiveSheetEffects(
      [
        [
          {
            kind: "modifier",
            target: "will",
            bonusType: "status",
            value: lit(1),
            when: { tag: "self:trait:elf" },
          },
        ],
      ],
      ctx,
    );
    expect(e.statModifiers.size).toBe(0);
    expect(e.skipped).toBe(1);
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
