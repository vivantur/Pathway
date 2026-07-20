// PF2e weapons — the content entity behind a Strike, plus fundamental runes.
//
// Follows the content conventions of the other slices (`contentBaseSchema` +
// `coerce*` for a loose row), and pairs with `strike.ts`: a weapon is one PRODUCER
// of strike sources, never the definition of a strike. That is why the mapper
// below is `weaponToStrikeSources` (PLURAL) — see "one weapon, several strikes".
//
// PURE: schema + adapters only. No rules arithmetic; `strike.ts` owns that.
//
// DATA-DRIVEN. Every enumeration here was derived from the 909 weapons in the
// shipped `items.json` (2026-07-19), not from memory — categories, groups, hands,
// die sizes, and damage-type codes are exactly the value sets that file contains.

import { z } from "zod";
import { contentBaseSchema } from "./content.js";
import { isDamageType, type DamageType } from "./damage.js";
import type { StrikeSource, StrikeVariants } from "./strike.js";

/** Weapon proficiency categories. */
export const WEAPON_CATEGORIES = ["unarmed", "simple", "martial", "advanced"] as const;
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];

/**
 * The 17 weapon groups. Each has a critical specialization effect
 * (docs/strikes-and-weapons.md); the effects themselves are authored content, not
 * part of this schema.
 */
export const WEAPON_GROUPS = [
  "axe",
  "bomb",
  "bow",
  "brawling",
  "club",
  "crossbow",
  "dart",
  "firearm",
  "flail",
  "hammer",
  "knife",
  "pick",
  "polearm",
  "shield",
  "sling",
  "spear",
  "sword",
] as const;
export type WeaponGroup = (typeof WEAPON_GROUPS)[number];

/** How many hands a weapon needs. `1+` is one-handed but usable in two. */
export const WEAPON_HANDS = ["1", "1+", "2"] as const;
export type WeaponHands = (typeof WEAPON_HANDS)[number];

/**
 * The dataset's single-letter physical damage codes → core's vocabulary. The
 * letters are a storage detail of `items.json`; nothing downstream of `coerceWeapon`
 * should ever see one.
 */
export const DAMAGE_CODES: Readonly<Record<string, DamageType>> = {
  B: "bludgeoning",
  P: "piercing",
  S: "slashing",
};

export const weaponSchema = z.object({
  ...contentBaseSchema.shape,
  category: z.enum(WEAPON_CATEGORIES),
  /** Absent for weapons the dataset leaves ungrouped (it stores those as `""`). */
  group: z.enum(WEAPON_GROUPS).optional(),
  /** Damage die SIZE as a number (8 for d8) — parsed from the dataset's `"d8"`. */
  damageDie: z.number().int().positive(),
  damageType: z.custom<DamageType>((v) => typeof v === "string"),
  hands: z.enum(WEAPON_HANDS),
  ranged: z.boolean(),
  /** Range increment in feet; present only on ranged weapons. */
  range: z.number().int().positive().optional(),
  bulk: z.string().optional(),
  price: z.number().nonnegative().optional(),
});
export type Weapon = z.infer<typeof weaponSchema>;

// ---------------------------------------------------------------------------
// fundamental runes
// ---------------------------------------------------------------------------

/**
 * The fundamental weapon runes. Rules text (owner-supplied):
 *   • Potency +1/+2/+3 — an ITEM bonus to ATTACK ROLLS ONLY, never to damage.
 *   • Striking / Greater / Major — two / three / four weapon damage dice.
 *
 * Stored as rune RANKS (0–3), because that is what both rules scale off: potency
 * rank IS the bonus, and striking rank + 1 IS the dice count.
 *
 * PROPERTY runes (flaming, corrosive, …) are deliberately absent. No rules text
 * for them has been supplied, and inventing their effects would be exactly the
 * rules-from-memory this project forbids. Adding them later is additive.
 */
export const weaponRunesSchema = z
  .object({
    potency: z.number().int().min(0).max(3).optional(),
    striking: z.number().int().min(0).max(3).optional(),
  })
  .strict();
export type WeaponRunes = z.infer<typeof weaponRunesSchema>;

/** The attack-roll item bonus from a potency rune: the rank itself. */
export function potencyAttackBonus(runes: WeaponRunes | undefined): number {
  return clampRank(runes?.potency);
}

/** The number of weapon damage dice from a striking rune: 1 normally, else rank + 1. */
export function strikingDamageDice(runes: WeaponRunes | undefined): number {
  return 1 + clampRank(runes?.striking);
}

function clampRank(v: number | undefined): number {
  return Math.max(0, Math.min(3, Math.floor(v ?? 0)));
}

// ---------------------------------------------------------------------------
// ingest adapter
// ---------------------------------------------------------------------------

/** A loose weapon row as the shipped dataset stores it. */
export interface RawWeaponRow {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  group?: unknown;
  damageDie?: unknown;
  damageType?: unknown;
  hands?: unknown;
  ranged?: unknown;
  range?: unknown;
  traits?: unknown;
  bulk?: unknown;
  price?: unknown;
  source?: unknown;
  [k: string]: unknown;
}

/**
 * Coerce a dataset row into a validated `Weapon`, or return null with a reason.
 * Normalizes the two storage encodings the file uses — `"d8"` for a die and
 * `"B"`/`"P"`/`"S"` for a damage type — and drops the empty-string group.
 */
export function coerceWeapon(row: RawWeaponRow): { weapon: Weapon } | { error: string } {
  const die = parseDie(row.damageDie);
  if (die === null) return { error: `unparseable damageDie ${JSON.stringify(row.damageDie)}` };
  const code = typeof row.damageType === "string" ? row.damageType : "";
  const damageType = DAMAGE_CODES[code];
  if (!damageType) return { error: `unknown damageType ${JSON.stringify(row.damageType)}` };

  const group = typeof row.group === "string" && row.group !== "" ? row.group : undefined;
  const parsed = weaponSchema.safeParse({
    id: String(row.id ?? ""),
    version: 1,
    name: String(row.name ?? ""),
    ownerKind: "official",
    // The dataset stores attribution as a bare title string; core's envelope
    // models it structurally (title + optional page) so the Community Use / ORC
    // notices stay machine-readable. Normalizing here keeps provenance intact
    // rather than dropping it — see the licensing note in the root CLAUDE.md.
    source: { title: typeof row.source === "string" && row.source ? row.source : "Unknown" },
    rarity: "common",
    traits: Array.isArray(row.traits) ? row.traits.map(String) : [],
    isLegacy: false,
    category: row.category,
    ...(group !== undefined ? { group } : {}),
    damageDie: die,
    damageType,
    hands: row.hands,
    ranged: Boolean(row.ranged),
    ...(typeof row.range === "number" ? { range: row.range } : {}),
    ...(typeof row.bulk === "string" ? { bulk: row.bulk } : {}),
    ...(typeof row.price === "number" ? { price: row.price } : {}),
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { weapon: parsed.data };
}

/** `"d8"` → 8. Accepts a bare number too. Returns null if it is neither. */
function parseDie(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v !== "string") return null;
  const m = /^d?(\d+)$/i.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// one weapon, several strikes
// ---------------------------------------------------------------------------

/**
 * Traits that mean a weapon offers MORE THAN ONE strike, or a strike whose
 * numbers differ from the weapon's printed line. Each is recognised and REPORTED
 * rather than approximated, because approximating any of them puts a wrong number
 * on a sheet:
 *
 *  • `thrown-N`   — a MELEE weapon that can also be thrown. 73 of the 909 shipped
 *                   weapons carry it (a dagger is `thrown-10`), and all of them are
 *                   stored `ranged: false`. Today they therefore resolve to a melee
 *                   strike only, so throwing a dagger is not expressible.
 *  • `two-hand-dN`— a different damage die when wielded in two hands.
 *  • `versatile-X`— the strike may instead deal damage type X.
 *  • `fatal-aim-dN` — a firearm trait, distinct from plain `fatal`; deliberately
 *                   NOT read as fatal (see `traitDieSize`, which rejects it).
 *
 * NO RULES TEXT HAS BEEN SUPPLIED FOR ANY OF THESE, so none is implemented.
 * `weaponToStrikeSources` returns a single source and names the rest here — the
 * mapper's honesty contract, same as `foundry.ts`.
 */
export const MULTI_STRIKE_TRAIT_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  // `modular` ships BARE on all 12 weapons that carry it — the configurations
  // live in the weapon's prose, not the trait, so there is nothing to parse.
  { re: /^modular$/, reason: "modular: configurations are described in prose, not the trait" },
];

/**
 * Damage-type letters as the versatile trait spells them, plus the full-word
 * forms the dataset also uses (`versatile-vitality`). Anything not resolvable to
 * a real damage type is REPORTED, not guessed — `versatile-spirit` is the live
 * example: "spirit" is not in core's damage vocabulary, and inventing it would
 * put a damage type on a sheet that the engine cannot reason about.
 */
function versatileType(suffix: string): DamageType | null {
  const letters: Record<string, DamageType> = {
    b: "bludgeoning",
    p: "piercing",
    s: "slashing",
  };
  const byLetter = letters[suffix.toLowerCase()];
  if (byLetter) return byLetter;
  return isDamageType(suffix.toLowerCase()) ? (suffix.toLowerCase() as DamageType) : null;
}

/** Parse the variant-bearing traits into the toggles `resolveStrike` consumes. */
export function parseStrikeVariants(traits: readonly string[]): {
  variants: StrikeVariants;
  /** Range increment from `thrown-N` on a melee weapon, if present. */
  thrownRange: number | null;
  unmapped: { trait: string; reason: string }[];
} {
  const variants: StrikeVariants = {};
  const versatileTypes: DamageType[] = [];
  const unmapped: { trait: string; reason: string }[] = [];
  let thrownRange: number | null = null;

  for (const trait of traits) {
    let m: RegExpExecArray | null;
    if ((m = /^two-hand-d(\d+)$/.exec(trait))) {
      variants.twoHandDie = Number(m[1]);
    } else if ((m = /^fatal-aim-d(\d+)$/.exec(trait))) {
      variants.fatalAimDie = Number(m[1]);
    } else if ((m = /^versatile-(\w+)$/.exec(trait))) {
      const type = versatileType(m[1]!);
      if (type) versatileTypes.push(type);
      else unmapped.push({ trait, reason: `versatile: "${m[1]}" is not a known damage type` });
    } else if ((m = /^thrown-(\d+)$/.exec(trait))) {
      thrownRange = Number(m[1]);
    } else {
      for (const { re, reason } of MULTI_STRIKE_TRAIT_PATTERNS) {
        if (re.test(trait)) unmapped.push({ trait, reason });
      }
    }
  }
  if (versatileTypes.length > 0) variants.versatileTypes = versatileTypes;
  return { variants, thrownRange, unmapped };
}

/** Traits on `weapon` that imply a strike this mapper cannot yet produce. */
export function unmappedStrikeTraits(weapon: Weapon): { trait: string; reason: string }[] {
  return parseStrikeVariants(weapon.traits).unmapped;
}

/**
 * Map a weapon onto the strike source(s) it offers, plus any strikes it should
 * offer but that cannot be built yet.
 *
 * PLURAL BY DESIGN. A dagger genuinely offers two strikes — melee and thrown —
 * with different attack abilities, and `two-hand`/`versatile` are further
 * variants. The return shape admits that from the start so adding them later is
 * filling a list rather than reshaping every caller. Today exactly one source is
 * produced and the rest are reported in `unmapped`.
 */
export function weaponToStrikeSources(weapon: Weapon): {
  sources: StrikeSource[];
  unmapped: { trait: string; reason: string }[];
} {
  const { variants, thrownRange, unmapped } = parseStrikeVariants(weapon.traits);
  const hasVariants = Object.keys(variants).length > 0;

  const base: StrikeSource = {
    id: weapon.id,
    name: weapon.name,
    kind: "strike",
    range: weapon.ranged ? "ranged" : "melee",
    unarmed: weapon.category === "unarmed",
    ...(weapon.group !== undefined ? { group: weapon.group } : {}),
    weapon: weapon.id,
    traits: weapon.traits,
    damageDie: weapon.damageDie,
    damageType: weapon.damageType,
    ...(weapon.range !== undefined ? { rangeIncrement: weapon.range } : {}),
    ...(hasVariants ? { variants } : {}),
  };

  const sources = [base];

  // THROWN is the one variant that is genuinely a SEPARATE strike rather than a
  // toggle, because it changes which ability makes the attack roll: "it is a
  // ranged weapon when thrown" (so Dex attacks it), while "you add your Strength
  // modifier to damage as you would for a melee weapon". Adding the bare `thrown`
  // trait is what makes the damage side come out right — `damageAbilityMod` reads
  // it to grant full Strength on a ranged strike.
  //
  // Only melee weapons need this: a weapon already stored `ranged` carries bare
  // `thrown` and uses its own Range entry, which the base source already has.
  if (thrownRange !== null && !weapon.ranged) {
    sources.push({
      ...base,
      id: `${weapon.id}-thrown`,
      name: `${weapon.name} (Thrown)`,
      range: "ranged",
      traits: [...weapon.traits, "thrown"],
      rangeIncrement: thrownRange,
    });
  }

  return { sources, unmapped };
}
