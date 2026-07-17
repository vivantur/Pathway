# Web ⇄ Bot Sync Contract

> ### ⚠️ Historical document — read `CLAUDE.md` for current state
>
> Written 2026-07-02 as a draft, kept as the record of *why* things are the way they are. It has
> **not** been rewritten as the project moved on. Where it disagrees with
> [`CLAUDE.md`](../../../../CLAUDE.md), CLAUDE.md wins.
>
> **Since:** the sync story is now "both clients consume `packages/core`" — see
> CLAUDE.md's one architectural rule.



> Status: **Draft for review** · The concrete answer to *"the bot just needs to
> be in sync with the website."* Companion to
> [System Architecture](./system-architecture.md) and
> [Data Model](./data-model.md).

This document specifies exactly what the **website** must do to stay in sync with
the already-built Discord bot. The bot already implements the hard side of sync
(in-memory cache + Realtime + freshness-checked writes). Sync is therefore not a
new subsystem to build — it is a **contract the website must honor** against the
shared Supabase database.

---

## 0. The one-paragraph model

There is exactly **one** `characters` row (and one of every other user-state
row) per real-world thing. Both clients read and write that same row. The bot
keeps an in-memory cache and listens to Supabase **Realtime** so it sees the
website's writes within moments and won't overwrite them with stale data. So if
the website (a) writes the **same row** for the **same user** in the **same
column shape** and (b) stamps `updated_at`, the two are in sync automatically.
Everything below is the detail behind that sentence.

---

## 1. Connect to the same backend, the safe way

| | Bot (existing) | Website (to build) |
| --- | --- | --- |
| Supabase project | prod `cmmwirlrvqmjqbydlqks` / dev `nqnswvuqszpkntnjzomv` | **same projects** |
| Key | `SUPABASE_SERVICE_ROLE_KEY` (server-side, bypasses RLS) | **anon/publishable key** in the browser |
| Acts as | many users (trusted server) | the logged-in user (`auth.uid()`) |
| Authorization | bypasses RLS | **subject to RLS** |

**Hard rule:** the service-role key must never reach the browser. The website
uses the anon key plus the user's Supabase Auth session; RLS confines it to that
user's rows. Any privileged server-side action the website needs (admin tools,
imports) goes through its own backend, never the client.

---

## 2. Resolve to the same `users` row

Sync is meaningless if the website's user and the bot's user are different rows.
The invariant: **`users.id == auth.uid()`** (already true on the bot side via the
`align_user_ids_with_auth` migration), and **`users.discord_id`** carries the
snowflake the bot keys on.

Required behavior:

1. On web sign-in, ensure a `users` row exists with `id = auth.uid()`.
2. Populate/confirm `users.discord_id` so the bot can find this account.
   - **Recommended:** enable **Discord as a Supabase Auth provider** so a
     Discord web login yields the snowflake directly. *(ADR pending — Phase W1.)*
   - **Fallback:** an explicit "link Discord" flow that writes `discord_id`.
3. Never create a second `users` row for someone who already exists under their
   Discord identity — match on `discord_id` first.

---

## 3. Write user-state in the exact shape the bot reads

This is where sync most often breaks. The website must match the column split
documented in [data-model.md](./data-model.md). For `characters` specifically:

- **Sheet/build edits → `pathbuilder_data`** (JSONB). The bot reads
  `pathbuilder_data.build ?? pathbuilder_data`.
- **Live play state → dedicated columns**, *not* the build JSON:
  `current_hp`, `hero_points`, `dying`, `wounded`, `experience`, `overlay`.
- **`overlay`** is shallow-merged by the bot (with a nested `daily` object).
  Read-modify-write it; never blind-overwrite, or you drop bot-managed keys.
- Set **`char_key`** (stable per-user slug), **`name`**, **`source`**.

> If the website stuffs HP/XP into `pathbuilder_data` instead of the columns, the
> bot will ignore it. If it overwrites `overlay` wholesale, it will wipe daily
> resources the bot tracks. Honor the split.

---

## 4. Always stamp `updated_at`

The bot's Realtime handlers use a **per-row `updated_at` freshness check** to
avoid clobbering a fresher value with a stale cached one. The website must set
`updated_at = now()` (or let a DB trigger do it) on **every** write to a
user-state row. A write without a moving `updated_at` can be treated as stale
and ignored, or can cause the bot to win a conflict it should have lost.

**Recommendation:** add `updated_at` triggers in the migrations so neither client
can forget. *(Migration task — Phase W0/W2.)*

---

## 5. (Optional but recommended) subscribe to Realtime on the web too

The bot reacts to web writes today. For the **website** to react to *bot* writes
live (HP ticking down during combat, XP awarded in Discord), it should subscribe
to the same Realtime channels for the rows it's displaying:

- Subscribe to `postgres_changes` on `characters` filtered to the open
  character's `id` (and to `character_xp_log`, `bags`, etc. as needed).
- Apply the same **`updated_at` freshness check** before patching local UI state.
- Tear down subscriptions on unmount.

Without this the website still *stays consistent* (a refresh shows the truth);
with it, the website feels live like the bot does.

---

## 6. Schema changes are authored here

By the bot's own convention, **the web repo owns `supabase/migrations/`** and the
bot does not. So:

- Any new user-state table needs a migration in this repo that also sets RLS,
  `REPLICA IDENTITY FULL`, publication membership, and `updated_at` — the
  four invariants in [data-model.md §6](./data-model.md#6-rls--realtime-invariants-must-hold-for-new-tables).
  Use `20260612_character_xp_log.sql` from the bot repo as the template.
- **Coordinate with the bot before changing existing tables** — the bot caches
  their shape in `state/*` modules and will need a paired change.
- Apply with the Supabase CLI (`npx supabase ...`), default-linked to **develop**;
  re-link to prod only to deploy. *(Per the bot owner's standing rule: use the
  CLI, not the MCP Supabase tool, and verify the linked project before pushing.)*

---

## 7. Pathbuilder / import-export compatibility

The bot already imports Pathbuilder data (`parsers/`, `lib/pathwayWebClient.js`)
and stores it in `pathbuilder_data`. The website should:

- Export characters as **Pathbuilder-compatible JSON** straight from
  `pathbuilder_data`.
- When importing, write the same shape so a bot `/char add pathway-id:<uuid>` or
  `/sheet` refresh finds and reads it (the bot matches by `id`, then by
  `char_key`/`name`).

---

## 8. Definition of done for "in sync"

The website is in sync with the bot when all hold:

- [ ] Web and bot operate on the **same** Supabase project(s).
- [ ] A web login resolves to the **same `users` row** the bot uses (`auth.uid()`
      + `discord_id`).
- [ ] The website connects with the **anon key under RLS**; the service key is
      never client-side.
- [ ] Character writes use **`pathbuilder_data` for the build** and **columns for
      live state**, with `overlay` read-modify-written.
- [ ] **`updated_at` is set on every user-state write.**
- [ ] (Recommended) the website subscribes to Realtime and applies the freshness
      check, so bot writes appear live.
- [ ] New/changed tables ship migrations that preserve the four RLS/Realtime
      invariants, coordinated with the bot.

---

## 9. Open decisions (ADRs)

1. Discord ⇄ web identity unification — Auth provider vs. explicit link (Phase W1).
2. Does the website talk to Supabase directly from the browser, or through a thin
   Express API (the master spec's stack mentions Express on Railway)? This
   affects where privileged operations and PDF export run.
3. Back-filling already-applied migrations into this repo for a single tracked
   schema history (Phase W0).
