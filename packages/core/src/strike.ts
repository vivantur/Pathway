// The Strike model — the slot pipeline that turns a strike SOURCE plus a
// character into a resolved attack modifier and damage.
//
// PURE: arithmetic and structure only. No I/O, no dice rolled (the returned
// damage is a set of formulas for the Layer-2 interpreter to roll).
//
// THE ONE DESIGN DECISION THAT MATTERS: **a Strike is the primitive, and a weapon
// is one PRODUCER of strikes.** Every stat a strike needs is a named SLOT with a
// priority chain of providers:
//
//   traits      ← the source's traits + any added by the wielder's configuration
//                 (resolved FIRST — agile/finesse/propulsive/deadly/fatal feed
//                  every slot below)
//   ability     ← trait-derived default  ⟵ source declaration  ⟵ user override
//   rank        ← supplied by the caller ⟵ proficiency override
//   itemBonus   ← potency rune  ⟵ ABP  ⟵ override
//   diceCount   ← 1  ⟵ striking rune  ⟵ source scaling  ⟵ override
//   diceSize    ← the source's die  ⟵ increase-dice  ⟵ source scaling
//   damageBonus ← trait-derived ability damage + extras
//
// WHY: if this were `Weapon → number`, weapon assumptions (runes as THE dice
// source, weapon groups, str/dex finesse) would be baked into the type, and every
// non-weapon attack would be a special case. With slots, a Kineticist's Elemental
// Blast is a source that declares `attackAbility: "con"` and its own scaling rule
// — no special case at all — and Pathbuilder's attack-editor override fields are
// the same mechanism seen from the user side.
//
// RULES PROVENANCE. Every rule here comes from text in docs/strikes-and-weapons.md
// (owner-supplied) or is ported UNCHANGED from the web builder's verified
// implementation (`apps/web/src/features/builder/rules.ts`), which is locked by
// its own tests and by the character sheet. Nothing here is remembered PF2e. The
// ported parts are marked [PORTED].

import type { DamageComponent, AutomationNode, MapOptions } from "./automation.js";
import { z } from "zod";
import { evaluate, exprSchema, type Expr } from "./expr.js";
import { isDamageType } from "./damage.js";
import type { DamageType } from "./damage.js";
import { stackModifiers, type Modifier } from "./effects.js";
import { proficientModifier } from "./derived.js";
import { proficiencyBonus } from "./stats.js";
import type { ProficiencyRank } from "./proficiency.js";
import {
  selectorMatchesStrike,
  type AbilityKey,
  type ScopedSelector,
  type StrikeDescriptor,
} from "./selectors.js";
// Type-only, and weapon.ts imports only types from here — no runtime cycle.
// The rune shape lives with the weapon because that is whose property it is;
// this module consumes it.
import type { WeaponRunes } from "./weapon.js";

// ---------------------------------------------------------------------------
// dice sizes
// ---------------------------------------------------------------------------

/**
 * The damage die ladder. Increase-dice steps one rung up it; a d12 does not move
 * ("There is no effect on an existing d12" — owner-supplied).
 */
export const DIE_LADDER = [4, 6, 8, 10, 12] as const;
export type DieSize = (typeof DIE_LADDER)[number];

/** One step up the ladder, clamped at d12. */
export function increaseDieSize(size: number): number {
  const i = DIE_LADDER.indexOf(size as DieSize);
  if (i < 0) return size; // an off-ladder die (homebrew d3, d20) is left alone
  return DIE_LADDER[Math.min(i + 1, DIE_LADDER.length - 1)]!;
}

// ---------------------------------------------------------------------------
// the source
// ---------------------------------------------------------------------------

/**
 * Explicit dice scaling for a source that does NOT use runes — a Kineticist's
 * Elemental Blast, a monk's unarmed progression, a homebrew attack. Replaces the
 * rune/ABP dice contribution entirely.
 *
 * TWO FORMS, and the declarative one is canonical:
 *
 *  • `{ count?: Expr; size?: Expr }` — the STORABLE form, evaluated with `level`
 *    in scope through the sandboxed expression evaluator (expr.ts, no `eval`).
 *    This is what content carries, because a strike granted by a feat or built by
 *    a player in the app has to survive a round trip through JSON and a database.
 *    A JS closure cannot be stored, validated, reviewed, or diffed — which would
 *    have made "custom attacks" impossible however well the pipeline worked.
 *
 *  • a plain function — convenience for sources constructed IN CODE (tests, a
 *    hard-coded demo). Never accepted by `strikeSourceSchema`, so it cannot leak
 *    into stored content.
 */
export type StrikeScalingExpr = { count?: Expr; size?: Expr };
export type StrikeScalingFn = (level: number) => { count?: number; size?: number };
export type StrikeScaling = StrikeScalingFn | StrikeScalingExpr;

/**
 * Evaluate either scaling form at a level. The expression scope deliberately
 * exposes ONLY `level`: a scaling rule that needed a character's abilities would
 * be a different mechanism (a `modifier` effect), and widening the scope here
 * would invite content that silently depends on evaluation order.
 */
export function resolveScaling(
  scaling: StrikeScaling | undefined,
  level: number,
): { count?: number; size?: number } {
  if (!scaling) return {};
  if (typeof scaling === "function") return scaling(level);
  const scope = { vars: { level } };
  const out: { count?: number; size?: number } = {};
  if (scaling.count) out.count = evaluate(scaling.count, scope, "number") as number;
  if (scaling.size) out.size = evaluate(scaling.size, scope, "number") as number;
  return out;
}

/**
 * The wielding/configuration options a strike offers — each a TOGGLE on one
 * strike rather than a separate strike, matching how the rules phrase them.
 *
 * Two-hand and fatal-aim are deliberately the SAME axis: both are "what happens
 * when you wield this in two hands", so one `twoHanded` flag drives both. That
 * they arrived as separate traits is a data detail, not two mechanics.
 *
 * Rules text (owner-supplied 2026-07-19), in docs/strikes-and-weapons.md:
 *  • Two-Hand dN   — "wielded with two hands to change its weapon damage die to
 *                    the indicated value. This change applies to ALL the weapon's
 *                    damage dice." So it sets the die SIZE; the count is untouched.
 *  • Fatal Aim dN  — "When you wield the weapon in two hands, it gains the fatal
 *                    trait with the listed damage die."
 *  • Versatile X   — "You choose the damage type each time you attack." Free, no
 *                    action.
 *  • Modular       — the same idea, but switching configurations costs an Interact
 *                    action. Kept as its OWN field precisely because that cost is
 *                    the difference; collapsing them would make a modular weapon
 *                    look free to switch.
 */
export interface StrikeVariants {
  /** `two-hand-dN` — the damage die size while wielded in two hands. */
  twoHandDie?: number;
  /** `fatal-aim-dN` — the fatal die gained while wielded in two hands. */
  fatalAimDie?: number;
  /** `versatile-X` — alternative damage types, chosen freely per attack. */
  versatileTypes?: DamageType[];
  /** `modular ...` — configurations switched with an Interact action. */
  modularTypes?: DamageType[];
}

/**
 * What a strike IS, independent of who is making it. A weapon maps to one of
 * these; so does an unarmed attack, a Kineticist blast, and a homebrew attack
 * built in the app.
 */
export interface StrikeSource {
  id: string;
  name: string;
  /**
   * Which flavour of attack-trait check this is. Drives the `:strike` scope
   * segment — a spell attack must not receive a bonus written for Strikes.
   */
  kind?: StrikeDescriptor["kind"];
  range: "melee" | "ranged";
  unarmed?: boolean;
  /** Weapon group slug (`sword`, `bow`, `brawling`) — drives crit specialization. */
  group?: string;
  /** The specific weapon/attack slug (`longsword`, `jaws`), for `weapon:`-scoped effects. */
  weapon?: string;
  traits?: string[];
  /** Base damage die SIZE (6 for d6). */
  damageDie: number;
  damageType?: DamageType;
  /**
   * The source's own ability declarations, overriding the trait-derived defaults.
   * This is how a non-weapon attack states that it scales off Constitution
   * without needing any special case downstream. `damageAbility: null` means the
   * strike adds no ability modifier to damage at all.
   */
  attackAbility?: AbilityKey;
  damageAbility?: AbilityKey | null;
  /** Range increment in feet, for a ranged strike. */
  rangeIncrement?: number;
  /** Dice scaling for a runeless source. Replaces the rune/ABP contribution. */
  scaling?: StrikeScaling;
  /**
   * Wielding/configuration options this strike offers. See `StrikeVariants` —
   * these are TOGGLES on one strike, not separate strikes, which is what the
   * rules describe ("wielded with two hands", "you choose the damage type each
   * time you attack").
   */
  variants?: StrikeVariants;
  /** Additional typed damage components inherent to the source. */
  extraDamage?: DamageComponent[];
}

// ---------------------------------------------------------------------------
// the storable form
// ---------------------------------------------------------------------------

const damageTypeSchema = z.custom<DamageType>((v) => isDamageType(v), {
  message: "unknown damage type",
});

const damageComponentLikeSchema = z
  .object({
    formula: z.string().min(1),
    type: damageTypeSchema.optional(),
    material: z.string().min(1).optional(),
    categories: z.array(z.enum(["persistent", "precision", "splash"])).optional(),
    label: z.string().min(1).optional(),
  })
  .strict();

const strikeVariantsSchema = z
  .object({
    twoHandDie: z.number().int().positive().optional(),
    fatalAimDie: z.number().int().positive().optional(),
    versatileTypes: z.array(damageTypeSchema).optional(),
    modularTypes: z.array(damageTypeSchema).optional(),
  })
  .strict();

const abilityKeySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);

/**
 * A STORABLE strike source — what a feat, an ancestry, or a player-built custom
 * attack carries. Accepts ONLY the declarative `Expr` scaling form, never a
 * function, so anything validating here round-trips through JSON and the database.
 *
 * THIS IS WHAT MAKES "CUSTOM ATTACKS NOT TIED TO A WEAPON" REAL. The pipeline
 * could already resolve such a strike (step 2 proved it with a Kineticist blast),
 * but without a schema one could only ever be hard-coded — which is not a feature
 * a player can use. It also matters for unarmed attacks specifically: only 5
 * unarmed weapons exist as ITEMS, while jaws/claws/fists come from feats and
 * ancestries, so they have to be content, not inventory.
 */
export const strikeSourceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["strike", "spell-attack", "other"]).optional(),
    range: z.enum(["melee", "ranged"]),
    unarmed: z.boolean().optional(),
    group: z.string().min(1).optional(),
    weapon: z.string().min(1).optional(),
    traits: z.array(z.string()).optional(),
    damageDie: z.number().int().positive(),
    damageType: damageTypeSchema.optional(),
    attackAbility: abilityKeySchema.optional(),
    // `null` is meaningful and distinct from absent: "adds no ability modifier".
    damageAbility: abilityKeySchema.nullable().optional(),
    rangeIncrement: z.number().int().positive().optional(),
    scaling: z
      .object({ count: exprSchema.optional(), size: exprSchema.optional() })
      .strict()
      .optional(),
    variants: strikeVariantsSchema.optional(),
    extraDamage: z.array(damageComponentLikeSchema).optional(),
  })
  .strict();

/** A strike source guaranteed serializable (no function-valued scaling). */
export type StoredStrikeSource = z.infer<typeof strikeSourceSchema>;

/**
 * The wielder-side overrides Pathbuilder's attack editor exposes. Each one is a
 * higher-priority provider for a slot, not a special case — see the module header.
 */
export interface StrikeOverrides {
  name?: string;
  attackAbility?: AbilityKey;
  damageAbility?: AbilityKey | null;
  rank?: ProficiencyRank;
  itemBonus?: number;
  /** Replaces the whole computed attack modifier ("Attack Override"). */
  attackTotal?: number;
  /** Replaces the whole computed flat damage bonus ("Damage Override"). */
  damageTotal?: number;
  diceCount?: number;
  /** Step the damage die one rung up the ladder. */
  increaseDice?: boolean;
  /**
   * Wielding this in two hands — drives BOTH `two-hand` (a bigger damage die) and
   * `fatal-aim` (gaining fatal). The player-facing toggle.
   */
  twoHanded?: boolean;
  /**
   * The damage type chosen for this attack, for a versatile or modular weapon.
   * NOT policed against `variants` here: the variants list tells a UI what to
   * OFFER, while a homebrew source may legitimately allow anything.
   */
  damageType?: DamageType;
  /** Traits added on top of the source's own. */
  extraTraits?: string[];
  /** Extra typed damage components ("1 damage bonus, Acid" rows). */
  extraDamage?: DamageComponent[];
}

/**
 * What a strike needs to know about whoever is making it: a level and ability
 * modifiers. Deliberately narrower than `ResolvedCharacter` (which satisfies it
 * structurally) so a caller mid-derivation — the web builder computes strikes
 * before its resolved character exists — can resolve strikes without fabricating
 * an AC and a set of saves it does not have yet.
 */
export interface StrikeActor {
  level: number;
  mods: Record<AbilityKey, number>;
}

/** Everything needed to resolve one strike for one character. */
export interface StrikeInput {
  source: StrikeSource;
  /**
   * Attack proficiency RANK for this strike. Supplied by the caller because
   * deciding it needs class tables and the character's build (weapon category,
   * a fighter's chosen group, doctrine…) — orchestration that still lives in the
   * builder. Core does the arithmetic once the rank is known.
   */
  rank: ProficiencyRank;
  runes?: WeaponRunes;
  /** Automatic Bonus Progression contributions, when the variant is on. */
  abp?: { attack?: number; diceCount?: number };
  /** Proficiency Without Level variant. */
  withoutLevel?: boolean;
  overrides?: StrikeOverrides;
  /**
   * Typed modifiers from Layer-1 passive effects whose scoped selector matches
   * this strike. Use `collectStrikeModifiers` to build these from a character's
   * effects; they are stacked here per the PF2e stacking rules.
   */
  attackModifiers?: Modifier[];
  damageModifiers?: Modifier[];
  /** Flat additions that are not typed bonuses (Weapon Specialization). */
  damageExtras?: number;
}

// ---------------------------------------------------------------------------
// trait-derived slot defaults  [PORTED from apps/web/src/features/builder/rules.ts]
// ---------------------------------------------------------------------------

/**
 * The ability MODIFIER added to damage. [PORTED — verified web impl]
 *
 * Note finesse is deliberately absent: it selects the ATTACK ability only, and
 * does not change which ability feeds damage. That is the behavior the web
 * builder ships and the sheet is verified against.
 *
 *  • melee            → full Strength
 *  • ranged+propulsive→ half Strength if positive, FULL if negative
 *  • ranged+thrown    → full Strength
 *  • ranged otherwise → none
 */
export function damageAbilityMod(
  range: "melee" | "ranged",
  traits: readonly string[],
  strMod: number,
): number {
  if (range === "melee") return strMod;
  if (traits.includes("propulsive")) return strMod >= 0 ? Math.floor(strMod / 2) : strMod;
  if (traits.includes("thrown")) return strMod;
  return 0;
}

/** Parse a `deadly d10` / `fatal d8` trait into its die size, if present. */
export function traitDieSize(traits: readonly string[], name: "deadly" | "fatal"): number | null {
  for (const t of traits) {
    const m = new RegExp(`^${name}[\\s-]*d(\\d+)$`, "i").exec(t.trim());
    if (m) return Number(m[1]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// the resolved strike
// ---------------------------------------------------------------------------

/** Where one slot's value came from — the sheet's "Dex Prof Item" breakdown. */
export interface StrikeBreakdown {
  ability: number;
  abilityKey: AbilityKey | null;
  proficiency: number;
  rank: ProficiencyRank;
  item: number;
  /** Net of the typed modifiers from passive effects, after stacking. */
  effects: number;
  /** Set when an Attack Override replaced the computed total. */
  overridden?: boolean;
}

/** Where the flat damage bonus came from — the damage-side mirror of `StrikeBreakdown`. */
export interface StrikeDamageBreakdown {
  /** The ability modifier contribution (already trait-adjusted: half Str for propulsive, …). */
  ability: number;
  abilityKey: AbilityKey | null;
  /** Net of the typed damage modifiers from passive effects, after stacking. */
  effects: number;
  /** Untyped flat additions — Weapon Specialization and the like. */
  extras: number;
  /** Set when a Damage Override replaced the computed total. */
  overridden?: boolean;
}

/** A fully resolved strike: an attack modifier, damage, and how a crit differs. */
export interface Strike {
  id: string;
  name: string;
  /** The scope descriptor this strike matches selectors against. */
  descriptor: StrikeDescriptor;
  traits: string[];
  attack: number;
  breakdown: StrikeBreakdown;
  /**
   * The flat damage bonus folded into the base component's formula. Carried
   * separately because a sheet shows it as its own line ("Damage Bonus +4") and
   * because recovering it by parsing the formula back apart would be absurd.
   */
  damageBonus: number;
  damageBreakdown: StrikeDamageBreakdown;
  /** Damage on a HIT. Doubled by the interpreter on a critical hit. */
  damage: DamageComponent[];
  /**
   * FATAL replaces the base damage dice on a critical hit (bigger die, one extra
   * of it) — and it happens INSIDE the doubling, so this list is doubled too.
   * Null when the strike has no fatal trait.
   */
  criticalDamage: DamageComponent[] | null;
  /**
   * DEADLY adds dice on a critical hit that are NOT doubled — "roll this after
   * doubling the weapon's damage." Empty when the strike has no deadly trait.
   *
   * Keeping these separate from `criticalDamage` is the whole point: fatal is
   * inside the doubling and deadly is outside it, and collapsing them would be a
   * silent damage bug worth ~10 points a crit.
   */
  deadlyDamage: DamageComponent[];
  dice: { count: number; size: number };
}

const clampRune = (v: number | undefined): number => Math.max(0, Math.min(3, Math.floor(v ?? 0)));

/**
 * Resolve a strike through the slot pipeline. See the module header for the slot
 * order and the provider priority within each.
 */
export function resolveStrike(character: StrikeActor, input: StrikeInput): Strike {
  const { source, overrides = {} } = input;

  // --- traits: resolved first; every slot below reads them ---------------
  const traits = [...(source.traits ?? []), ...(overrides.extraTraits ?? [])];

  // --- ability ------------------------------------------------------------
  // Priority: user override > source declaration > trait-derived default.
  // Finesse is "the better of Str and Dex", which is a comparison rather than a
  // single key, so it is resolved here where both mods are in hand.
  let attackAbilityKey: AbilityKey;
  if (overrides.attackAbility) attackAbilityKey = overrides.attackAbility;
  else if (source.attackAbility) attackAbilityKey = source.attackAbility;
  else if (source.range === "ranged") attackAbilityKey = "dex";
  else if (traits.includes("finesse")) {
    attackAbilityKey = character.mods.dex > character.mods.str ? "dex" : "str";
  } else attackAbilityKey = "str";
  const abilityMod = character.mods[attackAbilityKey];

  // --- rank ---------------------------------------------------------------
  const rank = overrides.rank ?? input.rank;

  // --- item bonus: potency rune, or ABP, then an override ------------------
  // Potency is an ITEM bonus to ATTACK ROLLS ONLY — never to damage
  // (owner-supplied). The damage side below deliberately never reads it.
  const potency = clampRune(input.runes?.potency);
  const itemBonus = overrides.itemBonus ?? potency + (input.abp?.attack ?? 0);

  // --- attack total -------------------------------------------------------
  const effectAttack = stackModifiers(input.attackModifiers ?? []);
  const computedAttack =
    proficientModifier({
      abilityMod,
      rank,
      level: character.level,
      ...(input.withoutLevel !== undefined ? { withoutLevel: input.withoutLevel } : {}),
      itemBonus,
    }) + effectAttack;
  const attack = overrides.attackTotal ?? computedAttack;

  // --- dice: count then size ----------------------------------------------
  // Striking sets the COUNT (striking 2 dice, greater 3, major 4 — owner-supplied,
  // i.e. 1 + the rune's rank). ABP replaces it under that variant. An explicit
  // source `scaling` replaces both, which is how a runeless source scales.
  const striking = clampRune(input.runes?.striking);
  const scaled = resolveScaling(source.scaling, character.level);
  let diceCount = scaled.count ?? input.abp?.diceCount ?? 1 + striking;
  if (overrides.diceCount !== undefined) diceCount = Math.max(1, Math.floor(overrides.diceCount));

  // TWO-HAND sets the die SIZE outright ("change its weapon damage die to the
  // indicated value"), leaving the count alone — striking's dice all become the
  // new size, which is what "this change applies to all the weapon's damage
  // dice" means. Increase-dice then steps whatever the die ended up being; both
  // act on the *normal* damage die, so ordering them this way keeps a two-handed
  // increase-diced weapon one rung above its two-handed size.
  const twoHanded = overrides.twoHanded ?? false;
  let diceSize = scaled.size ?? source.damageDie;
  if (twoHanded && source.variants?.twoHandDie) diceSize = source.variants.twoHandDie;
  if (overrides.increaseDice) diceSize = increaseDieSize(diceSize);

  // --- damage bonus -------------------------------------------------------
  // damageAbility: null on the source means "adds no ability modifier at all".
  const damageAbilityKey =
    overrides.damageAbility !== undefined ? overrides.damageAbility : source.damageAbility;
  const abilityDamage =
    damageAbilityKey === null
      ? 0
      : damageAbilityKey !== undefined
        ? character.mods[damageAbilityKey]
        : damageAbilityMod(source.range, traits, character.mods.str);
  const effectDamage = stackModifiers(input.damageModifiers ?? []);
  const damageBonus =
    overrides.damageTotal ?? abilityDamage + effectDamage + (input.damageExtras ?? 0);

  // --- assemble the damage components -------------------------------------
  // A versatile/modular weapon deals the chosen type; absent a choice it deals
  // its listed one.
  const chosenType = overrides.damageType ?? source.damageType;
  const typed = chosenType ? { type: chosenType } : {};
  const baseFormula = formula(diceCount, diceSize, damageBonus);
  const extras = [...(source.extraDamage ?? []), ...(overrides.extraDamage ?? [])];
  const damage: DamageComponent[] = [{ formula: baseFormula, ...typed }, ...extras];

  // --- fatal (INSIDE the doubling) ----------------------------------------
  // "the weapon's damage die increases to that die size instead of the normal
  // die size, and the weapon adds one additional damage die of the listed size."
  // FATAL AIM: "When you wield the weapon in two hands, it gains the fatal trait
  // with the listed damage die." So a two-handed grip supplies a fatal die the
  // weapon otherwise has none of. An explicit `fatal` trait wins if both somehow
  // appear (no shipped weapon carries both).
  const fatalDie =
    traitDieSize(traits, "fatal") ?? (twoHanded ? (source.variants?.fatalAimDie ?? null) : null);
  const criticalDamage: DamageComponent[] | null =
    fatalDie === null
      ? null
      : [{ formula: formula(diceCount + 1, fatalDie, damageBonus), ...typed }, ...extras];

  // --- deadly (OUTSIDE the doubling) --------------------------------------
  // "Roll this after doubling the weapon's damage. This increases to two dice if
  // the weapon has a greater striking rune and three dice if major striking."
  // i.e. 1 die normally, 2 at greater (rune rank 2), 3 at major (rank 3) — plain
  // striking gives no increase. Deadly's die size is deliberately NOT stepped by
  // increase-dice: "An ability that changes the size of the weapon's normal
  // damage dice doesn't change the size of its deadly die."
  const deadlyDie = traitDieSize(traits, "deadly");
  const deadlyCount = striking >= 3 ? 3 : striking >= 2 ? 2 : 1;
  const deadlyDamage: DamageComponent[] =
    deadlyDie === null ? [] : [{ formula: `${deadlyCount}d${deadlyDie}`, ...typed }];

  return {
    id: source.id,
    name: overrides.name ?? source.name,
    descriptor: {
      kind: source.kind ?? "strike",
      range: source.range,
      unarmed: source.unarmed ?? false,
      ...(source.group !== undefined ? { group: source.group } : {}),
      ...(source.weapon !== undefined ? { weapon: source.weapon } : {}),
    },
    traits,
    attack,
    breakdown: {
      ability: abilityMod,
      abilityKey: attackAbilityKey,
      // Computed directly, NOT by subtracting the parts from the total — under an
      // Attack Override the total is an unrelated number and the subtraction
      // would report a fabricated proficiency bonus on the sheet.
      proficiency: proficiencyBonus(rank, character.level, input.withoutLevel),
      rank,
      item: itemBonus,
      effects: effectAttack,
      ...(overrides.attackTotal !== undefined ? { overridden: true } : {}),
    },
    damageBonus,
    damageBreakdown: {
      ability: abilityDamage,
      // Trait-derived damage always comes from Strength (melee full, propulsive
      // half, thrown full) — EXCEPT plain ranged, which adds none at all. Naming
      // an ability there would put a "Str +0" line on a sheet that has no such
      // contribution.
      abilityKey:
        damageAbilityKey === null
          ? null
          : (damageAbilityKey ??
            (source.range === "melee" || traits.includes("propulsive") || traits.includes("thrown")
              ? "str"
              : null)),
      effects: effectDamage,
      extras: input.damageExtras ?? 0,
      ...(overrides.damageTotal !== undefined ? { overridden: true } : {}),
    },
    damage,
    criticalDamage,
    deadlyDamage,
    dice: { count: diceCount, size: diceSize },
  };
}

/** `2d6+3` / `1d8-1` / `2d6` — a dice formula the Layer-2 grammar accepts. */
function formula(count: number, size: number, bonus: number): string {
  const dice = `${Math.max(1, count)}d${size}`;
  if (bonus === 0) return dice;
  return bonus > 0 ? `${dice}+${bonus}` : `${dice}${bonus}`;
}

// ---------------------------------------------------------------------------
// connecting Layer 1 to strikes
// ---------------------------------------------------------------------------

/** A scoped modifier from a passive effect, before it is matched to a strike. */
export interface ScopedModifier {
  selector: ScopedSelector;
  type: Modifier["type"];
  value: number;
}

/**
 * Select the modifiers that apply to one strike, split by base. This is the join
 * between the scoped-selector vocabulary (step 1) and the strike pipeline: an
 * effect targeting `damage:strike:melee` reaches a longsword and not a shortbow.
 */
export function collectStrikeModifiers(
  modifiers: readonly ScopedModifier[],
  strike: StrikeDescriptor,
): { attack: Modifier[]; damage: Modifier[] } {
  const attack: Modifier[] = [];
  const damage: Modifier[] = [];
  for (const m of modifiers) {
    if (!selectorMatchesStrike(m.selector, strike)) continue;
    (m.selector.startsWith("damage") ? damage : attack).push({ type: m.type, value: m.value });
  }
  return { attack, damage };
}

// ---------------------------------------------------------------------------
// emitting automation
// ---------------------------------------------------------------------------

/**
 * Turn a resolved strike into a runnable Layer-2 tree. **This needs no new
 * interpreter surface** — it is an `attack` node with `damage` nodes under its
 * degree branches, all of which already existed.
 *
 * The fatal/deadly asymmetry is expressed structurally rather than arithmetically:
 *   • the critical branch's BASE damage node carries `scaling: {by:"attack"}`, so
 *     the interpreter doubles it (and uses the fatal dice if the strike has fatal)
 *   • the deadly node carries NO scaling, so it is added at face value — which is
 *     exactly "roll this after doubling the weapon's damage"
 */
export function strikeAutomation(strike: Strike, map?: MapOptions): AutomationNode[] {
  const onSuccess: AutomationNode[] = [
    { kind: "damage", components: strike.damage, scaling: { by: "attack" } },
  ];
  const onCriticalSuccess: AutomationNode[] = [
    {
      kind: "damage",
      components: strike.criticalDamage ?? strike.damage,
      scaling: { by: "attack" },
    },
  ];
  if (strike.deadlyDamage.length > 0) {
    // No `scaling` — deadly dice are not doubled.
    onCriticalSuccess.push({ kind: "damage", components: strike.deadlyDamage });
  }
  return [
    {
      kind: "attack",
      bonus: { kind: "lit", value: strike.attack },
      ...(map ? { map } : {}),
      onSuccess,
      onCriticalSuccess,
    },
  ];
}
