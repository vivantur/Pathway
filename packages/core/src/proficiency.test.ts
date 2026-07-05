import { describe, it, expect } from 'vitest';
import {
  PROFICIENCY_PROGRESSION,
  proficiencyRankAtLevel,
  type ProficiencyTrack,
} from './proficiency';

describe('proficiencyRankAtLevel', () => {
  it('returns the base rank before any increase', () => {
    // Fighter: martial-weapon class, will trained (1) at level 1, expert (2) at 3.
    expect(proficiencyRankAtLevel('fighter', 'will', 1)).toBe(1);
    expect(proficiencyRankAtLevel('fighter', 'will', 2)).toBe(1);
  });

  it('applies an increase exactly at its level, not before', () => {
    expect(proficiencyRankAtLevel('fighter', 'will', 2)).toBe(1);
    expect(proficiencyRankAtLevel('fighter', 'will', 3)).toBe(2);
    expect(proficiencyRankAtLevel('fighter', 'will', 20)).toBe(2);
  });

  it('walks multiple increases and holds at the last one', () => {
    // Fighter Fortitude: expert (2) from level 1, master (3) at 9.
    expect(proficiencyRankAtLevel('fighter', 'fortitude', 8)).toBe(2);
    expect(proficiencyRankAtLevel('fighter', 'fortitude', 9)).toBe(3);
    expect(proficiencyRankAtLevel('fighter', 'fortitude', 20)).toBe(3);
  });

  it('models full-caster spellcasting progression (wizard)', () => {
    // Trained (1) → expert (2) at 7 → master (3) at 15 → legendary (4) at 19.
    expect(proficiencyRankAtLevel('wizard', 'spellcasting', 1)).toBe(1);
    expect(proficiencyRankAtLevel('wizard', 'spellcasting', 6)).toBe(1);
    expect(proficiencyRankAtLevel('wizard', 'spellcasting', 7)).toBe(2);
    expect(proficiencyRankAtLevel('wizard', 'spellcasting', 15)).toBe(3);
    expect(proficiencyRankAtLevel('wizard', 'spellcasting', 19)).toBe(4);
  });

  it('models class DC progression', () => {
    // Fighter class DC: trained (1) → expert (2) at 11 → master (3) at 19.
    expect(proficiencyRankAtLevel('fighter', 'classDC', 10)).toBe(1);
    expect(proficiencyRankAtLevel('fighter', 'classDC', 11)).toBe(2);
    expect(proficiencyRankAtLevel('fighter', 'classDC', 19)).toBe(3);
  });

  it('gives the champion legendary armor at 17', () => {
    for (const track of ['light', 'medium', 'heavy', 'unarmored'] as ProficiencyTrack[]) {
      expect(proficiencyRankAtLevel('champion', track, 16)).toBe(3);
      expect(proficiencyRankAtLevel('champion', track, 17)).toBe(4);
    }
  });

  it('does NOT grant a barbarian heavy-armor proficiency (shared-feature scoping)', () => {
    // Barbarians never train heavy armor; the shared "Armor Mastery" item lists
    // heavy only in the Champion/Fighter sections. Regression guard for that.
    for (let level = 1; level <= 20; level += 1) {
      expect(proficiencyRankAtLevel('barbarian', 'heavy', level)).toBe(0);
    }
  });

  it('leaves monk saves at level-1 rank (choice-based Path to Perfection unmodeled)', () => {
    // Monk saves start expert (2); Path to Perfection is a player choice we
    // deliberately do not apply, so they stay at 2 across all levels.
    for (const track of ['fortitude', 'reflex', 'will'] as ProficiencyTrack[]) {
      expect(proficiencyRankAtLevel('monk', track, 20)).toBe(2);
    }
  });

  it('returns 0 for unknown class or track', () => {
    expect(proficiencyRankAtLevel('bogus-class', 'will', 5)).toBe(0);
  });

  it('never decreases as level rises, for every class and track', () => {
    for (const [classId, prog] of Object.entries(PROFICIENCY_PROGRESSION)) {
      for (const track of Object.keys(prog) as ProficiencyTrack[]) {
        let last = -1;
        for (let level = 1; level <= 20; level += 1) {
          const rank = proficiencyRankAtLevel(classId, track, level);
          expect(rank).toBeGreaterThanOrEqual(last);
          last = rank;
        }
      }
    }
  });

  it('covers all 26 builder classes with all ten tracks', () => {
    expect(Object.keys(PROFICIENCY_PROGRESSION)).toHaveLength(26); // incl. playtest necromancer
    const tracks: ProficiencyTrack[] = [
      'perception', 'fortitude', 'reflex', 'will', 'classDC',
      'spellcasting', 'unarmored', 'light', 'medium', 'heavy',
    ];
    for (const prog of Object.values(PROFICIENCY_PROGRESSION)) {
      for (const track of tracks) expect(prog[track]).toBeDefined();
    }
  });
});

import { attackRankAtLevel } from './proficiency';

describe('attackRankAtLevel — weapon proficiency progression', () => {
  it('barbarian: Brutality (5) expert, Weapon Fury (13) master', () => {
    expect(attackRankAtLevel('barbarian', { category: 'martial' }, 4)).toBe(0); // pre-bump: initial rank rules
    expect(attackRankAtLevel('barbarian', { category: 'martial' }, 5)).toBe(2);
    expect(attackRankAtLevel('barbarian', { category: 'martial' }, 13)).toBe(3);
  });

  it('fighter class-wide: Weapon Legend (13) master s/m + expert advanced; Versatile Legend (19)', () => {
    expect(attackRankAtLevel('fighter', { category: 'martial' }, 12)).toBe(0);
    expect(attackRankAtLevel('fighter', { category: 'martial' }, 13)).toBe(3);
    expect(attackRankAtLevel('fighter', { category: 'advanced' }, 13)).toBe(2);
    expect(attackRankAtLevel('fighter', { category: 'martial' }, 19)).toBe(4);
  });

  it('fighter chosen group: master (5), legendary (13) — only for the chosen group', () => {
    const sword = { category: 'martial' as const, group: 'sword', chosenGroup: 'sword' };
    expect(attackRankAtLevel('fighter', sword, 5)).toBe(3);
    expect(attackRankAtLevel('fighter', sword, 13)).toBe(4);
    const axeNotChosen = { category: 'martial' as const, group: 'axe', chosenGroup: 'sword' };
    expect(attackRankAtLevel('fighter', axeNotChosen, 5)).toBe(0); // stays at initial expert via max()
    expect(attackRankAtLevel('fighter', axeNotChosen, 13)).toBe(3);
  });

  it('gunslinger: firearm/crossbow scope is fixed, not chosen', () => {
    expect(attackRankAtLevel('gunslinger', { category: 'martial', group: 'firearm' }, 5)).toBe(3);
    expect(attackRankAtLevel('gunslinger', { category: 'martial', group: 'firearm' }, 13)).toBe(4);
    expect(attackRankAtLevel('gunslinger', { category: 'advanced', group: 'crossbow' }, 5)).toBe(2);
    expect(attackRankAtLevel('gunslinger', { category: 'martial', group: 'sword' }, 5)).toBe(2);
  });

  it('rogue named list: rapier rides Weapon Tricks; other martial weapons do not', () => {
    expect(attackRankAtLevel('rogue', { category: 'martial', name: 'rapier' }, 5)).toBe(2);
    expect(attackRankAtLevel('rogue', { category: 'martial', name: 'rapier' }, 13)).toBe(3);
    expect(attackRankAtLevel('rogue', { category: 'martial', name: 'longsword' }, 13)).toBe(0);
  });

  it('wizard: only the named list improves (simple stays trained)', () => {
    expect(attackRankAtLevel('wizard', { category: 'simple', name: 'staff' }, 11)).toBe(2);
    expect(attackRankAtLevel('wizard', { category: 'simple', name: 'mace' }, 11)).toBe(0);
  });

  it('cleric: no class-wide weapon increases (doctrine-scoped)', () => {
    expect(attackRankAtLevel('cleric', { category: 'simple' }, 20)).toBe(0);
  });
});
