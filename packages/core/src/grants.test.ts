// grants.ts — entity grants as a build-graph edge.
//
// Fixtures use REAL corpus relationships (Elemental Trade → Specialty Crafting ×2,
// Gray Corsair Training's chain) so the tests exercise the shapes ingest actually meets.

import { describe, expect, it } from "vitest";
import { dedupeGrants, entityGrantSchema, resolveGrantedFeats, type EntityGrant, type GrantLookup } from "./grants.js";

const feat = (ref: string): EntityGrant => ({ type: "feat", ref });

/** A lookup over a plain graph. Absent key ⇒ undefined ⇒ "no such entity". */
const graphLookup = (graph: Record<string, string[]>): GrantLookup => {
  return (ref) => (ref in graph ? graph[ref]!.map(feat) : undefined);
};

describe("entityGrantSchema", () => {
  it("accepts a feat grant and rejects an unknown type", () => {
    expect(entityGrantSchema.safeParse({ type: "feat", ref: "alchemical-crafting" }).success).toBe(true);
    // "action" is not modelled YET, and for a data reason (only 8/180 action grants
    // resolve to an entity we hold) — so the schema must not quietly accept one.
    expect(entityGrantSchema.safeParse({ type: "action", ref: "bon-mot" }).success).toBe(false);
  });

  it("is strict — an unknown field is a producer bug, not something to ignore", () => {
    expect(entityGrantSchema.safeParse({ type: "feat", ref: "x", multiplicity: 2 }).success).toBe(false);
  });
});

describe("dedupeGrants", () => {
  it("collapses a repeated grant of the same feat to ONE", () => {
    // Elemental Trade (Anvil Dwarf) grants Specialty Crafting twice, differing only in
    // preselectChoices (stonemasonry / blacksmithing). Per the owner: the player gains
    // the FEAT once and alters its rules to pick two professions — Specialty Crafting
    // cannot otherwise be taken twice. Two grants here would be a wrong sheet.
    expect(dedupeGrants([feat("specialty-crafting"), feat("specialty-crafting")])).toEqual([feat("specialty-crafting")]);
  });

  it("collapses a repeat of a REPEATABLE feat too — a deliberate under-grant", () => {
    // Hellbreaker Dedication grants Additional Lore twice, and Additional Lore's prose
    // does say "you can select this feat more than once" — so this repeat arguably means
    // two acquisitions, and deduping under-grants it. Owner's call (2026-07-19): each
    // repeat only means something once the player can choose a DIFFERENT Lore, which is
    // not modelled, so two indistinguishable copies would be its own wrong sheet.
    // Deduping errs toward a legal character; duplicating errs toward an illegal one.
    expect(dedupeGrants([feat("additional-lore"), feat("additional-lore")])).toEqual([feat("additional-lore")]);
  });

  it("keeps DISTINCT grants, and in source order", () => {
    const out = dedupeGrants([feat("hefty-hauler"), feat("incredible-investiture")]);
    expect(out).toEqual([feat("hefty-hauler"), feat("incredible-investiture")]);
  });
});

describe("resolveGrantedFeats", () => {
  it("returns the feats a selection grants, excluding the seeds themselves", () => {
    const closure = resolveGrantedFeats(["alchemical-scholar"], graphLookup({
      "alchemical-scholar": ["alchemical-crafting"],
      "alchemical-crafting": [],
    }));
    expect(closure).toEqual({ granted: ["alchemical-crafting"], unresolved: [] });
  });

  it("follows a CHAIN — a granted feat that itself grants", () => {
    // The corpus has exactly one (gray-corsair-training). The closure is what makes a
    // chain work at all; without it the second feat's own grant is silently lost.
    const closure = resolveGrantedFeats(["a"], graphLookup({ a: ["b"], b: ["c"], c: [] }));
    expect(closure.granted).toEqual(["b", "c"]);
  });

  it("TERMINATES on a cycle instead of recursing forever", () => {
    // No cycles in the corpus today — but this runs over content that humans edit and
    // that is re-ingested from upstream, so "no cycles today" is not a guarantee.
    const closure = resolveGrantedFeats(["a"], graphLookup({ a: ["b"], b: ["c"], c: ["a"] }));
    expect(closure.granted.sort()).toEqual(["b", "c"]);
  });

  it("handles a self-grant without looping or re-listing the seed", () => {
    const closure = resolveGrantedFeats(["a"], graphLookup({ a: ["a"] }));
    expect(closure.granted).toEqual([]);
  });

  it("does not list a granted feat that was ALSO explicitly selected", () => {
    // So a caller can concatenate selected + granted without deduping.
    const closure = resolveGrantedFeats(["a", "b"], graphLookup({ a: ["b"], b: [] }));
    expect(closure.granted).toEqual([]);
  });

  it("grants the same feat once even when two selections both grant it", () => {
    const closure = resolveGrantedFeats(["a", "b"], graphLookup({ a: ["c"], b: ["c"], c: [] }));
    expect(closure.granted).toEqual(["c"]);
  });

  it("REPORTS a grant pointing at content we do not have, rather than dropping it", () => {
    // A dangling ref is a content bug. Ignoring it is how a character quietly loses a
    // feat it should have had, with nothing anywhere saying so.
    const closure = resolveGrantedFeats(["a"], graphLookup({ a: ["ghost"] }));
    expect(closure.granted).toEqual(["ghost"]);
    expect(closure.unresolved).toEqual(["ghost"]);
  });

  it("does not report an unknown SEED as unresolved", () => {
    // The caller chose the seeds; a seed we know nothing about is the caller's business,
    // not a broken edge in the content graph.
    expect(resolveGrantedFeats(["unknown"], graphLookup({})).unresolved).toEqual([]);
  });

  it("treats 'exists but grants nothing' differently from 'does not exist'", () => {
    const known = resolveGrantedFeats(["a"], graphLookup({ a: ["b"], b: [] }));
    const missing = resolveGrantedFeats(["a"], graphLookup({ a: ["b"] }));
    expect(known.unresolved).toEqual([]);
    expect(missing.unresolved).toEqual(["b"]);
  });

  it("is empty for an empty selection", () => {
    expect(resolveGrantedFeats([], graphLookup({ a: ["b"] }))).toEqual({ granted: [], unresolved: [] });
  });
});
