# Pathway — PF2e Ecosystem (monorepo)

This repository holds **both** halves of Pathway, which share one Supabase backend:

| Path | What it is | Deploys to |
| --- | --- | --- |
| **repo root** (`Pathwayv2/`, `index.js`, …) | The **Discord bot** (Node.js / discord.js) | **Railway** — builds from the repo root, `npm start` → `Pathwayv2/src/index.js` |
| **`web/`** | The **website** (React + TS + Vite + Supabase) — rules library, character sheet, and character **builder** | **Vercel** — set the project's *Root Directory* to `web/` |

Shared Supabase migrations live in `web/supabase/migrations/` (referenced by the bot as `../web/supabase/migrations/`). The website was merged in from the former `vivantur/pathway-website` repository with its history preserved.

---

A Pathfinder 2e companion bot for Discord. Pathway tracks combat, characters, spells, inventory, downtime, companions, calendar, weather, and lookup commands from Discord slash commands.

## Current Runtime

Pathway now runs from `Pathwayv2`.

The root `package.json` intentionally points to:

```bash
npm start            # node Pathwayv2/src/index.js
npm run deploy       # node Pathwayv2/src/deploy.js
npm run deploy:guild # node Pathwayv2/src/deploy.js --guild
```

The old root bot files and folders are legacy only and should not be used for new work.
Root `index.js` and `deploy.js` are tiny compatibility launchers for hosts that
still call those old paths; both immediately hand off to `Pathwayv2`.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with:

```bash
TOKEN=your-discord-bot-token
CLIENT_ID=your-discord-application-id
BOT_OWNER_ID=your-discord-user-id
DEV_GUILD_ID=your-test-server-id
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_KEY=your-supabase-service-role-key
```

Never commit `.env`.

## Commands

Register slash commands in a test guild:

```bash
npm run deploy:guild
```

Register global slash commands:

```bash
npm run deploy
```

Start the bot:

```bash
npm start
```

## Project Structure

```text
Pathway/
  package.json              # Root npm scripts that launch Pathwayv2
  .env.example              # Environment template
  .github/workflows/ci.yml  # CI checks Pathwayv2 only
  Pathwayv2/
    src/
      index.js              # Bot entry point
      deploy.js             # Slash-command registration
      commands/             # Feature-folder slash command handlers
      state/                # Supabase-backed state caches
      rules/                # PF2e math and game rules
      lib/                  # Infrastructure helpers
      parsers/              # Input parsers
      reference/            # Reference-data helpers
      discord/              # Discord-specific helpers
    assets/
    docs/
    gamedata/
    scripts/
    supabase/
    tools/
```

## Cleanup Note

The old root `index.js`, `deploy.js`, `commands/`, `systems/`, `utils/`, `parsers/`, `assets/`, `docs/`, `gamedata/`, `scripts/`, `supabase/`, and `tools/` were from the pre-v2 layout. New work belongs under `Pathwayv2`.

## Hosting

Railway should run the root start command:

```bash
npm start
```

That command launches `Pathwayv2/src/index.js`.
