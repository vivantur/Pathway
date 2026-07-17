// Regression test for the "empty override masks the real value" sheet bug.
//
// Every web-built character seeds `overlay.pathway_bot_state.edits.languages`
// (and .senses) to `[]`. The sheet used `edit ?? build.languages`, but
// `[] ?? x === []` — so the empty edit blanked out the languages the player
// actually chose. resolveListOverride treats an empty edit as "unset".

import { describe, expect, it } from 'vitest';
import { resolveListOverride } from './overrides';

describe('resolveListOverride', () => {
  it('falls through an empty edit to the real value (the reported bug)', () => {
    expect(resolveListOverride([], ['Common', 'Draconic'])).toEqual(['Common', 'Draconic']);
  });
  it('falls through null / undefined edits', () => {
    expect(resolveListOverride(undefined, ['Common'])).toEqual(['Common']);
    expect(resolveListOverride(null, ['Common'])).toEqual(['Common']);
  });
  it('a non-empty edit wins (a real GM/bot override)', () => {
    expect(resolveListOverride(['Undercommon'], ['Common'])).toEqual(['Undercommon']);
  });
  it('returns the (possibly empty) fallback when neither is set', () => {
    expect(resolveListOverride([], [])).toEqual([]);
  });
});
