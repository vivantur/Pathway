# Pathway Discord Bot (v2)

PF2e companion bot for Discord — handles combat, characters, spells, inventory, downtime, companions, notes. The web app at `../web/` provides a UI over the same Supabase data; this bot owns the game logic and Discord interactions.

This is the **v2 rewrite** of the bot, organized into feature folders (Phase 3 extraction complete — 85 slash command entries in `src/commands/<name>/`). The legacy v1 single-file bot has been deleted from the repo, and **v2 is live in production** (since 2026-07-06).

## Stack

- **Runtime**: Node.js (CommonJS, no TypeScript, no build step)
- **Discord**: discord.js v14 — slash commands, buttons, modals
- **Database**: Supabase (PostgreSQL 16), project IDs:
  - **prod**: `cmmwirlrvqmjqbydlqks`
  - **develop**: `nqnswvuqszpkntnjzomv`
- **Deployment**: Railway — single process, no volume needed (Supabase is authoritative)
- **Entry point**: `src/index.js` — what's left of the original dispatcher (~3,000 lines: env, client, startup, autocomplete, buttons/modals, one-line command dispatch)

## Project Layout

```
Pathwayv2/
  src/
    index.js                 ← entry: env, Discord client, interaction dispatcher
    deploy.js                ← slash-command registration
    commands/                ← per-command feature folders (Phase 3)
      sheet/   {command.js, embed.js}
      hp/      {command.js, embed.js}
      notes/   {command.js, embed.js, notebook.js}
      snippet/ {command.js, validation.js}
      <legacy command modules — domain logic, NOT slash command handlers>
    state/                   ← in-memory caches + Realtime subscriptions (Phase 2)
      characters.js          ← THE big one — cache, accessors, HP/XP/weapons helpers
      bags.js                ← bags + bag_items (two tables, one cache)
      notes.js               ← per-character notebooks
      downtime.js
      snippets.js            ← user + guild snippets (two caches)
      monster.js             ← art/edits/attacks (three tables via factory)
      companions.js          ← patches characters cache via Realtime
      encounters.js
      homebrew.js            ← + Realtime sub (existed pre-Phase-2)
      guild.js               ← calendar/weather/settings via mutateJson
    rules/                   ← pure PF2e game logic (no I/O, no Discord)
      pf2eMath.js            ← proficiency math (character-data-aware)
      lore.js                ← lore-skill string normalization
      <plus legacy systems modules — combat, calendar, weather, etc.>
    lib/                     ← framework-level infrastructure
      storage.js             ← paths, write queue, JSON cache, dispatcher, restore orchestrator, reference loader
      supabase.js            ← getSupabase() singleton
      syncTracker.js         ← _trackSync, drainSupabaseSyncs
      userMap.js             ← buildDiscordToUserMap helper
      pathwayWebClient.js    ← fetchPathwayCharacter, saveImportedCharacter
      format.js              ← pure formatters (fmt, getMod, calcProfNum, etc.)
      fuzzyMatch.js          ← autocomplete + "did you mean?"
      dice.js, spellDamage.js, ancestryParser.js
    parsers/                 ← input parsers (Pathbuilder, AoN, companion PDF)
    discord/, jobs/, reference/    ← reserved for future phases (currently empty)
  gamedata/, supabase/, scripts/, tools/, assets/, docs/    ← siblings of src/
```

## Architectural Layers

Pathwayv2 organizes code by **what mutates the data**, not what the data is about:

| Layer | Role | Examples |
|---|---|---|
| `commands/<name>/` | Discord slash command handlers + embeds + buttons specific to that command | `commands/sheet/`, `commands/hp/`, `commands/notes/`, `commands/snippet/` |
| `state/` | Mutable bot state with caches + Realtime subscriptions | `state/characters.js` (HP, overlay, dying...), `state/notes.js` |
| `rules/` | Pure PF2e game logic (no I/O) | `rules/pf2eMath.js`, `rules/lore.js`, `rules/calendar.js` |
| `lib/` | Framework-level infrastructure (no domain logic) | `lib/storage.js`, `lib/format.js`, `lib/pathwayWebClient.js` |
| `parsers/` | Input → domain object | `bestiaryParser.js`, `companionPdfParser.js` |
| `reference/` | (reserved) read-only PF2e content loaders |
| `discord/` | (reserved) shared Discord rendering primitives |
| `jobs/` | (reserved) long-running timers (e.g. downtime auto-accrual) |

If you're adding something and unsure where: ask **"does this mutate data?"** If yes → `state/`. **"Is it PF2e math/rules?"** → `rules/`. **"Is it framework-level (storage, formatting, network)?"** → `lib/`. **"Is it specific to one slash command?"** → `commands/<name>/`.

## The State Pattern (Phase 2)

Every user-state table the bot touches lives behind a module in `state/`. The module owns:

1. **In-memory cache** — module-private, the bot reads from it synchronously
2. **`restore(sb, ...)`** — initial bulk hydration from Supabase at startup
3. **`subscribe(sb)`** — postgres_changes listener that patches the cache on web-app writes
4. **Per-write helpers** — sync to Supabase + update cache atomically

The pattern fixes a bug we called "Liv's bug": the bot used to cache user state in `index.js` module-level variables but only refreshed the cache at startup, so web-app changes (HP, notes, inventory…) were invisible until the bot restarted — and worse, the bot's next write would overwrite the web app's changes with its stale view.

### The subscribe-before-restore ordering

```js
// clientReady (in index.js):
notes.subscribe(sb);            // 1. open the live channel
downtimeState.subscribe(sb);    //    (events arriving now get queued)
characterState.subscribe(sb);
// ...

const restored = await restoreAllFromSupabase();  // 2. bulk fetch
                                                   //    each module's restore()
                                                   //    drains its event queue
                                                   //    after populating the cache
```

Each state module implements a pending-event queue that buffers Realtime events arriving between `subscribe()` and the end of `restore()`. After restore populates the cache, the queued events get applied in order. A per-row `updated_at` freshness check prevents stale events from clobbering fresher cache state.

### Realtime publication membership

For Realtime to deliver events for a table, two things must be true on Supabase:
1. `REPLICA IDENTITY FULL` on the table (so DELETE payloads carry all columns, not just the PK — the bot's cache keys aren't always the PK)
2. The table is in the `supabase_realtime` publication

The Phase 2 migrations (`web/supabase/migrations/20260524200*.sql`) added both for every user-state table. If you create a new state-cached table in the future, write a paired migration.

## The Command Pattern (Phase 3)

A slash command lives in its own folder under `src/commands/`. The canonical shape:

```
commands/<name>/
  command.js     ← async execute(interaction) — orchestrator
  embed.js       ← Discord EmbedBuilder builders
  <helper>.js    ← data shape + ops local to this command (e.g. notebook.js)
  validation.js  ← optional, when input validation is reused by sibling commands
```

Each command exports:

```js
module.exports = {
  name: 'sheet',
  execute,   // async (interaction) => { ... }
};
```

**Zero-ctx is the target.** Every extracted command (`/sheet`, `/hp`, `/notes`, `/snippet`) takes only `interaction`. All dependencies come through explicit `require` calls inside the command file. If a helper has to be passed through a `ctx` parameter, that's a sign the helper hasn't been properly modularized yet.

Index.js's dispatcher is the only thing that knows about commands:

```js
else if (commandName === 'notes') {
  await notesCmd.execute(interaction);
}
```

### Adding a New Command

1. Create the folder: `src/commands/<name>/`
2. Write `command.js` with `execute(interaction)` and `module.exports = { name, execute }`
3. Imports declare dependencies explicitly:
   - State: `require('../../state/<table>')`
   - PF2e math: `require('../../rules/pf2eMath')` or `require('../../rules/<topic>')`
   - Formatting: `require('../../lib/format')`
   - Per-feature helpers: `require('./<helper>')`
4. If the embed is more than ~30 lines, split it into `embed.js`
5. If the command has 50+ lines of data ops (validation, structuring), split into a sibling file (`notebook.js`, `validation.js`)
6. Add the slash builder to `deploy.js` (run `npm run deploy:guild` to register)
7. Add the dispatch in `index.js`'s `interactionCreate` chain
8. Validate: `node --check src/commands/<name>/*.js`

### Migrating an Existing Inline Command (Phase 3 template)

Each Phase 3 sub-phase followed the same shape; check the git log for `/sheet` (3.1), `/hp` (3.2), `/notes` (3.6), `/snippet` (3.8). The pattern:

1. **Identify helpers used by the command** via grep
2. **Categorize**: pure formatting → `lib/format.js`; PF2e math → `rules/pf2eMath.js`; state-derivation → state module; command-local → own folder
3. **Move shared helpers first** to their proper modules. This is "helper mining" — moving one helper often unblocks several future extractions.
4. **Extract the command** into a feature folder
5. **Replace the inline block** in index.js with a one-line dispatch

## Where to Put New Helpers

Decision tree (cribbed from the Phase 3 retrospective):

```
Does it mutate cached state?  →  state/<table>.js
Is it pure PF2e game logic?   →  rules/<topic>.js
Is it pure display formatting? →  lib/format.js
Is it a network client?       →  lib/<service>.js  (e.g. pathwayWebClient.js)
Is it shared infrastructure?  →  lib/<concern>.js  (storage, syncTracker, userMap)
Is it specific to one command? → commands/<cmd>/<purpose>.js
Is it used by 2+ commands but not generic? → cross-feature import is fine (e.g. /serversnippet imports validators from commands/snippet/validation.js)
```

When in doubt, **co-locate with the consumer** rather than reach for a generic home. Helpers in `lib/` should be genuinely infrastructure (used by many domains); helpers shared between only 2-3 commands often belong in one of the command folders.

## Storage and Sync

**Supabase is the sole authoritative store.** No JSON writes for user state at runtime. Every command that mutates data must `await` the Supabase write before replying to Discord:

```js
command handler
  → read:    const char = characterState.get(discordId, charKey);
  → mutate:  char.hp -= damage;
  → write:   await characterState.saveAll(characters);  // updates cache + Supabase
  → reply:   interaction.reply(...);   // only after write completes
```

Reads come from the in-memory cache (synchronous, fast). Writes go through state modules which update both the cache and Supabase atomically. Realtime subscriptions keep the cache fresh when the web app writes from the other side.

### Identity conventions

- `discordId` — Discord snowflake string (e.g. `"123456789012345678"`)
- `userId` — Supabase UUID from `users.id`
- `charKey` — lowercase slug chosen by the user (e.g. `"aurelius"`); unique per user
- `compKey` — lowercase slug for companion; unique per character

`state/characters.resolveChar(userId, nameArg)` is the canonical way to turn a `character:<name>` slash command option into a `{ charKey, char }` pair (or an `{ error }` to display).

## Coding Conventions

**Module system**: CommonJS throughout. No TypeScript. No build step.

**Async**: All Supabase calls are `async/await`. Every handler that touches the DB must be `async`. Never fire-and-forget a write the user's state depends on.

**Error handling in commands**:
- Wrap Supabase calls in `try/catch` inside state modules — log the error, don't crash.
- In command handlers, return ephemeral error replies for user-visible problems.
- Never let an unhandled exception reach the Discord gateway — it kills the process.

**Discord reply rules**:
- One reply per interaction. Use `editReply` or `followUp` for a second message.
- Errors: always `ephemeral: true`.
- Use `deferReply()` for any operation that may take more than ~2s.

**Embeds**: Use `EmbedBuilder` from discord.js. Keep total embed size under Discord's 6000-char limit.

**Fuzzy matching**: Use `fuzzyPick` from `lib/fuzzyMatch.js` for all lookup commands. Always include a `didYouMeanLine` in "not found" error messages.

## Environment Variables

```
TOKEN or DISCORD_TOKEN   — Discord bot token
SUPABASE_URL             — Supabase project URL
SUPABASE_SERVICE_KEY     — Service role key (bypasses RLS — never expose to clients)
CLIENT_ID                — Discord application ID
BOT_OWNER_ID             — Discord user ID with admin commands
DEV_GUILD_ID             — Guild for `npm run deploy:guild` testing
```

Stored in `Pathwayv2/.env` (not committed). `dotenv` loads it at startup.

## Startup Sequence (`clientReady`)

1. State modules subscribe to Realtime channels (subscribe-before-restore ordering)
2. `restoreAllFromSupabase()` — orchestrator in `lib/storage.js` that calls each state module's `restore()` and returns a `{ characters, bags, ... }` result for legacy callers
3. `loadReferenceDatabasesFromSupabase()` — bestiary/spells/items/gamedata into in-memory arrays
4. `setupHomebrewRealtimeSync()` — splices homebrew rows into the reference arrays live
5. Calendar/weather autotickers + downtime auto-accrual start

The bot is ready to serve commands only after all four complete.

## Database Migrations

Migrations live in `../web/supabase/migrations/`. The bot does not manage them — apply with `npx supabase db push` from `web/supabase/`. Coordinate with the web team before adding new tables.

Filename format: `YYYYMMDDHHMMSS_short_description.sql`. New migrations should be **idempotent** (use `CREATE TABLE IF NOT EXISTS`, wrap data-touching DDL in `DO $$ ... IF EXISTS ... END $$` blocks for tables that may not exist yet) so they're safe to apply to mixed-state environments. See `20260430120000_align_user_ids_with_auth.sql` for an example of retroactive idempotency.

**Before pushing**: always verify the linked project via `npx supabase migration list --linked`. Default the link to develop; only re-link to prod when actually deploying schema there.

## Deployment

Railway auto-deploys on push to `main`. Single long-lived process. No volume needed.

To update slash commands after changing `deploy.js`:

```bash
npm run deploy          # global (takes ~1 hour to propagate)
npm run deploy:guild    # guild-only (instant, use for testing)
```

## Refactor Status (updated 2026-07-06)

The rewrite from the legacy single-file bot to feature folders is complete and **deployed to production** (Railway, root directory `apps/bot`).

**Completed**:
- ✅ Phase 0 — skeleton + Phase 0 imports rewired
- ✅ Phase 1 — `lib/storage.js` split into state modules (per-table sync helpers)
- ✅ Phase 2 — every user-state table has cache + Realtime subscription (fixes Liv's bug)
- ✅ Phase 3 — all 85 slash command entries extracted to feature folders with the zero-ctx pattern (see `HANDOFF.md` for the full table)
- ✅ Production cutover — v1 deleted from the repo; v2 is the live bot

**Index.js shrinkage**: 19,500 → ~3,000 lines.

**Remaining work** (see `HANDOFF.md` and `docs/avrae-pathbuilder-roadmap.md` at the repo root):
- ✅ Combat engine consolidation (2026-07-08): `rules/combatV2/` is the ONLY
  combat engine. The legacy store (`commands/encounters.js`), automation layer
  (`rules/combatAutomation.js`), and legacy summary renderers are deleted;
  every combat command (`/init`, `/i`, `/m`, `/mattack`, `/cast`,
  `/companion`, `/weather apply`) reads and writes combat v2 state.
- Fold remaining legacy top-level command scaffolds (`weather-cmd.js`, `calendar-cmd.js`, `downtime.js`) when touched
- Optional polish: port the old tracker's HP bars / detailed-vs-compact
  pagination into `rules/combatV2/render.js` (the v2 summary is plainer)

## Testing

`npm test` (in this folder, or via `npm test` at the repo root) runs the Vitest
suite in `test/` — **162 tests across 8 files**, enforced by CI. It covers the pure
rules layer: degree of success, MAP, basic saves (`test/dice.test.js`), proficiency
math (`test/pf2eMath.test.js`), the /roll parser (`test/advancedRoll.test.js`),
condition presets (`test/effects.test.js`), spell damage + heightening
(`test/spellDamage.test.js`), the dying/wounded/recovery engine and the rest of the
combat engine (`test/combatV2.test.js`), formatters/currency/bulk
(`test/format.test.js`), and `{{variable}}` resolution (`test/variables.test.js`).

*(The old `test/combatAutomation.test.js` locked the legacy engine and was deleted
along with it in the 2026-07-08 combat consolidation; `test/combatV2.test.js` is its
successor.)*

Conventions: tests are ESM files that load the bot's CommonJS modules via
`createRequire`; randomness is controlled by stubbing `Math.random` with a
scripted sequence (`test/helpers.js` — `die(v, sides)` makes a die roll exactly
`v`). No Supabase env vars are set under test, so all persistence no-ops and
encounters are purely in-memory. **Run the suite after touching anything in
`rules/` or `lib/` — these tests lock player-visible game math.**

**Outstanding helper-mining candidates**:
- The character `edits` overlay handling (currently inline in /sheet's embed)
- Discord interaction reply patterns (deferReply, ephemeral error helpers → `lib/discord/replies.js`?)
- Weather + calendar rules (already in `rules/` but tightly coupled to `commands/weather-cmd.js` and `commands/calendar-cmd.js`)

When extracting more commands, follow the Phase 3 template above. The pattern is now mechanical — no design work, just execution.
