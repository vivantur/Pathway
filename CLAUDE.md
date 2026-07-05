# Pathway

Pathfinder 2nd Edition companion: a Discord bot plus a web app, in the spirit of
D&D Beyond (content + character management) and Avrae (Discord play). Current
scope is a friend group; architecture should not foreclose growing into a product.

## Architecture — the one rule that matters most

There is exactly ONE implementation of the PF2e domain. It lives in `packages/core`.
The bot and the web app both consume it. Never compute a rules value (a bonus, a DC,
a derived stat) in `apps/web` or `apps/bot`. If logic is duplicated, it has gone wrong.

> Why this rule exists: duplicated rules logic has already caused real bugs here —
> the dying/recovery math existed in three places and drifted; the bot and web
> computed proficiency separately and disagreed. `packages/core` structurally ends
> that class of bug.

## Layout

The repo is an **npm-workspaces monorepo** (root `package.json` → `workspaces`):

```
packages/
  core/   ← pure PF2e domain: content schema + character model + derived-stat
            engine. NO I/O, NO database, NO network. Trivially unit-testable
            (Vitest). The heart of the project. Currently a SKELETON.
  db/     ← Supabase client, generated DB types, queries. Depends on core;
            validation happens here at the edges using core's Zod schemas.
            Currently a SKELETON.
apps/
  web/    ← the Vite + React + React Router + React Query web app (was web/).
            Depends on core + db (once wired). Keep Vite — do NOT rebuild on Next.js.
  bot/    ← the discord.js bot (was Pathwayv2/). CommonJS JS, no build step.
```

### Status of the migration

- ✅ **Structure** — monorepo layout + npm workspaces in place; `apps/bot` and
  `apps/web` moved; `packages/core` and `packages/db` scaffolded (placeholder +
  passing test). Bot syntax, web build, and core tests all pass.
- ⬜ **Build core** — implement the content schema (Zod) + derived-stat engine in
  `packages/core`, from pasted rules text, locked by tests (kickstart Prompts 1–2).
- ⬜ **Point web at core** — replace `apps/web`'s local rules math with imports from
  `packages/core`, one derived value at a time, deleting the local copy as each is
  verified. Same for its data access via `packages/db`.
- ⬜ **Migrate bot** — later, move `apps/bot` onto `packages/core` too. Until then it
  stays CommonJS and self-contained.

`apps/bot` is otherwise **frozen for architecture**: don't restructure it or add new
rules logic to it. Carve-out: targeted hotfixes to live bugs (crashes, wrong rules,
data loss) are fine — "frozen" means "don't restructure," not "don't fix."

## Stack

- TypeScript, `strict: true`, in ALL new code (`packages/*`, `apps/web`). The bot is
  legacy CommonJS JS; migrate it opportunistically, not wholesale.
- **npm workspaces** (npm 11+). One root lockfile; `npm install` at the root wires
  everything. (The kickstart kit floated pnpm; we chose npm since both apps already
  used it and the deploy build commands keep working unchanged.)
- Vitest for tests. Content schemas in Zod; TS types via `z.infer`.
- Supabase (Postgres + Auth + JSONB content store).

## Content licensing (owner policy, revised 2026-07-04)

The former "ORC-clean" rule — a hard prohibition on storing any Paizo Product
Identity — was **retired by the project owner** (2026-07-04). Pathway operates as
a free fan project under Paizo's Community Use Policy (see the site footer) with
ORC-licensed rules content attributed; on that basis content decisions are:

- Game content (mechanics, creature/feat/spell names, descriptions) may be
  imported and stored freely from any reasonable source. Prefer machine-readable
  rules data; keep the `source` field on every entity so attribution stays intact.
- Keep the Community Use Policy / ORC attribution notices in the web footer and
  bot embeds — they are the legal basis for the above.
- The old strict-PI cleanup project is cancelled; the historical ORC-safe labels
  that exist are fine to leave as-is.

## Rules-from-source rule (non-negotiable)

Do NOT implement Pathfinder rules from training knowledge — it is often subtly wrong
(proficiency stacking, untrained penalties, conditions, degree-of-success shifts). A
review found several model-remembered rules implemented incorrectly. Implement only from
rules text provided in the prompt. The stat engine is data-driven and locked by tests
against human-verified worked examples. When unsure about a rule, stop and ask.

## Working conventions

- On any non-trivial task, propose a plan and wait for approval before writing files.
- Every function in `core` ships with tests. Tests are the contract.
- `core` stays I/O-free so it can be tested without a database or network.
- Characters reference content by id AND a pinned version — never embed a copy, never
  reference live. Content updates are an explicit action, not a silent mutation.
- Official and homebrew content share ONE schema, differing only by an owner/source field.

## Commands

```bash
npm install               # install all workspaces (run at repo root)
npm start                 # run the bot (delegates to apps/bot)
npm run deploy            # register slash commands globally
npm run deploy:guild      # register slash commands to the dev guild (instant)
npm run dev:web           # Vite dev server for the web app
npm run build:web         # production build of the web app
npm run test              # core package tests
npm --workspace apps/web run typecheck   # web type check
```

Deeper bot architecture notes live in `apps/bot/CLAUDE.md` and `apps/bot/HANDOFF.md`.
Secrets stay in `.env` (git-ignored) at the repo root or inside `apps/bot`.

## Deployment

Each app deploys from its own directory (its platform "root directory" setting):
- **Bot** → Railway, root directory `apps/bot`, `npm start`.
- **Web** → Railway/Vercel, root directory `apps/web`, `npm run build` / `npm start`.

Railway auto-deploys on push to `main`. After the monorepo move, update each service's
**root directory** in its dashboard to the new `apps/<name>` path.
