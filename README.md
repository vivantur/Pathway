# Pathway — PF2e Ecosystem (monorepo)

A Pathfinder 2nd Edition companion: a **Discord bot** for play and a **web app** for
content and character management, sharing one Supabase backend and one rules engine.

## Layout

This is an **npm-workspaces monorepo** (root `package.json` → `workspaces`).

| Path | What it is |
| --- | --- |
| `packages/core` | Pure PF2e domain — content schema, character model, derived-stat engine. No I/O, no DB, no network. The single source of rules truth. |
| `packages/db` | Data layer (Supabase client, generated types, queries). Currently a placeholder — nothing imports it yet. |
| `apps/bot` | The discord.js bot. CommonJS, no build step. |
| `apps/web` | The Vite + React + React Router + React Query web app. |

**The one rule that matters:** there is exactly one implementation of the PF2e domain,
and it lives in `packages/core`. Never compute a rules value in `apps/web` or
`apps/bot`. See [CLAUDE.md](CLAUDE.md) for the architecture and the migration status.

## Requirements

- **Node.js 22.12 or newer.** Node 20 reached end-of-life on 2026-04-30;
  `@supabase/supabase-js` declares `engines.node >= 22`; and `require(esm)` — which
  lets the CommonJS bot consume `@pathway/core` — needs 22.12. CI runs on 22.
- **npm 11 or newer**, if you are going to add, remove, or update a dependency.
  npm 10 resolves this workspace incorrectly from cold: it drops transitive packages
  (we lost `obug`, a hard dependency of vitest, and 70 others), and every test suite
  then dies with `ERR_MODULE_NOT_FOUND`. Installing from the committed lockfile
  (`npm ci`) is safe on npm 10, so CI and the deploys are unaffected.

  **Never delete `package-lock.json` to fix an install.** If a dependency looks
  wrong, use `npm update <pkg>` on npm 11+.

## Setup

```bash
npm install          # run at the REPO ROOT — this wires all workspaces
cp .env.example .env
```

Fill in `.env`:

```bash
TOKEN=your-discord-bot-token
CLIENT_ID=your-discord-application-id
BOT_OWNER_ID=your-discord-user-id
DEV_GUILD_ID=your-test-server-id
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_KEY=your-supabase-service-role-key
```

Never commit `.env`.

> `npm install` must run at the repo root. Installing inside `apps/web` or `apps/bot`
> alone will not link the `@pathway/core` workspace package, and the web build will
> fail to resolve it.

## Commands

All run from the repo root:

```bash
npm start                 # run the bot
npm run deploy            # register slash commands globally (~1h propagation)
npm run deploy:guild      # register slash commands to the dev guild (instant)
npm run dev:web           # Vite dev server for the web app
npm run build:web         # production build of the web app
npm test                  # every workspace's tests (core + bot)
npm run typecheck         # every workspace's typecheck
```

Per-workspace:

```bash
npm --workspace packages/core run test        # core rules tests
npm --workspace apps/bot run test             # bot rules tests
npm --workspace apps/web run typecheck        # web type check
npm --workspace apps/web run lint             # web lint
```

### Working on `packages/core`

Core compiles `src/*.ts` to `dist/` (JS + type declarations), and **both** the bot
and the web app consume `dist` — never the TypeScript source. That is deliberate: one
compiled artifact means the two clients cannot read different versions of the same
rule. `dist/` is gitignored and rebuilt by `prepare` on every install.

While editing core, run the watcher so consumers see your changes:

```bash
npm run watch:core     # tsc --watch
npm run build:core     # one-shot rebuild
```

`npm run dev:web`, `npm run build:web`, and `npm run typecheck` rebuild core first.

## Deployment

Each app deploys from its own directory (its platform "root directory" setting):

| App | Platform | Root directory | Command |
| --- | --- | --- | --- |
| Bot | Railway | `apps/bot` | `npm start` |
| Web | Vercel | `apps/web` | `npm run build` (Vite) |

Railway auto-deploys on push to `main`.

### ⚠️ The web deploy depends on a Vercel dashboard setting

`apps/web` imports `@pathway/core`, which lives outside its root directory. Vercel
builds with Root Directory = `apps/web` and, by default, **prunes sibling packages** —
so `packages/core` is not on disk at build time and *nothing in this repo can work
around that*. Neither a workspace install, nor a Vite `resolve.alias`, nor a tsconfig
`paths` mapping can reach a directory that was never checked out. All three were tried
and reverted (see commits `752575b`, `701a572`, `db9f851`, `b297deb`, `72d10f0`).

The deploy works today only because the Vercel project has **"Include source files
outside of the Root Directory in the Build Step"** enabled. If that setting is ever
lost, the build fails with:

```
error TS2307: Cannot find module '@pathway/core' or its corresponding type declarations.
[vite]: Rollup failed to resolve import "@pathway/core"
```

If you see that, re-enable the setting — do not vendor a copy of `packages/core` back
into `apps/web`. The durable fix is to build from the repo root instead
(Root Directory = `.`, build command `npm run build:web`, output `apps/web/dist`).

Note also that `vercel.json` is strict JSON: a `//` comment key in it once broke
production deploys (`701a572`). Do not add comments to it.

## Testing

```bash
npm test    # core (60 tests) + bot (162 tests)
```

`packages/core` is I/O-free and trivially unit-testable. The bot's suite locks its pure
`rules/` layer — dice, degree of success, MAP, proficiency math, conditions, spell
heightening, the dying/recovery engine, and combat v2. **Run it after touching anything
under `apps/bot/src/rules/` or `apps/bot/src/lib/` — those tests guard player-visible
game math.**

## Further reading

- [CLAUDE.md](CLAUDE.md) — architecture, conventions, migration status
- [apps/bot/CLAUDE.md](apps/bot/CLAUDE.md) — bot architecture (state pattern, command pattern)
- [apps/bot/HANDOFF.md](apps/bot/HANDOFF.md) — what's been done in the bot refactor
- [docs/avrae-pathbuilder-roadmap.md](docs/avrae-pathbuilder-roadmap.md) — capability review and roadmap
