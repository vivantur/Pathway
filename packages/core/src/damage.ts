// The damage-type vocabulary — a finite, typed enumeration (its own contract).
//
// PF2e packs a damage instance as a physical/energy TYPE optionally carrying a
// MATERIAL descriptor (`[magical slashing]`, `[silver piercing]`) plus CATEGORY
// flags (persistent / precision / splash). A lot of rules correctness rides on
// carrying these precisely — a creature "resistant to physical except silver"
// needs the material preserved — so this is a closed vocabulary the author picks
// from, not free text. See docs/effects-engine-design.md, "The damage-type
// vocabulary".
//
// SCOPE: this module is the VOCABULARY only — the enumerations + a structured
// descriptor + type guards. It contains NO resistance/weakness/bypass RESOLUTION
// (that is rules behavior, implemented later from rules text). Nothing here
// computes a number; it only names things, so there is no rules-from-memory risk.
// The lists below mirror the design doc; materials in particular are extensible
// (this is the v1 set, not a claim of completeness).

/** Physical damage — the three weapon damage types. */
export const PHYSICAL_DAMAGE_TYPES = ["bludgeoning", "piercing", "slashing"] as const;
export type PhysicalDamageType = (typeof PHYSICAL_DAMAGE_TYPES)[number];

/** Energy damage types (Remaster vocabulary: vitality/void, not positive/negative). */
export const ENERGY_DAMAGE_TYPES = [
  "acid",
  "cold",
  "electricity",
  "fire",
  "sonic",
  "vitality",
  "void",
  "force",
] as const;
export type EnergyDamageType = (typeof ENERGY_DAMAGE_TYPES)[number];

/**
 * Damage types that are neither physical nor energy.
 *
 * `bleed` is here rather than under physical, deliberately. The owner's ruling
 * (2026-07-19): "Bleed is sort of a damage type, but it's usually persistent…
 * there are feats that will give resistance to persistent bleed damage, so we
 * SHOULD recognize it as a damage type for that purpose."
 *
 * So it exists to be NAMED — by a resistance, a weakness, or a crit
 * specialization's `1d6 persistent bleed`. Filing it as physical would be a rules
 * claim nobody made, and would silently make it bypassable by anything that
 * resists physical damage.
 *
 * Note it is a TYPE, not a category: `persistent` remains a `DamageCategory`
 * below, so "persistent bleed" is the pair `{ type: "bleed", categories:
 * ["persistent"] }`. Most bleed is persistent, but the two are orthogonal and
 * collapsing them would make non-persistent bleed inexpressible.
 */
export const OTHER_DAMAGE_TYPES = ["bleed"] as const;
export type OtherDamageType = (typeof OTHER_DAMAGE_TYPES)[number];

/** Every base damage type (physical + energy + the rest). */
export const DAMAGE_TYPES = [
  ...PHYSICAL_DAMAGE_TYPES,
  ...ENERGY_DAMAGE_TYPES,
  ...OTHER_DAMAGE_TYPES,
] as const;
export type DamageType = PhysicalDamageType | EnergyDamageType | OtherDamageType;

/**
 * Material descriptors that ride along a damage instance and matter for
 * resistance bypass (`[silver slashing]`). v1 set — extensible; carrying an
 * unknown material string is allowed on the descriptor (see `DamageDescriptor`).
 */
export const DAMAGE_MATERIALS = [
  "silver",
  "cold-iron",
  "adamantine",
  "orichalcum",
  "darkwood",
  "dawnsilver", // Remaster name for mithral
  "duskwood",
  "sovereign-steel",
] as const;
export type DamageMaterial = (typeof DAMAGE_MATERIALS)[number];

/**
 * Category flags a damage instance can carry, orthogonal to its type:
 *  - `persistent` — repeats at end of turn until a flat check ends it
 *  - `precision`  — extra damage negated by the same defenses as the base type
 *  - `splash`     — area splash on a thrown/alchemical hit
 */
export const DAMAGE_CATEGORIES = ["persistent", "precision", "splash"] as const;
export type DamageCategory = (typeof DAMAGE_CATEGORIES)[number];

/**
 * A structured damage descriptor: the base type, an optional material, category
 * flags, and an optional free-form `label` for a purely-cosmetic tag (e.g. a
 * homebrew "[decomposition]" flavor) that has NO mechanical type — kept distinct
 * from `type` so display text never leaks into resistance logic.
 */
export interface DamageDescriptor {
  type: DamageType;
  material?: DamageMaterial | (string & {});
  categories?: DamageCategory[];
  /** Cosmetic-only label; never used for resistance/weakness matching. */
  label?: string;
}

const PHYSICAL_SET: ReadonlySet<string> = new Set(PHYSICAL_DAMAGE_TYPES);
const ENERGY_SET: ReadonlySet<string> = new Set(ENERGY_DAMAGE_TYPES);
const TYPE_SET: ReadonlySet<string> = new Set(DAMAGE_TYPES);
const MATERIAL_SET: ReadonlySet<string> = new Set(DAMAGE_MATERIALS);
const CATEGORY_SET: ReadonlySet<string> = new Set(DAMAGE_CATEGORIES);

export function isDamageType(x: unknown): x is DamageType {
  return typeof x === "string" && TYPE_SET.has(x);
}
export function isPhysicalDamageType(x: unknown): x is PhysicalDamageType {
  return typeof x === "string" && PHYSICAL_SET.has(x);
}
export function isEnergyDamageType(x: unknown): x is EnergyDamageType {
  return typeof x === "string" && ENERGY_SET.has(x);
}
/** Whether a string is one of the enumerated (known) materials. */
export function isKnownDamageMaterial(x: unknown): x is DamageMaterial {
  return typeof x === "string" && MATERIAL_SET.has(x);
}
export function isDamageCategory(x: unknown): x is DamageCategory {
  return typeof x === "string" && CATEGORY_SET.has(x);
}
