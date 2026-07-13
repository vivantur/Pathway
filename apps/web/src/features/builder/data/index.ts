import type {
  Ancestry,
  Background,
  CharacterClass,
  ContentAliases,
  Dataset,
  Feat,
  Heritage,
  Item,
  RecommendationSet,
  Skill,
  Spell,
} from './schema';

export * from './schema';

const ATTRIBUTION =
  'Pathfinder Second Edition content © Paizo Inc., used under the Community Use Policy / ORC License. ' +
  'Rules content ingested from the Foundry VTT pf2e system (see scripts/ingest-pf2e.mjs).';

// ---------------------------------------------------------------------------
// Lazy loading.
//
// The enriched dataset (full rules text on ~6k feats / ~1.8k spells + ~5k items)
// is far too large to sit in the initial JS bundle, so each content file is a
// dynamic `import()` — Vite code-splits them into separate chunks fetched only
// when the builder mounts (`loadDataset()`, gated by <ContentGate>). Once loaded,
// the dataset is cached in a module singleton and `getDataset()` / the `find*`
// lookups stay SYNCHRONOUS, so no call site had to become async.
// ---------------------------------------------------------------------------

let dataset: Dataset | null = null;
let aliases: ContentAliases = { feats: {}, spells: {} };
let recommendations: RecommendationSet = { class: {}, ancestry: {} };
let loadPromise: Promise<Dataset> | null = null;

/** True once `loadDataset()` has resolved and `getDataset()` is safe to call. */
export function isDatasetLoaded(): boolean {
  return dataset !== null;
}

/** Load and cache the content dataset. Idempotent; concurrent calls share one fetch. */
export function loadDataset(): Promise<Dataset> {
  if (dataset) return Promise.resolve(dataset);
  if (!loadPromise) {
    loadPromise = Promise.all([
      import('./ancestries.json'),
      import('./versatile-heritages.json'),
      import('./backgrounds.json'),
      import('./classes.json'),
      import('./skills.json'),
      import('./feats.json'),
      import('./items.json'),
      import('./spells.json'),
      import('./recommendations.json'),
      import('./content-aliases.json'),
    ]).then(([anc, vh, bg, cls, sk, ft, it, sp, rec, al]) => {
      // Cast dynamic-import JSON (structurally inferred) to our schema via unknown.
      const pick = <T>(m: { default: unknown }): T => m.default as T;
      recommendations = pick<RecommendationSet>(rec);
      aliases = pick<ContentAliases>(al);
      dataset = {
        ancestries: pick<Ancestry[]>(anc),
        versatileHeritages: pick<Heritage[]>(vh),
        backgrounds: pick<Background[]>(bg),
        classes: pick<CharacterClass[]>(cls),
        skills: pick<Skill[]>(sk),
        feats: pick<Feat[]>(ft),
        items: pick<Item[]>(it),
        spells: pick<Spell[]>(sp),
        provenance: 'generated',
        attribution: ATTRIBUTION,
      };
      return dataset;
    });
  }
  return loadPromise;
}

export function getDataset(): Dataset {
  if (!dataset) {
    throw new Error(
      'Content dataset not loaded. Call loadDataset() (or render inside <ContentGate>) before getDataset().',
    );
  }
  return dataset;
}

// Convenience lookups ---------------------------------------------------------

export function findAncestry(id: string): Ancestry | undefined {
  return getDataset().ancestries.find((a) => a.id === id);
}

/** Find a heritage by id across a given ancestry's heritages AND versatile heritages. */
export function findHeritage(ancestryId: string | undefined, heritageId: string | undefined): Heritage | undefined {
  if (!heritageId) return undefined;
  const ancestry = ancestryId ? findAncestry(ancestryId) : undefined;
  return (
    ancestry?.heritages.find((h) => h.id === heritageId) ??
    getDataset().versatileHeritages.find((h) => h.id === heritageId)
  );
}

export function findBackground(id: string): Background | undefined {
  return getDataset().backgrounds.find((b) => b.id === id);
}

export function findClass(id: string): CharacterClass | undefined {
  return getDataset().classes.find((c) => c.id === id);
}

export function findSkill(id: string): Skill | undefined {
  return getDataset().skills.find((s) => s.id === id);
}

export function findFeat(id: string): Feat | undefined {
  const ds = getDataset();
  // Fall back through the alias map so ids the Remaster renamed still resolve.
  return ds.feats.find((f) => f.id === id) ?? ds.feats.find((f) => f.id === aliases.feats[id]);
}

export function findItem(id: string): Item | undefined {
  return getDataset().items.find((i) => i.id === id);
}

export function findSpell(id: string): Spell | undefined {
  const ds = getDataset();
  return ds.spells.find((s) => s.id === id) ?? ds.spells.find((s) => s.id === aliases.spells[id]);
}

/** Curated beginner feat recommendations for a class id. */
export function classRecommendations(classId: string | undefined) {
  return (classId && recommendations.class[classId]) || [];
}

/** Curated beginner feat recommendations for an ancestry id. */
export function ancestryRecommendations(ancestryId: string | undefined) {
  return (ancestryId && recommendations.ancestry[ancestryId]) || [];
}
