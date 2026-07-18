// The predicate — the `when?` condition on a Layer-1 passive effect.
//
// A passive effect can be gated on a declarative boolean tree over a finite TAG
// vocabulary: "apply this +1 status bonus WHEN self:trait:elf and not
// target:trait:construct". This module owns that structure and its evaluator.
// See docs/effects-engine-design.md, "Layer 1 — Passive effect schema" and
// decision 3 ("design predicate structure + static tags now, defer combat tags").
//
// TWO DELIBERATE SCOPE CHOICES (decision 3):
//   • Tags are MEMBERSHIP FLAGS ONLY — a tag is either present or absent. There
//     are no numeric/threshold leaves here (level ≥ 5, "roll a 6+"); those are
//     expression-valued conditions and belong to Layer 2's `branch`. This keeps
//     the evaluator a pure boolean-over-a-set.
//   • ONE EVALUATOR, TWO CONTEXTS — `evaluatePredicate` takes the ACTIVE TAG SET
//     and does not care where the tags came from. Two producers live here:
//     `staticTags` (a character's own traits, knowable from the sheet alone) and
//     `rollTags` (the opposed context of a roll — who you are rolling against).
//     A caller unions them; a combat tracker unions its own state tags on top.
//
// STILL DEFERRED after the creature-tag slice: tags describing the INCOMING EFFECT
// itself — "against effects with the death trait", "against effects that would
// make you fatigued". Those are not blocked on this module but on the content
// model: `EffectTemplate` (automation.ts) carries no traits, and core has no
// condition vocabulary at all, so there is nothing for such a tag to read.
//
// PURE: a boolean tree + a set-membership test + a tag derivation. No PF2e rules
// math, no I/O — so there is no rules-from-memory risk here.

import { z } from "zod";
import type { ResolvedCharacter } from "./character.js";

/**
 * A declarative boolean tree over the tag vocabulary. Four node kinds:
 *   • `{ tag }`  — a leaf: true when the tag is in the active set.
 *   • `{ all }`  — conjunction (empty ⇒ true, the neutral element).
 *   • `{ any }`  — disjunction (empty ⇒ false).
 *   • `{ not }`  — negation of a single child.
 * Same *shape* as Foundry/Avrae predicates; the tags are OURS.
 */
export type Predicate =
  | { tag: string }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

/**
 * Zod schema for a predicate tree (recursive via `z.lazy`). A tag is a non-empty
 * string; the namespaced `scope:category:value` convention (`self:trait:elf`) is
 * a convention the authoring surface enforces, not a parse constraint here.
 */
export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ tag: z.string().min(1) }).strict(),
    z.object({ all: z.array(predicateSchema) }).strict(),
    z.object({ any: z.array(predicateSchema) }).strict(),
    z.object({ not: predicateSchema }).strict(),
  ]),
);

/**
 * Evaluate a predicate tree against the set of currently-active tags. Pure.
 * An `all` with no children is vacuously true; an `any` with no children is
 * false — the standard neutral elements, so an empty conjunction never blocks an
 * effect and an empty disjunction never enables one.
 */
export function evaluatePredicate(pred: Predicate, tags: ReadonlySet<string>): boolean {
  if ("tag" in pred) return tags.has(pred.tag);
  if ("all" in pred) return pred.all.every((p) => evaluatePredicate(p, tags));
  if ("any" in pred) return pred.any.some((p) => evaluatePredicate(p, tags));
  return !evaluatePredicate(pred.not, tags);
}

/**
 * Convenience for the common call site: a passive effect either carries a
 * predicate or is unconditional. An ABSENT predicate is always true — an
 * unconditional passive always applies.
 */
export function predicateHolds(pred: Predicate | undefined, tags: ReadonlySet<string>): boolean {
  return pred === undefined || evaluatePredicate(pred, tags);
}

/**
 * The tags derivable from the STATIC character sheet alone — the tag context the
 * character sheet evaluates predicates against, before any combat tags exist.
 *
 * Emits only `self:trait:<t>` from the character's own traits: the honest static
 * surface the resolved model carries. Tags about the OTHER creature in a roll come
 * from `rollTags`; conditions and momentary combat state are still deferred. Trait
 * ids are normalized by `tagSlug`, so `self:trait:Elf` and `self:trait:elf` match.
 */
export function staticTags(rc: ResolvedCharacter): Set<string> {
  const tags = new Set<string>();
  for (const t of rc.traits ?? []) {
    const slug = tagSlug(t);
    if (slug) tags.add(`self:trait:${slug}`);
  }
  return tags;
}

/**
 * Normalize a trait value to the tag slug convention: lower-cased, internal
 * whitespace to `-`. Shared by every producer so `Elf`, `elf`, and `Low Light`
 * land on the same tag no matter which one derived it.
 */
export function tagSlug(value: string): string {
  return String(value).trim().toLowerCase().replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// creature tags — the roll context
// ---------------------------------------------------------------------------
//
// The tags above describe the character ALONE. Most conditional content instead
// describes THE OTHER CREATURE in an interaction ("+1 to attacks against undead",
// "+2 to saves against a dragon's breath"). Three namespaces, because the corpus
// needs the distinction:
//
//   • `target:trait:<t>`   — the creature the roll goes OUT against (an attack, a
//                            skill check against its DC).
//   • `origin:trait:<t>`   — the creature whose effect prompted an INCOMING roll
//                            (the caster you are saving against).
//   • `opponent:trait:<t>` — EITHER of the above: "the other creature", whichever
//                            direction the interaction runs.
//
// WHY THE UNION EXISTS. Rules prose almost never states the direction — it says
// "against undead", and whether that is an outgoing attack or an incoming save is
// already fixed by WHICH STAT the effect targets. A `when` on a `will` save is
// inherently incoming; one on `attack` is inherently outgoing. So the selector
// carries the direction and the predicate only has to answer "who is the other
// creature" — which is `opponent:`, and which is what an author should normally
// write. `target:`/`origin:` stay available for the rare effect that genuinely
// cares, and they are what the Foundry corpus encodes (it separates the two), so
// ingest can map its predicates without reinterpreting them.
//
// `rollTags` therefore emits BOTH the precise namespace and the union for each
// creature present. Emitting both is what makes the two spellings interchangeable
// at evaluation time rather than a fork the author has to get right.

/** The traits of a creature participating in a roll. */
export interface CreatureRef {
  traits?: readonly string[];
}

/**
 * The opposed context a roll happens in. Every field is optional: a roll with no
 * opponent (a flat check, a Recall Knowledge with nothing targeted) simply
 * produces no creature tags, and predicates that need one correctly fail.
 */
export interface RollContext {
  /** The creature this roll goes out against. */
  target?: CreatureRef;
  /** The creature whose effect prompted this roll. */
  origin?: CreatureRef;
  /** Tags the host already knows (flanking, off-guard), unioned verbatim. */
  extra?: Iterable<string>;
}

/**
 * The tags derivable from a roll's opposed context. Pure, and deliberately
 * separate from `staticTags` — the two are unioned by the caller, which is the
 * "one evaluator, two contexts" split (docs, decision 3). This is the SECOND
 * context: nothing here is knowable from a character sheet alone.
 */
export function rollTags(ctx: RollContext): Set<string> {
  const tags = new Set<string>();
  const add = (scope: "target" | "origin", creature: CreatureRef | undefined) => {
    for (const t of creature?.traits ?? []) {
      const slug = tagSlug(t);
      if (!slug) continue;
      tags.add(`${scope}:trait:${slug}`);
      tags.add(`opponent:trait:${slug}`);
    }
  };
  add("target", ctx.target);
  add("origin", ctx.origin);
  for (const t of ctx.extra ?? []) tags.add(t);
  return tags;
}

// ---------------------------------------------------------------------------
// description
// ---------------------------------------------------------------------------

/** De-slug a tag value for display: `low-light` → `low light`. */
function label(value: string): string {
  return value.replace(/-/g, " ");
}

/**
 * Render one tag as a `{prefix, term}` pair, so a group of leaves sharing a prefix
 * can be collapsed ("vs undead or dragon" rather than "vs undead or vs dragon").
 * A tag this vocabulary does not recognize renders AS ITSELF, with no prefix — the
 * same honesty rule the mapper follows. Showing a raw `self:effect:rage` is ugly;
 * silently describing it as something it isn't would be wrong.
 */
function describeTag(tag: string): { prefix: string; term: string } {
  const parts = tag.split(":");
  if (parts.length === 3) {
    const [scope, category, value] = parts as [string, string, string];
    if (category === "trait") {
      if (scope === "opponent" || scope === "target") return { prefix: "vs ", term: label(value) };
      if (scope === "origin") return { prefix: "vs effects from ", term: label(value) };
      if (scope === "self") return { prefix: "when ", term: label(value) };
    }
  }
  return { prefix: "", term: tag };
}

/**
 * A short human phrase for a predicate — "vs undead", "vs undead or dragon" — for
 * display next to a situational bonus the sheet cannot fold into a total.
 *
 * DISPLAY ONLY. Nothing reads this back; `evaluatePredicate` is the meaning. It is
 * lossy on purpose (deeply nested trees flatten into readable prose), which is fine
 * for a label and would not be fine for anything that had to round-trip.
 */
export function describePredicate(pred: Predicate): string {
  if ("tag" in pred) {
    const { prefix, term } = describeTag(pred.tag);
    return `${prefix}${term}`;
  }
  if ("not" in pred) return `not ${describePredicate(pred.not)}`;

  const children = "all" in pred ? pred.all : pred.any;
  const join = "all" in pred ? " and " : " or ";
  if (children.length === 0) return "all" in pred ? "always" : "never";
  if (children.length === 1) return describePredicate(children[0]!);

  // Collapse a shared prefix when every child is a leaf that agrees on one.
  const leaves = children.every((c) => "tag" in c) ? children.map((c) => describeTag((c as { tag: string }).tag)) : null;
  if (leaves && leaves.every((l) => l.prefix === leaves[0]!.prefix) && leaves[0]!.prefix !== "") {
    return `${leaves[0]!.prefix}${leaves.map((l) => l.term).join(join)}`;
  }
  return children.map((c) => describePredicate(c)).join(join);
}
