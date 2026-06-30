# ADR 0001: Monorepo with a shared, I/O-free `core` rules engine

- **Status:** ❌ Superseded by [ADR-0002](./0002-website-as-second-client.md)
- **Date:** 2026-06-30
- **Phase:** 0 → enables Phase 1 (Foundation)

> **Superseded.** This ADR was written before we learned the Discord bot and its
> Supabase backend already exist in production. Its central premise — a greenfield
> monorepo containing both clients and a brand-new shared `core` package — does
> not match reality. The website is a separate repo joining an existing backend,
> and the rules logic already lives in the bot as CommonJS. Kept for history;
> see ADR-0002 for the decision that replaces it.

## Context

The Master Specification requires that the **website and Discord bot are equal
citizens** sharing the same backend, database, permissions, APIs, and
synchronization. Both clients need identical Pathfinder 2e behavior — the same
character math, the same feat-prerequisite validation, the same handling of
official and homebrew content.

There are three deployable applications (web, API, bot) and a large amount of
logic and types they must share. The central risk is **drift**: if the rules
logic is implemented per client, the bot and website will disagree, and bugs
will be near-impossible to keep in sync.

## Decision

1. Use a **monorepo** containing `apps/` (web, api, bot) and `packages/`
   (`core`, `schema`, `api-client`, `ui`).
2. Implement the PF2e domain model and rules calculations in **`packages/core`
   as pure functions with no database or network I/O.** It takes raw character
   `build` data in and returns a fully computed sheet out.
3. All three apps depend on `core` and `schema`; neither the website nor the bot
   re-implements rules logic.

Specific tooling (pnpm/Turborepo/Nx), realtime transport, and the engine's
internal modeling are deferred to their own ADRs in Phase 1+.

## Alternatives considered

- **Separate repos per app, shared via published npm packages.**
  Pro: clean deploy boundaries. Con: version skew between repos, slow iteration,
  and the shared core is the thing changing most — publishing on every change is
  painful. Rejected.
- **Logic lives in the API only; clients are thin.**
  Pro: one implementation. Con: defeats offline-ready sheets and instant
  client-side recalculation (both in the spec), and makes the bot chatty.
  Partially adopted — the API *also* runs `core` as the server-side source of
  truth — but `core` being a shared package lets clients run it too.
- **Polyrepo with duplicated logic.** Rejected outright: guarantees drift.

## Consequences

- **Easier:** one place to fix a rules bug; trivially unit-testable engine;
  offline + client-side recompute become possible; the bot is a thin client.
- **Harder:** monorepo tooling and CI must be set up in Phase 1 (workspace
  config, shared build/test). This is the next ADR.
- **Constraint created:** `core` must stay pure — no Supabase, no `fetch`, no
  env access. Anything needing I/O lives in `apps/api` or adapters, not `core`.
- **Follow-ups:** ADR-0002 (monorepo tooling), ADR for the rules-engine
  modeling approach (data-driven effects vs. coded rules) before Phase 3.
