// Entity grants — a feat that gives you ANOTHER feat.
//
// WHY THIS IS NOT A PassiveEffect (owner decision, 2026-07-19). Everything in
// `passive.ts` answers "what number on the sheet does this change". A feat granting a
// feat changes no number: it changes WHICH CONTENT THE CHARACTER HAS, and the effects
// that follow are whatever the granted feat itself carries. It is an edge in the build
// graph, so it lives in its own `grants` field and the BUILDER walks it — the effects
// engine never sees it. Folding it into the union would have made
// `applyPassiveEffects` collect something no sheet could apply, and put a build-graph
// traversal inside a function whose contract is "fold modifiers onto a resolved actor".
//
// MEASURED (the feat corpus, 2026-07-19): 242 feat→feat grants across 217 feats, all
// 242 resolving to entities we hold. The graph is shallow — 24 feats grant more than
// one, exactly ONE grant chains (a granted feat that itself grants), zero cycles, zero
// self-grants. The closure below is still written for the general case, because a guard
// that first appears when content needs it is a guard written under pressure.
//
// NO PF2e RULES LIVE HERE. This is a graph traversal over ids. The one rules claim in
// the area — what a DOUBLE grant of the same feat means — is deliberately NOT decided by
// this module; see `dedupeGrants`.

import { z } from "zod";

/**
 * A grant of a whole content entity.
 *
 * `type` is a single-member enum rather than a bare literal so that adding `"action"`
 * or `"spell"` later widens it without changing the shape consumers destructure. Those
 * are not here yet for a DATA reason, not a modelling one: of 180 action grants in the
 * corpus only 8 resolve to an entity we hold, and a `ref` pointing at content we do not
 * have is a dangling pointer — strictly worse than an honest `unsupported`. When an
 * actions dataset lands they start resolving with no change to this schema.
 */
export const entityGrantSchema = z
  .object({
    type: z.enum(["feat"]),
    /** OUR entity id — never a Foundry uuid. The mapper resolves it at ingest. */
    ref: z.string().min(1),
  })
  .strict();
export type EntityGrant = z.infer<typeof entityGrantSchema>;

/**
 * Collapse repeated grants of the same entity to one.
 *
 * THIS ENCODES A RULES CLAIM, AND IT IS THE OWNER'S, NOT A GUESS (2026-07-19). Elemental
 * Trade — the dwarf heritage better known as Anvil Dwarf — grants Specialty Crafting
 * TWICE, and the two Foundry elements differ only in `preselectChoices`
 * (`stonemasonry` vs `blacksmithing`). The player gains the FEAT ONCE and alters its
 * rules to pick two professions; Specialty Crafting cannot otherwise be taken twice.
 *
 * So a `multiplicity` field was designed for this case and then DELETED: it would have
 * asserted the character holds the feat twice, which is a wrong sheet. Note this is the
 * opposite conclusion from `EffectCandidate.multiplicity`, and correctly so — Natural
 * Skill's duplication is two instances of an EFFECT, this one is two selections inside
 * ONE feat.
 *
 * The sub-selection (which craft specialty) is deliberately not modelled: Pathbuilder
 * opens no secondary selector for it either. What is discarded is recorded in the ingest
 * report by the caller rather than dropped silently.
 *
 * THE OTHER THREE CASES, AND WHY THEY DEDUPE TOO (owner decision, 2026-07-19). The corpus
 * has exactly four doubled grants, and only Elemental Trade's is the "one feat, two
 * selections" shape. The other three grant a feat whose own prose says it is REPEATABLE:
 *
 *   Hellbreaker Dedication → Additional Lore   "select this feat more than once"
 *   Linguist Dedication    → Multilingual      "select this feat multiple times"
 *   Terrain Scout          → Terrain Stalker   "select this feat multiple times"
 *
 * (Specialty Crafting has no such clause — the discriminator is IN THE CONTENT, so this
 * is read from source text rather than remembered.) For those three a duplicate arguably
 * does mean two acquisitions, so deduping under-grants them. It is still what we do,
 * because each repeat is only meaningful once the player can pick a DIFFERENT Lore /
 * language / terrain, and no such selection is modelled — two indistinguishable copies of
 * Additional Lore is its own wrong sheet. Deduping errs toward a legal character;
 * duplicating errs toward an illegal one, and Specialty Crafting proves the illegal case
 * is real. Revisit when repeated selections are modelled; the report names every discard,
 * so nothing has to be re-derived from Foundry to do it.
 */
export function dedupeGrants(grants: readonly EntityGrant[]): EntityGrant[] {
  const seen = new Set<string>();
  const out: EntityGrant[] = [];
  for (const g of grants) {
    const id = `${g.type}\0${g.ref}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(g);
  }
  return out;
}

/**
 * What the closure needs to know about content: an id → the grants that id carries.
 *
 * THE UNDEFINED/EMPTY DISTINCTION IS LOAD-BEARING. `[]` means "this entity exists and
 * grants nothing"; `undefined` means "no such entity". Collapsing them would make a
 * grant pointing at missing content indistinguishable from a leaf, which is precisely
 * the case `unresolved` exists to surface.
 */
export type GrantLookup = (ref: string) => readonly EntityGrant[] | undefined;

export interface GrantClosure {
  /** Every feat id granted, transitively, EXCLUDING the ids you started with. */
  granted: string[];
  /**
   * Refs that were granted but that `lookup` does not know. Reported rather than
   * dropped: a grant pointing at missing content is a content bug, and silently
   * ignoring it is how a character quietly loses a feat it should have.
   */
  unresolved: string[];
}

/**
 * The transitive closure of feats granted by a selection.
 *
 * BREADTH-FIRST WITH A GLOBAL VISITED SET, which is what makes it cycle-proof: an id is
 * expanded at most once, so a cycle terminates instead of recursing forever. The corpus
 * has no cycles today — but this runs over CONTENT, and content is edited by humans and
 * re-ingested from upstream, so "no cycles today" is not a property we can rely on.
 *
 * A granted feat that is ALSO explicitly selected is not reported twice: `granted`
 * excludes the seeds, so the caller can concatenate without deduping.
 */
export function resolveGrantedFeats(selected: readonly string[], lookup: GrantLookup): GrantClosure {
  const seeds = new Set(selected);
  const visited = new Set(selected);
  const granted: string[] = [];
  const unresolved: string[] = [];
  const queue = [...selected];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges = lookup(current);
    if (edges === undefined && !seeds.has(current)) {
      unresolved.push(current);
      continue;
    }
    for (const edge of edges ?? []) {
      if (edge.type !== "feat") continue;
      if (visited.has(edge.ref)) continue;
      visited.add(edge.ref);
      granted.push(edge.ref);
      queue.push(edge.ref);
    }
  }
  return { granted, unresolved };
}
