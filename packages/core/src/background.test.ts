// Worked-example tests for the background schema + adapter.
//
// Acrobat (the ~95% case: restricted-choice + free boosts, a trained skill, a Lore,
// a skill feat) and Blessed (the edge: Rare, NO trained skill — only a Lore — and a
// spell grant instead of a skill feat) cover almost every background. Rules text is
// from the prompt (rules-from-source).

import { describe, it, expect } from 'vitest';
import { coerceBackground, type Background } from './background.js';

function background(raw: unknown): Background {
  const r = coerceBackground(raw);
  if (!r.ok) throw new Error(`coerceBackground failed: ${r.issues.join(' | ')}`);
  return r.background;
}

describe('coerceBackground — worked examples', () => {
  it('Acrobat: restricted-choice + free boosts, trained skill, Lore, skill feat', () => {
    const b = background({
      name: 'Acrobat',
      source: 'Player Core pg. 84',
      boosts: [['Strength', 'Dexterity'], 'Free'],
      trainedSkill: 'Acrobatics',
      loreSkill: 'Circus',
      skillFeat: 'Steady Balance',
      description: 'In a circus or on the streets, you earned your pay by performing as an acrobat.',
    });

    expect(b).toEqual({
      id: 'acrobat',
      version: 1,
      name: 'Acrobat',
      ownerKind: 'official',
      source: { title: 'Player Core', page: 84 },
      rarity: 'common',
      traits: [],
      isLegacy: false,
      boosts: [['str', 'dex'], 'free'],
      trainedSkill: 'Acrobatics',
      loreSkill: 'Circus',
      skillFeat: 'Steady Balance',
      description: 'In a circus or on the streets, you earned your pay by performing as an acrobat.',
    });
  });

  it('Blessed: Rare, only a Lore skill (no trained skill), no skill feat', () => {
    const b = background({
      name: 'Blessed',
      traits: 'Rare',
      source: 'Player Core 2 pg. 52',
      boosts: [['Wisdom', 'Charisma'], 'Free'],
      loreSkill: 'deity-associated',
      description: 'You have been blessed by a divinity.',
    });

    expect(b.rarity).toBe('rare');
    expect(b.boosts).toEqual([['wis', 'cha'], 'free']);
    expect(b.trainedSkill).toBeUndefined();
    expect(b.skillFeat).toBeUndefined();
    expect(b.loreSkill).toBe('deity-associated');
    expect(b.source).toEqual({ title: 'Player Core 2', page: 52 });
  });
});

describe('coerceBackground — rejections', () => {
  it('rejects a background with no name', () => {
    const r = coerceBackground({ boosts: [], description: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/name/);
  });

  it('rejects a background with no description', () => {
    const r = coerceBackground({ name: 'X', source: 'Book pg. 1', boosts: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join(' ')).toMatch(/description/);
  });
});
