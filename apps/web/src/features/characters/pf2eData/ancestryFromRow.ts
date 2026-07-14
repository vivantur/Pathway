// Web-side seam for interpreting Supabase ancestry / background rows — the analog
// of spellFromRow.ts. All interpretation runs through @pathway/core so the web and
// any other consumer read an ancestry/background the same way.

import {
  coerceAncestry,
  coerceBackground,
  coerceFeat,
  type Ancestry,
  type Background,
  type Feat,
} from '@pathway/core';

export function coerceAncestryRow(row: unknown): Ancestry | null {
  const r = coerceAncestry(row);
  return r.ok ? r.ancestry : null;
}

export function coerceBackgroundRow(row: unknown): Background | null {
  const r = coerceBackground(row);
  return r.ok ? r.background : null;
}

export function coerceFeatRow(row: unknown): Feat | null {
  const r = coerceFeat(row);
  return r.ok ? r.feat : null;
}

/** "Player Core" + page → "Player Core pg. 43". */
export function sourceLabel(source: { title: string; page?: number }): string {
  return source.page ? `${source.title} pg. ${source.page}` : source.title;
}

/** 'medium' → 'Medium'. */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
