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
import { parseExpr, type Expr } from "./expr.js";
import { passiveEffectSchema, type Grant, type PassiveEffect } from "./passive.js";
import { isSelector, isSkillSlug, SAVE_SELECTORS, SKILL_SLUGS, type Selector } from "./selectors.js";

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
};

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
const KNOWN_UNMAPPED: Readonly<Record<string, { reason: UnsupportedReason; detail: string }>> = {
  ItemAlteration: { reason: "needs-item-model", detail: "alters an item's fields" },
  AdjustStrike: { reason: "needs-item-model", detail: "alters a strike" },
  DamageAlteration: { reason: "needs-item-model", detail: "alters damage of an item/strike" },
  Strike: { reason: "needs-item-model", detail: "creates a weapon/strike" },
  DamageDice: { reason: "needs-item-model", detail: "adds damage dice to a strike" },
  CriticalSpecialization: { reason: "needs-item-model", detail: "weapon critical specialization" },
  MartialProficiency: { reason: "needs-item-model", detail: "weapon/armor category proficiency" },
  GrantItem: { reason: "needs-granting", detail: "grants another item/feat" },
  ChoiceSet: { reason: "needs-runtime-choice", detail: "prompts a selection at choice time" },
  RollOption: { reason: "needs-combat-tags", detail: "produces a roll option/tag" },
  AdjustDegreeOfSuccess: {
    reason: "unsupported-shape",
    detail: "per-degree adjustment map; our rollAdjust is a blanket one-degree shift",
  },
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
    const mapped = SELECTOR_MAP[name] ?? (isSkillSlug(name) ? [name] : undefined);
    if (!mapped) throw new MapError("unsupported-selector", `selector "${name}"`);
    targets.push(...mapped);
  }
  if (targets.length === 0) throw new MapError("unsupported-shape", "no selector");

  const value = toExpr(rule.value);
  return targets.map((target) => ({ kind: "modifier", target, bonusType, value }) as PassiveEffect);
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

  const targets: Selector[] = [];
  for (const raw of toArray(rule.selector)) {
    const name = String(raw);
    const mapped = SELECTOR_MAP[name] ?? (isSkillSlug(name) ? [name] : undefined);
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
export function mapFoundryRules(rules: readonly RuleElement[]): MappingResult {
  const effects: PassiveEffect[] = [];
  const report: MappingEntry[] = [];

  rules.forEach((rule, index) => {
    const key = String(rule?.key ?? "");
    const unsupported = (reason: UnsupportedReason, detail: string): void => {
      report.push({ index, key, outcome: "unsupported", reason, detail });
    };

    const known = KNOWN_UNMAPPED[key];
    if (known) {
      unsupported(known.reason, known.detail);
      return;
    }

    // Checked BEFORE the per-kind map: a predicate we cannot express makes the
    // element unmappable regardless of how well the rest of its shape fits.
    if (isConditional(rule)) {
      unsupported("needs-combat-tags", `conditional: ${JSON.stringify(rule.predicate).slice(0, 120)}`);
      return;
    }

    try {
      let produced: PassiveEffect[];
      switch (key) {
        case "FlatModifier":
          produced = mapFlatModifier(rule);
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
      effects.push(...produced);
      report.push({ index, key, outcome: "mapped", produced: produced.length });
    } catch (e) {
      if (e instanceof MapError) unsupported(e.reason, e.detail);
      else unsupported("unsupported-shape", `mapper threw: ${String(e)}`);
    }
  });

  return { effects, report };
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
