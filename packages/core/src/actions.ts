// The action vocabulary — the finite set of ACTION NAMES a predicate can be gated
// on. `action:demoralize` says "when the creature is Demoralizing"; this module
// owns the list of names that sentence may use.
//
// WHAT THIS IS AND IS NOT. It is a TAG NAMESPACE, not a state machine. Core does
// not know, and cannot know, whether a character is currently Escaping — nothing
// on a `ResolvedCharacter` carries that. Whoever RUNS an action asserts the tag:
// the bot's `/use` path when it executes one, or (the owner's example, 2026-07-20)
// an Escape button rendered on the Grabbed condition. A consumer that never
// asserts these tags — the web sheet — simply never fires the effects gated on
// them, which is the correct behaviour rather than a gap.
//
// SOURCES (rules-from-source; see CLAUDE.md). Every slug below comes from rules
// text supplied by the project owner on 2026-07-20, never from model memory:
//   • Basic actions            — AoN Rules ID 2343. "Strike Statistics" and "Aid
//                                Details" are subsections of that page, not
//                                actions, and are excluded per the owner.
//   • Specialty basic actions  — AoN Rules ID 2344.
//   • Skill actions            — the owner's compiled directory, since AoN does
//                                not carry them on one page.
//
// STRIDE IS DELIBERATELY ABSENT. The Basic Actions page references Stride in its
// introduction but carries no entry for it, and it appears nowhere in the ingest
// corpus, so adding it would mean inventing a rules claim to fix a problem no
// content has. Add it when a source supplies it.
//
// PURE DATA: a list, a set membership test, and a lookup. No rules math.

import { SKILL_SLUGS, type SkillSlug } from "./selectors.js";

/**
 * Basic actions (AoN 2343). Available to every creature, no skill behind them.
 */
export const BASIC_ACTION_SLUGS = [
  "aid",
  "crawl",
  "delay",
  "drop-prone",
  "escape",
  "interact",
  "leap",
  "ready",
  "release",
  "seek",
  "sense-motive",
  "stand",
  "step",
  "strike",
  "take-cover",
] as const;

/**
 * Specialty basic actions (AoN 2344) — basic in structure, but each requires
 * something not every creature has (a fly Speed, a shield, a sustained effect).
 */
export const SPECIALTY_BASIC_ACTION_SLUGS = [
  "arrest-a-fall",
  "avert-gaze",
  "burrow",
  "dismiss",
  "fly",
  "grab-an-edge",
  "mount",
  "point-out",
  "raise-a-shield",
  "sustain",
] as const;

/**
 * Skill actions — those performed by attempting a skill check. The skill(s) each
 * belongs to are in `ACTION_SKILLS` below.
 */
export const SKILL_ACTION_SLUGS = [
  "balance",
  "tumble-through",
  "maneuver-in-flight",
  "squeeze",
  "recall-knowledge",
  "borrow-an-arcane-spell",
  "decipher-writing",
  "identify-magic",
  "learn-a-spell",
  "climb",
  "force-open",
  "grapple",
  "high-jump",
  "long-jump",
  "reposition",
  "shove",
  "swim",
  "trip",
  "disarm",
  "repair",
  "craft",
  "earn-income",
  "identify-alchemy",
  "create-a-diversion",
  "impersonate",
  "lie",
  "feint",
  "gather-information",
  "make-an-impression",
  "request",
  "coerce",
  "demoralize",
  "administer-first-aid",
  "treat-disease",
  "treat-poison",
  "treat-wounds",
  "command-an-animal",
  "perform",
  "subsist",
  "create-forgery",
  "hide",
  "sneak",
  "conceal-an-object",
  "sense-direction",
  "cover-tracks",
  "track",
  "palm-an-object",
  "steal",
  "disable-a-device",
  "pick-a-lock",
] as const;

/** Every action name a predicate may reference. */
export const ACTION_SLUGS = [
  ...BASIC_ACTION_SLUGS,
  ...SPECIALTY_BASIC_ACTION_SLUGS,
  ...SKILL_ACTION_SLUGS,
] as const;

export type BasicActionSlug = (typeof BASIC_ACTION_SLUGS)[number];
export type SpecialtyBasicActionSlug = (typeof SPECIALTY_BASIC_ACTION_SLUGS)[number];
export type SkillActionSlug = (typeof SKILL_ACTION_SLUGS)[number];
export type ActionSlug = (typeof ACTION_SLUGS)[number];

const ACTION_SLUG_SET: ReadonlySet<string> = new Set(ACTION_SLUGS);

/** Whether a string names an action in this vocabulary. */
export function isActionSlug(x: unknown): x is ActionSlug {
  return typeof x === "string" && ACTION_SLUG_SET.has(x);
}

/**
 * The skill a skill action is attempted with. `"lore"` is NOT a `SkillSlug` —
 * lores are open-ended and deliberately unenumerated in `selectors.ts` — so it is
 * admitted here as its own literal rather than by widening that vocabulary.
 */
export type ActionSkill = SkillSlug | "lore";

/**
 * Which skill(s) each skill action can be attempted with.
 *
 * MANY-TO-MANY ON PURPOSE. Recall Knowledge is attempted with any of seven
 * skills, Earn Income with three, Subsist with two — so this maps to an ARRAY,
 * not a single skill. Collapsing it would have to pick a winner, and there is no
 * rules basis for calling any of Recall Knowledge's seven the "real" one.
 *
 * Basic and specialty basic actions are absent: they have no skill behind them,
 * and an entry of `[]` would be indistinguishable from "we didn't fill this in".
 */
export const ACTION_SKILLS: Readonly<Record<SkillActionSlug, readonly ActionSkill[]>> = {
  // Acrobatics
  balance: ["acrobatics"],
  "tumble-through": ["acrobatics"],
  "maneuver-in-flight": ["acrobatics"],
  squeeze: ["acrobatics"],
  // shared across the knowledge/magic skills
  "recall-knowledge": ["arcana", "crafting", "lore", "nature", "occultism", "religion", "society"],
  "decipher-writing": ["arcana", "occultism", "religion", "society"],
  "identify-magic": ["arcana", "nature", "occultism", "religion"],
  "learn-a-spell": ["arcana", "nature", "occultism", "religion"],
  "borrow-an-arcane-spell": ["arcana"],
  // Athletics
  climb: ["athletics"],
  "force-open": ["athletics"],
  grapple: ["athletics"],
  "high-jump": ["athletics"],
  "long-jump": ["athletics"],
  reposition: ["athletics"],
  shove: ["athletics"],
  swim: ["athletics"],
  trip: ["athletics"],
  disarm: ["athletics"],
  // Crafting
  repair: ["crafting"],
  craft: ["crafting"],
  "earn-income": ["crafting", "lore", "performance"],
  "identify-alchemy": ["crafting"],
  // Deception
  "create-a-diversion": ["deception"],
  impersonate: ["deception"],
  lie: ["deception"],
  feint: ["deception"],
  // Diplomacy
  "gather-information": ["diplomacy"],
  "make-an-impression": ["diplomacy"],
  request: ["diplomacy"],
  // Intimidation
  coerce: ["intimidation"],
  demoralize: ["intimidation"],
  // Medicine
  "administer-first-aid": ["medicine"],
  "treat-disease": ["medicine"],
  "treat-poison": ["medicine"],
  "treat-wounds": ["medicine"],
  // Nature
  "command-an-animal": ["nature"],
  // Performance
  perform: ["performance"],
  // Society / Survival
  subsist: ["society", "survival"],
  "create-forgery": ["society"],
  // Stealth
  hide: ["stealth"],
  sneak: ["stealth"],
  "conceal-an-object": ["stealth"],
  // Survival
  "sense-direction": ["survival"],
  "cover-tracks": ["survival"],
  track: ["survival"],
  // Thievery
  "palm-an-object": ["thievery"],
  steal: ["thievery"],
  "disable-a-device": ["thievery"],
  "pick-a-lock": ["thievery"],
};

const SKILL_ACTION_SET: ReadonlySet<string> = new Set(SKILL_ACTION_SLUGS);

/** Whether an action is attempted with a skill check. */
export function isSkillAction(x: unknown): x is SkillActionSlug {
  return typeof x === "string" && SKILL_ACTION_SET.has(x);
}

/** The skills an action can be attempted with; empty for non-skill actions. */
export function skillsForAction(action: ActionSlug): readonly ActionSkill[] {
  return isSkillAction(action) ? ACTION_SKILLS[action] : [];
}

/**
 * The skill actions attemptable with a given skill — the inverse of
 * `ACTION_SKILLS`, for an authoring surface that wants "what can I do with
 * Athletics?". Derived rather than written out, so the two cannot disagree.
 */
export function actionsForSkill(skill: ActionSkill): readonly SkillActionSlug[] {
  return SKILL_ACTION_SLUGS.filter((a) => ACTION_SKILLS[a].includes(skill));
}

/** The tag a predicate uses to name an action: `demoralize` → `action:demoralize`. */
export function actionTag(action: ActionSlug): string {
  return `action:${action}`;
}

/** Every skill that owns at least one action, for exhaustiveness tests. */
export const ACTION_SKILL_VALUES: readonly ActionSkill[] = [...SKILL_SLUGS, "lore"];
