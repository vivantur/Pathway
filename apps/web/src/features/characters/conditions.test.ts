// The sheet's condition adapter — the bridge between how characters STORE conditions
// (name-keyed, unchanged for compatibility) and core's slug-keyed vocabulary.
//
// This is the part that can break real data: every existing character's conditions are
// stored as display names, and the bot writes some of them. If a name stops resolving,
// a condition silently stops affecting the sheet — the kind of failure nobody notices.

import { describe, expect, it } from 'vitest';
import { conditionModifiers } from '@pathway/core';
import {
  PF2E_CONDITIONS,
  conditionDef,
  conditionSlug,
  heldConditions,
  isValuedCondition,
} from './conditions';

describe('name → slug bridge', () => {
  it('resolves every name the picker can produce', () => {
    // The round trip that matters: anything offered in the UI must map back to core,
    // or adding it from the picker would produce a condition with no effect.
    for (const def of PF2E_CONDITIONS) {
      expect(conditionSlug(def.name), def.name).toBeDefined();
    }
  });

  it('handles the hyphenated and multi-word names', () => {
    expect(conditionSlug('Off-Guard')).toBe('off-guard');
    expect(conditionSlug('off-guard')).toBe('off-guard');
    expect(conditionSlug('Frightened')).toBe('frightened');
  });

  it('rejects a free-text status rather than guessing', () => {
    // `character.status` is arbitrary text the bot may set; it is not a condition.
    expect(conditionSlug('inspired by a bard')).toBeUndefined();
    expect(conditionSlug('')).toBeUndefined();
  });
});

describe('the picker', () => {
  it('hides the death track — those have their own bot-synced steppers', () => {
    const names = PF2E_CONDITIONS.map((d) => d.name);
    expect(names).not.toContain('Dying');
    expect(names).not.toContain('Wounded');
    expect(names).not.toContain('Doomed');
  });

  it('hides attitudes and Broken — not things a player tracks on themselves', () => {
    const names = PF2E_CONDITIONS.map((d) => d.name);
    expect(names).not.toContain('Friendly');
    expect(names).not.toContain('Hostile');
    expect(names).not.toContain('Broken');
  });

  it('still offers the conditions players actually use', () => {
    const names = PF2E_CONDITIONS.map((d) => d.name);
    for (const n of ['Clumsy', 'Frightened', 'Off-Guard', 'Prone', 'Slowed', 'Stupefied']) {
      expect(names).toContain(n);
    }
  });

  it('reports valued conditions, defaulting unknown names to boolean', () => {
    expect(isValuedCondition('Frightened')).toBe(true);
    expect(isValuedCondition('Prone')).toBe(false);
    expect(isValuedCondition('not a condition')).toBe(false);
  });

  it('carries core’s summary, which fixed a wrong one this file used to hold', () => {
    // The old hand-written table claimed Blinded makes you off-guard. It does not.
    expect(conditionDef('Blinded')?.summary.toLowerCase()).not.toContain('off-guard');
  });
});

describe('heldConditions — feeding core from the sheet’s two sources', () => {
  it('reads the web tracker list, values included', () => {
    expect(heldConditions([{ name: 'Frightened', value: 2 }, { name: 'Prone' }])).toEqual([
      { slug: 'frightened', value: 2 },
      { slug: 'prone' },
    ]);
  });

  it('includes the bot-managed dying/wounded columns', () => {
    // These are not in the tracker list; if they were dropped, a dying character would
    // show none of the effects Dying brings (via Unconscious).
    expect(heldConditions([], { dying: 1, wounded: 2 })).toEqual([
      { slug: 'dying', value: 1 },
      { slug: 'wounded', value: 2 },
    ]);
  });

  it('ignores zero/absent columns', () => {
    expect(heldConditions([], { dying: 0, wounded: null })).toEqual([]);
    expect(heldConditions(undefined)).toEqual([]);
  });

  it('drops unrecognized names instead of inventing a condition', () => {
    expect(heldConditions([{ name: 'feeling great' }, { name: 'Prone' }])).toEqual([{ slug: 'prone' }]);
  });
});

describe('the loop — stored conditions to sheet numbers', () => {
  it('turns the owner’s worked example into a single -2, not -3', () => {
    // Stored as a player would have them, through the bridge, through core.
    const held = heldConditions([{ name: 'Clumsy', value: 1 }, { name: 'Frightened', value: 2 }]);
    const adj = conditionModifiers(held);
    expect(adj.get('ac')).toBe(-2);
    expect(adj.get('reflex')).toBe(-2);
  });

  it('stacks a circumstance penalty on top of a status one', () => {
    const held = heldConditions([{ name: 'Off-Guard' }, { name: 'Frightened', value: 1 }]);
    expect(conditionModifiers(held).get('ac')).toBe(-3);
  });

  it('applies what a bot-set Dying implies, all the way to AC', () => {
    // Dying → Unconscious → -4 status AC, plus the implied Off-Guard at -2 circumstance.
    expect(conditionModifiers(heldConditions([], { dying: 1 })).get('ac')).toBe(-6);
  });

  it('leaves the sheet untouched when nothing is held', () => {
    expect(conditionModifiers(heldConditions([])).size).toBe(0);
  });
});
