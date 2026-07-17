// Feat effects → character sheet.
//
// The effect schema and the Foundry mapping are unit-tested in @pathway/core; these
// tests lock the WIRING against the REAL dataset: that deriveCharacter feeds a build's
// chosen feats through core and reflects the result on the derived sheet.
//
// These sheet numbers are also the parity check for the ingest refactor. They passed
// unchanged when the input flipped from Foundry's rule elements (read at runtime) to
// our own PassiveEffects (mapped at ingest) — same feats, same sheet.

import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataset } from '@/features/builder/data';
import { characterEffects, deriveCharacter } from './rules';
import { emptyBuilderState, type BuilderState } from './types';
import ingestReport from '@/features/builder/data/effect-ingest-report.json';

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

  it('does not guess an effect it cannot express, and NAMES it in the ingest report', () => {
    // Untrained Improvisation is a `proficiency`-typed skill-check FlatModifier — a
    // bonus type outside our circumstance/status/item/untyped vocabulary.
    //
    // The honesty here MOVED. It used to be a runtime `skipped` count, because the app
    // read Foundry's elements live. Now an unmappable element never becomes a
    // PassiveEffect at all: it is rejected at ingest, with a reason, and the feat
    // simply carries no effect. So the property is checked in both halves — absent
    // from the sheet, and accounted for in the report.
    const e = characterEffects({ ...fighter(), classFeatId: 'untrained-improvisation' });
    expect(e.skillRanks.size).toBe(0);
    expect(e.statModifiers.size).toBe(0);
    expect(e.hpBonus).toBe(0);

    const entry = ingestReport.entities.find((x) => x.id === 'untrained-improvisation');
    expect(entry?.report).toMatchObject([{ outcome: 'unsupported', reason: 'unsupported-bonus-type' }]);
  });

  it('accounts for every ingested rule element — nothing is silently dropped', () => {
    // The invariant that makes the report trustworthy, asserted over the real corpus:
    // one report entry per source element, for every entity. A count that quietly
    // omits most of what it missed (the old `skipped`) is worse than no count.
    for (const entity of ingestReport.entities) {
      expect(entity.report).toHaveLength(entity.raw.length);
    }
    const { elements, mapped, unsupported } = ingestReport.summary;
    expect(mapped + unsupported).toBe(elements);
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
