// Variant-rule feat schedules: Ancestry Paragon must ADD to the normal ancestry
// feats (not replace them), and Free Archetype grants an archetype feat at every
// even level from 2. Regression guard for the "extra feats not showing" bug.

import { describe, expect, it } from 'vitest';
import { gainsForLevel } from './rules';
import { OPT } from './options/config';

const ancestryLevels = (opts?: Record<string, boolean>) =>
  Array.from({ length: 20 }, (_, i) => i + 1).filter((l) => gainsForLevel(l, opts).ancestryFeat);

const archetypeLevels = (opts?: Record<string, boolean>) =>
  Array.from({ length: 20 }, (_, i) => i + 1).filter((l) => gainsForLevel(l, opts).archetypeFeat);

describe('gainsForLevel — variant feat schedules', () => {
  it('grants the normal ancestry feats without Ancestry Paragon', () => {
    expect(ancestryLevels()).toEqual([1, 5, 9, 13, 17]);
  });

  it('Ancestry Paragon adds bonus ancestry feats without dropping the normal ones', () => {
    const withParagon = ancestryLevels({ [OPT.ancestryParagon]: true });
    // Union of normal (1,5,9,13,17) and paragon bonus (1,3,7,11,15,19) = every odd level.
    expect(withParagon).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);
    // The normal levels must still be present (the bug dropped these).
    for (const lvl of [5, 9, 13, 17]) expect(withParagon).toContain(lvl);
  });

  it('Free Archetype grants an archetype feat at every even level from 2', () => {
    expect(archetypeLevels()).toEqual([]); // off by default
    expect(archetypeLevels({ [OPT.freeArchetype]: true })).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });
});
