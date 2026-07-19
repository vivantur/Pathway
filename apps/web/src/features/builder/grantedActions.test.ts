// Feat-granted ACTIONS → the character's runnable list.
//
// The Layer-2 counterpart to effects.test.ts. `grantedActionsFor` is a LOOKUP: it
// walks the same chosen-feat set `characterEffects` does and hands back each feat's
// authored `grantedActions` tagged with its source. It interprets nothing and runs
// nothing (`features/automation/runAction.ts` is the host), so what these tests lock
// is the WIRING — that a grant on a chosen feat reaches the list, that an unchosen
// one does not, and that the tag points back at the right feat.
//
// The actions here are SHAPE-ONLY demonstrations injected through a mocked dataset,
// never a rules claim: no content carries a real tree yet (they are authored upstream
// from rules text), which the last test in this file asserts against the real dataset.

import { describe, expect, it, vi } from 'vitest';
import type { Feat } from '@/features/builder/data/schema';
import featsDataset from '@/features/builder/data/feats.json';

const DEMO_FEATS: Record<string, Feat> = {
  'demo-grantor': {
    id: 'demo-grantor',
    name: 'Demo Grantor',
    level: 1,
    type: 'class',
    traits: [],
    source: 'Test',
    description: 'A feat that hands you two activities.',
    grantedActions: [
      { id: 'demo-a', name: 'Demo Activity A', automation: [{ kind: 'text', body: 'Shape only.' }] },
      { id: 'demo-b', name: 'Demo Activity B' },
    ],
  },
  'demo-passive': {
    id: 'demo-passive',
    name: 'Demo Passive',
    level: 1,
    type: 'general',
    traits: [],
    source: 'Test',
    description: 'A feat that grants no activity.',
  },
  'demo-other': {
    id: 'demo-other',
    name: 'Demo Other',
    level: 1,
    type: 'ancestry',
    traits: [],
    source: 'Test',
    description: 'A second grantor, to prove tags are per-feat.',
    grantedActions: [{ id: 'demo-c', name: 'Demo Activity C' }],
  },
};

// The synthetic feats above ARE the dataset for these tests — the mock does not
// fall through to the real `findFeat`, which would need a loaded dataset and would
// make an unknown id throw rather than resolve to nothing (the case under test).
vi.mock('@/features/builder/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/builder/data')>();
  return {
    ...actual,
    findFeat: (id: string) => DEMO_FEATS[id],
  };
});

const { grantedActionsFor } = await import('./rules');
const { emptyBuilderState } = await import('./types');

function build(overrides: Record<string, unknown> = {}) {
  return {
    ...emptyBuilderState(),
    name: 'Granted Action Test',
    level: 5,
    ancestryId: 'human',
    classId: 'fighter',
    keyAbility: 'str',
    freeBoosts: ['str', 'dex', 'con', 'wis'],
    ...overrides,
  } as ReturnType<typeof emptyBuilderState>;
}

describe('grantedActionsFor', () => {
  it('collects every action a chosen feat grants, tagged with its source', () => {
    const actions = grantedActionsFor(build({ classFeatId: 'demo-grantor' }));
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.action.id)).toEqual(['demo-a', 'demo-b']);
    for (const a of actions) {
      expect(a.sourceName).toBe('Demo Grantor');
      expect(a.sourceId).toBe('demo-grantor');
    }
  });

  it('includes an action whose tree is not authored yet', () => {
    // A feat that grants an activity still grants it. Hiding it until the
    // automation exists would under-report the character's own sheet to them;
    // the sheet distinguishes the two with `hasAutomation`.
    const actions = grantedActionsFor(build({ classFeatId: 'demo-grantor' }));
    const bare = actions.find((a) => a.action.id === 'demo-b');
    expect(bare).toBeDefined();
    expect(bare?.action.automation).toBeUndefined();
  });

  it('returns nothing for a feat that grants no activity', () => {
    expect(grantedActionsFor(build({ classFeatId: 'demo-passive' }))).toEqual([]);
  });

  it('returns nothing when no feats are chosen', () => {
    expect(grantedActionsFor(build())).toEqual([]);
  });

  it('keeps each action tagged with the feat that actually granted it', () => {
    const actions = grantedActionsFor(
      build({ classFeatId: 'demo-grantor', ancestryFeatId: 'demo-other' }),
    );
    expect(actions).toHaveLength(3);
    const byId = Object.fromEntries(actions.map((a) => [a.action.id, a.sourceName]));
    expect(byId).toEqual({
      'demo-a': 'Demo Grantor',
      'demo-b': 'Demo Grantor',
      'demo-c': 'Demo Other',
    });
  });

  it('drops a feat id that resolves to no feat', () => {
    expect(grantedActionsFor(build({ classFeatId: 'no-such-feat' }))).toEqual([]);
  });
});

describe('the real dataset', () => {
  it('carries NO granted actions yet — the trees are authored upstream', () => {
    // Read straight from the JSON, so the mock above cannot flatter this.
    //
    // Deliberately locked rather than left implicit: automation trees come from
    // rules text through the review pipeline, and the day content starts carrying
    // them is the day this assertion should be CHANGED by whoever ships them —
    // not the day someone notices the sheet quietly grew an untested surface.
    const withActions = (featsDataset as Feat[]).filter((f) => (f.grantedActions?.length ?? 0) > 0);
    expect(withActions.map((f) => f.id)).toEqual([]);
  });
});
