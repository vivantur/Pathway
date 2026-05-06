# Pathway Discord Bot

PF2e companion bot for Discord. Handles all game logic — combat, characters, spells, inventory, downtime, companions. The web app at `../web/` provides a read-mostly UI over the same Supabase data.

## Stack

- **Runtime**: Node.js (CommonJS, no TypeScript, no build step)
- **Discord**: discord.js v14 — slash commands + buttons + modals
- **Database**: Supabase (PostgreSQL 16), project ID `cmmwirlrvqmjqbydlqks`
- **Deployment**: Railway — single process, no volume needed (Supabase is authoritative)
- **Entry point**: `index.js` — all command handling lives here (~18 000 lines)

## Project Layout

```
Pathway/
  index.js              # All slash command handlers + clientReady startup
  deploy.js             # Registers slash commands with Discord API
  utils/
    storage.js          # Supabase client, all persistence helpers, loadJson/mutateJson
    supabase.js         # getSupabase() singleton
    fuzzyMatch.js       # Autocomplete + "did you mean?" helpers
    format.js           # Discord embed/message formatting utilities
    dice.js             # Dice rolling engine
    spellDamage.js      # Heightening resolver
    ancestryParser.js   # AoN description parser
  commands/
    encounters.js       # Combat tracker data model
    downtime.js         # Downtime accrual/spend/grant logic
    calendar-cmd.js     # In-world calendar
    weather-cmd.js      # Procedural weather
    condition.js        # Condition tracking
    combatV2.js         # Combat resolution helpers
  systems/              # PF2e rules implementations
  tools/                # One-off transformers (AoN sync, data pipeline)
  gamedata/             # PF2e reference JSON (read-only at runtime, seeded to Supabase)
```

## The Scrollbook Pattern — How Persistence Works

**The rule**: Supabase is the sole authoritative store. There are no JSON writes for user state at runtime. Every command that mutates data must `await` the Supabase write before calling `interaction.reply`.

```
command handler
  → read: const char = await getCharacterFromSupabase(discordId, charKey)
  → mutate: char.hp -= damage
  → write: await saveCharacterToSupabase(discordId, charKey, { current_hp: char.hp })
  → reply: interaction.reply(...)   ← only after write completes
```

**What lives where**:

| Data type | Storage | Access pattern |
|---|---|---|
| Characters, HP, overlay | `characters` table | `getCharacterFromSupabase` / `saveCharacterToSupabase` |
| Companions | `companions` table | `syncCompanionToSupabase` / `deleteCompanionFromSupabase` |
| Bags / inventory | `bags` + `bag_items` tables | `syncBagToSupabase` |
| Downtime | `downtime` table | `syncDowntimeToSupabase` |
| Character notes | `character_notes` table | `syncNotesToSupabase` |
| User snippets | `user_snippets` table | Sync helpers in storage.js |
| Guild snippets | `guild_snippets` table | Sync helpers in storage.js |
| Monster art/edits/attacks | `monster_art`, `monster_edits`, `monster_attacks` | Sync helpers in storage.js |
| Guild state (calendar, weather, settings) | `guild_state` table | `mutateJson` with `_jsonCaches` for in-memory access |
| Homebrew content | `homebrew_entries` table | `syncHomebrewEntryToSupabase` |
| Combat encounters | `encounters` + `encounter_events` tables | `syncEncounterToSupabase` / `logEncounterEvent` |
| PF2e reference (spells, monsters, items, feats…) | Supabase `monsters`/`spells`/`items`/`gamedata` tables | Loaded into memory at startup only — never re-queried per command |

**Reference databases** (bestiary, spell list, item catalog, etc.) are loaded once at `clientReady` by `loadReferenceDatabasesFromSupabase()` into the in-memory maps and are read from memory on every command. They are never written back.

**Guild state files** (calendar, weather, bot settings) use `mutateJson` with the `_jsonCaches` mechanism: seeded once from Supabase into memory at startup, then `mutateJson` operates on the in-memory cache and syncs to `guild_state` table. No disk reads/writes.

## Adding a New Command

1. Register the slash command in `deploy.js` (and re-run `npm run deploy` or `npm run deploy:guild`).
2. Add a handler in `index.js` inside the appropriate `interactionCreate` block.
3. Follow the read → mutate → **await write** → reply sequence above.
4. Use `interaction.reply({ content: '❌ ...', ephemeral: true })` for all error replies.
5. Use `interaction.reply({ content: '...' })` (public) for success replies that should be visible to the table.

## Supabase Access in the Bot

All Supabase access goes through `utils/storage.js`. Import helpers from there — don't create your own Supabase clients.

```javascript
// Correct — get the singleton
const { getSupabase } = require('./utils/supabase');
const sb = getSupabase();
if (!sb) return; // Supabase not configured — silently skip

// User lookup pattern (used everywhere)
const { data: userRow } = await sb
  .from('users')
  .select('id')
  .eq('discord_id', discordId)
  .maybeSingle();
if (!userRow) return interaction.reply({ content: '❌ No account found.', ephemeral: true });
```

**Identity resolution**: the `users` table uses `discord_id` (the Discord snowflake, a string) as the canonical key. Never join on `discord_username` — it changes. Always look up `users.id` (the Supabase UUID) via `discord_id` before doing anything else.

**Auto-creating users**: The bot creates `users` rows for Discord-only users (who haven't logged into the web app). Pass `discord_id` and `discord_username` (nullable). Use `upsert(..., { onConflict: 'discord_id' })` — never bare `insert`.

## Coding Conventions

**Module system**: CommonJS throughout (`require`/`module.exports`). No ES modules. No TypeScript. No build step.

**Async**: All Supabase calls are `async/await`. Every handler that touches the database must be `async`. Never fire-and-forget a write that the user's state depends on.

**Error handling in commands**:
- Wrap Supabase calls in `try/catch` inside sync helpers — log the error, don't crash.
- In command handlers, check for `null` returns from Supabase helpers and reply with an ephemeral error before proceeding.
- Never let an unhandled exception reach the Discord gateway — it kills the process.

**Discord reply rules**:
- One reply per interaction. Never `reply` after `reply`. Use `editReply` or `followUp` if a second message is needed.
- Errors: always `ephemeral: true`.
- Use `deferReply()` for any operation that may take more than ~2s (Supabase queries are fast enough that most commands don't need it).

**Embeds**: Use `EmbedBuilder` from discord.js. Keep embeds under Discord's 6000-char total limit. Split into multiple embeds if needed.

**Fuzzy matching**: Use `fuzzyPick` from `utils/fuzzyMatch.js` for all lookup commands (`/spell`, `/monster`, `/feat`, etc.). Always add a `didYouMeanLine` to "not found" error messages.

**Naming in the codebase**:
- Discord user identifier: `discordId` (the snowflake string, e.g. `"123456789012345678"`)
- Supabase user identifier: `userId` (UUID string from `users.id`)
- Character key: `charKey` (lowercase slug the user chose, e.g. `"aurelius"`)
- Companion key: `compKey` (lowercase slug, unique per character)

## Environment Variables

```
TOKEN or DISCORD_TOKEN   — Discord bot token
SUPABASE_URL             — Supabase project URL
SUPABASE_SERVICE_KEY     — Service role key (bypasses RLS — never expose to clients)
DATA_DIR                 — (legacy) volume mount path; no longer used for user state
```

## Startup Sequence (`clientReady`)

1. `restoreAllFromSupabase()` — loads user state (characters, bags, downtime, snippets, etc.) from Supabase into the in-memory maps that guild-state `mutateJson` caches need
2. `loadReferenceDatabasesFromSupabase(dbs)` — loads all reference data (bestiary, spells, items, feats, conditions, etc.) from Supabase into the in-memory arrays
3. `setupHomebrewRealtimeSync()` — subscribes to `homebrew_entries` changes via Supabase Realtime
4. Register application commands if `AUTO_DEPLOY=1`

The bot is ready to serve commands only after both async calls complete.

## Database Migrations

Migrations live in `../web/supabase/migrations/`. The bot does not manage migrations — they are applied from the web repo via `npx supabase db push` or Supabase dashboard. If the bot needs a new table, write the migration in the web repo and coordinate the deploy.

Migration filename format: `YYYYMMDDHHMMSS_short_description.sql`.

## Deployment

Railway auto-deploys on push to `main`. The bot runs as a single long-lived process. There is no volume needed — all state is in Supabase.

To update slash commands after changing `deploy.js`:
```bash
npm run deploy          # global (takes ~1 hour to propagate)
npm run deploy:guild    # guild-only (instant, use for testing)
```

## Seeding Reference Data

Reference data lives in `../web/frontend/scripts/seed_gamedata_supabase.ts` (generic `gamedata` table) and `seed_pf2e_supabase.ts` (typed tables: monsters, spells, items, feats, etc.). Run from `web/frontend/`:

```bash
cd ../web/frontend
export $(grep -v '^#' .env.local | xargs)
npx tsx scripts/seed_gamedata_supabase.ts   # always upserts — safe to re-run
npx tsx scripts/seed_pf2e_supabase.ts       # skips tables with existing data
```

When Viv updates gamedata files (under `gamedata/`), re-run the seeder to push the changes to Supabase. The bot will pick up the new data on its next startup.
