// @pathway/core — the single source of truth for the PF2e domain.
//
// This package is PURE: no I/O, no database, no network, no Discord. It holds
// the content schema (Zod), the character model, and the derived-stat engine.
// The bot (apps/bot) and the web app (apps/web) both consume it so they can
// never disagree on a rules value. See root CLAUDE.md, "Architecture".
//
// Every function that needs game content takes a `Dataset` argument, so the app
// holding the bundled JSON passes it in; `createEngine(dataset)` binds it once.

// Content schema (Zod schemas + inferred types) + ability constants.
export * from './schema';

// The character model — the player's raw choices.
export * from './character';

// Canonical option ids the engine reads.
export * from './options';

// Subclass rules (traditions, racket ability, focus points, armor).
export * from './subclass';

// The derived-stat engine (dataset-parameterized).
export * from './engine';

// Spellcasting math for full casters.
export * from './spellcasting';

// createEngine(dataset): bind the engine to one dataset.
export * from './factory';
