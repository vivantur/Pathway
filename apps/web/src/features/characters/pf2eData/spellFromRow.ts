// The single web-side seam for interpreting a Supabase `spells` row.
//
// Every place the web reads a spell row (the Rules Library, the sheet's add-a-
// spell picker, the sheet's expandable detail card) used to guess defensively
// — `rank ?? level ?? spell_level`, `saving_throw ?? save`, etc. That guessing
// is the drift this consolidates: all of it now runs through @pathway/core's
// `coerceSpell`, so the web and the bot interpret a spell the same way.
//
// Fields that are pure display passthroughs with no interpretation (aon_url,
// trigger) stay raw-row reads at the call sites — they aren't rules values and
// carry no drift, so they don't belong in core.

import {
  coerceSpell,
  type ActionCost,
  type Defense,
  type HeightenEntry,
  type Spell,
} from '@pathway/core';

/** Coerce a raw spells row into the canonical Spell, or null if it can't. */
export function coerceSpellRow(row: unknown): Spell | null {
  const res = coerceSpell(row);
  return res.ok ? res.spell : null;
}

/** English ordinal: 1→"1st", 2→"2nd", 3→"3rd", 4→"4th", 11→"11th". */
function ordinal(n: number): string {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

/** Canonical action cost → a short display string ("2 actions", "1 to 3 actions"). */
export function formatActionCost(ac: ActionCost | undefined): string | null {
  if (!ac) return null;
  switch (ac.kind) {
    case 'reaction':
      return 'reaction';
    case 'free':
      return 'free action';
    case 'time':
      return ac.text;
    case 'actions':
      return ac.min === ac.max
        ? `${ac.min} action${ac.min === 1 ? '' : 's'}`
        : `${ac.min} to ${ac.max} actions`;
  }
}

/** One defense → display ("AC", "basic Reflex", "Will"). */
export function formatDefense(d: Defense): string {
  if (d.kind === 'ac') return 'AC';
  const save = d.save.charAt(0).toUpperCase() + d.save.slice(1);
  return `${d.basic ? 'basic ' : ''}${save}`;
}

/** All defenses → one display string (the and/or nuance lives in the description). */
export function formatDefenses(defenses: Defense[]): string | null {
  return defenses.length ? defenses.map(formatDefense).join(', ') : null;
}

/** Structured heightening → the markdown text the detail views already render. */
export function formatHeightening(entries: HeightenEntry[]): string | null {
  if (!entries.length) return null;
  return entries
    .map((e) =>
      e.kind === 'interval'
        ? `**Heightened (+${e.step})** ${e.effect}`
        : `**Heightened (${ordinal(e.rank)})** ${e.effect}`,
    )
    .join('\n\n');
}
