// The Foundry ingest adapter — the ONE place Foundry's `pf2e` rule-element shape
// is allowed to exist, and the map out of it into OUR Layer-1 `PassiveEffect`.
//
// WHY THIS FILE IS A BOUNDARY (docs/effects-engine-design.md, locked decision):
// Foundry's hand-authored rule encodings are THEIR work and THEIR schema. We treat
// them as import feedstock and map into our schema AT INGEST — we do not store their
// shape as content, and nothing at runtime reads it. Keeping `RuleElement` and every
// string of their vocabulary inside this module makes that a file boundary rather
// than a convention someone has to remember. If this module is the only importer of
// `RuleElement`, the coupling is contained by construction.
//
// THIS MODULE IS NOT ON THE RUNTIME PATH. It runs in the ingest script, offline,
// against a pinned Foundry checkout. The web app and the bot never call it.
//
// IT TRANSLATES; IT DOES NOT EVALUATE. There is no character at ingest time, so
// values become expression ASTs (expr.ts) to be evaluated later, per character. That
// is why a grant's numeric payload is an `Expr` and not a number.
//
// NO PF2e RULES LIVE HERE. This maps one encoding onto another; the rules are in
// stackModifiers/degree.ts/etc., from pasted text. Nothing here is remembered PF2e.
//
// HONESTY IS THE PRODUCT. The corpus is large and irregular, and most of it does not
// fit our schema yet. This mapper NEVER guesses: an element either maps to a
// PassiveEffect we can stand behind, or it is reported as unsupported WITH A REASON
// drawn from a closed vocabulary. The report is a first-class output, not a
// diagnostic afterthought — it is what makes a human review possible, and its reason
// tallies double as a roadmap of what the engine still lacks.

import { z } from "zod";
import { DEGREES, shiftDegree, type DegreeOfSuccess } from "./degree.js";
import { parseExpr, type Expr } from "./expr.js";
import type { Predicate } from "./predicate.js";
import {
  effectChoiceSchema,
  passiveEffectSchema,
  type EffectChoice,
  type EffectChoiceOption,
  type Grant,
  type PassiveEffect,
  type RankValue,
} from "./passive.js";
import { isSelector, isSkillSlug, SAVE_SELECTORS, SKILL_SLUGS, type Selector } from "./selectors.js";
import { ACTION_SKILLS, isActionSlug, isSkillAction } from "./actions.js";
import { toggleDeclarationSchema, type ToggleDeclaration, type ToggleVariant } from "./toggles.js";
import { grantedActionSchema } from "./automation.js";
import { dedupeGrants, entityGrantSchema, type EntityGrant } from "./grants.js";

/** A Foundry rule element. Only the fields we read are typed; the rest is open. */
export interface RuleElement {
  key: string;
  [field: string]: unknown;
}

/**
 * Why an element did not map. A CLOSED vocabulary, deliberately named after the
 * BLOCKER rather than the symptom, so that tallying reasons across the corpus
 * produces a roadmap ("546 elements are waiting on combat tags") rather than a pile
 * of unrelated complaints. In order:
 *   • needs-combat-tags    — gated by a Foundry predicate; our `when?` tags are
 *                            static-only (doc decision 3). Also RollOption, which
 *                            PRODUCES such a tag.
 *   • needs-item-model     — alters or creates weapons/items; we have no item model.
 *   • needs-granting       — grants a whole item/feat/spell: an entity, not an effect.
 *   • needs-runtime-choice — depends on a selection-time choice (`{item|…}`).
 *   • unsupported-selector — targets a stat outside our Selector vocabulary, or a
 *                            Foundry-internal actor data path.
 *   • unsupported-bonus-type — outside circumstance/status/item/untyped.
 *   • unsupported-value    — a value our bounded grammar cannot parse.
 *   • unsupported-shape    — the kind maps in principle; this instance does not.
 *   • unknown-key          — a rule-element kind this adapter does not handle.
 */
export const unsupportedReasonSchema = z.enum([
  "needs-combat-tags",
  "needs-item-model",
  "needs-granting",
  "needs-runtime-choice",
  "unsupported-selector",
  "unsupported-bonus-type",
  "unsupported-value",
  "unsupported-shape",
  "unknown-key",
]);
export type UnsupportedReason = z.infer<typeof unsupportedReasonSchema>;

/** One element's outcome. `index` positions it in the source `rules[]` for review. */
export const mappingEntrySchema = z
  .object({
    index: z.number().int().nonnegative(),
    key: z.string(),
    outcome: z.enum(["mapped", "unsupported"]),
    /** Present iff `outcome === "unsupported"`. */
    reason: unsupportedReasonSchema.optional(),
    /** Human-readable specifics for the review page (which selector, which value…). */
    detail: z.string().optional(),
    /** How many effects this element produced (a `saving-throw` modifier fans out to 3). */
    produced: z.number().int().nonnegative().optional(),
  })
  .strict();
export type MappingEntry = z.infer<typeof mappingEntrySchema>;

export interface MappingResult {
  effects: PassiveEffect[];
  /**
   * Whole entities this one grants — a BUILD-GRAPH edge, not an effect, which is why
   * it is its own field rather than a `PassiveEffect` kind (owner decision, 2026-07-19;
   * see grants.ts). Additive: a consumer destructuring `{ effects, report }` is
   * unaffected.
   */
  grants: EntityGrant[];
  /**
   * Player choices whose OPTIONS are fixed by the content — resolved here, at
   * ingest, so no runtime consumer ever interprets a `ChoiceSet`.
   */
  choices: EffectChoice[];
  /**
   * Player-controlled switches this entity offers, each asserting tag(s) when flipped
   * (see toggles.ts). Its own field, not a `PassiveEffect`, for the same reason as
   * `grants`: a toggle changes no number, it changes which tags are active. Additive.
   */
  toggles: ToggleDeclaration[];
  report: MappingEntry[];
}

/**
 * What an ingest leaves on a content entity, for the admin review surface. INERT:
 * nothing at runtime reads any of this — the sheet reads the entity's `effects`.
 *
 * `raw` is typed `unknown[]`, NOT `RuleElement[]`, and that is deliberate. It is the
 * strongest available form of the quarantine: the CONTENT schema does not know
 * Foundry's type at all, so their shape cannot leak into anything that reads content.
 * Only this module — which runs offline, at ingest — knows how to interpret it. It is
 * kept so the review page can show the source element beside what we generated, and
 * so a re-map needs no fresh Foundry checkout.
 */
export const ingestRecordSchema = z
  .object({
    /** Foundry's rule elements, verbatim and opaque. Provenance only, never read at runtime. */
    raw: z.array(z.unknown()),
    /** One entry per element of `raw` — what mapped, what didn't, and why. */
    report: z.array(mappingEntrySchema),
    /** The pinned upstream commit this came from, so a re-ingest can diff. */
    sourceCommit: z.string().min(1).optional(),
    mappedAt: z.string().min(1).optional(),
  })
  .strict();
export type IngestRecord = z.infer<typeof ingestRecordSchema>;

/**
 * The human review state of an entity's effects — the anti-clobber signal.
 *
 * This is a message to the RE-INGEST, not to the sheet: `overridden` means `effects`
 * is human-authored and a re-ingest must not replace it (it may still refresh
 * `ingest.raw`/`report` so the review page can diff against new upstream data).
 * Runtime never consults this; it reads `effects` and does not care where they came
 * from. Per the pin-version invariant an admin edit bumps the entity's `version`, so
 * a correction reaches characters as an explicit content update, never a silent
 * retroactive mutation.
 */
export const effectReviewSchema = z
  .object({
    status: z.enum(["unreviewed", "verified", "overridden"]),
    by: z.string().min(1).optional(),
    at: z.string().min(1).optional(),
  })
  .strict();
export type EffectReview = z.infer<typeof effectReviewSchema>;

/**
 * The effect-bearing fields any content entity may carry. Spread into an entity's
 * schema shape (as `featSchema` does) rather than extended, matching `contentBase`.
 */
export const effectBearingShape = {
  /** OUR schema. The only one a runtime consumer may read. */
  effects: z.array(passiveEffectSchema).optional(),
  /**
   * Effects the player must choose between (Canny Acumen's save, Skill Training's
   * skill). Options and their effects are fixed content, resolved at ingest; only
   * the selection is runtime. Kept separate from `effects` because these apply only
   * once picked — folding them in would grant every option at once.
   */
  choices: z.array(effectChoiceSchema).optional(),
  /**
   * GRANTED ACTIONS — full activities a feat bestows (a stance's strike, an Escape),
   * each carrying a Layer-2 automation tree. Unlike `effects`/`choices` these are NOT
   * auto-derivable: Foundry's rule elements don't encode the activity and prose→automation
   * is not a tractable parse, so this slot is filled by the AUTHORING surface, not ingest.
   * Additive + optional — existing content without it validates unchanged.
   */
  actions: z.array(grantedActionSchema).optional(),
  /**
   * Whole entities this one grants (a feat that gives you another feat). NOT an effect
   * — see grants.ts. Read by the BUILDER when assembling a character's content, never
   * by the effects engine. Additive + optional, so existing content validates unchanged.
   */
  grants: z.array(entityGrantSchema).optional(),
  /**
   * Player-controlled switches this entity offers (see toggles.ts). NOT an effect — a
   * toggle changes which TAGS are active, and other elements predicate on those. Read
   * by the sheet to render controls and by the tag builder; the effects engine sees
   * only the resulting tags. Additive + optional.
   */
  toggles: z.array(toggleDeclarationSchema).optional(),
  ingest: ingestRecordSchema.optional(),
  review: effectReviewSchema.optional(),
};

// ---------------------------------------------------------------------------
// Foundry's vocabulary → ours
// ---------------------------------------------------------------------------

/**
 * Foundry FlatModifier selectors → our read Selector(s). Some of theirs are
 * BROADCAST selectors with no single-stat equivalent (`saving-throw` hits all three
 * saves, `skill-check` all sixteen skills); those fan out to several effects, which
 * is a faithful translation rather than an approximation. Anything absent maps to
 * nothing and is reported — `strike-damage`, `spell-damage`, `{item|id}-damage` and
 * friends need the per-weapon selectors we have deliberately deferred.
 */
const SELECTOR_MAP: Readonly<Record<string, readonly Selector[]>> = {
  ac: ["ac"],
  perception: ["perception"],
  initiative: ["initiative"],
  hp: ["hp"],
  fortitude: ["fortitude"],
  reflex: ["reflex"],
  will: ["will"],
  "saving-throw": SAVE_SELECTORS,
  "skill-check": SKILL_SLUGS,
  "land-speed": ["speed:land"],
  "class-dc": ["class-dc"],
  "spell-dc": ["spell-dc"],
  "spell-attack": ["spell-attack"],
  "spell-attack-roll": ["spell-attack"],

  // Strike selectors, mappable since the scoped attack/damage vocabulary landed
  // (2026-07-19). Foundry distinguishes `attack-roll` (any attack roll, spell
  // attacks included) from `strike-attack-roll` (Strikes only); that distinction
  // is real in PF2e, not a Foundry artifact, and our `:strike` segment preserves
  // it. Mapping both to the same thing would silently buff spell attacks.
  attack: ["attack"],
  "attack-roll": ["attack"],
  damage: ["damage"],
  "attack-damage": ["damage"],
  "strike-attack-roll": ["attack:strike"],
  "strike-damage": ["damage:strike"],
  "melee-attack-roll": ["attack:melee"],
  "melee-damage": ["damage:melee"],
  "ranged-attack-roll": ["attack:ranged"],
  "ranged-damage": ["damage:ranged"],
  "melee-strike-attack-roll": ["attack:strike:melee"],
  "melee-strike-damage": ["damage:strike:melee"],
  "ranged-strike-attack-roll": ["attack:strike:ranged"],
  "ranged-strike-damage": ["damage:strike:ranged"],
  "unarmed-attack-roll": ["attack:unarmed"],
  "unarmed-attack": ["attack:unarmed"],
  "unarmed-damage": ["damage:unarmed"],
};

/**
 * Foundry's group-scoped strike selectors, which are patterned rather than
 * enumerable: `bow-group-attack-roll`, `crossbow-weapon-group-damage`. Anchored
 * on both ends so only these two exact shapes match.
 *
 * DELIBERATELY NOT EXTENDED TO THE PER-WEAPON TAIL. Foundry also emits
 * `jaws-damage`, `claw-damage`, `fist-damage` and ~50 more of that shape, which a
 * loose `<slug>-damage` pattern would catch — along with `spell-damage`,
 * `damage-received` (INCOMING damage, an entirely different concept),
 * `{item|id}-damage` (a template interpolation, not a slug) and every
 * `*-inline-damage`. Mapping those wrong would put bonuses on the wrong rolls,
 * which is worse than reporting them unsupported. The tail stays named.
 */
const GROUP_SELECTOR_RE = /^([a-z]+)-(?:weapon-)?group-(attack-roll|damage)$/;

/** Look up a Foundry selector name, including the patterned group-scoped forms. */
function mapSelectorName(name: string): readonly Selector[] | undefined {
  const direct = SELECTOR_MAP[name];
  if (direct) return direct;
  const group = GROUP_SELECTOR_RE.exec(name);
  if (group) {
    const [, groupSlug, stat] = group;
    const base = stat === "damage" ? "damage" : "attack";
    return [`${base}:group:${groupSlug}` as Selector];
  }
  return isSkillSlug(name) ? [name] : undefined;
}

/** Foundry bonus types → ours. `proficiency`/`ability` have no equivalent. */
const BONUS_TYPES: ReadonlySet<string> = new Set(["circumstance", "status", "item", "untyped"]);

/** Foundry BaseSpeed selectors → our movement vocabulary. */
const MOVEMENTS: Readonly<Record<string, "land" | "fly" | "swim" | "climb" | "burrow">> = {
  land: "land",
  fly: "fly",
  swim: "swim",
  climb: "climb",
  burrow: "burrow",
};

/**
 * Kinds we recognize but deliberately do not map, each with the blocker that would
 * have to be built first. Naming them explicitly is what turns "unknown-key" noise
 * into an actionable tally — the report can say WHY 949 ItemAlterations are absent.
 */
/**
 * A uuid that is a Foundry data reference rather than a compendium path —
 * `{item|flags.system.rulesSelections.feat}`, `{actor|flags.system.gunslinger.…}`.
 * It names whatever a ChoiceSet earlier on the same item selected, so there is no
 * entity to resolve until that choice is made.
 */
const UNRESOLVED_UUID = /^\{(?:item|actor)\|/;

/** `Compendium.pf2e.<pack>.Item.<Name>` → the pack and the entity name. */
const COMPENDIUM_UUID = /^Compendium\.pf2e\.([a-z0-9-]+)\.Item\.(.+)$/i;

/** True for a plain object — used to read Foundry's open `[field: string]: unknown`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A Foundry entity NAME → our entity id. Our ids are slugified names, so this is a
 * derivation rather than a mapping table — which is what makes it safe: a table would
 * drift silently as content changed, whereas a derivation that fails to find the id
 * simply does not resolve, and the element is reported instead.
 */
function slugifyEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The uuid of a grant → OUR feat id, or null when we cannot confirm one. Only the
 * `feats-srd` pack is resolved: class and ancestry features live in packs whose
 * contents we do not hold as entities (measured: 2/52 and 0/19 resolve), so treating
 * them as feats would manufacture refs to content that does not exist.
 */
function resolveGrantRef(uuid: string, knownFeatIds: ReadonlySet<string>): string | null {
  const m = COMPENDIUM_UUID.exec(uuid);
  if (!m || m[1]!.toLowerCase() !== "feats-srd") return null;
  const id = slugifyEntityName(m[2]!);
  return knownFeatIds.has(id) ? id : null;
}

/** Why a grant did not resolve — named precisely enough to act on. */
function grantDetail(uuid: string, knownFeatIds: ReadonlySet<string>): string {
  if (!uuid) return "grants another item/feat";
  const m = COMPENDIUM_UUID.exec(uuid);
  if (!m) return `grants another item/feat: ${uuid.slice(0, 60)}`;
  const [, pack, name] = m as unknown as [string, string, string];
  if (pack.toLowerCase() !== "feats-srd") return `grants a ${pack} entity we do not hold: ${name.slice(0, 50)}`;
  return knownFeatIds.size === 0
    ? "grants a feat, but no feat vocabulary was supplied to resolve it against"
    : `grants a feat we do not hold: ${name.slice(0, 50)}`;
}

const KNOWN_UNMAPPED: Readonly<Record<string, { reason: UnsupportedReason; detail: string }>> = {
  ItemAlteration: { reason: "needs-item-model", detail: "alters an item's fields" },
  AdjustStrike: { reason: "needs-item-model", detail: "alters a strike" },
  DamageAlteration: { reason: "needs-item-model", detail: "alters damage of an item/strike" },
  Strike: { reason: "needs-item-model", detail: "creates a weapon/strike" },
  DamageDice: { reason: "needs-item-model", detail: "adds damage dice to a strike" },
  CriticalSpecialization: { reason: "needs-item-model", detail: "weapon critical specialization" },
  MartialProficiency: { reason: "needs-item-model", detail: "weapon/armor category proficiency" },
  // Only reached for a uuid that names a STATIC entity — the unresolved-choice form is
  // split off above, since its blocker is the choice rather than the granting.
  GrantItem: { reason: "needs-granting", detail: "grants another item/feat" },
  ChoiceSet: { reason: "needs-runtime-choice", detail: "prompts a selection at choice time" },
  // RollOption is handled by mapRollOption — it produces a ToggleDeclaration, not an effect.
  AdjustModifier: { reason: "unsupported-shape", detail: "retunes another modifier" },
  Aura: { reason: "unsupported-shape", detail: "emanating aura; needs positioning" },
  EphemeralEffect: { reason: "unsupported-shape", detail: "transient effect on another actor" },
  SubstituteRoll: { reason: "unsupported-shape", detail: "replaces a roll (Assurance-like)" },
  RollTwice: { reason: "unsupported-shape", detail: "fortune/misfortune; deferred" },
  MultipleAttackPenalty: { reason: "unsupported-shape", detail: "MAP adjustment" },
  DexterityModifierCap: { reason: "unsupported-shape", detail: "caps Dex to AC" },
  CreatureSize: { reason: "unsupported-shape", detail: "changes size" },
  ActorTraits: { reason: "unsupported-shape", detail: "adds actor traits" },
  CraftingAbility: { reason: "unsupported-shape", detail: "crafting entry" },
  SpecialResource: { reason: "unsupported-shape", detail: "a resource pool; see counters" },
  SpecialStatistic: { reason: "unsupported-shape", detail: "defines a new statistic" },
  FastHealing: { reason: "unsupported-shape", detail: "regeneration/fast healing" },
  TempHP: { reason: "unsupported-shape", detail: "temporary HP is a Layer-2 mutation" },
  TokenLight: { reason: "unsupported-shape", detail: "VTT token presentation" },
  TokenEffectIcon: { reason: "unsupported-shape", detail: "VTT token presentation" },
  TokenImage: { reason: "unsupported-shape", detail: "VTT token presentation" },
  TokenName: { reason: "unsupported-shape", detail: "VTT token presentation" },
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/** A rule element is conditional if it carries a non-empty Foundry predicate. */
function isConditional(rule: RuleElement): boolean {
  return Array.isArray(rule.predicate) && rule.predicate.length > 0;
}

// ---------------------------------------------------------------------------
// Foundry predicates → our tag predicates
// ---------------------------------------------------------------------------
//
// MEASURED over the corpus's 135 AdjustDegreeOfSuccess elements: 34 carry a predicate
// made entirely of leaves we can state. The rest are blocked by `action:` scoping (74
// — Escape, Climb, Subsist; we have no action vocabulary), numeric leaves (`{gte}`,
// `check:roll:total:natural:19` — deliberately outside our tag model), `terrain:`,
// `self:effect:` combat state, and feat-slug flags.
//
// ALL-OR-NOTHING, IN BOTH DIRECTIONS. A predicate maps whole or not at all. Dropping
// a conjunct WIDENS the condition (the effect fires when it should not); dropping a
// disjunct NARROWS it (it fails to fire when it should). Both are wrong sheets, so
// neither is a "safe" partial — an unmappable leaf anywhere refuses the element.
//
// `item:trait:X` BECOMES `effect:trait:X`. In Foundry a save is rolled against an
// item, so `item:` there names the INCOMING effect — the same thing our
// `effect:trait:` scope names, and the same claim our parser makes when it reads
// "against disease effects". That equivalence is checkable rather than assumed: if it
// were wrong, these elements would land as CONFLICTS against the parser's proposals
// rather than corroborating them.

/** A Foundry predicate leaf we can state, or null when we cannot. */
function mapPredicateLeaf(
  leaf: string,
  effectTraits: ReadonlySet<string>,
  producedOptions: ReadonlySet<string>,
): Predicate | null {
  // `item:` in a save/check context is the incoming effect.
  const item = /^item:trait:([a-z][a-z0-9-]*)$/.exec(leaf);
  if (item) return { tag: `effect:trait:${item[1]}` };

  // Scopes that carry across unchanged.
  const scoped = /^(target|origin):trait:([a-z][a-z0-9-]*)$/.exec(leaf);
  if (scoped) return { tag: `${scoped[1]}:trait:${scoped[2]}` };

  // Foundry's "this effect would inflict <condition>" — our `effect:causes:`.
  const inflicts = /^inflicts:([a-z][a-z0-9-]*)$/.exec(leaf);
  if (inflicts) return { tag: `effect:causes:${inflicts[1]}` };

  // `action:trait:X` is a filter OVER actions ("any action with the downtime
  // trait"), not an action name — checked BEFORE `action:` so the slug arm below
  // never sees a leaf whose second segment is `trait`.
  const actionTrait = /^action:trait:([a-z][a-z0-9-]*)$/.exec(leaf);
  if (actionTrait) {
    return effectTraits.has(actionTrait[1]!) ? { tag: `action:trait:${actionTrait[1]}` } : null;
  }

  // `action:demoralize` — the action being performed. Confirmed against the action
  // vocabulary for the same reason the bare-trait arm below confirms against
  // `effectTraits`: Foundry's action slugs include feat-granted actions (Battle
  // Medicine, Scare to Death) and creature abilities (`swallow-whole`) that our
  // vocabulary does not name, and inventing a tag for one produces a condition
  // nothing can ever satisfy.
  //
  // Trailing segments are REFUSED, not truncated. The corpus has 10 such leaves —
  // `action:perform:keyboards`, `action:administer-first-aid:stabilize` — where the
  // segment names a VARIANT of the action. Mapping those to bare `action:perform`
  // would widen a keyboards-only bonus to every Perform, which is the wrong-sheet
  // bug this boundary exists to prevent.
  const action = /^action:([a-z][a-z0-9-]*)$/.exec(leaf);
  if (action) return isActionSlug(action[1]) ? { tag: `action:${action[1]}` } : null;

  // A PRODUCED OPTION — a tag some RollOption in the corpus asserts (`spellshape`,
  // `spellshape:reach-spell`, `deflecting-wave:acid`). This is the consumer side of the
  // toggle work: a feat that predicates on `reveal-beasts` is mappable precisely because
  // another element produces that tag. Confirmed against the collected producer set for
  // the same reason as `effectTraits` — a leaf nothing produces is a condition that can
  // never fire, so an unproduced option is refused, not guessed. Kept verbatim as the
  // tag (`{tag: leaf}`), which is exactly what `toggleTags` emits. Checked BEFORE the
  // bare-trait fallback because an option and a trait can share a bare slug, and when
  // the slug is a produced option the raw tag is the correct reading.
  if (producedOptions.has(leaf)) return { tag: leaf };

  // A BARE string is a roll option, and most of them are not traits at all (feat
  // slugs, action names, flags). Only accept one the caller's vocabulary confirms is
  // a real effect trait — the same discipline prose.ts applies, and for the same
  // reason: a guessed trait produces a condition that can never fire.
  if (/^[a-z][a-z0-9-]*$/.test(leaf) && effectTraits.has(leaf)) {
    return { tag: `effect:trait:${leaf}` };
  }
  return null;
}

/**
 * A Foundry predicate (an implicit AND of leaves and operators) → our `Predicate`,
 * or null when any part of it is beyond our vocabulary.
 */
function mapPredicate(
  pred: unknown,
  effectTraits: ReadonlySet<string>,
  producedOptions: ReadonlySet<string>,
): Predicate | null {
  if (typeof pred === "string") return mapPredicateLeaf(pred, effectTraits, producedOptions);

  // A Foundry predicate array is a conjunction.
  if (Array.isArray(pred)) {
    const parts: Predicate[] = [];
    for (const p of pred) {
      const mapped = mapPredicate(p, effectTraits, producedOptions);
      if (!mapped) return null;
      parts.push(mapped);
    }
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0]! : { all: parts };
  }

  if (pred && typeof pred === "object") {
    const keys = Object.keys(pred as Record<string, unknown>);
    if (keys.length !== 1) return null;
    const [op] = keys as [string];
    const body = (pred as Record<string, unknown>)[op];

    if (op === "and" || op === "or") {
      if (!Array.isArray(body)) return null;
      const parts: Predicate[] = [];
      for (const p of body) {
        const mapped = mapPredicate(p, effectTraits, producedOptions);
        if (!mapped) return null;
        parts.push(mapped);
      }
      if (parts.length === 0) return null;
      if (parts.length === 1) return parts[0]!;
      return op === "and" ? { all: parts } : { any: parts };
    }

    if (op === "not") {
      const inner = mapPredicate(body, effectTraits, producedOptions);
      return inner ? { not: inner } : null;
    }

    // `nor`, `gte`, `lt`, `xor`… — numeric comparisons are outside our tag model by
    // design, and `nor` is expressible but absent from the corpus, so it stays
    // unmapped rather than shipped untested.
    return null;
  }

  return null;
}

/**
 * Foundry's `{item|…}` / `{actor|…}` interpolation, which resolves against a chosen
 * option or their actor data. We cannot resolve either at ingest, and mapping their
 * data paths would import their actor schema — precisely the coupling this boundary
 * exists to prevent.
 */
function isInterpolated(v: unknown): boolean {
  return typeof v === "string" && /\{(?:item|actor|rule|weapon|spell)\|/.test(v);
}

/** Normalize a Foundry field that may be a single value or an array. */
function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

class MapError extends Error {
  constructor(readonly reason: UnsupportedReason, readonly detail: string) {
    super(detail);
  }
}

/**
 * A Foundry value → our expression AST. Numbers pass through as literals; strings go
 * through the shared bounded parser (which accepts `@actor.level` and rejects every
 * other @-ref by design). Nothing is evaluated — there is no character here.
 */
function toExpr(v: unknown): Expr {
  if (typeof v === "number") return { kind: "lit", value: v };
  if (isInterpolated(v)) throw new MapError("needs-runtime-choice", `interpolated value ${JSON.stringify(v)}`);
  if (typeof v !== "string") throw new MapError("unsupported-value", `value ${JSON.stringify(v)}`);
  try {
    return parseExpr(v.trim());
  } catch {
    // Deep Foundry data refs (`@actor.system.proficiencies…`) and infix arithmetic
    // (`floor(@actor.level/2)`) both land here. The first we will never map — it is
    // their actor schema. The second is ours to unlock by widening expr.ts's grammar.
    throw new MapError("unsupported-value", `unparseable value ${JSON.stringify(v)}`);
  }
}

/** An integer proficiency rank 0–4, or throw. */
function toRank(v: unknown): 0 | 1 | 2 | 3 | 4 {
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < 0 || n > 4) throw new MapError("unsupported-value", `rank ${JSON.stringify(v)}`);
  return n as 0 | 1 | 2 | 3 | 4;
}

// ---------------------------------------------------------------------------
// per-kind mappers — each returns the effects for ONE element, or throws MapError
// ---------------------------------------------------------------------------

function mapFlatModifier(rule: RuleElement): PassiveEffect[] {
  const rawType = rule.type === undefined ? "untyped" : String(rule.type);
  if (!BONUS_TYPES.has(rawType)) throw new MapError("unsupported-bonus-type", `type "${rawType}"`);
  const bonusType = rawType as "circumstance" | "status" | "item" | "untyped";

  const targets: Selector[] = [];
  for (const raw of toArray(rule.selector)) {
    const name = String(raw);
    const mapped = mapSelectorName(name);
    if (!mapped) throw new MapError("unsupported-selector", `selector "${name}"`);
    targets.push(...mapped);
  }
  if (targets.length === 0) throw new MapError("unsupported-shape", "no selector");

  const value = toExpr(rule.value);
  return targets.map((target) => ({ kind: "modifier", target, bonusType, value }) as PassiveEffect);
}

// ---------------------------------------------------------------------------
// AdjustDegreeOfSuccess
// ---------------------------------------------------------------------------
//
// Foundry's shape, READ OFF THE CORPUS rather than recalled:
//
//   { key: "AdjustDegreeOfSuccess", selector: "saving-throw",
//     adjustment: { success: "one-degree-better" }, predicate: ["visual"] }
//
// The `adjustment` map is keyed by the INCOMING degree, which is what makes every
// instruction resolvable to an absolute target: "one-degree-better" is ambiguous on
// its own, but "one-degree-better FROM a success" is exactly `critical-success`. So
// this needs no shift-vs-absolute compromise — both of Foundry's styles land in our
// `degreeMap` without approximating anything.
//
// Observed keys: success (92), criticalFailure (44), all (11), failure (6).
// Observed instructions: one-degree-better (123), to-critical-success (16),
// to-success (7), to-failure (4), one-degree-worse (2), two-degrees-worse (1).

const FOUNDRY_DEGREE: Readonly<Record<string, DegreeOfSuccess>> = {
  criticalFailure: "critical-failure",
  failure: "failure",
  success: "success",
  criticalSuccess: "critical-success",
};

/** Instructions that name an absolute result, whatever was rolled. */
const DEGREE_ABSOLUTE: Readonly<Record<string, DegreeOfSuccess>> = {
  "to-critical-failure": "critical-failure",
  "to-failure": "failure",
  "to-success": "success",
  "to-critical-success": "critical-success",
};

/** Instructions that name a shift RELATIVE to the incoming degree. */
const DEGREE_SHIFT: Readonly<Record<string, number>> = {
  "one-degree-better": 1,
  "two-degrees-better": 2,
  "one-degree-worse": -1,
  "two-degrees-worse": -2,
};

function mapAdjustDegreeOfSuccess(
  rule: RuleElement,
  effectTraits: ReadonlySet<string>,
  producedOptions: ReadonlySet<string>,
): PassiveEffect[] {
  const targets: Selector[] = [];
  for (const raw of toArray(rule.selector)) {
    const name = String(raw);
    const mapped = mapSelectorName(name);
    if (!mapped) throw new MapError("unsupported-selector", `selector "${name}"`);
    targets.push(...mapped);
  }
  if (targets.length === 0) throw new MapError("unsupported-shape", "no selector");

  const adjustment = rule.adjustment as Record<string, unknown> | undefined;
  if (!adjustment || typeof adjustment !== "object") {
    throw new MapError("unsupported-shape", "no adjustment map");
  }

  const map: Partial<Record<DegreeOfSuccess, DegreeOfSuccess>> = {};
  for (const [rawFrom, rawInstruction] of Object.entries(adjustment)) {
    const instruction = String(rawInstruction);
    // `all` applies the instruction to every incoming degree — expanded here, which
    // is faithful rather than approximate: our map has no "any degree" key, and
    // writing out the four cases says exactly the same thing.
    const froms = rawFrom === "all" ? DEGREES : [FOUNDRY_DEGREE[rawFrom]];
    for (const from of froms) {
      if (!from) throw new MapError("unsupported-shape", `degree "${rawFrom}"`);
      let to: DegreeOfSuccess | undefined = DEGREE_ABSOLUTE[instruction];
      if (!to) {
        const steps = DEGREE_SHIFT[instruction];
        if (steps === undefined) throw new MapError("unsupported-shape", `adjustment "${instruction}"`);
        to = shiftDegree(from, steps);
      }
      // A rewrite to the degree already rolled says nothing. Clamping makes these
      // real: "one degree better" from a critical success, or `all` + a fixed target
      // covering the degree that target already is.
      if (to !== from) map[from] = to;
    }
  }

  if (Object.keys(map).length === 0) throw new MapError("unsupported-shape", "adjustment rewrites nothing");

  // The predicate was already checked as mappable by the caller; re-map it here so
  // the effect carries it. A conditional degree rewrite shipped unconditional would
  // be the wrong-sheet bug this boundary exists to prevent.
  const when = isConditional(rule) ? mapPredicate(rule.predicate, effectTraits, producedOptions) : null;
  if (isConditional(rule) && !when) throw new MapError("needs-combat-tags", "unmappable predicate");

  return targets.map(
    (target) =>
      ({
        kind: "rollAdjust",
        target,
        adjust: { type: "degreeMap", map: { ...map } },
        ...(when ? { when } : {}),
      }) as PassiveEffect,
  );
}

// ---------------------------------------------------------------------------
// narrowing a broadcast skill fan-out by the action its predicate names
// ---------------------------------------------------------------------------
//
// Foundry's `skill-check` selector means "any skill check", and we faithfully fan it
// out to all 16 skills. That was invisible while conditional elements were refused
// outright; once they map, it produces noise. Sturdy Bindings ("when you roll a
// critical failure on a check to Grapple") became 16 effects — including one telling
// the sheet that ARCANA improves when Grappling.
//
// Nothing there is arithmetically wrong: `action:grapple` is never asserted next to
// an Arcana roll, so the other 15 can never fire. But a sheet that lists "Arcana: +1
// when Grappling" is misleading to read, and 67 corpus elements do this — 1,072
// effects where ~100 say the same thing. Inert clutter is still a wrong sheet.
//
// So: when the predicate positively names skill actions, narrow a FANNED-OUT skill
// target list to the skills those actions actually use. This is the one place the
// action→skill map does real work at ingest.
//
// THREE GUARDS, each preventing a way this could silently lose a real effect:
//   • NEGATION DISQUALIFIES. `not: action:grapple` means "every skill check EXCEPT
//     Grapple" — narrowing to Athletics would invert the meaning and drop the 15
//     skills where the effect genuinely applies.
//   • A NON-SKILL ACTION DISQUALIFIES. Escape is a basic action our source assigns no
//     skill; there is nothing to narrow to, and guessing Athletics would be a rules
//     claim.
//   • ONLY FAN-OUTS ARE NARROWED. An element that explicitly targets one skill is
//     left alone even if it disagrees with the map — that is a content question, and
//     dropping it here would hide it.
function positiveActionSkills(pred: Predicate | null): ReadonlySet<string> | null {
  if (!pred) return null;
  const skills = new Set<string>();
  let sawAction = false;
  let disqualified = false;

  const walk = (p: Predicate, negated: boolean): void => {
    if (disqualified) return;
    if ("tag" in p) {
      const m = /^action:([a-z][a-z0-9-]*)$/.exec(p.tag);
      if (!m) return;
      sawAction = true;
      if (negated || !isSkillAction(m[1])) {
        disqualified = true;
        return;
      }
      for (const s of ACTION_SKILLS[m[1]]) skills.add(s);
      return;
    }
    if ("not" in p) return walk(p.not, !negated);
    if ("all" in p) return p.all.forEach((c) => walk(c, negated));
    if ("any" in p) return p.any.forEach((c) => walk(c, negated));
  };
  walk(pred, false);

  if (!sawAction || disqualified || skills.size === 0) return null;
  return skills;
}

/**
 * Drop the skills a broadcast `skill-check` fan-out reached that the predicate's
 * action cannot actually be attempted with. A no-op unless the effect list holds
 * MORE THAN ONE skill target — see the guards above.
 */
function narrowFannedSkillTargets(produced: PassiveEffect[], when: Predicate | null): PassiveEffect[] {
  const skills = positiveActionSkills(when);
  if (!skills) return produced;

  const isSkillTarget = (e: PassiveEffect): boolean => "target" in e && isSkillSlug(e.target);
  if (produced.filter(isSkillTarget).length <= 1) return produced;

  const kept = produced.filter((e) => !isSkillTarget(e) || skills.has((e as { target: string }).target));
  // Defensive: an action whose only skill is an (unenumerable) lore would narrow to
  // nothing. Keeping the fan-out beats silently producing no effect at all.
  return kept.some(isSkillTarget) ? kept : produced;
}

// ---------------------------------------------------------------------------
// RollOption → ToggleDeclaration
// ---------------------------------------------------------------------------
//
// The other side of the predicate work: these elements PRODUCE a tag rather than being
// gated by one, which is why they sat in `needs-combat-tags` without the gate ever being
// their blocker. See toggles.ts for the three mechanisms Foundry packs into this one key;
// this maps the two that are declarative and defers the third.
//
// A Foundry LABEL IS USUALLY NOT TEXT. 460 of the corpus's 593 are localization keys
// (`PF2E.TraitAcid`), so `humanLabel` keeps only what is already human-readable. Passing
// an i18n key through would print `PF2E.TraitAcid` on a character sheet.
/**
 * Whether a string is one of Foundry's i18n KEYS rather than prose — `PF2E.TraitAcid`,
 * `PF2E.SpecificRule.Dwarf.RockRunner.Note`, or a SCREAMING.DOTTED.KEY. The text these
 * name lives in Foundry's `lang/*.json`, which we do not ingest, so a key is never
 * something we can show a player.
 *
 * ONE implementation, used by every caller that faces the question. `humanLabel` had it
 * inline and `mapNote` did not have it at all — which shipped 37 of the corpus's 43
 * notes carrying a raw key as their body.
 */
function isLocalizationKey(v: string): boolean {
  return /^PF2E\./.test(v) || /^[A-Z0-9_]+(\.[A-Z0-9_]+)+$/.test(v);
}

function humanLabel(v: unknown): string | undefined {
  if (typeof v !== "string" || v === "") return undefined;
  if (isLocalizationKey(v)) return undefined;
  return v;
}

function mapRollOption(
  rule: RuleElement,
  effectTraits: ReadonlySet<string>,
  producedOptions: ReadonlySet<string>,
): ToggleDeclaration {
  const option = String(rule.option ?? "");
  if (!option) throw new MapError("unsupported-shape", "no option");

  // `breath-of-the-dragon:{actor|flags.system.dragonblood.shape}` — the tag's own NAME
  // depends on Foundry actor data we do not carry. Mapping it would produce a tag no
  // predicate could ever match.
  if (isInterpolated(option)) {
    throw new MapError("needs-runtime-choice", `option interpolates: ${option.slice(0, 60)}`);
  }

  const toggleable = rule.toggleable === true || rule.toggleable === "totm";

  // A NON-toggleable predicated option is a DERIVED tag — asserted because other tags
  // are, e.g. Disarming Flair giving your Disarm the `bravado` trait. That is a tag
  // depending on a tag, which needs evaluation ordering `predicate.ts` does not have.
  // Deferred deliberately, and reported as such rather than shipped as a player toggle
  // the player would have to know to flip. (An `alwaysActive` predicated option is NOT
  // this — its predicate is an availability condition, handled below.)
  if (!toggleable && rule.alwaysActive !== true && isConditional(rule)) {
    throw new MapError("needs-combat-tags", `derived tag (asserted by predicate), not a toggle`);
  }

  // Foundry places a NON-toggleable option on the actor unconditionally, so it is
  // always on — the player has no switch for it. `alwaysActive` says the same
  // explicitly. Only a `toggleable` option is a player-flippable switch that defaults
  // off. (A bare `{option}` with neither flag is therefore a constant tag, not a
  // dormant toggle that never fires.)
  const alwaysOn = rule.alwaysActive === true || !toggleable;

  const decl: ToggleDeclaration = { option };

  const label = humanLabel(rule.label);
  if (label) decl.label = label;
  if (alwaysOn) decl.alwaysOn = true;

  // Availability. Unmappable means we cannot say WHEN the switch is offered, and an
  // always-offered switch the character has not qualified for is a wrong sheet.
  if (isConditional(rule)) {
    const when = mapPredicate(rule.predicate, effectTraits, producedOptions);
    if (!when) {
      throw new MapError("needs-combat-tags", `unmappable availability: ${JSON.stringify(rule.predicate).slice(0, 90)}`);
    }
    decl.when = when;
  }

  // Suboptions come in two shapes. The ARRAY form is a fixed variant list and maps. The
  // OBJECT form (`{config: "skills", predicate: ["skill:{choice|value}:rank:0"]}`) asks
  // the sheet to enumerate a config list at render time and interpolates the choice back
  // into a predicate — a runtime choice, not a fixed set.
  if (rule.suboptions !== undefined) {
    if (!Array.isArray(rule.suboptions)) {
      throw new MapError("needs-runtime-choice", "config-driven suboptions (enumerated at render)");
    }
    const variants: ToggleVariant[] = [];
    for (const raw of rule.suboptions) {
      if (!isRecord(raw)) throw new MapError("unsupported-shape", "malformed suboption");
      const value = String(raw.value ?? "");
      if (!value) throw new MapError("unsupported-shape", "suboption without a value");
      const variant: ToggleVariant = { value };
      const vLabel = humanLabel(raw.label);
      if (vLabel) variant.label = vLabel;
      if (Array.isArray(raw.predicate) && raw.predicate.length) {
        const vWhen = mapPredicate(raw.predicate, effectTraits, producedOptions);
        if (!vWhen) {
          throw new MapError("needs-combat-tags", `unmappable variant availability on "${value}"`);
        }
        variant.when = vWhen;
      }
      variants.push(variant);
    }
    if (variants.length) decl.variants = variants;
  }

  return toggleDeclarationSchema.parse(decl);
}

/** Foundry writes proficiency ranks as ActiveEffectLike paths into their actor data. */
const RANK_PATHS: readonly { re: RegExp; selector: (m: RegExpMatchArray) => string }[] = [
  { re: /^system\.skills\.([a-z]+)\.rank$/, selector: (m) => m[1]! },
  { re: /^system\.saves\.(fortitude|reflex|will)\.rank$/, selector: (m) => m[1]! },
  { re: /^system\.(?:attributes\.)?perception\.rank$/, selector: () => "perception" },
];

function mapActiveEffectLike(rule: RuleElement): PassiveEffect[] {
  const path = String(rule.path ?? "");
  let selector: string | undefined;
  for (const p of RANK_PATHS) {
    const m = path.match(p.re);
    if (m) {
      selector = p.selector(m);
      break;
    }
  }
  // Everything else writes into Foundry's own actor data (`flags.system.*`,
  // `system.details.*`). Mapping those would mean adopting their actor schema.
  if (selector === undefined) throw new MapError("unsupported-selector", `path "${path}"`);
  if (!isSelector(selector)) throw new MapError("unsupported-selector", `selector "${selector}"`);

  const mode = String(rule.mode ?? "");
  // `upgrade` = "at least this rank"; `override` = "exactly this rank". `add` is
  // arithmetic on a rank, which our upgrade/set model has no equivalent for.
  const ourMode = mode === "upgrade" ? "upgrade" : mode === "override" ? "set" : undefined;
  if (!ourMode) throw new MapError("unsupported-shape", `mode "${mode}" on a rank path`);

  if (isInterpolated(rule.value)) throw new MapError("needs-runtime-choice", `interpolated rank`);
  return [{ kind: "proficiency", target: selector, rank: toRank(rule.value), mode: ourMode }];
}

// ---------------------------------------------------------------------------
// choice groups — a ChoiceSet plus the rank grants its flag drives
// ---------------------------------------------------------------------------
//
// Foundry expresses "a proficiency you choose" as string substitution: a ChoiceSet
// stores a selection under a flag, and an ActiveEffectLike interpolates that flag
// into its `path` (or IS the path). Reading that at runtime means shipping their
// template engine; instead we enumerate the options here, once, and attach finished
// effects to each. 30 feats in the corpus (Canny Acumen, Skill Training, Clan Lore…).
//
// ONE RULE COVERS ALMOST ALL OF IT: substitute the selection into the AEL's path,
// then resolve the result as a rank path. That single rule absorbs what look like
// three different shapes, because Foundry's own mechanism IS substitution:
//
//   Canny Acumen   path `{item|…cannyAcumen}` + value `system.saves.fortitude.rank`
//                  → `system.saves.fortitude.rank`      → fortitude
//   Fighter Ded.   path `system.skills.{item|…}.rank`  + value `acrobatics`
//                  → `system.skills.acrobatics.rank`    → acrobatics
//   Skill Training the same, with `{config:'skills'}` standing in for all 16 slugs
//
// An option whose substitution doesn't resolve to a stat we apply is DROPPED, which
// is what makes the rule safe to apply broadly: Fighter Dedication's second
// ChoiceSet picks an attribute ("str"), substitutes to a path that is not a rank,
// and simply yields no option rather than a dead dropdown.
//
// The one genuine exception is NESTED-FIELD selections (Clan Lore), where the path
// reads a SUB-field of the chosen object (`…{item|…clan.skillOne}.rank`) — there the
// option is an object, not the substituted value, so it is handled separately.

/** `{item|flags.system.rulesSelections.<flag>}` — with an optional `.subfield`. */
const SELECTION_REF = /\{item\|flags\.system\.rulesSelections\.([a-zA-Z]+)(?:\.([a-zA-Z]+))?\}/;

/** Title-case a slug for display: "athletics" → "Athletics". */
const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A rank path → our selector, or undefined when it is not one we apply. */
function selectorForRankPath(path: string): Selector | undefined {
  for (const p of RANK_PATHS) {
    const m = path.match(p.re);
    if (m) {
      const sel = p.selector(m);
      if (isSelector(sel)) return sel;
    }
  }
  return undefined;
}

/**
 * The rank an AEL writes: a literal 0–4, or an EXPRESSION for a level-scaled rank
 * (Canny Acumen's `ternary(gte(@actor.level,17),3,2)` — expert, master at 17th).
 * Throws a MapError naming the blocker when it is neither.
 */
function rankGrantFor(rule: RuleElement): { rank: RankValue; mode: "upgrade" | "set" } {
  const mode = String(rule.mode ?? "");
  const ourMode = mode === "upgrade" ? "upgrade" : mode === "override" ? "set" : undefined;
  if (!ourMode) throw new MapError("unsupported-shape", `mode "${mode}" on a rank path`);
  const raw = rule.value;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (Number.isInteger(n) && n >= 0 && n <= 4) return { rank: n as 0 | 1 | 2 | 3 | 4, mode: ourMode };
  // Not a literal — the value must be an expression we can evaluate per character.
  // `toExpr` rejects Foundry's own actor/item refs, which stay unmappable.
  return { rank: toExpr(raw), mode: ourMode };
}

/**
 * Resolve every choice-driven rank grant in `rules`. Returns the authored choices
 * plus `consumed`: element index → how many choices it contributed to, so the
 * per-element report can mark exactly those as mapped.
 *
 * Anything that doesn't fit one of the three shapes is simply not consumed — it
 * falls through to the normal pass and is reported unsupported there. A dropdown
 * whose selection would silently do nothing is worse than no dropdown.
 */
function mapChoiceGroups(rules: readonly RuleElement[]): {
  choices: EffectChoice[];
  consumed: Map<number, number>;
  blocked: Map<number, { reason: UnsupportedReason; detail: string }>;
} {
  const choices: EffectChoice[] = [];
  const consumed = new Map<number, number>();
  const blocked = new Map<number, { reason: UnsupportedReason; detail: string }>();

  rules.forEach((choiceSet, csIndex) => {
    if (String(choiceSet?.key ?? "") !== "ChoiceSet") return;
    const flag = typeof choiceSet.flag === "string" ? choiceSet.flag : undefined;
    if (!flag) return;

    // The AEL(s) this flag drives, with the sub-field (if any) each one reads.
    const driven: { index: number; rule: RuleElement; subfield?: string }[] = [];
    rules.forEach((rule, index) => {
      if (String(rule?.key ?? "") !== "ActiveEffectLike") return;
      const path = typeof rule.path === "string" ? rule.path : "";
      const m = SELECTION_REF.exec(path);
      if (!m || m[1] !== flag) return;
      driven.push({ index, rule, ...(m[2] ? { subfield: m[2] } : {}) });
    });
    if (driven.length === 0) return; // not a rank-driving ChoiceSet; leave it alone

    const groupIndices = [csIndex, ...driven.map((d) => d.index)];
    try {
      const options: EffectChoiceOption[] = [];
      let prompt = "Choice";
      const rawChoices = choiceSet.choices;

      // ── shape 3: nested sub-field selections (Clan Lore) ────────────────────
      const subfields = driven.filter((d) => d.subfield !== undefined);
      if (subfields.length > 0 && Array.isArray(rawChoices)) {
        prompt = "Trains";
        const seen = new Set<string>();
        for (const c of rawChoices as { value?: unknown }[]) {
          const val = c?.value;
          if (!val || typeof val !== "object") continue;
          const picked: { slug: string; rank: RankValue; mode: "upgrade" | "set" }[] = [];
          for (const d of subfields) {
            const slug = (val as Record<string, unknown>)[d.subfield!];
            if (typeof slug !== "string" || !isSkillSlug(slug)) continue;
            const grant = rankGrantFor(d.rule);
            picked.push({ slug, ...grant });
          }
          if (!picked.length) continue;
          // The stored value is OUR vocabulary — the skill ids, comma-joined.
          const value = picked.map((p) => p.slug).join(",");
          if (seen.has(value)) continue;
          seen.add(value);
          options.push({
            value,
            label: picked.map((p) => titleCase(p.slug)).join(", "),
            effects: picked.map((p) => ({ kind: "proficiency", target: p.slug as Selector, rank: p.rank, mode: p.mode })),
          });
        }
      } else {
        // ── the substitution rule: selection → into the path → a rank path ────
        const { rule, index: _i } = driven[0]!;
        void _i;
        const path = typeof rule.path === "string" ? rule.path : "";
        const refRe = new RegExp(`\\{item\\|flags\\.system\\.rulesSelections\\.${flag}\\}`, "g");
        const targetFor = (selection: string): Selector | undefined =>
          selectorForRankPath(path.replace(refRe, selection));

        // The candidate selections: an explicit list, or a `config` shorthand for a
        // whole vocabulary. Anything else (weapons, itemType filters) isn't a rank.
        let selections: string[] | undefined;
        if (Array.isArray(rawChoices)) {
          selections = (rawChoices as { value?: unknown }[])
            .map((c) => c?.value)
            .filter((v): v is string => typeof v === "string");
        } else if (rawChoices && typeof rawChoices === "object") {
          const config = (rawChoices as { config?: unknown }).config;
          if (config === "skills") selections = [...SKILL_SLUGS];
          else if (config === "saves") selections = [...SAVE_SELECTORS];
        }
        if (!selections?.length) return;

        const grant = rankGrantFor(rule);
        const seen = new Set<string>();
        for (const selection of selections) {
          const target = targetFor(selection);
          if (!target || seen.has(target)) continue; // unmappable → omitted, not a dead entry
          seen.add(target);
          options.push({
            value: target,
            label: titleCase(target),
            effects: [{ kind: "proficiency", target, rank: grant.rank, mode: grant.mode }],
          });
        }
        // Name the prompt after what it actually offers.
        prompt = options.every((o) => isSkillSlug(o.value)) ? "Skill" : "Proficiency";
      }

      if (options.length === 0) return;
      choices.push({ flag, prompt, options });
      // Credit the ChoiceSet and every AEL it drives, so the report marks them mapped.
      for (const i of groupIndices) consumed.set(i, (consumed.get(i) ?? 0) + 1);
    } catch (e) {
      // The group IS a choice-driven rank grant, but something in it is beyond the
      // model. Report the real blocker on every element of the group rather than
      // letting them fall through to the generic `needs-runtime-choice`, which would
      // hide a tracked roadmap item behind an untracked one.
      const b =
        e instanceof MapError
          ? { reason: e.reason, detail: e.detail }
          : { reason: "unsupported-shape" as UnsupportedReason, detail: `choice mapper threw: ${String(e)}` };
      for (const i of groupIndices) blocked.set(i, b);
    }
  });

  return { choices, consumed, blocked };
}

function mapNote(rule: RuleElement): PassiveEffect[] {
  // A Foundry Note bound to specific degrees is a degree-conditional display; our
  // `note` has no outcome field, so mapping it would drop the condition silently.
  if (toArray(rule.outcome).length > 0) throw new MapError("unsupported-shape", "degree-scoped note");
  const text = String(rule.text ?? "");
  if (!text) throw new MapError("unsupported-shape", "empty note text");
  if (isInterpolated(text)) throw new MapError("needs-runtime-choice", "interpolated note text");
  // `@Localize[…]` / `@UUID[…]` are Foundry content references, not text we own.
  if (/@(?:Localize|UUID|Compendium)\[/.test(text)) {
    throw new MapError("unsupported-value", "note text is a Foundry content reference");
  }
  // A bare key is the SAME category as the guard above — a reference to text living in
  // Foundry's `lang/*.json`, which we do not ingest — but it carries no `@Localize[…]`
  // wrapper, so it slipped straight through. That shipped 37 of the corpus's 43 notes
  // with an unresolved key as their body: a sheet rendering the literal string
  // "PF2E.SpecificRule.Hobgoblin.AgonizingRebuke.Note" to a player. Refusing them is
  // the mapper's own rule — an effect we can stand behind, or a named blocker.
  if (isLocalizationKey(text)) {
    throw new MapError("unsupported-value", "note text is an unresolved localization key");
  }

  const targets: Selector[] = [];
  for (const raw of toArray(rule.selector)) {
    const name = String(raw);
    const mapped = mapSelectorName(name);
    if (!mapped) throw new MapError("unsupported-selector", `selector "${name}"`);
    targets.push(...mapped);
  }
  if (targets.length === 0) throw new MapError("unsupported-shape", "no selector");
  return targets.map((target) => ({ kind: "note", target, text }) as PassiveEffect);
}

function mapResistanceLike(rule: RuleElement, type: "resistance" | "weakness"): PassiveEffect[] {
  const types = toArray(rule.type);
  if (types.length === 0) throw new MapError("unsupported-shape", "no damage type");
  if (rule.definition !== undefined) throw new MapError("unsupported-shape", "definition-based resistance");
  if (rule.doubleVs !== undefined) throw new MapError("unsupported-shape", "doubleVs resistance");

  const value = toExpr(rule.value);
  const exceptions = toArray(rule.exceptions).map((e) => String(e));
  return types.map((raw) => {
    if (isInterpolated(raw)) throw new MapError("needs-runtime-choice", "chosen damage type");
    const grant: Grant =
      type === "resistance"
        ? { type: "resistance", damageType: String(raw), value, ...(exceptions.length ? { exceptions } : {}) }
        : { type: "weakness", damageType: String(raw), value };
    return { kind: "grant", grant } as PassiveEffect;
  });
}

function mapImmunity(rule: RuleElement): PassiveEffect[] {
  const types = toArray(rule.type);
  if (types.length === 0) throw new MapError("unsupported-shape", "no immunity type");
  return types.map((raw) => {
    if (isInterpolated(raw)) throw new MapError("needs-runtime-choice", "chosen immunity type");
    return { kind: "grant", grant: { type: "immunity", to: String(raw) } } as PassiveEffect;
  });
}

function mapSense(rule: RuleElement): PassiveEffect[] {
  const name = String(rule.selector ?? "");
  if (!name) throw new MapError("unsupported-shape", "no sense selector");
  if (isInterpolated(name)) throw new MapError("needs-runtime-choice", "chosen sense");
  const acuity = rule.acuity === undefined ? undefined : String(rule.acuity);
  if (acuity !== undefined && !["precise", "imprecise", "vague"].includes(acuity)) {
    throw new MapError("unsupported-shape", `acuity "${acuity}"`);
  }
  // A sense's range is a fixed number on the model (senses are not level-scaled in
  // the corpus); a non-numeric range is reported rather than coerced.
  let range: number | undefined;
  if (rule.range !== undefined) {
    const n = typeof rule.range === "number" ? rule.range : Number(String(rule.range).trim());
    if (!Number.isInteger(n) || n < 0) throw new MapError("unsupported-value", `range ${JSON.stringify(rule.range)}`);
    range = n;
  }
  return [
    {
      kind: "grant",
      grant: {
        type: "sense",
        name,
        ...(range !== undefined ? { range } : {}),
        ...(acuity !== undefined ? { acuity: acuity as "precise" | "imprecise" | "vague" } : {}),
      },
    } as PassiveEffect,
  ];
}

function mapBaseSpeed(rule: RuleElement): PassiveEffect[] {
  const raw = String(rule.selector ?? "").replace(/-speed$/, "");
  const movement = MOVEMENTS[raw];
  if (!movement) throw new MapError("unsupported-selector", `speed "${rule.selector}"`);
  return [{ kind: "grant", grant: { type: "speed", movement, value: toExpr(rule.value) } } as PassiveEffect];
}

// ---------------------------------------------------------------------------
// the adapter
// ---------------------------------------------------------------------------

/**
 * Map one entity's Foundry `rules[]` into our `PassiveEffect[]`, plus a per-element
 * report of what happened and why.
 *
 * Every element produces exactly one report entry, so `report.length === rules.length`
 * ALWAYS — nothing can fall through silently. That invariant is the whole point: the
 * old `collectSheetEffects` counted only the kinds it recognized as sheet-relevant,
 * so ~70% of the corpus vanished without a trace and its `skipped` count read as far
 * better coverage than it was.
 *
 * Conditional elements are reported, never mapped-with-the-condition-dropped: our
 * `when?` predicate is a static tag tree today (doc decision 3), and Foundry's
 * predicates lean on combat state (`self:effect:rage`, `target:trait:undead`) and on
 * numeric leaves our tag model deliberately excludes. Silently dropping a condition
 * would turn a situational bonus into a permanent one — a wrong sheet, which is worse
 * than an absent effect.
 */
export interface FoundryMapOptions {
  /**
   * Traits an EFFECT can carry, used to decide whether a BARE Foundry roll option is
   * a trait at all. Passed in rather than hardcoded for the same reason prose.ts takes
   * it: the trait list is game CONTENT, the caller already holds the corpus, and a
   * constant here would drift. Empty (the default) means no bare option is read as a
   * trait, which is the honest reading when we have no vocabulary to check against.
   */
  effectTraits?: ReadonlySet<string>;
  /**
   * The ids of feats we actually HOLD, so a grant can be resolved to one of ours.
   * Passed in for the same reason as `effectTraits` — it is content, and the caller
   * holds the corpus.
   *
   * WITHOUT IT, NO GRANT MAPS, and that default is deliberate. A `ref` we cannot
   * confirm is a dangling pointer into content that may not exist, which is strictly
   * worse than an honest `unsupported`. Measured 2026-07-19: 242/242 feat grants
   * resolve against our feats, but only 8/180 ACTION grants do — so a mapper that
   * trusted the uuid would have emitted 172 refs to nothing. Coverage tracking the
   * dataset means an actions dataset later starts resolving with no mapper change.
   */
  knownFeatIds?: ReadonlySet<string>;
  /**
   * The tag options PRODUCED by RollOptions across the corpus (base + variant forms,
   * e.g. `spellshape` and `spellshape:reach-spell`). Passed in for the same reason as
   * `effectTraits`: a consumer's predicate that reads `spellshape:reach-spell` is only
   * mappable if something actually produces that tag, and that is corpus-wide knowledge
   * one entity's rules cannot see. Empty (the default) means no option leaf is
   * recognized — the honest reading when we have not collected the producers, and it
   * keeps a bare option leaf from mapping to a tag nothing asserts.
   */
  producedOptions?: ReadonlySet<string>;
}

export function mapFoundryRules(
  rules: readonly RuleElement[],
  options: FoundryMapOptions = {},
): MappingResult {
  const effectTraits = options.effectTraits ?? new Set<string>();
  const knownFeatIds = options.knownFeatIds ?? new Set<string>();
  const producedOptions = options.producedOptions ?? new Set<string>();
  const effects: PassiveEffect[] = [];
  const grants: EntityGrant[] = [];
  const toggles: ToggleDeclaration[] = [];
  const report: MappingEntry[] = [];

  // PRE-PASS: choice groups span SEVERAL elements (a ChoiceSet plus the
  // ActiveEffectLike(s) its flag feeds), so they cannot be mapped one element at a
  // time. Resolving them first lets the per-element pass below report each consumed
  // element as `mapped` and skip re-mapping it — the report stays one entry per
  // element, and nothing is counted twice.
  const { choices, consumed, blocked } = mapChoiceGroups(rules);

  rules.forEach((rule, index) => {
    const key = String(rule?.key ?? "");
    const unsupported = (reason: UnsupportedReason, detail: string): void => {
      report.push({ index, key, outcome: "unsupported", reason, detail });
    };

    const asChoice = consumed.get(index);
    if (asChoice !== undefined) {
      report.push({ index, key, outcome: "mapped", produced: asChoice });
      return;
    }
    const block = blocked.get(index);
    if (block) {
      unsupported(block.reason, block.detail);
      return;
    }

    // GrantItem is THREE blockers wearing one key, so it dispatches on its target
    // before the flat table. Measured over the feat corpus: of 620 elements, ~313 name
    // a static entity (a feat, a class/ancestry feature), ~182 name an ACTION, and ~90
    // name no entity at all — their uuid is an unresolved ChoiceSet reference like
    // `{item|flags.system.rulesSelections.feat}`. That last group's blocker is the
    // CHOICE, not the granting: reporting it as `needs-granting` overstated how much of
    // the granting work is entity-modelling and hid it from the runtime-choice tally.
    if (key === "GrantItem") {
      const uuid = typeof rule.uuid === "string" ? rule.uuid : "";
      if (UNRESOLVED_UUID.test(uuid)) {
        unsupported("needs-runtime-choice", `grant target is an unresolved choice: ${uuid.slice(0, 60)}`);
        return;
      }
      // A CONDITIONAL grant is deferred, not approximated. Dropping the predicate would
      // hand out a feat the character has not earned, and the honest alternative needs
      // the BUILDER to re-evaluate on every build change (gain the prerequisite, gain
      // the feat; retrain out of it, lose the feat again). That is a lifecycle question,
      // not a mapping one. 17 of 242 feat grants are conditional.
      if (isConditional(rule)) {
        unsupported("needs-combat-tags", `conditional grant: ${JSON.stringify(rule.predicate).slice(0, 100)}`);
        return;
      }
      const ref = resolveGrantRef(uuid, knownFeatIds);
      if (ref === null) {
        unsupported("needs-granting", grantDetail(uuid, knownFeatIds));
        return;
      }
      // Deduped AFTER the loop, so the SECOND element of a double grant still gets its
      // own report entry saying it produced nothing and why — see `dedupeGrants` for
      // why a repeat is one feat rather than two.
      const duplicate = grants.some((g) => g.ref === ref);
      grants.push({ type: "feat", ref });
      report.push({
        index,
        key,
        outcome: "mapped",
        produced: duplicate ? 0 : 1,
        ...(duplicate
          ? {
              detail:
                `duplicate grant of ${ref}` +
                (isRecord(rule.preselectChoices)
                  ? `; differs only in preselectChoices (${JSON.stringify(rule.preselectChoices).slice(0, 60)}), which we do not model`
                  : ""),
            }
          : {}),
      });
      return;
    }

    // BEFORE the predicate gate below: a RollOption's predicate is its AVAILABILITY
    // condition, not a gate on an effect, so `mapRollOption` interprets it itself.
    if (key === "RollOption") {
      try {
        const decl = mapRollOption(rule, effectTraits, producedOptions);
        toggles.push(decl);
        report.push({ index, key, outcome: "mapped", produced: 1 });
      } catch (e) {
        if (e instanceof MapError) unsupported(e.reason, e.detail);
        else unsupported("unsupported-shape", `mapper threw: ${String(e)}`);
      }
      return;
    }

    const known = KNOWN_UNMAPPED[key];
    if (known) {
      unsupported(known.reason, known.detail);
      return;
    }

    // Checked BEFORE the per-kind map: a predicate we cannot express makes the
    // element unmappable regardless of how well the rest of its shape fits.
    //
    // APPLIES TO EVERY KIND (2026-07-20). This gate was once scoped to
    // AdjustDegreeOfSuccess, on the stated grounds that widening it "moves a great
    // deal of content at once". MEASURED, that was wrong: of the 1,779 elements
    // blocked here, only 97 had a predicate the leaf mapper could already state. The
    // rest were blocked by the leaf VOCABULARY, not by this gate — which is why the
    // action vocabulary (actions.ts) landed alongside it and does the real work,
    // taking the total to 265.
    const when = isConditional(rule) ? mapPredicate(rule.predicate, effectTraits, producedOptions) : null;
    if (isConditional(rule) && !when) {
      unsupported("needs-combat-tags", `conditional: ${JSON.stringify(rule.predicate).slice(0, 120)}`);
      return;
    }

    try {
      let produced: PassiveEffect[];
      switch (key) {
        case "FlatModifier":
          produced = mapFlatModifier(rule);
          break;
        case "AdjustDegreeOfSuccess":
          produced = mapAdjustDegreeOfSuccess(rule, effectTraits, producedOptions);
          break;
        case "ActiveEffectLike":
          produced = mapActiveEffectLike(rule);
          break;
        case "Note":
          produced = mapNote(rule);
          break;
        case "Resistance":
          produced = mapResistanceLike(rule, "resistance");
          break;
        case "Weakness":
          produced = mapResistanceLike(rule, "weakness");
          break;
        case "Immunity":
          produced = mapImmunity(rule);
          break;
        case "Sense":
          produced = mapSense(rule);
          break;
        case "BaseSpeed":
          produced = mapBaseSpeed(rule);
          break;
        default:
          unsupported("unknown-key", `no mapper for "${key}"`);
          return;
      }
      // Attach the predicate the gate above already proved mappable. WITHOUT THIS,
      // lifting the gate would ship every conditional FlatModifier as a PERMANENT
      // bonus — the exact wrong-sheet bug this boundary exists to prevent, and a
      // regression rather than a coverage win. AdjustDegreeOfSuccess is skipped
      // because `mapAdjustDegreeOfSuccess` attaches its own.
      //
      // `proficiency` is the one kind with no `when` — deliberately, since a raised
      // rank is a permanent property of the sheet (see passive.ts). Its schema is
      // `.strict()`, so a conditional ActiveEffectLike cannot express its condition
      // at all and is REFUSED here rather than shipped unconditional.
      if (when && key !== "AdjustDegreeOfSuccess") {
        const uncarryable = produced.find((e) => e.kind === "proficiency");
        if (uncarryable) {
          unsupported("needs-combat-tags", `conditional ${uncarryable.kind} effect cannot carry a predicate`);
          return;
        }
        produced = produced.map((e) => ({ ...e, when }) as PassiveEffect);
      }
      // AFTER the attach, and outside the branch above, because AdjustDegreeOfSuccess
      // attaches its own `when` and fans out over `skill-check` exactly like the rest.
      produced = narrowFannedSkillTargets(produced, when);
      effects.push(...produced);
      report.push({ index, key, outcome: "mapped", produced: produced.length });
    } catch (e) {
      if (e instanceof MapError) unsupported(e.reason, e.detail);
      else unsupported("unsupported-shape", `mapper threw: ${String(e)}`);
    }
  });

  return { effects, choices, grants: dedupeGrants(grants), toggles, report };
}

/** Reason tallies across a set of reports — the corpus-level coverage roadmap. */
export function summarizeReports(reports: readonly MappingEntry[][]): {
  elements: number;
  mapped: number;
  effects: number;
  unsupported: number;
  byReason: Record<string, number>;
  byKey: Record<string, number>;
} {
  let elements = 0;
  let mapped = 0;
  let effects = 0;
  const byReason: Record<string, number> = {};
  const byKey: Record<string, number> = {};
  for (const report of reports) {
    for (const e of report) {
      elements += 1;
      if (e.outcome === "mapped") {
        mapped += 1;
        effects += e.produced ?? 0;
      } else {
        byReason[e.reason ?? "unknown-key"] = (byReason[e.reason ?? "unknown-key"] ?? 0) + 1;
        byKey[e.key] = (byKey[e.key] ?? 0) + 1;
      }
    }
  }
  return { elements, mapped, effects, unsupported: elements - mapped, byReason, byKey };
}
