/**
 * Senses & resistances for IMPORTED characters — the safe half of "unify the
 * engine."
 *
 * A Pathbuilder import has final numbers baked in but never exports the build
 * *choices*, so we don't recompute its base stats (that would risk disagreeing
 * with Pathbuilder, the source of truth). What Pathbuilder *doesn't* export
 * reliably is special senses (and, at higher levels, level-scaled resistances)
 * — so we fill only those, by matching the character's ancestry + heritage BY
 * NAME to our content and running core's `collectTraits` (which needs only the
 * level, not the ability-score reconstruction).
 *
 * Only the small ancestry + versatile-heritage files are loaded here (~0.2 MB),
 * not the full builder dataset — cheap enough to run on any sheet view.
 */

import { collectTraits, type CharacterTraits, type RuleElement } from '@pathway/core';
import type { Ancestry, Heritage } from '@/features/builder/data';
import type { PathbuilderBuild } from '../pathbuilder';

let ancestries: Ancestry[] | null = null;
let versatileHeritages: Heritage[] | null = null;

/** True once the ancestry/heritage index is loaded and `pathbuilderTraits` can resolve. */
export function isTraitIndexReady(): boolean {
  return ancestries !== null;
}

/** Load (and cache) the small ancestry + versatile-heritage index. Idempotent. */
export async function loadTraitIndex(): Promise<void> {
  if (ancestries) return;
  const [anc, vh] = await Promise.all([
    import('@/features/builder/data/ancestries.json').then((m) => m.default as unknown as Ancestry[]),
    import('@/features/builder/data/versatile-heritages.json').then((m) => m.default as unknown as Heritage[]),
  ]);
  ancestries = anc;
  versatileHeritages = vh;
}

const norm = (s?: string | null): string => (s ?? '').trim().toLowerCase();

// Memoize per build object (stable for the sheet's lifetime).
const cache = new WeakMap<object, CharacterTraits | null>();

/**
 * Senses & resistances a Pathbuilder character's ancestry + heritage grant, or
 * null when the index isn't loaded yet. Ancestry/heritage are matched by name;
 * an unmatched name simply contributes nothing (senses from a matched ancestry
 * still resolve).
 */
export function pathbuilderTraits(build: PathbuilderBuild): CharacterTraits | null {
  if (!ancestries || !versatileHeritages) return null;
  const cached = cache.get(build);
  if (cached !== undefined) return cached;

  const level = build.level ?? 1;
  const ancestry = ancestries.find((a) => norm(a.name) === norm(build.ancestry));
  const heritage =
    ancestry?.heritages.find((h) => norm(h.name) === norm(build.heritage)) ??
    versatileHeritages.find((h) => norm(h.name) === norm(build.heritage));

  const itemRules: RuleElement[][] = [];
  const labels: string[] = [];
  if (ancestry?.vision && ancestry.vision !== 'normal') {
    itemRules.push([{ key: 'Sense', selector: ancestry.vision } as RuleElement]);
    labels.push(ancestry.name);
  }
  if (ancestry && Array.isArray(ancestry.rules)) {
    itemRules.push(ancestry.rules as RuleElement[]);
    labels.push(ancestry.name);
  }
  if (heritage && Array.isArray(heritage.rules)) {
    itemRules.push(heritage.rules as RuleElement[]);
    labels.push(heritage.name);
  }

  let traits: CharacterTraits | null = null;
  if (itemRules.length > 0) {
    traits = collectTraits(itemRules, { level }, labels);
    // Darkvision supersedes low-light vision (same rule as the builder).
    if (traits.senses.some((s) => s.type === 'darkvision')) {
      traits.senses = traits.senses.filter((s) => s.type !== 'low-light-vision');
    }
  }
  cache.set(build, traits);
  return traits;
}
