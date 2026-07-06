# Pathwayv2 Refactor — Handoff Doc

> **Update 2026-07-06**: this doc predates the monorepo move. The bot now lives at
> `apps/bot/` (the "Project Geography" below describes the old `Pathway/Pathwayv2/`
> layout), the legacy v1 single-file bot has been removed from the repo, and
> **v2 is live in production on Railway** (root directory `apps/bot`, `npm start`).
> The cutover described under "Suggested Next Steps" is complete; what remains is
> post-cutover cleanup.

**Status as of this handoff**: Phase 3 extraction complete. 85 slash command entries moved to feature folders. Bot is functional; legacy single-file dispatcher in `src/index.js` remains the entry point while startup/autocomplete/button scaffolding is audited. ~~**Nothing has been deployed to production from this branch**~~ *(superseded — see update above: v2 is deployed)*.

Read this top to bottom once, then keep `CLAUDE.md` open as the architecture reference. CLAUDE.md is the long-form architecture doc — it explains how the codebase is *organized*. This file explains what's been *done* and what to do *next*.

---

## TL;DR for Claude Code

If you're a Claude Code session that just opened this folder, here's what you need to know in 60 seconds:

1. **You're in `Pathway/Pathwayv2/`**, a parallel rewrite of the v1 bot at `Pathway/` (the legacy 19,500-line `index.js` sits at the repo root). v2 organizes the same logic into feature folders.
2. **The pattern is mechanical at this point**. Look at `src/commands/class/` or `src/commands/skillinfo/` for the gold-standard shape: `command.js` (zero-ctx orchestrator), `lookup.js` (pure data resolution), `embed.js` (renderers), optional `buttons.js` (when the command has buttons).
3. **Don't redesign anything**. The architecture is settled. Phase 3 command extraction is complete; remaining work is audit/final hardening before any runtime cutover.
4. **Validate every cleanup** with `node --check src/index.js`, `node --check` across `src/**/*.js`, and a command module-load smoke test confirming `execute.length === 1`.
5. **Don't commit `.env`** or `gamedata/*.json` — both are in `Pathway/.gitignore` for good reason.

---

## Project Geography

```
pathfinder_bot/                            ← user's working tree (not a single repo)
  Pathway/                                 ← the v1 bot repo (origin: vivantur/Pathway) ← YOU ARE HERE
    index.js                                 ← legacy 19,500-line dispatcher (still deployed in prod)
    commands/, systems/, utils/              ← v1's modular bits
    Pathwayv2/                               ← v2 rewrite (this folder, new on this branch)
      src/                                     ← v2 source
      CLAUDE.md                                ← v2 architecture reference (read it!)
      HANDOFF.md                               ← this file
  web/                                     ← the web companion app (separate repo)
    supabase/migrations/                     ← ⚠️ migrations live HERE, not in Pathwayv2
```

**Critical**: Pathwayv2 deliberately does NOT own Supabase migrations. They live in `../../../web/supabase/migrations/` (relative to this file). When you add a new state-cached table, write a paired migration there. See "Database Migrations" in `CLAUDE.md`.

---

## What's Done

### Phase 0 — Skeleton (complete)
- `Pathwayv2/` directory created in parallel to `Pathway/`
- All v1 imports rewired into per-folder homes: `lib/` (infrastructure), `rules/` (PF2e math), `parsers/` (input → domain), `state/` (mutable caches)
- `node_modules` is symlinked to `Pathway/node_modules` for fast local iteration — **don't commit the symlink** (it's in this branch's `.gitignore`)

### Phase 1 — Per-table state modules (complete)
Split `lib/storage.js` into 10 state modules. Each owns a single table (or table family) and exposes `get`/`save`/`restore` for the bot:

```
src/state/
  characters.js   ← THE big one — HP/XP/weapons + overlay handling + resolveChar
  bags.js         ← bags + bag_items (two tables, one cache)
  notes.js        ← per-character notebooks
  downtime.js     ← per-character downtime tracker
  snippets.js     ← user + guild snippets (two caches)
  monster.js      ← monster_art / monster_edits / monster_attacks (factory pattern)
  companions.js   ← patches characters cache via Realtime
  encounters.js   ← combat encounter state
  homebrew.js     ← splices into reference arrays at runtime
  guild.js        ← calendar/weather/settings (mutateJson pattern)
```

### Phase 2 — Realtime subscriptions (complete) — fixes "Liv's bug"
The bug: bot cached user state in module-level vars at startup only. Web-app writes were invisible until bot restart, and worse, the bot's next write clobbered them with stale data.

Fix: every state module now has `subscribe(sb)` + `restore(sb, ...)` with **subscribe-before-restore ordering** and a pending-event queue. Realtime events arriving during restore get buffered; after restore populates the cache, queued events apply in order. A per-row `updated_at` freshness check prevents stale events from clobbering fresher cache state.

Migrations applied to both **prod** (`cmmwirlrvqmjqbydlqks`) and **develop** (`nqnswvuqszpkntnjzomv`):
- `20260524100000_character_builder_drafts.sql` — catch-up for table created out-of-band on prod
- `20260524100100_homebrew_packs.sql` — same
- `20260524100200_homebrew_pack_entries.sql` — same
- `20260524100300_catchup_tables_rls.sql` — RLS for the above three
- `20260524200000` through `20260524200700` (8 files) — REPLICA IDENTITY FULL + publication membership for every user-state table
- `20260430120000_align_user_ids_with_auth.sql` — modified to be idempotent (wrapped in `DO $$ IF EXISTS pg_tables ... END $$` blocks)

### Phase 3 — Command extraction (complete: 85 slash command entries)

Extracted to `src/commands/<name>/` with the zero-ctx pattern (every command's `execute(interaction)` has `.length === 1`):

| Command | Phase | Files | Notes |
|---|---|---|---|
| `/sheet` | 3.1 | command, embed | Character display |
| `/hp` | 3.2 | command, embed | Damage / heal / set |
| `/notes` | 3.6 | command, embed, notebook | Per-char notebook |
| `/snippet` | 3.8 | command, validation | User snippets |
| `/serversnippet` | 3.9 | command | Shares validators with /snippet |
| `/portrait` | 3.10 | command | Set sheet portrait URL |
| `/xp` | 3.11 | command, embed, xpMath | Award XP, level-up embed |
| `/rest` | 3.12 | command, embed, buttons | **First command with buttons** — established the `prefixes: [...]` + `handle()` pattern |
| `/refocus` | 3.12 | command | Refocus focus pool |
| `/condition` | 3.14 | command | Uses shared `findRule`/`buildRuleEmbed` |
| `/background` | 3.15 | command, lookup, embed | 3-file reference-lookup pattern |
| `/heritage` | 3.15 | command, lookup, embed | + shared `commands/ancestry/colors.js` |
| `/feat` | 3.16 | command, lookup, embed | Has `exactDuplicates` flag for same-name + different-level |
| `/ancestry` | 3.17 | command, lookup, embed, buttons, colors | 3-page buttons |
| `/archetype` | 3.18 | command, lookup, embed | |
| `/item` | 3.19 | command, lookup, embed | Auto-picks preferred edition (`itemSourceRank`); `/itemadd` reuses `buildItemEmbed` via cross-feature import |
| `/deity` | 3.20 | command, lookup, embed | |
| `/eberron` | 3.21 | command, houseLookup, houseEmbed, deityLookup | Subcommands `house` + `deity`; cross-imports from `commands/deity/` |
| `/skillinfo` | 3.22 | command, lookup, embed, buttons | 3-page buttons; character-aware Overview |
| `/class` | 3.23 | command, lookup, embed, buttons | 5-page buttons; character-aware Overview |
| `/itemadd` | 3.24 | command, database | Bot-owner homebrew item paste/file/remove |
| `/spell` | 3.25 | command, lookup, embed | Spell lookup + duplicate-source handling |
| `/spelladd` | 3.26 | command, database | Bot-owner homebrew spell paste/file/remove |
| `/companion` | 3.27 | command, helpers | Companion info/list/tracking/import moved zero-ctx |
| `/monsteradd` | 3.28 | command, database | Bot-owner bestiary paste/file/remove |
| `/skill` | 3.29 | command | Character skill roll |
| `/perception` | 3.30 | command | Character Perception roll |
| `/help` | 3.31 | command | Category embeds + `help_` button handler |
| `/save` | 3.32 | command | Character save roll |
| `/initiative` | 3.33 | command | Standalone initiative roll |
| `/rule` | 3.34 | command | Rule lookup |
| `/resource` | 3.35 | command | Focus/hero/slot daily resources |
| `/hero` | 3.36 | command, embed | Hero point tracking + reroll |
| `/gold` | 3.37 | command, wallet | Character wallet management |
| `/bag` | 3.38 | command, helpers | Character inventory bag + autocomplete helper |
| `/cc` | 3.39 | command, counterView | Custom character counters |
| `/counters` | 3.39 | command, counterView | Shortcut view for custom counters |
| `/feats` | 3.40 | command, fields | Character feats display |
| `/abilities` | 3.40 | command | Character special abilities display |
| `/description` | 3.41 | command, embed | Character description view/edit modal |
| `/br`, `/break` | 3.42 | command | Scene-break divider aliases |
| `/ping` | 3.43 | command | Bot health check |
| `/cvar` | 3.44 | command | Per-character custom variables |
| `/spells` | 3.45 | command | Character spellbook/repertoire/prepared overlay management |
| `/spellbook`, `/prepared` | 3.46 | command | Spellbook and prepared-spells display |
| `/cast` | 3.47 | command | Spell casting, slot spend, encounter targeting, damage/effects |
| `/roll`, `/r` | 3.48 | command, advancedRoll | Advanced dice roller aliases |
| `/weather` | 3.49 | command wrapper | Feature-folder wrapper around legacy weather command module |
| `/calendar` | 3.49 | command wrapper | Feature-folder wrapper around legacy calendar command module |
| `/monster` | 3.50 | command, helpers | Bestiary lookup with guild edits/art/attack library overlay |
| `/monsterart` | 3.50 | command | Per-guild monster art library |
| `/monsterroll` | 3.51 | command | Monster save/skill rolls for combat v2 and legacy encounters |
| `/monsteredit` | 3.52 | command | Per-guild bestiary statblock edits and reset/view flows |
| `/monsterattack` | 3.53 | command | Saved monster attack library add/remove/list/use |
| `/monstercast` | 3.54 | command | GM monster spell/ability casting in combat v2 |
| `/monsterattacks` | 3.54 | command | GM action list for combat v2 monsters |
| `/monsterability` | 3.54 | command | GM monster save-based ability in combat v2 |
| `/hunt` | 3.55 | command, helpers | Creature hunt activity and random prey selection |
| `/harvest` | 3.55 | command | Creature harvesting using shared hunt helpers |
| Downtime activity commands | 3.56 | command | `/income`, `/forgery`, `/craft`, `/longrest`, `/treatdisease`, `/cram`, `/retrain`, and simple downtime prep commands |
| `/downtime` | 3.57 | command | Downtime bank check/spend/grant/log/reset and legacy scaffold |
| `/mattack` | 3.58 | command | GM monster attack rolls in combat v2, out of initiative, and legacy encounters |
| `/attack` | 3.59 | command | Character weapon attack roll with MAP, effects, damage, reactions, and encounter HP |
| `/m` | 3.60 | router | Monster umbrella alias router shared by dispatch and autocomplete |
| `/i` | 3.61 | command, combatV2Actors | Player combat v2 actions: join, attacks, HP/temp HP, reactions, checks, and spell casting |
| `/init` | 3.62 | command | Combat tracker start/view/turn/add/remove/effect/end/recovery/delay flows |
| `/char` | 3.63 | command, modals | Character import/update/edit/create/delete/list/active/art and modal handlers |

**Cumulative index.js shrinkage**: 19,500 → **2,731** lines (−16,769 lines through Phase 3).

### Helpers mined to permanent homes

These weren't extractions but architectural cleanups along the way. They unblocked several command moves:

- `truncateField` → `lib/format.js` (17 callers across the codebase)
- `computeCharSkillModifier` + `SKILL_ABIL_MAP` → `rules/pf2eMath.js` (3 callers)
- Per-table sync logic → `state/*.js` modules
- `parseDescription`, `getAncestryHp`, `hasHeritages`, `hasAncestryFeats` → `lib/ancestryParser.js`
- `fetchPathwayCharacter`, `saveImportedCharacter` → `lib/pathwayWebClient.js`
- `_trackSync`, `drainSupabaseSyncs` → `lib/syncTracker.js`
- `buildDiscordToUserMap` → `lib/userMap.js`
- `MAX_CHARACTERS_PER_USER`, `_usernameCache` → `state/characters.js`
- `isDeadInteractionError` → `lib/discordErrors.js`
- `resolveVariable`, `expandVariables` → `rules/variables.js`
- `formatSlotPips` → `commands/spellbook/command.js`
- `rollAdvanced` → `rules/advancedRoll.js`
- Legacy initiative summary updater → `commands/init/legacySummary.js`
- Combat v2 summary updater → `commands/init/combatV2Summary.js`
- Monster combat v2 save/action helpers → `commands/monster/combatV2Helpers.js`
- Player/actor combat v2 helpers → `commands/init/combatV2Actors.js`
- Character management modal handlers → `commands/char/modals.js`
- Hunt/harvest activity math and embeds → `commands/hunt/helpers.js`

---

## What's NOT Done

### Unextracted commands

None known from the dispatcher audit. `src/index.js` now delegates slash commands to feature folders. The remaining work is cleanup/audit around startup, autocomplete, button dispatch, and legacy helper scaffolds that are still shared by extracted commands.

### Still-living scaffolds in v1 layout

In `src/commands/` there are some `.js` files at top level (not folders) that are the old domain modules, not slash command handlers:

```
commands/
  calendar-cmd.js, combatV2.js, condition.js, deploy-downtime.js,
  downtime.js, encounters.js, weather-cmd.js
```

These were already "extracted" in some form pre-Phase-3 but don't conform to the new feature-folder shape. **Don't refactor these speculatively** — only touch them when extracting a slash command that depends on them. For example, when extracting `/calendar` you'll want to fold `calendar-cmd.js` into `commands/calendar/`.

### Outstanding helper mining candidates (called out in CLAUDE.md)

- The character `edits` overlay handling (currently inline in `/sheet`'s embed)
- Discord interaction reply patterns (`deferReply`, ephemeral error helpers → `lib/discord/replies.js`?) — would benefit `/spell`, `/monster`, and `/char` once those land
- Weather + calendar rules — already in `rules/` but tightly coupled to legacy `commands/weather-cmd.js` and `commands/calendar-cmd.js`

---

## The Extraction Pattern (Read This Before Touching Anything)

`CLAUDE.md` has the full version. Quick reference:

**1. Identify the command in `src/index.js`**
Look for `else if (commandName === '<name>')` and grep for all helpers it calls. Trace those helpers — find their definitions, check whether any other commands call them too.

**2. Categorize each helper before moving**
- Pure formatting → `lib/format.js`
- PF2e math (character-data-aware) → `rules/pf2eMath.js`
- Mutates a cached table → `state/<table>.js`
- Used by only this command → `commands/<name>/<purpose>.js`
- Used by 2-3 commands → cross-feature import is fine (see how `/eberron` imports from `commands/deity/`)

**3. Mine shared helpers first**
This is the "helper-mining" step. Moving one helper often unblocks multiple future extractions. Do it as a separate logical step before the command extraction — easier to review, easier to undo if wrong.

**4. Create the feature folder**
```
src/commands/<name>/
  command.js     ← async execute(interaction) — orchestrator
  embed.js       ← Discord renderers if more than ~30 lines
  lookup.js      ← pure data resolution for reference commands
  buttons.js     ← exports `prefixes: ['x_']` + `handle(interaction)` if it has buttons
  validation.js  ← if reused by sibling commands
```

The orchestrator's `execute` MUST have `.length === 1` (only takes `interaction`). All dependencies come through explicit `require` calls. If you find yourself needing a `ctx` parameter, the helper hasn't been properly modularized yet — fix that first.

**5. Wire into `src/index.js`**
Two-line dispatch:
```js
else if (commandName === 'foo') {
  await fooCmd.execute(interaction);
}
```
If the command has buttons, also add the delegate near the `customId.startsWith('foo_')` block — see how `/class`, `/skillinfo`, `/ancestry`, `/rest` do it.

**6. Strip the inline code**
Use `awk 'NR<START || NR>END { print }' src/index.js > /tmp/stripped.js && cp /tmp/stripped.js src/index.js` for clean range deletes when helpers span large blocks. Then validate:

```bash
node --check src/index.js
node --check src/commands/<name>/*.js
node -e "const c = require('./src/commands/<name>/command'); console.log(c.name, c.execute.length);"  # → name, 1
grep -nE "\\b(helper1|helper2|...)\\b" src/index.js  # should be empty or only show imports + intentional cross-feature consumers
```

**The orphan-grep step is mandatory, not optional.** I learned the hard way that `buildItemEmbed` was used by `/itemadd` (still inline) — `node --check` doesn't catch missing references inside still-living code.

---

## Validation Checklist (run after every extraction)

```bash
# 1. Syntax
node --check src/index.js
node --check src/commands/<name>/*.js

# 2. Module load + zero-ctx shape
node -e "
const c = require('./src/commands/<name>/command');
console.log('name:', c.name);
console.log('execute.length:', c.execute.length);  // MUST be 1
"

# 3. Orphan sweep — list every symbol you moved
grep -nE "\\b(symbol1|symbol2|symbol3)\\b" src/index.js
# Expected output: imports at top of file + any intentional cross-feature
# consumers. Anything else means a caller you missed.

# 4. Line count sanity
wc -l src/index.js  # should have gone DOWN by roughly the size of the extracted block
```

If your `wc -l` shows index.js didn't shrink, something went wrong with the awk strip — re-read the affected region.

---

## Sticky Gotchas

### `gamedata/*.json` is gitignored
The reference data (bestiary, spells, items, gamedata) lives in Supabase tables now. The JSON files on disk are for the `tools/aon-*.js` transformer scripts only. **Don't add them to a commit** — `Pathway/.gitignore` already blocks them.

### `.env` vs `.env.example`
`.env.example` is committed and shows the required variable names. `.env` carries real secrets and is gitignored. Viv will need her own `.env` with:
- `TOKEN` or `DISCORD_TOKEN`
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (service key bypasses RLS — never expose to clients)
- `CLIENT_ID` (Discord application ID)
- `BOT_OWNER_ID`, `DEV_GUILD_ID` (for `npm run deploy:guild`)

### Two Supabase projects
- **prod**: `cmmwirlrvqmjqbydlqks` — the deployed bot reads from here
- **develop**: `nqnswvuqszpkntnjzomv` — link to this for migration testing

**Always default-link to develop.** Only re-link to prod when actually deploying schema there. From `web/supabase/`:
```bash
npx supabase link --project-ref nqnswvuqszpkntnjzomv  # develop
npx supabase migration list --linked
npx supabase db push  # applies pending migrations
```

User memory note (per their CLAUDE config): "Never use the MCP Supabase tool; always verify project via CLI before pushing migrations." Use `npx supabase` only.

### Realtime publication membership
For Realtime to deliver events on a new state-cached table, two things must be true on Supabase:
1. `REPLICA IDENTITY FULL` on the table
2. Table is in the `supabase_realtime` publication

The Phase 2 migrations (`web/supabase/migrations/20260524200*.sql`) set both for existing tables. If you create a new state-cached table, write a paired migration. See `20260524200000_character_notes_realtime.sql` as a template.

### node_modules symlink
`Pathwayv2/node_modules` is a symlink to `Pathway/node_modules` for local convenience. It's NOT committed (excluded by gitignore). On a fresh checkout, either symlink it manually:
```bash
cd Pathwayv2 && ln -s ../node_modules node_modules
```
or just `cd Pathway && npm install` once, then symlink.

### Deploying slash commands
After changing `Pathwayv2/src/deploy.js`:
```bash
cd Pathwayv2
npm run deploy:guild  # instant, for testing
npm run deploy        # global, ~1 hour propagation
```
### How v1 and v2 coexist in the repo right now
*(Resolved 2026-07-06.)* v1 has been deleted from the repo. Every entry path launches v2: the repo-root `index.js` and `apps/bot/index.js` are thin compatibility launchers that require `apps/bot/src/index.js`, and `npm start` (root or `apps/bot`) runs it directly. Railway serves v2 in production from root directory `apps/bot`.

---

## Suggested Next Steps for Viv's Session

Phase 3 command extraction is complete and **v2 is live in production (2026-07-06)** — steps 3–4 of the original list (dev-guild smoke test, cutover) are done, and v1 has been deleted from the repo. What remains, in order:

1. **Final dispatcher audit** — `src/index.js` is now mostly imports, startup, buttons, modals, autocomplete, and one-line command dispatch. Review the remaining autocomplete and button handlers for any obvious feature-folder moves.
2. **Fold old top-level command modules only when useful** — `commands/weather-cmd.js`, `commands/calendar-cmd.js`, `commands/downtime.js`, `commands/encounters.js`, and similar scaffolds still exist because feature wrappers depend on them. Don't churn these unless a focused cleanup needs it.
3. **Post-cutover cleanup** — consolidate the two combat engines (legacy `commands/encounters.js` + `rules/combatV2/`) onto combat v2, then delete the retired command folders (`attack`, `initiative`, `monsterattack`, `monsterroll`) once nothing references them.
4. **Add a test suite** — Vitest over the pure `rules/` modules (dice parser, degree of success, MAP, dying/recovery, condition math, spell damage heightening), locked against human-verified worked examples. See `docs/avrae-pathbuilder-roadmap.md` at the repo root for the full roadmap.

---

## Quick Reference Files

- **`Pathwayv2/CLAUDE.md`** — Architecture reference. Read this first. Has the helper decision tree, the state pattern, the command pattern, conventions.
- **`Pathwayv2/src/commands/class/`** — Gold-standard 4-file extraction (lookup + embed + buttons + command). Look here when extracting any paged reference command.
- **`Pathwayv2/src/commands/sheet/`** — Gold-standard 2-file zero-ctx extraction. Look here for the simplest cases.
- **`Pathwayv2/src/commands/eberron/`** — Example of subcommand handling + cross-feature imports.
- **`Pathwayv2/src/state/characters.js`** — THE big state module. Has `resolveChar`, `getCharacterHp`, `setCharacterHp`, `_usernameCache`, etc. Touch carefully.
- **`web/supabase/migrations/`** — Where new state-table migrations go. See `20260524200000_character_notes_realtime.sql` as a template.

---

## Last commit before handoff

Phase 3 is complete: 85 slash command entries extracted, `src/index.js` shrunk to 2,731 lines, and the remaining work is dev-guild smoke testing plus a separate production cutover PR.
