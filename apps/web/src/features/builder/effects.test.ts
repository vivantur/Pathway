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
import { findFeat, loadDataset } from '@/features/builder/data';
import { characterEffects, characterTraits, deriveCharacter, featChoicePrompts, pendingFeatChoices } from './rules';
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
    // An UNMADE choice grants nothing, and is not "skipped" either: `skipped` counts
    // effects we hold but cannot apply, and an unmade choice is not one — it is a
    // pending prompt, which is what `pendingFeatChoices` reports. (This assertion used
    // to expect skipped >= 1, back when the runtime read Foundry's unresolved
    // ActiveEffectLike and counted it.)
    const noChoice = characterEffects({ ...fighter(), classFeatId: 'canny-acumen' });
    expect(noChoice.saveRanks.size).toBe(0);
    expect(noChoice.skipped).toBe(0);
    expect(pendingFeatChoices({ ...fighter(), classFeatId: 'canny-acumen' }).map((p) => p.feat.id)).toEqual([
      'canny-acumen',
    ]);

    const chosen = characterEffects({
      ...fighter(),
      classFeatId: 'canny-acumen',
      featChoices: { 'canny-acumen': { cannyAcumen: 'will' } },
    });
    // Canny Acumen grants expert (rank 2) until 17th level.
    expect(chosen.saveRanks.get('will')).toBe(2);
  });

  it('grants master at 17th, where Canny Acumen\'s rank expression steps up', () => {
    // The rank is `ternary(gte(@actor.level,17),3,2)` — an expression evaluated per
    // character, not a literal baked in at ingest.
    const at = (level: number) =>
      characterEffects({
        ...fighter(),
        level,
        classFeatId: 'canny-acumen',
        featChoices: { 'canny-acumen': { cannyAcumen: 'will' } },
      }).saveRanks.get('will');
    expect(at(16)).toBe(2); // expert
    expect(at(17)).toBe(3); // master
  });

  it('still honors a choice stored in the pre-migration Foundry path form', () => {
    // Characters saved before options were keyed by our selector stored Foundry's
    // rank path. Those must keep working, or a feat silently stops granting.
    const legacy = characterEffects({
      ...fighter(),
      classFeatId: 'canny-acumen',
      featChoices: { 'canny-acumen': { cannyAcumen: 'system.saves.will.rank' } },
    });
    expect(legacy.saveRanks.get('will')).toBe(2);
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

  it('derives ancestry base vision as a sense (Dwarf → darkvision)', () => {
    const d = deriveCharacter({ ...fighter(), ancestryId: 'dwarf' });
    expect(d.senses.some((s) => s.type === 'darkvision')).toBe(true);
  });

  it('derives a heritage resistance, level-scaled (Forge Dwarf → fire)', () => {
    const build = (level: number): BuilderState => ({
      ...fighter(level),
      ancestryId: 'dwarf',
      heritageId: 'forge-dwarf',
    });
    // max(1, floor(level/2)): 1 at level 1, 3 at level 6.
    expect(characterTraits(build(1)).resistances).toEqual([
      { type: 'fire', value: 1, source: 'Forge Dwarf' },
    ]);
    expect(characterTraits(build(6)).resistances[0]?.value).toBe(3);
  });

  it('lets a heritage sense upgrade the ancestry vision (Cavern Elf → darkvision, no low-light)', () => {
    const t = characterTraits({ ...fighter(), ancestryId: 'elf', heritageId: 'cavern-elf' });
    const types = t.senses.map((s) => s.type);
    expect(types).toContain('darkvision');
    expect(types).not.toContain('low-light-vision'); // superseded by darkvision
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
