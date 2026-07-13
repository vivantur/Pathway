// Tests for the builder's Pathbuilder serializer.
//
// This JSON is what a character built on the web is SAVED as: the vault row, the
// bot's view of the character, and the Pathbuilder-compatible export all read it.
// Anything a consumer cannot recompute from this object has to be written into it.
//
// AC is the case in point. It needs the equipped armor, that armor's Dex cap, and
// its potency rune to derive; neither the character sheet nor the bot resolves any
// of those, so both just read `acTotal.acTotal`. Before this was emitted, every
// in-house character had no AC at all — the sheet rendered blank, the bot's `{{ac}}`
// substituted a hardcoded 10, and combat saw null.

import { beforeAll, describe, expect, it } from 'vitest';
import { proficiencyBonus } from '@pathway/core';
import { getDataset, loadDataset } from '@/features/builder/data';
import { toPathbuilder } from '@/features/builder/pathbuilder';
import { deriveCharacter } from '@/features/builder/rules';
import { emptyBuilderState, type BuilderState } from '@/features/builder/types';

// The content dataset is now lazily code-split; populate the singleton before
// any test reads it through the synchronous getDataset()/find* lookups.
beforeAll(async () => {
  await loadDataset();
});

/** A level-1 fighter with nothing equipped, so AC is the unarmored case. */
function unarmoredFighter(): BuilderState {
  const ds = getDataset();
  const human = ds.ancestries.find((a) => a.id === 'human');
  const fighter = ds.classes.find((c) => c.id === 'fighter');
  if (!human || !fighter) throw new Error('dataset is missing human/fighter');

  return {
    ...emptyBuilderState(),
    name: 'Test Fighter',
    level: 1,
    ancestryId: human.id,
    classId: fighter.id,
    keyAbility: 'str',
    freeBoosts: ['str', 'dex', 'con', 'wis'],
  };
}

describe('toPathbuilder — acTotal', () => {
  it('writes an acTotal, so saved characters actually have an AC', () => {
    const result = toPathbuilder(unarmoredFighter());
    expect(result.success).toBe(true);

    const { acTotal } = result.build;
    expect(acTotal).toBeDefined();
    expect(typeof acTotal?.acTotal).toBe('number');
    expect(acTotal?.acTotal).toBeGreaterThan(0);
  });

  it('the emitted acTotal is exactly what deriveCharacter computed', () => {
    const state = unarmoredFighter();
    const derived = deriveCharacter(state);
    const { build } = toPathbuilder(state);

    expect(build.acTotal).toEqual({
      acTotal: derived.ac,
      shieldBonus: derived.shieldBonus,
    });
  });

  it('unarmored AC = 10 + proficiency + Dex (no armor equipped)', () => {
    const state = unarmoredFighter();
    const derived = deriveCharacter(state);

    const expected =
      10 + proficiencyBonus(derived.ranks.unarmoredDefense, state.level) + derived.mods.dex;

    expect(derived.ac).toBe(expected);
    expect(toPathbuilder(state).build.acTotal?.acTotal).toBe(expected);
  });

  it('excludes the shield: the sheet adds shieldBonus only while it is raised', () => {
    const state = unarmoredFighter();
    const { build } = toPathbuilder(state);
    const derived = deriveCharacter(state);

    expect(build.acTotal?.acTotal).toBe(derived.ac);
    expect(build.acTotal?.shieldBonus).toBe(derived.shieldBonus);
  });
});
