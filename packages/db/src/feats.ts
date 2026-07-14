// Feat store over @pathway/core's coerceFeat.

import { coerceFeat, type Feat } from '@pathway/core';
import { makeContentStore } from './content-store.js';

export const featStore = makeContentStore<Feat>('feats', (raw) => {
  const r = coerceFeat(raw);
  return r.ok ? { ok: true, item: r.feat } : { ok: false, issues: r.issues };
});
