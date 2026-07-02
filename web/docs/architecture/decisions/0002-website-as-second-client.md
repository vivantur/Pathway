# ADR 0002: The website is a second client on the bot's existing Supabase backend

- **Status:** Proposed
- **Date:** 2026-06-30
- **Phase:** W0 (Reconcile with the live backend)
- **Supersedes:** [ADR-0001](./0001-monorepo-with-shared-core.md)

## Context

ADR-0001 assumed Pathway was greenfield: a new monorepo would house the website,
a future bot, and a new I/O-free `core` rules package as the shared source of
truth. Reading the actual bot repository (`vivantur/pathway`, `Pathwayv2/`)
showed that assumption is false:

- The **Discord bot is already built and running in production** on Railway.
- It owns a **live Supabase (PostgreSQL 16) database** — prod
  `cmmwirlrvqmjqbydlqks`, develop `nqnswvuqszpkntnjzomv` — with a real schema
  holding users, characters, play state, and content.
- It already implements **Realtime-based sync** designed to react to web-app
  writes (the "Liv's bug" fix: subscribe-before-restore + per-row `updated_at`
  freshness checks).
- Its own docs reference **"the web app at `../web/`"** and place the canonical
  **Supabase migrations in `web/supabase/migrations/`** — i.e. the web repo owns
  the schema, the bot does not.
- The PF2e rules logic exists as **CommonJS JavaScript** in the bot
  (`src/rules/`, `src/lib/`), not as a shared TypeScript package.

The user's stated goal is explicit: *"the bot is already completely made and
functional, it just needs to be in sync with the website."*

## Decision

1. Treat `vivantur/pathway-website` (this repo) as the bot's `web/` companion
   app: **a separate repository and a second client** on the **existing**
   Supabase backend — not a monorepo that contains or rebuilds the bot.
2. **Conform to the existing schema** (see `docs/architecture/data-model.md`)
   rather than designing a new one. The live database is the source of truth.
3. Make **sync a contract the website honors**, not a new subsystem
   (see `docs/architecture/web-bot-sync.md`): same Supabase project, same
   `users` row (`auth.uid()` + `discord_id`), anon key under RLS, correct
   column shape for `characters`, and `updated_at` on every write.
4. **Do not build a greenfield `core` package up front.** Decide rules-logic
   reuse per feature: re-derive in TS, rely on persisted DB columns as the
   contract, or (later, if worthwhile) extract a shared package from the bot's
   existing JS.
5. **Adopt `supabase/migrations/` in this repo** as the canonical schema home,
   back-filling already-applied migrations, and preserve the bot's RLS/Realtime
   invariants in every future migration.

## Alternatives considered

- **Keep ADR-0001 (greenfield monorepo + new core).** Rejected: it would mean
  re-implementing or absorbing a working production system and migrating a live
  database for no benefit, with high risk of desyncing real user data.
- **Have the website run its own database and sync via an integration layer.**
  Rejected: two stores means building and maintaining real two-way sync,
  reconciliation, and conflict resolution — exactly the work the single shared
  Supabase backend already avoids. The bot already treats Supabase as the sole
  source of truth.
- **Port the bot's rules logic to a shared TS package now, as a prerequisite.**
  Rejected as a blocker (adopted as a *later option*): valuable eventually, but
  porting battle-tested JS up front delays every web feature and risks
  introducing math drift. The DB-as-contract approach covers persisted values
  today.

## Consequences

- **Easier:** sync is largely inherent (one row, two clients; bot already
  listens); no new backend; immediate access to real characters/content for the
  web UI; the master spec's feature vision is unchanged, just re-sequenced.
- **Harder / constraints created:**
  - The website **must** match exact column shapes (esp. the
    `pathbuilder_data` vs. live-state-columns split) and set `updated_at`, or it
    will fight the bot. This is now a hard review checklist item.
  - The website **must never** ship the service-role key to the browser; it uses
    the anon key under RLS.
  - Schema changes are authored here but **coordinated with the bot**, which
    caches table shapes in `state/*` modules.
  - Two-edition rules logic (JS in bot, TS in web) can drift until/unless a
    shared package is extracted; mitigated by leaning on DB columns for
    persisted values.
- **Follow-ups (ADRs):** Discord ⇄ web identity unification (Phase W1);
  whether the website talks to Supabase directly or via a thin Express API
  (affects privileged ops + PDF export); back-fill plan for existing migrations.
