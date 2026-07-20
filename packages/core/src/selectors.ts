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
 * `initiative` is still RESERVED — part of the vocabulary the design doc names,
 * but derived at play time rather than carried; `resolveSelector` returns 0 for
 * it rather than guessing a value.
 *
 * `attack` and `damage` are NOT here. They are per-strike, not per-character, so
 * no single number on the resolved model can back them — see the scoped-selector
 * section below.
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
  // reserved (returns 0 for now):
  "initiative",
] as const;
export type FixedSelector = (typeof FIXED_SELECTORS)[number];

// ---------------------------------------------------------------------------
// scoped selectors — `attack` and `damage`
// ---------------------------------------------------------------------------
//
// Every other selector names ONE statistic with ONE value on the resolved
// character. `attack` and `damage` cannot: a character has as many attack
// modifiers as it has strikes, and "+1 to attacks with swords" applies to some
// of them and not others. They were previously in FIXED_SELECTORS and hardcoded
// to return 0 — a placeholder, not a model.
//
// A scoped selector is a base (`attack`/`damage`) plus zero or more colon-
// delimited SCOPE SEGMENTS that narrow which strikes it applies to. It matches a
// strike only when EVERY segment matches, so segments intersect rather than
// union: `damage:strike:melee` is melee Strikes, not "melee or Strikes".
//
// Colon-delimited scoping is the convention already in this vocabulary
// (`speed:land`), so selectors stay plain strings — which matters because they
// are used as record keys, serialized into stored content, and persisted in the
// review decisions table. A structured `{base, scope}` selector would have been
// tidier in the abstract and a migration everywhere in practice.
//
// THE SEGMENT VOCABULARY IS DATA-DRIVEN, not invented: it was derived from the
// 435 attack/damage selector usages across 301 entities in the Foundry ingest
// corpus (2026-07-19). Notably that corpus contains NO trait-scoped selectors,
// so there is deliberately no `trait:agile` segment — adding one would be
// speculation. The list is extensible when real content asks for it.

/** The selector bases that take a scope. */
export const SCOPED_BASES = ["attack", "damage"] as const;
export type ScopedBase = (typeof SCOPED_BASES)[number];

/**
 * Scope segments taking no value. `strike` narrows to Strikes specifically,
 * excluding spell attack rolls and attack-trait skill actions — a real PF2e
 * distinction (a bonus to "attack rolls" would otherwise buff spell attacks),
 * and the corpus's most common scope by a wide margin.
 */
export const STRIKE_FLAG_SEGMENTS = ["strike", "melee", "ranged", "unarmed"] as const;
export type StrikeFlagSegment = (typeof STRIKE_FLAG_SEGMENTS)[number];

/** Scope segments of the form `<dimension>:<value>` — `group:sword`, `weapon:jaws`. */
export const STRIKE_KEYED_SEGMENTS = ["group", "weapon"] as const;
export type StrikeKeyedSegment = (typeof STRIKE_KEYED_SEGMENTS)[number];

const FLAG_SEGMENT_SET: ReadonlySet<string> = new Set(STRIKE_FLAG_SEGMENTS);
const KEYED_SEGMENT_SET: ReadonlySet<string> = new Set(STRIKE_KEYED_SEGMENTS);
const SCOPED_BASE_SET: ReadonlySet<string> = new Set(SCOPED_BASES);

/**
 * A scoped selector string: a base plus its scope segments, e.g. `attack`,
 * `damage:melee`, `attack:group:sword`, `damage:strike:unarmed`. Kept as a
 * template type so the common literals stay checkable at authoring time without
 * enumerating an open-ended weapon/group namespace.
 */
export type ScopedSelector = ScopedBase | `${ScopedBase}:${string}`;

/**
 * The properties of a strike a scope segment can test. Step 2's resolved `Strike`
 * satisfies this structurally; it lives here because a vocabulary without defined
 * matching semantics is not a contract.
 */
export interface StrikeDescriptor {
  /**
   * What kind of attack-trait check this is. Only `strike` matches the `strike`
   * segment; `spell-attack` and `other` (Shove, Trip, …) do not.
   */
  kind: "strike" | "spell-attack" | "other";
  range: "melee" | "ranged";
  unarmed: boolean;
  /** Weapon group slug (`sword`, `bow`, `brawling`), when the source has one. */
  group?: string;
  /** The specific weapon/attack slug (`longsword`, `jaws`), when the source has one. */
  weapon?: string;
}

/** Split a selector into its base and raw scope segments. */
function splitScoped(s: string): { base: string; segments: string[] } {
  const parts = s.split(":");
  return { base: parts[0]!, segments: parts.slice(1) };
}

/**
 * Whether a string is a well-formed scoped selector. Validates the SHAPE — that
 * every segment is a known flag or a known `dimension:value` pair — not that the
 * group/weapon named exists, which is a content question this module cannot
 * answer.
 */
export function isScopedSelector(x: unknown): x is ScopedSelector {
  if (typeof x !== "string") return false;
  const { base, segments } = splitScoped(x);
  if (!SCOPED_BASE_SET.has(base)) return false;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (FLAG_SEGMENT_SET.has(seg)) continue;
    if (KEYED_SEGMENT_SET.has(seg)) {
      // A keyed segment consumes the NEXT segment as its value, which must exist
      // and must be non-empty (`attack:group:` names no group).
      const value = segments[i + 1];
      if (value === undefined || value === "") return false;
      i++;
      continue;
    }
    return false;
  }
  return true;
}

/** The base of a scoped selector (`damage:strike:melee` → `damage`). */
export function scopedBase(s: ScopedSelector): ScopedBase {
  return splitScoped(s).base as ScopedBase;
}

/**
 * Whether a scoped selector applies to a given strike — true when EVERY segment
 * matches. An unscoped `attack`/`damage` has no segments and so matches every
 * strike, which is exactly what "a +1 status bonus to attack rolls" means.
 *
 * Returns false for a malformed selector rather than throwing: a bad selector
 * should fail to apply, not abort a sheet render.
 */
export function selectorMatchesStrike(s: ScopedSelector, strike: StrikeDescriptor): boolean {
  if (!isScopedSelector(s)) return false;
  const { segments } = splitScoped(s);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    switch (seg) {
      case "strike":
        if (strike.kind !== "strike") return false;
        break;
      case "melee":
        if (strike.range !== "melee") return false;
        break;
      case "ranged":
        if (strike.range !== "ranged") return false;
        break;
      case "unarmed":
        if (!strike.unarmed) return false;
        break;
      case "group":
        if (strike.group !== segments[++i]) return false;
        break;
      case "weapon":
        if (strike.weapon !== segments[++i]) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

/** Any readable statistic: a fixed selector, a skill slug, or a scoped selector. */
export type Selector = FixedSelector | SkillSlug | ScopedSelector;

const FIXED_SELECTOR_SET: ReadonlySet<string> = new Set(FIXED_SELECTORS);

/** Whether a string is a valid read selector (a fixed stat, a skill slug, or scoped). */
export function isSelector(x: unknown): x is Selector {
  return (
    typeof x === "string" &&
    (FIXED_SELECTOR_SET.has(x) || SKILL_SLUG_SET.has(x) || isScopedSelector(x))
  );
}
