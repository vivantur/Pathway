# Pathway — PF2e Discord Bot

A Pathfinder 2e companion bot for your tabletop group. Tracks initiative and combat, rolls attacks and saves, looks up spells and feats, manages character sheets, handles in-game calendars, and more — all from Discord slash commands.

---

## What it can do

- **Combat** — `/init` starts an encounter; tracks HP, dying/wounded/doomed, MAP, reactions, persistent damage, and recovery checks automatically per PF2e Remaster rules.
- **Attacks** — `/attack` (players) and `/init attack` (GM) roll to hit and apply damage with full PF2e degree-of-success logic.
- **Spells** — `/cast` looks up spells from the spell catalog, rolls attack rolls or auto-resolves saves, and scales damage with heightening.
- **Characters** — `/char` imports and tracks your Pathbuilder character sheet. `/sheet`, `/hp`, `/save`, `/resource`, `/rest` give quick access to stats.
- **Lookup** — `/spell`, `/feat`, `/item`, `/rule`, `/ancestry`, `/archetype`, `/background` search the game database.
- **Calendar & Weather** — `/calendar` and `/weather` track the in-game date and weather for Golarion or Eberron.
- **Downtime** — `/downtime` auto-accrues and tracks downtime days between sessions.

---

## Prerequisites

Before you can run this bot you need:

1. **Node.js 18 or newer** — Download from [nodejs.org](https://nodejs.org). To check if you have it: `node --version`
2. **A Discord bot** — You create this for free at the [Discord Developer Portal](https://discord.com/developers/applications).

---

## First-time setup

### Step 1 — Get the code

```bash
git clone <your-repo-url>
cd Pathway
npm install
```

`npm install` downloads all the libraries the bot needs. You only need to do this once (and again after pulling major updates).

### Step 2 — Create your Discord bot

If you haven't created a bot application yet:

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**, give it a name (e.g. "Pathway")
3. Go to **Bot** in the left sidebar → click **Reset Token** → copy the token somewhere safe
4. On the same page, enable **Message Content Intent** and **Server Members Intent** under *Privileged Gateway Intents*
5. Go to **OAuth2 → URL Generator**, check `bot` + `applications.commands`, give it the permissions it needs (Send Messages, Embed Links, Read Message History), then use the generated URL to invite the bot to your server

### Step 3 — Set up your environment file

```bash
cp .env.example .env
```

Open `.env` in a text editor and fill in your values:

```
TOKEN=paste-your-bot-token-here
CLIENT_ID=paste-your-application-id-here
BOT_OWNER_ID=your-discord-user-id
DEV_GUILD_ID=your-server-id-for-testing  (optional but recommended)
```

> **How to find your IDs:** Right-click your server name in Discord → *Copy Server ID* (that's `DEV_GUILD_ID`). Right-click your own username → *Copy User ID* (that's `BOT_OWNER_ID`). Your `CLIENT_ID` is on the *General Information* page of your application in the developer portal.
>
> **Never share your `TOKEN`** — it gives full control of your bot. The `.env` file is in `.gitignore` and won't be committed to git.

### Step 4 — Register the slash commands

```bash
npm run deploy:guild
```

This tells Discord about the bot's slash commands. The `deploy:guild` version registers them to your `DEV_GUILD_ID` only — they appear **instantly**. Use this for testing and development.

When you're ready to use the bot in all your servers:

```bash
npm run deploy
```

Global commands can take up to 1 hour to propagate across Discord's servers.

### Step 5 — Start the bot

```bash
npm start
```

You should see the bot come online in your server. Try `/spell spell:fireball` to verify it's working.

---

## Daily workflow

```bash
npm start           # run the bot
npm run deploy:guild  # re-register commands after changing options/subcommands
npm run deploy        # push changes to all servers
```

You only need to re-deploy when you **change the structure** of a command (its name, description, or options). Changing how a command *responds* (editing `index.js`) only requires restarting the bot.

---

## Project structure

```
Pathway/
├── index.js              # The main bot file — all command handlers live here
├── deploy.js             # Slash-command registration script
├── .env                  # Your secrets (never committed to git)
├── .env.example          # Template showing which variables are needed
├── package.json          # Project metadata and npm scripts
│
├── commands/             # Shared state modules (not Discord commands)
│   ├── encounters.js     # In-memory initiative/combat tracker
│   ├── downtime.js       # Downtime day counter
│   ├── deploy.js         # (archived — use root deploy.js instead)
│   └── ...
│
├── systems/              # Game-rules engines
│   ├── combatAutomation.js   # PF2e dying/wounded/MAP/recovery logic
│   ├── spellEffects.js       # Auto-condition application from spells
│   ├── characterOverlay.js   # Tracks spell slots / HP overrides on top of sheet data
│   └── ...
│
├── utils/                # Small helpers
│   ├── dice.js           # Pure dice-rolling functions
│   ├── format.js         # Text formatting helpers
│   └── storage.js        # JSON file read/write
│
├── gamedata/             # JSON databases (spells, feats, bestiary, etc.)
│   ├── bestiary.json     # ~2,900 PF2e monsters
│   ├── spells.json       # Full spell catalog
│   ├── feats.json        # Feat database
│   └── ...
│
├── parsers/              # Data-import utilities
├── tools/                # One-off maintenance scripts
└── scripts/
    └── archive/          # Old one-time deploy scripts (replaced by deploy.js)
```

> **Note on `index.js`:** It's large (~13,000 lines) because all command handlers are in one file. This is a known limitation — splitting it into per-command files is a future improvement.

---

## Troubleshooting

**Bot is online but slash commands don't appear**
→ Run `npm run deploy:guild` and wait a few seconds. If using global deploy, wait up to 1 hour.

**"Missing Access" or "Unknown interaction" errors**
→ Make sure the bot was invited with the `applications.commands` OAuth2 scope.

**"TOKEN is not set" when running deploy**
→ Make sure your `.env` file exists and has `TOKEN=...` filled in. Run `cp .env.example .env` if it's missing.

**Bot crashes immediately on startup**
→ Check the terminal output for the error message. Common causes: missing `.env` variables, `node_modules` not installed (run `npm install`).

**Slash commands show outdated options**
→ Re-run `npm run deploy:guild`. Discord caches command schemas — you must re-register after any change to options or subcommands.

**Characters imported from Pathbuilder show wrong stats**
→ Use `/char update` to re-import from a fresh Pathbuilder JSON export. If max HP is wrong specifically, use `/hp max value:X` to override it.

---

## Hosting on Railway (or other cloud platforms)

The bot is designed to run continuously on a cloud host so it's always available. [Railway](https://railway.app) is a simple option:

1. Push your code to a GitHub repository (**make sure `.env` is in `.gitignore`** — it is by default)
2. Connect the repo to Railway
3. Add your environment variables in Railway's dashboard (under *Variables*) — same keys as your `.env` file
4. Railway will auto-deploy when you push to `main`

The `DATA_DIR` environment variable lets you point data files (characters, downtime, etc.) at a persistent volume so they survive redeploys.

---

## License

ISC
