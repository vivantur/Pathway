// The sheet's stat adapter must return the SAME numbers as the builder for
// characters built on the site (those carrying `_pathwayBuild`), and fall back
// to the legacy pathbuilder math otherwise. These tests lock that wiring.

import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataset } from '@/features/builder/data';
import { deriveCharacter } from '@/features/builder/rules';
import { emptyBuilderState, type BuilderState } from '@/features/builder/types';
import type { PathbuilderBuild } from './pathbuilder';
import * as pb from './pathbuilder';
import * as sheetStats from './sheet/sheetStats';
import { loadTraitIndex } from './sheet/pathbuilderTraits';
import { conditionModifiers, senseTags } from '@pathway/core';

beforeAll(async () => {
  await loadDataset();
  await loadTraitIndex();
});

function fighterState(): BuilderState {
  return {
    ...emptyBuilderState(),
    name: 'Sheet Match',
    level: 5,
    ancestryId: 'dwarf',
    heritageId: 'forge-dwarf',
    classId: 'fighter',
    keyAbility: 'str',
    freeBoosts: ['str', 'dex', 'con', 'wis'],
  };
}

describe('sheetStats', () => {
  it('mirrors deriveCharacter for a site-built character (_pathwayBuild present)', () => {
    const state = fighterState();
    const d = deriveCharacter(state);
    const build = { _pathwayBuild: state } as unknown as PathbuilderBuild;

    expect(sheetStats.maxHp(build)).toBe(d.maxHp);
    expect(sheetStats.acTotal(build)).toBe(d.ac);
    expect(sheetStats.shieldBonus(build)).toBe(d.shieldBonus);
    expect(sheetStats.saveBonus(build, 'fortitude')).toBe(d.saves.fortitude);
    expect(sheetStats.saveBonus(build, 'reflex')).toBe(d.saves.reflex);
    expect(sheetStats.saveBonus(build, 'will')).toBe(d.saves.will);
    expect(sheetStats.perceptionBonus(build)).toBe(d.perception);
    expect(sheetStats.classDC(build)).toBe(d.classDc);
    expect(sheetStats.speed(build)).toBe(d.speed);
    expect(sheetStats.skillBonus(build, 'athletics')).toBe(
      d.skills.find((s) => s.id === 'athletics')!.modifier,
    );
    expect(sheetStats.isCoreDerived(build)).toBe(true);
  });

  it('exposes core senses & resistances for a site-built character', () => {
    const state = fighterState();
    const build = { _pathwayBuild: state } as unknown as PathbuilderBuild;
    // Dwarf → darkvision; Forge Dwarf → fire resistance floor(5/2)=2 at level 5.
    expect(sheetStats.senses(build).some((s) => s.type === 'darkvision')).toBe(true);
    expect(sheetStats.resistances(build).find((r) => r.type === 'fire')?.value).toBe(2);
  });

  it('falls back to pathbuilder math for base stats when there is no _pathwayBuild', () => {
    const build = {
      level: 1,
      ancestry: 'Human', // normal vision, no ancestry senses
      abilities: { con: 12 },
      attributes: { ancestryhp: 8, classhp: 10, bonushp: 0, bonushpPerLevel: 0 },
    } as unknown as PathbuilderBuild;

    expect(sheetStats.isCoreDerived(build)).toBe(false);
    expect(sheetStats.maxHp(build)).toBe(pb.maxHp(build));
  });

  it('enriches an IMPORTED character with senses & gap-filling resistances (by name)', () => {
    const build = {
      level: 5,
      ancestry: 'Dwarf',
      heritage: 'Forge Dwarf',
    } as unknown as PathbuilderBuild;

    // Base stats stay on Pathbuilder — we do NOT recompute them.
    expect(sheetStats.isCoreDerived(build)).toBe(false);
    // But senses come from the ancestry/heritage (Pathbuilder doesn't export them).
    expect(sheetStats.senses(build).some((s) => s.type === 'darkvision')).toBe(true);
    // Pathbuilder listed no resistances → core fills the Forge Dwarf fire one.
    expect(sheetStats.resistances(build).find((r) => r.type === 'fire')?.value).toBe(2);
  });

  it('defers entirely to Pathbuilder resistances when the import already lists them', () => {
    const build = {
      level: 5,
      ancestry: 'Dwarf',
      heritage: 'Forge Dwarf',
      resistances: ['fire 10'], // pathbuilder's own list is authoritative
    } as unknown as PathbuilderBuild;

    // No duplication — core adds nothing when Pathbuilder already has resistances.
    expect(sheetStats.resistances(build)).toEqual([]);
  });
});

describe('condition adjustments through the façade', () => {
  // Verifies the claim that conditions do NOT reach skills or attacks. Skills DO
  // flow; `attack` genuinely does not, because the sheet has no attack stat — the
  // selector is reserved and weapons compute their own numbers.
  const held = [
    { slug: 'clumsy', value: 1 },
    { slug: 'frightened', value: 2 },
  ] as const;

  it('reaches skills on a site-built character', () => {
    const state = fighterState();
    const build = { _pathwayBuild: state } as unknown as PathbuilderBuild;
    const adj = conditionModifiers([...held]);

    const base = sheetStats.skillBonus(build, 'stealth');
    // Clumsy 1 and Frightened 2 are both status penalties to Stealth → worst wins.
    expect(adj.get('stealth')).toBe(-2);
    expect(sheetStats.skillBonus(build, 'stealth', adj)).toBe(base - 2);
  });

  it('reaches skills on an IMPORTED character too (the pathbuilder path)', () => {
    const build = { level: 5, abilities: { dex: 16 }, proficiencies: { stealth: 4 } } as PathbuilderBuild;
    const adj = conditionModifiers([...held]);
    expect(sheetStats.skillBonus(build, 'stealth', adj)).toBe(sheetStats.skillBonus(build, 'stealth') - 2);
  });

  it('reaches AC, saves and Perception', () => {
    const state = fighterState();
    const build = { _pathwayBuild: state } as unknown as PathbuilderBuild;
    const adj = conditionModifiers([...held]);
    expect(sheetStats.acTotal(build, adj)).toBe((sheetStats.acTotal(build) ?? 0) - 2);
    expect(sheetStats.saveBonus(build, 'reflex', adj)).toBe(sheetStats.saveBonus(build, 'reflex') - 2);
    expect(sheetStats.perceptionBonus(build, adj)).toBe(sheetStats.perceptionBonus(build) - 2);
  });

  it('is a no-op when no condition touches the stat', () => {
    const state = fighterState();
    const build = { _pathwayBuild: state } as unknown as PathbuilderBuild;
    const adj = conditionModifiers([{ slug: 'clumsy', value: 1 }]);
    expect(sheetStats.skillBonus(build, 'athletics', adj)).toBe(sheetStats.skillBonus(build, 'athletics'));
  });
});

describe('the level- and sense-dependent conditions on the sheet', () => {
  it('Drained reduces max HP by level x value', () => {
    const state = fighterState(); // level 5
    const build = { _pathwayBuild: state } as unknown as PathbuilderBuild;
    const base = sheetStats.maxHp(build) ?? 0;
    const adj = conditionModifiers([{ slug: 'drained', value: 2 }], { level: 5 });
    expect(sheetStats.maxHp(build, adj)).toBe(base - 10);
  });

  it('floors max HP at 0 rather than going negative', () => {
    const build = { _pathwayBuild: fighterState() } as unknown as PathbuilderBuild;
    const adj = conditionModifiers([{ slug: 'drained', value: 99 }], { level: 99 });
    expect(sheetStats.maxHp(build, adj)).toBe(0);
  });

  it('Blinded penalises Perception for a character with no precise non-visual sense', () => {
    const state = fighterState();
    const build = { _pathwayBuild: state } as unknown as PathbuilderBuild;
    // A dwarf has darkvision, which is a vision sense — the proviso still holds.
    const tags = senseTags(sheetStats.senses(build));
    const adj = conditionModifiers([{ slug: 'blinded' }], { tags });
    expect(sheetStats.perceptionBonus(build, adj)).toBe(sheetStats.perceptionBonus(build) - 4);
  });
});
