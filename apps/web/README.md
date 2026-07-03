# Pathway

> The definitive digital companion for Pathfinder Second Edition.

Pathway is a complete ecosystem for Pathfinder 2e — a character builder, rules
library, campaign manager, homebrew workshop, and Discord bot that all share one
backend, database, and synchronization layer. The website and the Discord bot
are **equal citizens** of the platform.

This repository is the **`web/` companion app** to the Pathway Discord bot
(`vivantur/pathway`). The bot and its Supabase backend **already exist and run in
production**; this website is a **second client on that same backend**, and its
first job is to **stay in sync** with the bot. The app is live (auth, vault, rules
library, and a working character **builder**); the architecture documents here
capture the plan it's being built against, per the
[Master Specification](./PATHWAY_MASTER_SPEC.md)'s
*Design → Review → Approve → Build → Test → Refactor → Release* workflow. The
builder's PF2e rules math lives in `@pathway/core`, not in this app.

> ⚠️ **Read the architecture docs before writing any code that touches Supabase.**
> The website must conform to the bot's existing schema and the sync contract, or
> it can desync (or corrupt) live user data.

## Where to start

| Document | What it covers |
| --- | --- |
| [**Master Vision Specification**](./PATHWAY_VISION.md) | The north star, in the author's words: the full long-term vision, design language, and complete feature set. |
| [Master Specification](./PATHWAY_MASTER_SPEC.md) | The condensed, architecture-aware working spec derived from the vision: goals, stack, design philosophy, feature summary. |
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

🪶 **Phase W0 — Reconcile with the live backend (essentially complete).**
The Vite + React + TypeScript + Tailwind app is **live at
[www.pathwaypf2e.com](https://www.pathwaypf2e.com)** (Vercel, HTTPS), connected to
the project's own Supabase with the **anon key under RLS** (the service-role key is
refused in the browser). Both **email magic-link** and **Discord OAuth** sign-in
work end-to-end; Supabase identity linking merges them into a single Pathway
account. The bot's full production schema and data have been migrated in (49
tables, ~50k rows including feats, spells, monsters, items, and community
characters). RLS lockdown applied to every user-owned table via
`pathway_own_*` and `pathway_char_*` policy sets, plus per-user access on
`public.users`; content tables (feats, spells, monsters, etc.) remain public
reads; `service_role` bypasses via explicit `pathway_service_all` policies so the
bot keeps working. Web-to-bot identity linked via cascade UPDATE on
`public.users.id` (ADR-worthy: we standardized every FK to `users.id` on
`ON UPDATE CASCADE`). Vault renders the signed-in user's own characters with
their live HP / Hero Points / XP.

Still open before Phase W1: the bot itself still reads the original third-party
Supabase — the pointer flip on Railway hasn't happened yet, so today's sync is
one-way (bot writes go to the old project; the migrated copy is a snapshot).
Also deferred to a proper design pass: RLS for guild-scoped, homebrew, and ops
tables (currently service-role only), and `bag_items` policy chained through
`bags.user_id`.

### Run it locally

```bash
npm install                 # one-time: install dependencies
cp .env.example .env        # then edit .env with your project URL + anon key
npm run dev                 # start the dev server → http://localhost:5173
```

Other scripts: `npm run build` (production build), `npm run typecheck`,
`npm run lint`, `npm run preview` (serve the production build).

> The app boots **without** a backend — it shows a "Connect the archive" notice
> until `.env` is filled in — so a fresh clone always runs.
