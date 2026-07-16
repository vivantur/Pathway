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
//     and does not care where the tags came from. On the static sheet the tags
//     come from `staticTags` (a character's own traits); in combat the bot's
//     tracker will UNION its own tags (flanking, off-guard, frightened) on top.
//     Deferring combat tags therefore only defers passives that hinge on
//     momentary combat state — the structure already handles them.
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
 * v1 emits only `self:trait:<t>` from the character's own traits: the honest
 * static surface the resolved model carries. (Conditions, target traits, and
 * combat state are play-time tags a later context unions in — deferred per
 * decision 3.) Trait ids are lower-cased so `self:trait:Elf` and `self:trait:elf`
 * match; whitespace within a trait becomes `-` to match the slug convention.
 */
export function staticTags(rc: ResolvedCharacter): Set<string> {
  const tags = new Set<string>();
  for (const t of rc.traits ?? []) {
    const slug = String(t).trim().toLowerCase().replace(/\s+/g, "-");
    if (slug) tags.add(`self:trait:${slug}`);
  }
  return tags;
}
