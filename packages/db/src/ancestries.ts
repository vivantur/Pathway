// Ancestry + heritage stores over @pathway/core's coerceAncestry / coerceHeritage.
// Heritages are their own entity (standalone rows; empty ancestryId = versatile).

import { coerceAncestry, coerceHeritage, type Ancestry, type Heritage } from '@pathway/core';
import { makeContentStore } from './content-store.js';

export const ancestryStore = makeContentStore<Ancestry>('ancestries', (raw) => {
  const r = coerceAncestry(raw);
  return r.ok ? { ok: true, item: r.ancestry } : { ok: false, issues: r.issues };
});

export const heritageStore = makeContentStore<Heritage>('heritages', (raw) => {
  const r = coerceHeritage(raw);
  return r.ok ? { ok: true, item: r.heritage } : { ok: false, issues: r.issues };
});
