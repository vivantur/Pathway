import { describe, expect, it } from 'vitest';
import { buildFallbackIndex, resolveFallbackRow } from './useFeatFallback';
import type { FeatRow } from './types';

const row = (name: string): FeatRow => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name });

describe('resolveFallbackRow', () => {
  const index = buildFallbackIndex([
    row('Halo'),
    row('Blessed Blood (Sorcerer)'),
    row('Blessed Blood (Nephilim)'),
    row('Animal Companion'),
    row('Animal Companion (Ranger)'),
    row('Nephilim'),
  ]);

  it('matches an exact name', () => {
    expect(resolveFallbackRow(index, 'Halo')?.name).toBe('Halo');
    expect(resolveFallbackRow(index, 'nephilim')?.name).toBe('Nephilim'); // case-insensitive
  });

  it('matches a bare name against a single suffixed variant', () => {
    // "Blessed Blood" collides, but with a Sorcerer hint we get the right one.
    expect(resolveFallbackRow(index, 'Blessed Blood', ['Sorcerer'])?.name).toBe(
      'Blessed Blood (Sorcerer)',
    );
    expect(resolveFallbackRow(index, 'Blessed Blood', ['Human', 'Nephilim'])?.name).toBe(
      'Blessed Blood (Nephilim)',
    );
  });

  it('prefers the unsuffixed canonical variant when no hint matches', () => {
    expect(resolveFallbackRow(index, 'Animal Companion', ['Wizard'])?.name).toBe(
      'Animal Companion',
    );
  });

  it('returns null when nothing matches', () => {
    expect(resolveFallbackRow(index, 'Totally Made Up Feat')).toBeNull();
  });
});
