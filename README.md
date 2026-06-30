# Pathway

> The definitive digital companion for Pathfinder Second Edition.

Pathway is a complete ecosystem for Pathfinder 2e — a character builder, rules
library, campaign manager, homebrew workshop, and Discord bot that all share one
backend, database, and synchronization layer. The website and the Discord bot
are **equal citizens** of the platform.

This repository currently holds the **planning and architecture documents** for
Pathway. No application code has been written yet — by design. Per the
[Master Specification](./PATHWAY_MASTER_SPEC.md), every major phase moves
through *Design → Review → Approve → Build → Test → Refactor → Release*, and
architecture docs come before implementation.

## Where to start

| Document | What it covers |
| --- | --- |
| [Master Specification](./PATHWAY_MASTER_SPEC.md) | The north star: vision, goals, stack, design philosophy, feature summary. |
| [System Architecture](./docs/architecture/system-architecture.md) | How the pieces fit: monorepo layout, services, shared core, data flow, auth, sync. |
| [Data Model](./docs/architecture/data-model.md) | Entities and relationships across rules, characters, campaigns, homebrew, orgs. |
| [Roadmap](./docs/architecture/roadmap.md) | Phased delivery plan from foundation to marketplace, with gates. |
| [Decisions (ADRs)](./docs/architecture/decisions/) | Architecture Decision Records capturing tradeoffs and the reasoning behind them. |

## Tech stack (target)

- **Frontend:** React · TypeScript · Tailwind CSS · Vite (hosted on Vercel)
- **Backend:** Express · TypeScript (hosted on Railway)
- **Data:** Supabase — PostgreSQL, Auth, Storage
- **Payments:** Stripe-ready architecture
- **Discord:** A bot sharing the same backend, database, and APIs as the website

## Status

🪶 **Phase 0 — Planning.** Architecture documents are under review. Implementation
begins only after the foundation phase is approved.
