// Derived-stat compositions — how the scalar atoms in stats.ts combine into the
// named PF2e statistics (HP, saves, Perception, skills, DCs, AC).
//
// These functions take ALREADY-RESOLVED inputs: an ability modifier, a
// proficiency rank (0–4), the character level, and any item/other bonuses. They
// do NOT know how a client obtained the rank — the web builder resolves it from
// the class progression tables, while the character sheet reads the pre-doubled
// rank out of saved Pathbuilder JSON. Both then call the same function here, so
// the two clients can never disagree on how rank + modifier + bonuses combine.
// See root CLAUDE.md, "Architecture".

import { proficiencyBonus } from './stats.js';
import type { ProficiencyRank } from './proficiency.js';

/**
 * A proficiency-based statistic: ability modifier + proficiency bonus + item
 * and other bonuses. This is the shared shape of a saving throw, Perception, or
 * a skill modifier — in PF2e they are the same computation, differing only in
 * which ability and which proficiency rank feed it.
 *
 * `withoutLevel` selects the Proficiency Without Level variant (drops the level
 * term). `itemBonus` is a fundamental item bonus (a resilient rune, Automatic
 * Bonus Progression). `otherBonus` is a catch-all flat term — pass an armor
 * check penalty as a negative here.
 */
export interface ProficientModifierInput {
  abilityMod: number;
  rank: ProficiencyRank;
  level: number;
  withoutLevel?: boolean;
  itemBonus?: number;
  otherBonus?: number;
}

export function proficientModifier(i: ProficientModifierInput): number {
  return (
    i.abilityMod +
    proficiencyBonus(i.rank, i.level, i.withoutLevel) +
    (i.itemBonus ?? 0) +
    (i.otherBonus ?? 0)
  );
}

/**
 * A DC built on a proficiency-based statistic: 10 + the proficient modifier.
 * Class DC and spell DC are the canonical cases; both are 10 + key-ability mod +
 * proficiency bonus.
 */
export function proficientDC(i: ProficientModifierInput): number {
  return 10 + proficientModifier(i);
}

/**
 * Maximum Hit Points: ancestry HP (granted once) + (class HP + Constitution
 * modifier) at every level. `bonusHp` is a flat one-time addition; the negative
 * Con case is intentionally not floored here — a consumer that wants a minimum
 * of 1 HP per level should clamp its own inputs.
 */
export interface MaxHitPointsInput {
  ancestryHp: number;
  classHp: number;
  conMod: number;
  level: number;
  /** Flat HP added once (e.g. a bonus-HP field). */
  bonusHp?: number;
  /** HP added at every level. */
  bonusHpPerLevel?: number;
}

export function maxHitPoints(i: MaxHitPointsInput): number {
  return (
    i.ancestryHp +
    (i.classHp + i.conMod) * i.level +
    (i.bonusHp ?? 0) +
    (i.bonusHpPerLevel ?? 0) * i.level
  );
}
