import { createEngine } from '@pathway/core';
import { getDataset } from './data';

/**
 * The PF2e rules engine (from `@pathway/core`) bound to the app's bundled
 * dataset. Every derived value the web app shows comes from here — no rules
 * math is computed in `apps/web`. The `rules.ts` / `spellcasting.ts` modules
 * re-export this engine's functions so existing imports keep working.
 */
export const engine = createEngine(getDataset());
