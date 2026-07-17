// Spell heightening — the two pure rules behind casting a spell at a higher rank
// than its lowest. Both are encoded from pasted rules text; neither is remembered.
//
// THE TWO RULES (quoted at their implementations below):
//   • autoHeightenRank — "A cantrip is always automatically heightened to half your
//     level, rounded up"; focus spells are "automatically heightened to half your
//     level rounded up, just like cantrips are."
//   • heightenIncrements — "The listed effect applies for every increment of ranks by
//     which the spell is heightened above its lowest spell rank, and the benefit is
//     cumulative."
//
// DELIBERATELY NOT HERE:
//   • Which rank a spell was actually cast at. The HOST resolves that — the slot used,
//     or `autoHeightenRank(level)` for a cantrip or focus spell — and passes it in as
//     `ExecutionContext.spell`. Core owns the rule; the host owns the lookup, the same
//     purity seam as the counter snapshot.
//   • Casting LEGALITY: a focus spell whose minimum rank exceeds half your level, or a
//     spontaneous caster needing the spell known at the rank they want. That is the
//     deferred spellcasting layer's concern, not the damage math's.
//   • At-rank heightening ("Heightened (5th) …"), which selects a subtree rather than
//     scaling a number — that is the `heightened` automation node, not arithmetic.

/**
 * The rank a cantrip or focus spell is automatically heightened to: half your level,
 * rounded up. One function for both, because the pasted focus-spell rule defers to the
 * cantrip one ("just like cantrips are"). `level` is the character's level.
 */
export function autoHeightenRank(level: number): number {
  return Math.ceil(level / 2);
}

/**
 * How many heightening increments a cast earns — the number of whole `step`-rank
 * increments the cast rank sits ABOVE the spell's base (lowest) rank.
 *
 * From the pasted rule: "The listed effect applies for every increment of ranks by
 * which the spell is heightened above its lowest spell rank, and the benefit is
 * cumulative." Fireball (base rank 3, "Heightened (+1) The damage increases by 2d6")
 * therefore earns 1 increment at 4th rank and 2 at 5th — the text's own worked
 * example, 6d6 → 8d6 → 10d6.
 *
 * Floors, so a partial increment earns nothing: a "Heightened (+2)" spell cast a
 * single rank above its base is not heightened at all.
 *
 * Never negative — and that clamp is a RULE, not defensive padding. Per the pasted
 * spontaneous-caster text, casting a lower-rank spell in a higher-rank slot "casts the
 * spell at the rank you know the spell, not the rank of the higher slot. The spell
 * doesn't have any heightened effects." The host resolves such a cast to the rank the
 * spell is known at, so the increment count floors at zero rather than going negative.
 */
export function heightenIncrements(input: { castRank: number; baseRank: number; step: number }): number {
  const { castRank, baseRank, step } = input;
  if (!Number.isInteger(step) || step < 1) {
    throw new Error(`heightening step must be an integer >= 1 (got ${step})`);
  }
  return Math.max(0, Math.floor((castRank - baseRank) / step));
}
