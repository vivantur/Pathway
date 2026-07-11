import { describe, expect, it } from 'vitest';
import { FAMILIAR_ABILITIES } from './companion.js';
import {
  SPECIFIC_FAMILIARS,
  findSpecificFamiliar,
  grantedAbilitySlug,
} from './specificFamiliars.js';

describe('specific familiars (Player Core 2 pg. 170)', () => {
  it('ships the catalog with unique slugs', () => {
    expect(SPECIFIC_FAMILIARS.length).toBeGreaterThanOrEqual(35);
    const slugs = SPECIFIC_FAMILIARS.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every entry has a required count, granted abilities, and unique abilities', () => {
    for (const f of SPECIFIC_FAMILIARS) {
      expect(f.requiredAbilities).toBeGreaterThanOrEqual(1);
      expect(f.grantedAbilities.length).toBeGreaterThan(0);
      expect(f.uniqueAbilities.length).toBeGreaterThan(0);
      expect(f.source).toBeTruthy();
    }
  });

  it('worked examples: poppet requires 1; imp requires 7', () => {
    expect(findSpecificFamiliar('poppet')?.requiredAbilities).toBe(1);
    expect(findSpecificFamiliar('imp')?.requiredAbilities).toBe(7);
    expect(findSpecificFamiliar('nope')).toBeUndefined();
  });

  it('granted abilities map onto the familiar-ability catalog where they exist', () => {
    expect(grantedAbilitySlug('manual dexterity')).toBe('manual-dexterity');
    expect(grantedAbilitySlug('skilled (arcana, society)')).toBe('skilled');
    expect(grantedAbilitySlug('elemental (earth only)')).toBe('elemental');

    // Most granted entries should resolve to a real catalog slug (a few are
    // master abilities or variants that legitimately don't).
    const known = new Set(FAMILIAR_ABILITIES.map((a) => a.slug));
    const entries = SPECIFIC_FAMILIARS.flatMap((f) => f.grantedAbilities.map(grantedAbilitySlug));
    const resolved = entries.filter((s) => known.has(s));
    expect(resolved.length / entries.length).toBeGreaterThan(0.7);
  });
});
