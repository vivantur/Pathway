// Feat effects → character sheet (increment 1: HP bonuses + proficiency grants).
//
// The rule-element interpretation itself is unit-tested in @pathway/core; these
// tests lock the WIRING: that deriveCharacter feeds a build's chosen feats through
// core and reflects the result on the derived sheet, against the real dataset.

import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataset } from '@/features/builder/data';
import { characterEffects, deriveCharacter } from './rules';
import { emptyBuilderState, type BuilderState } from './types';

beforeAll(async () => {
  await loadDataset();
});

function fighter(level = 5): BuilderState {
  return {
    ...emptyBuilderState(),
    name: 'Effect Test',
    level,
    ancestryId: 'human',
    classId: 'fighter',
    keyAbility: 'str',
    freeBoosts: ['str', 'dex', 'con', 'wis'],
  };
}

describe('feat effects on the derived sheet', () => {
  it('Toughness adds the character level to max HP', () => {
    const base = deriveCharacter(fighter(5)).maxHp;
    const withToughness = deriveCharacter({ ...fighter(5), classFeatId: 'toughness' }).maxHp;
    expect(withToughness - base).toBe(5);
  });

  it('a skill-training feat makes the character trained in that skill', () => {
    const base = deriveCharacter(fighter());
    expect(base.skills.find((s) => s.id === 'thievery')?.rank).toBe(0);

    // Adroit Manipulation grants "trained in Thievery" (ActiveEffectLike upgrade).
    const trained = deriveCharacter({ ...fighter(), ancestryFeatId: 'adroit-manipulation' });
    expect(trained.skills.find((s) => s.id === 'thievery')?.rank).toBe(1);
  });

  it('counts (does not silently apply) effects outside increment-1 scope', () => {
    // Untrained Improvisation is a typed skill-check FlatModifier with infix math —
    // deferred until the stacking-rules pass, so it must be skipped, not guessed.
    const e = characterEffects({ ...fighter(), classFeatId: 'untrained-improvisation' });
    expect(e.skipped).toBeGreaterThanOrEqual(1);
    expect(e.skillRanks.size).toBe(0);
  });

  it('leaves a featless build unchanged', () => {
    const e = characterEffects(fighter());
    expect(e.hpBonus).toBe(0);
    expect(e.skillRanks.size).toBe(0);
    expect(e.saveRanks.size).toBe(0);
    expect(e.perceptionRank).toBeNull();
  });
});
