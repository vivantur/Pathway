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
            (Vitest). The heart of the project. BUILT: Zod content schema,
            character model, and the derived-stat engine (dataset-parameterized,
            so it stays I/O-free), locked by worked-example tests.
  db/     ← Supabase client, generated DB types, queries. Depends on core;
            validation happens here at the edges using core's Zod schemas.
            Currently a SKELETON (web talks to Supabase directly for now, in
            apps/web/src/features/characters/api.ts).
apps/
  web/    ← the Vite + React + React Router + React Query web app (was web/).
            Depends on core + db (once wired). Keep Vite — do NOT rebuild on Next.js.
  bot/    ← the discord.js bot (was Pathwayv2/). CommonJS JS, no build step.
```

### Status of the migration

- ✅ **Structure** — monorepo layout + npm workspaces in place; `apps/bot` and
  `apps/web` moved; `packages/core` and `packages/db` scaffolded (placeholder +
  passing test). Bot syntax, web build, and core tests all pass.
- ✅ **Build core** — content schema (Zod) + character model + derived-stat engine
  live in `packages/core`, ported from the web builder's proven implementation and
  locked by worked-example tests (`packages/core/src/engine.test.ts`). Engine
  functions take a `Dataset` argument so core imports no data and stays I/O-free.
- ◐ **Point web at core** — `apps/web`'s rules math now comes from `packages/core`:
  `rules.ts` / `spellcasting.ts` / `subclassEffects.ts` / `types.ts` are thin
  re-export shims that bind the engine to the app's bundled dataset, and the local
  schema/engine copies are deleted. No rules value is computed in `apps/web`.
  Still ⬜: data access via `packages/db` (web still uses Supabase directly), and
  migrating the bundled JSON dataset into a schema-validated pipeline.
- ⬜ **Migrate bot** — later, move `apps/bot` onto `packages/core` too. Until then it
  stays CommonJS and self-contained (and keeps its own rules engine — the one
  remaining place PF2e math is duplicated).

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

## ORC-clean rule (non-negotiable — with a known-debt caveat)

Use ONLY ORC-licensed game mechanics, with attribution. NEVER store, hardcode, commit,
or import Paizo Product Identity: deity names, setting proper nouns, named NPCs, or
verbatim flavor/lore text — even for data never shown to users; the liability is in the
data at rest. Every content entity's display name is an ORC-safe label plus
source/attribution metadata; a Paizo proper noun is never a primary key or a hardcoded
string.

> Known debt: the bot and its data are NOT yet ORC-clean (a `/deity` command, Eberron
> content, AoN-imported bestiary/spell flavor). Rules of engagement: (1) no NEW code may
> introduce PI; (2) flag PI when you see it; (3) purging/relabeling existing PI is an
> explicit, tracked cleanup project.

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
