/**
 * The builder's character model now lives in `@pathway/core` (so the bot and web
 * agree on the shape). Re-exported here so existing `from './types'` imports
 * across the builder keep resolving.
 */
export type { BuilderState, LevelGains, InventoryEntry, StepId } from '@pathway/core';
export { emptyBuilderState, emptyLevelGains } from '@pathway/core';
