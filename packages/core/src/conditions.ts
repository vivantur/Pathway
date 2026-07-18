// The PF2e condition vocabulary — the 41 conditions, what they do to a sheet, and
// how they combine. Implemented ONLY from the rules text supplied by the project
// owner (Player Core pp. 442–447); nothing here is remembered.
//
// THE FINDING THAT SHAPES THIS MODULE: most conditions are not modifiers. Roughly a
// dozen of the 41 reduce to typed penalties we can put on a sheet; the rest change
// action economy (Slowed, Stunned), detection state (Hidden, Invisible), or are GM
// adjudication (the five attitudes). So a condition is NOT "a bundle of
// PassiveEffects" — it is a named entity that MAY contribute passives and MUST name
// what it does beyond them.
//
// That naming is the same discipline foundry.ts uses for unmappable rule elements:
// `unmodeled` is a CLOSED vocabulary of blockers, so tallying it produces a roadmap
// rather than a shrug. A condition whose penalty we cannot express exactly emits NO
// passive and says why — an approximate penalty on a sheet is a wrong sheet, which
// is worse than a named gap.
//
// HOW COMBINATION WORKS (owner-supplied general rules):
//   1. Two conditions affecting the same thing → only the worst penalty / best bonus.
//      This is FREE: conditions emit `status`-typed modifiers and `stackModifiers`
//      already keeps the worst per type. Clumsy + Frightened on a Dex-based DC take
//      the worse of the two, never the sum. Off-Guard and Prone are `circumstance`,
//      so they stack alongside status penalties rather than competing with them.
//   2. A typed bonus and a same-typed penalty coexist — also `stackModifiers`.
//   3. The SAME condition applied twice keeps the worst, never adds: Enfeebled 1 then
//      Enfeebled 2 is Enfeebled 2, not 3. That one is NOT modifier stacking — it is
//      instance dedup, and it lives in `applyCondition` below.
//
// THIS IS THE SECOND CONDITION TABLE IN THE REPO, AND THAT IS A KNOWN DEBT.
// `apps/bot/src/rules/effects.js` carries 20 conditions in a five-bucket model
// (attack/damage/ac/save/skill), which cannot express "Dex-based skills only" and so
// over-applies several penalties. Comparing the two against the rules text turned up
// real divergences — Frightened and Sickened penalising DAMAGE (the text says "checks
// and DCs"), and Off-Guard described as a status penalty where the text says
// circumstance. Those are live bot bugs, reported rather than silently fixed here:
// the bot is frozen for architecture and its table is load-bearing in play. The end
// state is the bot delegating to this module, as `rules/pf2eMath.js` already does for
// arithmetic — a deliberate slice, not a side effect of this one.
//
// PURE: a data table plus set operations. No I/O.

import { z } from "zod";
import type { PassiveEffect } from "./passive.js";
import { SKILL_SLUGS, SAVE_SELECTORS, skillsForAbilities, type Selector } from "./selectors.js";

// ---------------------------------------------------------------------------
// the vocabulary
// ---------------------------------------------------------------------------

/** The 41 conditions, by canonical slug. A closed vocabulary. */
export const CONDITION_SLUGS = [
  "blinded", "broken", "clumsy", "concealed", "confused", "controlled", "dazzled",
  "deafened", "doomed", "drained", "dying", "encumbered", "enfeebled", "fascinated",
  "fatigued", "fleeing", "friendly", "frightened", "grabbed", "helpful", "hidden",
  "hostile", "immobilized", "indifferent", "invisible", "observed", "off-guard",
  "paralyzed", "petrified", "prone", "quickened", "restrained", "sickened", "slowed",
  "stunned", "stupefied", "unconscious", "undetected", "unfriendly", "unnoticed",
  "wounded",
] as const;
export type ConditionSlug = (typeof CONDITION_SLUGS)[number];

const CONDITION_SET: ReadonlySet<string> = new Set(CONDITION_SLUGS);
export function isConditionSlug(x: unknown): x is ConditionSlug {
  return typeof x === "string" && CONDITION_SET.has(x);
}

/** The named groupings from the rules text ("Groups of Conditions", Player Core 443). */
export type ConditionGroup =
  | "attitudes"
  | "death-and-dying"
  | "degrees-of-detection"
  | "lowered-abilities"
  | "senses";

/**
 * Why a condition's mechanics are not fully expressed as passive effects. A CLOSED
 * vocabulary named after the BLOCKER, so the tallies are a roadmap. Absence of a
 * reason is a claim: it means the passives below are the whole mechanical story.
 */
export type UnmodeledReason =
  /** Changes how many actions you get (Slowed, Stunned, Quickened). */
  | "action-economy"
  /** Restricts which actions you may use (Fleeing, Immobilized, Sickened's ingest). */
  | "action-restriction"
  /** Visibility/targeting state between creatures (Hidden, Invisible, Dazzled). */
  | "detection"
  /** Imposes a flat check to act or to be targeted (Grabbed, Stupefied's disruption). */
  | "flat-check"
  /** Dying/Wounded/Doomed — owned by the bot's combat model, see the note below. */
  | "death-track"
  /** Attitude/roleplay; no deterministic effect on a sheet (the five attitudes). */
  | "gm-adjudicated"
  /** Applies to objects, not creatures (Broken). */
  | "object-only"
  /** Speed or terrain changes the model has no field for (Encumbered, Blinded). */
  | "movement"
  /** Max/current HP changes outside the modifier model (Drained). */
  | "hp-alteration"
  /** Grants immunity to a trait (Blinded → visual, Deafened → auditory). */
  | "immunity"
  /**
   * The penalty is gated on a sense predicate we cannot tag yet — Blinded's −4 applies
   * only "if vision is your only precise sense", Deafened's −2 only to sound-related
   * checks. `when` exists; these tags do not, so nothing is emitted.
   */
  | "sense-conditional"
  /**
   * Part of the effect targets a stat our selector vocabulary cannot name precisely:
   * Clumsy's "ranged attack rolls" and Enfeebled's "Strength-based melee" are both
   * narrower than the unscoped `attack`/`damage` selectors.
   */
  | "needs-selector"
  /** The value changes by its own rule (Frightened per turn, Drained per night). */
  | "recovery";

/** A condition this one also imposes, with a value where the rules fix one. */
export interface ConditionImplication {
  slug: ConditionSlug;
  value?: number;
}

export interface ConditionDef {
  slug: ConditionSlug;
  name: string;
  /** Whether the condition carries a numeric value ("Frightened 2"). */
  valued: boolean;
  /** The value at which a further rule fires — only Dying states one (dying 4 = death). */
  maxValue?: number;
  group?: ConditionGroup;
  /** Conditions this one also gives you ("you have the off-guard and immobilized conditions"). */
  implies?: readonly ConditionImplication[];
  /** Conditions this one supersedes — the explicit "X overrides Y" statements. */
  overrides?: readonly ConditionSlug[];
  /** The typed modifiers this condition imposes, when expressible EXACTLY. */
  passives?: (value: number) => PassiveEffect[];
  /** What this condition does that `passives` does not capture. */
  unmodeled?: readonly UnmodeledReason[];
  /** One-line description. The full rules text belongs in the content store. */
  summary: string;
}

// ---------------------------------------------------------------------------
// modifier helpers
// ---------------------------------------------------------------------------

const penalty = (target: Selector, n: number, bonusType: "status" | "circumstance" = "status"): PassiveEffect => ({
  kind: "modifier",
  target,
  bonusType,
  value: { kind: "lit", value: -Math.abs(n) },
});

const penalties = (targets: readonly Selector[], n: number, type: "status" | "circumstance" = "status"): PassiveEffect[] =>
  targets.map((t) => penalty(t, n, type));

/**
 * Everything "all your checks and DCs" reaches (Frightened, Sickened). Includes AC —
 * AC is a DC (owner-confirmed) — and the reserved `attack`/`initiative` selectors,
 * which are checks even though the resolved model does not carry them yet; recording
 * the modifier is honest, and `applyDeltas` simply does not fold a reserved one.
 *
 * `damage` is excluded: a damage roll is neither a check nor a DC. `hp` and
 * `speed:land` likewise.
 */
const ALL_CHECKS_AND_DCS: readonly Selector[] = [
  "ac",
  ...SAVE_SELECTORS,
  "perception",
  "class-dc",
  "spell-dc",
  "spell-attack",
  "attack",
  "initiative",
  ...SKILL_SLUGS,
];

/** Stupefied's reach: "Int-, Wis-, and Cha-based rolls and DCs". */
const MENTAL_CHECKS: readonly Selector[] = [
  "will",
  "spell-attack",
  "spell-dc",
  ...skillsForAbilities(["int", "wis", "cha"]),
];

/** Clumsy's named skills. The rules name these three explicitly; not derived. */
const CLUMSY_TARGETS: readonly Selector[] = ["ac", "reflex", "acrobatics", "stealth", "thievery"];

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------
//
// A NOTE ON THE DEATH TRACK. Dying, Wounded and Doomed carry NO passives and are
// marked `death-track` deliberately. Their math already lives in the bot
// (apps/bot/src/rules/combatV2/model.js, under 82 tests) and CLAUDE.md names
// dying/recovery drift as the bug that justified this package. Core asserting a
// second version of those rules would recreate exactly that. Core therefore names
// them and claims nothing about them; consolidating the math into core is its own
// deliberate slice, not a side effect of building this vocabulary.

const DEFS: readonly ConditionDef[] = [
  {
    slug: "blinded",
    name: "Blinded",
    valued: false,
    group: "senses",
    overrides: ["dazzled"],
    // The −4 to Perception is conditional ("if vision is your only precise sense"),
    // so nothing is emitted — a conditional penalty shown as flat is a wrong sheet.
    unmodeled: ["sense-conditional", "detection", "movement", "immunity"],
    summary: "You can't see. All normal terrain is difficult terrain; you're immune to visual effects.",
  },
  {
    slug: "broken",
    name: "Broken",
    valued: false,
    unmodeled: ["object-only"],
    summary: "An object reduced to its Broken Threshold. Affects objects, not creatures.",
  },
  {
    slug: "clumsy",
    name: "Clumsy",
    valued: true,
    group: "lowered-abilities",
    passives: (v) => penalties(CLUMSY_TARGETS, v),
    // "ranged attack rolls" is narrower than our unscoped `attack` selector.
    unmodeled: ["needs-selector"],
    summary: "Status penalty equal to the value on Dexterity-based rolls and DCs.",
  },
  {
    slug: "concealed",
    name: "Concealed",
    valued: false,
    group: "senses",
    unmodeled: ["detection", "flat-check"],
    summary: "Attackers must succeed at a DC 5 flat check to target you.",
  },
  {
    slug: "confused",
    name: "Confused",
    valued: false,
    implies: [{ slug: "off-guard" }],
    unmodeled: ["action-economy", "action-restriction", "flat-check"],
    summary: "You attack wildly at random targets and can't Delay, Ready, or use reactions.",
  },
  {
    slug: "controlled",
    name: "Controlled",
    valued: false,
    unmodeled: ["action-economy", "action-restriction"],
    summary: "Another creature dictates your actions.",
  },
  {
    slug: "dazzled",
    name: "Dazzled",
    valued: false,
    group: "senses",
    unmodeled: ["sense-conditional", "detection"],
    summary: "If vision is your only precise sense, all creatures and objects are concealed from you.",
  },
  {
    slug: "deafened",
    name: "Deafened",
    valued: false,
    group: "senses",
    // The −2 is scoped to initiative and sound-related checks — check-type scoping we
    // cannot express, so it is named rather than approximated across all Perception.
    unmodeled: ["sense-conditional", "flat-check", "immunity"],
    summary: "You can't hear; auditory actions require a DC 5 flat check. Immune to auditory effects.",
  },
  {
    slug: "doomed",
    name: "Doomed",
    valued: true,
    group: "death-and-dying",
    unmodeled: ["death-track", "recovery"],
    summary: "Reduces the dying value at which you die. Decreases by 1 per full night's rest.",
  },
  {
    slug: "drained",
    name: "Drained",
    valued: true,
    group: "lowered-abilities",
    passives: (v) => [penalty("fortitude", v)],
    // The HP loss (level x value, and the same reduction to maximum HP) is not a
    // modifier — it changes max HP, which the sheet bag has no typed slot for.
    unmodeled: ["hp-alteration", "recovery"],
    summary: "Status penalty equal to the value on Constitution-based rolls and DCs; reduces max HP.",
  },
  {
    slug: "dying",
    name: "Dying",
    valued: true,
    maxValue: 4,
    group: "death-and-dying",
    implies: [{ slug: "unconscious" }],
    unmodeled: ["death-track"],
    summary: "You're at death's door. At dying 4 you die; you're unconscious while dying.",
  },
  {
    slug: "encumbered",
    name: "Encumbered",
    valued: false,
    implies: [{ slug: "clumsy", value: 1 }],
    // The 10-foot Speed penalty has a floor ("can't reduce below 5 feet") that a flat
    // modifier cannot express.
    unmodeled: ["movement"],
    summary: "You're clumsy 1 and take a 10-foot penalty to all Speeds (minimum 5 feet).",
  },
  {
    slug: "enfeebled",
    name: "Enfeebled",
    valued: true,
    group: "lowered-abilities",
    passives: (v) => [penalty("athletics", v)],
    // "Strength-based melee attack rolls" and "Strength-based damage rolls" are both
    // narrower than the unscoped `attack`/`damage` selectors.
    unmodeled: ["needs-selector"],
    summary: "Status penalty equal to the value on Strength-based rolls and DCs.",
  },
  {
    slug: "fascinated",
    name: "Fascinated",
    valued: false,
    passives: () => penalties(["perception", ...SKILL_SLUGS], 2),
    unmodeled: ["action-restriction"],
    summary: "-2 status penalty to Perception and skill checks; can't use unrelated concentrate actions.",
  },
  {
    slug: "fatigued",
    name: "Fatigued",
    valued: false,
    passives: () => penalties(["ac", ...SAVE_SELECTORS], 1),
    unmodeled: ["action-restriction", "recovery"],
    summary: "-1 status penalty to AC and saving throws; can't use travel exploration activities.",
  },
  {
    slug: "fleeing",
    name: "Fleeing",
    valued: false,
    unmodeled: ["action-economy", "action-restriction"],
    summary: "You must spend your actions escaping the source; you can't Delay or Ready.",
  },
  { slug: "friendly", name: "Friendly", valued: false, group: "attitudes", unmodeled: ["gm-adjudicated"], summary: "A creature's attitude: likes the character." },
  {
    slug: "frightened",
    name: "Frightened",
    valued: true,
    passives: (v) => penalties(ALL_CHECKS_AND_DCS, v),
    // The value drops by 1 at the end of each of your turns — lifecycle, not a modifier.
    unmodeled: ["recovery"],
    summary: "Status penalty equal to the value to all your checks and DCs; decreases by 1 each turn.",
  },
  {
    slug: "grabbed",
    name: "Grabbed",
    valued: false,
    implies: [{ slug: "off-guard" }, { slug: "immobilized" }],
    unmodeled: ["flat-check"],
    summary: "You're held in place; manipulate actions require a DC 5 flat check.",
  },
  { slug: "helpful", name: "Helpful", valued: false, group: "attitudes", unmodeled: ["gm-adjudicated"], summary: "A creature's attitude: wishes to actively aid the character." },
  {
    slug: "hidden",
    name: "Hidden",
    valued: false,
    group: "degrees-of-detection",
    unmodeled: ["detection", "flat-check"],
    summary: "A creature knows your space but not your exact location; DC 11 flat check to target you.",
  },
  { slug: "hostile", name: "Hostile", valued: false, group: "attitudes", unmodeled: ["gm-adjudicated"], summary: "A creature's attitude: actively seeks to harm the character." },
  {
    slug: "immobilized",
    name: "Immobilized",
    valued: false,
    unmodeled: ["action-restriction", "movement"],
    summary: "You can't use actions with the move trait.",
  },
  { slug: "indifferent", name: "Indifferent", valued: false, group: "attitudes", unmodeled: ["gm-adjudicated"], summary: "A creature's attitude: the default, neither favourable nor hostile." },
  {
    slug: "invisible",
    name: "Invisible",
    valued: false,
    group: "senses",
    implies: [{ slug: "undetected" }],
    unmodeled: ["detection"],
    summary: "You can't be seen, and are undetected to everyone.",
  },
  {
    slug: "observed",
    name: "Observed",
    valued: false,
    group: "degrees-of-detection",
    unmodeled: ["detection"],
    summary: "You are in plain view — the default state of detection.",
  },
  {
    slug: "off-guard",
    name: "Off-Guard",
    valued: false,
    // Fully modelled: a flat circumstance penalty and nothing else.
    passives: () => [penalty("ac", 2, "circumstance")],
    summary: "-2 circumstance penalty to AC.",
  },
  {
    slug: "paralyzed",
    name: "Paralyzed",
    valued: false,
    implies: [{ slug: "off-guard" }],
    unmodeled: ["action-economy", "action-restriction"],
    summary: "You're frozen in place and can act only with your mind.",
  },
  {
    slug: "petrified",
    name: "Petrified",
    valued: false,
    unmodeled: ["action-economy", "detection", "hp-alteration"],
    summary: "You're turned to stone: you can't act or sense, and become an object.",
  },
  {
    slug: "prone",
    name: "Prone",
    valued: false,
    implies: [{ slug: "off-guard" }],
    passives: () => [penalty("attack", 2, "circumstance")],
    unmodeled: ["action-restriction", "movement"],
    summary: "You're lying down: off-guard, -2 circumstance to attack rolls, and can only Crawl or Stand.",
  },
  {
    slug: "quickened",
    name: "Quickened",
    valued: false,
    unmodeled: ["action-economy"],
    summary: "You gain 1 additional action at the start of your turn.",
  },
  {
    slug: "restrained",
    name: "Restrained",
    valued: false,
    implies: [{ slug: "off-guard" }, { slug: "immobilized" }],
    overrides: ["grabbed"],
    unmodeled: ["action-restriction"],
    summary: "You're tied up: off-guard and immobilized, and can act only to Escape or Force Open.",
  },
  {
    slug: "sickened",
    name: "Sickened",
    valued: true,
    passives: (v) => penalties(ALL_CHECKS_AND_DCS, v),
    unmodeled: ["action-restriction", "recovery"],
    summary: "Status penalty equal to the value to all your checks and DCs; you can't willingly ingest.",
  },
  {
    slug: "slowed",
    name: "Slowed",
    valued: true,
    unmodeled: ["action-economy"],
    summary: "You regain that many fewer actions at the start of your turn.",
  },
  {
    slug: "stunned",
    name: "Stunned",
    valued: true,
    overrides: ["slowed"],
    unmodeled: ["action-economy"],
    summary: "You lose that many total actions, possibly across turns. Overrides slowed.",
  },
  {
    slug: "stupefied",
    name: "Stupefied",
    valued: true,
    group: "lowered-abilities",
    passives: (v) => penalties(MENTAL_CHECKS, v),
    // Casting a spell requires a DC 5 + value flat check or the spell is disrupted.
    unmodeled: ["flat-check"],
    summary: "Status penalty equal to the value on Int-, Wis-, and Cha-based rolls and DCs.",
  },
  {
    slug: "unconscious",
    name: "Unconscious",
    valued: false,
    group: "death-and-dying",
    implies: [{ slug: "blinded" }, { slug: "off-guard" }],
    passives: () => penalties(["ac", "perception", "reflex"], 4),
    unmodeled: ["action-economy", "recovery"],
    summary: "-4 status penalty to AC, Perception and Reflex; you're blinded, off-guard, and can't act.",
  },
  {
    slug: "undetected",
    name: "Undetected",
    valued: false,
    group: "degrees-of-detection",
    unmodeled: ["detection", "flat-check"],
    summary: "A creature can't see you or tell what space you occupy, and can't target you.",
  },
  { slug: "unfriendly", name: "Unfriendly", valued: false, group: "attitudes", unmodeled: ["gm-adjudicated"], summary: "A creature's attitude: dislikes and distrusts the character." },
  {
    slug: "unnoticed",
    name: "Unnoticed",
    valued: false,
    group: "degrees-of-detection",
    implies: [{ slug: "undetected" }],
    unmodeled: ["detection"],
    summary: "A creature has no idea you're present; you're also undetected.",
  },
  {
    slug: "wounded",
    name: "Wounded",
    valued: true,
    group: "death-and-dying",
    unmodeled: ["death-track", "recovery"],
    summary: "Increases the dying value you start at. Cleared by Treat Wounds or full HP plus rest.",
  },
];

/** Every condition definition, by slug. */
export const CONDITIONS: Readonly<Record<ConditionSlug, ConditionDef>> = Object.freeze(
  Object.fromEntries(DEFS.map((d) => [d.slug, d])) as Record<ConditionSlug, ConditionDef>,
);

// ---------------------------------------------------------------------------
// held conditions
// ---------------------------------------------------------------------------

/** A condition currently on a creature. `value` is present iff the condition is valued. */
export interface HeldCondition {
  slug: ConditionSlug;
  value?: number;
}

export const heldConditionSchema = z
  .object({
    slug: z.enum(CONDITION_SLUGS),
    value: z.number().int().positive().optional(),
  })
  .strict();

/**
 * Apply a condition to a set already held — the owner's rule 3.
 *
 * The SAME condition twice keeps the WORST, never the sum: Enfeebled 1 plus Enfeebled 2
 * is Enfeebled 2. A binary condition applied twice is simply still held once. Returns a
 * new array; the input is never mutated.
 *
 * Deliberately NOT the place where implications or overrides are resolved — those are a
 * VIEW over what is held (`resolveConditions`), not a mutation of it. Keeping them apart
 * means removing Restrained correctly un-suppresses Grabbed, instead of having destroyed
 * it at apply time.
 */
export function applyCondition(
  held: readonly HeldCondition[],
  slug: ConditionSlug,
  value?: number,
): HeldCondition[] {
  const def = CONDITIONS[slug];
  const next = def.valued ? Math.max(1, Math.floor(value ?? 1)) : undefined;
  const capped = def.maxValue !== undefined && next !== undefined ? Math.min(next, def.maxValue) : next;

  const existing = held.find((h) => h.slug === slug);
  if (!existing) return [...held, capped === undefined ? { slug } : { slug, value: capped }];
  if (capped === undefined) return [...held]; // binary: already held, nothing to raise
  return held.map((h) => (h.slug === slug ? { slug, value: Math.max(h.value ?? 0, capped) } : h));
}

/** Remove a condition entirely. */
export function removeCondition(held: readonly HeldCondition[], slug: ConditionSlug): HeldCondition[] {
  return held.filter((h) => h.slug !== slug);
}

export interface ResolvedConditions {
  /** What is in force: everything held, plus what those imply, minus what is overridden. */
  active: HeldCondition[];
  /** Conditions present but superseded by an explicit override (Stunned over Slowed). */
  suppressed: ConditionSlug[];
}

/**
 * Expand implications and apply the explicit overrides, producing what is actually in
 * force. Implications resolve FIRST and transitively — Dying implies Unconscious, which
 * implies Blinded and Off-Guard — then overrides are applied to the expanded set, so
 * Blinded arriving via Unconscious still suppresses a held Dazzled.
 *
 * An implied condition never overwrites a directly held one with a higher value.
 */
export function resolveConditions(held: readonly HeldCondition[]): ResolvedConditions {
  let expanded: HeldCondition[] = [];
  for (const h of held) expanded = applyCondition(expanded, h.slug, h.value);

  // Transitive closure over `implies`. The graph is small and acyclic in the rules
  // text; `seen` guards regardless, so a future cycle cannot hang this.
  const queue = [...expanded.map((h) => h.slug)];
  const seen = new Set<ConditionSlug>(queue);
  while (queue.length) {
    const slug = queue.shift()!;
    for (const imp of CONDITIONS[slug].implies ?? []) {
      expanded = applyCondition(expanded, imp.slug, imp.value);
      if (!seen.has(imp.slug)) {
        seen.add(imp.slug);
        queue.push(imp.slug);
      }
    }
  }

  const suppressed = new Set<ConditionSlug>();
  for (const h of expanded) {
    for (const over of CONDITIONS[h.slug].overrides ?? []) {
      if (expanded.some((e) => e.slug === over)) suppressed.add(over);
    }
  }

  return {
    active: expanded.filter((h) => !suppressed.has(h.slug)),
    suppressed: [...suppressed].sort(),
  };
}

/**
 * The passive effects a set of held conditions imposes — resolved (implications and
 * overrides applied) and flattened. Feed this to `applyPassiveEffects` or
 * `collectPassiveSheetEffects` and the owner's rules 1 and 2 come free, because every
 * penalty here is typed and `stackModifiers` already keeps the worst per type.
 */
export function conditionPassives(held: readonly HeldCondition[]): PassiveEffect[] {
  const { active } = resolveConditions(held);
  const out: PassiveEffect[] = [];
  for (const h of active) {
    const def = CONDITIONS[h.slug];
    if (def.passives) out.push(...def.passives(h.value ?? 1));
  }
  return out;
}

/**
 * The blockers across a set of held conditions — what is in force that the passives do
 * NOT express. This is the honest companion to `conditionPassives`: a caller showing
 * condition effects on a sheet should show these too, or it is presenting a partial
 * answer as a complete one.
 */
export function conditionGaps(held: readonly HeldCondition[]): UnmodeledReason[] {
  const { active } = resolveConditions(held);
  const reasons = new Set<UnmodeledReason>();
  for (const h of active) for (const r of CONDITIONS[h.slug].unmodeled ?? []) reasons.add(r);
  return [...reasons].sort();
}
