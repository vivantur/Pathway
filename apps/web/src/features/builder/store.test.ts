// Tests for upstream-change invalidation in the builder store.
//
// Changing an upstream choice (ancestry, class, background, subclass) must not
// leave downstream picks stranded: stale feats still fill their slots and pass
// validation, stale spells invisibly consume slot maxima, and a stale free-skill
// pick permanently eats a slot. Each case here reproduces one of those.

import { beforeEach, describe, expect, it } from 'vitest';
import { getDataset } from '@/features/builder/data';
import { useBuilder } from '@/features/builder/store';

function firstFeatId(): string {
  const feat = getDataset().feats[0];
  if (!feat) throw new Error('dataset has no feats');
  return feat.id;
}

beforeEach(() => {
  useBuilder.getState().reset();
});

describe('chooseClass', () => {
  it('clears class feats stored on levels 2-20, not just the level-1 slot', () => {
    const store = useBuilder.getState();
    store.chooseClass('fighter');
    store.update({ classFeatId: firstFeatId() });
    store.updateLevelGains(2, { classFeatId: firstFeatId() });
    store.updateLevelGains(4, { classFeatId: firstFeatId(), skillFeatId: firstFeatId() });

    useBuilder.getState().chooseClass('wizard');

    const { state } = useBuilder.getState();
    expect(state.classFeatId).toBeUndefined();
    expect(state.progression[2]?.classFeatId).toBeUndefined();
    expect(state.progression[4]?.classFeatId).toBeUndefined();
    // Non-class picks at those levels survive.
    expect(state.progression[4]?.skillFeatId).toBe(firstFeatId());
  });

  it('clears the old class\'s spell picks, weapon group, and monk paths', () => {
    const store = useBuilder.getState();
    store.chooseClass('cleric');
    store.update({
      weaponGroup: 'sword',
      monkPaths: { first: 'fortitude' },
      spellcasting: {
        cantrips: ['some-cantrip'],
        spellsByRank: { 1: ['some-spell'] },
        focusSpells: ['some-focus'],
        focusCantrips: [],
      },
    });

    useBuilder.getState().chooseClass('wizard');

    const { state } = useBuilder.getState();
    expect(state.weaponGroup).toBeUndefined();
    expect(state.monkPaths).toBeUndefined();
    expect(state.spellcasting.cantrips).toEqual([]);
    expect(state.spellcasting.spellsByRank).toEqual({});
    expect(state.spellcasting.focusSpells).toEqual([]);
  });

  it('re-clicking the already-selected class changes nothing', () => {
    const store = useBuilder.getState();
    store.chooseClass('fighter');
    store.update({ classFeatId: firstFeatId(), weaponGroup: 'sword' });

    useBuilder.getState().chooseClass('fighter');

    const { state } = useBuilder.getState();
    expect(state.classFeatId).toBe(firstFeatId());
    expect(state.weaponGroup).toBe('sword');
  });
});

describe('chooseAncestry', () => {
  it('clears ancestry feats stored on levels 5/9/13/17', () => {
    const store = useBuilder.getState();
    store.chooseAncestry('dwarf');
    store.update({ ancestryFeatId: firstFeatId() });
    store.updateLevelGains(5, { ancestryFeatId: firstFeatId() });
    store.updateLevelGains(9, { ancestryFeatId: firstFeatId(), generalFeatId: firstFeatId() });

    useBuilder.getState().chooseAncestry('elf');

    const { state } = useBuilder.getState();
    expect(state.ancestryFeatId).toBeUndefined();
    expect(state.progression[5]?.ancestryFeatId).toBeUndefined();
    expect(state.progression[9]?.ancestryFeatId).toBeUndefined();
    expect(state.progression[9]?.generalFeatId).toBe(firstFeatId());
  });
});

describe('chooseBackground', () => {
  it('drops a free skill pick the new background now grants', () => {
    const ds = getDataset();
    const bg = ds.backgrounds.find((b) => b.trainedSkill);
    if (!bg?.trainedSkill) throw new Error('dataset has no background with a trained skill');

    const store = useBuilder.getState();
    store.toggleSkill(bg.trainedSkill, 10);
    store.toggleSkill('acrobatics', 10);
    expect(useBuilder.getState().state.skillChoices).toContain(bg.trainedSkill);

    useBuilder.getState().chooseBackground(bg.id);

    const { state } = useBuilder.getState();
    expect(state.skillChoices).not.toContain(bg.trainedSkill);
    expect(state.skillChoices).toContain('acrobatics');
  });
});

describe('chooseSubclass', () => {
  it('clears spell picks when the subclass changes the casting tradition', () => {
    const ds = getDataset();
    const sorcerer = ds.classes.find((c) => c.id === 'sorcerer');
    if (!sorcerer?.subclasses?.length) throw new Error('dataset has no sorcerer bloodlines');

    const store = useBuilder.getState();
    store.chooseClass('sorcerer');
    // Find two bloodlines with different traditions via the store's own
    // clearing behavior: pick spells under the first, switch to each other
    // bloodline until one wipes them (there must be at least two traditions).
    const [first, ...rest] = sorcerer.subclasses;
    useBuilder.getState().chooseSubclass(first.id);
    useBuilder.getState().update({
      spellcasting: { cantrips: ['c1'], spellsByRank: { 1: ['s1'] }, focusSpells: [], focusCantrips: [] },
    });

    let wiped = false;
    for (const sub of rest) {
      useBuilder.getState().chooseSubclass(sub.id);
      if (useBuilder.getState().state.spellcasting.cantrips.length === 0) {
        wiped = true;
        break;
      }
    }
    expect(wiped).toBe(true);
  });

  it('keeps spell picks when the tradition does not change', () => {
    const store = useBuilder.getState();
    store.chooseClass('cleric');
    const cleric = getDataset().classes.find((c) => c.id === 'cleric');
    const doctrines = cleric?.subclasses ?? [];
    if (doctrines.length < 2) throw new Error('dataset has fewer than two cleric doctrines');

    useBuilder.getState().chooseSubclass(doctrines[0].id);
    useBuilder.getState().update({
      spellcasting: { cantrips: ['c1'], spellsByRank: {}, focusSpells: [], focusCantrips: [] },
    });
    useBuilder.getState().chooseSubclass(doctrines[1].id);

    expect(useBuilder.getState().state.spellcasting.cantrips).toEqual(['c1']);
  });
});
