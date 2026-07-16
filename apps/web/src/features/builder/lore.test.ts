// Tests for Lore skills and the bonus-language roster in the builder.
//
// Two long-standing gaps this locks down:
//  1. Lore skills — a background grants one, and a player can train more with
//     free skill slots. They must derive as Int-based trained skills and export
//     into the Pathbuilder `lores` array (not the standard skill map).
//  2. Bonus languages must be chosen from the FULL language roster, not a small
//     per-ancestry preset (Human's preset was empty — you could pick nothing).

import { beforeAll, describe, expect, it } from 'vitest';
import { allLanguages, getDataset, loadDataset } from '@/features/builder/data';
import { toPathbuilder } from '@/features/builder/pathbuilder';
import {
  backgroundLoreSubject,
  deriveCharacter,
  loreDisplayName,
  loreId,
  trainedLoreSubjects,
} from '@/features/builder/rules';
import { emptyBuilderState, type BuilderState } from '@/features/builder/types';

beforeAll(async () => {
  await loadDataset();
});

function human(extra: Partial<BuilderState> = {}): BuilderState {
  const ds = getDataset();
  const h = ds.ancestries.find((a) => a.id === 'human');
  const fighter = ds.classes.find((c) => c.id === 'fighter');
  if (!h || !fighter) throw new Error('dataset is missing human/fighter');
  return {
    ...emptyBuilderState(),
    level: 1,
    ancestryId: h.id,
    classId: fighter.id,
    keyAbility: 'str',
    freeBoosts: ['str', 'dex', 'con', 'int'],
    ...extra,
  };
}

describe('lore display + id normalisation', () => {
  it('renders a subject as a single "Lore"', () => {
    expect(loreDisplayName('Warfare')).toBe('Warfare Lore');
    expect(loreDisplayName('Warfare Lore')).toBe('Warfare Lore');
    expect(loreDisplayName('Academia Lore Lore')).toBe('Academia Lore'); // source junk
  });

  it('slugs a stable id', () => {
    expect(loreId('Warfare')).toBe('lore:warfare');
    expect(loreId('Plane of Metal')).toBe('lore:plane-of-metal');
  });
});

describe('chosen lore skills', () => {
  it('derives as an Int-based trained skill', () => {
    const state = human({ loreChoices: ['Warfare'] });
    const derived = deriveCharacter(state);
    const lore = derived.skills.find((s) => s.id === loreId('Warfare'));
    expect(lore).toBeDefined();
    expect(lore?.name).toBe('Warfare Lore');
    expect(lore?.ability).toBe('int');
    expect(lore?.rank).toBe(1);
    // Trained (rank 1) at level 1: prof bonus + Int mod. It must equal what the
    // engine computed for another trained Int skill of the same character.
    const intTrained = derived.skills.find((s) => s.ability === 'int' && s.rank === 1 && !s.id.startsWith('lore:'));
    if (intTrained) expect(lore?.modifier).toBe(intTrained.modifier);
  });

  it('de-duplicates subjects case-insensitively', () => {
    const state = human({ loreChoices: ['Warfare', 'warfare'] });
    expect(trainedLoreSubjects(state)).toEqual(['Warfare']);
  });

  it('exports into the Pathbuilder `lores` array, not the skill map', () => {
    const state = human({ loreChoices: ['Warfare'] });
    const { build } = toPathbuilder(state);
    expect(build.lores.some(([name]) => name === 'Warfare')).toBe(true);
    // The `lore:*` id must not leak into the standard skill-proficiency map.
    expect(Object.keys(build.proficiencies ?? {}).some((k) => k.startsWith('lore:'))).toBe(false);
    expect(build.lores.every(([name]) => !/lore$/i.test(name))).toBe(true);
  });
});

describe('background-granted lore', () => {
  it('cleans the source free-text and grants it for free (no slot spent)', () => {
    const ds = getDataset();
    const bg = ds.backgrounds.find((b) => b.loreSkill && !/choice|choose|gm/i.test(b.loreSkill));
    if (!bg) return; // dataset guard
    const state = human({ backgroundId: bg.id });
    const subject = backgroundLoreSubject(state);
    expect(subject).toBeTruthy();
    // It appears as a trained skill even with zero loreChoices.
    const derived = deriveCharacter(state);
    expect(derived.skills.some((s) => s.id === loreId(subject!))).toBe(true);
  });

  it('treats "your choice" backgrounds as no auto-lore', () => {
    const ds = getDataset();
    const bg = ds.backgrounds.find((b) => /choice/i.test(b.loreSkill ?? ''));
    if (!bg) return;
    expect(backgroundLoreSubject(human({ backgroundId: bg.id }))).toBeNull();
  });
});

describe('bonus-language roster', () => {
  it('offers the full roster, not an empty per-ancestry preset', () => {
    const langs = allLanguages();
    // A comprehensive, deduped, sorted list — far more than any one ancestry.
    expect(langs.length).toBeGreaterThan(20);
    expect(langs).toEqual([...new Set(langs)]);
    expect(langs).toContain('Draconic');
    // Human's own preset was empty; the roster must still give it real options.
    const human = getDataset().ancestries.find((a) => a.id === 'human');
    const pool = langs.filter((l) => !(human?.languages ?? []).includes(l));
    expect(pool.length).toBeGreaterThan(20);
  });
});
