/**
 * Sheet stats — a thin adapter that makes the character sheet show the SAME
 * numbers as the builder.
 *
 * Characters built on the website carry their full builder state embedded under
 * `_pathwayBuild` (see useSaveBuild). When that's present AND the builder
 * dataset is loaded, we compute every core stat with `@pathway/core`'s
 * `deriveCharacter` — the exact engine the builder uses — so the sheet can't
 * drift from the builder.
 *
 * For characters WITHOUT `_pathwayBuild` (imported from Pathbuilder, or created
 * in the Discord bot), and until the dataset finishes loading, we fall back to
 * the sheet's original `pathbuilder.ts` math. Every function keeps the same
 * signature it had there, so call sites only change their import.
 */

import { isDatasetLoaded } from '@/features/builder/data';
import { deriveCharacter, type DerivedCharacter } from '@/features/builder/rules';
import type { BuilderState } from '@/features/builder/types';
import type { GrantedResistance, GrantedSense } from '@pathway/core';
import * as pb from '../pathbuilder';
import { normalizeDefenseList, type PathbuilderBuild } from '../pathbuilder';
import { pathbuilderTraits } from './pathbuilderTraits';

// deriveCharacter is a few ms of work; memoize per build object so repeated
// reads across the sheet's stat cards don't recompute. `build` is a stable
// reference for the sheet's lifetime (it points into the cached query data).
const derivedCache = new WeakMap<object, DerivedCharacter>();
const derivedFailed = new WeakSet<object>();

/**
 * Net condition modifiers per stat, from `@pathway/core`'s `conditionModifiers`.
 *
 * Applied HERE, at the one façade both paths funnel through, so a condition changes the
 * sheet identically whether the numbers came from our engine or from Pathbuilder's. That
 * is safe for the imported path specifically because Pathbuilder has no notion of a
 * condition — its export carries build data (attributes, ranks, gear) and no active
 * conditions — so there is nothing to double-count. Conditions are a play-time layer on
 * top of whatever base we display, not a recomputation of it.
 */
export type ConditionAdjustments = ReadonlyMap<string, number>;

const adjust = (n: number, adj: ConditionAdjustments | undefined, key: string): number =>
  n + (adj?.get(key) ?? 0);

/** The core-derived character for a site-built build, or null to fall back. */
function derived(build: PathbuilderBuild): DerivedCharacter | null {
  const embedded = (build as { _pathwayBuild?: BuilderState })._pathwayBuild;
  if (!embedded) return null;
  const hit = derivedCache.get(build);
  if (hit) return hit;
  if (derivedFailed.has(build)) return null;
  // Not cached yet: only derive once the dataset is actually loaded (getDataset
  // throws otherwise). Before then, return null so we fall back — and DON'T
  // cache, so the next render (after the dataset loads) retries and upgrades.
  if (!isDatasetLoaded()) return null;
  try {
    const d = deriveCharacter(embedded);
    derivedCache.set(build, d);
    return d;
  } catch {
    // A malformed embedded build shouldn't break the sheet — fall back for good.
    derivedFailed.add(build);
    return null;
  }
}

/** True when this build's numbers come from the shared core engine (for a badge). */
export function isCoreDerived(build: PathbuilderBuild): boolean {
  return derived(build) !== null;
}

export function maxHp(build: PathbuilderBuild): number | undefined {
  const d = derived(build);
  return d ? d.maxHp : pb.maxHp(build);
}

export function acTotal(build: PathbuilderBuild, adj?: ConditionAdjustments): number | undefined {
  const d = derived(build);
  const base = d ? d.ac : pb.acTotal(build);
  return base === undefined ? undefined : adjust(base, adj, 'ac');
}

export function shieldBonus(build: PathbuilderBuild): number {
  const d = derived(build);
  return d ? d.shieldBonus : pb.shieldBonus(build);
}

export function saveBonus(build: PathbuilderBuild, save: 'fortitude' | 'reflex' | 'will', adj?: ConditionAdjustments): number {
  const d = derived(build);
  return adjust(d ? d.saves[save] : pb.saveBonus(build, save), adj, save);
}

export function perceptionBonus(build: PathbuilderBuild, adj?: ConditionAdjustments): number {
  const d = derived(build);
  return adjust(d ? d.perception : pb.perceptionBonus(build), adj, 'perception');
}

export function classDC(build: PathbuilderBuild, adj?: ConditionAdjustments): number | undefined {
  const d = derived(build);
  const base = d ? d.classDc : pb.classDC(build);
  return base === undefined ? undefined : adjust(base, adj, 'class-dc');
}

export function speed(build: PathbuilderBuild): number {
  const d = derived(build);
  return d ? d.speed : pb.speed(build);
}

export function focusPoolMax(build: PathbuilderBuild): number {
  const d = derived(build);
  return d ? d.focusPoints : pb.focusPoolMax(build);
}

export function skillBonus(build: PathbuilderBuild, skillName: string, adj?: ConditionAdjustments): number {
  const key = skillName.toLowerCase();
  const d = derived(build);
  if (d) {
    // Core models the 16 standard skills by lowercase id. Lore skills aren't in
    // core, so those fall through to the pathbuilder math below.
    const hit = d.skills.find((s) => s.id === key);
    if (hit) return adjust(hit.modifier, adj, key);
  }
  return adjust(pb.skillBonus(build, skillName), adj, key);
}

/**
 * Special senses (darkvision, scent, …). Site-built characters use the full
 * core derivation; imported characters get ancestry/heritage senses resolved by
 * name (Pathbuilder doesn't reliably export senses). Empty until data loads.
 */
export function senses(build: PathbuilderBuild): GrantedSense[] {
  const d = derived(build);
  if (d) return d.senses;
  return pathbuilderTraits(build)?.senses ?? [];
}

/**
 * Damage resistances, resolved at the character's level. Site-built → core.
 * Imported → core-derived ancestry/heritage resistances, but ONLY when
 * Pathbuilder didn't export any of its own (its list stays authoritative, and
 * we never duplicate it). Empty until data loads.
 */
export function resistances(build: PathbuilderBuild): GrantedResistance[] {
  const d = derived(build);
  if (d) return d.resistances;
  const traits = pathbuilderTraits(build);
  if (!traits) return [];
  // Pathbuilder already listed resistances → trust it, add nothing.
  if (normalizeDefenseList(build.resistances).length > 0) return [];
  return traits.resistances;
}
