# Data Model — The Existing Supabase Schema

> ### ⚠️ Historical document — read `CLAUDE.md` for current state
>
> Written 2026-07-02, reverse-engineered from the live bot, kept as the record of *why* things are the way they are. It has
> **not** been rewritten as the project moved on. Where it disagrees with
> [`CLAUDE.md`](../../../../CLAUDE.md), CLAUDE.md wins.
>
> **Since:** still broadly useful for the Supabase shape, but `packages/db` and core's
> Zod content schemas are now the typed source of truth. Verify against the code.



> Status: **Reverse-engineered from the live bot** (`vivantur/pathway`,
> `Pathwayv2/`). Companion to [System Architecture](./system-architecture.md)
> and the [Web ⇄ Bot Sync Contract](./web-bot-sync.md).

This is **not a proposed schema.** It documents the database that already exists
and that the bot reads and writes in production. The website must conform to it.
Column lists below are drawn from the bot's queries (`src/lib`, `src/state`,
`src/index.js`) and its migrations; where a column is known to exist but its
exact type is not pinned in code, it is marked *(inferred)*. Treat the live
Supabase project as the final authority and reconcile before writing migrations.

Two Supabase projects: **prod** `cmmwirlrvqmjqbydlqks`, **develop**
`nqnswvuqszpkntnjzomv`. Default to develop for any schema work.

---

## 1. Table map

```
 Identity                 Characters & play state            Reference / content
 ────────                 ───────────────────────            ───────────────────
 users                    characters                         monsters
 user_guild_active_       character_xp_log                   spells
   characters             character_notes                    items
                          bags / bag_items                   homebrew_entries
 Guild / server           downtime                           gamedata
 ─────────────            companions                         (homebrew_packs,
 guild_state              encounters / encounter_events       homebrew_pack_
 guild_snippets           user_snippets                       entries)
 monster_art              (character_builder_drafts)
 monster_edits
 monster_attacks
```

The tables in (parentheses) appear in migration history (created out-of-band on
prod, then RLS/catch-up migrations added) but are touched lightly in current
code; confirm against the live project.

---

## 2. Identity

### `users`
The Pathway account, shared by web and bot.
- `id` UUID PK — **equals Supabase Auth `auth.uid()`** (see migration
  `align_user_ids_with_auth`).
- `discord_id` TEXT — Discord snowflake; how the bot finds the user
  (`lib/userMap.js`).
- `active_char_key` TEXT — the user's currently active character slug
  (migration `20260506_active_character.sql`).
- *(plus profile columns — display name / username cache; confirm on live DB.)*

### `user_guild_active_characters`
Per-guild "active character" selection (a user can be different characters in
different servers).
- `user_id` UUID FK → users · `discord_guild_id` TEXT · `char_key` TEXT
  *(inferred shape from `state/characters.js` usage)*.

---

## 3. Characters & play state

### `characters` — the central table
Confirmed columns (from `lib/pathwayWebClient.js` selects and `state/characters.js`):

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | UUID PK | The web-side character id (`/char add pathway-id:<uuid>`). |
| `user_id` | UUID FK → users | Owner. |
| `char_key` | TEXT | Lowercase per-user slug; unique per user. |
| `name` | TEXT | Character name. |
| `source` | TEXT | Origin tag (e.g. pathbuilder/pathway). |
| `pathbuilder_data` | JSONB | The full build. May be the build object directly or `{ build: {...} }`. |
| `current_hp` | INT | Bot-managed live HP. |
| `hero_points` | INT | Bot-managed. |
| `dying` | INT | Bot-managed condition track. |
| `wounded` | INT | Bot-managed condition track. |
| `experience` | INT | Bot-managed XP. |
| `overlay` | JSONB | Bot-managed mutable state (incl. a `daily` sub-object; shallow-merged on re-import). |
| `updated_at` | TIMESTAMPTZ | **Freshness key for Realtime conflict avoidance — always set on write.** |

> **The single most important compatibility fact:** the *sheet build* lives in
> `pathbuilder_data`, while *live play state* (HP, XP, hero points, dying,
> wounded, and the `overlay`) lives in **dedicated columns**, not inside the
> build JSON. The website must respect that split — edit the build via
> `pathbuilder_data`, and edit live state via the columns — or it will fight the
> bot. See `saveImportedCharacter`'s `preserveOverlay` logic for the exact merge
> rules.

### `character_xp_log` (full DDL known — `20260612_character_xp_log.sql`)
- `id` UUID PK · `user_id` UUID FK · `char_key` TEXT · `amount` INT ·
  `reason` TEXT · `old_xp` INT · `new_xp` INT · `awarded_by_discord_id` TEXT ·
  `entry_type` TEXT CHECK in (`award`,`set`,`reset`) · `created_at` TIMESTAMPTZ.
- RLS: `service_role` ALL; `authenticated` SELECT where `user_id = auth.uid()`.
- `REPLICA IDENTITY FULL` + in `supabase_realtime` publication.
- **This is the canonical example to mirror for any new table.**

### `character_notes`
Per-character notebooks (`state/notes.js`). Keyed by user + char_key.

### `bags` / `bag_items`
Inventory: a character's bags and the items within (`state/bags.js`, two tables
one cache). `bag_items` FK → `bags`.

### `downtime`
Per-character downtime bank/log (`state/downtime.js`).

### `companions`
Animal companions, familiars, eidolons, mounts, custom — attached to a
character (`state/companions.js`; patches the characters cache via Realtime).

### `encounters` / `encounter_events`
Combat tracker state and its event log (`state/encounters.js`).

### `user_snippets`
Per-user reusable text snippets (`state/snippets.js`).

---

## 4. Guild / server-scoped state

### `guild_state`
Calendar, weather, and per-guild settings (`state/guild.js`, `mutateJson`
pattern, keyed by `discord_guild_id`).

### `guild_snippets`
Server-shared snippets (`state/snippets.js`, second cache).

### `monster_art` / `monster_edits` / `monster_attacks`
Per-guild bestiary overlays — custom art, statblock edits, saved attacks —
keyed by `discord_guild_id` (`state/monster.js`, `makeGuildKeyed` factory,
`onConflict: 'discord_guild_id'`).

---

## 5. Reference / content tables

Loaded into in-memory arrays at bot startup and spliced with homebrew.

| Table | Payload column | Notes |
| --- | --- | --- |
| `monsters` | `monster_metadata` | AoN bestiary import; official rows replaced, homebrew/companions preserved. |
| `spells` | `spell_metadata` | AoN spell import; damage extracted into metadata. |
| `items` | `item_metadata` | Item catalog. |
| `homebrew_entries` | `data` | `type`, `entry_key`, `name`, `data`; spliced into the reference arrays live via Realtime. |
| `gamedata` | `category, slug, data` | Calendar/weather rule docs and misc game data. |

`character_builder_drafts`, `homebrew_packs`, `homebrew_pack_entries` exist in
migration history (with RLS catch-up migrations) — confirm current usage on the
live project.

---

## 6. RLS & Realtime invariants (must hold for new tables)

The website authors migrations (per the bot's convention), so it must preserve
the patterns the bot depends on. For every **user-state** table:

1. **RLS enabled**, with:
   - `service_role` → `FOR ALL ... USING (true) WITH CHECK (true)` (the bot).
   - `authenticated` → row access scoped by `user_id = auth.uid()` (the website).
2. **`REPLICA IDENTITY FULL`** (so DELETE payloads carry all columns — the bot's
   cache keys aren't always the PK).
3. **Membership in the `supabase_realtime` publication.**
4. An **`updated_at TIMESTAMPTZ`** column the website sets on every write.

`20260612_character_xp_log.sql` is the reference template for all four.

---

## 7. Identity conventions (from the bot)

- `discordId` — Discord snowflake string.
- `userId` — `users.id` UUID (= `auth.uid()`).
- `charKey` — lowercase slug, unique per user (e.g. `aurelius`).
- `compKey` — lowercase companion slug, unique per character.

---

## 8. Open questions to resolve against the live DB

1. **Exact column inventory & types** for `users`, `bags/bag_items`,
   `character_notes`, `downtime`, `companions`, `encounters`, snippets, and
   guild tables — confirm by introspecting the live project (or back-filling the
   migrations into this repo).
2. **`pathbuilder_data` schema** — pin a Zod/TS type for the build so web and
   bot validate identically. The bot's `parsers/` (Pathbuilder/AoN) define the
   de-facto shape today.
3. **`overlay` schema** — document the keys the bot reads/writes (esp. `daily`)
   so the website never drops them.
4. Status of `character_builder_drafts` / `homebrew_packs*` — live or vestigial.
