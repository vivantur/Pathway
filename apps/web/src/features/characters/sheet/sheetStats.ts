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
import type { PathbuilderBuild } from '../pathbuilder';

// deriveCharacter is a few ms of work; memoize per build object so repeated
// reads across the sheet's stat cards don't recompute. `build` is a stable
// reference for the sheet's lifetime (it points into the cached query data).
const derivedCache = new WeakMap<object, DerivedCharacter>();
const derivedFailed = new WeakSet<object>();

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

export function acTotal(build: PathbuilderBuild): number | undefined {
  const d = derived(build);
  return d ? d.ac : pb.acTotal(build);
}

export function shieldBonus(build: PathbuilderBuild): number {
  const d = derived(build);
  return d ? d.shieldBonus : pb.shieldBonus(build);
}

export function saveBonus(build: PathbuilderBuild, save: 'fortitude' | 'reflex' | 'will'): number {
  const d = derived(build);
  return d ? d.saves[save] : pb.saveBonus(build, save);
}

export function perceptionBonus(build: PathbuilderBuild): number {
  const d = derived(build);
  return d ? d.perception : pb.perceptionBonus(build);
}

export function classDC(build: PathbuilderBuild): number | undefined {
  const d = derived(build);
  return d ? d.classDc : pb.classDC(build);
}

export function speed(build: PathbuilderBuild): number {
  const d = derived(build);
  return d ? d.speed : pb.speed(build);
}

export function focusPoolMax(build: PathbuilderBuild): number {
  const d = derived(build);
  return d ? d.focusPoints : pb.focusPoolMax(build);
}

export function skillBonus(build: PathbuilderBuild, skillName: string): number {
  const d = derived(build);
  if (d) {
    // Core models the 16 standard skills by lowercase id. Lore skills aren't in
    // core, so those fall through to the pathbuilder math below.
    const hit = d.skills.find((s) => s.id === skillName.toLowerCase());
    if (hit) return hit.modifier;
  }
  return pb.skillBonus(build, skillName);
}

/** Special senses (darkvision, scent, …) — empty for non-site-built characters. */
export function senses(build: PathbuilderBuild): GrantedSense[] {
  return derived(build)?.senses ?? [];
}

/** Damage resistances, resolved at the character's level — empty when unavailable. */
export function resistances(build: PathbuilderBuild): GrantedResistance[] {
  return derived(build)?.resistances ?? [];
}
