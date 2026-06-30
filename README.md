# Pathway

> The definitive digital companion for Pathfinder Second Edition.

Pathway is a complete ecosystem for Pathfinder 2e — a character builder, rules
library, campaign manager, homebrew workshop, and Discord bot that all share one
backend, database, and synchronization layer. The website and the Discord bot
are **equal citizens** of the platform.

This repository is the **`web/` companion app** to the Pathway Discord bot
(`vivantur/pathway`). The bot and its Supabase backend **already exist and run in
production**; this website is a **second client on that same backend**, and its
first job is to **stay in sync** with the bot. The repo currently holds the
**planning and architecture documents** — application code comes next, per the
[Master Specification](./PATHWAY_MASTER_SPEC.md)'s
*Design → Review → Approve → Build → Test → Refactor → Release* workflow.

> ⚠️ **Read the architecture docs before writing any code that touches Supabase.**
> The website must conform to the bot's existing schema and the sync contract, or
> it can desync (or corrupt) live user data.

## Where to start

| Document | What it covers |
| --- | --- |
| [Master Specification](./PATHWAY_MASTER_SPEC.md) | The north star: vision, goals, stack, design philosophy, feature summary. |
| [System Architecture](./docs/architecture/system-architecture.md) | The real topology: website as a second client on the bot's live Supabase backend. |
| [**Web ⇄ Bot Sync Contract**](./docs/architecture/web-bot-sync.md) | **The concrete rules for staying in sync** — connection, identity, column shapes, `updated_at`, Realtime. |
| [Data Model](./docs/architecture/data-model.md) | The **existing** Supabase schema (reverse-engineered from the bot) the website must honor. |
| [Roadmap](./docs/architecture/roadmap.md) | Web-phased plan (W0–W7): reconcile with the backend, unify identity, then sync and feature parity. |
| [Decisions (ADRs)](./docs/architecture/decisions/) | ADRs capturing tradeoffs — see **ADR-0002** (website as second client), which supersedes ADR-0001. |

## Tech stack (target)

- **Frontend:** React · TypeScript · Tailwind CSS · Vite (hosted on Vercel)
- **Backend:** Express · TypeScript (hosted on Railway)
- **Data:** Supabase — PostgreSQL, Auth, Storage
- **Payments:** Stripe-ready architecture
- **Discord:** A bot sharing the same backend, database, and APIs as the website

## Status

🪶 **Phase W0 — Reconcile with the live backend.** Architecture documents are
under review. Before any feature work, this repo must confirm it is the bot's
`web/` app, adopt `supabase/migrations/` as the canonical schema home, and stand
up a web app that connects to Supabase **develop** with the anon key under RLS.
