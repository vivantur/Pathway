// Tests for the per-level advancement schedule.
//
// The generic table applies to most classes, but the rogue (Player Core
// pg. 168) and investigator (Player Core 2 pg. 103) gain "a skill increase at
// 2nd level and every level thereafter", and their skill-feat cadence is
// denser: rogue "at 1st level and every level thereafter"; investigator every
// level from 2nd (even levels generic, odd levels via Skillful Lessons).

import { describe, expect, it } from 'vitest';
import { gainsForLevel, validate } from './rules';
import { emptyBuilderState } from './types';

const levels = Array.from({ length: 20 }, (_, i) => i + 1);

describe('gainsForLevel — generic classes', () => {
  it('fighter keeps the even-level skill feats and odd skill increases', () => {
    const featLevels = levels.filter((l) => gainsForLevel(l, {}, 'fighter').skillFeat);
    const increaseLevels = levels.filter((l) => gainsForLevel(l, {}, 'fighter').skillIncrease);
    expect(featLevels).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(increaseLevels).toEqual([3, 5, 7, 9, 11, 13, 15, 17, 19]);
  });
});

describe('gainsForLevel — rogue (Player Core pg. 168)', () => {
  it('gains a skill feat at 1st level and every level thereafter', () => {
    const featLevels = levels.filter((l) => gainsForLevel(l, {}, 'rogue').skillFeat);
    expect(featLevels).toEqual(levels);
  });

  it('gains a skill increase at 2nd level and every level thereafter', () => {
    const increaseLevels = levels.filter((l) => gainsForLevel(l, {}, 'rogue').skillIncrease);
    expect(increaseLevels).toEqual(levels.slice(1)); // 2..20
  });

  it('keeps the generic class/general/ancestry feat schedule', () => {
    const s = (l: number) => gainsForLevel(l, {}, 'rogue');
    expect(levels.filter((l) => s(l).classFeat)).toEqual([1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(levels.filter((l) => s(l).generalFeat)).toEqual([3, 7, 11, 15, 19]);
    expect(levels.filter((l) => s(l).ancestryFeat)).toEqual([1, 5, 9, 13, 17]);
    expect(levels.filter((l) => s(l).boostCount === 4)).toEqual([5, 10, 15, 20]);
  });
});

describe('gainsForLevel — investigator (Player Core 2 pg. 103)', () => {
  it('gains a skill feat every level from 2nd (even generic + odd Skillful Lessons)', () => {
    const featLevels = levels.filter((l) => gainsForLevel(l, {}, 'investigator').skillFeat);
    expect(featLevels).toEqual(levels.slice(1)); // 2..20 — no level-1 skill feat
  });

  it('gains a skill increase at 2nd level and every level thereafter', () => {
    const increaseLevels = levels.filter((l) => gainsForLevel(l, {}, 'investigator').skillIncrease);
    expect(increaseLevels).toEqual(levels.slice(1));
  });
});

describe('validate — rogue level-1 skill feat', () => {
  it('flags the missing class-granted level-1 skill feat for rogues only', () => {
    const rogue = { ...emptyBuilderState(), classId: 'rogue' };
    expect(validate(rogue).some((p) => p.includes('level-1 skill feat'))).toBe(true);

    const withPick = {
      ...rogue,
      progression: { 1: { skillFeatId: 'some-feat', skillIncreases: [], boosts: [] } },
    };
    expect(validate(withPick).some((p) => p.includes('level-1 skill feat'))).toBe(false);

    const fighter = { ...emptyBuilderState(), classId: 'fighter' };
    expect(validate(fighter).some((p) => p.includes('level-1 skill feat'))).toBe(false);
  });
});
