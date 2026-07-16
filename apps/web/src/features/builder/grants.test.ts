// Tests for granted proficiencies and bonus feats:
//  - Subclass skill training (Gunslinger Ways, verified vs the Foundry source).
//  - Bonus feats granted by another choice (Natural Ambition → class feat,
//    General Training / Versatile Human heritage → general feat).
//  - Manual skill-proficiency overrides (homebrew / GM grants) as a floor.
//  - Regression locks for Free Archetype slots and the Human language roster.

import { beforeAll, describe, expect, it } from 'vitest';
import { allLanguages, getDataset, loadDataset } from '@/features/builder/data';
import {
  bonusFeatOptions,
  bonusFeatSlots,
  chosenFeatIds,
  deriveCharacter,
  gainsForLevel,
  loreId,
} from '@/features/builder/rules';
import { subclassGrantedSkillIds } from '@/features/builder/subclassEffects';
import { emptyBuilderState, emptyLevelGains, type BuilderState } from '@/features/builder/types';

beforeAll(async () => {
  await loadDataset();
});

function base(extra: Partial<BuilderState> = {}): BuilderState {
  const ds = getDataset();
  const human = ds.ancestries.find((a) => a.id === 'human');
  const fighter = ds.classes.find((c) => c.id === 'fighter');
  if (!human || !fighter) throw new Error('dataset missing human/fighter');
  return {
    ...emptyBuilderState(),
    level: 1,
    ancestryId: human.id,
    heritageId: 'versatile-human',
    classId: fighter.id,
    keyAbility: 'str',
    freeBoosts: ['str', 'dex', 'con', 'wis'],
    ...extra,
  };
}

function gunslinger(subclassId: string, extra: Partial<BuilderState> = {}): BuilderState {
  const g = getDataset().classes.find((c) => c.id === 'gunslinger');
  if (!g) throw new Error('dataset missing gunslinger');
  return base({ classId: g.id, keyAbility: 'dex', subclassId, heritageId: undefined, ...extra });
}

function rank(state: BuilderState, skillId: string): number {
  return deriveCharacter(state).skills.find((s) => s.id === skillId)?.rank ?? 0;
}

describe('subclass-granted skills (Gunslinger Ways)', () => {
  it('Sniper trains Stealth', () => {
    expect(subclassGrantedSkillIds(gunslinger('sniper'))).toContain('stealth');
    expect(rank(gunslinger('sniper'), 'stealth')).toBe(1);
  });
  it('Drifter trains Acrobatics, Vanguard trains Athletics', () => {
    expect(rank(gunslinger('drifter'), 'acrobatics')).toBe(1);
    expect(rank(gunslinger('vanguard'), 'athletics')).toBe(1);
  });
  it('Pistolero trains the chosen skill (Deception or Intimidation)', () => {
    const noChoice = gunslinger('pistolero');
    expect(rank(noChoice, 'deception')).toBe(0); // nothing granted until chosen
    const chose = gunslinger('pistolero', { subclassSkillChoices: { 'gunslinger-way': 'intimidation' } });
    expect(rank(chose, 'intimidation')).toBe(1);
    expect(rank(chose, 'deception')).toBe(0);
  });
});

describe('bonus feats granted by another choice', () => {
  it('Versatile Human heritage opens a general-feat slot', () => {
    const slots = bonusFeatSlots(base());
    expect(slots.some((s) => s.key === 'versatile-human' && s.kind === 'general')).toBe(true);
  });
  it('Natural Ambition opens a class-feat slot; General Training a general one', () => {
    const na = bonusFeatSlots(base({ ancestryFeatId: 'natural-ambition', heritageId: 'skilled-human' }));
    expect(na.some((s) => s.source === 'Natural Ambition' && s.kind === 'class' && s.level === 1)).toBe(true);

    const gt = bonusFeatSlots(base({ ancestryFeatId: 'general-training', heritageId: 'skilled-human' }));
    expect(gt.some((s) => s.source === 'General Training' && s.kind === 'general')).toBe(true);
  });
  it('higher-level grants surface at the level they were taken', () => {
    // Ancestral Paragon (a general feat) taken at level 3 → a bonus ANCESTRY feat there.
    const state = base({
      level: 3,
      progression: { 3: { ...emptyLevelGains(), generalFeatId: 'ancestral-paragon' } },
    });
    const slot = bonusFeatSlots(state).find((s) => s.source === 'Ancestral Paragon');
    expect(slot).toBeTruthy();
    expect(slot?.kind).toBe('ancestry');
    expect(slot?.level).toBe(3);
    // Its picker offers this ancestry's feats.
    const opts = bonusFeatOptions(state, slot!);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((f) => f.type === 'ancestry')).toBe(true);
  });
  it('a bonus feat counts as chosen only while its granting slot is active', () => {
    // Choice stored, but no Versatile Human heritage → slot inactive → ignored.
    const inactive = base({ heritageId: 'skilled-human', bonusFeatChoices: { 'versatile-human': 'diehard' } });
    expect(chosenFeatIds(inactive).has('diehard')).toBe(false);
    // With the heritage, the same choice is honoured.
    const active = base({ heritageId: 'versatile-human', bonusFeatChoices: { 'versatile-human': 'diehard' } });
    expect(chosenFeatIds(active).has('diehard')).toBe(true);
  });
});

describe('manual skill overrides', () => {
  it('raise a skill to the chosen rank', () => {
    const state = base({ skillOverrides: { stealth: 3 } });
    expect(rank(state, 'stealth')).toBe(3);
  });
  it('act as a floor — never lower an already-higher rank', () => {
    // Fighter is trained (1) in Athletics via class; a lower override is a no-op.
    const trained = rank(base(), 'athletics');
    const state = base({ skillOverrides: { athletics: 1 } });
    expect(rank(state, 'athletics')).toBe(Math.max(trained, 1));
  });
  it('can override a Lore skill', () => {
    const state = base({ loreChoices: ['Warfare'], skillOverrides: { [loreId('Warfare')]: 2 } });
    expect(rank(state, loreId('Warfare'))).toBe(2);
  });
});

describe('regression locks', () => {
  it('Free Archetype grants an archetype slot at even levels ≥2 only', () => {
    const opts = { freeArchetype: true };
    expect(gainsForLevel(1, opts).archetypeFeat).toBe(false);
    expect(gainsForLevel(2, opts).archetypeFeat).toBe(true);
    expect(gainsForLevel(3, opts).archetypeFeat).toBe(false);
    expect(gainsForLevel(4, opts).archetypeFeat).toBe(true);
    // Off by default.
    expect(gainsForLevel(2, {}).archetypeFeat).toBe(false);
  });
  it('a Human is offered real bonus-language options', () => {
    const human = getDataset().ancestries.find((a) => a.id === 'human');
    const pool = allLanguages().filter((l) => !(human?.languages ?? []).includes(l));
    expect(pool.length).toBeGreaterThan(20);
  });
});
