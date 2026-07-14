// Feat effects → character sheet (increment 1: HP bonuses + proficiency grants).
//
// The rule-element interpretation itself is unit-tested in @pathway/core; these
// tests lock the WIRING: that deriveCharacter feeds a build's chosen feats through
// core and reflects the result on the derived sheet, against the real dataset.

import { beforeAll, describe, expect, it } from 'vitest';
import { findFeat, loadDataset } from '@/features/builder/data';
import { characterEffects, deriveCharacter, featChoicePrompts } from './rules';
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

  it('Weapon Specialization adds the weapon proficiency rank to damage (fighter, expert)', () => {
    // Level-1 fighter is expert (rank 2) in martial weapons. Weapon Specialization
    // is granted at level 7 → +2 damage; before that, nothing.
    const equipLongsword = (level: number): BuilderState => ({
      ...fighter(level),
      inventory: [{ itemId: 'longsword', equipped: true, qty: 1 }],
    });
    const before = deriveCharacter(equipLongsword(6));
    const after = deriveCharacter(equipLongsword(7));
    const dmg = (c: ReturnType<typeof deriveCharacter>) =>
      c.weapons.find((w) => w.id === 'longsword')!.damageMod;
    expect(dmg(after) - dmg(before)).toBe(2);
    expect(after.effectNotes.some((n) => n.source === 'Weapon Specialization')).toBe(true);
  });

  it('applies a choice-driven feat once the player stores a selection (Canny Acumen)', () => {
    const noChoice = characterEffects({ ...fighter(), classFeatId: 'canny-acumen' });
    expect(noChoice.saveRanks.size).toBe(0);
    expect(noChoice.skipped).toBeGreaterThanOrEqual(1);

    const chosen = characterEffects({
      ...fighter(),
      classFeatId: 'canny-acumen',
      featChoices: { 'canny-acumen': { cannyAcumen: 'system.saves.will.rank' } },
    });
    // Canny Acumen grants expert (rank 2) until 17th level.
    expect(chosen.saveRanks.get('will')).toBe(2);
  });

  it('surfaces the right prompts/options for choice-driven feats', () => {
    const canny = featChoicePrompts(findFeat('canny-acumen'));
    expect(canny).toHaveLength(1);
    expect(canny[0]!.flag).toBe('cannyAcumen');
    // Three saves + Perception are mappable; the rest of the ChoiceSet is dropped.
    expect(canny[0]!.options.map((o) => o.label).sort()).toEqual([
      'Fortitude',
      'Perception',
      'Reflex',
      'Will',
    ]);

    const natural = featChoicePrompts(findFeat('natural-skill'));
    expect(natural).toHaveLength(2); // skillOne + skillTwo
    expect(natural.every((p) => p.options.length === 16)).toBe(true);
  });

  it('leaves a featless build unchanged', () => {
    const e = characterEffects(fighter());
    expect(e.hpBonus).toBe(0);
    expect(e.skillRanks.size).toBe(0);
    expect(e.saveRanks.size).toBe(0);
    expect(e.perceptionRank).toBeNull();
    expect(e.statModifiers.size).toBe(0);
  });

  it('applies an unconditional typed stat modifier (Superior Sight → +2 Perception)', () => {
    const base = deriveCharacter(fighter()).perception;
    const withFeat = deriveCharacter({ ...fighter(), ancestryFeatId: 'superior-sight' }).perception;
    expect(withFeat - base).toBe(2);
  });
});
