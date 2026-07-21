// Tests for rules/toggles.js — the bot's read of a character's active player
// toggles from `overlay.web_edits.toggles`. Pure string/lookup logic, so these
// exercise it directly.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { activeToggles, humanize } = require('../src/rules/toggles');

const withToggles = (toggles) => ({ overlay: { web_edits: { toggles } } });

describe('activeToggles', () => {
  it('lists a plain switch that is on, humanizing the slug', () => {
    expect(activeToggles(withToggles({ 'dragon-stance': true }))).toEqual([
      { option: 'dragon-stance', variant: null, display: 'Dragon Stance' },
    ]);
  });

  it('shows the chosen variant for a picker', () => {
    expect(activeToggles(withToggles({ 'deflecting-wave': 'acid' }))).toEqual([
      { option: 'deflecting-wave', variant: 'acid', display: 'Deflecting Wave: Acid' },
    ]);
  });

  it('omits switches that are off', () => {
    expect(activeToggles(withToggles({ a: false, b: '', c: true }))).toEqual([
      { option: 'c', variant: null, display: 'C' },
    ]);
  });

  it('returns a stable, sorted order regardless of key order', () => {
    const list = activeToggles(withToggles({ zeal: true, agile: true, mobile: true }));
    expect(list.map((t) => t.display)).toEqual(['Agile', 'Mobile', 'Zeal']);
  });

  it('is empty when nothing is toggled, and when the slot is absent', () => {
    expect(activeToggles(withToggles({}))).toEqual([]);
    expect(activeToggles({ overlay: {} })).toEqual([]);
    expect(activeToggles({})).toEqual([]);
    expect(activeToggles(undefined)).toEqual([]);
  });

  it('does not throw on malformed state', () => {
    // A bad overlay must never break /use — it just yields no stances.
    expect(activeToggles(withToggles(null))).toEqual([]);
    expect(activeToggles(withToggles('nonsense'))).toEqual([]);
    expect(activeToggles(withToggles(['not', 'an', 'object']))).toEqual([]);
  });
});

describe('humanize', () => {
  it('title-cases a hyphen/colon slug', () => {
    expect(humanize('dragon-stance')).toBe('Dragon Stance');
    expect(humanize('spellshape:reach-spell')).toBe('Spellshape Reach Spell');
  });
});

describe('the /use embed surfaces active stances', () => {
  const { buildUseEmbed } = require('../src/commands/use/embed');
  const base = {
    action: { name: 'Dragon Claw' },
    costLabel: '',
    narration: { lines: ['You strike.'], aborted: false, warnings: [] },
    applied: { lines: [], skipped: [] },
    seed: 1,
  };
  const fieldNames = (embed) => (embed.data.fields ?? []).map((f) => f.name);

  it('adds an "Active stances" field when toggles are on', () => {
    const embed = buildUseEmbed({
      ...base,
      charEntry: withToggles({ 'dragon-stance': true, 'deflecting-wave': 'acid' }),
    });
    const stances = (embed.data.fields ?? []).find((f) => f.name === 'Active stances');
    expect(stances?.value).toBe('• Deflecting Wave: Acid\n• Dragon Stance');
  });

  it('omits the field entirely when no stance is active', () => {
    const embed = buildUseEmbed({ ...base, charEntry: withToggles({}) });
    expect(fieldNames(embed)).not.toContain('Active stances');
  });
});
