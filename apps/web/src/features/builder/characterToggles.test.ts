// The toggle counterpart to grantedActions.test.ts. `characterToggles` is a LOOKUP:
// it walks the chosen feats and returns the toggle declarations they carry, tagged
// with the granting feat. Same mocking approach — synthetic feats ARE the dataset, so
// the test never depends on a loaded real dataset.
import { describe, expect, it, vi } from 'vitest';
import type { Feat } from '@/features/builder/data/schema';
import featsDataset from '@/features/builder/data/feats.json';

const DEMO_FEATS: Record<string, Feat> = {
  'demo-stance': {
    id: 'demo-stance',
    name: 'Demo Stance',
    level: 1,
    type: 'class',
    traits: [],
    source: 'Test',
    description: 'A feat with a plain toggle.',
    toggles: [{ option: 'demo-stance' }],
  },
  'demo-picker': {
    id: 'demo-picker',
    name: 'Demo Picker',
    level: 1,
    type: 'class',
    traits: [],
    source: 'Test',
    description: 'A feat whose toggle is a variant picker.',
    toggles: [{ option: 'demo-wave', variants: [{ value: 'acid' }, { value: 'fire' }] }],
  },
  'demo-constant': {
    id: 'demo-constant',
    name: 'Demo Constant',
    level: 1,
    type: 'ancestry',
    traits: [],
    source: 'Test',
    description: 'An always-on constant with no variants — nothing to flip.',
    toggles: [{ option: 'demo-constant', alwaysOn: true }],
  },
  'demo-passive': {
    id: 'demo-passive',
    name: 'Demo Passive',
    level: 1,
    type: 'general',
    traits: [],
    source: 'Test',
    description: 'A feat that offers no toggle.',
  },
};

vi.mock('@/features/builder/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/builder/data')>();
  return {
    ...actual,
    findFeat: (id: string) => DEMO_FEATS[id],
  };
});

const { characterToggles } = await import('./rules');
const { emptyBuilderState } = await import('./types');

function build(overrides: Record<string, unknown> = {}) {
  return {
    ...emptyBuilderState(),
    name: 'Toggle Test',
    level: 5,
    ancestryId: 'human',
    classId: 'fighter',
    keyAbility: 'str',
    freeBoosts: ['str', 'dex', 'con', 'wis'],
    ...overrides,
  } as ReturnType<typeof emptyBuilderState>;
}

describe('characterToggles', () => {
  it('collects a plain toggle, tagged with its source feat', () => {
    const toggles = characterToggles(build({ classFeatId: 'demo-stance' }));
    expect(toggles).toHaveLength(1);
    expect(toggles[0]!.toggle.option).toBe('demo-stance');
    expect(toggles[0]!.sourceName).toBe('Demo Stance');
    expect(toggles[0]!.sourceId).toBe('demo-stance');
  });

  it('collects a variant picker with its variants intact', () => {
    const toggles = characterToggles(build({ classFeatId: 'demo-picker' }));
    expect(toggles[0]!.toggle.variants?.map((v) => v.value)).toEqual(['acid', 'fire']);
  });

  it('still RETURNS an always-on constant — the render layer decides what to show', () => {
    // characterToggles is a pure lookup and stays honest about what content carries;
    // FeatToggles' `isInteractive` is what hides a non-flippable constant. Keeping the
    // filter in the view, not here, means a future consumer (the bot) sees everything.
    const toggles = characterToggles(build({ classFeatId: 'demo-constant' }));
    expect(toggles).toHaveLength(1);
    expect(toggles[0]!.toggle.alwaysOn).toBe(true);
  });

  it('returns nothing for a feat with no toggles', () => {
    expect(characterToggles(build({ classFeatId: 'demo-passive' }))).toEqual([]);
  });

  it('returns nothing when no feats are chosen', () => {
    expect(characterToggles(build())).toEqual([]);
  });

  it('keeps each toggle tagged with the feat that offered it', () => {
    const toggles = characterToggles(
      build({ classFeatId: 'demo-stance', ancestryFeatId: 'demo-constant' }),
    );
    const byOption = Object.fromEntries(toggles.map((t) => [t.toggle.option, t.sourceName]));
    expect(byOption).toEqual({ 'demo-stance': 'Demo Stance', 'demo-constant': 'Demo Constant' });
  });
});

describe('the real dataset', () => {
  it('carries toggles on the expected number of feats — the bake', () => {
    // Read straight from the JSON so the mock cannot flatter it. Locked so that if a
    // re-bake changes the count, whoever did it sees this and confirms it was intended
    // (the same discipline grantedActions.test.ts applies to its own surface).
    //
    // 468 mapped from Foundry RollOptions + 94 synthesized stance TRACKERS (a stance's
    // real mechanics live on a Foundry Effect item we do not yet ingest, so until then
    // every `stance`-trait feat gets a plain toggle with no mechanics — see
    // remap-effects.mjs).
    const withToggles = (featsDataset as Feat[]).filter((f) => (f.toggles?.length ?? 0) > 0);
    expect(withToggles.length).toBe(562);
  });

  it('gives every stance-trait feat a tracking toggle (the interim synthesis)', () => {
    const stances = (featsDataset as Feat[]).filter((f) =>
      (f.traits ?? []).map((t) => String(t).toLowerCase()).includes('stance'),
    );
    expect(stances.length).toBeGreaterThan(0);
    for (const s of stances) expect((s.toggles?.length ?? 0)).toBeGreaterThan(0);
  });
});
