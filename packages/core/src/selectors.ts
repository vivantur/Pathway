// The canonical stat-selector vocabulary — the READ surface of a resolved
// character. A `Selector` names one statistic you can look up a modifier for
// (`ac`, `fortitude`, a skill slug, …). This is the namespace the effects engine
// resolves Layer-1 `modifier`/`rollAdjust` targets against, and the same finite
// list the (future) homebrew builder offers as a dropdown. See
// docs/effects-engine-design.md, "Layer 1 — Passive effect schema".
//
// This is deliberately distinct from the Foundry-ingest selector strings in
// effects.ts (`saving-throw`, `land-speed`, `skill-check`): those are the names
// Foundry's FlatModifier rule elements carry, an import concern. THIS vocabulary
// is ours — the read side. The one thing genuinely shared by both is the 16
// canonical skill ids, which live here so there is a single source for them.

/**
 * The 16 PF2e skills, by canonical slug id. Shared content — identical whether a
 * skill is being read (this module) or written to by an ingested rule element
 * (effects.ts imports these). Lores are open-ended and not enumerated here.
 */
export const SKILL_SLUGS = [
  "acrobatics",
  "arcana",
  "athletics",
  "crafting",
  "deception",
  "diplomacy",
  "intimidation",
  "medicine",
  "nature",
  "occultism",
  "performance",
  "religion",
  "society",
  "stealth",
  "survival",
  "thievery",
] as const;

export type SkillSlug = (typeof SKILL_SLUGS)[number];

const SKILL_SLUG_SET: ReadonlySet<string> = new Set(SKILL_SLUGS);

/** Whether a string is one of the 16 canonical skill slugs. */
export function isSkillSlug(x: unknown): x is SkillSlug {
  return typeof x === "string" && SKILL_SLUG_SET.has(x);
}

/** The attribute keys, in the order the resolved model carries them. */
export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

/**
 * The attribute each skill is based on. Needed wherever a rule names an ATTRIBUTE
 * rather than a skill — Stupefied penalises "skill checks that use Int, Wis, or Cha",
 * which is a query over this map, not a list anyone should retype.
 *
 * It lives here because it was already written twice (companion.ts and the web's
 * pathbuilder.ts) and a third copy is exactly the drift this package exists to end.
 * Lores are open-ended and absent, like everywhere else in this module.
 */
export const SKILL_ABILITY: Readonly<Record<SkillSlug, AbilityKey>> = {
  acrobatics: "dex",
  arcana: "int",
  athletics: "str",
  crafting: "int",
  deception: "cha",
  diplomacy: "cha",
  intimidation: "cha",
  medicine: "wis",
  nature: "wis",
  occultism: "int",
  performance: "cha",
  religion: "wis",
  society: "int",
  stealth: "dex",
  survival: "wis",
  thievery: "dex",
};

/** The skills based on any of `abilities` — e.g. Stupefied's Int/Wis/Cha set. */
export function skillsForAbilities(abilities: readonly AbilityKey[]): SkillSlug[] {
  const wanted = new Set<AbilityKey>(abilities);
  return SKILL_SLUGS.filter((s) => wanted.has(SKILL_ABILITY[s]));
}

/** The three saving throws. */
export const SAVE_SELECTORS = ["fortitude", "reflex", "will"] as const;
export type SaveSelector = (typeof SAVE_SELECTORS)[number];

/**
 * Fixed (non-skill) read selectors. Each names one statistic resolvable to a
 * single modifier on a `ResolvedCharacter`.
 *
 * Some are BACKED today (the resolved model carries a value): `ac`, the three
 * saves, `perception`, `class-dc`, `spell-dc`, `spell-attack`, `speed:land`.
 * Others are RESERVED — part of the vocabulary the design doc names, but the
 * resolved model does not carry them yet (`attack`/`damage` are per-weapon,
 * `initiative` is derived at play time). `resolveSelector` returns 0 for a
 * reserved selector until the model grows to carry it, never guessing a value.
 */
export const FIXED_SELECTORS = [
  "ac",
  ...SAVE_SELECTORS,
  "perception",
  "hp",
  "class-dc",
  "spell-dc",
  "spell-attack",
  "speed:land",
  // reserved (return 0 for now):
  "attack",
  "damage",
  "initiative",
] as const;
export type FixedSelector = (typeof FIXED_SELECTORS)[number];

/** Any readable statistic: a fixed selector or one of the 16 skills. */
export type Selector = FixedSelector | SkillSlug;

const FIXED_SELECTOR_SET: ReadonlySet<string> = new Set(FIXED_SELECTORS);

/** Whether a string is a valid read selector (a fixed stat or a skill slug). */
export function isSelector(x: unknown): x is Selector {
  return typeof x === "string" && (FIXED_SELECTOR_SET.has(x) || SKILL_SLUG_SET.has(x));
}
