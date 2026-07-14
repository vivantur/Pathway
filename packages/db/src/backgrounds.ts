// Background store over @pathway/core's coerceBackground.

import { coerceBackground, type Background } from '@pathway/core';
import { makeContentStore } from './content-store.js';

export const backgroundStore = makeContentStore<Background>('backgrounds', (raw) => {
  const r = coerceBackground(raw);
  return r.ok ? { ok: true, item: r.background } : { ok: false, issues: r.issues };
});
