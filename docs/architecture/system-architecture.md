# System Architecture

> Status: **Draft for review** · Phase 0 (Planning) · Companion to the
> [Master Specification](../../PATHWAY_MASTER_SPEC.md).

This document describes how Pathway's pieces fit together. It is intentionally
high-level and decision-oriented: it explains *what* the major components are,
*why* they are split the way they are, and the *tradeoffs* behind each choice.
It does not prescribe file-by-file implementation — that belongs to each phase's
build step.

---

## 1. Guiding principle: one platform, two front doors

The single most important architectural constraint comes straight from the
spec: **the website and the Discord bot are equal citizens.** Neither is a
wrapper around the other. They are two clients of the same platform.

```
        ┌─────────────┐        ┌─────────────┐
        │   Website   │        │ Discord Bot │
        │ (React/Vite)│        │  (Node.js)  │
        └──────┬──────┘        └──────┬──────┘
               │                      │
               │   HTTPS / WSS        │  Gateway + same HTTPS API
               └───────────┬──────────┘
                           ▼
                 ┌───────────────────┐
                 │   Pathway API     │  Express + TypeScript (Railway)
                 │  REST + realtime  │
                 └─────────┬─────────┘
                           │
              ┌────────────┼─────────────┐
              ▼            ▼             ▼
         ┌─────────┐  ┌─────────┐   ┌──────────┐
         │Postgres │  │  Auth   │   │ Storage  │   Supabase
         │  (RLS)  │  │         │   │ (assets) │
         └─────────┘  └─────────┘   └──────────┘
```

**Why this shape:** if business logic (e.g. "compute a character's AC", "apply
a condition", "validate a feat prerequisite") lived in the website, the bot
would have to re-implement it and the two would drift. Instead, rules logic and
data access live behind the API and in a shared core library. Both clients call
the same endpoints and reuse the same calculation engine.

---

## 2. Repository strategy: monorepo

Pathway is naturally several deployables (web app, API, bot) that share a lot of
code (PF2e types, rules engine, validation, API client). A **monorepo** keeps
that shared code honest and versioned together.

Proposed layout (target — not yet created):

```
pathway/
├── apps/
│   ├── web/          # React + Vite + Tailwind  → Vercel
│   ├── api/          # Express + TypeScript      → Railway
│   └── bot/          # Discord bot               → Railway
├── packages/
│   ├── core/         # PF2e domain model + rules engine (pure, no I/O)
│   ├── schema/       # Zod schemas + shared TypeScript types
│   ├── api-client/   # Typed client used by web + bot
│   └── ui/           # Shared React components (grimoire design system)
├── supabase/         # Migrations, RLS policies, seed scripts
└── docs/             # Architecture, ADRs, roadmap
```

**Tradeoff:** a monorepo adds tooling overhead (workspace config, shared build
caching) but eliminates the far worse problem of three copies of the rules
engine. Tooling decision (npm/pnpm/turbo) is deferred to an ADR in the
foundation phase; the structure above is what matters now.

### The `core` package is the crown jewel

`packages/core` holds the **PF2e domain model and rules engine** as pure
functions with no database or network dependencies. Given a character's raw
choices (ancestry, class, level history, feats, items) it produces a fully
computed sheet (modifiers, AC, saves, skills, spell DCs). Because it is pure:

- The website can run it for instant, offline-ready recalculation.
- The bot can run it for `/sheet` style commands.
- The API can run it server-side as the source of truth.
- It is trivially unit-testable against PF2e rules.

---

## 3. Data layer: Supabase + Row Level Security

Postgres via Supabase is the single store. The key decision is to lean on
**Row Level Security (RLS)** as the primary authorization mechanism rather than
scattering permission checks across application code.

- Every row that belongs to a user, campaign, or organization carries owner /
  scope columns.
- RLS policies enforce *who can read/write* at the database level.
- The API and bot authenticate as the acting user (via Supabase Auth JWTs), so
  the same policies protect both clients automatically.

**Why:** with two clients and later a public API + plugins, centralizing
authorization in the database is the only way to avoid a permission bug in one
client silently exposing data. Application code still validates *business*
rules; RLS guarantees *access* rules.

See the [Data Model](./data-model.md) for entities and scoping columns.

---

## 4. Rules content pipeline (Archive of Nethys)

The rules library (spells, feats, monsters, items, conditions, traits) is
**ingested**, not authored. The spec calls for a *scheduled Archive of Nethys
import with attribution and a review workflow*. Architecturally this is an
isolated pipeline:

```
AoN source ──▶ Importer (scheduled job) ──▶ Staging tables ──▶ Review queue ──▶ Published rules tables
                                                                  (human approve)
```

- Imports land in **staging**, never directly in published tables.
- A reviewer approves/rejects diffs; attribution + source metadata travel with
  every record.
- Published rules are read-only to normal users and serve both clients.

**Why staging + review:** licensing/attribution correctness and data quality
matter, and an automated scrape writing straight to production rules would be
unreviewable and risky. This pipeline is its own phase.

---

## 5. Homebrew, campaigns, and scoping

Homebrew content mirrors the shape of official rules but carries a **visibility
scope**: Private / Campaign / Organization / Public. The same `core` engine
must treat an approved public homebrew feat the same way it treats an official
one. This implies official and homebrew content share a common interface
(type + validation), differing only in source, scope, and moderation state.

Campaigns and organizations are **permission containers**: they own NPCs,
encounters, journals, loot, quests, and shared homebrew, and they grant roles
(player, GM, org admin) that RLS policies key off of.

---

## 6. Synchronization (website ⇄ Discord bot)

Two-way sync is not a separate datastore — it is the consequence of both clients
sharing one backend. A character edited on the website is immediately visible to
the bot because there is only one record. Where "sync" needs real work:

- **Realtime push:** Supabase Realtime / WebSocket channels notify the website
  and bot of changes to entities they're viewing (e.g. live combat tracker).
- **Linking identities:** a Discord user must be linked to a Pathway account
  (OAuth) so the bot acts with that user's permissions.
- **Conflict handling:** last-write-wins with an audit log for character edits;
  the spec already calls for a level history + audit log, which doubles as the
  conflict record.

---

## 7. Export / import & compatibility

- **Pathbuilder-compatible JSON** and **PDF export** are output adapters over
  the computed sheet from `core`. Keeping them as adapters (not baked into the
  builder) means the bot can export too.
- **PDF export** runs server-side (API) so output is identical regardless of
  client.

---

## 8. Cross-cutting concerns

| Concern | Approach |
| --- | --- |
| **Auth** | Supabase Auth (email + Discord OAuth). JWTs carry identity to API, bot, RLS. |
| **Authorization** | RLS in Postgres is the source of truth; app code adds business validation. |
| **Payments** | Stripe-ready: billing tables + webhook endpoint stubbed; entitlement checks gated behind a whitelist flag initially. |
| **Public API & plugins** | The same Express API, versioned (`/v1`), with scoped API keys. Plugins run against this surface — never direct DB access. |
| **Offline** | The pure `core` engine + local cache enable offline character sheets; writes queue and reconcile on reconnect. |
| **Observability** | Structured logging + error tracking on API and bot from day one (cheap to add early, painful to retrofit). |
| **Localization** | All user-facing strings go through an i18n layer from the start, even if only `en` ships first. |

---

## 9. What this document deliberately leaves open

These are flagged as upcoming ADRs, not decided here:

1. Monorepo tooling (pnpm workspaces vs. Turborepo vs. Nx).
2. Realtime transport (Supabase Realtime vs. dedicated WS service on Railway).
3. Rules engine modeling approach (data-driven effects vs. coded rules).
4. PDF generation library/approach.
5. Search backend for the rules library (Postgres full-text vs. dedicated index).

Each will get an [ADR](./decisions/) before its phase is built.
