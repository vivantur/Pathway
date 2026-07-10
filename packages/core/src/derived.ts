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
