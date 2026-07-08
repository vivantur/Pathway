// Scalar stat primitives — the atoms every derived PF2e value is built from.
//
// These were previously implemented separately by the web builder
// (apps/web/src/features/builder/rules.ts) and the web character sheet
// (apps/web/src/features/characters/pathbuilder.ts), with two different rank
// encodings and inconsistent variant-rule handling. This module is now the
// only implementation; both clients adapt their inputs to it.
//
// Rank encodings:
//   • Core (and the builder) use ranks 0–4: untrained/trained/expert/master/
//     legendary. The proficiency BONUS is rank × 2 (plus level when trained).
//   • Pathbuilder JSON stores the pre-doubled raw bonus 0/2/4/6/8. Convert
//     with `rawBonusToRank` before calling into core.

import type { ProficiencyRank } from './proficiency';

/**
 * Ability modifier from an ability score: floor((score − 10) / 2).
 * Tolerant of missing scores (returns 0) so sheet code can pass
 * possibly-absent Pathbuilder fields straight through.
 */
export function abilityModifier(score: number | undefined | null): number {
  if (typeof score !== 'number' || Number.isNaN(score)) return 0;
  return Math.floor((score - 10) / 2);
}

/**
 * PF2e proficiency bonus: 0 when untrained, otherwise level + 2 × rank.
 * With the Proficiency Without Level variant rule, the level term is dropped
 * (Gamemastery Guide variant; untrained is still flat 0).
 */
export function proficiencyBonus(
  rank: ProficiencyRank,
  level: number,
  withoutLevel = false,
): number {
  if (rank === 0) return 0;
  return (withoutLevel ? 0 : level) + rank * 2;
}

/**
 * Convert Pathbuilder's raw proficiency bonus (0/2/4/6/8) to a core rank
 * (0–4). Unknown/odd values clamp to the nearest lower rank.
 */
export function rawBonusToRank(raw: number | undefined | null): ProficiencyRank {
  if (typeof raw !== 'number' || Number.isNaN(raw) || raw <= 0) return 0;
  const rank = Math.min(4, Math.floor(raw / 2));
  return rank as ProficiencyRank;
}

export const RANK_LABEL: Record<ProficiencyRank, string> = {
  0: 'Untrained',
  1: 'Trained',
  2: 'Expert',
  3: 'Master',
  4: 'Legendary',
};

/** Human label for a core rank (0–4). */
export function rankLabel(rank: ProficiencyRank): string {
  return RANK_LABEL[rank] ?? 'Untrained';
}
