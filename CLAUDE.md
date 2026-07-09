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
            (Vitest). The heart of the project.
  db/     ← Supabase client, generated DB types, queries. Depends on core;
            validation happens here at the edges using core's Zod schemas.
            Currently a SKELETON — nothing imports it yet.
apps/
  web/    ← the Vite + React + React Router + React Query web app (was web/).
            Depends on core + db (once wired). Keep Vite — do NOT rebuild on Next.js.
  bot/    ← the discord.js bot (was Pathwayv2/). CommonJS JS, no build step.
```

### Status of the migration

*(Last reconciled against the code on 2026-07-09.)*

- ✅ **Structure** — monorepo layout + npm workspaces in place; `apps/bot` and
  `apps/web` moved.
- 🔶 **Build core** — three real slices exist, locked by 60 Vitest tests:
  `stats.ts` (ability modifier, proficiency bonus incl. Proficiency Without Level,
  rank encoding), `proficiency.ts` (27-class save/Perception/class-DC/armor
  progression + weapon-attack progression), `companion.ts` (animal companion
  catalog + derived-stat engine). Still missing: the Zod content schema and the
  character model.
- 🔶 **Point web at core** — `apps/web` imports `@pathway/core` from five files and
  the vendored copies are deleted, so the *scalar primitives* and the proficiency
  tables now have exactly one implementation. **Not yet done:** the derived stats.
  `features/builder/rules.ts` (`deriveCharacter`) and
  `features/characters/pathbuilder.ts` still each compute max HP, AC, saves,
  Perception, and class DC independently, over different input models. The sheet
  should become a thin adapter over core, not a second engine.
- ⬜ **Migrate bot** — `apps/bot/src/rules/pf2eMath.js` + `lib/format.js` remain a
  third implementation of the proficiency/ability math.
  **Blocked on packaging:** `packages/core` is `"type": "module"` with
  `"main": "src/index.ts"` — raw, untranspiled, ESM-only TypeScript. The bot is
  CommonJS with no build step, so it cannot `require('@pathway/core')` today.
  Core needs a build step emitting both ESM and CJS (or the bot must move to ESM)
  before any of this can land. Decide that before moving more logic into core.

Also note: six modules under `apps/bot/src/rules/` import `lib/storage` or
`lib/supabase` (`combatV2/state.js`, `calendar.js`, `weather.js`,
`eberronCalendar.js`, `eberronWeather.js`, `settings.js`), despite the bot's own
CLAUDE.md declaring `rules/` pure. Combat v2's rules are welded to its persistence;
that must be split before any of it can move into an I/O-free core.

`apps/bot` is otherwise **frozen for architecture**: don't restructure it or add new
rules logic to it. Carve-out: targeted hotfixes to live bugs (crashes, wrong rules,
data loss) are fine — "frozen" means "don't restructure," not "don't fix."

## Stack

- TypeScript, `strict: true`, in ALL new code (`packages/*`, `apps/web`). The bot is
  legacy CommonJS JS; migrate it opportunistically, not wholesale.
- **Node 22 LTS or newer.** Node 20 hit end-of-life 2026-04-30 and
  `@supabase/supabase-js` requires `node >= 22`. CI runs on 22.
- **npm workspaces.** One root lockfile; `npm install` **at the repo root** wires
  everything — installing inside a single app will not link `@pathway/core`.
  (The kickstart kit floated pnpm; we chose npm since both apps already used it and
  the deploy build commands keep working unchanged.)
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
npm test                  # ALL workspace tests (core: 60, bot: 162)
npm --workspace packages/core run test   # core tests only
npm --workspace apps/bot run test        # bot rules tests only
npm --workspace apps/web run typecheck   # web type check
npm --workspace apps/web run lint        # web lint
```

Deeper bot architecture notes live in `apps/bot/CLAUDE.md` and `apps/bot/HANDOFF.md`.
Secrets stay in `.env` (git-ignored) at the repo root or inside `apps/bot`.

## Deployment

Each app deploys from its own directory (its platform "root directory" setting):
- **Bot** → Railway, root directory `apps/bot`, `npm start`.
- **Web** → Vercel, root directory `apps/web`, `npm run build` (Vite).

Railway auto-deploys on push to `main`.

### The web deploy depends on an unversioned Vercel setting

`apps/web` imports `@pathway/core`, which lives outside its root directory. Vercel
builds with Root Directory = `apps/web` and by default **prunes sibling packages**, so
`packages/core` is simply not on disk at build time. Nothing in this repo can work
around that: a workspace install, a Vite `resolve.alias`, and a tsconfig `paths`
mapping were each tried and each reverted (`752575b`, `701a572`, `db9f851`, `b297deb`,
`72d10f0`) — you cannot alias to a directory that was never checked out. The last
resort was vendoring a byte-identical copy of core back into `apps/web`, which is
exactly the drift bug this architecture exists to prevent.

It works today **only** because the Vercel project has *"Include source files outside
of the Root Directory in the Build Step"* enabled. If that is ever lost, the build
fails with `TS2307: Cannot find module '@pathway/core'` and
`[vite]: Rollup failed to resolve import "@pathway/core"`. Re-enable the setting;
do **not** vendor core back into the app.

The durable fix (worth doing): build from the repo root — Root Directory `.`, build
command `npm run build:web`, output directory `apps/web/dist`.

`vercel.json` is strict JSON. A `//` comment key in it once broke production
(`701a572`) — do not add comments to it.
